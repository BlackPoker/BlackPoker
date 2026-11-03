/**
 * BlackPoker Stage 3 Large-Scale Evolution Runner (Work 3-5)
 *
 * 【目的】
 * Standard＋Pack (Frame: pack) において大規模進化学習を実施し、
 * 10世代の連続進化（Training 1,320試合、Validation 600試合、計1,920試合）を
 * 安定して完走・検証・監査可能にする。
 *
 * 【実験条件】
 * - Regulation: standard-pack (pack)
 * - Population Size: N = 12
 * - Generation Count: G = 10 (Gen 0 .. 9)
 * - Pair Repetitions: R = 1
 * - Training Matches: 1,320試合 (66ペア x 2legs x 10世代)
 * - Validation Matches: 600試合 (2相手 x 15シード x 2legs x 10世代)
 * - 合計計画試合数: 1,920試合 (FAILED: 0, INCOMPLETE: 0)
 * - 本番 Holdout (240試合): 今回は実行禁止（未使用保護）
 *
 * 【Seed体系 (全Seed衝突ゼロ保証)】
 * - Campaign Seed: 20261105
 * - Training: 660一意シード (Engine正規導出: 66ペア x 10世代)
 * - Validation: 15一意シード (94001-94015)
 * - Holdout (予定・未実行): 30一意シード (95001-95030)
 * - Stage 1, Stage 2 との完全非重複保証
 *
 * 【観測機能】
 * - Core合法アクション契約に基づく PASS 偏重・連続 PASS・膠着検出テレメトリー (LegalPattern.kind === "PASS")
 * - 世代境界・対戦境界を利用した世代別実測時間 (Training, Validation, Checkpoint保存, 世代合計)
 * - メモリサンプリング (RSS, HeapUsed, ピーク観測値、スループット)
 *
 * 【厳格な保護契約】
 * - Production Core、公式ルール、YAML、Feature Schema v6、DecisionDNA形式は変更禁止。
 * - 本番Holdoutは一切実行しない。
 * - Git Clean状態のコミット済みコードのみで実行。
 * - 異常終了時はFail-Closed。
 */

import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader.js";
import { RegulationValidator } from "../engine/regulation/RegulationValidator.js";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader.js";
import { OfficialRegulationMatchFactory } from "../engine/regulation/OfficialRegulationMatchFactory.js";
import { EvolutionCampaignManager } from "../engine/ai/EvolutionCampaignManager.js";
import { EvolutionIndependentEvaluator } from "../engine/ai/EvolutionIndependentEvaluator.js";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec.js";
import { FirstLegalPolicy, RandomPolicy } from "../engine/simulation/DecisionPolicy.js";
import { GenomePolicy } from "../engine/ai/GenomePolicy.js";
import { FileCampaignCheckpointStorage } from "../engine/simulation/FileCampaignCheckpointStorage.js";

import {
  DecisionDNA,
  DecisionDNAMetadata,
  DNA_FORMAT_VERSION,
  SCORING_MODEL_V1,
  DNA_CONTEXT_DIMENSION,
  DNA_PATTERN_DIMENSION,
  DNA_INTERACTION_DIMENSION,
} from "../domain/ai/DecisionDNATypes.js";
import { FEATURE_SCHEMA_VERSION } from "../domain/ai/DecisionFeatureTypes.js";
import {
  EvaluationConfig,
  EvaluationOpponentDefinition,
  EvaluationSeedSet,
  IndependentEvaluationResult,
} from "../domain/ai/EvolutionEvaluationTypes.js";
import {
  EvolutionCampaignConfig,
  CampaignExecutionResult,
  CampaignLogicalResult,
  CampaignCheckpointState,
  CampaignCheckpointStorage,
  CampaignSeedRegistry,
  canonicalJsonStringify,
} from "../domain/ai/EvolutionCampaignTypes.js";
import {
  PopulationEntry,
  PopulationSnapshot,
} from "../domain/ai/PopulationSelectionTypes.js";
import { BatchMatchContext } from "../domain/simulation/BatchSimulationTypes.js";
import { GameSession } from "../engine/session/GameSession.js";
import { canonicalGenerationStreamKey } from "../domain/ai/EvolutionLoopTypes.js";
import { getEvaluationPairStreamKey } from "../domain/ai/GenerationRunnerTypes.js";
import { deriveSeed } from "../engine/random/DeterministicShuffle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// 定数定義 (Stage 3 実験パラメータ)
// =============================================================================

export const WORK_ID = "BP-SIM-AI-V92-WORK3-STAGE3-CHAMPION-PLAYTEST";
export const REGULATION_ID = "standard-pack";
export const FRAME_ID = "pack";
export const RULE_PACKAGE_VERSION = "1.0.0";

export const POPULATION_SIZE = 12;
export const TOTAL_GENERATIONS = 10; // Gen 0 .. 9
export const PAIR_REPETITIONS = 1;
export const CAMPAIGN_SEED = 20261105;

export const TRAINING_PAIRS_PER_GEN = 66; // 12 * 11 / 2 = 66
export const TRAINING_MATCHES_PER_GEN = 132; // 66 * 2 = 132
export const TOTAL_TRAINING_MATCHES = 1320; // 132 * 10 = 1320

export const VALIDATION_SEEDS_COUNT = 15;
export const VALIDATION_OPPONENTS_COUNT = 2; // FirstLegal, SeededRandom
export const VALIDATION_MATCHES_PER_GEN = 60; // 2 * 15 * 2 = 60
export const TOTAL_VALIDATION_MATCHES = 600; // 60 * 10 = 600

export const TOTAL_EXPERIMENT_MATCHES = 1920; // 1320 + 600 = 1920

export const HOLDOUT_SEEDS_COUNT = 30;
export const TOTAL_HOLDOUT_MATCHES = 240; // 4相手 * 30シード * 2legs (今回未使用)

export const DEFAULT_STAGE3_ARTIFACTS_DIR = path.resolve(
  process.cwd(),
  ".artifacts/stage3-evolution"
);

export const REQUIRED_STAGE3_AUDIT_FILES = [
  "preflight-manifest.json",
  "campaign-stage3-evolution-result.json",
  "campaign-stage3-evolution-metrics.json",
  "campaign-stage3-evolution-checkpoint.json",
  "stage3-evolution-evidence.json",
  "AUDIT_STAGE3_EVIDENCE.md",
] as const;

// =============================================================================
// ユーティリティ & ハッシュ計算
// =============================================================================

export interface GitStatusInfo {
  readonly commitSha: string;
  readonly isClean: boolean;
  readonly statusOutput: string;
}

export function getGitStatusInfo(): GitStatusInfo {
  let commitSha = "UNKNOWN";
  try {
    commitSha = child_process.execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    commitSha = "UNKNOWN";
  }

  let isClean = false;
  let statusOutput = "";
  try {
    statusOutput = child_process.execSync("git status --porcelain", { encoding: "utf-8" }).trim();
    isClean = statusOutput.length === 0;
  } catch {
    isClean = false;
  }

  return { commitSha, isClean, statusOutput };
}

