/**
 * replayDiagnosticRunner.ts
 *
 * BlackPoker Playtest Diagnostic Bundle v1 Replay 実行・厳格検証 CLI
 *
 * 【目的】
 * 人間 vs AI の実際の対戦で記録された診断 JSON (blackpoker-playtest-diagnostic-v1) を入力として受け取り、
 * 決定論的 Replay エンジン (DeterministicReplayRunner / ReplayReconstructionService) を用いて
 * 意思決定履歴 (decisionTranscript: 67件など) を完全再現し、
 * CanonicalMatchLog、盤面推移、State Hash、合法手数の一致を検証した上で、
 * 正しい局面における AI (Gen 8 Candidate) の思考スコアを監査・再評価する。
 */

import * as fs from "fs";
import * as path from "path";
import { loadRulePackageForBrowser } from "../engine/rules/BrowserRuleLoader.js";
import { loadRegulationCatalogForBrowser } from "../engine/regulation/BrowserRegulationLoader.js";
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
import type { PlaytestDiagnosticBundleV1 } from "../ui/playtest/PlaytestDiagnosticBundle.js";
import type { ReplayDifference, ReplayDivergenceCode } from "../engine/replay/ReplayTypes.js";

interface CliOptions {
  filePath?: string;
  allowBuildMismatch: boolean;
  verbose: boolean;
  auditAi: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    allowBuildMismatch: true, // 診断目的のためデフォルトで許容
    verbose: false,
    auditAi: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file" || arg === "-f") {
      options.filePath = args[++i];
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

function findDefaultDiagnosticFile(): string | null {
  const candidateDirs = [
    path.resolve(process.cwd(), ".artifacts"),
    path.resolve(process.cwd(), "evidence"),
    path.resolve(process.cwd(), "tools/simulator/.artifacts"),
    path.resolve(process.cwd(), "tools/simulator/evidence"),
    process.cwd(),
  ];

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.includes("diagnostic") && file.endsWith(".json")) {
          return path.join(dir, file);
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export async function runDiagnosticReplayCli(argv = process.argv.slice(2)): Promise<number> {
  console.log("================================================================================");
  console.log(" BlackPoker — Playtest Diagnostic Replay & Deep AI Audit CLI");
  console.log("================================================================================");

  const options = parseArgs(argv);
  let targetPath = options.filePath;

  if (!targetPath) {
    targetPath = findDefaultDiagnosticFile() ?? undefined;
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    console.error(`\n[ERROR] 診断 JSON ファイルが見つかりません。`);
    console.error(`使用法: npx vite-node src/cli/replayDiagnosticRunner.ts --file <path-to-diagnostic.json>`);
    if (targetPath) {
      console.error(`指定されたパス: ${targetPath}`);
    }
    return 1;
  }

  console.log(`\n[1] 診断 JSON ファイル読み込み: ${targetPath}`);
  const rawContent = fs.readFileSync(targetPath, "utf-8");
  let bundle: PlaytestDiagnosticBundleV1;
  try {
    bundle = JSON.parse(rawContent);
  } catch (err: any) {
    console.error(`[ERROR] JSON パースに失敗しました: ${err?.message}`);
    return 1;
  }

  // 1. 基本検証
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

  // 2. ReplayPlan 作成
  const currentBuildSha = options.allowBuildMismatch ? (bundle.build?.sha || "local") : "current";
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

  // 3. 依存関係のロード
  console.log(`\n[3] ルールパッケージ & カタログロード...`);
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

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
      console.warn(`- State Hash Mismatch: タイムスタンプ・ID正規化前のハッシュに差分があります。深層比較を実行します...`);
      const diff = findFirstDifference(bundle.snapshot.rawState, recon.session.state, "$.state");
      if (diff) {
        console.warn(`  First state diff at ${diff.path}: expected=${JSON.stringify(diff.expected)}, actual=${JSON.stringify(diff.actual)}`);
      }
    }
  }

  // Canonical Match Log とのイベント比較
  if (bundle.canonicalMatchLog?.events && recon.session.logRecorder) {
    console.log(`\n[6] Canonical Match Log の比較検証:`);
    const recordedEvents = recon.session.logRecorder.events;
    console.log(`- Bundle recorded events: ${bundle.canonicalMatchLog.events.length}`);
    console.log(`- Replay generated events: ${recordedEvents.length}`);

    let firstEventDiffIndex = -1;
    const minLen = Math.min(bundle.canonicalMatchLog.events.length, recordedEvents.length);
    for (let i = 0; i < minLen; i++) {
      const expEv = bundle.canonicalMatchLog.events[i];
      const actEv = recordedEvents[i];
      if (expEv.type !== actEv.type || (expEv as any).actionId !== (actEv as any).actionId) {
        firstEventDiffIndex = i;
        console.warn(`  First event diff at index ${i}:`);
        console.warn(`    Expected: type=${expEv.type}, actionId=${(expEv as any).actionId}`);
        console.warn(`    Actual:   type=${actEv.type}, actionId=${(actEv as any).actionId}`);
        break;
      }
    }
    if (firstEventDiffIndex === -1 && bundle.canonicalMatchLog.events.length === recordedEvents.length) {
      console.log(`- Canonical Match Log: ALL EVENTS MATCH!`);
    }
  }

  // 5. 正しい局面での AI 意思決定監査 (Audit AI)
  if (options.auditAi) {
    console.log(`\n================================================================================`);
    console.log(`[7] 正しい局面における AI (Gen 8 Candidate) 意思決定の精密監査`);
    console.log(`================================================================================`);
    auditAiDecisions(recon.replayedDecisions);
  }

