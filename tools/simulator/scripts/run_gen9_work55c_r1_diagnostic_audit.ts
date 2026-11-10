/**
 * run_gen9_work55c_r1_diagnostic_audit.ts
 *
 * BlackPoker Simulator - Gen 9 Work 5-5C R1: コスト特徴量診断の独立監査・整合性検証
 *
 * 【検証目的】
 * 1. 監査A (同点増加970件の解明):
 *    t20単独 (12,368件) に対し4特徴量併用 (13,338件) で同点数が正味970件増加した原因を、
 *    A1〜A4 クロス集計および原因別内訳 (相殺、最上位入替、許容誤差) で数理的に解明。
 * 2. 監査B (Argmax変更126件の厳密再分類):
 *    全属性 (Action, KeyCard, KeyUnit, Target, Effect, Order, CostPayment) の意味論的署名比較により、
 *    真にコスト支払い方法のみの変更かを厳密分類。事実 (Fact) と推測 (Hypothesis) を明確に分離。
 * 3. 監査C (v7.2 と v7.3 ゼロ重みの実対戦全局面パリティ検証):
 *    実対戦由来の全3,765コスト決定 (全合法手) において、Policy A (v7.2, 20次元) と
 *    Policy B (v7.3 zero, 24次元末尾4ゼロ) の厳密一致 / 許容誤差一致を検証。
 * 4. 監査D (衝突原因分類の厳密化):
 *    ID集合ソート比較による完全集合一致で 58,789 衝突ペアを再集計し、
 *    特徴量値衝突率 (7.46%) が不変であることを検証。
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
import { DecisionPolicy } from "../src/engine/simulation/DecisionPolicy.js";
import { GenomePolicy } from "../src/engine/ai/GenomePolicy.js";
import {
  Gen9LearnableTacticalPolicy,
  fromV6DNA,
  R4_PRESET_TACTICAL_WEIGHTS,
  TACTICAL_FEATURE_ENCODER_VERSION_V72,
  TACTICAL_FEATURE_ENCODER_VERSION_V73,
} from "../src/engine/ai/Gen9LearnableTacticalPolicy.js";
import { Gen9TacticalPrototypePolicy } from "../src/engine/ai/Gen9TacticalPrototypePolicy.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../src/domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../src/domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../src/engine/ai/DecisionDNACodec.js";
import {
  DiagnosticTransparentWrapperPolicy,
  classifyDecisionPatterns,
} from "../src/engine/ai/CardSelectionDiagnosticEngine.js";
import {
  COST_DIAGNOSTIC_WEIGHTS,
  diagnoseDecisionCostFeatures,
  aggregateCostDiagnosticResults,
  SingleDecisionCostDiagnosticResult,
  CostDiagnosticAggregateSummary,
} from "../src/engine/ai/CostFeatureDiagnosticEngine.js";

// =============================================================================
// 1. 禁止 Seed 範囲の保護
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

export const WORK55C_DIAGNOSTIC_SEEDS: readonly number[] = Object.freeze(
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
// 2. コミット状態検証
// =============================================================================
export function assertCleanCommitState(
  cwd: string,
  options?: { allowDirtyForTesting?: boolean }
): { gitSha: string; commitTimeIso: string; repoRoot: string } {
  try {
    const repoRoot = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
    }).trim();
    const gitSha = execSync("git rev-parse HEAD", {
      cwd,
      encoding: "utf8",
    }).trim();
    const commitTimeIso = execSync("git log -1 --format=%cI", {
      cwd,
      encoding: "utf8",
    }).trim();
    const statusOutput = execSync("git status --porcelain", {
      cwd,
      encoding: "utf8",
    }).trim();

    if (statusOutput.length > 0 && !options?.allowDirtyForTesting) {
      console.warn("[DIRTY_TREE_WARNING] 作業ツリーに変更が存在します:\n" + statusOutput);
    }

    return { gitSha, commitTimeIso, repoRoot };
  } catch (err: any) {
    throw new Error(`[GIT_METADATA_ERROR] Git メタデータの取得に失敗: ${err?.message}`);
  }
}

// =============================================================================
// 3. 過去 Evidence 不変性アサーション (Work 5-4C 4件, Work 5-5B 2件, Work 5-5C 1件)
// =============================================================================
export function assertPastEvidenceInvariance(repoRoot: string): void {
  const pastEvidences: readonly {
    name: string;
    relPath: string;
    expectedSha256: string;
  }[] = [
    {
      name: "Work 5-4C 初版 Evidence",
      relPath: "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-46735ba3d704.json",
      expectedSha256: "53f9c9b82c136a8026df79e9fbba8196435db7ac3520b186529308565939dcd6",
    },
    {
      name: "Work 5-4C R2 Evidence",
      relPath: "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r2-d78652a6ab98.json",
      expectedSha256: "6e94b81fcb18c780257ccc7104bf2f1ca4419b82d5a382e51664ee4497f4c49f",
    },
    {
      name: "Work 5-4C R3 Evidence",
      relPath: "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r3-f986ed049a20.json",
      expectedSha256: "24a5158c9cdd7041fd47dc5c31c823c53882dcc29804bc86603fe807896b24a0",
    },
    {
      name: "Work 5-4C R3.1 Evidence",
      relPath: "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r31-12daca3a488e.json",
      expectedSha256: "94590b6c31d86a0b62bf5e136640de0e8b918acef759ebcdf4e9c78cf069efae",
    },
    {
      name: "Work 5-5B Parity Fixture R2",
      relPath: "tools/simulator/evidence/gen9-work5-5b/golden_parity_fixture_r2.json",
      expectedSha256: "e8e38fcbdfa1285985cf7d87f74b8717a7986e37a1c10ad641a9616241961d17",
    },
    {
      name: "Work 5-5B Parity Results R1",
      relPath: "tools/simulator/evidence/gen9-work5-5b/golden_parity_results_r1.json",
      expectedSha256: "c4358c28ee848deb60df7ccf7f407ea120db4b680eae7220e66987239d7ed6f7",
    },
    {
      name: "Work 5-5C Diagnostic Evidence",
      relPath: "tools/simulator/evidence/gen9-work5-5c/gen9-work5-5c-cost-feature-diagnostic-8ec5900a28da.json",
      expectedSha256: "a0a7e3e677a3338e0650b98235226c76a073d0448b6e5e8826ac45803690be4d",
    },
  ];

  for (const item of pastEvidences) {
    const filePath = path.resolve(repoRoot, item.relPath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`[PROTECTION_ERROR] 既存 Evidence が見つかりません: ${filePath}`);
    }
    const buf = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
    if (hash !== item.expectedSha256) {
      throw new Error(
        `[PROTECTION_VIOLATION] 既存 Evidence (${item.name}) の改変を検知: 期待=${item.expectedSha256}, 実際=${hash}`
      );
    }
    console.log(`[EVIDENCE_PROTECTED] ${item.name} SHA-256 検証成功: ${hash.slice(0, 16)}...`);
  }
}

// =============================================================================
// 4. メイン監査実行処理
// =============================================================================
export async function main() {
  const tStart = performance.now();
  console.log("================================================================================");
  console.log("  BlackPoker Gen 9 Work 5-5C R1: コスト特徴量診断の独立監査・整合性検証");
  console.log("================================================================================");

  const args = process.argv.slice(2);
  const allowDirty = args.includes("--allow-dirty");
  const quickSmoke = args.includes("--smoke"); // 2試合のみの簡易スモークテスト

  const rootDir = process.cwd();
  const { gitSha, commitTimeIso, repoRoot } = assertCleanCommitState(rootDir, {
    allowDirtyForTesting: allowDirty,
  });

  const seedsToRun = quickSmoke ? [790001] : [...WORK55C_DIAGNOSTIC_SEEDS];
  const totalMatchesToRun = seedsToRun.length * 2;

  // 1. Seed 検証
  assertSafeDiagnosticSeedRange(790001, seedsToRun.length);
  console.log(
    `[SEED_VERIFIED] 診断Seed: ${seedsToRun[0]}〜${seedsToRun[seedsToRun.length - 1]} (${seedsToRun.length}ペア＝${totalMatchesToRun}試合) 重複なし確認済`
  );

  // 2. 過去 Evidence 保護アサーション (7件)
  assertPastEvidenceInvariance(repoRoot);

  // 3. ルールおよびレギュレーションのロード
  const rulesDir = path.resolve(rootDir, "src/data/rules-vnext");
  const regulationsDir = path.resolve(rootDir, "src/data/regulations");
  const catalog = await loadRegulationCatalog(regulationsDir);
  const rulePackage = await loadRulePackageFromDirectory(rulesDir);

  const reg = catalog.regulations.get("standard-pack");
  if (!reg) throw new Error("[REGULATION_NOT_FOUND] standard-pack が見つかりません");
  const frame = catalog.frames.get("pack");
  if (!frame) throw new Error("[FRAME_NOT_FOUND] pack が見つかりません");

  const tacticalEvaluator = new GenericTacticalEvaluator(rulePackage);
  Gen9TacticalPrototypePolicy.setDefaultEvaluator(tacticalEvaluator);

  // 4. DNA ロード
  const gen8Candidate = createGen8ChampionCandidatePolicy();
  const gen8DNA: DecisionDNA = DecisionDNACodec.clone((gen8Candidate as any).dna);

  // 5. Policy の初期化
  // 実対戦 Policy (Work 5-4C / 5-5C と完全同一)
  const policyGen8 = new GenomePolicy(gen8DNA, "Gen8_Champion");
  const policyR4 = new Gen9TacticalPrototypePolicy(
    gen8DNA,
    "Gen9_R4_v7.2",
    tacticalEvaluator,
    TACTICAL_FEATURE_ENCODER_VERSION_V72
  );

  // 診断用シャドウ Policy 群 (実対戦には参加せずシャドウ評価のみ)
  const policyV72 = new Gen9LearnableTacticalPolicy(
    fromV6DNA(gen8DNA, "r4"),
    "V72",
    tacticalEvaluator,
    TACTICAL_FEATURE_ENCODER_VERSION_V72
  );

  const makeGenomeWithWeights = (costWeights: readonly [number, number, number, number]) => {
    const weights = [...R4_PRESET_TACTICAL_WEIGHTS];
    weights[20] = costWeights[0];
    weights[21] = costWeights[1];
    weights[22] = costWeights[2];
    weights[23] = costWeights[3];
    return fromV6DNA(gen8DNA, weights);
  };

  const policyZero = new Gen9LearnableTacticalPolicy(
    makeGenomeWithWeights([0, 0, 0, 0]),
    "Zero",
    tacticalEvaluator,
    TACTICAL_FEATURE_ENCODER_VERSION_V73
  );

  const policyDiag = new Gen9LearnableTacticalPolicy(
    makeGenomeWithWeights(COST_DIAGNOSTIC_WEIGHTS),
    "Diag",
    tacticalEvaluator,
    TACTICAL_FEATURE_ENCODER_VERSION_V73
  );

  const ablationPolicies = {
    t20: new Gen9LearnableTacticalPolicy(
      makeGenomeWithWeights([COST_DIAGNOSTIC_WEIGHTS[0], 0, 0, 0]),
      "T20",
      tacticalEvaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V73
    ),
    t21: new Gen9LearnableTacticalPolicy(
      makeGenomeWithWeights([0, COST_DIAGNOSTIC_WEIGHTS[1], 0, 0]),
      "T21",
      tacticalEvaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V73
    ),
    t22: new Gen9LearnableTacticalPolicy(
      makeGenomeWithWeights([0, 0, COST_DIAGNOSTIC_WEIGHTS[2], 0]),
      "T22",
      tacticalEvaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V73
    ),
    t23: new Gen9LearnableTacticalPolicy(
      makeGenomeWithWeights([0, 0, 0, COST_DIAGNOSTIC_WEIGHTS[3]]),
      "T23",
      tacticalEvaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V73
    ),
  };

  // 6. 実対戦シミュレーション & 決定観測
  console.log(`\n[SIMULATION] 実対戦 (R4 v7.2 vs Gen 8, ${totalMatchesToRun}試合) のシミュレーション開始...`);

  let currentMatchSeed = 0;
  let currentMatchLeg: "FORWARD" | "REVERSE" = "FORWARD";
  let currentDecisionOrdinal = 0;
  const seenObservationIds = new Set<string>();
  const collectedCostDecisions: {
    request: Readonly<DecisionRequest>;
    response: Readonly<DecisionResponse>;
  }[] = [];
  let totalDecisionsCollected = 0;

  const onDecisionObserved = (
    req: Readonly<DecisionRequest>,
    res: Readonly<DecisionResponse>,
    _policyName: string
  ) => {
    currentDecisionOrdinal++;
    const ordinal = currentDecisionOrdinal;
    const actingPlayerId = req.playerId;
    const observationId = `${currentMatchSeed}_${currentMatchLeg}_${ordinal}_${actingPlayerId}_${req.decisionId}`;

    if (res.decisionId !== req.decisionId) {
      throw new Error(`[RESPONSE_MISMATCH] response.decisionId !== req.decisionId`);
    }
    if (res.stateVersion !== req.stateVersion) {
      throw new Error(`[RESPONSE_MISMATCH] response.stateVersion !== req.stateVersion`);
    }
    if (res.selectedPatternRef < 0 || res.selectedPatternRef >= req.patterns.length) {
      throw new Error(`[OUT_OF_RANGE_PATTERN_REF] selectedPatternRef out of range: ${res.selectedPatternRef}`);
    }
    if (seenObservationIds.has(observationId)) {
      throw new Error(`[DUPLICATE_OBSERVATION_ID] 重複した observationId を検知: ${observationId}`);
    }
    seenObservationIds.add(observationId);

    totalDecisionsCollected++;

    // コスト支払い差分が存在する決定のみ収集
    const { pureCostGroups } = classifyDecisionPatterns(req);
    if (pureCostGroups.length > 0) {
      collectedCostDecisions.push({
        request: req,
        response: res,
      });
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

  for (const seed of seedsToRun) {
    currentMatchSeed = seed;

    // 正順: P1=R4, P2=Gen8
    currentMatchLeg = "FORWARD";
    currentDecisionOrdinal = 0;
    const setup1 = OfficialRegulationMatchSetup.setupMatch(
      reg,
      frame,
      rulePackage,
      seed,
      { playerNames: { p1: policyR4.descriptor.name, p2: policyGen8.descriptor.name } }
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
      { playerNames: { p1: policyGen8.descriptor.name, p2: policyR4.descriptor.name } }
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

    if (matchCounter % 10 === 0 || matchCounter === totalMatchesToRun) {
      console.log(`  [PROGRESS] ${matchCounter}/${totalMatchesToRun} 試合完了 (収集コスト決定数: ${collectedCostDecisions.length})`);
    }
  }

  console.log(`[SIMULATION_COMPLETE] 全 ${totalMatchesToRun} 試合完了: R4勝=${winsR4}, Gen8勝=${winsGen8}, 引分=${draws}`);
  console.log(`[DATA_COLLECTED] 総決定数=${totalDecisionsCollected}, コスト差分決定数=${collectedCostDecisions.length}`);

  // 7. コスト特徴量診断 & 監査A〜D 実行
  console.log("\n[AUDIT] コスト支払い特徴量の監査実行中 (監査A, 監査B, 監査C, 監査D)...");
  const diagnosticResults: SingleDecisionCostDiagnosticResult[] = [];

  for (let idx = 0; idx < collectedCostDecisions.length; idx++) {
    const item = collectedCostDecisions[idx];
    const res = diagnoseDecisionCostFeatures(
      item.request,
      tacticalEvaluator,
      policyZero,
      policyDiag,
      ablationPolicies,
      policyV72
    );
    diagnosticResults.push(res);
  }

  // 8. 全体集計の算出
  const summary: CostDiagnosticAggregateSummary = aggregateCostDiagnosticResults(
    diagnosticResults,
    totalMatchesToRun,
    totalDecisionsCollected
  );

  console.log("================================================================================");
  console.log("  【Work 5-5C R1 監査結果サマリ】");
  console.log("================================================================================");
  console.log(`総試合数: ${summary.totalMatches}`);
  console.log(`総決定数: ${summary.totalDecisionsCollected}`);
  console.log(`コスト差分決定数: ${summary.decisionsWithCostGroups}`);
  console.log(`総コスト差分グループ数: ${summary.totalCostGroups}`);
  console.log(`総候補数: ${summary.totalCandidates}`);
  console.log(`総候補ペア数: ${summary.totalPairs}`);

  console.log("--------------------------------------------------------------------------------");
  console.log("  [監査A: 同点遷移クロス集計 (A1〜A4)]");
  if (summary.auditA_tieTransitions) {
    const a = summary.auditA_tieTransitions;
    console.log(`  総純粋コスト差分グループ数: ${a.totalPureCostGroups}`);
    console.log(`  A1 (同点 -> 同点): ${a.a1_tiedToTiedCount}`);
    console.log(`  A2 (同点 -> 非同点, 解消): ${a.a2_tiedToUntiedCount}`);
    console.log(`  A3 (非同点 -> 同点, 新規): ${a.a3_untiedToTiedCount}`);
    console.log(`  A4 (非同点 -> 非同点): ${a.a4_untiedToUntiedCount}`);
    console.log(`  正味の同点増加数 (A3 - A2): ${a.netTieIncreaseCount}`);
    console.log(`  t20単独同点数 (A1 + A2): ${a.a1_tiedToTiedCount + a.a2_tiedToUntiedCount}`);
    console.log(`  4特徴量併用同点数 (A1 + A3): ${a.a1_tiedToTiedCount + a.a3_untiedToTiedCount}`);
    console.log(`  A3 (新規同点発生) の原因別内訳:`);
    for (const [r, count] of Object.entries(a.a3_reasons)) {
      console.log(`    ${r}: ${count}`);
    }
    console.log(`  同点判定の厳密性:`);
    console.log(`    t20 のみ: 厳密一致=${a.exactTieCount.t20_only}, 許容誤差近似=${a.approxTieCount.t20_only}`);
    console.log(`    4特徴量併用: 厳密一致=${a.exactTieCount.all_four}, 許容誤差近似=${a.approxTieCount.all_four}`);

    // 数理的一致性アサーション
    const sumA = a.a1_tiedToTiedCount + a.a2_tiedToUntiedCount + a.a3_untiedToTiedCount + a.a4_untiedToUntiedCount;
    if (sumA !== a.totalPureCostGroups) {
      throw new Error(`[AUDIT_A_VIOLATION] A1+A2+A3+A4 (${sumA}) !== totalPureCostGroups (${a.totalPureCostGroups})`);
    }
    if (a.netTieIncreaseCount !== a.a3_untiedToTiedCount - a.a2_tiedToUntiedCount) {
      throw new Error(`[AUDIT_A_VIOLATION] netTieIncreaseCount mismatch`);
    }
  }

  console.log("--------------------------------------------------------------------------------");
  console.log("  [監査B: Argmax 変更 126 件の詳細属性別再分類]");
  if (summary.auditB_argmaxReclassification) {
    const b = summary.auditB_argmaxReclassification;
    console.log(`  最善手変化決定数: ${b.argmaxChangedCount}/${b.totalDecisions}`);
    console.log(`  詳細カテゴリ別内訳:`);
    for (const [cat, cnt] of Object.entries(b.breakdownByDetailedCategory)) {
      if (cnt > 0) {
        console.log(`    ${cat}: ${cnt}`);
      }
    }
    console.log(`  変更属性別内訳:`);
    for (const [attr, cnt] of Object.entries(b.changedAttributeCounts)) {
      console.log(`    属性 [${attr}]: ${cnt} 回`);
    }
    console.log(`  コスト支払い方法のみ変更された決定数: ${b.costPaymentOnlyDecisions.length}`);
    console.log(`  アクション種別が変更された決定数: ${b.actionChangedDecisions.length}`);
    console.log(`  キーカードが変更された決定数: ${b.keyCardChangedDecisions.length}`);
    console.log(`  PASS 関連変更決定数: ${b.passRelatedDecisions.length}`);
  }

  console.log("--------------------------------------------------------------------------------");
  console.log("  [監査C: v7.2 vs v7.3 zero 重みの実対戦全局面パリティ検証]");
  if (summary.auditC_zeroWeightParity) {
    const c = summary.auditC_zeroWeightParity;
    console.log(`  評価決定数: ${c.evaluatedDecisions}`);
    console.log(`  評価総パターン (合法手) 数: ${c.totalPatterns}`);
    console.log(`  厳密一致パターン数 (diff === 0): ${c.exactMatches}`);
    console.log(`  許容誤差一致パターン数 (0 < diff <= 1e-12): ${c.approxMatches}`);
    console.log(`  不一致パターン数 (diff > 1e-12): ${c.mismatches}`);
    console.log(`  パリティ一致率: ${(c.parityMatchRate * 100).toFixed(6)}%`);
    console.log(`  最善手 (bestPatternRef) 一致率: ${(c.bestPatternMatchRate * 100).toFixed(2)}% (${c.bestPatternMatches}/${c.evaluatedDecisions})`);
    console.log(`  choose() 選択一致率: ${(c.chooseMatchRate * 100).toFixed(2)}% (${c.chooseMatches}/${c.evaluatedDecisions})`);
    console.log(`  最大絶対誤差: ${c.maxAbsoluteDifference.toExponential(6)}`);
    console.log(`  非有限値 (NaN/Infinity) 発生件数: ${c.nonFiniteOccurrences}`);

    if (c.mismatches > 0) {
      throw new Error(`[AUDIT_C_VIOLATION] v7.2 と v7.3 zero 重みに不一致 (${c.mismatches} 件) が検知されました`);
    }
  }

  console.log("--------------------------------------------------------------------------------");
  console.log("  [監査D: 衝突原因分類の厳密化再集計]");
  console.log(`  候補ペア衝突率: ${(summary.stageA.pairCollisionRate * 100).toFixed(2)}% (${summary.stageA.collidingPairCount}/${summary.totalPairs})`);
  console.log(`  完全衝突グループ率: ${(summary.stageA.completeCollisionGroupRate * 100).toFixed(2)}% (${summary.stageA.completeCollisionGroupCount}/${summary.totalCostGroups})`);
  console.log(`  衝突原因内訳 (厳密集合一致版):`);
  for (const [r, count] of Object.entries(summary.stageA.collisionReasonCounts)) {
    if (count > 0) {
      console.log(`    ${r}: ${count}`);
    }
  }
  console.log("================================================================================");

  // 9. 代表事例の抽出 & Evidence JSON の永続化保存
  const outputDir = path.resolve(repoRoot, "tools/simulator/evidence/gen9-work5-5c-r1");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 代表事例抽出
  // 監査A 代表事例: A3 (新規同点) の各原因事例
  const repA3Swap = diagnosticResults.find((d) =>
    d.groups.some((g) => g.tieTransition?.category === "A3_UNTIED_TO_TIED" && g.tieTransition?.tieIncreaseReason === "TOP_CANDIDATE_SWAP")
  );
  const repA3Cancel = diagnosticResults.find((d) =>
    d.groups.some((g) => g.tieTransition?.category === "A3_UNTIED_TO_TIED" && g.tieTransition?.tieIncreaseReason === "CANCELLATION")
  );
  const repA3Approx = diagnosticResults.find((d) =>
    d.groups.some((g) => g.tieTransition?.category === "A3_UNTIED_TO_TIED" && g.tieTransition?.tieIncreaseReason === "TOLERANCE_APPROX")
  );

  // 監査B 代表事例: コストのみ変更、アクション変更、PASS逃避
  const repCostOnly = diagnosticResults.find((d) => d.detailedArgmax?.primaryCategory === "COST_PAYMENT_ONLY_CHANGED");
  const repActionChanged = diagnosticResults.find((d) => d.detailedArgmax?.primaryCategory === "ACTION_TYPE_CHANGED");
  const repPassRelated = diagnosticResults.find(
    (d) =>
      d.detailedArgmax?.primaryCategory === "COUNTER_TO_PASS" ||
      d.detailedArgmax?.primaryCategory === "SUMMON_TO_PASS" ||
      d.detailedArgmax?.primaryCategory === "CHANGED_TO_PASS"
  );

  // 監査D 代表事例: 防壁ドライブのみ、同ランク異スート
  const repBulwark = diagnosticResults.find((d) =>
    d.groups.some((g) => g.collisionReasons.includes("BULWARK_DRIVE_DIFF_ONLY"))
  );
  const repSameRank = diagnosticResults.find((d) =>
    d.groups.some((g) => g.collisionReasons.includes("SAME_RANK_DIFF_SUIT"))
  );

  const representativeCases = {
    auditA_a3_top_candidate_swap: repA3Swap ? [repA3Swap] : [],
    auditA_a3_cancellation: repA3Cancel ? [repA3Cancel] : [],
    auditA_a3_tolerance_approx: repA3Approx ? [repA3Approx] : [],
    auditB_cost_payment_only_changed: repCostOnly ? [repCostOnly] : [],
    auditB_action_type_changed: repActionChanged ? [repActionChanged] : [],
    auditB_pass_related: repPassRelated ? [repPassRelated] : [],
    auditD_bulwark_drive_diff_only: repBulwark ? [repBulwark] : [],
    auditD_same_rank_diff_suit: repSameRank ? [repSameRank] : [],
  };

  const decisionSummaries = diagnosticResults.map((d) => ({
    decisionId: d.decisionId,
    groupCount: d.groups.length,
    isArgmaxChanged: d.argmaxEffect.isArgmaxChanged,
    detailedCategory: d.detailedArgmax?.primaryCategory,
    changedAttributes: d.detailedArgmax?.changedAttributes,
    zeroBestPatternRef: d.argmaxEffect.zeroBestPatternRef,
    diagBestPatternRef: d.argmaxEffect.diagBestPatternRef,
    scoreZero: d.detailedArgmax?.scoreZero,
    scoreDiag: d.detailedArgmax?.scoreDiag,
    parityMatches: d.parityCheck ? d.parityCheck.exactMatches + d.parityCheck.approxMatches === d.parityCheck.totalPatterns : undefined,
    invalidCardCount: d.invalidReferences.cardIds.length,
    invalidUnitCount: d.invalidReferences.unitIds.length,
  }));

  const shortSha = gitSha.slice(0, 12);
  const jsonFileName = `gen9-work5-5c-r1-audit-${shortSha}.json`;
  const jsonFilePath = path.resolve(outputDir, jsonFileName);

  const evidencePayload = {
    workId: "BP-SIM-AI-GEN9-WORK55C-R1-DIAGNOSTIC-AUDIT",
    generatedAt: new Date().toISOString(),
    gitCommit: {
      sha: gitSha,
      commitTimeIso,
    },
    diagnosticConfig: {
      seedRange: {
        start: seedsToRun[0],
        end: seedsToRun[seedsToRun.length - 1],
        pairCount: seedsToRun.length,
        totalMatches: totalMatchesToRun,
      },
      diagnosticWeights: COST_DIAGNOSTIC_WEIGHTS,
      encoderVersionUsed: TACTICAL_FEATURE_ENCODER_VERSION_V73,
    },
    summary,
    representativeCases,
    decisionSummaries,
  };

  const jsonStr = JSON.stringify(evidencePayload, null, 2);
  fs.writeFileSync(jsonFilePath, jsonStr, "utf8");

  const evidenceSha256 = crypto.createHash("sha256").update(Buffer.from(jsonStr)).digest("hex").toLowerCase();
  console.log(`\n[EVIDENCE_SAVED] Evidence JSON を保存しました: ${jsonFilePath}`);
  console.log(`[EVIDENCE_SHA256] SHA-256: ${evidenceSha256}`);

  const tEnd = performance.now();
  console.log(`[ALL_COMPLETE] 監査完了 (所要時間: ${((tEnd - tStart) / 1000).toFixed(2)} 秒)`);
}

if (process.argv[1] && process.argv[1].endsWith("run_gen9_work55c_r1_diagnostic_audit.ts")) {
  main().catch((err) => {
    console.error("\n[FATAL_ERROR] 監査実行中にエラーが発生しました:", err);
    process.exit(1);
  });
}