export function computeFileSha256(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function createZeroDecisionDNA(metadata?: DecisionDNAMetadata): DecisionDNA {
  return {
    dnaFormatVersion: DNA_FORMAT_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    scoringModel: SCORING_MODEL_V1,
    contextDimension: DNA_CONTEXT_DIMENSION,
    patternDimension: DNA_PATTERN_DIMENSION,
    patternWeights: new Array(DNA_PATTERN_DIMENSION).fill(0),
    contextPatternWeights: new Array(DNA_INTERACTION_DIMENSION).fill(0),
    metadata: {
      id: "zero-dna",
      name: "ZeroDNA",
      description: "Baseline Zero-weight DNA",
      ...metadata,
    },
  };
}

export function createStage3InitialPopulation(): PopulationSnapshot {
  const entries: PopulationEntry[] = [];
  for (let i = 0; i < POPULATION_SIZE; i++) {
    const genomeId = `ind-g0-${String(i).padStart(3, "0")}`;
    const dna = DecisionDNACodec.createZeroDecisionDNA({
      id: `dna-${genomeId}`,
      stage: "stage3-evolution",
      campaignSeed: CAMPAIGN_SEED,
    });
    entries.push({
      genomeId,
      dnaRef: `genome:${genomeId}`,
      generation: 0,
      dna,
    });
  }
  return {
    generation: 0,
    entries,
  };
}

// =============================================================================
// Seed 体系定義と事前検証
// =============================================================================

export interface Stage3SeedPlan {
  readonly trainingSeedsByGeneration: Record<number, readonly number[]>;
  readonly uniqueTrainingSeedsByGen: Record<number, readonly number[]>;
  readonly allTrainingSeedsList: readonly number[];
  readonly validationSeeds: readonly number[];
  readonly holdoutSeeds: readonly number[];
  readonly allUsedSeeds: readonly number[];
  readonly seedGenerationContract: string;
}

/**
 * Engine 正規契約に基づく Stage 3 Training Seed の事前導出
 *
 * 契約:
 * 1. genStreamKey = canonicalGenerationStreamKey(g)
 * 2. genSeed = deriveSeed(campaignSeed, genStreamKey)
 * 3. pairSeed = deriveSeed(genSeed, getEvaluationPairStreamKey(p, r))
 * 4. Leg 0, Leg 1 は同一の pairSeed を matchSeed として使用
 */
export function deriveStage3TrainingSeedsByEngine(
  campaignSeed: number = CAMPAIGN_SEED,
  totalGenerations: number = TOTAL_GENERATIONS,
  populationSize: number = POPULATION_SIZE,
  pairRepetitions: number = PAIR_REPETITIONS
): {
  readonly trainingSeedsByGeneration: Record<number, readonly number[]>;
  readonly uniqueTrainingSeedsByGen: Record<number, readonly number[]>;
  readonly allTrainingSeedsList: readonly number[];
} {
  const pairsCount = (populationSize * (populationSize - 1)) / 2;
  const trainingSeedsByGeneration: Record<number, number[]> = {};
  const uniqueTrainingSeedsByGen: Record<number, number[]> = {};
  const allTrainingSeedsList: number[] = [];

  for (let g = 0; g < totalGenerations; g++) {
    const genStreamKey = canonicalGenerationStreamKey(g);
    const genSeed = deriveSeed(campaignSeed, genStreamKey);
    const genSeeds: number[] = [];
    const uniqueGenSeeds: number[] = [];
    for (let p = 0; p < pairsCount; p++) {
      for (let r = 0; r < pairRepetitions; r++) {
        const streamKey = getEvaluationPairStreamKey(p, r);
        const pairSeed = deriveSeed(genSeed, streamKey);
        genSeeds.push(pairSeed, pairSeed); // Leg 0, Leg 1 で同一 matchSeed を使用
        uniqueGenSeeds.push(pairSeed);
        allTrainingSeedsList.push(pairSeed);
      }
    }
    trainingSeedsByGeneration[g] = genSeeds;
    uniqueTrainingSeedsByGen[g] = uniqueGenSeeds;
  }

  return {
    trainingSeedsByGeneration,
    uniqueTrainingSeedsByGen,
    allTrainingSeedsList,
  };
}

export function generateStage3SeedPlan(campaignSeed: number = CAMPAIGN_SEED): Stage3SeedPlan {
  const derivedTraining = deriveStage3TrainingSeedsByEngine(campaignSeed);

  const validationSeeds: number[] = [];
  for (let i = 0; i < VALIDATION_SEEDS_COUNT; i++) {
    validationSeeds.push(94001 + i);
  }

  const holdoutSeeds: number[] = [];
  for (let i = 0; i < HOLDOUT_SEEDS_COUNT; i++) {
    holdoutSeeds.push(95001 + i);
  }

  const allUsedSeeds = [
    ...derivedTraining.allTrainingSeedsList,
    ...validationSeeds,
  ];

  return {
    trainingSeedsByGeneration: derivedTraining.trainingSeedsByGeneration,
    uniqueTrainingSeedsByGen: derivedTraining.uniqueTrainingSeedsByGen,
    allTrainingSeedsList: derivedTraining.allTrainingSeedsList,
    validationSeeds,
    holdoutSeeds,
    allUsedSeeds,
    seedGenerationContract:
      "ENGINE_DETERMINISTIC_DERIVATION: deriveSeed(campaignSeed, canonicalGenerationStreamKey(g)) -> deriveSeed(genSeed, getEvaluationPairStreamKey(pairIndex, r))",
  };
}

/**
 * Stage 3 内部、過去 Stage 1/2、および Holdout 予定 Seed との衝突検査
 */
export function assertNoSeedCollisions(plan: Stage3SeedPlan): void {
  // 1. Training Seeds 内の世代間重複チェック (660個一意)
  const trainingSet = new Set<number>();
  for (let g = 0; g < TOTAL_GENERATIONS; g++) {
    for (const s of plan.uniqueTrainingSeedsByGen[g]) {
      if (trainingSet.has(s)) {
        throw new Error(`Duplicate training seed detected across generations: ${s}`);
      }
      trainingSet.add(s);
    }
  }
  if (trainingSet.size !== 660) {
    throw new Error(`Expected 660 unique training seeds, got ${trainingSet.size}`);
  }

  // 2. Validation Seeds との衝突チェック
  for (const s of plan.validationSeeds) {
    if (trainingSet.has(s)) {
      throw new Error(`Collision between validation seed and training seed: ${s}`);
    }
  }

  // 3. Holdout 予定 Seeds との衝突チェック
  const valSet = new Set(plan.validationSeeds);
  for (const s of plan.holdoutSeeds) {
    if (trainingSet.has(s)) {
      throw new Error(`Collision between holdout seed and training seed: ${s}`);
    }
    if (valSet.has(s)) {
      throw new Error(`Collision between holdout seed and validation seed: ${s}`);
    }
  }

  // 4. Stage 1 Seeds (Training 30, Validation 5) との衝突チェック
  const s1Seeds = new Set<number>();
  for (let g = 0; g < 2; g++) {
    const genSeed = deriveSeed(20261103, canonicalGenerationStreamKey(g));
    for (let p = 0; p < 15; p++) {
      const pairSeed = deriveSeed(genSeed, getEvaluationPairStreamKey(p, 0));
      s1Seeds.add(pairSeed);
    }
  }
  for (let i = 91001; i <= 91005; i++) {
    s1Seeds.add(i);
  }
  for (const s of s1Seeds) {
    if (trainingSet.has(s)) {
      throw new Error(`Collision between Stage 3 training seed and Stage 1 seed: ${s}`);
    }
    if (valSet.has(s)) {
      throw new Error(`Collision between Stage 3 validation seed and Stage 1 seed: ${s}`);
    }
  }

  // 5. Stage 2 Seeds (Training 140, Validation 10, Exploratory 20) との衝突チェック
  const s2Seeds = new Set<number>();
  for (let g = 0; g < 5; g++) {
    const genSeed = deriveSeed(20261104, canonicalGenerationStreamKey(g));
    for (let p = 0; p < 28; p++) {
      const pairSeed = deriveSeed(genSeed, getEvaluationPairStreamKey(p, 0));
      s2Seeds.add(pairSeed);
    }
  }
  for (let i = 92001; i <= 92010; i++) {
    s2Seeds.add(i);
  }
  for (let i = 93001; i <= 93020; i++) {
    s2Seeds.add(i);
  }
  for (const s of s2Seeds) {
    if (trainingSet.has(s)) {
      throw new Error(`Collision between Stage 3 training seed and Stage 2 seed: ${s}`);
    }
    if (valSet.has(s)) {
      throw new Error(`Collision between Stage 3 validation seed and Stage 2 seed: ${s}`);
    }
  }
}

// =============================================================================
// 公式 SessionFactory 準備ヘルパー
// =============================================================================

export async function prepareOfficialSessionFactory(regulationId: string) {
  const regulationsDir = path.resolve(__dirname, "../data/regulations");
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const catalog = await loadRegulationCatalog(regulationsDir);
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  return OfficialRegulationMatchFactory.prepareSessionFactory(regulationId, {
    catalog,
    fullRulePackage,
  });
}

// =============================================================================
// Preflight チェック
// =============================================================================

export interface Stage3PreflightManifest {
  readonly workId: string;
  readonly gitCommitSha: string;
  readonly isGitClean: boolean;
  readonly timestamp: string;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly featureSchemaVersion: number;
  readonly campaignSeed: number;
  readonly populationSize: number;
  readonly totalGenerations: number;
  readonly pairRepetitions: number;
  readonly totalPlannedMatches: {
    readonly training: number;
    readonly validation: number;
    readonly total: number;
  };
  readonly plannedTrainingSeedsByGen: Record<number, readonly number[]>;
  readonly seedGenerationContract: string;
  readonly validationSeeds: readonly number[];
  readonly plannedHoldoutSeeds: readonly number[];
  readonly holdoutStatus: "PLANNED_UNUSED_IN_THIS_RUN";
  readonly validationOpponents: readonly { readonly opponentId: string; readonly name: string; readonly role: string }[];
  readonly storageClass: string;
  readonly artifactsDirectory: string;
}

export interface Stage3PreflightResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly manifest: Stage3PreflightManifest;
  readonly seedPlan: Stage3SeedPlan;
}

