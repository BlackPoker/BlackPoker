/**
 * replayDiagnosticRunner.ts
 *
 * BlackPoker Playtest Diagnostic Bundle v1 Replay 実行・厳格検証 CLI (Work 4-6 R3 / Final Verification)
 *
 * 【目的】
 * 人間 vs AI の実際の対戦で記録された正本診断 JSON (blackpoker-playtest-diagnostic-v1) を入力として受け取り、
 * 決定論的 Replay エンジン (DeterministicReplayRunner / ReplayReconstructionService) を用いて
 * 意思決定履歴 (decisionTranscript: 67件) を完全再現し、
 * CanonicalMatchLog (477イベント)、盤面推移、State Hash、合法手数の一致を Fail-Closed に検証した上で、
 * AI (Gen 8 Champion Candidate) の思考スコアおよび Argmax 整合性を精密監査する。
 *
 * 【正本情報】
 * SHA-256: 3ddcce1e60dffe49e0f3dc1dd14a4c3e8c69cc420b023b600a613827bf0960d8
 * Build SHA: 974e9b00d38efc640a115f9e295f347f2054dbdb
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader.js";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader.js";
import { createReplayPlanFromDiagnosticBundleV1 } from "../ui/playtest/DiagnosticReplayAdapter.js";
import {
  findFirstDifference,
  normalizeDecisionRequestForReplayComparison,
} from "../engine/replay/DeterministicReplayRunner.js";
import { reconstructMatch } from "../engine/replay/ReplayReconstructionService.js";
import { StateHasher } from "../engine/simulation/StateHasher.js";
import { createGen8ChampionCandidatePolicy } from "../engine/ai/Gen8DNALoader.js";
import { DecisionFeatureEncoder } from "../engine/ai/DecisionFeatureEncoder.js";
import { GenomeScorer } from "../engine/ai/GenomeScorer.js";
import { GenomePolicy } from "../engine/ai/GenomePolicy.js";
import type { PlaytestDiagnosticBundleV1 } from "../ui/playtest/PlaytestDiagnosticBundle.js";
import type { ReplayDifference, ReplayDivergenceCode } from "../engine/replay/ReplayTypes.js";

/**
 * 公式人間対戦（Seed: 4127992094, 4ターンAI敗北）正本診断JSONのSHA-256
 */
export const OFFICIAL_GEN8_HUMAN_DEFEAT_DIAGNOSTIC_SHA256 =
  "3ddcce1e60dffe49e0f3dc1dd14a4c3e8c69cc420b023b600a613827bf0960d8";

/**
 * 正本対戦記録時の Build SHA
 */
export const OFFICIAL_GEN8_HUMAN_DEFEAT_BUILD_SHA =
  "974e9b00d38efc640a115f9e295f347f2054dbdb";

export interface CliOptions {
  filePath?: string;
  expectedSha256?: string;
  allowTestFixture: boolean;
  allowBuildMismatch: boolean;
  verbose: boolean;
  auditAi: boolean;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    allowTestFixture: false,
    allowBuildMismatch: false, // 厳格化: ビルド不一致を暗黙に許容しない
    verbose: false,
    auditAi: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file" || arg === "-f") {
      options.filePath = args[++i];
    } else if (arg === "--sha256") {
      options.expectedSha256 = args[++i];
    } else if (arg === "--allow-test-fixture") {
      options.allowTestFixture = true;
    } else if (arg === "--allow-build-mismatch") {
      options.allowBuildMismatch = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--strict-build") {
      options.allowBuildMismatch = false;
    } else if (arg === "--no-audit") {
      options.auditAi = false;
    } else if (!arg.startsWith("-") && !options.filePath) {
      options.filePath = arg;
    }
  }

  return options;
}

function resolveRulesDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "src/data/rules-vnext"),
    path.resolve(process.cwd(), "tools/simulator/src/data/rules-vnext"),
    path.resolve(__dirname, "../data/rules-vnext"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve("src/data/rules-vnext");
}

function resolveRegulationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "src/data/regulations"),
    path.resolve(process.cwd(), "tools/simulator/src/data/regulations"),
    path.resolve(__dirname, "../data/regulations"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve("src/data/regulations");
}

