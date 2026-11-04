/**
 * BlackPoker Work 3-6 — Stage 3 Champion Holdout Evaluation Runner
 *
 * 【目的と保護原則】
 * 1. Stage 3 Full Action Space Retraining R1 で導出された Gen 7 Champion に対し、
 *    完全未使用の本番 Holdout 240 試合 (Seeds: 95001〜95030, 30 Seeds × 2 座席 × 4 比較相手) を用いた
 *    決定論的・統計的性能評価を実行する。
 * 2. Holdout 未使用保護の Fail-Closed:
 *    - --execute 明示指定がない限り、本番 Holdout (Seeds 95001〜95030) は一切実行しない。
 *    - --dry-run では環境検証・Preflight チェックのみを実行。
 *    - --smoke では診断用独立 Seed (99951〜99952) による小規模対戦 (計16試合) のみを実行。
 * 3. 原本保護:
 *    - 旧 Stage 3 原本 (.artifacts/stage3-evolution) および新 Stage 3 原本 (.artifacts/stage3-full-action-retrain-r1)
 *      への誤上書きを Fail-Closed で拒絶。
 * 4. 統計的厳格性:
 *    - 同一 Seed の座席反転ペア対戦 (Leg 0 / Leg 1) によるペアスコア Xi in {0, 0.25, 0.5, 0.75, 1} 集計。
 *    - 記述統計としての両側 95% 信頼区間と、4 比較相手に対する Bonferroni 補正片側検定 (alpha = 0.0125) の厳格分離。
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import * as fflate from "fflate";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import {
  EvaluationConfig,
  EvaluationOpponentDefinition,
  EvaluationSeedSet,
  IndependentEvaluationResult,
  PairedMatchResult,
} from "../domain/ai/EvolutionEvaluationTypes";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { EvolutionIndependentEvaluator } from "../engine/ai/EvolutionIndependentEvaluator";
import { FirstLegalPolicy, RandomPolicy } from "../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../engine/ai/GenomePolicy";
import { BatchSimulationOptions } from "../domain/simulation/BatchSimulationTypes";
import {
  deriveStage3TrainingSeedsByEngine,
  prepareOfficialSessionFactory,
  CAMPAIGN_SEED,
  VALIDATION_SEEDS_COUNT,
  HOLDOUT_SEEDS_COUNT,
} from "./stage3EvolutionRunner";

// =============================================================================
// 定数定義
// =============================================================================

export const HOLDOUT_WORK_ID = "BP-SIM-AI-V92-WORK3-STAGE3-HOLDOUT-EVALUATION" as const;
export const HOLDOUT_REGULATION_ID = "standard-pack" as const;
export const HOLDOUT_FRAME_ID = "pack" as const;
export const HOLDOUT_RULE_PACKAGE_VERSION = "1.0.0" as const;
export const HOLDOUT_FEATURE_SCHEMA_VERSION = 6 as const;

export const CANDIDATE_CHAMPION_GENOME_ID = "gen-000007-offspring-000007" as const;
export const CANDIDATE_CHAMPION_EXPECTED_DIGEST =
  "04a1e2fa1b25c117558a9fb71fc60a57b10a26750540474d4c858e139e7aa3f4" as const;

export const OLD_CHAMPION_GENOME_ID = "gen-000005-offspring-000008" as const;
export const OLD_CHAMPION_EXPECTED_DIGEST =
  "e8e8ae8f5449077b0f219afc827f6fc13f5e309408bb2d18817c62f87494ae91" as const;

export const DEFAULT_HOLDOUT_ARTIFACTS_DIR: string = ".artifacts/stage3-holdout-evaluation";
export const DEFAULT_HOLDOUT_ZIP_PATH: string = ".artifacts/stage3-holdout-evaluation.zip";

export const PROTECTED_RETRAIN_DIR = ".artifacts/stage3-full-action-retrain-r1" as const;
export const PROTECTED_OLD_STAGE3_DIR = ".artifacts/stage3-evolution" as const;

export const DEFAULT_MAX_DECISIONS_PER_MATCH = 400 as const;
export const HOLDOUT_SIGNIFICANCE_ALPHA = 0.05 as const;
export const HOLDOUT_OPPONENTS_COUNT = 4 as const;
export const HOLDOUT_BONFERRONI_ALPHA = HOLDOUT_SIGNIFICANCE_ALPHA / HOLDOUT_OPPONENTS_COUNT; // 0.0125

/** 本番 Holdout Seeds (30 Seeds: 95001〜95030) */
export const OFFICIAL_HOLDOUT_SEEDS: readonly number[] = Object.freeze(
  Array.from({ length: HOLDOUT_SEEDS_COUNT }, (_, i) => 95001 + i)
);

/** 診断用独立スモーク Seeds (2 Seeds: 99951〜99952) */
export const SMOKE_DIAGNOSTIC_SEEDS: readonly number[] = Object.freeze([99951, 99952]);

// =============================================================================
// インターフェース定義
// =============================================================================

export interface HoldoutPreflightManifest {
  readonly workId: string;
  readonly runnerTimestamp: string;
  readonly gitCommitSha: string;
  readonly isGitClean: boolean;
  readonly executionMode: "EXECUTE" | "DRY_RUN" | "SMOKE";
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly featureSchemaVersion: number;
  readonly candidateChampion: {
    readonly genomeId: string;
    readonly expectedDigest: string;
    readonly verifiedDigest: string;
    readonly sourcePath: string;
  };
  readonly oldChampion: {
    readonly genomeId: string;
    readonly expectedDigest: string;
    readonly verifiedDigest: string;
    readonly sourcePath: string;
  };
  readonly zeroDnaDigest: string;
  readonly seeds: {
    readonly category: "HOLDOUT" | "SMOKE";
    readonly count: number;
    readonly seedList: readonly number[];
  };
  readonly opponents: readonly {
    readonly opponentId: string;
    readonly name: string;
    readonly role: string;
    readonly targetWinRate: number;
  }[];
  readonly plannedMatches: {
    readonly seedsCount: number;
    readonly pairsPerOpponent: number;
    readonly matchesPerOpponent: number;
    readonly totalPairs: number;
    readonly totalMatches: number;
  };
  readonly artifactsDir: string;
}