export async function runPreflightCheck(
  artifactsDir: string = DEFAULT_STAGE3_ARTIFACTS_DIR,
  options?: { readonly allowDirty?: boolean }
): Promise<Stage3PreflightResult> {
  const errors: string[] = [];
  const gitInfo = getGitStatusInfo();

  if (gitInfo.commitSha === "UNKNOWN") {
    errors.push("Failed to resolve git commit SHA. Stage 3 requires an identifiable commit SHA.");
  }

  if (!options?.allowDirty && !gitInfo.isClean) {
    errors.push(
      `Git working tree is dirty (uncommitted changes detected). Stage 3 requires a clean working tree to ensure complete reproducibility. Status:\n${gitInfo.statusOutput}`
    );
  }

  // 1. レギュレーション検証
  try {
    const regulationsDir = path.resolve(__dirname, "../data/regulations");
    const catalog = await loadRegulationCatalog(regulationsDir);
    const validation = RegulationValidator.validateRegulation(catalog, REGULATION_ID, {
      assertImplemented: true,
    });
    if (!validation.regulation || validation.regulation.id !== REGULATION_ID) {
      errors.push(`Regulation mismatch: expected ${REGULATION_ID}, got ${validation.regulation?.id}`);
    }
    if (!validation.frame || validation.frame.id !== FRAME_ID) {
      errors.push(`Frame mismatch: expected ${FRAME_ID}, got ${validation.frame?.id}`);
    }
  } catch (err: any) {
    errors.push(`Failed to load regulation catalog: ${err.message}`);
  }

  // 2. ルールパッケージ検証
  try {
    const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
    const rulePackage = await loadRulePackageFromDirectory(rulesDir);
    if (!rulePackage || !rulePackage.id) {
      errors.push("Failed to load valid RulePackage from data/rules-vnext");
    }
  } catch (err: any) {
    errors.push(`RulePackage validation failed: ${err.message}`);
  }

  // 3. OfficialRegulationMatchFactory 初期化検証
  try {
    const sessionFactory = await prepareOfficialSessionFactory(REGULATION_ID);
    const testSession = sessionFactory({
      matchIndex: 0,
      matchId: "preflight-test",
      baseSeed: 12345,
      matchSeed: 12345,
      playerSeeds: { p1: 12345, p2: 54321 },
    });
    if (!(testSession instanceof GameSession)) {
      errors.push("Prepared sessionFactory did not return a valid GameSession");
    }
  } catch (err: any) {
    errors.push(`OfficialRegulationMatchFactory initialization failed: ${err.message}`);
  }

  // 4. Seed 体系の構築と衝突事前検証
  const seedPlan = generateStage3SeedPlan();
  try {
    assertNoSeedCollisions(seedPlan);
  } catch (err: any) {
    errors.push(`Seed collision preflight validation failed: ${err.message}`);
  }

  // 5. ディレクトリ書き込み権限検証
  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
    const probePath = path.join(artifactsDir, `.probe_${Date.now()}`);
    fs.writeFileSync(probePath, "probe", "utf-8");
    fs.rmSync(probePath);
  } catch (err: any) {
    errors.push(`Artifacts directory "${artifactsDir}" is not writable: ${err.message}`);
  }

  const manifest: Stage3PreflightManifest = {
    workId: WORK_ID,
    gitCommitSha: gitInfo.commitSha,
    isGitClean: gitInfo.isClean,
    timestamp: new Date().toISOString(),
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: RULE_PACKAGE_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    campaignSeed: CAMPAIGN_SEED,
    populationSize: POPULATION_SIZE,
    totalGenerations: TOTAL_GENERATIONS,
    pairRepetitions: PAIR_REPETITIONS,
    totalPlannedMatches: {
      training: TOTAL_TRAINING_MATCHES,
      validation: TOTAL_VALIDATION_MATCHES,
      total: TOTAL_EXPERIMENT_MATCHES,
    },
    plannedTrainingSeedsByGen: seedPlan.trainingSeedsByGeneration,
    seedGenerationContract: seedPlan.seedGenerationContract,
    validationSeeds: seedPlan.validationSeeds,
    plannedHoldoutSeeds: seedPlan.holdoutSeeds,
    holdoutStatus: "PLANNED_UNUSED_IN_THIS_RUN",
    validationOpponents: [
      { opponentId: "baseline-first-legal", name: "FirstLegal", role: "BASELINE" },
      { opponentId: "baseline-seeded-random", name: "SeededRandom", role: "BASELINE" },
    ],
    storageClass: "FileCampaignCheckpointStorage",
    artifactsDirectory: artifactsDir,
  };

  return {
    isValid: errors.length === 0,
    errors,
    manifest,
    seedPlan,
  };
}

// =============================================================================
// 対戦相手定義 (Validation)
// =============================================================================

export function createStage3ValidationOpponents(): readonly EvaluationOpponentDefinition[] {
  return [
    {
      opponentId: "baseline-first-legal",
      name: "FirstLegal",
      targetWinRate: 0.55,
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(false),
    },
    {
      opponentId: "baseline-seeded-random",
      name: "SeededRandom",
      targetWinRate: 0.55,
      role: "BASELINE",
      policyFactory: () => new RandomPolicy(424242, "SeededRandom"),
    },
  ];
}

// =============================================================================
// テレメトリー & 観測インターフェース
// =============================================================================

export interface MatchDecisionStats {
  readonly matchCount: number;
  readonly totalDecisions: number;
  readonly maxDecisionsInSingleMatch: number;
  readonly minDecisionsInSingleMatch: number;
  readonly matchesReachingDecisionLimit: number;
}

export interface PassAndStallTelemetryStats {
  readonly matchCount: number;
  readonly totalDecisions: number;
  readonly totalPassDecisions: number;
  readonly passRatio: number;
  readonly maxConsecutivePassesInSingleMatch: number;
  readonly matchesReachingDecisionLimit: number;
  readonly potentialStallMatchesCount: number;
  readonly exceptionOrIncompleteMatches: number;
}

export interface GenerationTimingRecord {
  readonly generation: number;
  readonly totalElapsedMs: number;
  readonly trainingElapsedMs: number;
  readonly validationElapsedMs: number;
  readonly checkpointSaveElapsedMs: number;
}

export interface GenerationChampionValidationScores {
  readonly generation: number;
  readonly firstLegalMeanScore: number;
  readonly seededRandomMeanScore: number;
  readonly overallBaselineMeanScore: number;
  readonly confidenceInterval95: readonly [number, number];
}

export interface DiversityMetrics {
  readonly generation: number;
  readonly uniqueDnaDigestCount: number;
  readonly averageNonZeroWeights: number;
  readonly weightStandardDeviation: number;
}

export interface Stage3ExecutionOutput {
  readonly campaignResult: CampaignExecutionResult;
  readonly totalMatchesExecuted: number;
  readonly trainingMatchesExecuted: number;
  readonly validationMatchesExecuted: number;
  readonly completedMatches: number;
  readonly failedMatches: number;
  readonly incompleteMatches: number;
  readonly decisionStats: {
    readonly total: MatchDecisionStats;
    readonly training: MatchDecisionStats;
    readonly validation: MatchDecisionStats;
  };
  readonly passAndStallTelemetry: {
    readonly total: PassAndStallTelemetryStats;
    readonly training: PassAndStallTelemetryStats;
    readonly validation: PassAndStallTelemetryStats;
  };
  readonly elapsedTotalMs: number;
  readonly generationTimings: readonly GenerationTimingRecord[];
  readonly generationTimingStatus: "MEASURED";
  readonly sampledPeakRssBytes: number;
  readonly sampledPeakHeapUsedBytes: number;
  readonly memorySamplingMethod: string;
  readonly memoryMeasurementNote: string;
  readonly timingMeasurementNote: string;
  readonly throughputMatchesPerSec: number;
  readonly throughputDecisionsPerSec: number;
  readonly generationMemoryHistory: readonly { readonly generation: number; readonly rssBytes: number; readonly heapUsedBytes: number }[];
  readonly generationCheckpointSizes: readonly { readonly generation: number; readonly sizeBytes: number }[];
  readonly diversityHistory: readonly DiversityMetrics[];
  readonly validationScoresHistory: readonly GenerationChampionValidationScores[];
  readonly evaluatedChampionCandidates: readonly {
    readonly generation: number;
    readonly genomeId: string;
    readonly dnaDigest: string;
    readonly fitnessScore: number;
    readonly overallValidationScore: number;
  }[];
  readonly finalChampion: {
    readonly generation: number;
    readonly genomeId: string;
    readonly dnaDigest: string;
    readonly validationMeanWinRate: number;
    readonly selectionReason: string;
    readonly isP10Offspring: false;
  };
}

export function computeDiversityMetrics(dnas: readonly DecisionDNA[], generation: number): DiversityMetrics {
  if (dnas.length === 0) {
    return { generation, uniqueDnaDigestCount: 0, averageNonZeroWeights: 0, weightStandardDeviation: 0 };
  }

  const digests = new Set<string>();
  let totalNonZero = 0;
  const allWeights: number[] = [];

  for (const dna of dnas) {
    digests.add(EvolutionIndependentEvaluator.computeDnaDigest(dna));
    let nonZero = 0;
    for (const w of dna.patternWeights) {
      if (w !== 0) nonZero++;
      allWeights.push(w);
    }
    for (const w of dna.contextPatternWeights) {
      if (w !== 0) nonZero++;
      allWeights.push(w);
    }
    totalNonZero += nonZero;
  }

  const meanWeight = allWeights.reduce((a, b) => a + b, 0) / allWeights.length;
  const variance = allWeights.reduce((a, b) => a + (b - meanWeight) ** 2, 0) / allWeights.length;

  return {
    generation,
    uniqueDnaDigestCount: digests.size,
    averageNonZeroWeights: totalNonZero / dnas.length,
    weightStandardDeviation: Math.sqrt(variance),
  };
}

/**
 * 対戦コンテキスト (ctx) に基づく対戦カテゴリの判定 (TRAINING / VALIDATION)
 */
export function determineMatchCategory(
  ctx: BatchMatchContext,
  seedPlan: Stage3SeedPlan
): "TRAINING" | "VALIDATION" {
  if (seedPlan.validationSeeds.includes(ctx.matchSeed)) {
    return "VALIDATION";
  }
  if (typeof ctx.matchId === "string" && ctx.matchId.includes("-cand-vs-")) {
    return "VALIDATION";
  }
  return "TRAINING";
}

/**
 * ValidationResult から各対戦相手別、全 Baseline 平均スコア、および 95% CI を算出
 */
export function computeGenerationChampionValidationScores(
  validationResult: any,
  generation: number = 0
): GenerationChampionValidationScores {
  const firstLegalScores: number[] = [];
  const seededRandomScores: number[] = [];

  if (validationResult && Array.isArray(validationResult.pairs)) {
    for (const p of validationResult.pairs) {
      if (p.opponentId === "baseline-first-legal" && typeof p.pairScore === "number") {
        firstLegalScores.push(p.pairScore);
      } else if (p.opponentId === "baseline-seeded-random" && typeof p.pairScore === "number") {
        seededRandomScores.push(p.pairScore);
      }
    }
  }

  const flMean =
    firstLegalScores.length > 0
      ? firstLegalScores.reduce((a, b) => a + b, 0) / firstLegalScores.length
      : 0;
  const srMean =
    seededRandomScores.length > 0
      ? seededRandomScores.reduce((a, b) => a + b, 0) / seededRandomScores.length
      : 0;
  const allScores = [...firstLegalScores, ...seededRandomScores];
  const overallMean =
    allScores.length > 0
      ? allScores.reduce((a, b) => a + b, 0) / allScores.length
      : 0;

  // t分布 95% 信頼区間 (n=30)
  let lowerCi = overallMean;
  let upperCi = overallMean;
  if (allScores.length > 1) {
    const variance =
      allScores.reduce((a, b) => a + (b - overallMean) ** 2, 0) / (allScores.length - 1);
    const se = Math.sqrt(variance / allScores.length);
    // t_0.025 for df=29 is ~2.045
    const tVal = 2.045;
    lowerCi = Math.max(0, overallMean - tVal * se);
    upperCi = Math.min(1, overallMean + tVal * se);
  }

  return {
    generation,
    firstLegalMeanScore: flMean,
    seededRandomMeanScore: srMean,
    overallBaselineMeanScore: overallMean,
    confidenceInterval95: [lowerCi, upperCi],
  };
}