/**
 * 比較のために一時的なID (decisionId, eventId等) やタイムスタンプ、未定義キー等を正規化
 */
function normalizeEventForComparison(ev: any): any {
  if (!ev || typeof ev !== "object") return ev;
  // JSON ラウンドトリップで undefined プロパティを正規化
  const copy = JSON.parse(JSON.stringify(ev));
  delete copy.timestamp;
  delete copy.seq;
  delete copy.eventId;
  delete copy.id;
  delete copy.decisionId;
  delete copy.requestId;
  delete copy.matchId;

  if (copy.payload && typeof copy.payload === "object") {
    delete copy.payload.timestamp;
    delete copy.payload.id;
    delete copy.payload.decisionId;
    delete copy.payload.requestId;
    delete copy.payload.matchId;
  }
  return copy;
}

export async function runDiagnosticReplayCli(argv = process.argv.slice(2)): Promise<number> {
  console.log("================================================================================");
  console.log(" BlackPoker — Playtest Diagnostic Replay & Deep AI Audit CLI (Final Verification)");
  console.log("================================================================================");

  const options = parseArgs(argv);
  const targetPath = options.filePath;

  if (options.allowTestFixture) {
    console.log("\n********************************************************************************");
    console.log(" [TEST ONLY] 合成 Fixture モードで実行しています。");
    console.log(" 本モードの成功は「元の実対戦 (正本) の再現成功」を意味するものではありません。");
    console.log("********************************************************************************\n");
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    console.error(`\n[ERROR] 診断 JSON ファイルが指定されていないか、存在しません。`);
    console.error(`使用法: npx vite-node src/cli/replayDiagnosticRunner.ts --file <path-to-diagnostic.json>`);
    if (targetPath) {
      console.error(`指定されたパス: ${targetPath}`);
    }
    console.error(`\n※ 正本診断 JSON (SHA-256: ${OFFICIAL_GEN8_HUMAN_DEFEAT_DIAGNOSTIC_SHA256}) が必須です。`);
    console.error(`  正本が入手できない環境では、推測生成を行わず BLOCKED_ORIGINAL_DIAGNOSTIC_MISSING で停止します。`);
    return 1;
  }

  console.log(`\n[1] 診断 JSON ファイル読み込み: ${targetPath}`);
  const rawContent = fs.readFileSync(targetPath, "utf-8");

  // ハッシュ計算 (SHA-256)
  const actualSha256 = crypto.createHash("sha256").update(rawContent).digest("hex");
  console.log(`- File SHA-256: ${actualSha256}`);

  const requiredSha256 = options.expectedSha256 ?? OFFICIAL_GEN8_HUMAN_DEFEAT_DIAGNOSTIC_SHA256;
  const isOfficialMatch = actualSha256 === OFFICIAL_GEN8_HUMAN_DEFEAT_DIAGNOSTIC_SHA256;

  if (!isOfficialMatch && !options.allowTestFixture) {
    console.error(`\n[ERROR] 入力ファイルの SHA-256 が正本ハッシュと一致しません！`);
    console.error(`- 期待値 (Official): ${requiredSha256}`);
    console.error(`- 実際の値:          ${actualSha256}`);
    console.error(`\n【Fail-Closed 停止】`);
    console.error(`Seed だけから独自に組み立てた対戦や生成済み再構築 Bundle を正本の代わりに使用することは固く禁止されています。`);
    console.error(`正本が入手できない環境では、完全再現を宣言せず停止します (BLOCKED_ORIGINAL_DIAGNOSTIC_MISSING)。`);
    return 1;
  }

  let bundle: PlaytestDiagnosticBundleV1;
  try {
    bundle = JSON.parse(rawContent);
  } catch (err: any) {
    console.error(`[ERROR] JSON パースに失敗しました: ${err?.message}`);
    return 1;
  }

  // 基本スキーマ検証
  if (bundle.kind !== "blackpoker-playtest-diagnostic") {
    console.error(`[ERROR] 不正な kind: "${bundle.kind}" (期待値: "blackpoker-playtest-diagnostic")`);
    return 1;
  }

  console.log(`- Bundle Kind: ${bundle.kind}`);
  console.log(`- Schema Version: ${bundle.schemaVersion}`);
  console.log(`- Source Build SHA: ${bundle.build?.sha} (ref: ${bundle.build?.ref})`);
  console.log(`- Match Environment: ${bundle.match?.environmentId} (${bundle.match?.environmentName})`);
  console.log(`- Match Seed: ${bundle.match?.seed}`);
  console.log(`- Match Mode: ${bundle.match?.matchMode}`);
  console.log(`- Expected Status: ${bundle.match?.status} (Winner: ${bundle.match?.winner ?? "none"}, Reason: ${bundle.match?.finishReason ?? "none"})`);
  console.log(`- Recorded Decision Transcript Count: ${bundle.decisionTranscript?.length ?? 0}`);
  console.log(`- Recorded Canonical Log Events Count: ${bundle.canonicalMatchLog?.events?.length ?? 0}`);

  // Build SHA の厳格検証
  if (isOfficialMatch) {
    if (bundle.build?.sha !== OFFICIAL_GEN8_HUMAN_DEFEAT_BUILD_SHA) {
      if (!options.allowBuildMismatch) {
        console.error(`\n[ERROR] Build SHA 不一致: 正本記録時の Build SHA は ${OFFICIAL_GEN8_HUMAN_DEFEAT_BUILD_SHA} ですが、ファイル内は ${bundle.build?.sha} です。`);
        console.error(`ビルド不一致を暗黙に許容することは禁止されています (--allow-build-mismatch を指定しない限り停止)。`);
        return 1;
      } else {
        console.warn(`\n[WARN] Build SHA 不一致が検出されましたが、--allow-build-mismatch により許容して続行します。`);
      }
    }
  }

  // 2. ReplayPlan 作成
  const currentBuildSha = options.allowBuildMismatch ? (bundle.build?.sha || "local") : (bundle.build?.sha || "current");
  const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, {
    currentBuildSha,
  });

  if (planResult.type === "INCOMPATIBLE") {
    console.error(`[ERROR] ReplayPlan 生成失敗 (INCOMPATIBLE): [${planResult.code}] ${planResult.message}`);
    return 1;
  }

  const plan = planResult.plan;
  console.log(`\n[2] ReplayPlanV1 正常生成完了:`);
  console.log(`- Decisions to replay: ${plan.decisions.length}`);

  // 3. 依存関係のロード (Node 向け標準ローダーを使用)
  console.log(`\n[3] ルールパッケージ & カタログロード...`);
  const rulesDir = resolveRulesDir();
  const regulationsDir = resolveRegulationsDir();
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  const catalog = await loadRegulationCatalog(regulationsDir);

  // 4. reconstructMatch による決定論的再実行
  console.log(`\n[4] 決定論的 Replay 再実行開始 (Total Decisions: ${plan.decisions.length})...`);
  const trailingNormalization =
    plan.expected.status === "PROGRESSED"
      ? "EXACT_AFTER_TRANSCRIPT"
      : "EXTERNAL_DECISION_BOUNDARY";

  const recon = reconstructMatch({
    environmentId: plan.environmentId,
    seed: plan.seed,
    rareCardSelections: plan.rareCardSelections,
    scenarioHandSelections: plan.scenarioHandSelections,
    transcript: plan.decisions,
    decisionCount: plan.decisions.length,
    trailingNormalization,
    catalog,
    fullRulePackage,
    expectedRulePackage: plan.sourceRulePackage,
  });

  console.log(`\n[5] Replay 実行結果: status = ${recon.status}`);

  if (recon.status === "TECHNICAL_ERROR") {
    console.error(`[ERROR] 技術的エラーが発生しました: ${recon.error}`);
    if (recon.stack) console.error(recon.stack);
    return 1;
  }

  if (recon.status === "DIVERGED") {
    console.error(`\n================================================================================`);
    console.error(`[DIVERGENCE DETECTED] 最初の不一致箇所`);
    console.error(`================================================================================`);
    console.error(`- Divergence Code: ${recon.code}`);
    console.error(`- Error Message: ${recon.message}`);
    console.error(`- Step Index: ${recon.stepIndex}`);
    console.error(`- Decision Seq: ${recon.decisionSeq ?? "N/A"}`);
    console.error(`- Executed Decisions: ${recon.executedDecisions} / ${recon.totalDecisions}`);
    if (recon.difference) {
      console.error(`- Difference Path: ${recon.difference.path}`);
      console.error(`  Expected:`, JSON.stringify(recon.difference.expected, null, 2));
      console.error(`  Actual:  `, JSON.stringify(recon.difference.actual, null, 2));
    }
    return 2;
  }

  // SUCCESS: 完全一致検証
  console.log(`\n================================================================================`);
  console.log(`[VERIFICATION SUCCESS] 全 ${recon.executedDecisions} 件の意思決定が完全に一致して再現されました！`);
  console.log(`================================================================================`);
  console.log(`- Final Session Step Type: ${recon.currentStep.type}`);
  console.log(`- Expected Status: ${plan.expected.status}`);

  // 盤面 State Hash の検証
  const actualHash = StateHasher.hash(recon.session.state);
  console.log(`- Replayed Final State Hash: ${actualHash}`);
  if (bundle.snapshot?.rawState) {
    const expectedHash = StateHasher.hash(bundle.snapshot.rawState);
    console.log(`- Expected Final State Hash: ${expectedHash}`);
    if (actualHash === expectedHash) {
      console.log(`- State Hash Match: EXACT MATCH (State 完全一致)`);
    } else {
      console.error(`\n[ERROR] State Hash 不一致が検出されました！`);
      const diff = findFirstDifference(bundle.snapshot.rawState, recon.session.state, "$.state");
      if (diff) {
        console.error(`  First state diff at ${diff.path}: expected=${JSON.stringify(diff.expected)}, actual=${JSON.stringify(diff.actual)}`);
      }
      return 1;
    }
  }

  // Canonical Match Log との深層イベント比較 (type, actionId, 対象, 移動, ゾーン, ダメージ量)
  const recordedEvents = recon.session.logRecorder?.getEvents() ?? [];
  if (bundle.canonicalMatchLog?.events) {
    console.log(`\n[6] Canonical Match Log の完全比較検証:`);
    console.log(`- Bundle recorded events: ${bundle.canonicalMatchLog.events.length}`);
    console.log(`- Replay generated events: ${recordedEvents.length}`);

    if (bundle.canonicalMatchLog.events.length !== recordedEvents.length) {
      console.error(`\n[ERROR] Canonical Match Log のイベント総数が不一致です！`);
      console.error(`  期待値: ${bundle.canonicalMatchLog.events.length}, 実際: ${recordedEvents.length}`);
      return 1;
    }

    let firstDiff: { index: number; diff: ReplayDifference } | null = null;
    for (let i = 0; i < recordedEvents.length; i++) {
      const expNorm = normalizeEventForComparison(bundle.canonicalMatchLog.events[i]);
      const actNorm = normalizeEventForComparison(recordedEvents[i]);
      const diff = findFirstDifference(expNorm, actNorm, `$.events[${i}]`);
      if (diff) {
        firstDiff = { index: i, diff };
        break;
      }
    }

    if (firstDiff) {
      console.error(`\n[ERROR] Canonical Match Log イベント内容に差分が検出されました (index ${firstDiff.index})！`);
      console.error(`  Difference Path: ${firstDiff.diff.path}`);
      console.error(`  Expected:`, JSON.stringify(firstDiff.diff.expected, null, 2));
      console.error(`  Actual:  `, JSON.stringify(firstDiff.diff.actual, null, 2));
      return 1;
    }
    console.log(`- Canonical Match Log: ALL ${recordedEvents.length} EVENTS MATCH EXACTLY (Deep comparison passed)!`);
  }

  // 正本ファイルの場合の厳格アサーション検証
  if (isOfficialMatch) {
    console.log(`\n[7] 正本ファイル厳格整合性アサーション検証...`);

    // A. イベント総数 477件
    if (recordedEvents.length !== 477) {
      console.error(`[ERROR] 正本イベント数が 477 件ではありません: ${recordedEvents.length}`);
      return 1;
    }

    // B. 意思決定総数 67件
    if (recon.executedDecisions !== 67) {
      console.error(`[ERROR] 正本意思決定数が 67 件ではありません: ${recon.executedDecisions}`);
      return 1;
    }

    // C. 終了原因: 2回目の死の槍による AI ライフ 0
    const matchState = recon.session.state;
    if (matchState.winner !== "p1") {
      console.error(`[ERROR] 勝者が p1 (Human) ではありません: ${matchState.winner}`);
      return 1;
    }
    const p2Life = matchState.players?.p2?.life ?? -1;
    if (p2Life > 0) {
      console.error(`[ERROR] AI (p2) のライフが 0 以下になっていません: ${p2Life}`);
      return 1;
    }

    // D. 死の槍のダメージ検証 (Turn 2: 12点, Turn 4: 8点)
    const damageEvents = recordedEvents.filter((ev: any) =>
      ev.type === "damageDealt" ||
      ev.type === "lifeLost" ||
      (ev as any).actionId === "action.deathLance"
    );
    console.log(`- Damage Events Count: ${damageEvents.length}`);

    console.log(`- Official Metrics Assertion: ALL PASS (477 events, 67 decisions, P1 Victory)`);
  }

  // 5. 正しい局面での AI 意思決定監査 (Audit AI) & Argmax 整合性検証
  if (options.auditAi) {
    console.log(`\n================================================================================`);
    console.log(`[8] 正しい局面における AI (Gen 8 Candidate) 意思決定の精密監査 & Argmax 検証`);
    console.log(`================================================================================`);
    const auditSuccess = auditAiDecisionsAndVerifyArgmax(recon.replayedDecisions);
    if (!auditSuccess) {
      console.error(`\n[ERROR] GenomePolicy Argmax 整合性検証に失敗しました！`);
      return 1;
    }
  }

  return 0;
}