export interface HoldoutIndividualMatchOutcome {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly pairIndex: number;
  readonly legIndex: 0 | 1;
  readonly matchSeed: number;
  readonly opponentId: string;
  readonly opponentName: string;
  readonly candidateSeat: "p1" | "p2";
  readonly opponentSeat: "p1" | "p2";
  readonly completed: boolean;
  readonly winner?: "p1" | "p2" | "draw";
  readonly candidateWon: boolean;
  readonly candidateDraw: boolean;
  readonly candidateLost: boolean;
  readonly totalDecisions: number;
  readonly turnCount: number;
  readonly reason?: string;
  readonly failed: boolean;
  readonly incomplete: boolean;
  readonly finalStateHash?: string;
}

export interface HoldoutEvaluationOutput {
  readonly preflightManifest: HoldoutPreflightManifest;
  readonly evaluationResult: IndependentEvaluationResult;
  readonly allIndividualOutcomes: readonly HoldoutIndividualMatchOutcome[];
  readonly totalMatches: number;
  readonly completedMatches: number;
  readonly failedMatches: number;
  readonly incompleteMatches: number;
  readonly totalDecisions: number;
  readonly maxDecisionsInSingleMatch: number;
  readonly minDecisionsInSingleMatch: number;
  readonly executionElapsedMs: number;
}

export interface SaveHoldoutArtifactsResult {
  readonly artifactsDir: string;
  readonly savedFiles: readonly string[];
  readonly manifestSha256: Record<string, string>;
}

export interface AuditHoldoutResult {
  readonly isValid: boolean;
  readonly checkedFiles: readonly string[];
  readonly errors: readonly string[];
  readonly totalMatches: number;
  readonly completedMatches: number;
  readonly failedMatches: number;
  readonly incompleteMatches: number;
  readonly candidateDigest: string;
  readonly candidateDigestMatches: boolean;
  readonly oldChampionDigest: string;
  readonly oldChampionDigestMatches: boolean;
  readonly allBaselineTargetsMet: boolean;
  readonly evidenceStatus: string;
  readonly improvementStatus: string;
}

// =============================================================================
// ハッシュ & Git 検証ユーティリティ
// =============================================================================

export function computeFileSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function checkGitCleanliness(): { isClean: boolean; headCommitSha: string } {
  try {
    const statusOutput = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    const isClean = statusOutput.length === 0;
    const headCommitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    return { isClean, headCommitSha };
  } catch (err) {
    return { isClean: false, headCommitSha: "GIT_CHECK_FAILED" };
  }
}

// =============================================================================
// 出力先ディレクトリ保護 (Fail-Closed)
// =============================================================================

export function validateArtifactsDirectory(artifactsDir: string): void {
  const resolved = path.resolve(artifactsDir);
  const protectedPaths = [
    path.resolve(PROTECTED_RETRAIN_DIR),
    path.resolve(PROTECTED_OLD_STAGE3_DIR),
    path.resolve(".artifacts/stage2-evolution"),
    path.resolve(".artifacts/stage1-pilot"),
  ];

  for (const prot of protectedPaths) {
    if (resolved === prot || resolved.startsWith(prot + path.sep)) {
      throw new Error(
        `[Fail-Closed] Output directory "${artifactsDir}" targets a protected artifact directory ("${prot}"). Modification or overwrite is strictly forbidden.`
      );
    }
  }

  if (fs.existsSync(resolved)) {
    const entries = fs.readdirSync(resolved);
    if (entries.length > 0) {
      throw new Error(
        `[Fail-Closed] Output directory "${artifactsDir}" already exists and is not empty (${entries.length} items found). Specify a new, empty directory to ensure evidence integrity.`
      );
    }
  }
}

// =============================================================================
// DNA 読み込み & 真正性検証
// =============================================================================

export function loadChampionDNA(params: {
  checkpointPath: string;
  expectedGenomeId: string;
  expectedDigest: string;
}): DecisionDNA {
  const { checkpointPath, expectedGenomeId, expectedDigest } = params;
  if (!fs.existsSync(checkpointPath)) {
    throw new Error(`[Fail-Closed] Checkpoint file not found: "${checkpointPath}"`);
  }

  const rawJson = fs.readFileSync(checkpointPath, "utf8");
  const checkpoint = JSON.parse(rawJson);

  const championData = checkpoint.provisionalBestChampion;
  if (!championData) {
    throw new Error(`[Fail-Closed] provisionalBestChampion missing in checkpoint "${checkpointPath}"`);
  }

  if (championData.genomeId !== expectedGenomeId) {
    throw new Error(
      `[Fail-Closed] Genome ID mismatch in "${checkpointPath}": expected "${expectedGenomeId}", but found "${championData.genomeId}"`
    );
  }

  const dna = championData.dna as DecisionDNA;
  DecisionDNACodec.validate(dna);

  const actualDigest = EvolutionIndependentEvaluator.computeDnaDigest(dna);
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `[Fail-Closed] DNA Digest mismatch for "${expectedGenomeId}": expected "${expectedDigest}", but computed "${actualDigest}"`
    );
  }

  return dna;
}

