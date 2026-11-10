/**
 * run_gen9_work55c_cost_feature_diagnostic.ts
 *
 * BlackPoker Simulator - Gen 9 コスト支払い特徴量の識別能力診断 (Work 5-5C)
 *
 * 【検証目的】
 * 1. 診断Seed (790001〜790030, 30ペア＝60試合, 座席反転) において、実対戦経路上でAIが遭遇した
 *    すべての純粋コスト支払い差分グループ (Work 5-4C で 100% 衝突していた 59,087 グループ) を対象に、
 *    4つのコスト特徴量 (t20〜t23) の識別能力を定量的に測定。
 * 2. Stage A (特徴量識別能力): t20〜t23 の値の完全衝突率・ペア衝突率・衝突原因 (同ランク異スート等) の分類。
 * 3. Stage B (スコア識別能力): 固定診断重み ([-0.5, -1.0, -0.5, -0.5]) 適用時のスコア同点率・マージン・アブレーション評価。
 *    識別可能グループと構造的識別不能グループの分離集計。数理的一致性の完全検証。
 * 4. Stage C (Policy 全体への影響): 全合法手における最善手 (Argmax) の変動率・副作用 (PASS逃避, Counter回避等) の分類。
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
  ObservedMatchDecision,
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
// 3. 過去 Evidence 不変性アサーション
// =============================================================================
export function assertPastEvidenceInvariance(repoRoot: string): void {
  const pastEvidences = [
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
// 4. メイン診断実行処理
// =============================================================================
export async function main() {
  const tStart = performance.now();
  console.log("================================================================================");
  console.log("  BlackPoker Gen 9 Work 5-5C: コスト支払い特徴量の識別能力診断");
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
  console.log(`[SEED_VERIFIED] 診断Seed: ${seedsToRun[0]}〜${seedsToRun[seedsToRun.length - 1]} (${seedsToRun.length}ペア＝${totalMatchesToRun}試合) 重複なし確認済`);

  // 2. 過去 Evidence 保護アサーション
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
  // 実対戦 Policy (Work 5-4C と完全同一)
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
    policyName: string
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

  // 7. コスト特徴量診断の実行
  console.log("\n[DIAGNOSTIC] コスト支払い特徴量の識別能力診断 (Stage A, B, C) 実行中...");
  const diagnosticResults: SingleDecisionCostDiagnosticResult[] = [];

  for (let idx = 0; idx < collectedCostDecisions.length; idx++) {
    const item = collectedCostDecisions[idx];
    const res = diagnoseDecisionCostFeatures(
      item.request,
      tacticalEvaluator,
      policyZero,
      policyDiag,
      ablationPolicies
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
  console.log("  【診断集計結果サマリ】");
  console.log("================================================================================");
  console.log(`総試合数: ${summary.totalMatches}`);
  console.log(`総決定数: ${summary.totalDecisionsCollected}`);
  console.log(`コスト差分決定数: ${summary.decisionsWithCostGroups}`);
  console.log(`総コスト差分グループ数: ${summary.totalCostGroups}`);
  console.log(`総候補数: ${summary.totalCandidates}`);
  console.log(`総候補ペア数: ${summary.totalPairs}`);
  console.log("--------------------------------------------------------------------------------");
  console.log("  [Stage A: 特徴量識別能力]");
  console.log(`  完全衝突グループ率: ${(summary.stageA.completeCollisionGroupRate * 100).toFixed(2)}% (${summary.stageA.completeCollisionGroupCount}/${summary.totalCostGroups})`);
  console.log(`  特徴量識別可能グループ率: ${(summary.stageA.distinguishableGroupRate * 100).toFixed(2)}% (${summary.stageA.distinguishableGroupCount}/${summary.totalCostGroups})`);
  console.log(`  候補ペア衝突率: ${(summary.stageA.pairCollisionRate * 100).toFixed(2)}% (${summary.stageA.collidingPairCount}/${summary.totalPairs})`);
  console.log(`  特徴量別 差異化回数:`);
  console.log(`    t20 (廃棄カード数値): ${summary.stageA.featureDifferentiatingCounts.t20_discardValue} 回`);
  console.log(`    t21 (廃棄Joker枚数): ${summary.stageA.featureDifferentiatingCounts.t21_discardJoker} 回`);
  console.log(`    t22 (犠牲ユニットサイズ): ${summary.stageA.featureDifferentiatingCounts.t22_sacrificeSize} 回`);
  console.log(`    t23 (ライフ支払い割合): ${summary.stageA.featureDifferentiatingCounts.t23_lifeRatio} 回`);
  console.log(`  衝突原因内訳 (ペア単位):`);
  for (const [r, count] of Object.entries(summary.stageA.collisionReasonCounts)) {
    if (count > 0) {
      console.log(`    ${r}: ${count}`);
    }
  }
  console.log("--------------------------------------------------------------------------------");
  console.log("  [Stage B: スコア識別能力 (診断非ゼロ重み適用時)]");
  console.log(`  【全グループ】`);
  console.log(`    全候補同点率: ${(summary.stageB.allGroups.allTiedRate * 100).toFixed(2)}% (${summary.stageB.allGroups.allTiedCount}/${summary.totalCostGroups})`);
  console.log(`    最高スコア同点率: ${(summary.stageB.allGroups.topTiedRate * 100).toFixed(2)}% (${summary.stageB.allGroups.topTiedCount}/${summary.totalCostGroups})`);
  console.log(`    平均マージン: ${summary.stageB.allGroups.averageMargin.toFixed(6)}`);
  console.log(`    中央値マージン: ${summary.stageB.allGroups.medianMargin.toFixed(6)}`);
  console.log(`  【特徴量識別可能グループ (${summary.stageB.distinguishableGroups.groupCount} グループ)】`);
  console.log(`    全候補同点率: ${(summary.stageB.distinguishableGroups.allTiedRate * 100).toFixed(2)}% (${summary.stageB.distinguishableGroups.allTiedCount}/${summary.stageB.distinguishableGroups.groupCount})`);
  console.log(`    最高スコア同点率: ${(summary.stageB.distinguishableGroups.topTiedRate * 100).toFixed(2)}% (${summary.stageB.distinguishableGroups.topTiedCount}/${summary.stageB.distinguishableGroups.groupCount})`);
  console.log(`    平均マージン: ${summary.stageB.distinguishableGroups.averageMargin.toFixed(6)}`);
  console.log(`  【構造的識別不能グループ (${summary.stageB.structuralIndistinguishableGroups.groupCount} グループ)】`);
  console.log(`    同点率: 100.00% (表現限界による設計通りの衝突)`);
  console.log(`  【アブレーション別 最高スコア同点数】:`);
  console.log(`    t20 のみ: ${summary.stageB.ablationTopTiedCounts.t20_only}`);
  console.log(`    t21 のみ: ${summary.stageB.ablationTopTiedCounts.t21_only}`);
  console.log(`    t22 のみ: ${summary.stageB.ablationTopTiedCounts.t22_only}`);
  console.log(`    t23 のみ: ${summary.stageB.ablationTopTiedCounts.t23_only}`);
  console.log(`    全4種適用: ${summary.stageB.ablationTopTiedCounts.all_four}`);
  console.log(`  数理的一致性違反 (Δscore != Σ t_m * w_m): ${summary.stageB.mathConsistencyViolations} 件`);
  console.log("--------------------------------------------------------------------------------");
  console.log("  [Stage C: 全合法手 Argmax 変化と副作用分析]");
  console.log(`  最善手変化決定数: ${summary.stageC.argmaxChangedCount}/${summary.stageC.totalDecisions} (${(summary.stageC.argmaxChangedRate * 100).toFixed(2)}%)`);
  console.log(`  変化カテゴリ内訳:`);
  for (const [cat, cnt] of Object.entries(summary.stageC.breakdownByCategory)) {
    if (cnt > 0) {
      console.log(`    ${cat}: ${cnt}`);
    }
  }
  console.log(`  Counter 回避 -> PASS 逃避: ${summary.stageC.counterToPassDecisions.length} 件`);
  console.log(`  召喚回避 -> PASS 逃避: ${summary.stageC.summonToPassDecisions.length} 件`);
  console.log("--------------------------------------------------------------------------------");
  console.log("  [未解決参照 ID 診断]");
  console.log(`  未解決カードID件数: ${summary.invalidReferences.invalidCardIdCount}`);
  console.log(`  未解決ユニットID件数: ${summary.invalidReferences.invalidUnitIdCount}`);
  console.log(`  未解決コスト参照件数: ${summary.invalidReferences.invalidCostRefCount}`);
  console.log("================================================================================");

  // 数理的一致性の厳格アサーション
  if (summary.stageB.mathConsistencyViolations > 0) {
    throw new Error(`[MATH_VIOLATION] 数理的一致性違反が ${summary.stageB.mathConsistencyViolations} 件発生しました`);
  }

  // 9. 代表事例の抽出 & Evidence JSON の永続化保存
  const outputDir = path.resolve(repoRoot, "tools/simulator/evidence/gen9-work5-5c");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const repT20 = diagnosticResults.find((d) =>
    d.groups.some((g) => g.pairComparisons.some((p) => p.differingFeatures.includes(20)))
  );
  const repT21 = diagnosticResults.find((d) =>
    d.groups.some((g) => g.pairComparisons.some((p) => p.differingFeatures.includes(21)))
  );
  const repSameRank = diagnosticResults.find((d) =>
    d.groups.some((g) => g.collisionReasons.includes("SAME_RANK_DIFF_SUIT"))
  );
  const repBulwark = diagnosticResults.find((d) =>
    d.groups.some((g) => g.collisionReasons.includes("BULWARK_DRIVE_DIFF_ONLY"))
  );
  const repArgmaxCostOnly = diagnosticResults.find((d) => d.argmaxEffect.category === "COST_ONLY_CHANGED");
  const repArgmaxActionChanged = diagnosticResults.find((d) => d.argmaxEffect.category === "ACTION_CHANGED");

  const representativeCases = {
    t20_differentiated: repT20 ? [repT20] : [],
    t21_differentiated: repT21 ? [repT21] : [],
    same_rank_diff_suit_collided: repSameRank ? [repSameRank] : [],
    bulwark_drive_diff_collided: repBulwark ? [repBulwark] : [],
    argmax_cost_only_changed: repArgmaxCostOnly ? [repArgmaxCostOnly] : [],
    argmax_action_changed: repArgmaxActionChanged ? [repArgmaxActionChanged] : [],
  };

  const decisionSummaries = diagnosticResults.map((d) => ({
    decisionId: d.decisionId,
    groupCount: d.groups.length,
    isArgmaxChanged: d.argmaxEffect.isArgmaxChanged,
    category: d.argmaxEffect.category,
    zeroBestPatternRef: d.argmaxEffect.zeroBestPatternRef,
    diagBestPatternRef: d.argmaxEffect.diagBestPatternRef,
    invalidCardCount: d.invalidReferences.cardIds.length,
    invalidUnitCount: d.invalidReferences.unitIds.length,
  }));

  const shortSha = gitSha.slice(0, 12);
  const jsonFileName = `gen9-work5-5c-cost-feature-diagnostic-${shortSha}.json`;
  const jsonFilePath = path.resolve(outputDir, jsonFileName);

  const evidencePayload = {
    workId: "BP-SIM-AI-GEN9-WORK55C-COST-FEATURE-DISCRIMINATION",
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
  console.log(`[ALL_COMPLETE] 診断完了 (所要時間: ${((tEnd - tStart) / 1000).toFixed(2)} 秒)`);
}

if (process.argv[1] && process.argv[1].endsWith("run_gen9_work55c_cost_feature_diagnostic.ts")) {
  main().catch((err) => {
    console.error("\n[FATAL_ERROR] 診断実行中にエラーが発生しました:", err);
    process.exit(1);
  });
}