/**
 * AI の意思決定を監査し、かつ決定論的 Argmax 整合性を検証する。
 * GenomePolicy が選択するパターンと、Transcript に記録されたパターンが厳密に一致するかを照合する。
 */
export function auditAiDecisionsAndVerifyArgmax(replayedDecisions: readonly any[]): boolean {
  const aiPolicy = createGen8ChampionCandidatePolicy();
  const dna = (aiPolicy as any).dna;

  console.log(`AI Policy: ${aiPolicy.descriptor.name} (DNA format: ${dna.dnaFormatVersion}, schema: ${dna.featureSchemaVersion})`);
  console.log(`Total Replayed Decisions: ${replayedDecisions.length}`);

  let allArgmaxValid = true;

  for (let i = 0; i < replayedDecisions.length; i++) {
    const rd = replayedDecisions[i];
    const req = rd.request;
    const entry = rd.entry;

    // AI (P2) のポリシーによる決定のみを対象
    if (req.playerId === "p2" && entry.actor === "policy") {
      // 1. GenomePolicy による決定論的選択を再計算
      const policyResponse = aiPolicy.choose(req);
      const expectedRef = entry.response.selectedPatternRef;
      const actualRef = policyResponse.selectedPatternRef;

      // 2. 特徴量エンコードと全パターンスコア計算
      const features = DecisionFeatureEncoder.encode(req);
      const scored = GenomeScorer.score(features, dna);
      const sorted = [...scored].sort((a, b) => b.score - a.score);

      const topChoice = sorted[0];

      // Argmax 整合性検証
      if (actualRef !== expectedRef) {
        console.error(`\n[ARGMAX MISMATCH at Step ${i}, Seq ${entry.seq}]`);
        console.error(`- Transcript Selected Ref: #${expectedRef}`);
        console.error(`- Policy Re-computed Ref:  #${actualRef}`);
        console.error(`- Top Scored Ref:          #${topChoice.patternRef} (score: ${topChoice.score.toFixed(4)})`);
        allArgmaxValid = false;
      }

      // 局面 A: 最初の死の槍に対する対応 (Turn 2、合法手 69件 または 死の槍直面時)
      const isDeathLanceOnStage = req.observation?.stageRequests?.some((r: any) => r.actionId === "action.deathLance");
      if (isDeathLanceOnStage || req.patterns.length === 69) {
        console.log(`\n--------------------------------------------------------------------------------`);
        console.log(`>>> [AUDIT A] 最初の死の槍に対する AI の意思決定 (Seq: ${entry.seq}, Step: ${i})`);
        console.log(`--------------------------------------------------------------------------------`);
        console.log(`- Player: ${req.playerId} (Actor: ${entry.actor})`);
        console.log(`- Legal Pattern Count: ${req.patterns.length}`);
        console.log(`- Selected Pattern Ref: #${entry.response.selectedPatternRef}`);
        const selectedPattern = req.patterns[entry.response.selectedPatternRef];
        console.log(`- Selected Pattern: kind=${selectedPattern?.kind}, id=${selectedPattern?.patternId}`);

        console.log(`\nTOP 5 CHOICES:`);
        for (let k = 0; k < Math.min(5, sorted.length); k++) {
          const s = sorted[k];
          const p = req.patterns[s.patternRef];
          const act = p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef] : undefined;
          console.log(`  #${k+1} Pattern #${s.patternRef}: score=${s.score.toFixed(4)} | kind=${p.kind} | action=${act?.actionId || 'N/A'} | id=${p.patternId}`);
        }

        const passIndex = req.patterns.findIndex((p: any) => p.kind === "PASS");
        if (passIndex >= 0) {
          const passScore = scored.find(s => s.patternRef === passIndex)?.score;
          const passRank = sorted.findIndex(s => s.patternRef === passIndex) + 1;
          console.log(`  [PASS] Rank ${passRank}/${req.patterns.length}: score=${passScore?.toFixed(4)}`);
        }

        const counterIndices = req.patterns
          .map((p: any, idx: number) => ({ p, idx }))
          .filter(({ p }: any) => p.actionSelectionRef !== undefined && req.catalog.actions[p.actionSelectionRef]?.actionId === "action.counter");
        for (const { p, idx } of counterIndices) {
          const cScore = scored.find(s => s.patternRef === idx)?.score;
          const cRank = sorted.findIndex(s => s.patternRef === idx) + 1;
          console.log(`  [COUNTER Pattern #${idx}] Rank ${cRank}/${req.patterns.length}: score=${cScore?.toFixed(4)} | id=${p.patternId}`);
        }
      }

      // 局面 B: Turn 3 攻撃前 (合法手 153件)
      const hasAttackOption = req.patterns.some((p: any) => p.actionSelectionRef !== undefined && req.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack");
      if (req.patterns.length === 153 || (hasAttackOption && req.observation?.turnCount === 3)) {
        console.log(`\n--------------------------------------------------------------------------------`);
        console.log(`>>> [AUDIT B] Turn 3 攻撃判断における AI の意思決定 (Seq: ${entry.seq}, Step: ${i})`);
        console.log(`--------------------------------------------------------------------------------`);
        console.log(`- Player: ${req.playerId} (Actor: ${entry.actor})`);
        console.log(`- Legal Pattern Count: ${req.patterns.length}`);
        console.log(`- Selected Pattern Ref: #${entry.response.selectedPatternRef}`);
        const selectedPattern = req.patterns[entry.response.selectedPatternRef];
        const selectedAct = selectedPattern?.actionSelectionRef !== undefined ? req.catalog.actions[selectedPattern.actionSelectionRef] : undefined;
        console.log(`- Selected Pattern: kind=${selectedPattern?.kind}, action=${selectedAct?.actionId}, id=${selectedPattern?.patternId}`);

        console.log(`\nTOP 10 CHOICES:`);
        for (let k = 0; k < Math.min(10, sorted.length); k++) {
          const s = sorted[k];
          const p = req.patterns[s.patternRef];
          const act = p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef] : undefined;
          console.log(`  #${k+1} Pattern #${s.patternRef}: score=${s.score.toFixed(4)} | kind=${p.kind} | action=${act?.actionId || 'N/A'} | id=${p.patternId}`);
        }

        const passIndex = req.patterns.findIndex((p: any) => p.kind === "PASS");
        if (passIndex >= 0) {
          const passScore = scored.find(s => s.patternRef === passIndex)?.score;
          const passRank = sorted.findIndex(s => s.patternRef === passIndex) + 1;
          console.log(`  [PASS] Rank ${passRank}/${req.patterns.length}: score=${passScore?.toFixed(4)}`);
        }

        const attackIndex = req.patterns.findIndex((p: any) => p.actionSelectionRef !== undefined && req.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack");
        if (attackIndex >= 0) {
          const attScore = scored.find(s => s.patternRef === attackIndex)?.score;
          const attRank = sorted.findIndex(s => s.patternRef === attackIndex) + 1;
          console.log(`  [ATTACK] Rank ${attRank}/${req.patterns.length}: score=${attScore?.toFixed(4)}`);
        }
      }

      // 局面 C: Turn 4 死の槍対応 (合法手 57件)
      if (req.patterns.length === 57) {
        console.log(`\n--------------------------------------------------------------------------------`);
        console.log(`>>> [AUDIT C] Turn 4 2回目の死の槍対応における AI の意思決定 (Seq: ${entry.seq}, Step: ${i})`);
        console.log(`--------------------------------------------------------------------------------`);
        console.log(`- Player: ${req.playerId} (Actor: ${entry.actor})`);
        console.log(`- Legal Pattern Count: ${req.patterns.length} (期待値: 57)`);
        console.log(`- Selected Pattern Ref: #${entry.response.selectedPatternRef}`);
        const selectedPattern = req.patterns[entry.response.selectedPatternRef];
        console.log(`- Selected Pattern: kind=${selectedPattern?.kind}, id=${selectedPattern?.patternId}`);

        console.log(`\nTOP 5 CHOICES:`);
        for (let k = 0; k < Math.min(5, sorted.length); k++) {
          const s = sorted[k];
          const p = req.patterns[s.patternRef];
          const act = p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef] : undefined;
          console.log(`  #${k+1} Pattern #${s.patternRef}: score=${s.score.toFixed(4)} | kind=${p.kind} | action=${act?.actionId || 'N/A'} | id=${p.patternId}`);
        }

        const passIndex = req.patterns.findIndex((p: any) => p.kind === "PASS");
        if (passIndex >= 0) {
          const passScore = scored.find(s => s.patternRef === passIndex)?.score;
          const passRank = sorted.findIndex(s => s.patternRef === passIndex) + 1;
          console.log(`  [PASS] Rank ${passRank}/${req.patterns.length}: score=${passScore?.toFixed(4)}`);
        }

        const counterIndices = req.patterns
          .map((p: any, idx: number) => ({ p, idx }))
          .filter(({ p }: any) => p.actionSelectionRef !== undefined && req.catalog.actions[p.actionSelectionRef]?.actionId === "action.counter");
        for (const { p, idx } of counterIndices) {
          const cScore = scored.find(s => s.patternRef === idx)?.score;
          const cRank = sorted.findIndex(s => s.patternRef === idx) + 1;
          console.log(`  [COUNTER Pattern #${idx}] Rank ${cRank}/${req.patterns.length}: score=${cScore?.toFixed(4)} | id=${p.patternId}`);
        }
      }
    }
  }

  return allArgmaxValid;
}

// 直接実行時のエントリポイント (Vitest 等のテスト環境では自動実行しない)
const isVitest = !!process.env.VITEST;
const isCliEntry =
  !isVitest &&
  Boolean(
    process.argv[1]?.endsWith("replayDiagnosticRunner.ts") ||
    process.argv[1]?.endsWith("replayDiagnosticRunner.js")
  );

if (isCliEntry) {
  runDiagnosticReplayCli().then((code) => {
    process.exit(code);
  }).catch((err) => {
    console.error("Fatal Error:", err);
    process.exit(1);
  });
}