export function createZeroDNA(): DecisionDNA {
  const zeroDNA = DecisionDNACodec.createZeroDecisionDNA({
    id: "baseline-zero-dna-v1",
    name: "ZeroDNA",
  });
  DecisionDNACodec.validate(zeroDNA);
  return zeroDNA;
}

// =============================================================================
// Seed 衝突防止検証 (Fail-Closed)
// =============================================================================

export function validateHoldoutSeedPlan(
  holdoutSeeds: readonly number[],
  campaignSeed: number = CAMPAIGN_SEED
): void {
  const trainingSeeds = deriveStage3TrainingSeedsByEngine(campaignSeed).allTrainingSeedsList;
  const validationSeeds: number[] = [];
  for (let i = 0; i < VALIDATION_SEEDS_COUNT; i++) {
    validationSeeds.push(94001 + i);
  }

  const seedSets: EvaluationSeedSet[] = [
    { category: "TRAINING", seeds: trainingSeeds },
    { category: "VALIDATION", seeds: validationSeeds },
    { category: "HOLDOUT", seeds: holdoutSeeds },
  ];

  EvolutionIndependentEvaluator.assertNoSeedCollision(seedSets);
}

// =============================================================================
// 対戦相手定義 (4種)
// =============================================================================

export function createHoldoutOpponents(params: {
  oldChampionDNA: DecisionDNA;
  zeroDNA: DecisionDNA;
}): readonly EvaluationOpponentDefinition[] {
  const { oldChampionDNA, zeroDNA } = params;

  return [
    {
      opponentId: "holdout-first-legal",
      name: "FirstLegal",
      targetWinRate: 0.85,
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(false),
    },
    {
      opponentId: "holdout-seeded-random",
      name: "SeededRandom",
      targetWinRate: 0.75,
      role: "BASELINE",
      policyFactory: (seat, matchSeed, playerSeeds) =>
        new RandomPolicy(playerSeeds[seat], `SeededRandom-${seat}`),
    },
    {
      opponentId: "holdout-zero-dna",
      name: "ZeroDNA",
      targetWinRate: 0.70,
      role: "BASELINE",
      policyFactory: () => new GenomePolicy(zeroDNA, "ZeroDNA"),
    },
    {
      opponentId: "holdout-stage3-gen5-champion",
      name: "Stage3Gen5Champion",
      targetWinRate: 0.50,
      role: "REFERENCE_CHAMPION",
      referenceDNA: oldChampionDNA,
      expectedDnaDigest: OLD_CHAMPION_EXPECTED_DIGEST,
    },
  ];
}

// =============================================================================
// Preflight Manifest 生成
// =============================================================================

export function buildHoldoutPreflightManifest(params: {
  candidateDNA: DecisionDNA;
  candidateSourcePath: string;
  oldChampionDNA: DecisionDNA;
  oldChampionSourcePath: string;
  zeroDNA: DecisionDNA;
  seeds: readonly number[];
  executionMode: "EXECUTE" | "DRY_RUN" | "SMOKE";
  artifactsDir: string;
  gitInfo: { isClean: boolean; headCommitSha: string };
}): HoldoutPreflightManifest {
  const {
    candidateDNA,
    candidateSourcePath,
    oldChampionDNA,
    oldChampionSourcePath,
    zeroDNA,
    seeds,
    executionMode,
    artifactsDir,
    gitInfo,
  } = params;

  const candidateDigest = EvolutionIndependentEvaluator.computeDnaDigest(candidateDNA);
  const oldChampionDigest = EvolutionIndependentEvaluator.computeDnaDigest(oldChampionDNA);
  const zeroDigest = EvolutionIndependentEvaluator.computeDnaDigest(zeroDNA);

  const opponents = createHoldoutOpponents({ oldChampionDNA, zeroDNA });

  const pairsPerOpponent = seeds.length;
  const matchesPerOpponent = pairsPerOpponent * 2;
  const totalPairs = pairsPerOpponent * opponents.length;
  const totalMatches = matchesPerOpponent * opponents.length;

  return {
    workId: HOLDOUT_WORK_ID,
    runnerTimestamp: new Date().toISOString(),
    gitCommitSha: gitInfo.headCommitSha,
    isGitClean: gitInfo.isClean,
    executionMode,
    regulationId: HOLDOUT_REGULATION_ID,
    frameId: HOLDOUT_FRAME_ID,
    rulePackageVersion: HOLDOUT_RULE_PACKAGE_VERSION,
    featureSchemaVersion: HOLDOUT_FEATURE_SCHEMA_VERSION,
    candidateChampion: {
      genomeId: CANDIDATE_CHAMPION_GENOME_ID,
      expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
      verifiedDigest: candidateDigest,
      sourcePath: candidateSourcePath,
    },
    oldChampion: {
      genomeId: OLD_CHAMPION_GENOME_ID,
      expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
      verifiedDigest: oldChampionDigest,
      sourcePath: oldChampionSourcePath,
    },
    zeroDnaDigest: zeroDigest,
    seeds: {
      category: executionMode === "SMOKE" ? "SMOKE" : "HOLDOUT",
      count: seeds.length,
      seedList: seeds,
    },
    opponents: opponents.map((o) => ({
      opponentId: o.opponentId,
      name: o.name,
      role: o.role ?? "BASELINE",
      targetWinRate: o.targetWinRate,
    })),
    plannedMatches: {
      seedsCount: seeds.length,
      pairsPerOpponent,
      matchesPerOpponent,
      totalPairs,
      totalMatches,
    },
    artifactsDir,
  };
}

// =============================================================================
// 評価実行ロジック
// =============================================================================