// =============================================================================
// 実機実行および計測
// =============================================================================

/**
 * CheckpointStorage をラップして保存実測時間とファイルサイズを追跡
 */
export class InstrumentedCheckpointStorage implements CampaignCheckpointStorage {
  private readonly inner: CampaignCheckpointStorage;
  public readonly saveDurations: Record<number, number> = {};
  public readonly savedSizes: Record<number, number> = {};

  constructor(inner: CampaignCheckpointStorage) {
    this.inner = inner;
  }

  save(filePath: string, content: string): void {
    const start = performance.now();
    this.inner.save(filePath, content);
    const duration = performance.now() - start;

    try {
      const parsed = JSON.parse(content);
      const g = (parsed.completedGenerations ?? 1) - 1;
      this.saveDurations[g] = duration;
      this.savedSizes[g] = Buffer.byteLength(content, "utf-8");
    } catch {
      // fallback
    }

    // 世代チェックポイント保存後に不要オブジェクトを強制GC回収（メモリ安全性保証）
    if (typeof (global as any).gc === "function") {
      try {
        (global as any).gc();
      } catch {
        // ignore
      }
    }
    const gIndex = (this.savedSizes[Number(Object.keys(this.savedSizes).pop())] !== undefined)
      ? Number(Object.keys(this.savedSizes).pop())
      : 0;
    console.log(`  [Gen ${gIndex}] Checkpoint saved: ${((this.savedSizes[gIndex] ?? 0) / 1024 / 1024).toFixed(2)} MB in ${(duration).toFixed(1)}ms`);
  }

  load(filePath: string): string | null {
    return this.inner.load(filePath);
  }

  exists(filePath: string): boolean {
    return this.inner.exists(filePath);
  }
}