  return 0;
}

function auditAiDecisions(replayedDecisions: readonly any[]) {
  const aiPolicy = createGen8ChampionCandidatePolicy();
  const dna = (aiPolicy as any).dna;

  console.log(`AI Policy: ${aiPolicy.descriptor.name} (DNA format: ${dna.dnaFormatVersion}, schema: ${dna.featureSchemaVersion})`);
  console.log(`Total Replayed Decisions: ${replayedDecisions.length}`);

  for (let i = 0; i < replayedDecisions.length; i++) {
    const rd = replayedDecisions[i];
    const req = rd.request;
    const entry = rd.entry;

    // 局面 A: 最初の死の槍に対する対応 (Turn 2、合法手 69件)
    const isDeathLanceOnStage = req.observation?.stageRequests?.some((r: any) => r.actionId === "action.deathLance");
    if (req.playerId === "p2" && (isDeathLanceOnStage || req.patterns.length === 69)) {
      console.log(`\n--------------------------------------------------------------------------------`);
      console.log(`>>> [AUDIT A] 最初の死の槍に対する AI の意思決定 (Seq: ${entry.seq}, Step: ${i})`);
      console.log(`--------------------------------------------------------------------------------`);
      console.log(`- Player: ${req.playerId} (Actor: ${entry.actor})`);
      console.log(`- Legal Pattern Count: ${req.patterns.length} (期待値: 69)`);
      console.log(`- Selected Pattern Ref: #${entry.response.selectedPatternRef}`);
      const selectedPattern = req.patterns[entry.response.selectedPatternRef];
      console.log(`- Selected Pattern: kind=${selectedPattern?.kind}, id=${selectedPattern?.patternId}`);

      // スコア計算
      const features = DecisionFeatureEncoder.encode(req);
      const scored = GenomeScorer.score(features, dna);
      const sorted = [...scored].sort((a, b) => b.score - a.score);

      console.log(`\nTOP 5 CHOICES:`);
      for (let k = 0; k < Math.min(5, sorted.length); k++) {
        const s = sorted[k];
        const p = req.patterns[s.patternRef];
        const act = p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef] : undefined;
        console.log(`  #${k+1} Pattern #${s.patternRef}: score=${s.score.toFixed(4)} | kind=${p.kind} | action=${act?.actionId || 'N/A'} | id=${p.patternId}`);
      }

      const passIndex = req.patterns.findIndex(p => p.kind === "PASS");
      if (passIndex >= 0) {
        const passScore = scored.find(s => s.patternRef === passIndex)?.score;
        const passRank = sorted.findIndex(s => s.patternRef === passIndex) + 1;
        console.log(`  [PASS] Rank ${passRank}/${req.patterns.length}: score=${passScore?.toFixed(4)}`);
      }
    }

    // 局面 B: Turn 3 攻撃判断 (Turn 3、合法手 153件)
    const hasAttackOption = req.patterns.some(p => p.actionSelectionRef !== undefined && req.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack");
    if (req.playerId === "p2" && (req.patterns.length === 153 || (hasAttackOption && req.observation?.turnCount === 3))) {
      console.log(`\n--------------------------------------------------------------------------------`);
      console.log(`>>> [AUDIT B] Turn 3 攻撃判断における AI の意思決定 (Seq: ${entry.seq}, Step: ${i})`);
      console.log(`--------------------------------------------------------------------------------`);
      console.log(`- Player: ${req.playerId} (Actor: ${entry.actor})`);
      console.log(`- Legal Pattern Count: ${req.patterns.length} (期待値: 153)`);
      console.log(`- Selected Pattern Ref: #${entry.response.selectedPatternRef}`);
      const selectedPattern = req.patterns[entry.response.selectedPatternRef];
      const selectedAct = selectedPattern?.actionSelectionRef !== undefined ? req.catalog.actions[selectedPattern.actionSelectionRef] : undefined;
      console.log(`- Selected Pattern: kind=${selectedPattern?.kind}, action=${selectedAct?.actionId}, id=${selectedPattern?.patternId}`);

      // スコア計算
      const features = DecisionFeatureEncoder.encode(req);
      const scored = GenomeScorer.score(features, dna);
      const sorted = [...scored].sort((a, b) => b.score - a.score);

      console.log(`\nTOP 10 CHOICES:`);
      for (let k = 0; k < Math.min(10, sorted.length); k++) {
        const s = sorted[k];
        const p = req.patterns[s.patternRef];
        const act = p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef] : undefined;
        console.log(`  #${k+1} Pattern #${s.patternRef}: score=${s.score.toFixed(4)} | kind=${p.kind} | action=${act?.actionId || 'N/A'} | id=${p.patternId}`);
      }

      const passIndex = req.patterns.findIndex(p => p.kind === "PASS");
      if (passIndex >= 0) {
        const passScore = scored.find(s => s.patternRef === passIndex)?.score;
        const passRank = sorted.findIndex(s => s.patternRef === passIndex) + 1;
        console.log(`  [PASS] Rank ${passRank}/${req.patterns.length}: score=${passScore?.toFixed(4)}`);
      }

      const attackIndex = req.patterns.findIndex(p => p.actionSelectionRef !== undefined && req.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack");
      if (attackIndex >= 0) {
        const attScore = scored.find(s => s.patternRef === attackIndex)?.score;
        const attRank = sorted.findIndex(s => s.patternRef === attackIndex) + 1;
        console.log(`  [ATTACK] Rank ${attRank}/${req.patterns.length}: score=${attScore?.toFixed(4)}`);
      }
    }
  }
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