export function executeHoldoutEvaluation(params: {
  candidateDNA: DecisionDNA;
  oldChampionDNA: DecisionDNA;
  zeroDNA: DecisionDNA;
  seeds: readonly number[];
  preflightManifest: HoldoutPreflightManifest;
  sessionFactory: BatchSimulationOptions["sessionFactory"];
  maxDecisionsPerMatch?: number;
}): HoldoutEvaluationOutput {
  const {
    candidateDNA,
    oldChampionDNA,
    zeroDNA,
    seeds,
    preflightManifest,
    sessionFactory,
    maxDecisionsPerMatch = DEFAULT_MAX_DECISIONS_PER_MATCH,
  } = params;

  const opponents = createHoldoutOpponents({ oldChampionDNA, zeroDNA });

  // Holdout 契約: 過去の全 Training および Validation Seed 集合を seedRegistry として提供
  const trainingSeeds = deriveStage3TrainingSeedsByEngine(CAMPAIGN_SEED).allTrainingSeedsList;
  const validationSeeds: number[] = [];
  for (let i = 0; i < VALIDATION_SEEDS_COUNT; i++) {
    validationSeeds.push(94001 + i);
  }
  const seedRegistry: EvaluationSeedSet[] = [
    { category: "TRAINING", seeds: trainingSeeds },
    { category: "VALIDATION", seeds: validationSeeds },
  ];

  const startTime = performance.now();

  const config: EvaluationConfig = {
    candidateDNA,
    seeds,
    seedCategory: "HOLDOUT",
    seedRegistry,
    opponents,
    sessionFactory,
    maxDecisionsPerMatch,
    significanceLevelAlpha: HOLDOUT_SIGNIFICANCE_ALPHA,
    minimumCompletedPairs: 2, // スモーク時も許容するため2ペア以上
    regulationId: HOLDOUT_REGULATION_ID,
    rulePackageVersion: HOLDOUT_RULE_PACKAGE_VERSION,
    featureSchemaVersion: HOLDOUT_FEATURE_SCHEMA_VERSION,
  };

  const evalResult = EvolutionIndependentEvaluator.evaluate(config);
  const elapsedMs = performance.now() - startTime;

  // 240試合すべての個別 Outcome を抽出
  const allIndividualOutcomes: HoldoutIndividualMatchOutcome[] = [];
  let totalDecisions = 0;
  let maxDecisions = 0;
  let minDecisions = Infinity;
  let completedMatches = 0;
  let failedMatches = 0;
  let incompleteMatches = 0;

  for (const pair of evalResult.pairs) {
    const oppDef = opponents.find((o) => o.opponentId === pair.opponentId);
    const oppName = oppDef?.name ?? pair.opponentId;

    // Leg 0
    const leg0Outcome: HoldoutIndividualMatchOutcome = {
      matchIndex: pair.pairIndex * 2,
      matchId: `pair-${pair.pairIndex}-leg0-${pair.matchSeed}-cand-vs-${pair.opponentId}`,
      pairIndex: pair.pairIndex,
      legIndex: 0,
      matchSeed: pair.matchSeed,
      opponentId: pair.opponentId,
      opponentName: oppName,
      candidateSeat: pair.leg0.candidateSeat,
      opponentSeat: pair.leg0.opponentSeat,
      completed: pair.leg0.completed,
      winner: pair.leg0.winner,
      candidateWon: pair.leg0.candidateWon,
      candidateDraw: pair.leg0.candidateDraw,
      candidateLost: pair.leg0.candidateLost,
      totalDecisions: pair.leg0.totalDecisions,
      turnCount: pair.leg0.turnCount,
      reason: pair.leg0.reason,
      failed: pair.leg0.failed,
      incomplete: pair.leg0.incomplete,
      finalStateHash: pair.leg0.finalStateHash,
    };
    allIndividualOutcomes.push(leg0Outcome);

    // Leg 1
    const leg1Outcome: HoldoutIndividualMatchOutcome = {
      matchIndex: pair.pairIndex * 2 + 1,
      matchId: `pair-${pair.pairIndex}-leg1-${pair.matchSeed}-${pair.opponentId}-vs-cand`,
      pairIndex: pair.pairIndex,
      legIndex: 1,
      matchSeed: pair.matchSeed,
      opponentId: pair.opponentId,
      opponentName: oppName,
      candidateSeat: pair.leg1.candidateSeat,
      opponentSeat: pair.leg1.opponentSeat,
      completed: pair.leg1.completed,
      winner: pair.leg1.winner,
      candidateWon: pair.leg1.candidateWon,
      candidateDraw: pair.leg1.candidateDraw,
      candidateLost: pair.leg1.candidateLost,
      totalDecisions: pair.leg1.totalDecisions,
      turnCount: pair.leg1.turnCount,
      reason: pair.leg1.reason,
      failed: pair.leg1.failed,
      incomplete: pair.leg1.incomplete,
      finalStateHash: pair.leg1.finalStateHash,
    };
    allIndividualOutcomes.push(leg1Outcome);

    for (const leg of [pair.leg0, pair.leg1]) {
      if (leg.completed) completedMatches++;
      if (leg.failed) failedMatches++;
      if (leg.incomplete) incompleteMatches++;
      totalDecisions += leg.totalDecisions;
      if (leg.totalDecisions > maxDecisions) maxDecisions = leg.totalDecisions;
      if (leg.totalDecisions < minDecisions && leg.totalDecisions > 0) minDecisions = leg.totalDecisions;
    }
  }

  if (minDecisions === Infinity) minDecisions = 0;

  return {
    preflightManifest,
    evaluationResult: evalResult,
    allIndividualOutcomes,
    totalMatches: allIndividualOutcomes.length,
    completedMatches,
    failedMatches,
    incompleteMatches,
    totalDecisions,
    maxDecisionsInSingleMatch: maxDecisions,
    minDecisionsInSingleMatch: minDecisions,
    executionElapsedMs: elapsedMs,
  };
}