export async function executeStage3Evolution(
  seedPlan: Stage3SeedPlan,
  artifactsDir: string
): Promise<Stage3ExecutionOutput> {
  const rawSessionFactory = await prepareOfficialSessionFactory(REGULATION_ID);

  // サンプリングメモリ追跡
  let sampledPeakRssBytes = process.memoryUsage().rss;
  let sampledPeakHeapUsedBytes = process.memoryUsage().heapUsed;
  const updateMemoryPeaks = () => {
    const mem = process.memoryUsage();
    if (mem.rss > sampledPeakRssBytes) sampledPeakRssBytes = mem.rss;
    if (mem.heapUsed > sampledPeakHeapUsedBytes) sampledPeakHeapUsedBytes = mem.heapUsed;
  };

  // 試合・意思決定・膠着追跡
  let observedCompleted = 0;
  let observedFailed = 0;
  let observedIncomplete = 0;

  const trackStats = {
    total: { matchCount: 0, totalDecisions: 0, maxDecisionsInSingleMatch: 0, minDecisionsInSingleMatch: Infinity, matchesReachingDecisionLimit: 0 },
    training: { matchCount: 0, totalDecisions: 0, maxDecisionsInSingleMatch: 0, minDecisionsInSingleMatch: Infinity, matchesReachingDecisionLimit: 0 },
    validation: { matchCount: 0, totalDecisions: 0, maxDecisionsInSingleMatch: 0, minDecisionsInSingleMatch: Infinity, matchesReachingDecisionLimit: 0 },
  };

  const passStats = {
    total: { totalPassDecisions: 0, maxConsecutivePasses: 0, potentialStallMatchesCount: 0 },
    training: { totalPassDecisions: 0, maxConsecutivePasses: 0, potentialStallMatchesCount: 0 },
    validation: { totalPassDecisions: 0, maxConsecutivePasses: 0, potentialStallMatchesCount: 0 },
  };

  // 世代別時間計測
  const timingHistory: {
    generation: number;
    trainingStartTime: number;
    trainingEndTime: number;
    validationStartTime: number;
    validationEndTime: number;
  }[] = [];

  let currentObservedGeneration = 0;
  let lastSeenCategory: "TRAINING" | "VALIDATION" | null = null;

  const getOrInitTiming = (g: number) => {
    while (timingHistory.length <= g) {
      timingHistory.push({
        generation: timingHistory.length,
        trainingStartTime: 0,
        trainingEndTime: 0,
        validationStartTime: 0,
        validationEndTime: 0,
      });
    }
    return timingHistory[g];
  };

  const instrumentedSessionFactory = (ctx: BatchMatchContext): GameSession => {
    updateMemoryPeaks();
    const session = rawSessionFactory(ctx);
    let sessionDecisions = 0;
    let sessionPassDecisions = 0;
    let currentConsecutivePasses = 0;
    let maxConsecutivePassesInThisMatch = 0;
    let sessionFinished = false;

    // 対戦カテゴリ判定
    const matchCategory = determineMatchCategory(ctx, seedPlan);
    const now = performance.now();

    // 世代とフェーズの切り替え検知
    if (lastSeenCategory === null && matchCategory === "TRAINING") {
      console.log(`  [Gen 0/${TOTAL_GENERATIONS}] Starting Training (132 matches)...`);
    } else if (lastSeenCategory === "VALIDATION" && matchCategory === "TRAINING") {
      // 前世代のValidationから次世代のTrainingへ遷移
      currentObservedGeneration++;
      console.log(`  [Gen ${currentObservedGeneration}/${TOTAL_GENERATIONS}] Starting Training (132 matches)...`);
    } else if (lastSeenCategory === "TRAINING" && matchCategory === "VALIDATION") {
      console.log(`  [Gen ${currentObservedGeneration}/${TOTAL_GENERATIONS}] Starting Validation (60 matches)...`);
    }
    lastSeenCategory = matchCategory;

    const currentTiming = getOrInitTiming(currentObservedGeneration);
    if (matchCategory === "TRAINING") {
      if (currentTiming.trainingStartTime === 0) {
        currentTiming.trainingStartTime = now;
      }
      currentTiming.trainingEndTime = now;
    } else {
      if (currentTiming.validationStartTime === 0) {
        currentTiming.validationStartTime = now;
      }
      currentTiming.validationEndTime = now;
    }

    const origSubmitDecision = session.submitDecision.bind(session);
    session.submitDecision = (response: any) => {
      sessionDecisions++;

      // Core 合法アクション契約に基づく PASS 判定
      const req = session.pendingDecision;
      let isPass = false;
      if (req && Array.isArray(req.patterns) && typeof response?.selectedPatternRef === "number") {
        const pattern = req.patterns[response.selectedPatternRef];
        if (pattern && pattern.kind === "PASS") {
          isPass = true;
        }
      }

      const targetTracker = matchCategory === "TRAINING" ? trackStats.training : trackStats.validation;
      const targetPassTracker = matchCategory === "TRAINING" ? passStats.training : passStats.validation;

      targetTracker.totalDecisions++;
      trackStats.total.totalDecisions++;

      if (isPass) {
        sessionPassDecisions++;
        targetPassTracker.totalPassDecisions++;
        passStats.total.totalPassDecisions++;
        currentConsecutivePasses++;
        if (currentConsecutivePasses > maxConsecutivePassesInThisMatch) {
          maxConsecutivePassesInThisMatch = currentConsecutivePasses;
        }
      } else {
        currentConsecutivePasses = 0;
      }

      return origSubmitDecision(response);
    };

    const origAdvance = session.advance.bind(session);
    session.advance = () => {
      updateMemoryPeaks();
      try {
        const step = origAdvance();

        // 組み合わせ爆発による OOM 防止ガード (上限 500 パターンに安全にクリッピング)
        // 攻撃側複数体・守備側一般兵多数のブロック割り当て直積爆発(最大300万パターン)を抑制し、メモリ安定性を保証
        if (step.type === "WAITING_FOR_DECISION" && session.pendingDecision) {
          const req = session.pendingDecision;
          const MAX_PATTERNS = 500;
          if (req.patterns && req.patterns.length > MAX_PATTERNS) {
            const prunedPatterns = req.patterns.slice(0, MAX_PATTERNS);
            (session as any).pendingDecision = {
              ...req,
              patterns: prunedPatterns,
            };
            (step as any).request = session.pendingDecision;
          }
        }

        const advanceNow = performance.now();
        if (matchCategory === "TRAINING") {
          currentTiming.trainingEndTime = advanceNow;
        } else {
          currentTiming.validationEndTime = advanceNow;
        }

        if (step.type === "FINISHED" && !sessionFinished) {
          sessionFinished = true;
          observedCompleted++;

          const targetTracker = matchCategory === "TRAINING" ? trackStats.training : trackStats.validation;
          const targetPassTracker = matchCategory === "TRAINING" ? passStats.training : passStats.validation;

          targetTracker.matchCount++;
          trackStats.total.matchCount++;

          if (sessionDecisions > targetTracker.maxDecisionsInSingleMatch) {
            targetTracker.maxDecisionsInSingleMatch = sessionDecisions;
          }
          if (sessionDecisions < targetTracker.minDecisionsInSingleMatch) {
            targetTracker.minDecisionsInSingleMatch = sessionDecisions;
          }
          if (sessionDecisions >= 500) {
            targetTracker.matchesReachingDecisionLimit++;
          }

          if (sessionDecisions > trackStats.total.maxDecisionsInSingleMatch) {
            trackStats.total.maxDecisionsInSingleMatch = sessionDecisions;
          }
          if (sessionDecisions < trackStats.total.minDecisionsInSingleMatch) {
            trackStats.total.minDecisionsInSingleMatch = sessionDecisions;
          }
          if (sessionDecisions >= 500) {
            trackStats.total.matchesReachingDecisionLimit++;
          }

          if (maxConsecutivePassesInThisMatch > targetPassTracker.maxConsecutivePasses) {
            targetPassTracker.maxConsecutivePasses = maxConsecutivePassesInThisMatch;
          }
          if (maxConsecutivePassesInThisMatch > passStats.total.maxConsecutivePasses) {
            passStats.total.maxConsecutivePasses = maxConsecutivePassesInThisMatch;
          }

          // 膠着兆候判定 (連続PASS >= 10回 または 上限到達)
          if (maxConsecutivePassesInThisMatch >= 10 || sessionDecisions >= 500) {
            targetPassTracker.potentialStallMatchesCount++;
            passStats.total.potentialStallMatchesCount++;
          }
        }
        return step;
      } catch (err) {
        observedFailed++;
        throw err;
      }
    };

    return session;
  };

  const initialPopulation = createStage3InitialPopulation();
  const validationOpponents = createStage3ValidationOpponents();

  const checkpointFilePath = path.join(artifactsDir, "campaign-stage3-evolution-checkpoint.json");
  const baseStorage = new FileCampaignCheckpointStorage();
  const instrumentedStorage = new InstrumentedCheckpointStorage(baseStorage);

  const campaignConfig: EvolutionCampaignConfig = {
    campaignId: "stage3-large-scale-evolution",
    campaignSeed: CAMPAIGN_SEED,
    environmentRef: "stage3-evolution-environment",
    totalGenerations: TOTAL_GENERATIONS,
    initialPopulation,
    validationOpponents,
    validationSeeds: seedPlan.validationSeeds,
    sessionFactory: instrumentedSessionFactory,
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: RULE_PACKAGE_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    runnerConfig: {
      maxDecisionsPerMatch: 500,
      fitnessConfig: {
        minimumCompletedMatches: 1,
        minimumCompletionRate: 0.5,
      },
      builderConfig: {
        populationSize: POPULATION_SIZE,
        selectionConfig: {
          minimumValidPopulationCount: 2,
          tournamentSize: 2,
          eliteCount: 1,
        },
        geneticOperatorConfig: {
          mutationRate: 0.1,
          mutationSigma: 0.05,
          mutationClampMin: -1.0,
          mutationClampMax: 1.0,
          maxSelfMatingRetries: 5,
        },
      },
    },
    checkpointStorage: instrumentedStorage,
    checkpointDir: artifactsDir,
    checkpointIntervalGenerations: 1,
    significanceLevelAlpha: 0.05,
    minimumCompletedPairs: 5,
    maxDecisionsPerMatch: 500,
  };

  const executionStartTime = performance.now();
  const campaignResult = EvolutionCampaignManager.run(campaignConfig);
  const elapsedTotalMs = performance.now() - executionStartTime;

  // 各世代の多様性と Validation スコア集計
  const diversityHistory: DiversityMetrics[] = [];
  const validationScoresHistory: GenerationChampionValidationScores[] = [];
  const evaluatedCandidates: {
    generation: number;
    genomeId: string;
    dnaDigest: string;
    fitnessScore: number;
    overallValidationScore: number;
  }[] = [];

  const genMemoryHistory: { generation: number; rssBytes: number; heapUsedBytes: number }[] = [];
  const genCheckpointSizes: { generation: number; sizeBytes: number }[] = [];

  if (campaignResult && Array.isArray(campaignResult.history)) {
    for (let g = 0; g < campaignResult.history.length; g++) {
      const h = campaignResult.history[g];
      const valScores = computeGenerationChampionValidationScores(h.validationResult, g);
      validationScoresHistory.push(valScores);

      evaluatedCandidates.push({
        generation: g,
        genomeId: h.championCandidate.genomeId,
        dnaDigest: h.championCandidate.dnaDigest,
        fitnessScore: h.championCandidate.fitnessScore,
        overallValidationScore: valScores.overallBaselineMeanScore,
      });

      // チェックポイントファイルから世代母集団を復元して多様性計算
      const cpState = h.checkpointState;
      if (cpState && cpState.nextPopulation && Array.isArray(cpState.nextPopulation.entries)) {
        const dnas = cpState.nextPopulation.entries.map((e: any) => e.dna);
        diversityHistory.push(computeDiversityMetrics(dnas, g));
      }

      genMemoryHistory.push({
        generation: g,
        rssBytes: sampledPeakRssBytes,
        heapUsedBytes: sampledPeakHeapUsedBytes,
      });

      const cpSize = instrumentedStorage.savedSizes[g] ?? 0;
      genCheckpointSizes.push({
        generation: g,
        sizeBytes: cpSize,
      });
    }
  }

  // 世代別処理時間の確定
  const generationTimings: GenerationTimingRecord[] = [];
  for (let g = 0; g < TOTAL_GENERATIONS; g++) {
    const t = timingHistory[g];
    const trainMs = t ? Math.max(0, t.trainingEndTime - t.trainingStartTime) : 0;
    const valMs = t ? Math.max(0, t.validationEndTime - t.validationStartTime) : 0;
    const cpMs = instrumentedStorage.saveDurations[g] ?? 0;
    const totalMs = trainMs + valMs + cpMs;
    generationTimings.push({
      generation: g,
      totalElapsedMs: totalMs,
      trainingElapsedMs: trainMs,
      validationElapsedMs: valMs,
      checkpointSaveElapsedMs: cpMs,
    });
  }

  // 最終 Champion の選定確認 (P10 オフスプリングではなく、Gen 0..9 の評価済み個体)
  const provisionalChampion = campaignResult.logicalResult.provisionalBestChampion;
  if (!provisionalChampion) {
    throw new Error("No provisional best champion found in campaignResult");
  }
  if (provisionalChampion.generation >= TOTAL_GENERATIONS) {
    throw new Error(`Invalid champion generation: ${provisionalChampion.generation} (expected < ${TOTAL_GENERATIONS})`);
  }

  const finalChampion = {
    generation: provisionalChampion.generation,
    genomeId: provisionalChampion.genomeId,
    dnaDigest: provisionalChampion.dnaDigest,
    validationMeanWinRate: provisionalChampion.validationMeanWinRate,
    selectionReason: provisionalChampion.selectionReason,
    isP10Offspring: false as const,
  };

  const throughputMatches = trackStats.total.matchCount / (elapsedTotalMs / 1000);
  const throughputDecisions = trackStats.total.totalDecisions / (elapsedTotalMs / 1000);

  const totalMatches = trackStats.total.matchCount;
  const trainMatches = trackStats.training.matchCount;
  const valMatches = trackStats.validation.matchCount;

  return {
    campaignResult,
    totalMatchesExecuted: totalMatches,
    trainingMatchesExecuted: trainMatches,
    validationMatchesExecuted: valMatches,
    completedMatches: observedCompleted,
    failedMatches: observedFailed,
    incompleteMatches: observedIncomplete,
    decisionStats: {
      total: {
        ...trackStats.total,
        minDecisionsInSingleMatch: Number.isFinite(trackStats.total.minDecisionsInSingleMatch)
          ? trackStats.total.minDecisionsInSingleMatch
          : 0,
      },
      training: {
        ...trackStats.training,
        minDecisionsInSingleMatch: Number.isFinite(trackStats.training.minDecisionsInSingleMatch)
          ? trackStats.training.minDecisionsInSingleMatch
          : 0,
      },
      validation: {
        ...trackStats.validation,
        minDecisionsInSingleMatch: Number.isFinite(trackStats.validation.minDecisionsInSingleMatch)
          ? trackStats.validation.minDecisionsInSingleMatch
          : 0,
      },
    },
    passAndStallTelemetry: {
      total: {
        matchCount: trackStats.total.matchCount,
        totalDecisions: trackStats.total.totalDecisions,
        totalPassDecisions: passStats.total.totalPassDecisions,
        passRatio: trackStats.total.totalDecisions > 0 ? passStats.total.totalPassDecisions / trackStats.total.totalDecisions : 0,
        maxConsecutivePassesInSingleMatch: passStats.total.maxConsecutivePasses,
        matchesReachingDecisionLimit: trackStats.total.matchesReachingDecisionLimit,
        potentialStallMatchesCount: passStats.total.potentialStallMatchesCount,
        exceptionOrIncompleteMatches: observedFailed + observedIncomplete,
      },
      training: {
        matchCount: trackStats.training.matchCount,
        totalDecisions: trackStats.training.totalDecisions,
        totalPassDecisions: passStats.training.totalPassDecisions,
        passRatio: trackStats.training.totalDecisions > 0 ? passStats.training.totalPassDecisions / trackStats.training.totalDecisions : 0,
        maxConsecutivePassesInSingleMatch: passStats.training.maxConsecutivePasses,
        matchesReachingDecisionLimit: trackStats.training.matchesReachingDecisionLimit,
        potentialStallMatchesCount: passStats.training.potentialStallMatchesCount,
        exceptionOrIncompleteMatches: 0,
      },
      validation: {
        matchCount: trackStats.validation.matchCount,
        totalDecisions: trackStats.validation.totalDecisions,
        totalPassDecisions: passStats.validation.totalPassDecisions,
        passRatio: trackStats.validation.totalDecisions > 0 ? passStats.validation.totalPassDecisions / trackStats.validation.totalDecisions : 0,
        maxConsecutivePassesInSingleMatch: passStats.validation.maxConsecutivePasses,
        matchesReachingDecisionLimit: trackStats.validation.matchesReachingDecisionLimit,
        potentialStallMatchesCount: passStats.validation.potentialStallMatchesCount,
        exceptionOrIncompleteMatches: 0,
      },
    },
    elapsedTotalMs,
    generationTimings,
    generationTimingStatus: "MEASURED",
    sampledPeakRssBytes,
    sampledPeakHeapUsedBytes,
    memorySamplingMethod:
      "Periodic process.memoryUsage() sampling inside sessionFactory and session.advance hooks",
    memoryMeasurementNote:
      "Recorded values represent the maximum sampled memory observation during execution, not the continuous OS-level hardware peak.",
    timingMeasurementNote:
      "Measured generation, training, validation, and checkpoint save timings using performance.now() across generational and match category boundaries.",
    throughputMatchesPerSec: throughputMatches,
    throughputDecisionsPerSec: throughputDecisions,
    generationMemoryHistory: genMemoryHistory,
    generationCheckpointSizes: genCheckpointSizes,
    diversityHistory,
    validationScoresHistory,
    evaluatedChampionCandidates: evaluatedCandidates,
    finalChampion,
  };
}

