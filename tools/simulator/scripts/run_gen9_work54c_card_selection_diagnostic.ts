/**
 * run_gen9_work54c_card_selection_diagnostic.ts
 *
 * BlackPoker Simulator - Gen 9 カード選択品質・特徴量識別能力の診断 (Work 5-4C)
 *
 * 【検証目的】
 * 1. 診断Seed (790001〜790030, 30ペア＝60試合, 座席反転) において、実対戦経路上でAIが遭遇した
 *    すべての DecisionRequest を透過的に収集。
 * 2. 同一 DecisionRequest 内における純粋キーカード選択差分、純粋コスト支払い差分を精密分類。
 * 3. Gen 8, Gen 9 R4 v7.2, G0 IND7 v7.2, G3 IND3 v7.2 の4 Policyによるシャドウ評価を実施し、
 *    特徴量衝突率・スコア同点率・列挙順依存率 (タイブレーク率) を定量的に測定。
 * 4. 兵士召喚 (action.summonSoldier)、Counter系アクション、コスト支払い方法の識別能力とボトルネックを解明。
 * 5. 第三者による再検算が可能な Evidence JSON を排他的に永続化保存。
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { performance } from "perf_hooks";
import { loadRegulationCatalog } from "../src/engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../src/engine/rules/RuleLoader.js";
import { OfficialRegulationMatchSetup } from "../src/engine/regulation/OfficialRegulationMatchSetup.js";
import { GameSession } from "../src/engine/session/GameSession.js";
import { SimulationRunner } from "../src/engine/simulation/SimulationRunner.js";
import { DecisionPolicy, PolicyDescriptor } from "../src/engine/simulation/DecisionPolicy.js";
import { GenomePolicy } from "../src/engine/ai/GenomePolicy.js";
import {
  Gen9LearnableTacticalPolicy,
  TACTICAL_FEATURE_ENCODER_VERSION_V72,
} from "../src/engine/ai/Gen9LearnableTacticalPolicy.js";
import { Gen9TacticalPrototypePolicy } from "../src/engine/ai/Gen9TacticalPrototypePolicy.js";
import {
  G0_IND2_WEIGHTS,
  G0_IND7_WEIGHTS,
  G3_IND3_WEIGHTS,
  R4_PRESET_TACTICAL_WEIGHTS,
  GEN9_TACTICAL_FEATURE_DEFINITIONS,
  BENCHMARK_TACTICAL_WEIGHTS_MAP,
} from "../src/engine/ai/Gen9BenchmarkWeights.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../src/domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../src/domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../src/engine/ai/DecisionDNACodec.js";
import {
  DiagnosticTransparentWrapperPolicy,
  diagnoseDecisionRequest,
  classifyDecisionPatterns,
  computePolicyAggregateMetrics,
  explainScoreDifferenceBetweenPatterns,
  DecisionDiagnosticRecord,
  PolicyAggregateMetrics,
  ObservedMatchDecision,
  ChoiceOrigin,
} from "../src/engine/ai/CardSelectionDiagnosticEngine.js";

// =============================================================================
// 1. 禁止 Seed 範囲の厳格保護 (Holdout・Training・Validation・過去診断 Seed を完全ブロック)
// =============================================================================
export const FORBIDDEN_SEED_RANGES: readonly {
  name: string;
  start: number;
  end: number;
}[] = [
  { name: "Official Holdout v1", start: 95001, end: 95030 },
  { name: "Official Holdout v2", start: 250001, end: 250120 },
  { name: "Future Final Holdout", start: 350001, end: 350300 },
  { name: "Work 5-1 Benchmark Seeds", start: 500001, end: 500030 },
  { name: "Work 5-1 R2/R3 Validation Seeds", start: 600001, end: 600030 },
  { name: "Work 5-2 Baseline Seeds", start: 700001, end: 700050 },
  { name: "Work 5-2 R1 Training Seeds", start: 710001, end: 710400 },
  { name: "Work 5-2 R1 Validation Seeds", start: 720001, end: 720050 },
  { name: "Work 5-2 R2 Training Seeds", start: 730001, end: 730400 },
  { name: "Work 5-2 R2 Selection Arena Seeds", start: 740001, end: 740100 },
  { name: "Work 5-2 R2 Final Comparison Seeds", start: 750001, end: 750100 },
  { name: "Work 5-3 Diagnostic Seeds", start: 760001, end: 760030 },
  { name: "Work 5-4A Diagnostic Seeds", start: 770001, end: 770030 },
  { name: "Work 5-4B Diagnostic Seeds", start: 780001, end: 780030 },
  { name: "Original Human Diagnostic Seed", start: 4127992094, end: 4127992094 },
];

export const WORK54C_DIAGNOSTIC_SEEDS: readonly number[] = Object.freeze(
  Array.from({ length: 30 }, (_, i) => 790001 + i)
);

export function assertSafeDiagnosticSeedRange(start: number, count: number): void {
  const end = start + count - 1;
  for (const forbidden of FORBIDDEN_SEED_RANGES) {
    const overlaps =
      Math.max(start, forbidden.start) <= Math.min(end, forbidden.end);
    if (overlaps) {
      throw new Error(
        `[SEED_VIOLATION] 診断Seed (${start}..${end}) が禁止領域 ${forbidden.name} (${forbidden.start}..${forbidden.end}) と重複しています`
      );
    }
  }
}

// =============================================================================
// 2. コミット状態・クリーン作業ツリー検証
// =============================================================================
export function assertCleanCommitState(
  rootDir: string,
  options?: { allowDirtyForTesting?: boolean }
): { gitSha: string; commitTimeIso: string; repoRoot: string } {
  let repoRoot = rootDir;
  try {
    repoRoot = execSync("git rev-parse --show-toplevel", { cwd: rootDir, encoding: "utf8" }).trim();
  } catch {
    repoRoot = rootDir;
  }

  let gitSha: string;
  try {
    gitSha = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
    if (!gitSha || !/^[0-9a-f]{40}$/i.test(gitSha)) {
      throw new Error(`無効な Git SHA 形式: "${gitSha}"`);
    }
  } catch (err: any) {
    throw new Error(`[FATAL] Git SHA の取得に失敗しました: ${err.message || err}`);
  }

  if (!options?.allowDirtyForTesting) {
    const statusOutput = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" }).trim();
    if (statusOutput.length > 0) {
      const dirtyLines = statusOutput
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (dirtyLines.length > 0) {
        throw new Error(
          `[DIRTY_WORKTREE_ERROR] 作業ツリーに未コミットの変更が存在するため診断を開始できません:\n` +
            dirtyLines.map((l) => `  ${l}`).join("\n") +
            `\n必ず先にコミット・プッシュを完了し、クリーンな作業ツリーで実行してください。`
        );
      }
    }
  }

  const commitTimeIso = execSync("git log -1 --format=%cI HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();

  return { gitSha, commitTimeIso, repoRoot };
}

// =============================================================================
// 3. メイン診断実行処理 (Work 5-4C R2)
// =============================================================================
export async function main() {
  const tStart = performance.now();
  console.log("================================================================================");
  console.log("  BlackPoker Gen 9 Work 5-4C R3.1: 実選択の対応付け・集計分離・最終整合性修正");
  console.log("================================================================================");

  const rootDir = process.cwd();

  // 1. Seed 検証
  assertSafeDiagnosticSeedRange(790001, 30);
  console.log(`[SEED_VERIFIED] 診断Seed: 790001〜790030 (30ペア＝60試合) 重複なし確認済`);

  // 2. コミット・クリーン状態検証
  const { gitSha, commitTimeIso, repoRoot } = assertCleanCommitState(rootDir);
  console.log(`[GIT_COMMIT_VERIFIED] HEAD Commit: ${gitSha} (CommitTime: ${commitTimeIso})`);
  console.log(`[WORKTREE_VERIFIED] 作業ツリーは完全にクリーンです`);

  // 0-1. 既存 Work 5-4C 初版 Evidence の完全保護検証 (SHA-256 不変性アサーション)
  let originalEvidencePath = path.resolve(
    rootDir,
    "evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-46735ba3d704.json"
  );
  if (!fs.existsSync(originalEvidencePath)) {
    originalEvidencePath = path.resolve(
      repoRoot,
      "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-46735ba3d704.json"
    );
  }
  if (!fs.existsSync(originalEvidencePath)) {
    throw new Error(`[PROTECTION_ERROR] 既存 初版 Evidence JSON が見つかりません: ${originalEvidencePath}`);
  }
  const originalBuf = fs.readFileSync(originalEvidencePath);
  const originalSha256 = crypto.createHash("sha256").update(originalBuf).digest("hex").toLowerCase();
  const EXPECTED_ORIGINAL_SHA256 = "53f9c9b82c136a8026df79e9fbba8196435db7ac3520b186529308565939dcd6";
  if (originalSha256 !== EXPECTED_ORIGINAL_SHA256) {
    throw new Error(
      `[PROTECTION_VIOLATION] 既存 初版 Evidence JSON の改変を検知しました: 期待値=${EXPECTED_ORIGINAL_SHA256}, 実際=${originalSha256}`
    );
  }
  console.log(`[EVIDENCE_PROTECTED] 既存 初版 Evidence SHA-256 検証成功: ${originalSha256}`);

  // 0-2. 既存 Work 5-4C R2 Evidence の完全保護検証 (SHA-256 不変性アサーション)
  let r2EvidencePath = path.resolve(
    rootDir,
    "evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r2-d78652a6ab98.json"
  );
  if (!fs.existsSync(r2EvidencePath)) {
    r2EvidencePath = path.resolve(
      repoRoot,
      "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r2-d78652a6ab98.json"
    );
  }
  if (!fs.existsSync(r2EvidencePath)) {
    throw new Error(`[PROTECTION_ERROR] 既存 R2 Evidence JSON が見つかりません: ${r2EvidencePath}`);
  }
  const r2Buf = fs.readFileSync(r2EvidencePath);
  const r2Sha256 = crypto.createHash("sha256").update(r2Buf).digest("hex").toLowerCase();
  const EXPECTED_R2_SHA256 = "6e94b81fcb18c780257ccc7104bf2f1ca4419b82d5a382e51664ee4497f4c49f";
  if (r2Sha256 !== EXPECTED_R2_SHA256) {
    throw new Error(
      `[PROTECTION_VIOLATION] 既存 R2 Evidence JSON の改変を検知しました: 期待値=${EXPECTED_R2_SHA256}, 実際=${r2Sha256}`
    );
  }
  console.log(`[EVIDENCE_PROTECTED] 既存 R2 Evidence SHA-256 検証成功: ${r2Sha256}`);

  // 0-3. 既存 Work 5-4C R3 Evidence の完全保護検証 (SHA-256 不変性アサーション)
  let r3EvidencePath = path.resolve(
    rootDir,
    "evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r3-f986ed049a20.json"
  );
  if (!fs.existsSync(r3EvidencePath)) {
    r3EvidencePath = path.resolve(
      repoRoot,
      "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r3-f986ed049a20.json"
    );
  }
  if (!fs.existsSync(r3EvidencePath)) {
    throw new Error(`[PROTECTION_ERROR] 既存 R3 Evidence JSON が見つかりません: ${r3EvidencePath}`);
  }
  const r3Buf = fs.readFileSync(r3EvidencePath);
  const r3Sha256 = crypto.createHash("sha256").update(r3Buf).digest("hex").toLowerCase();
  const EXPECTED_R3_SHA256 = "24a5158c9cdd7041fd47dc5c31c823c53882dcc29804bc86603fe807896b24a0";
  if (r3Sha256 !== EXPECTED_R3_SHA256) {
    throw new Error(
      `[PROTECTION_VIOLATION] 既存 R3 Evidence JSON の改変を検知しました: 期待値=${EXPECTED_R3_SHA256}, 実際=${r3Sha256}`
    );
  }
  console.log(`[EVIDENCE_PROTECTED] 既存 R3 Evidence SHA-256 検証成功: ${r3Sha256}`);

  // 3. ルールおよびレギュレーションのロード
  const rulesDir = path.resolve(rootDir, "src/data/rules-vnext");
  const regulationsDir = path.resolve(rootDir, "src/data/regulations");
  const catalog = await loadRegulationCatalog(regulationsDir);
  const rulePackage = await loadRulePackageFromDirectory(rulesDir);

  const regulationLookupKey = "standard-pack";
  const frameLookupKey = "pack";
  const reg = catalog.regulations.get(regulationLookupKey);
  if (!reg) throw new Error(`[REGULATION_NOT_FOUND] ${regulationLookupKey} が見つかりません`);
  const frame = catalog.frames.get(frameLookupKey);
  if (!frame) throw new Error(`[FRAME_NOT_FOUND] ${frameLookupKey} が見つかりません`);

  const tacticalEvaluator = new GenericTacticalEvaluator(rulePackage);
  Gen9TacticalPrototypePolicy.setDefaultEvaluator(tacticalEvaluator);

  // 4. DNA ロード
  const gen8Candidate = createGen8ChampionCandidatePolicy();
  const gen8DNA: DecisionDNA = DecisionDNACodec.clone((gen8Candidate as any).dna);

  // 5. 評価対象 4 Policy の初期化 (正本確定重み使用)
  const policyGen8 = new GenomePolicy(gen8DNA, "Gen8_Champion");
  const policyR4 = new Gen9TacticalPrototypePolicy(
    gen8DNA,
    "Gen9_R4_v7.2",
    tacticalEvaluator,
    TACTICAL_FEATURE_ENCODER_VERSION_V72
  );
  const policyG0Ind7 = new Gen9LearnableTacticalPolicy(
    { baseDNA: gen8DNA, tacticalWeights: G0_IND7_WEIGHTS, tacticalSchemaVersion: 7 },
    "Gen9_G0_IND7_v7.2",
    tacticalEvaluator,
    TACTICAL_FEATURE_ENCODER_VERSION_V72
  );
  const policyG3Ind3 = new Gen9LearnableTacticalPolicy(
    { baseDNA: gen8DNA, tacticalWeights: G3_IND3_WEIGHTS, tacticalSchemaVersion: 7 },
    "Gen9_G3_IND3_v7.2",
    tacticalEvaluator,
    TACTICAL_FEATURE_ENCODER_VERSION_V72
  );

  const policiesForShadow: Record<string, DecisionPolicy> = {
    Gen8: policyGen8,
    R4_v72: policyR4,
    G0_IND7_v72: policyG0Ind7,
    G3_IND3_v72: policyG3Ind3,
  };

  // 6. 実対戦経路上での観測 (R4 vs Gen 8, 30ペア ＝ 60試合, 座席反転)
  console.log("\n[SIMULATION] 実対戦経路 (R4 v7.2 vs Gen 8) のシミュレーション実行中...");

  let currentMatchSeed = 0;
  let currentMatchLeg: "FORWARD" | "REVERSE" = "FORWARD";
  let currentDecisionOrdinal = 0;
  const seenObservationIds = new Set<string>();
  const varianceObservedDecisions: ObservedMatchDecision[] = [];
  let totalDecisionsCollected = 0;

  const onDecisionObserved = (
    req: Readonly<DecisionRequest>,
    res: Readonly<DecisionResponse>,
    policyName: string
  ) => {
    currentDecisionOrdinal++;
    const ordinal = currentDecisionOrdinal;
    const actingPlayerId = req.playerId;
    const observationId = `${currentMatchSeed}_${currentMatchLeg}_${ordinal}_${actingPlayerId}_${req.decisionId}`;

    // 実行時整合性検証
    if (res.decisionId !== req.decisionId) {
      throw new Error(`[RESPONSE_MISMATCH] response.decisionId !== req.decisionId: ${res.decisionId} vs ${req.decisionId}`);
    }
    if (res.stateVersion !== req.stateVersion) {
      throw new Error(`[RESPONSE_MISMATCH] response.stateVersion !== req.stateVersion: ${res.stateVersion} vs ${req.stateVersion}`);
    }
    if (res.selectedPatternRef < 0 || res.selectedPatternRef >= req.patterns.length) {
      throw new Error(`[OUT_OF_RANGE_PATTERN_REF] selectedPatternRef out of range: ${res.selectedPatternRef} (patterns.length=${req.patterns.length})`);
    }
    if (seenObservationIds.has(observationId)) {
      throw new Error(`[DUPLICATE_OBSERVATION_ID] 重複した observationId を検知: ${observationId}`);
    }
    seenObservationIds.add(observationId);

    const obsRecord: ObservedMatchDecision = {
      observationId,
      matchSeed: currentMatchSeed,
      matchLeg: currentMatchLeg,
      decisionOrdinal: ordinal,
      actingPlayerId,
      policyName,
      request: req,
      response: res,
    };

    totalDecisionsCollected++;

    // 軽量判定: カード選択またはコスト選択の差分がある局面のみ収集
    const { pureKeyCardGroups, pureCostGroups } = classifyDecisionPatterns(req);
    if (pureKeyCardGroups.length > 0 || pureCostGroups.length > 0) {
      varianceObservedDecisions.push(obsRecord);
    }
  };

  const wrapperR4 = new DiagnosticTransparentWrapperPolicy(policyR4, {
    onDecision: (req, res) => onDecisionObserved(req, res, "R4_v72"),
  });
  const wrapperGen8 = new DiagnosticTransparentWrapperPolicy(policyGen8, {
    onDecision: (req, res) => onDecisionObserved(req, res, "Gen8"),
  });

  let matchCounter = 0;
  let winsR4 = 0;
  let winsGen8 = 0;
  let draws = 0;

  for (const seed of WORK54C_DIAGNOSTIC_SEEDS) {
    currentMatchSeed = seed;

    // 正順: P1=R4, P2=Gen8
    currentMatchLeg = "FORWARD";
    currentDecisionOrdinal = 0;
    const setup1 = OfficialRegulationMatchSetup.setupMatch(
      reg,
      frame,
      rulePackage,
      seed,
      {
        playerNames: { p1: policyR4.descriptor.name, p2: policyGen8.descriptor.name },
      }
    );
    const session1 = new GameSession((setup1 as any).state, rulePackage, {
      matchSeed: seed,
    });
    const res1 = SimulationRunner.run(
      session1,
      { p1: wrapperR4, p2: wrapperGen8 },
      { maxDecisions: 1000 }
    );
    matchCounter++;
    if (res1.winner === "p1") winsR4++;
    else if (res1.winner === "p2") winsGen8++;
    else if (res1.winner === "draw") draws++;

    // 逆順: P1=Gen8, P2=R4
    currentMatchLeg = "REVERSE";
    currentDecisionOrdinal = 0;
    const setup2 = OfficialRegulationMatchSetup.setupMatch(
      reg,
      frame,
      rulePackage,
      seed,
      {
        playerNames: { p1: policyGen8.descriptor.name, p2: policyR4.descriptor.name },
      }
    );
    const session2 = new GameSession((setup2 as any).state, rulePackage, {
      matchSeed: seed,
    });
    const res2 = SimulationRunner.run(
      session2,
      { p1: wrapperGen8, p2: wrapperR4 },
      { maxDecisions: 1000 }
    );
    matchCounter++;
    if (res2.winner === "p2") winsR4++;
    else if (res2.winner === "p1") winsGen8++;
    else if (res2.winner === "draw") draws++;
  }

  console.log(`[SIMULATION_COMPLETE] 全 60 試合完了: R4=${winsR4}勝, Gen8=${winsGen8}勝, 引分=${draws}`);
  console.log(`[DECISIONS_COLLECTED] R4観測判断数: ${wrapperR4.totalDecisionsObserved}, Gen8観測判断数: ${wrapperGen8.totalDecisionsObserved}`);
  console.log(`[UNIQUE_DECISIONS] 遭遇ユニーク観測総数: ${seenObservationIds.size}`);
  console.log(`[VARIANCE_DECISIONS] 差分あり診断対象判断数: ${varianceObservedDecisions.length}`);

  // 7. 差分が存在する DecisionRequest に対してのみ精密診断 (シャドウ評価) を実行
  console.log("\n[DIAGNOSTIC] 差分あり判断に対するカード選択・コスト支払い精密診断中...");

  const diagnosticRecords: DecisionDiagnosticRecord[] = [];
  let totalWithKeyCardVariance = 0;
  let totalWithCostVariance = 0;
  let totalSummonSoldierVariance = 0;
  let totalCounterVariance = 0;

  for (const obs of varianceObservedDecisions) {
    const rec = diagnoseDecisionRequest(obs.request, policiesForShadow, obs);
    if (!rec) continue;

    diagnosticRecords.push(rec);
    if (rec.hasKeyCardVariance) totalWithKeyCardVariance++;
    if (rec.hasCostVariance) totalWithCostVariance++;
    if (rec.hasSummonSoldierVariance) totalSummonSoldierVariance++;
    if (rec.hasCounterVariance) totalCounterVariance++;
  }

  console.log(`[VARIANCE_SUMMARY] カード選択肢差分あり判断数: ${totalWithKeyCardVariance}`);
  console.log(`[VARIANCE_SUMMARY] コスト選択肢差分あり判断数: ${totalWithCostVariance}`);
  console.log(`[VARIANCE_SUMMARY] 兵士召喚カード差分あり判断数: ${totalSummonSoldierVariance}`);
  console.log(`[VARIANCE_SUMMARY] Counterカード差分あり判断数: ${totalCounterVariance}`);
  console.log(`[DIAGNOSTIC_RECORDS] 診断完了レコード総数: ${diagnosticRecords.length}`);

  // 8. 4 Policy の集計指標算出
  const aggregateMetrics: Record<string, PolicyAggregateMetrics> = {};
  for (const pName of Object.keys(policiesForShadow)) {
    aggregateMetrics[pName] = computePolicyAggregateMetrics(pName, diagnosticRecords);
  }

  // 9. 代表事例の抽出とスコア寄与度分解 (修正A・修正B・修正D・修正E)
  console.log("\n[EXPLANATION] 代表事例 (兵士召喚、Counter、コスト支払い) のスコア寄与度分解中...");

  const explainRepresentativeGroup = (
    reqRecord: DecisionDiagnosticRecord,
    group: { patternRefs: readonly number[] }
  ) => {
    if (group.patternRefs.length < 2) return undefined;
    const refA = group.patternRefs[0];
    const refB = group.patternRefs[1];

    // 修正D: observationId による元観測レコードの直接紐付け (全探索・曖昧検索の完全排除)
    const obs = varianceObservedDecisions.find((o) => o.observationId === reqRecord.observationId);
    if (!obs) {
      throw new Error(`[OBSERVATION_NOT_FOUND] observationId=${reqRecord.observationId} が見つかりません`);
    }
    const origReq = obs.request;

    const explanation = explainScoreDifferenceBetweenPatterns(origReq, gen8DNA, refA, refB);

    // 数理的一致性のアサーション
    if (!explanation.isMathematicallyConsistent) {
      throw new Error(
        `[MATH_ASSERTION_FAILED] 代表事例の数理的不整合: scoreDiff=${explanation.scoreDiff}, sumContribDiff=${explanation.sumContributionDiff}`
      );
    }

    const actualChosenPatternRef = obs.response.selectedPatternRef;
    const actualChosenPattern = origReq.patterns[actualChosenPatternRef];
    const actualChosenAction =
      actualChosenPattern?.actionSelectionRef !== undefined
        ? origReq.catalog.actions[actualChosenPattern.actionSelectionRef]?.actionId
        : undefined;
    const actualChosenKeyCards =
      actualChosenPattern?.keyCardSelectionRef !== undefined
        ? origReq.catalog.cardSelections[actualChosenPattern.keyCardSelectionRef]?.cardIds ?? []
        : [];

    return {
      candidateRefA: refA,
      candidateRefB: refB,
      explanation,
      actualMatchChoiceDetails: {
        observationId: obs.observationId,
        actingPolicyName: obs.policyName,
        selectedPatternRef: actualChosenPatternRef,
        selectedActionId: actualChosenAction,
        selectedKeyCardIds: actualChosenKeyCards,
        isGroupCandidateSelected: group.patternRefs.includes(actualChosenPatternRef),
        higherScoreCandidate: explanation.scoreB > explanation.scoreA ? "B" : "A",
      },
    };
  };

  const sampleSummon = diagnosticRecords.find((r) => r.hasSummonSoldierVariance && (r.summonSoldierDetails?.groups.length ?? 0) > 0);
  const sampleCounter = diagnosticRecords.find((r) => r.hasCounterVariance && (r.counterDetails?.groups.length ?? 0) > 0);
  const sampleCost = diagnosticRecords.find((r) => r.hasCostVariance && (r.costPaymentDetails?.groups.length ?? 0) > 0);

  const representativeExamplesWithExplanation = {
    summonSoldier: sampleSummon
      ? {
          record: sampleSummon,
          contributionAnalysis: sampleSummon.summonSoldierDetails?.groups[0]
            ? explainRepresentativeGroup(sampleSummon, sampleSummon.summonSoldierDetails.groups[0])
            : undefined,
        }
      : undefined,
    counter: sampleCounter
      ? {
          record: sampleCounter,
          contributionAnalysis: sampleCounter.counterDetails?.groups[0]
            ? explainRepresentativeGroup(sampleCounter, sampleCounter.counterDetails.groups[0])
            : undefined,
        }
      : undefined,
    costPayment: sampleCost
      ? {
          record: sampleCost,
          contributionAnalysis: sampleCost.costPaymentDetails?.groups[0]
            ? explainRepresentativeGroup(sampleCost, sampleCost.costPaymentDetails.groups[0])
            : undefined,
        }
      : undefined,
  };

  const elapsedSec = Number(((performance.now() - tStart) / 1000).toFixed(2));

  // 10. Evidence JSON オブジェクトの構築 (Work 5-4C R3.1)
  const evidenceReport = {
    workId: "BP-SIM-AI-GEN9-WORK54C-ACTUAL-CHOICE-INTEGRITY-R31",
    schemaVersion: "3.1.0",
    generatedAt: new Date().toISOString(),
    executionEnvironment: {
      gitCommitSha: gitSha,
      commitTimeIso,
      workingTreeClean: true,
      rulePackageId: rulePackage.id,
      rulePackageVersion: rulePackage.version,
      regulationLookupKey,
      regulationId: reg.id,
      frameLookupKey,
      frameId: frame.id,
      tacticalEncoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V72,
    },
    diagnosticConditions: {
      seedRange: { start: 790001, end: 790030, pairs: 30, totalMatches: 60 },
      matchup: "R4_v7.2 vs Gen8 (Seat-Swapped)",
      matchResults: { winsR4, winsGen8, draws, total: 60 },
    },
    sampleCounts: {
      totalDecisionsCollected,
      r4DecisionsCount: wrapperR4.totalDecisionsObserved,
      gen8DecisionsCount: wrapperGen8.totalDecisionsObserved,
      decisionsWithAnyVariance: diagnosticRecords.length,
      decisionsWithKeyCardVariance: totalWithKeyCardVariance,
      decisionsWithCostVariance: totalWithCostVariance,
      decisionsWithSummonSoldierVariance: totalSummonSoldierVariance,
      decisionsWithCounterVariance: totalCounterVariance,
    },
    aggregateMetrics,
    representativeExamples: {
      summonSoldier: sampleSummon ? [sampleSummon] : [],
      counter: sampleCounter ? [sampleCounter] : [],
      costPayment: sampleCost ? [sampleCost] : [],
    },
    representativeExamplesWithExplanation,
    executionDurationSeconds: elapsedSec,
  };

  // 11. Evidence JSON の排他的永続化保存 (R3.1ファイル名)
  const shortSha = gitSha.substring(0, 12);
  let evidenceDir = path.resolve(rootDir, "evidence/gen9-work5-4c");
  if (!fs.existsSync(evidenceDir)) {
    evidenceDir = path.resolve(repoRoot, "tools/simulator/evidence/gen9-work5-4c");
  }
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  const evidenceFileName = `gen9-work5-4c-card-selection-diagnostic-r31-${shortSha}.json`;
  const evidenceFilePath = path.join(evidenceDir, evidenceFileName);

  const jsonStr = JSON.stringify(evidenceReport, null, 2);
  fs.writeFileSync(evidenceFilePath, jsonStr, { encoding: "utf8", flag: "wx" });

  const evidenceSha256 = crypto.createHash("sha256").update(Buffer.from(jsonStr)).digest("hex").toLowerCase();
  console.log(`\n[EVIDENCE_SAVED] Evidence JSON: ${evidenceFilePath}`);
  console.log(`[EVIDENCE_SHA256] SHA-256: ${evidenceSha256}`);
  console.log(`[DURATION] 所要時間: ${elapsedSec} 秒`);

  // 集計指標のコンソール表示 (R3.1 実選択とシャドウ評価の分離表示)
  console.log("\n================================================================================");
  console.log("  診断結果サマリー (R3.1 実選択・シャドウ評価の分離集計結果)");
  console.log("================================================================================");
  for (const [pName, m] of Object.entries(aggregateMetrics)) {
    console.log(`\n--- ${pName} ---`);
    if (m.actualMatch) {
      console.log(`[実対戦選択 (Actual Match Choice)] 当事者判断数: ${m.actualMatch.decisionsCount} 件`);
      if (m.actualMatch.decisionsCount > 0) {
        console.log(`  - キーカード: 選択グループ数=${m.actualMatch.keyCard.chosenGroupCount}/${m.actualMatch.keyCard.evaluatedGroupsCount} (${(m.actualMatch.keyCard.chosenGroupRate * 100).toFixed(1)}%), タイブレーク数=${m.actualMatch.keyCard.chosenTieBreakCount}/${m.actualMatch.keyCard.chosenGroupCount} (${(m.actualMatch.keyCard.chosenTieBreakRate * 100).toFixed(1)}%)`);
        console.log(`  - コスト支払い: 選択グループ数=${m.actualMatch.cost.chosenGroupCount}/${m.actualMatch.cost.evaluatedGroupsCount} (${(m.actualMatch.cost.chosenGroupRate * 100).toFixed(1)}%), タイブレーク数=${m.actualMatch.cost.chosenTieBreakCount}/${m.actualMatch.cost.chosenGroupCount} (${(m.actualMatch.cost.chosenTieBreakRate * 100).toFixed(1)}%)`);
      } else {
        console.log(`  - 実対戦非参加個体のため、実対戦サンプル数は 0 件 (0/0) です。`);
      }
    }

    if (m.shadowEvaluation) {
      const sk = m.shadowEvaluation.keyCard;
      const sc = m.shadowEvaluation.cost;
      console.log(`[シャドウ評価 (Shadow Evaluation)] 全 ${m.shadowEvaluation.decisionsCount} 局面`);
      console.log(`  - キーカード: グループ数=${sk.evaluatedGroupsCount}, 最高同点率(Exact)=${(sk.topTieExactRate * 100).toFixed(1)}% (${sk.topTieExactCount}/${sk.evaluatedGroupsCount}), 全同点率=${(sk.allTiedExactRate * 100).toFixed(1)}%, 完全衝突率=${sk.pairCompleteCollisionRate !== undefined ? `${(sk.pairCompleteCollisionRate * 100).toFixed(1)}%` : "N/A"}`);
      console.log(`  - コスト支払い: グループ数=${sc.evaluatedGroupsCount}, 最高同点率(Exact)=${(sc.topTieExactRate * 100).toFixed(1)}% (${sc.topTieExactCount}/${sc.evaluatedGroupsCount}), 全同点率=${(sc.allTiedExactRate * 100).toFixed(1)}%, 完全衝突率=${sc.pairCompleteCollisionRate !== undefined ? `${(sc.pairCompleteCollisionRate * 100).toFixed(1)}%` : "N/A"}`);
    }
  }

  return { evidenceFilePath, evidenceSha256, aggregateMetrics, elapsedSec };
}

if (process.argv[1] && process.argv[1].endsWith("run_gen9_work54c_card_selection_diagnostic.ts")) {
  main().catch((err) => {
    console.error("[FATAL_ERROR]", err);
    process.exit(1);
  });
}