// =============================================================================
// 成果物保存 & Markdown レポート生成
// =============================================================================

export function generateHoldoutAuditMarkdown(
  output: HoldoutEvaluationOutput,
  manifestSha256: Record<string, string>
): string {
  const { preflightManifest, evaluationResult, totalMatches, completedMatches, failedMatches, incompleteMatches } =
    output;

  const lines: string[] = [];
  lines.push(`# Champion Holdout Evaluation Audit Report`);
  lines.push(``);
  lines.push(`- **Work ID:** \`${preflightManifest.workId}\``);
  lines.push(`- **Execution Mode:** \`${preflightManifest.executionMode}\``);
  lines.push(`- **Git Commit SHA:** \`${preflightManifest.gitCommitSha}\` (Clean: \`${preflightManifest.isGitClean}\`)`);
  lines.push(`- **Regulation:** \`${preflightManifest.regulationId}\` (Frame: \`${preflightManifest.frameId}\`, Schema: v${preflightManifest.featureSchemaVersion})`);
  lines.push(`- **Timestamp:** \`${preflightManifest.runnerTimestamp}\``);
  lines.push(`- **Execution Elapsed:** \`${(output.executionElapsedMs / 1000).toFixed(2)}s\``);
  lines.push(``);
  lines.push(`## 1. 評価対象 Champion DNA`);
  lines.push(``);
  lines.push(`- **Candidate Genome ID:** \`${preflightManifest.candidateChampion.genomeId}\``);
  lines.push(`- **Verified DNA Digest:** \`${preflightManifest.candidateChampion.verifiedDigest}\``);
  lines.push(`- **Digest Match:** \`${preflightManifest.candidateChampion.verifiedDigest === preflightManifest.candidateChampion.expectedDigest}\``);
  lines.push(``);
  lines.push(`## 2. 試合完走状況`);
  lines.push(``);
  lines.push(`- **総試合数:** ${totalMatches}`);
  lines.push(`- **完了試合数 (Completed):** ${completedMatches}`);
  lines.push(`- **失敗試合数 (Failed):** ${failedMatches}`);
  lines.push(`- **未完試合数 (Incomplete):** ${incompleteMatches}`);
  lines.push(`- **総意思決定数:** ${output.totalDecisions} (Max: ${output.maxDecisionsInSingleMatch}, Min: ${output.minDecisionsInSingleMatch})`);
  lines.push(``);
  lines.push(`## 3. 対戦相手別 統計結果サマリー (Bonferroni alpha = ${HOLDOUT_BONFERRONI_ALPHA})`);
  lines.push(``);
  lines.push(`| 対戦相手 | Role | ペア数 | 平均勝率 | 95% CI (両側) | 片側信頼下限 (Bonferroni) | 目標勝率 | 目標達成 | 検定結果 |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);

  for (const opp of Object.values(evaluationResult.opponents)) {
    const ciStr = `[${opp.confidenceInterval95.lower.toFixed(3)}, ${opp.confidenceInterval95.upper.toFixed(3)}]`;
    const lowerBoundStr = opp.statisticalTest.oneSidedLowerBound.toFixed(3);
    const sigStr = opp.statisticalTest.isStatisticallySignificant ? "SIGNIFICANT" : "NOT_SIG";
    lines.push(
      `| **${opp.opponentName}** | \`${opp.role}\` | ${opp.completedPairs}/${opp.totalPairs} | **${(opp.meanPairScore * 100).toFixed(1)}%** | ${ciStr} | ${lowerBoundStr} | ${(opp.targetWinRate * 100).toFixed(1)}% | \`${opp.targetMet}\` | \`${sigStr}\` |`
    );
  }

  lines.push(``);
  lines.push(`## 4. 総合認定ステータス`);
  lines.push(``);
  lines.push(`- **Evidence Status:** \`${evaluationResult.evidenceStatus}\``);
  lines.push(`- **Improvement Status:** \`${evaluationResult.improvementStatus}\``);
  lines.push(`- **Baseline Superior:** \`${evaluationResult.baselineSuperior}\``);
  lines.push(`- **Champion Improved:** \`${evaluationResult.championImproved}\``);
  lines.push(`- **All Targets Met:** \`${evaluationResult.allTargetsMet}\``);
  lines.push(``);
  lines.push(`## 5. Artifact Manifest SHA-256`);
  lines.push(``);
  lines.push(`\`\`\`json`);
  lines.push(JSON.stringify(manifestSha256, null, 2));
  lines.push(`\`\`\``);

  return lines.join("\n");
}