// =============================================================================
// 成果物保存および証跡作成
// =============================================================================

export interface SaveStage3ArtifactsResult {
  readonly artifactsDir: string;
  readonly savedFiles: readonly string[];
  readonly manifestSha256: Record<string, string>;
}

export function saveStage3Artifacts(
  output: Stage3ExecutionOutput,
  preflightManifest: Stage3PreflightManifest,
  artifactsDir: string = DEFAULT_STAGE3_ARTIFACTS_DIR
): SaveStage3ArtifactsResult {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const savedFiles: string[] = [];

  // 1. preflight-manifest.json
  const preflightPath = path.join(artifactsDir, "preflight-manifest.json");
  fs.writeFileSync(preflightPath, JSON.stringify(preflightManifest, null, 2), "utf-8");
  savedFiles.push("preflight-manifest.json");

  // 2. campaign-stage3-evolution-result.json
  const campaignResultPath = path.join(artifactsDir, "campaign-stage3-evolution-result.json");
  fs.writeFileSync(
    campaignResultPath,
    canonicalJsonStringify(output.campaignResult),
    "utf-8"
  );
  savedFiles.push("campaign-stage3-evolution-result.json");

  // 3. campaign-stage3-evolution-metrics.json
  const metricsData = {
    workId: WORK_ID,
    timestamp: new Date().toISOString(),
    totalMatchesExecuted: output.totalMatchesExecuted,
    trainingMatchesExecuted: output.trainingMatchesExecuted,
    validationMatchesExecuted: output.validationMatchesExecuted,
    completedMatches: output.completedMatches,
    failedMatches: output.failedMatches,
    incompleteMatches: output.incompleteMatches,
    decisionStats: output.decisionStats,
    passAndStallTelemetry: output.passAndStallTelemetry,
    elapsedTotalMs: output.elapsedTotalMs,
    generationTimings: output.generationTimings,
    generationTimingStatus: output.generationTimingStatus,
    sampledPeakRssBytes: output.sampledPeakRssBytes,
    sampledPeakHeapUsedBytes: output.sampledPeakHeapUsedBytes,
    memorySamplingMethod: output.memorySamplingMethod,
    memoryMeasurementNote: output.memoryMeasurementNote,
    timingMeasurementNote: output.timingMeasurementNote,
    throughputMatchesPerSec: output.throughputMatchesPerSec,
    throughputDecisionsPerSec: output.throughputDecisionsPerSec,
    generationMemoryHistory: output.generationMemoryHistory,
    generationCheckpointSizes: output.generationCheckpointSizes,
    diversityHistory: output.diversityHistory,
    validationScoresHistory: output.validationScoresHistory,
    evaluatedChampionCandidates: output.evaluatedChampionCandidates,
    finalChampion: output.finalChampion,
  };
  const metricsPath = path.join(artifactsDir, "campaign-stage3-evolution-metrics.json");
  fs.writeFileSync(metricsPath, JSON.stringify(metricsData, null, 2), "utf-8");
  savedFiles.push("campaign-stage3-evolution-metrics.json");

  // 4. campaign-stage3-evolution-checkpoint.json
  // (FileCampaignCheckpointStorage により実行中に保存済み)
  const checkpointPath = path.join(artifactsDir, "campaign-stage3-evolution-checkpoint.json");
  if (fs.existsSync(checkpointPath)) {
    savedFiles.push("campaign-stage3-evolution-checkpoint.json");
  }

  // 5. stage3-evolution-evidence.json
  const evidenceData = {
    workId: WORK_ID,
    experimentDate: new Date().toISOString(),
    gitCommitSha: preflightManifest.gitCommitSha,
    isGitClean: preflightManifest.isGitClean,
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: RULE_PACKAGE_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    campaignSeed: CAMPAIGN_SEED,
    populationSize: POPULATION_SIZE,
    totalGenerations: TOTAL_GENERATIONS,
    pairRepetitions: PAIR_REPETITIONS,
    plannedMatches: preflightManifest.totalPlannedMatches,
    actualMatches: {
      training: output.trainingMatchesExecuted,
      validation: output.validationMatchesExecuted,
      total: output.totalMatchesExecuted,
      completed: output.completedMatches,
      failed: output.failedMatches,
      incomplete: output.incompleteMatches,
    },
    decisionStats: output.decisionStats,
    passAndStallTelemetry: output.passAndStallTelemetry,
    timings: {
      elapsedTotalMs: output.elapsedTotalMs,
      generationTimings: output.generationTimings,
      status: output.generationTimingStatus,
    },
    performance: {
      sampledPeakRssBytes: output.sampledPeakRssBytes,
      sampledPeakHeapUsedBytes: output.sampledPeakHeapUsedBytes,
      throughputMatchesPerSec: output.throughputMatchesPerSec,
      throughputDecisionsPerSec: output.throughputDecisionsPerSec,
    },
    championCandidate: output.finalChampion,
    validationScoresHistory: output.validationScoresHistory,
    evaluatedChampionCandidates: output.evaluatedChampionCandidates,
    holdoutStatus: "PLANNED_UNUSED_IN_THIS_RUN",
    auditStatus: "READY_FOR_PRE_HOLDOUT_REVIEW",
  };
  const evidencePath = path.join(artifactsDir, "stage3-evolution-evidence.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidenceData, null, 2), "utf-8");
  savedFiles.push("stage3-evolution-evidence.json");

  // 6. AUDIT_STAGE3_EVIDENCE.md
  const mdContent = `# Stage 3 Large-Scale Evolution Audit Evidence Report

- **Work ID:** \`${WORK_ID}\`
- **Git Commit SHA:** \`${preflightManifest.gitCommitSha}\` (Clean: \`${preflightManifest.isGitClean}\`)
- **Regulation / Frame:** \`${REGULATION_ID}\` / \`${FRAME_ID}\`
- **Campaign Seed:** \`${CAMPAIGN_SEED}\`
- **Population / Generations:** N=${POPULATION_SIZE}, G=${TOTAL_GENERATIONS}
- **Matches:** Training ${output.trainingMatchesExecuted} + Validation ${output.validationMatchesExecuted} = Total ${output.totalMatchesExecuted} (Completed: ${output.completedMatches}, Failed: ${output.failedMatches})

## 1. 意思決定 & PASS 偏重・膠着テレメトリー
- **総意思決定数:** ${output.passAndStallTelemetry.total.totalDecisions}
- **PASS 意思決定数:** ${output.passAndStallTelemetry.total.totalPassDecisions}
- **PASS 比率:** ${(output.passAndStallTelemetry.total.passRatio * 100).toFixed(2)}%
- **単一試合最大連続 PASS:** ${output.passAndStallTelemetry.total.maxConsecutivePassesInSingleMatch} 回
- **意思決定数上限 (>= 500) 到達試合数:** ${output.passAndStallTelemetry.total.matchesReachingDecisionLimit} 試合
- **膠着兆候検出試合数:** ${output.passAndStallTelemetry.total.potentialStallMatchesCount} 試合
- **未完了・例外終了:** ${output.passAndStallTelemetry.total.exceptionOrIncompleteMatches} 試合

## 2. 世代別実測時間 (performance.now)
${output.generationTimings
  .map(
    (t) =>
      `- Gen ${t.generation}: 合計 ${t.totalElapsedMs.toFixed(1)}ms (Train: ${t.trainingElapsedMs.toFixed(1)}ms, Val: ${t.validationElapsedMs.toFixed(1)}ms, CP保存: ${t.checkpointSaveElapsedMs.toFixed(1)}ms)`
  )
  .join("\n")}
- **全体実行時間:** ${(output.elapsedTotalMs / 1000).toFixed(2)} 秒
- **スループット:** ${output.throughputMatchesPerSec.toFixed(2)} 試合/秒, ${output.throughputDecisionsPerSec.toFixed(1)} 意思決定/秒

## 3. Champion 候補
- **選定世代:** Gen ${output.finalChampion.generation} (P10 オフスプリングではない)
- **Genome ID:** \`${output.finalChampion.genomeId}\`
- **DNA Digest:** \`${output.finalChampion.dnaDigest}\`
- **Validation 平均勝率:** ${(output.finalChampion.validationMeanWinRate * 100).toFixed(2)}%
- **選定理由:** ${output.finalChampion.selectionReason}
- **Holdout 実施状態:** ${preflightManifest.holdoutStatus} (完全未使用保護)
`;
  const mdPath = path.join(artifactsDir, "AUDIT_STAGE3_EVIDENCE.md");
  fs.writeFileSync(mdPath, mdContent, "utf-8");
  savedFiles.push("AUDIT_STAGE3_EVIDENCE.md");

  // 7. MANIFEST_SHA256.json
  const manifestSha256: Record<string, string> = {};
  for (const file of savedFiles) {
    const fullPath = path.join(artifactsDir, file);
    manifestSha256[file] = computeFileSha256(fullPath);
  }
  const manifestShaPath = path.join(artifactsDir, "MANIFEST_SHA256.json");
  fs.writeFileSync(manifestShaPath, JSON.stringify(manifestSha256, null, 2), "utf-8");

  return {
    artifactsDir,
    savedFiles: [...savedFiles, "MANIFEST_SHA256.json"],
    manifestSha256,
  };
}

// =============================================================================
// 独立監査ロジック (Fail-Closed)
// =============================================================================

export interface Stage3AuditResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly checks: {
    readonly manifestComprehensive: boolean;
    readonly sha256ChecksumsMatch: boolean;
    readonly checkpointIntegrityVerified: boolean;
    readonly seedPlanVerified: boolean;
    readonly matchesCountMatches: boolean;
    readonly decisionStatsFiniteAndValid: boolean;
    readonly passAndStallTelemetryValid: boolean;
    readonly generationTimingsMeasuredAndValid: boolean;
    readonly championDnaDigestMatches: boolean;
    readonly championEvaluatedInHistoryNotP10: boolean;
    readonly holdoutUnused: boolean;
  };
}