export function saveHoldoutArtifacts(
  output: HoldoutEvaluationOutput,
  artifactsDir: string = DEFAULT_HOLDOUT_ARTIFACTS_DIR
): SaveHoldoutArtifactsResult {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const savedFiles: string[] = [];

  // 1. preflight-manifest.json
  const preflightPath = path.join(artifactsDir, "preflight-manifest.json");
  fs.writeFileSync(preflightPath, JSON.stringify(output.preflightManifest, null, 2), "utf8");
  savedFiles.push("preflight-manifest.json");

  // 2. holdout-evaluation-protocol.json
  const protocolPath = path.join(artifactsDir, "holdout-evaluation-protocol.json");
  const protocolData = {
    workId: output.preflightManifest.workId,
    executionMode: output.preflightManifest.executionMode,
    regulationId: output.preflightManifest.regulationId,
    frameId: output.preflightManifest.frameId,
    candidateChampion: output.preflightManifest.candidateChampion,
    oldChampion: output.preflightManifest.oldChampion,
    zeroDnaDigest: output.preflightManifest.zeroDnaDigest,
    seeds: output.preflightManifest.seeds,
    opponents: output.preflightManifest.opponents,
    plannedMatches: output.preflightManifest.plannedMatches,
    significanceLevelAlpha: HOLDOUT_SIGNIFICANCE_ALPHA,
    bonferroniAdjustedAlpha: HOLDOUT_BONFERRONI_ALPHA,
    decisionLimitPerMatch: DEFAULT_MAX_DECISIONS_PER_MATCH,
  };
  fs.writeFileSync(protocolPath, JSON.stringify(protocolData, null, 2), "utf8");
  savedFiles.push("holdout-evaluation-protocol.json");

  // 3. holdout-evaluation-result.json
  const resultPath = path.join(artifactsDir, "holdout-evaluation-result.json");
  const resultData = {
    evaluationSummary: output.evaluationResult.logicalResult,
    individualOutcomes: output.allIndividualOutcomes,
    runtimeMetrics: output.evaluationResult.runtimeMetrics,
  };
  fs.writeFileSync(resultPath, JSON.stringify(resultData, null, 2), "utf8");
  savedFiles.push("holdout-evaluation-result.json");

  // 4. holdout-evaluation-evidence.json
  const evidencePath = path.join(artifactsDir, "holdout-evaluation-evidence.json");
  const evidenceData = {
    workId: output.preflightManifest.workId,
    timestamp: output.preflightManifest.runnerTimestamp,
    gitCommitSha: output.preflightManifest.gitCommitSha,
    isGitClean: output.preflightManifest.isGitClean,
    candidateChampionGenomeId: output.preflightManifest.candidateChampion.genomeId,
    candidateChampionDnaDigest: output.preflightManifest.candidateChampion.verifiedDigest,
    oldChampionGenomeId: output.preflightManifest.oldChampion.genomeId,
    oldChampionDnaDigest: output.preflightManifest.oldChampion.verifiedDigest,
    totalMatches: output.totalMatches,
    completedMatches: output.completedMatches,
    failedMatches: output.failedMatches,
    incompleteMatches: output.incompleteMatches,
    evidenceStatus: output.evaluationResult.evidenceStatus,
    improvementStatus: output.evaluationResult.improvementStatus,
    baselineSuperior: output.evaluationResult.baselineSuperior,
    championImproved: output.evaluationResult.championImproved,
    allTargetsMet: output.evaluationResult.allTargetsMet,
    opponentsSummary: output.evaluationResult.opponents,
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidenceData, null, 2), "utf8");
  savedFiles.push("holdout-evaluation-evidence.json");

  // 仮の MANIFEST_SHA256 を計算して Markdown レポートを生成
  const interimManifest: Record<string, string> = {};
  for (const f of savedFiles) {
    interimManifest[f] = computeFileSha256(path.join(artifactsDir, f));
  }

  const auditReportMd = generateHoldoutAuditMarkdown(output, interimManifest);

  // 5. STAGE3_HOLDOUT_AUDIT_REPORT.md
  const auditReportPath = path.join(artifactsDir, "STAGE3_HOLDOUT_AUDIT_REPORT.md");
  fs.writeFileSync(auditReportPath, auditReportMd, "utf8");
  savedFiles.push("STAGE3_HOLDOUT_AUDIT_REPORT.md");

  // 6. AUDIT_HOLDOUT_EVIDENCE.md (同義エイリアス)
  const auditEvidencePath = path.join(artifactsDir, "AUDIT_HOLDOUT_EVIDENCE.md");
  fs.writeFileSync(auditEvidencePath, auditReportMd, "utf8");
  savedFiles.push("AUDIT_HOLDOUT_EVIDENCE.md");

  // 7. MANIFEST_SHA256.json の最終確定
  const finalManifest: Record<string, string> = {};
  for (const f of savedFiles) {
    finalManifest[f] = computeFileSha256(path.join(artifactsDir, f));
  }
  const manifestPath = path.join(artifactsDir, "MANIFEST_SHA256.json");
  fs.writeFileSync(manifestPath, JSON.stringify(finalManifest, null, 2), "utf8");
  savedFiles.push("MANIFEST_SHA256.json");

  return {
    artifactsDir,
    savedFiles,
    manifestSha256: finalManifest,
  };
}

// =============================================================================
// 自己監査機能 (Fail-Closed)
// =============================================================================