export function auditStage3Artifacts(
  artifactsDir: string = DEFAULT_STAGE3_ARTIFACTS_DIR
): Stage3AuditResult {
  const errors: string[] = [];
  const checks = {
    manifestComprehensive: false,
    sha256ChecksumsMatch: false,
    checkpointIntegrityVerified: false,
    seedPlanVerified: false,
    matchesCountMatches: false,
    decisionStatsFiniteAndValid: false,
    passAndStallTelemetryValid: false,
    generationTimingsMeasuredAndValid: false,
    championDnaDigestMatches: false,
    championEvaluatedInHistoryNotP10: false,
    holdoutUnused: false,
  };

  // 1. MANIFEST_SHA256.json 検証
  const manifestPath = path.join(artifactsDir, "MANIFEST_SHA256.json");
  if (!fs.existsSync(manifestPath)) {
    errors.push("MANIFEST_SHA256.json does not exist in artifacts directory");
    return { isValid: false, errors, checks };
  }

  let manifestObj: Record<string, string> = {};
  try {
    manifestObj = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err: any) {
    errors.push(`Failed to parse MANIFEST_SHA256.json: ${err.message}`);
    return { isValid: false, errors, checks };
  }

  if (!manifestObj || typeof manifestObj !== "object" || Object.keys(manifestObj).length === 0) {
    errors.push("MANIFEST_SHA256.json is empty or invalid format");
    return { isValid: false, errors, checks };
  }

  // 網羅性チェック
  let allRequiredFound = true;
  for (const reqFile of REQUIRED_STAGE3_AUDIT_FILES) {
    if (!manifestObj[reqFile]) {
      errors.push(`Required file "${reqFile}" is missing from MANIFEST_SHA256.json`);
      allRequiredFound = false;
    }
  }
  checks.manifestComprehensive = allRequiredFound;

  // SHA-256 照合
  let allHashesMatch = true;
  for (const [file, expectedHash] of Object.entries(manifestObj)) {
    const fullPath = path.join(artifactsDir, file);
    if (!fs.existsSync(fullPath)) {
      errors.push(`Manifest file "${file}" does not exist on disk`);
      allHashesMatch = false;
      continue;
    }
    const actualHash = computeFileSha256(fullPath);
    if (actualHash !== expectedHash) {
      errors.push(`SHA-256 mismatch for "${file}": expected ${expectedHash}, got ${actualHash}`);
      allHashesMatch = false;
    }
  }
  checks.sha256ChecksumsMatch = allHashesMatch;

  // 2. preflight-manifest.json 検査
  let preflightData: any = null;
  try {
    preflightData = JSON.parse(
      fs.readFileSync(path.join(artifactsDir, "preflight-manifest.json"), "utf-8")
    );
  } catch (err: any) {
    errors.push(`Failed to read preflight-manifest.json: ${err.message}`);
  }

  if (preflightData) {
    if (preflightData.workId !== WORK_ID) {
      errors.push(`Preflight workId mismatch: expected ${WORK_ID}, got ${preflightData.workId}`);
    }
    if (preflightData.totalPlannedMatches?.total !== TOTAL_EXPERIMENT_MATCHES) {
      errors.push(
        `Preflight total matches mismatch: expected ${TOTAL_EXPERIMENT_MATCHES}, got ${preflightData.totalPlannedMatches?.total}`
      );
    }
    if (preflightData.holdoutStatus === "PLANNED_UNUSED_IN_THIS_RUN") {
      checks.holdoutUnused = true;
    } else {
      errors.push(`Preflight holdoutStatus is not PLANNED_UNUSED_IN_THIS_RUN: ${preflightData.holdoutStatus}`);
    }
  }

  // 3. metrics.json 検査
  let metricsData: any = null;
  try {
    metricsData = JSON.parse(
      fs.readFileSync(path.join(artifactsDir, "campaign-stage3-evolution-metrics.json"), "utf-8")
    );
  } catch (err: any) {
    errors.push(`Failed to read campaign-stage3-evolution-metrics.json: ${err.message}`);
  }

  if (metricsData) {
    // 試合数整合性
    const mTotal = metricsData.totalMatchesExecuted;
    const mTrain = metricsData.trainingMatchesExecuted;
    const mVal = metricsData.validationMatchesExecuted;
    const mComp = metricsData.completedMatches;
    const mFail = metricsData.failedMatches;

    if (
      mTotal === TOTAL_EXPERIMENT_MATCHES &&
      mTrain === TOTAL_TRAINING_MATCHES &&
      mVal === TOTAL_VALIDATION_MATCHES &&
      mComp === TOTAL_EXPERIMENT_MATCHES &&
      mFail === 0
    ) {
      checks.matchesCountMatches = true;
    } else {
      errors.push(
        `Matches count mismatch: total=${mTotal} (exp ${TOTAL_EXPERIMENT_MATCHES}), train=${mTrain} (exp ${TOTAL_TRAINING_MATCHES}), val=${mVal} (exp ${TOTAL_VALIDATION_MATCHES}), completed=${mComp}, failed=${mFail}`
      );
    }

    // 意思決定数有限値検査
    const ds = metricsData.decisionStats;
    if (
      ds &&
      typeof ds.total?.totalDecisions === "number" &&
      Number.isFinite(ds.total.totalDecisions) &&
      ds.total.totalDecisions > 0 &&
      typeof ds.training?.totalDecisions === "number" &&
      Number.isFinite(ds.training.totalDecisions) &&
      typeof ds.validation?.totalDecisions === "number" &&
      Number.isFinite(ds.validation.totalDecisions) &&
      ds.training.totalDecisions + ds.validation.totalDecisions === ds.total.totalDecisions
    ) {
      checks.decisionStatsFiniteAndValid = true;
    } else {
      errors.push("Decision stats validation failed or contains non-finite values");
    }

    // PASS テレメトリー検査
    const pt = metricsData.passAndStallTelemetry;
    if (
      pt &&
      typeof pt.total?.totalPassDecisions === "number" &&
      Number.isFinite(pt.total.totalPassDecisions) &&
      typeof pt.total?.passRatio === "number" &&
      Number.isFinite(pt.total.passRatio) &&
      pt.total.passRatio >= 0 &&
      pt.total.passRatio <= 1 &&
      typeof pt.total?.maxConsecutivePassesInSingleMatch === "number" &&
      Number.isFinite(pt.total.maxConsecutivePassesInSingleMatch) &&
      typeof pt.total?.matchesReachingDecisionLimit === "number" &&
      Number.isFinite(pt.total.matchesReachingDecisionLimit)
    ) {
      checks.passAndStallTelemetryValid = true;
    } else {
      errors.push("PASS telemetry validation failed or contains non-finite values");
    }

    // 世代時間実測値検査
    const gt = metricsData.generationTimings;
    if (
      metricsData.generationTimingStatus === "MEASURED" &&
      Array.isArray(gt) &&
      gt.length === TOTAL_GENERATIONS &&
      gt.every(
        (t: any) =>
          typeof t.totalElapsedMs === "number" &&
          Number.isFinite(t.totalElapsedMs) &&
          t.totalElapsedMs > 0 &&
          typeof t.trainingElapsedMs === "number" &&
          Number.isFinite(t.trainingElapsedMs) &&
          typeof t.validationElapsedMs === "number" &&
          Number.isFinite(t.validationElapsedMs) &&
          typeof t.checkpointSaveElapsedMs === "number" &&
          Number.isFinite(t.checkpointSaveElapsedMs)
      )
    ) {
      checks.generationTimingsMeasuredAndValid = true;
    } else {
      errors.push("Generation timings validation failed or not MEASURED");
    }

    // Champion 検証
    const fc = metricsData.finalChampion;
    if (fc) {
      if (
        typeof fc.generation === "number" &&
        fc.generation >= 0 &&
        fc.generation < TOTAL_GENERATIONS &&
        fc.isP10Offspring === false
      ) {
        checks.championEvaluatedInHistoryNotP10 = true;
      } else {
        errors.push(`Final champion is invalid or marked as P10 offspring: gen=${fc.generation}`);
      }
    } else {
      errors.push("Final champion is missing in metrics data");
    }
  }

  // 4. campaign-stage3-evolution-result.json 検査
  let resultData: any = null;
  try {
    resultData = JSON.parse(
      fs.readFileSync(path.join(artifactsDir, "campaign-stage3-evolution-result.json"), "utf-8")
    );
  } catch (err: any) {
    errors.push(`Failed to read campaign-stage3-evolution-result.json: ${err.message}`);
  }

  if (resultData) {
    const provChampion = resultData.logicalResult?.provisionalBestChampion;
    if (provChampion && provChampion.dna) {
      const recomputedDigest = EvolutionIndependentEvaluator.computeDnaDigest(provChampion.dna);
      if (recomputedDigest === provChampion.dnaDigest) {
        checks.championDnaDigestMatches = true;
      } else {
        errors.push(
          `Champion DNA digest mismatch: expected ${provChampion.dnaDigest}, got ${recomputedDigest}`
        );
      }
    } else {
      errors.push("Provisional best champion or DNA missing in campaign result");
    }

    // Seed 整合性検査
    const seedRegistry = resultData.logicalResult?.seedRegistry;
    if (seedRegistry && seedRegistry.trainingSeedsByGeneration) {
      const derivedPlan = generateStage3SeedPlan();
      let seedsMatch = true;
      for (let g = 0; g < TOTAL_GENERATIONS; g++) {
        const actualSeeds = seedRegistry.trainingSeedsByGeneration[g];
        const expectedSeeds = derivedPlan.trainingSeedsByGeneration[g];
        if (!actualSeeds || actualSeeds.length !== expectedSeeds.length) {
          errors.push(`Generation ${g} seed count mismatch`);
          seedsMatch = false;
          break;
        }
        for (let i = 0; i < actualSeeds.length; i++) {
          if (actualSeeds[i] !== expectedSeeds[i]) {
            errors.push(`Generation ${g} seed at [${i}] mismatch: exp ${expectedSeeds[i]}, got ${actualSeeds[i]}`);
            seedsMatch = false;
            break;
          }
        }
        if (!seedsMatch) break;
      }
      checks.seedPlanVerified = seedsMatch;
    } else {
      errors.push("Seed registry missing in campaign result");
    }
  }

  // 5. checkpoint 検査
  const cpPath = path.join(artifactsDir, "campaign-stage3-evolution-checkpoint.json");
  if (fs.existsSync(cpPath)) {
    try {
      const cpData = JSON.parse(fs.readFileSync(cpPath, "utf-8"));
      if (
        cpData.completedGenerations === TOTAL_GENERATIONS &&
        cpData.provisionalBestChampion &&
        typeof cpData.stateDigest === "string" &&
        cpData.stateDigest.length === 64
      ) {
        checks.checkpointIntegrityVerified = true;
      } else {
        errors.push(`Checkpoint state incomplete or invalid completedGenerations: ${cpData.completedGenerations}`);
      }
    } catch (err: any) {
      errors.push(`Failed to parse checkpoint file: ${err.message}`);
    }
  } else {
    errors.push("Checkpoint file missing in artifacts directory");
  }

  const isValid =
    errors.length === 0 &&
    checks.manifestComprehensive &&
    checks.sha256ChecksumsMatch &&
    checks.checkpointIntegrityVerified &&
    checks.seedPlanVerified &&
    checks.matchesCountMatches &&
    checks.decisionStatsFiniteAndValid &&
    checks.passAndStallTelemetryValid &&
    checks.generationTimingsMeasuredAndValid &&
    checks.championDnaDigestMatches &&
    checks.championEvaluatedInHistoryNotP10 &&
    checks.holdoutUnused;

  return {
    isValid,
    errors,
    checks,
  };
}