export function auditHoldoutArtifacts(artifactsDir: string): AuditHoldoutResult {
  const errors: string[] = [];
  const checkedFiles: string[] = [];

  const manifestPath = path.join(artifactsDir, "MANIFEST_SHA256.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      isValid: false,
      checkedFiles,
      errors: [`Manifest file not found: "${manifestPath}"`],
      totalMatches: 0,
      completedMatches: 0,
      failedMatches: 0,
      incompleteMatches: 0,
      candidateDigest: "",
      candidateDigestMatches: false,
      oldChampionDigest: "",
      oldChampionDigestMatches: false,
      allBaselineTargetsMet: false,
      evidenceStatus: "INVALID_EVIDENCE",
      improvementStatus: "CONFIRMED_REGRESSION",
    };
  }

  const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // 必須ファイルの存在とハッシュ照合
  const requiredFiles = [
    "preflight-manifest.json",
    "holdout-evaluation-protocol.json",
    "holdout-evaluation-result.json",
    "holdout-evaluation-evidence.json",
    "STAGE3_HOLDOUT_AUDIT_REPORT.md",
    "AUDIT_HOLDOUT_EVIDENCE.md",
  ];

  for (const f of requiredFiles) {
    checkedFiles.push(f);
    const expectedSha = manifest[f];
    if (!expectedSha) {
      errors.push(`Required file "${f}" missing in MANIFEST_SHA256.json`);
      continue;
    }
    const realPath = path.join(artifactsDir, f);
    if (!fs.existsSync(realPath)) {
      errors.push(`Required file "${f}" not found on disk at "${realPath}"`);
      continue;
    }
    const actualSha = computeFileSha256(realPath);
    if (actualSha !== expectedSha) {
      errors.push(`SHA-256 mismatch for "${f}": expected "${expectedSha}", but got "${actualSha}"`);
    }
  }

  // 結果ファイルの内容検証
  const resultPath = path.join(artifactsDir, "holdout-evaluation-result.json");
  const resultJson = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const outcomes: readonly HoldoutIndividualMatchOutcome[] = resultJson.individualOutcomes ?? [];

  let completedMatches = 0;
  let failedMatches = 0;
  let incompleteMatches = 0;

  for (const m of outcomes) {
    if (m.completed) completedMatches++;
    if (m.failed) failedMatches++;
    if (m.incomplete) incompleteMatches++;
  }

  if (failedMatches > 0) errors.push(`Detected ${failedMatches} failed match(es)`);
  if (incompleteMatches > 0) errors.push(`Detected ${incompleteMatches} incomplete match(es)`);

  const evidencePath = path.join(artifactsDir, "holdout-evaluation-evidence.json");
  const evidenceJson = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

  const candidateDigest = evidenceJson.candidateChampionDnaDigest;
  const candidateDigestMatches = candidateDigest === CANDIDATE_CHAMPION_EXPECTED_DIGEST;
  if (!candidateDigestMatches) {
    errors.push(
      `Candidate DNA digest mismatch: expected "${CANDIDATE_CHAMPION_EXPECTED_DIGEST}", but got "${candidateDigest}"`
    );
  }

  const oldChampionDigest = evidenceJson.oldChampionDnaDigest;
  const oldChampionDigestMatches = oldChampionDigest === OLD_CHAMPION_EXPECTED_DIGEST;
  if (!oldChampionDigestMatches) {
    errors.push(
      `Old Champion DNA digest mismatch: expected "${OLD_CHAMPION_EXPECTED_DIGEST}", but got "${oldChampionDigest}"`
    );
  }

  const allBaselineTargetsMet = evidenceJson.baselineSuperior === true;
  const evidenceStatus = evidenceJson.evidenceStatus;
  const improvementStatus = evidenceJson.improvementStatus;

  return {
    isValid: errors.length === 0,
    checkedFiles,
    errors,
    totalMatches: outcomes.length,
    completedMatches,
    failedMatches,
    incompleteMatches,
    candidateDigest,
    candidateDigestMatches,
    oldChampionDigest,
    oldChampionDigestMatches,
    allBaselineTargetsMet,
    evidenceStatus,
    improvementStatus,
  };
}

// =============================================================================
// ZIP パッケージ化
// =============================================================================

export function packageHoldoutZip(
  artifactsDir: string = DEFAULT_HOLDOUT_ARTIFACTS_DIR,
  zipPath: string = DEFAULT_HOLDOUT_ZIP_PATH
): { zipPath: string; zipSha256: string; zipSizeBytes: number } {
  const resolvedArtifactsDir = path.resolve(artifactsDir);
  const resolvedZipPath = path.resolve(zipPath);

  if (!fs.existsSync(resolvedArtifactsDir)) {
    throw new Error(`Artifacts directory not found: "${resolvedArtifactsDir}"`);
  }

  // ディレクトリ内の全ファイルを再帰的に収集
  const zipData: Record<string, Uint8Array> = {};

  function addDir(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        addDir(fullPath, relativePath);
      } else if (entry.isFile()) {
        const fileBytes = fs.readFileSync(fullPath);
        zipData[relativePath] = new Uint8Array(fileBytes);
      }
    }
  }

  addDir(resolvedArtifactsDir, "");

  const zippedBytes = fflate.zipSync(zipData, { level: 6 });
  fs.writeFileSync(resolvedZipPath, Buffer.from(zippedBytes));

  const stat = fs.statSync(resolvedZipPath);
  const zipSha256 = computeFileSha256(resolvedZipPath);

  return {
    zipPath: resolvedZipPath,
    zipSha256,
    zipSizeBytes: stat.size,
  };
}

// =============================================================================
// メイン実行エントリーポイント
// =============================================================================

export async function runStage3Holdout(options: {
  dryRun?: boolean;
  smoke?: boolean;
  execute?: boolean;
  outputDir?: string;
}): Promise<void> {
  const { dryRun = false, smoke = false, execute = false, outputDir = DEFAULT_HOLDOUT_ARTIFACTS_DIR } = options;

  console.log(`=== Stage 3 Champion Holdout Evaluation Runner ===`);
  console.log(`Work ID:       ${HOLDOUT_WORK_ID}`);
  console.log(`Output Dir:    ${outputDir}`);
  console.log(`Mode:          ${execute ? "EXECUTE (FULL HOLDOUT)" : smoke ? "SMOKE (DIAGNOSTIC)" : "DRY-RUN"}`);

  // Step 1: 環境 & 出力先ディレクトリの保護検証
  const gitInfo = checkGitCleanliness();
  console.log(`Git Commit:    ${gitInfo.headCommitSha} (Clean: ${gitInfo.isClean})`);
  validateArtifactsDirectory(outputDir);

  // Step 2: DNA 読み込み & 真正性検証
  const candidatePath = path.resolve(
    PROTECTED_RETRAIN_DIR,
    "campaign-stage3-evolution-checkpoint.json"
  );
  const oldChampPath = path.resolve(
    PROTECTED_OLD_STAGE3_DIR,
    "campaign-stage3-evolution-checkpoint.json"
  );

  console.log(`Loading Candidate Champion DNA from "${candidatePath}"...`);
  const candidateDNA = loadChampionDNA({
    checkpointPath: candidatePath,
    expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
    expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
  });

  console.log(`Loading Old Champion DNA from "${oldChampPath}"...`);
  const oldChampionDNA = loadChampionDNA({
    checkpointPath: oldChampPath,
    expectedGenomeId: OLD_CHAMPION_GENOME_ID,
    expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
  });

  console.log(`Generating ZeroDNA...`);
  const zeroDNA = createZeroDNA();

  // Step 3: Seed 計画と衝突検証
  let targetSeeds: readonly number[];
  let executionMode: "EXECUTE" | "DRY_RUN" | "SMOKE";

  if (smoke) {
    targetSeeds = SMOKE_DIAGNOSTIC_SEEDS;
    executionMode = "SMOKE";
    console.log(`Selected diagnostic smoke seeds: [${targetSeeds.join(", ")}]`);
  } else {
    targetSeeds = OFFICIAL_HOLDOUT_SEEDS;
    executionMode = execute ? "EXECUTE" : "DRY_RUN";
    console.log(`Selected official holdout seeds: ${targetSeeds.length} seeds (${targetSeeds[0]}..${targetSeeds[targetSeeds.length - 1]})`);
    console.log(`Verifying cross-category seed collision...`);
    validateHoldoutSeedPlan(targetSeeds);
    console.log(`Seed collision verification: PASS (Zero collisions detected).`);
  }

  // Step 4: Preflight Manifest 生成
  const preflightManifest = buildHoldoutPreflightManifest({
    candidateDNA,
    candidateSourcePath: candidatePath,
    oldChampionDNA,
    oldChampionSourcePath: oldChampPath,
    zeroDNA,
    seeds: targetSeeds,
    executionMode,
    artifactsDir: outputDir,
    gitInfo,
  });

  // DRY-RUN の場合は試合を実行せずに Preflight のみ保存・検証して終了
  if (executionMode === "DRY_RUN") {
    console.log(`\n[DRY-RUN] Preflight checks completed successfully.`);
    console.log(`Official Holdout 240 matches are PROTECTED from premature execution.`);
    console.log(`Preflight Manifest created in memory. Halting per protocol.`);
    return;
  }

  // Step 5: 評価実行 (SMOKE または EXECUTE)
  console.log(`\nPreparing official session factory for regulation "${HOLDOUT_REGULATION_ID}"...`);
  const sessionFactory = await prepareOfficialSessionFactory(HOLDOUT_REGULATION_ID);

  console.log(`Starting Evaluation (${preflightManifest.plannedMatches.totalMatches} matches planned)...`);
  const output = executeHoldoutEvaluation({
    candidateDNA,
    oldChampionDNA,
    zeroDNA,
    seeds: targetSeeds,
    preflightManifest,
    sessionFactory,
  });

  console.log(`\nEvaluation completed in ${(output.executionElapsedMs / 1000).toFixed(2)}s.`);
  console.log(`Matches completed: ${output.completedMatches}/${output.totalMatches} (Failed: ${output.failedMatches}, Incomplete: ${output.incompleteMatches})`);
  console.log(`Total decisions:   ${output.totalDecisions} (Max: ${output.maxDecisionsInSingleMatch}, Min: ${output.minDecisionsInSingleMatch})`);

  // Step 6: 成果物保存
  console.log(`\nSaving artifacts to "${outputDir}"...`);
  const saveResult = saveHoldoutArtifacts(output, outputDir);
  console.log(`Saved ${saveResult.savedFiles.length} files.`);

  // Step 7: 自己監査
  console.log(`\nAuditing generated artifacts...`);
  const auditResult = auditHoldoutArtifacts(outputDir);
  if (!auditResult.isValid) {
    throw new Error(`[Audit Failed] Errors encountered:\n${auditResult.errors.join("\n")}`);
  }
  console.log(`Self-Audit: PASS (All integrity checks verified).`);

  // Step 8: ZIP 生成
  const zipPath = path.resolve(outputDir, "../", `${path.basename(outputDir)}.zip`);
  console.log(`Packaging artifact zip at "${zipPath}"...`);
  const zipResult = packageHoldoutZip(outputDir, zipPath);
  console.log(`Zip generated: ${zipResult.zipSizeBytes} bytes (SHA-256: ${zipResult.zipSha256})`);

  console.log(`\n=== Stage 3 Champion Holdout Evaluation Runner Complete ===\n`);
}

// 直接実行時のエントリポイント
const isMainScript =
  (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) ||
  process.argv.some((arg) => arg.includes("stage3HoldoutRunner"));

if (isMainScript && !process.env.VITEST && !process.argv.includes("--no-auto-run")) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const smoke = args.includes("--smoke");
  const execute = args.includes("--execute");

  let outputDir = DEFAULT_HOLDOUT_ARTIFACTS_DIR;
  const outIdx = args.indexOf("--output-dir");
  if (outIdx !== -1 && args[outIdx + 1]) {
    outputDir = args[outIdx + 1];
  }

  await runStage3Holdout({ dryRun, smoke, execute, outputDir }).catch((err) => {
    console.error(`[FATAL ERROR] Holdout Runner terminated with error:`, err);
    process.exit(1);
  });
}