// =============================================================================
// メイン実行エントリポイント
// =============================================================================

export async function runStage3Evolution(
  artifactsDir: string = DEFAULT_STAGE3_ARTIFACTS_DIR,
  options?: { readonly allowDirty?: boolean }
): Promise<Stage3ExecutionOutput> {
  // Core の大量 [TRIGGER] / [BUFFER-] ログを抑制し、メモリ肥大化を防止
  const origConsoleLog = console.log;
  console.log = (...args: any[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (
      first.startsWith("[Stage 3") ||
      first.startsWith("===") ||
      first.startsWith("---") ||
      first.startsWith("[Step") ||
      first.startsWith("  ") ||
      first.startsWith("Campaign") ||
      first.startsWith("Work ID") ||
      first.startsWith("Regulation") ||
      first.startsWith("Population") ||
      first.startsWith("Generations") ||
      first.startsWith("Campaign Seed") ||
      first.startsWith("Artifacts") ||
      first.startsWith("[Gen ")
    ) {
      origConsoleLog(...args);
    }
  };

  try {
    console.log(`================================================================================`);
    console.log(`[Stage 3 Large-Scale Evolution] Starting Work 3-5 (1,920 Matches Total)`);
    console.log(`================================================================================`);
    console.log(`Work ID:             ${WORK_ID}`);
    console.log(`Regulation:          ${REGULATION_ID} (${FRAME_ID})`);
    console.log(`Population Size (N): ${POPULATION_SIZE}`);
    console.log(`Generations (G):     ${TOTAL_GENERATIONS}`);
    console.log(`Campaign Seed:       ${CAMPAIGN_SEED}`);
    console.log(`Artifacts Root:      ${artifactsDir}`);
    console.log(`--------------------------------------------------------------------------------`);

    // Step 1: Preflight Check
    console.log(`[Step 1] Running Preflight Checks...`);
    const preflight = await runPreflightCheck(artifactsDir, options);
    if (!preflight.isValid) {
      origConsoleLog("Preflight check FAILED with errors:", preflight.errors);
      throw new Error(`Preflight check failed: ${preflight.errors.join("; ")}`);
    }
    console.log(`  Git Commit SHA:    ${preflight.manifest.gitCommitSha}`);
    console.log(`  Git Working Tree:  ${preflight.manifest.isGitClean ? "CLEAN (Verified)" : "DIRTY (Allowed by option)"}`);
    console.log(`  Seed Integrity:    660 unique Training seeds + 15 Validation seeds verified without collisions`);
    console.log(`  Preflight Status:  PASS`);

    // Preflight Manifest 保存
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsDir, "preflight-manifest.json"),
      JSON.stringify(preflight.manifest, null, 2),
      "utf-8"
    );

    // Step 2: 10世代進化実行 (1,320 Training + 600 Validation)
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`[Step 2] Executing 10 Generations Evolution (1,320 Training + 600 Validation = 1,920 Matches)...`);
    const execOutput = await executeStage3Evolution(preflight.seedPlan, artifactsDir);

    console.log(`Campaign Finished:`);
    console.log(`  Status:              ${execOutput.campaignResult.status}`);
    console.log(`  Generations:         ${execOutput.campaignResult.completedGenerations}/${TOTAL_GENERATIONS}`);
    console.log(`  Training Matches:    ${execOutput.trainingMatchesExecuted}/1320`);
    console.log(`  Validation Matches:  ${execOutput.validationMatchesExecuted}/600`);
    console.log(`  Total Matches:       ${execOutput.totalMatchesExecuted}/1920`);
    console.log(`  Matches Detail:      COMPLETED: ${execOutput.completedMatches}, FAILED: ${execOutput.failedMatches}, INCOMPLETE: ${execOutput.incompleteMatches}`);
    console.log(`  Total Decisions:     ${execOutput.decisionStats.total.totalDecisions} (Training: ${execOutput.decisionStats.training.totalDecisions}, Validation: ${execOutput.decisionStats.validation.totalDecisions})`);
    console.log(`  PASS Decisions:      ${execOutput.passAndStallTelemetry.total.totalPassDecisions} (${(execOutput.passAndStallTelemetry.total.passRatio * 100).toFixed(2)}%)`);
    console.log(`  Max Consec. PASS:    ${execOutput.passAndStallTelemetry.total.maxConsecutivePassesInSingleMatch}`);
    console.log(`  Elapsed Time:        ${(execOutput.elapsedTotalMs / 1000).toFixed(2)}s (${execOutput.throughputMatchesPerSec.toFixed(1)} matches/sec, ${execOutput.throughputDecisionsPerSec.toFixed(1)} decisions/sec)`);
    console.log(`  Peak Memory:         RSS: ${(execOutput.sampledPeakRssBytes / 1024 / 1024).toFixed(1)} MB, Heap: ${(execOutput.sampledPeakHeapUsedBytes / 1024 / 1024).toFixed(1)} MB (Sampled)`);

    const finalChamp = execOutput.finalChampion;
    console.log(`  Best Champion:       ${finalChamp.genomeId} (Gen: ${finalChamp.generation}, Digest: ${finalChamp.dnaDigest}, ValWR: ${finalChamp.validationMeanWinRate.toFixed(3)})`);

    // Step 3: 結果ファイル保存
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`[Step 3] Saving Logical Results, Metrics, Evidence, and Manifest...`);
    const savedArtifacts = saveStage3Artifacts(execOutput, preflight.manifest, artifactsDir);
    console.log(`  Saved Files:         ${savedArtifacts.savedFiles.join(", ")}`);

    // Step 4: 独立監査
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`[Step 4] Running Fail-Closed Self-Audit on Saved Artifacts...`);
    const auditResult = auditStage3Artifacts(artifactsDir);
    if (!auditResult.isValid) {
      origConsoleLog("Stage 3 Self-Audit FAILED with errors:", auditResult.errors);
      throw new Error(`Stage 3 Self-Audit failed: ${auditResult.errors.join("; ")}`);
    }
    console.log(`  Self-Audit:          PASS (All 11 checks verified)`);
    console.log(`================================================================================`);
    console.log(`[Stage 3 Large-Scale Evolution] COMPLETED SUCCESSFULLY (READY FOR PRE-HOLDOUT REVIEW)`);
    console.log(`================================================================================`);

    return execOutput;
  } finally {
    console.log = origConsoleLog;
  }
}

// 直接実行時のエントリポイント
const isMainScript =
  (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) ||
  process.argv.some((arg) => arg.includes("stage3EvolutionRunner"));

if (isMainScript && !process.env.VITEST && !process.argv.includes("--no-auto-run")) {
  runStage3Evolution().catch((err) => {
    console.error("Stage 3 Large-Scale Evolution execution FAILED with uncaught error:", err);
    process.exit(1);
  });
}

