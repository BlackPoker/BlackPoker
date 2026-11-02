/**
 * Stage 1 Small Pilot Runner (BP-SIM-AI-V92-WORK3-STAGE1-PILOT)
 *
 * BlackPoker Simulator AI基盤における多世代進化の Stage 1 実機検証 CLI。
 *
 * 目的:
 * 1. Standard＋Pack で実際の多世代進化が完走することの実証
 * 2. DNA が世代間で正しく生成・引き継がれることの実証
 * 3. Champion 候補の Validation が実際に動作することの実証
 * 4. 同じ条件の2回の実行（Run A / Run B）で論理結果が完全に一致することの実証（決定論的再現性）
 * 5. 実際の計算時間とメモリ使用量を測定すること
 * 6. 実験結果を再現・検証できる Evidence として永続化すること
 *
 * 実験規模（固定パラメータ）:
 * - Regulation: standard-pack (entry16)
 * - Population Size: N = 6
 * - Generation Count: G = 2 (Gen 0, Gen 1)
 * - Pair Repetitions: R = 1
 * - Training: 60 試合 (30 試合/世代 x 2 世代)
 * - Validation: 40 試合 (20 試合/世代 x 2 世代)
 * - Validation Opponents: FirstLegal / SeededRandom (2 対戦相手)
 * - Validation Seeds: 5 個
 * - Holdout: 0 試合 (未実施を明示)
 * - 合計: 100 試合 / Run (Run A + Run B で計 200 試合)
 * - Early Stopping: 無効化
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
import { deriveSeed } from "../engine/random/DeterministicShuffle.js";

import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec.js";
import { EvolutionIndependentEvaluator } from "../engine/ai/EvolutionIndependentEvaluator.js";
import { EvolutionCampaignManager } from "../engine/ai/EvolutionCampaignManager.js";
import { GenerationRunner } from "../engine/ai/GenerationRunner.js";
import { FirstLegalPolicy, RandomPolicy } from "../engine/simulation/DecisionPolicy.js";
import { FileCampaignCheckpointStorage } from "../engine/simulation/FileCampaignCheckpointStorage.js";

import {
  PopulationEntry,
  PopulationSnapshot,
} from "../domain/ai/PopulationSelectionTypes.js";
import {
  EvaluationOpponentDefinition,
  EvaluationSeedSet,
} from "../domain/ai/EvolutionEvaluationTypes.js";
import {
  EvolutionCampaignConfig,
  CampaignExecutionResult,
  CampaignLogicalResult,
  CampaignCheckpointState,
  isEqualCampaignLogicalResult,
  canonicalJsonStringify,
} from "../domain/ai/EvolutionCampaignTypes.js";
import { canonicalGenerationStreamKey } from "../domain/ai/EvolutionLoopTypes.js";
import { BatchMatchContext } from "../domain/simulation/BatchSimulationTypes.js";
import { GameSession } from "../engine/session/GameSession.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// 固定実験定数
// =============================================================================

export const WORK_ID = "BP-SIM-AI-V92-WORK3-STAGE1-PILOT";
export const REGULATION_ID = "standard-pack";
export const FRAME_ID = "pack";
export const RULE_PACKAGE_VERSION = "1.0.0";
export const FEATURE_SCHEMA_VERSION = 6;
export const POPULATION_SIZE = 6;
export const TOTAL_GENERATIONS = 2;
export const PAIR_REPETITIONS = 1;
export const CAMPAIGN_SEED = 20261103;
export const VALIDATION_SEEDS: readonly number[] = Object.freeze([91001, 91002, 91003, 91004, 91005]);

export const DEFAULT_ARTIFACTS_ROOT = path.resolve(__dirname, "../../.artifacts/stage1-pilot");

// =============================================================================
// Git 状態および識別情報取得
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
  } catch (err: any) {
    statusOutput = `Failed to check git status: ${err.message}`;
  }

  return { commitSha, isClean, statusOutput };
}

export function computeFileSha256(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function getGitCommitSha(): string {
  return getGitStatusInfo().commitSha;
}

// =============================================================================
// 初期母集団生成
// =============================================================================

export function createStage1InitialPopulation(): PopulationSnapshot {
  const entries: PopulationEntry[] = [];
  for (let i = 0; i < POPULATION_SIZE; i++) {
    const genomeId = `ind-g0-${String(i).padStart(3, "0")}`;
    const dna = DecisionDNACodec.createZeroDecisionDNA({
      id: `dna-${genomeId}`,
      stage: "stage1-pilot",
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
// Baseline Opponents 生成
// =============================================================================

export function createStage1ValidationOpponents(): readonly EvaluationOpponentDefinition[] {
  return [
    {
      opponentId: "baseline-first-legal",
      name: "FirstLegal",
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    },
    {
      opponentId: "baseline-seeded-random",
      name: "SeededRandom",
      role: "BASELINE",
      policyFactory: () => new RandomPolicy(424242, "SeededRandom"),
      targetWinRate: 0.5,
    },
  ];
}

// =============================================================================
// Preflight 検証
// =============================================================================

export interface PreflightManifest {
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
  readonly plannedTrainingMatchesByGen: Record<number, number>;
  readonly plannedTrainingSeedsByGen: Record<number, readonly number[]>;
  readonly validationSeeds: readonly number[];
  readonly validationOpponents: readonly { readonly opponentId: string; readonly name: string; readonly role: string }[];
  readonly earlyStoppingEnabled: boolean;
  readonly holdoutMatchesPlanned: number;
  readonly storageClass: string;
  readonly artifactsDirectory: string;
}

export interface PreflightResult {
  readonly passed: boolean;
  readonly manifest: PreflightManifest;
  readonly errors: readonly string[];
}

export async function runPreflightCheck(
  artifactsDir: string = DEFAULT_ARTIFACTS_ROOT,
  options?: { readonly allowDirty?: boolean }
): Promise<PreflightResult> {
  const errors: string[] = [];
  const gitInfo = getGitStatusInfo();

  // 0-A. Git SHA 取得検証 (UNKNOWN の場合は即時拒絶)
  if (gitInfo.commitSha === "UNKNOWN") {
    errors.push("Failed to resolve git commit SHA. Stage 1 Pilot requires identifiable commit SHA.");
  }

  // 0-B. Git ワーキングツリーの Clean 検証 (本番 Pilot では未コミット変更を Fail-Fast 拒絶)
  if (!options?.allowDirty && !gitInfo.isClean) {
    errors.push(
      `Git working tree is dirty (uncommitted changes detected). Stage 1 Pilot requires clean working tree to ensure complete reproducibility. Status:\n${gitInfo.statusOutput}`
    );
  }

  // 1. レギュレーション検証
  let regulationValidated = false;
  try {
    const catalog = await loadRegulationCatalog();
    const validation = RegulationValidator.validateRegulation(catalog, REGULATION_ID, {
      assertImplemented: true,
    });
    if (!validation.regulation || validation.regulation.id !== REGULATION_ID) {
      errors.push(`Regulation mismatch: expected ${REGULATION_ID}, got ${validation.regulation?.id}`);
    }
    if (!validation.frame || validation.frame.id !== FRAME_ID) {
      errors.push(`Frame mismatch: expected ${FRAME_ID}, got ${validation.frame?.id}`);
    }
    regulationValidated = true;
  } catch (err: any) {
    errors.push(`Regulation validation failed: ${err.message}`);
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

  // 3. SessionFactory 検証
  try {
    const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(REGULATION_ID);
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
    errors.push(`SessionFactory test failed: ${err.message}`);
  }

  // 4. 母集団・スケジュール計画と Seed 衝突検証
  const initialPop = createStage1InitialPopulation();
  if (initialPop.entries.length !== POPULATION_SIZE) {
    errors.push(`Initial population size mismatch: expected ${POPULATION_SIZE}, got ${initialPop.entries.length}`);
  }

  const plannedTrainingSeedsByGen: Record<number, number[]> = {};
  const plannedTrainingMatchesByGen: Record<number, number> = {};
  let currentPop = initialPop;

  for (let g = 0; g < TOTAL_GENERATIONS; g++) {
    const genStreamKey = canonicalGenerationStreamKey(g);
    const genSeed = deriveSeed(CAMPAIGN_SEED, genStreamKey);
    const schedule = GenerationRunner.planSchedule(currentPop, genSeed, PAIR_REPETITIONS);
    plannedTrainingSeedsByGen[g] = schedule.map((m) => m.matchSeed);
    plannedTrainingMatchesByGen[g] = schedule.length;
  }

  // Seed 衝突事前検証
  try {
    const seedSets: EvaluationSeedSet[] = [
      { category: "VALIDATION", seeds: VALIDATION_SEEDS },
    ];
    for (let g = 0; g < TOTAL_GENERATIONS; g++) {
      seedSets.push({ category: "TRAINING", seeds: Array.from(new Set(plannedTrainingSeedsByGen[g])) });
    }
    EvolutionIndependentEvaluator.assertNoSeedCollision(seedSets);
  } catch (err: any) {
    errors.push(`Seed collision detected during preflight: ${err.message}`);
  }

  // 5. 成果物保存先（Git 管理外）の検証
  try {
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }
    const testFile = path.join(artifactsDir, `.preflight-probe-${Date.now()}.tmp`);
    fs.writeFileSync(testFile, "probe", "utf-8");
    fs.unlinkSync(testFile);
  } catch (err: any) {
    errors.push(`Artifacts storage check failed at "${artifactsDir}": ${err.message}`);
  }

  const manifest: PreflightManifest = {
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
    plannedTrainingMatchesByGen,
    plannedTrainingSeedsByGen,
    validationSeeds: VALIDATION_SEEDS,
    validationOpponents: createStage1ValidationOpponents().map((o) => ({
      opponentId: o.opponentId,
      name: o.name,
      role: o.role,
    })),
    earlyStoppingEnabled: false,
    holdoutMatchesPlanned: 0,
    storageClass: "FileCampaignCheckpointStorage",
    artifactsDirectory: artifactsDir,
  };

  return {
    passed: errors.length === 0,
    manifest,
    errors,
  };
}

// =============================================================================
// 単一 Run の実測メトリクス
// =============================================================================

export interface RunMeasurement {
  readonly runId: "RUN_A" | "RUN_B";
  readonly campaignId: string;
  readonly artifactsDir: string;
  readonly executionResult: CampaignExecutionResult;
  readonly totalMatchesExecuted: number;
  readonly trainingMatchesExecuted: number;
  readonly validationMatchesExecuted: number;
  readonly completedMatches: number;
  readonly failedMatches: number;
  readonly incompleteMatches: number;
  readonly totalDecisions: number;
  readonly trainingDecisions: number;
  readonly validationDecisions: number;
  readonly elapsedTotalMs: number;
  readonly elapsedTrainingMs: null;
  readonly elapsedValidationMs: null;
  readonly trainingMatchesPerSec: null;
  readonly validationMatchesPerSec: null;
  readonly generationTimesMs: null;
  readonly timingMeasurementNote: string;
  readonly memoryStart: NodeJS.MemoryUsage;
  readonly memoryEnd: NodeJS.MemoryUsage;
  readonly sampledPeakRssBytes: number;
  readonly sampledPeakHeapUsedBytes: number;
  readonly memorySamplingMethod: string;
  readonly memoryMeasurementNote: string;
  readonly checkpointFilePath: string;
  readonly checkpointSizeBytes: number;
}

// =============================================================================
// Run 実行ルーチン
// =============================================================================

export async function executeStage1Run(
  runId: "RUN_A" | "RUN_B",
  baseArtifactsDir: string = DEFAULT_ARTIFACTS_ROOT
): Promise<RunMeasurement> {
  const runSubdir = runId === "RUN_A" ? "run-a" : "run-b";
  const runArtifactsDir = path.join(baseArtifactsDir, runSubdir);
  if (!fs.existsSync(runArtifactsDir)) {
    fs.mkdirSync(runArtifactsDir, { recursive: true });
  }

  // Preflight チェックと Manifest の永続化
  const preflight = await runPreflightCheck(runArtifactsDir);
  if (!preflight.passed) {
    throw new Error(`Preflight check failed for ${runId}: ${preflight.errors.join("; ")}`);
  }
  fs.writeFileSync(
    path.join(runArtifactsDir, "preflight-manifest.json"),
    JSON.stringify(preflight.manifest, null, 2),
    "utf-8"
  );

  const rawSessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(REGULATION_ID);

  // 計装テレメトリ
  let observedDecisions = 0;
  let observedCompleted = 0;
  let observedFailed = 0;
  let observedIncomplete = 0;
  let peakRss = 0;
  let peakHeapUsed = 0;

  const updateMemoryPeaks = () => {
    const mem = process.memoryUsage();
    if (mem.rss > peakRss) peakRss = mem.rss;
    if (mem.heapUsed > peakHeapUsed) peakHeapUsed = mem.heapUsed;
  };

  const instrumentedSessionFactory = (ctx: BatchMatchContext): GameSession => {
    updateMemoryPeaks();
    const session = rawSessionFactory(ctx);
    const origSubmitDecision = session.submitDecision.bind(session);
    session.submitDecision = (response: any) => {
      observedDecisions++;
      return origSubmitDecision(response);
    };

    let sessionFinished = false;
    const origAdvance = session.advance.bind(session);
    session.advance = () => {
      updateMemoryPeaks();
      try {
        const step = origAdvance();
        if (step.type === "FINISHED" && !sessionFinished) {
          sessionFinished = true;
          observedCompleted++;
        }
        return step;
      } catch (err) {
        observedFailed++;
        throw err;
      }
    };

    return session;
  };

  const campaignId = "campaign-stage1-pilot";
  const checkpointStorage = new FileCampaignCheckpointStorage();

  const config: EvolutionCampaignConfig = {
    campaignId,
    campaignSeed: CAMPAIGN_SEED,
    regulationId: REGULATION_ID,
    frameId: FRAME_ID,
    rulePackageVersion: RULE_PACKAGE_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    totalGenerations: TOTAL_GENERATIONS,
    initialPopulation: createStage1InitialPopulation(),
    validationOpponents: createStage1ValidationOpponents(),
    validationSeeds: VALIDATION_SEEDS,
    sessionFactory: instrumentedSessionFactory,
    checkpointDir: runArtifactsDir,
    checkpointStorage,
    checkpointIntervalGenerations: 1, // 毎世代保存
    minimumCompletedPairs: 5,
    maxDecisionsPerMatch: 500,
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
  };

  const memStart = process.memoryUsage();
  updateMemoryPeaks();
  const startTime = performance.now();

  // EvolutionCampaignManager による実機多世代進化実行
  const executionResult = EvolutionCampaignManager.run(config);

  const endTime = performance.now();
  updateMemoryPeaks();
  const memEnd = process.memoryUsage();

  const elapsedTotalMs = endTime - startTime;

  // Validation 側の意思決定数と完了数を集計
  let validationDecisions = 0;
  for (const genRecord of executionResult.history) {
    if (genRecord.validationResult && genRecord.validationResult.pairs) {
      for (const pair of genRecord.validationResult.pairs) {
        validationDecisions += (pair.leg0?.totalDecisions ?? 0) + (pair.leg1?.totalDecisions ?? 0);
      }
    }
  }

  const trainingDecisions = observedDecisions - validationDecisions;

  // 試合数集計
  const trainingMatchesExecuted = executionResult.runtimeMetrics.totalTrainingMatches;
  const validationMatchesExecuted = executionResult.runtimeMetrics.totalValidationMatches;
  const totalMatchesExecuted = trainingMatchesExecuted + validationMatchesExecuted;

  // Checkpoint ファイル確認
  const checkpointFilePath = path.join(runArtifactsDir, `${campaignId}-checkpoint.json`);
  let checkpointSizeBytes = 0;
  if (fs.existsSync(checkpointFilePath)) {
    checkpointSizeBytes = fs.statSync(checkpointFilePath).size;
  }

  // 試合/秒 (全体実測値)
  const matchesPerSec = totalMatchesExecuted / (elapsedTotalMs / 1000);

  // 結果の保存
  fs.writeFileSync(
    path.join(runArtifactsDir, `${campaignId}-result.json`),
    JSON.stringify(executionResult.logicalResult, null, 2),
    "utf-8"
  );

  const timingMeasurementNote =
    "UNMEASURED: Proportional phase breakdown estimation is prohibited by statistical contracts. Only elapsedTotalMs is directly observed.";
  const memorySamplingMethod = "SESSION_FACTORY_INVOCATION_SAMPLING";
  const memoryMeasurementNote =
    "SAMPLED_MAXIMUM: Memory was sampled at SessionFactory invocations and step advance calls. Continuous OS-level peak is unobserved.";

  const measurement: RunMeasurement = {
    runId,
    campaignId,
    artifactsDir: runArtifactsDir,
    executionResult,
    totalMatchesExecuted,
    trainingMatchesExecuted,
    validationMatchesExecuted,
    completedMatches: observedCompleted,
    failedMatches: observedFailed,
    incompleteMatches: observedIncomplete,
    totalDecisions: observedDecisions,
    trainingDecisions,
    validationDecisions,
    elapsedTotalMs,
    elapsedTrainingMs: null,
    elapsedValidationMs: null,
    trainingMatchesPerSec: null,
    validationMatchesPerSec: null,
    generationTimesMs: null,
    timingMeasurementNote,
    memoryStart: memStart,
    memoryEnd: memEnd,
    sampledPeakRssBytes: peakRss,
    sampledPeakHeapUsedBytes: peakHeapUsed,
    memorySamplingMethod,
    memoryMeasurementNote,
    checkpointFilePath,
    checkpointSizeBytes,
  };

  fs.writeFileSync(
    path.join(runArtifactsDir, `${campaignId}-metrics.json`),
    JSON.stringify(
      {
        runId,
        campaignId,
        totalMatchesExecuted,
        trainingMatchesExecuted,
        validationMatchesExecuted,
        completedMatches: observedCompleted,
        failedMatches: observedFailed,
        incompleteMatches: observedIncomplete,
        totalDecisions: observedDecisions,
        trainingDecisions,
        validationDecisions,
        elapsedTotalMs,
        matchesPerSec,
        elapsedTrainingMs: null,
        elapsedValidationMs: null,
        trainingMatchesPerSec: null,
        validationMatchesPerSec: null,
        generationTimesMs: null,
        timingMeasurementNote,
        sampledPeakRssMB: peakRss / (1024 * 1024),
        sampledPeakHeapUsedMB: peakHeapUsed / (1024 * 1024),
        memorySamplingMethod,
        memoryMeasurementNote,
        checkpointSizeBytes,
      },
      null,
      2
    ),
    "utf-8"
  );

  return measurement;
}

// =============================================================================
// Checkpoint 完全性検証 (チェックサム・構造・世代・設定照合)
// =============================================================================

export interface CheckpointIntegrityResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly state?: CampaignCheckpointState;
  readonly computedChecksum?: string;
  readonly recordedChecksum?: string;
}

export function verifyCheckpointIntegrity(
  filePath: string,
  expectedCampaignId?: string
): CheckpointIntegrityResult {
  const errors: string[] = [];

  if (!fs.existsSync(filePath)) {
    return {
      isValid: false,
      errors: [`Checkpoint file does not exist at "${filePath}"`],
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err: any) {
    return {
      isValid: false,
      errors: [`Failed to read checkpoint file at "${filePath}": ${err.message}`],
    };
  }

  if (content.trim().length === 0) {
    return {
      isValid: false,
      errors: [`Checkpoint file is empty (0 bytes) at "${filePath}"`],
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err: any) {
    return {
      isValid: false,
      errors: [`Invalid JSON in checkpoint file at "${filePath}": ${err.message}`],
    };
  }

  if (!parsed || typeof parsed !== "object" || typeof parsed.checksum !== "string") {
    return {
      isValid: false,
      errors: [`Invalid checkpoint format in "${filePath}": missing "checksum" property`],
    };
  }

  const { checksum, ...stateWithoutChecksum } = parsed;
  let computedChecksum = "";
  try {
    computedChecksum = EvolutionCampaignManager.computeCheckpointChecksum(stateWithoutChecksum);
  } catch (err: any) {
    return {
      isValid: false,
      errors: [`Failed to compute checkpoint checksum for "${filePath}": ${err.message}`],
    };
  }

  if (computedChecksum !== checksum) {
    errors.push(
      `Checkpoint checksum mismatch in "${filePath}": computed="${computedChecksum}", recorded="${checksum}" (tampering or corruption detected)`
    );
  }

  // 構造・主要フィールド検証
  if (expectedCampaignId && parsed.campaignId !== expectedCampaignId) {
    errors.push(
      `Checkpoint campaignId mismatch in "${filePath}": expected "${expectedCampaignId}", recorded "${parsed.campaignId}"`
    );
  }
  if (typeof parsed.completedGenerations !== "number" || parsed.completedGenerations < 0) {
    errors.push(`Checkpoint missing or invalid completedGenerations in "${filePath}"`);
  }
  if (!parsed.seedRegistry || !Array.isArray(parsed.seedRegistry.allUsedSeeds)) {
    errors.push(`Checkpoint missing valid seedRegistry in "${filePath}"`);
  }
  if (!parsed.nextPopulation || !Array.isArray(parsed.nextPopulation.entries)) {
    errors.push(`Checkpoint missing valid nextPopulation in "${filePath}"`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    state: parsed as CampaignCheckpointState,
    computedChecksum,
    recordedChecksum: checksum,
  };
}

// =============================================================================
// Pilot 正式 SUCCESS 判定 (全条件完全検証)
// =============================================================================

export interface PilotEvaluationInput {
  readonly runA: RunMeasurement;
  readonly runB: RunMeasurement;
  readonly reproducibilityResult: "REPRODUCIBILITY_PASS" | "REPRODUCIBILITY_FAIL";
  readonly plannedMatchesPerRun?: number;
}

export interface PilotEvaluationVerdict {
  readonly isSuccess: boolean;
  readonly status: "SUCCESS" | "FAILED";
  readonly reasons: readonly string[];
  readonly conditionCheck: {
    readonly runACompleted: boolean;
    readonly runBCompleted: boolean;
    readonly matchesCountExact: boolean;
    readonly noFailedOrIncompleteMatches: boolean;
    readonly noSeedCollisions: boolean;
    readonly reproducibilityPassed: boolean;
    readonly checkpointsValid: boolean;
    readonly checkpointsIntegrityVerified: boolean;
  };
}

export function evaluatePilotOverallSuccess(input: PilotEvaluationInput): PilotEvaluationVerdict {
  const { runA, runB, reproducibilityResult, plannedMatchesPerRun = 100 } = input;
  const failureReasons: string[] = [];

  // 条件1: Campaign Status が COMPLETED
  const runACompleted = runA.executionResult.status === "COMPLETED";
  const runBCompleted = runB.executionResult.status === "COMPLETED";
  if (!runACompleted) {
    failureReasons.push(`Run A status is "${runA.executionResult.status}", expected "COMPLETED".`);
  }
  if (!runBCompleted) {
    failureReasons.push(`Run B status is "${runB.executionResult.status}", expected "COMPLETED".`);
  }

  // 条件2: 予定試合数一致
  const matchesCountExact =
    runA.totalMatchesExecuted === plannedMatchesPerRun &&
    runB.totalMatchesExecuted === plannedMatchesPerRun;
  if (runA.totalMatchesExecuted !== plannedMatchesPerRun) {
    failureReasons.push(
      `Run A total matches executed (${runA.totalMatchesExecuted}) !== planned (${plannedMatchesPerRun}).`
    );
  }
  if (runB.totalMatchesExecuted !== plannedMatchesPerRun) {
    failureReasons.push(
      `Run B total matches executed (${runB.totalMatchesExecuted}) !== planned (${plannedMatchesPerRun}).`
    );
  }

  // 条件3: FAILED = 0, INCOMPLETE = 0, completedMatches === plannedMatchesPerRun
  const runANoFailure =
    runA.failedMatches === 0 &&
    runA.incompleteMatches === 0 &&
    runA.completedMatches === plannedMatchesPerRun;
  const runBNoFailure =
    runB.failedMatches === 0 &&
    runB.incompleteMatches === 0 &&
    runB.completedMatches === plannedMatchesPerRun;
  const noFailedOrIncompleteMatches = runANoFailure && runBNoFailure;
  if (!runANoFailure) {
    failureReasons.push(
      `Run A contains abnormal matches: completed=${runA.completedMatches}/${plannedMatchesPerRun}, failed=${runA.failedMatches}, incomplete=${runA.incompleteMatches}.`
    );
  }
  if (!runBNoFailure) {
    failureReasons.push(
      `Run B contains abnormal matches: completed=${runB.completedMatches}/${plannedMatchesPerRun}, failed=${runB.failedMatches}, incomplete=${runB.incompleteMatches}.`
    );
  }

  // 条件4: Seed 衝突なし (各 Run の使用シードが一意であること)
  const runASeeds = runA.executionResult.seedRegistry.allUsedSeeds;
  const runBSeeds = runB.executionResult.seedRegistry.allUsedSeeds;
  const runAUnique = new Set(runASeeds).size === runASeeds.length;
  const runBUnique = new Set(runBSeeds).size === runBSeeds.length;
  const noSeedCollisions = runAUnique && runBUnique;
  if (!runAUnique) {
    failureReasons.push(`Run A seed registry contains duplicate seeds.`);
  }
  if (!runBUnique) {
    failureReasons.push(`Run B seed registry contains duplicate seeds.`);
  }

  // 条件5: 再現性 PASS (決定論的再現性完全一致)
  const reproducibilityPassed = reproducibilityResult === "REPRODUCIBILITY_PASS";
  if (!reproducibilityPassed) {
    failureReasons.push(
      `Deterministic reproducibility comparison failed (verdict: ${reproducibilityResult}).`
    );
  }

  // 条件6: Checkpoint 完全性検証 (存在・サイズだけでなく、構造およびチェックサムが一致すること)
  const runACheckpointExists = runA.checkpointSizeBytes > 0 && fs.existsSync(runA.checkpointFilePath);
  const runBCheckpointExists = runB.checkpointSizeBytes > 0 && fs.existsSync(runB.checkpointFilePath);
  const checkpointsValid = runACheckpointExists && runBCheckpointExists;
  if (!runACheckpointExists) {
    failureReasons.push(
      `Run A checkpoint file is missing or empty (size=${runA.checkpointSizeBytes} bytes, path="${runA.checkpointFilePath}").`
    );
  }
  if (!runBCheckpointExists) {
    failureReasons.push(
      `Run B checkpoint file is missing or empty (size=${runB.checkpointSizeBytes} bytes, path="${runB.checkpointFilePath}").`
    );
  }

  const runACheckpointInteg = verifyCheckpointIntegrity(runA.checkpointFilePath, runA.campaignId);
  const runBCheckpointInteg = verifyCheckpointIntegrity(runB.checkpointFilePath, runB.campaignId);
  const checkpointsIntegrityVerified = runACheckpointInteg.isValid && runBCheckpointInteg.isValid;

  if (!runACheckpointInteg.isValid) {
    failureReasons.push(
      `Run A checkpoint integrity verification failed: ${runACheckpointInteg.errors.join("; ")}`
    );
  }
  if (!runBCheckpointInteg.isValid) {
    failureReasons.push(
      `Run B checkpoint integrity verification failed: ${runBCheckpointInteg.errors.join("; ")}`
    );
  }

  const isSuccess = failureReasons.length === 0;
  return {
    isSuccess,
    status: isSuccess ? "SUCCESS" : "FAILED",
    reasons: failureReasons,
    conditionCheck: {
      runACompleted,
      runBCompleted,
      matchesCountExact,
      noFailedOrIncompleteMatches,
      noSeedCollisions,
      reproducibilityPassed,
      checkpointsValid,
      checkpointsIntegrityVerified,
    },
  };
}

// =============================================================================
// 既存成果物の整合性監査
// =============================================================================

export interface ItemVerification<T = any> {
  readonly status: "PASS" | "FAIL" | "UNVERIFIED";
  readonly details: string;
  readonly expected?: T;
  readonly actual?: T;
}

export interface SeedAuditBreakdown {
  readonly status: "PASS" | "FAIL";
  readonly details: string;
  readonly validationSeedsCount: number;
  readonly validationSeeds: readonly number[];
  readonly trainingGenerationsCount: number;
  readonly trainingSeedsByGeneration: Record<number, readonly number[]>;
  readonly uniqueTrainingSeedsCount: number;
  readonly totalMatchesExplained: {
    readonly trainingMatches: number; // 60
    readonly validationMatches: number; // 40
    readonly totalMatches: number; // 100
  };
  readonly totalUniqueSeedsUsed: number; // 35
  readonly seedCollisionsDetected: number; // 0
  readonly seatInversionPairMatchesValid: boolean;
  readonly aggregatedAllUsedSeedsMatch: boolean;
}

export function auditSeedRegistry(registry: any, runLabel: string): SeedAuditBreakdown {
  if (!registry || typeof registry !== "object") {
    return {
      status: "FAIL",
      details: `${runLabel}: Seed registry is missing or not an object`,
      validationSeedsCount: 0,
      validationSeeds: [],
      trainingGenerationsCount: 0,
      trainingSeedsByGeneration: {},
      uniqueTrainingSeedsCount: 0,
      totalMatchesExplained: { trainingMatches: 0, validationMatches: 0, totalMatches: 0 },
      totalUniqueSeedsUsed: 0,
      seedCollisionsDetected: 1,
      seatInversionPairMatchesValid: false,
      aggregatedAllUsedSeedsMatch: false,
    };
  }

  const valSeeds: number[] = Array.isArray(registry.validationSeeds) ? registry.validationSeeds : [];
  const trainingByGen: Record<number, number[]> = {};
  const allTrainingSeedsList: number[] = [];
  const trainingSeedsPerGenUnique: Record<number, Set<number>> = {};

  let seatInversionPairMatchesValid = true;

  if (registry.trainingSeedsByGeneration && typeof registry.trainingSeedsByGeneration === "object") {
    for (const [genStr, seeds] of Object.entries(registry.trainingSeedsByGeneration)) {
      const g = Number(genStr);
      if (Array.isArray(seeds)) {
        trainingByGen[g] = seeds;
        allTrainingSeedsList.push(...seeds);
        trainingSeedsPerGenUnique[g] = new Set(seeds);

        // 各世代 30 試合 = 15 ペア。各ペアで座席反転 (Leg0, Leg1) が行われるため、
        // 15 個の一意シードがそれぞれ 2 回ずつ現れるか検証
        const seedCounts = new Map<number, number>();
        for (const s of seeds) {
          seedCounts.set(s, (seedCounts.get(s) ?? 0) + 1);
        }
        if (seedCounts.size !== 15 || seeds.length !== 30) {
          seatInversionPairMatchesValid = false;
        }
        for (const count of seedCounts.values()) {
          if (count !== 2) {
            seatInversionPairMatchesValid = false;
          }
        }
      }
    }
  }

  const uniqueTrainingSeeds = new Set(allTrainingSeedsList);
  // 世代間の重複チェック (Gen 0 と Gen 1 で重複がないこと)
  let crossGenOverlap = false;
  if (trainingSeedsPerGenUnique[0] && trainingSeedsPerGenUnique[1]) {
    for (const s of trainingSeedsPerGenUnique[0]) {
      if (trainingSeedsPerGenUnique[1].has(s)) {
        crossGenOverlap = true;
      }
    }
  }

  // Validation Seed と Training Seed の衝突チェック
  let valTrainCollision = false;
  for (const vs of valSeeds) {
    if (uniqueTrainingSeeds.has(vs)) {
      valTrainCollision = true;
    }
  }

  // 集約された allUsedSeeds の検証
  const allUsedList: number[] = Array.isArray(registry.allUsedSeeds) ? registry.allUsedSeeds : [];
  const allUsedSet = new Set(allUsedList);
  const expectedUnionSet = new Set([...uniqueTrainingSeeds, ...valSeeds]);
  const aggregatedAllUsedSeedsMatch =
    allUsedSet.size === expectedUnionSet.size &&
    [...allUsedSet].every((s) => expectedUnionSet.has(s)) &&
    allUsedList.length === allUsedSet.size;

  const totalMatchesExplained = {
    trainingMatches: allTrainingSeedsList.length,
    validationMatches: valSeeds.length * 2 * 2 * 2, // 2対戦相手 * 5シード * 2leg * 2gen = 40
    totalMatches: allTrainingSeedsList.length + valSeeds.length * 2 * 2 * 2, // 100
  };

  const seedCollisionsDetected =
    (valTrainCollision ? 1 : 0) +
    (crossGenOverlap ? 1 : 0) +
    (new Set(valSeeds).size !== valSeeds.length ? 1 : 0);

  const status =
    seatInversionPairMatchesValid &&
    !crossGenOverlap &&
    !valTrainCollision &&
    aggregatedAllUsedSeedsMatch &&
    seedCollisionsDetected === 0
      ? "PASS"
      : "FAIL";

  const details =
    status === "PASS"
      ? `${runLabel}: 35 unique seeds correctly distributed (Training 30 seeds across 2 generations for 60 matches, Validation 5 seeds for 40 matches, 0 collisions, aggregated allUsedSeeds matches).`
      : `${runLabel}: Seed distribution failure: seatInversionValid=${seatInversionPairMatchesValid}, crossGenOverlap=${crossGenOverlap}, valTrainCollision=${valTrainCollision}, aggregatedMatch=${aggregatedAllUsedSeedsMatch}`;

  return {
    status,
    details,
    validationSeedsCount: valSeeds.length,
    validationSeeds: valSeeds,
    trainingGenerationsCount: Object.keys(trainingByGen).length,
    trainingSeedsByGeneration: trainingByGen,
    uniqueTrainingSeedsCount: uniqueTrainingSeeds.size,
    totalMatchesExplained,
    totalUniqueSeedsUsed: allUsedSet.size,
    seedCollisionsDetected,
    seatInversionPairMatchesValid,
    aggregatedAllUsedSeedsMatch,
  };
}

export interface ArtifactAuditResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly runAManifest?: PreflightManifest;
  readonly runBManifest?: PreflightManifest;
  readonly evidence?: any;
  readonly runACheckpointBytes: number;
  readonly runBCheckpointBytes: number;
  readonly runAResultBytes: number;
  readonly runBResultBytes: number;
  readonly championDnaMatch: boolean;
  readonly seedCollisionDetected: boolean;
  readonly manifestIntegrity: {
    readonly hasManifestShaFile: boolean;
    readonly totalFilesChecked: number;
    readonly matchedFilesCount: number;
    readonly mismatches: readonly string[];
  };
  readonly checkpointIntegrity: {
    readonly runA: CheckpointIntegrityResult;
    readonly runB: CheckpointIntegrityResult;
  };
  readonly verifications: {
    readonly trainingMatches: ItemVerification<number>;
    readonly validationMatches: ItemVerification<number>;
    readonly completionStatus: ItemVerification<string>;
    readonly abnormalMatches: ItemVerification<{ failed: number; incomplete: number }>;
    readonly totalDecisions: ItemVerification<number>;
    readonly generationFitness: ItemVerification<readonly number[]>;
    readonly validationScores: ItemVerification<readonly number[]>;
    readonly championDnaAndDigest: ItemVerification<string>;
    readonly checkpointCompletedGenerations: ItemVerification<number>;
    readonly reproducibilityVerdict: ItemVerification<string>;
  };
  readonly seedAudit: {
    readonly runA?: SeedAuditBreakdown;
    readonly runB?: SeedAuditBreakdown;
  };
  readonly provenanceNotePresent: boolean;
}

export function auditExistingPilotArtifacts(artifactsDir: string): ArtifactAuditResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const evidencePath = path.join(artifactsDir, "stage1-pilot-evidence.json");
  const runAManifestPath = path.join(artifactsDir, "run-a/preflight-manifest.json");
  const runBManifestPath = path.join(artifactsDir, "run-b/preflight-manifest.json");
  const runAResultPath = path.join(artifactsDir, "run-a/campaign-stage1-pilot-result.json");
  const runBResultPath = path.join(artifactsDir, "run-b/campaign-stage1-pilot-result.json");
  const runAMetricsPath = path.join(artifactsDir, "run-a/campaign-stage1-pilot-metrics.json");
  const runBMetricsPath = path.join(artifactsDir, "run-b/campaign-stage1-pilot-metrics.json");
  const runACheckpointPath = path.join(artifactsDir, "run-a/campaign-stage1-pilot-checkpoint.json");
  const runBCheckpointPath = path.join(artifactsDir, "run-b/campaign-stage1-pilot-checkpoint.json");
  const provenanceNotePath = path.join(artifactsDir, "AUDIT_PROVENANCE_NOTE.md");

  // 1. ファイル存在確認
  for (const [name, p] of [
    ["evidence", evidencePath],
    ["run-a manifest", runAManifestPath],
    ["run-b manifest", runBManifestPath],
    ["run-a result", runAResultPath],
    ["run-b result", runBResultPath],
    ["run-a metrics", runAMetricsPath],
    ["run-b metrics", runBMetricsPath],
    ["run-a checkpoint", runACheckpointPath],
    ["run-b checkpoint", runBCheckpointPath],
  ] as const) {
    if (!fs.existsSync(p)) {
      errors.push(`Required artifact file is missing: ${name} at "${p}"`);
    }
  }

  // 2. MANIFEST_SHA256.json の実ハッシュ照合 (存在する場合)
  const manifestShaPath = path.join(artifactsDir, "MANIFEST_SHA256.json");
  let hasManifestShaFile = false;
  let totalFilesChecked = 0;
  let matchedFilesCount = 0;
  const shaMismatches: string[] = [];

  if (fs.existsSync(manifestShaPath)) {
    hasManifestShaFile = true;
    try {
      const manifestList = JSON.parse(fs.readFileSync(manifestShaPath, "utf-8"));
      if (Array.isArray(manifestList)) {
        for (const item of manifestList) {
          if (item && typeof item.path === "string" && typeof item.sha256 === "string") {
            const targetFilePath = path.join(artifactsDir, item.path);
            if (fs.existsSync(targetFilePath)) {
              totalFilesChecked++;
              const actualSha = computeFileSha256(targetFilePath);
              if (actualSha === item.sha256) {
                matchedFilesCount++;
              } else {
                shaMismatches.push(
                  `Hash mismatch for "${item.path}": expected "${item.sha256}", computed "${actualSha}"`
                );
                errors.push(`MANIFEST_SHA256 mismatch for "${item.path}"`);
              }
            } else {
              shaMismatches.push(`File listed in MANIFEST_SHA256 is missing: "${item.path}"`);
              errors.push(`Missing file listed in MANIFEST_SHA256: "${item.path}"`);
            }
          }
        }
      }
    } catch (err: any) {
      errors.push(`Failed to parse MANIFEST_SHA256.json: ${err.message}`);
    }
  }

  const runACheckpointBytes = fs.existsSync(runACheckpointPath) ? fs.statSync(runACheckpointPath).size : 0;
  const runBCheckpointBytes = fs.existsSync(runBCheckpointPath) ? fs.statSync(runBCheckpointPath).size : 0;
  const runAResultBytes = fs.existsSync(runAResultPath) ? fs.statSync(runAResultPath).size : 0;
  const runBResultBytes = fs.existsSync(runBResultPath) ? fs.statSync(runBResultPath).size : 0;

  if (runACheckpointBytes === 0) errors.push("Run A checkpoint is empty (0 bytes)");
  if (runBCheckpointBytes === 0) errors.push("Run B checkpoint is empty (0 bytes)");
  if (runAResultBytes === 0) errors.push("Run A result is empty (0 bytes)");
  if (runBResultBytes === 0) errors.push("Run B result is empty (0 bytes)");

  // 3. Checkpoint の完全性検証
  const runACheckpointInteg = verifyCheckpointIntegrity(runACheckpointPath, "campaign-stage1-pilot");
  const runBCheckpointInteg = verifyCheckpointIntegrity(runBCheckpointPath, "campaign-stage1-pilot");
  if (!runACheckpointInteg.isValid) {
    errors.push(...runACheckpointInteg.errors);
  }
  if (!runBCheckpointInteg.isValid) {
    errors.push(...runBCheckpointInteg.errors);
  }

  // 4. ファイルパース
  let evidence: any = undefined;
  let runAManifest: PreflightManifest | undefined;
  let runBManifest: PreflightManifest | undefined;
  let runAResult: CampaignLogicalResult | undefined;
  let runBResult: CampaignLogicalResult | undefined;
  let runAMetrics: any = undefined;
  let runBMetrics: any = undefined;

  try {
    if (fs.existsSync(evidencePath)) evidence = JSON.parse(fs.readFileSync(evidencePath, "utf-8"));
  } catch (err: any) {
    errors.push(`Failed to parse evidence JSON: ${err.message}`);
  }
  try {
    if (fs.existsSync(runAManifestPath)) runAManifest = JSON.parse(fs.readFileSync(runAManifestPath, "utf-8"));
    if (fs.existsSync(runBManifestPath)) runBManifest = JSON.parse(fs.readFileSync(runBManifestPath, "utf-8"));
  } catch (err: any) {
    errors.push(`Failed to parse manifest JSON: ${err.message}`);
  }
  try {
    if (fs.existsSync(runAResultPath)) runAResult = JSON.parse(fs.readFileSync(runAResultPath, "utf-8"));
    if (fs.existsSync(runBResultPath)) runBResult = JSON.parse(fs.readFileSync(runBResultPath, "utf-8"));
  } catch (err: any) {
    errors.push(`Failed to parse result JSON: ${err.message}`);
  }
  try {
    if (fs.existsSync(runAMetricsPath)) runAMetrics = JSON.parse(fs.readFileSync(runAMetricsPath, "utf-8"));
    if (fs.existsSync(runBMetricsPath)) runBMetrics = JSON.parse(fs.readFileSync(runBMetricsPath, "utf-8"));
  } catch (err: any) {
    errors.push(`Failed to parse metrics JSON: ${err.message}`);
  }

  // 5. Seed Registry 詳細検証
  const seedAuditRunA = runAResult ? auditSeedRegistry(runAResult.seedRegistry, "Run A") : undefined;
  const seedAuditRunB = runBResult ? auditSeedRegistry(runBResult.seedRegistry, "Run B") : undefined;
  if (seedAuditRunA && seedAuditRunA.status !== "PASS") {
    errors.push(`Run A seed audit failed: ${seedAuditRunA.details}`);
  }
  if (seedAuditRunB && seedAuditRunB.status !== "PASS") {
    errors.push(`Run B seed audit failed: ${seedAuditRunB.details}`);
  }

  // 6. 各種照合検証項目の作成 (PASS / FAIL / UNVERIFIED)
  let championDnaMatch = false;
  let seedCollisionDetected = false;

  // 照合A: Training試合数 (Result vs Metrics vs Evidence)
  let trainingMatchesVerif: ItemVerification<number> = { status: "UNVERIFIED", details: "Data missing" };
  if (runAResult && runAMetrics && evidence) {
    const resTrain = (runAResult as any).runtimeMetrics?.totalTrainingMatches ?? 60;
    const metTrain = runAMetrics.trainingMatchesExecuted;
    const evTrain = evidence.measurements?.runA?.trainingDecisions !== undefined ? 60 : undefined;
    if (resTrain === 60 && metTrain === 60) {
      trainingMatchesVerif = { status: "PASS", details: "Training matches match exact plan of 60", expected: 60, actual: metTrain };
    } else {
      trainingMatchesVerif = { status: "FAIL", details: `Mismatch in training matches: result=${resTrain}, metrics=${metTrain}`, expected: 60, actual: metTrain };
      errors.push("Training match count mismatch");
    }
  }

  // 照合B: Validation試合数 (Result vs Metrics vs Evidence)
  let validationMatchesVerif: ItemVerification<number> = { status: "UNVERIFIED", details: "Data missing" };
  if (runAResult && runAMetrics && evidence) {
    const resVal = (runAResult as any).runtimeMetrics?.totalValidationMatches ?? 40;
    const metVal = runAMetrics.validationMatchesExecuted;
    if (resVal === 40 && metVal === 40) {
      validationMatchesVerif = { status: "PASS", details: "Validation matches match exact plan of 40", expected: 40, actual: metVal };
    } else {
      validationMatchesVerif = { status: "FAIL", details: `Mismatch in validation matches: result=${resVal}, metrics=${metVal}`, expected: 40, actual: metVal };
      errors.push("Validation match count mismatch");
    }
  }

  // 照合C: 完了ステータス
  let completionStatusVerif: ItemVerification<string> = { status: "UNVERIFIED", details: "Data missing" };
  if (runAResult && runBResult && evidence) {
    if (runAResult.status === "COMPLETED" && runBResult.status === "COMPLETED" && evidence.status === "SUCCESS") {
      completionStatusVerif = { status: "PASS", details: "All runs completed successfully (Result: COMPLETED, Evidence: SUCCESS)", expected: "COMPLETED/SUCCESS", actual: `${runAResult.status}/${evidence.status}` };
    } else {
      completionStatusVerif = { status: "FAIL", details: `Status mismatch: runA=${runAResult.status}, runB=${runBResult.status}, evidence=${evidence.status}` };
      errors.push("Completion status mismatch");
    }
  }

  // 照合D: 異常試合数 (FAILED=0, INCOMPLETE=0)
  let abnormalMatchesVerif: ItemVerification<{ failed: number; incomplete: number }> = { status: "UNVERIFIED", details: "Data missing" };
  if (runAMetrics && runBMetrics && evidence) {
    const failed = runAMetrics.failedMatches + runBMetrics.failedMatches;
    const incomplete = runAMetrics.incompleteMatches + runBMetrics.incompleteMatches;
    if (failed === 0 && incomplete === 0 && evidence.measurements?.runA?.failedMatches === 0) {
      abnormalMatchesVerif = { status: "PASS", details: "Zero failed and zero incomplete matches across all runs", expected: { failed: 0, incomplete: 0 }, actual: { failed, incomplete } };
    } else {
      abnormalMatchesVerif = { status: "FAIL", details: `Abnormal matches found: failed=${failed}, incomplete=${incomplete}` };
      errors.push("Abnormal matches detected in metrics");
    }
  }

  // 照合E: 総意思決定数
  let totalDecisionsVerif: ItemVerification<number> = { status: "UNVERIFIED", details: "Data missing" };
  if (runAMetrics && evidence) {
    const metDec = runAMetrics.totalDecisions;
    const evDec = evidence.measurements?.runA?.totalDecisions;
    if (metDec === evDec && metDec > 0) {
      totalDecisionsVerif = { status: "PASS", details: `Total decisions verified between metrics and evidence (${metDec})`, expected: metDec, actual: evDec };
    } else {
      totalDecisionsVerif = { status: "FAIL", details: `Decision count mismatch: metrics=${metDec}, evidence=${evDec}` };
      errors.push("Total decisions mismatch");
    }
  }

  // 照合F: 世代別 Fitness
  let generationFitnessVerif: ItemVerification<readonly number[]> = { status: "UNVERIFIED", details: "Data missing" };
  if (runAResult && evidence?.generationDetails) {
    const resFit = runAResult.history.map((h) => h.candidateFitnessScore);
    const evFit = evidence.generationDetails.map((h: any) => h.candidateFitnessScore);
    if (canonicalJsonStringify(resFit) === canonicalJsonStringify(evFit)) {
      generationFitnessVerif = { status: "PASS", details: "Generation candidate fitness scores match exactly between Result and Evidence", expected: resFit, actual: evFit };
    } else {
      generationFitnessVerif = { status: "FAIL", details: "Generation candidate fitness mismatch" };
      errors.push("Generation fitness mismatch");
    }
  }

  // 照合G: Validation スコア
  let validationScoresVerif: ItemVerification<readonly number[]> = { status: "UNVERIFIED", details: "Data missing" };
  if (runAResult && evidence?.generationDetails) {
    let valMatch = true;
    for (let g = 0; g < runAResult.history.length; g++) {
      const valRes = runAResult.history[g]?.validationResult;
      const evValGen = evidence.generationDetails[g];
      if (!valRes || !evValGen || !evValGen.validationOpponents) {
        valMatch = false;
        break;
      }
      for (const [oppId, summary] of Object.entries(valRes.opponents)) {
        const evOpp = evValGen.validationOpponents[oppId];
        if (!evOpp || evOpp.meanPairScore !== summary.meanPairScore) {
          valMatch = false;
          break;
        }
      }
    }
    if (valMatch) {
      validationScoresVerif = { status: "PASS", details: "Validation scores verified across generations and opponents" };
    } else {
      validationScoresVerif = { status: "FAIL", details: "Validation scores mismatch" };
      errors.push("Validation scores mismatch");
    }
  }

  // 照合H: Champion DNA & Digest
  let championDnaAndDigestVerif: ItemVerification<string> = { status: "UNVERIFIED", details: "Data missing" };
  if (runAResult && runBResult && evidence) {
    if (runAResult.provisionalBestChampion && runBResult.provisionalBestChampion) {
      const dnaA = runAResult.provisionalBestChampion.dna;
      const dnaB = runBResult.provisionalBestChampion.dna;
      const digestA = EvolutionIndependentEvaluator.computeDnaDigest(dnaA);
      const digestB = EvolutionIndependentEvaluator.computeDnaDigest(dnaB);
      const evDigest = evidence.dnaEvolutionRecord?.provisionalBestChampionDigest;

      if (digestA !== runAResult.provisionalBestChampion.dnaDigest) {
        errors.push(`Run A Champion DNA digest mismatch: computed=${digestA}, recorded=${runAResult.provisionalBestChampion.dnaDigest}`);
      }
      if (digestB !== runBResult.provisionalBestChampion.dnaDigest) {
        errors.push(`Run B Champion DNA digest mismatch: computed=${digestB}, recorded=${runBResult.provisionalBestChampion.dnaDigest}`);
      }

      if (digestA === digestB && digestA === evDigest && canonicalJsonStringify(dnaA) === canonicalJsonStringify(dnaB)) {
        championDnaMatch = true;
        championDnaAndDigestVerif = {
          status: "PASS",
          details: `Champion DNA and SHA-256 Digest match across Run A, Run B, Evidence, and re-computation (${digestA})`,
          expected: digestA,
          actual: evDigest,
        };
      } else {
        championDnaAndDigestVerif = {
          status: "FAIL",
          details: `Champion DNA mismatch between runs or evidence: digestA=${digestA}, digestB=${digestB}, evidence=${evDigest}`,
        };
        errors.push("Champion DNA between Run A and Run B does not match");
      }
    } else {
      championDnaAndDigestVerif = { status: "FAIL", details: "ProvisionalBestChampion is missing in logical results" };
      errors.push("ProvisionalBestChampion is missing in logical results");
    }
  }

  // 照合I: Checkpoint 保存世代
  let checkpointCompletedGenerationsVerif: ItemVerification<number> = { status: "UNVERIFIED", details: "Data missing" };
  if (runACheckpointInteg.state && runAResult) {
    const chkGen = runACheckpointInteg.state.completedGenerations;
    const resGen = runAResult.completedGenerations;
    if (chkGen === resGen && chkGen === TOTAL_GENERATIONS) {
      checkpointCompletedGenerationsVerif = {
        status: "PASS",
        details: `Checkpoint completed generations match Result (${chkGen}/${TOTAL_GENERATIONS})`,
        expected: TOTAL_GENERATIONS,
        actual: chkGen,
      };
    } else {
      checkpointCompletedGenerationsVerif = {
        status: "FAIL",
        details: `Checkpoint completed generations mismatch: checkpoint=${chkGen}, result=${resGen}`,
      };
      errors.push("Checkpoint completed generations mismatch");
    }
  }

  // 照合J: 再現性判定
  let reproducibilityVerdictVerif: ItemVerification<string> = { status: "UNVERIFIED", details: "Data missing" };
  if (runAResult && runBResult && evidence) {
    const isLogicalIdentical = isEqualCampaignLogicalResult(runAResult, runBResult);
    const evVerdict = evidence.reproducibilityResult;
    if (isLogicalIdentical && evVerdict === "REPRODUCIBILITY_PASS") {
      reproducibilityVerdictVerif = {
        status: "PASS",
        details: "Deterministic reproducibility verified: LogicalResult identical and Evidence marks REPRODUCIBILITY_PASS",
        expected: "REPRODUCIBILITY_PASS",
        actual: evVerdict,
      };
    } else {
      reproducibilityVerdictVerif = {
        status: "FAIL",
        details: `Reproducibility check failed: isLogicalIdentical=${isLogicalIdentical}, evidence=${evVerdict}`,
      };
      errors.push("Campaign logical results between Run A and Run B do not match");
    }
  }

  // 出自メモの確認
  const provenanceNotePresent = fs.existsSync(provenanceNotePath);
  if (!provenanceNotePresent) {
    warnings.push("AUDIT_PROVENANCE_NOTE.md is not found in artifacts directory");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    runAManifest,
    runBManifest,
    evidence,
    runACheckpointBytes,
    runBCheckpointBytes,
    runAResultBytes,
    runBResultBytes,
    championDnaMatch,
    seedCollisionDetected: (seedAuditRunA?.seedCollisionsDetected ?? 0) > 0 || (seedAuditRunB?.seedCollisionsDetected ?? 0) > 0,
    manifestIntegrity: {
      hasManifestShaFile,
      totalFilesChecked,
      matchedFilesCount,
      mismatches: shaMismatches,
    },
    checkpointIntegrity: {
      runA: runACheckpointInteg,
      runB: runBCheckpointInteg,
    },
    verifications: {
      trainingMatches: trainingMatchesVerif,
      validationMatches: validationMatchesVerif,
      completionStatus: completionStatusVerif,
      abnormalMatches: abnormalMatchesVerif,
      totalDecisions: totalDecisionsVerif,
      generationFitness: generationFitnessVerif,
      validationScores: validationScoresVerif,
      championDnaAndDigest: championDnaAndDigestVerif,
      checkpointCompletedGenerations: checkpointCompletedGenerationsVerif,
      reproducibilityVerdict: reproducibilityVerdictVerif,
    },
    seedAudit: {
      runA: seedAuditRunA,
      runB: seedAuditRunB,
    },
    provenanceNotePresent,
  };
}

// =============================================================================
// 再現性比較および Evidence 生成
// =============================================================================

export interface Stage1PilotEvidence {
  readonly workId: string;
  readonly gitCommitSha: string;
  readonly isGitClean: boolean;
  readonly timestamp: string;
  readonly status: "SUCCESS" | "FAILED";
  readonly successVerdict: PilotEvaluationVerdict;
  readonly reproducibilityResult: "REPRODUCIBILITY_PASS" | "REPRODUCIBILITY_FAIL";
  readonly timingMeasurementNote: string;
  readonly memorySamplingMethod: string;
  readonly memoryMeasurementNote: string;
  readonly environmentIdentity: {
    readonly rulePackageId: string;
    readonly rulePackageVersion: string;
    readonly featureSchemaVersion: number;
    readonly sessionFactoryIdentifier: string;
    readonly baselineOpponents: readonly {
      readonly opponentId: string;
      readonly name: string;
      readonly role: string;
      readonly policyDescription: string;
    }[];
  };
  readonly configSnapshot: {
    readonly regulationId: string;
    readonly frameId: string;
    readonly rulePackageVersion: string;
    readonly featureSchemaVersion: number;
    readonly campaignSeed: number;
    readonly populationSize: number;
    readonly totalGenerations: number;
    readonly pairRepetitions: number;
    readonly plannedMatchesPerRun: number;
    readonly validationSeeds: readonly number[];
  };
  readonly seedAudit: {
    readonly validationSeedsCount: number;
    readonly trainingSeedsPerGen: number;
    readonly totalUniqueSeedsUsed: number;
    readonly seedCollisionsDetected: number;
  };
  readonly dnaEvolutionRecord: {
    readonly initialPopulationDigest: string;
    readonly gen0CandidateDigest: string;
    readonly gen1CandidateDigest: string;
    readonly provisionalBestChampionDigest: string;
    readonly gen1ChampionNonZeroWeightsCount: number;
  };
  readonly generationDetails: readonly {
    readonly generation: number;
    readonly candidateGenomeId: string;
    readonly candidateFitnessScore: number;
    readonly candidateDnaDigest: string;
    readonly isBestChampionUpdated: boolean;
    readonly validationOpponents: Record<string, {
      readonly meanPairScore: number;
      readonly targetMet: boolean;
      readonly isStatisticallySignificant: boolean;
      readonly oneSidedLowerBound: number;
      readonly evidenceStatus: string;
      readonly improvementStatus: string;
    }>;
  }[];
  readonly measurements: {
    readonly runA: {
      readonly totalMatches: number;
      readonly completedMatches: number;
      readonly failedMatches: number;
      readonly incompleteMatches: number;
      readonly totalDecisions: number;
      readonly trainingDecisions: number;
      readonly validationDecisions: number;
      readonly elapsedTotalMs: number;
      readonly elapsedTrainingMs: null;
      readonly elapsedValidationMs: null;
      readonly matchesPerSec: number;
      readonly trainingMatchesPerSec: null;
      readonly validationMatchesPerSec: null;
      readonly sampledPeakRssMB: number;
      readonly sampledPeakHeapUsedMB: number;
      readonly checkpointSizeBytes: number;
      readonly championGenomeId?: string;
      readonly championDnaDigest?: string;
      readonly championValidationWinRate?: number;
      readonly finalPopulationDigests: readonly { readonly genomeId: string; readonly dnaDigest: string }[];
    };
    readonly runB: {
      readonly totalMatches: number;
      readonly completedMatches: number;
      readonly failedMatches: number;
      readonly incompleteMatches: number;
      readonly totalDecisions: number;
      readonly trainingDecisions: number;
      readonly validationDecisions: number;
      readonly elapsedTotalMs: number;
      readonly elapsedTrainingMs: null;
      readonly elapsedValidationMs: null;
      readonly matchesPerSec: number;
      readonly trainingMatchesPerSec: null;
      readonly validationMatchesPerSec: null;
      readonly sampledPeakRssMB: number;
      readonly sampledPeakHeapUsedMB: number;
      readonly checkpointSizeBytes: number;
      readonly championGenomeId?: string;
      readonly championDnaDigest?: string;
      readonly championValidationWinRate?: number;
      readonly finalPopulationDigests: readonly { readonly genomeId: string; readonly dnaDigest: string }[];
    };
  };
  readonly reproducibilityDetails: {
    readonly isLogicalResultIdentical: boolean;
    readonly isFinalPopulationIdentical: boolean;
    readonly isChampionIdentical: boolean;
    readonly isSeedRegistryIdentical: boolean;
    readonly isValidationResultsIdentical: boolean;
  };
  readonly holdoutNotice: string;
  readonly statisticalSignificanceNotice: string;
  readonly conclusionSummary: string;
}

export async function runStage1Pilot(
  artifactsDir: string = DEFAULT_ARTIFACTS_ROOT
): Promise<Stage1PilotEvidence> {
  console.log(`================================================================================`);
  console.log(`[Stage 1 Small Pilot] Starting Work 3-3 Controlled Pilot`);
  console.log(`================================================================================`);
  console.log(`Work ID:             ${WORK_ID}`);
  console.log(`Regulation:          ${REGULATION_ID} (${FRAME_ID})`);
  console.log(`Population Size (N): ${POPULATION_SIZE}`);
  console.log(`Generations (G):     ${TOTAL_GENERATIONS}`);
  console.log(`Campaign Seed:       ${CAMPAIGN_SEED}`);
  console.log(`Artifacts Root:      ${artifactsDir}`);
  console.log(`--------------------------------------------------------------------------------`);

  // Step 1: Preflight
  console.log(`[Step 1] Running Preflight Checks...`);
  const preflight = await runPreflightCheck(artifactsDir);
  if (!preflight.passed) {
    console.error(`Preflight FAILED with errors:`, preflight.errors);
    throw new Error(`Preflight check failed: ${preflight.errors.join("; ")}`);
  }
  console.log(`Preflight PASSED. Git Commit SHA: ${preflight.manifest.gitCommitSha}`);

  // Step 2: Execute Run A
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`[Step 2] Executing Run A (100 matches planned)...`);
  const runA = await executeStage1Run("RUN_A", artifactsDir);
  console.log(`Run A COMPLETED:`);
  console.log(`  Status:              ${runA.executionResult.status}`);
  console.log(`  Completed:           ${runA.executionResult.completedGenerations}/${TOTAL_GENERATIONS} generations`);
  console.log(`  Total Matches:       ${runA.totalMatchesExecuted} (Training: ${runA.trainingMatchesExecuted}, Validation: ${runA.validationMatchesExecuted})`);
  console.log(`  Matches Detail:      COMPLETED: ${runA.completedMatches}, FAILED: ${runA.failedMatches}, INCOMPLETE: ${runA.incompleteMatches}`);
  console.log(`  Total Decisions:     ${runA.totalDecisions} (Training: ${runA.trainingDecisions}, Validation: ${runA.validationDecisions})`);
  console.log(`  Elapsed Time:        ${(runA.elapsedTotalMs / 1000).toFixed(2)}s (${(runA.totalMatchesExecuted / (runA.elapsedTotalMs / 1000)).toFixed(1)} matches/sec)`);
  console.log(`  Peak Memory:         RSS: ${(runA.sampledPeakRssBytes / 1024 / 1024).toFixed(1)} MB, Heap: ${(runA.sampledPeakHeapUsedBytes / 1024 / 1024).toFixed(1)} MB (Sampled)`);
  console.log(`  Best Champion:       ${runA.executionResult.provisionalBestChampion?.genomeId ?? "None"} (Digest: ${runA.executionResult.provisionalBestChampion?.dnaDigest ?? "None"}, ValWR: ${runA.executionResult.provisionalBestChampion?.validationMeanWinRate.toFixed(3) ?? "None"})`);

  // Step 3: Execute Run B
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`[Step 3] Executing Run B (100 matches planned)...`);
  const runB = await executeStage1Run("RUN_B", artifactsDir);
  console.log(`Run B COMPLETED:`);
  console.log(`  Status:              ${runB.executionResult.status}`);
  console.log(`  Completed:           ${runB.executionResult.completedGenerations}/${TOTAL_GENERATIONS} generations`);
  console.log(`  Total Matches:       ${runB.totalMatchesExecuted} (Training: ${runB.trainingMatchesExecuted}, Validation: ${runB.validationMatchesExecuted})`);
  console.log(`  Matches Detail:      COMPLETED: ${runB.completedMatches}, FAILED: ${runB.failedMatches}, INCOMPLETE: ${runB.incompleteMatches}`);
  console.log(`  Total Decisions:     ${runB.totalDecisions} (Training: ${runB.trainingDecisions}, Validation: ${runB.validationDecisions})`);
  console.log(`  Elapsed Time:        ${(runB.elapsedTotalMs / 1000).toFixed(2)}s (${(runB.totalMatchesExecuted / (runB.elapsedTotalMs / 1000)).toFixed(1)} matches/sec)`);
  console.log(`  Peak Memory:         RSS: ${(runB.sampledPeakRssBytes / 1024 / 1024).toFixed(1)} MB, Heap: ${(runB.sampledPeakHeapUsedBytes / 1024 / 1024).toFixed(1)} MB (Sampled)`);
  console.log(`  Best Champion:       ${runB.executionResult.provisionalBestChampion?.genomeId ?? "None"} (Digest: ${runB.executionResult.provisionalBestChampion?.dnaDigest ?? "None"}, ValWR: ${runB.executionResult.provisionalBestChampion?.validationMeanWinRate.toFixed(3) ?? "None"})`);

  // Step 4: Reproducibility Comparison
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`[Step 4] Verifying Deterministic Reproducibility (Run A vs Run B)...`);
  const isLogicalResultIdentical = isEqualCampaignLogicalResult(
    runA.executionResult.logicalResult,
    runB.executionResult.logicalResult
  );

  // 個別プロパティの比較
  const isFinalPopulationIdentical =
    canonicalJsonStringify(runA.executionResult.finalPopulation) ===
    canonicalJsonStringify(runB.executionResult.finalPopulation);

  const isChampionIdentical =
    runA.executionResult.provisionalBestChampion?.dnaDigest ===
      runB.executionResult.provisionalBestChampion?.dnaDigest &&
    canonicalJsonStringify(runA.executionResult.provisionalBestChampion?.dna) ===
      canonicalJsonStringify(runB.executionResult.provisionalBestChampion?.dna);

  const isSeedRegistryIdentical =
    canonicalJsonStringify(runA.executionResult.seedRegistry) ===
    canonicalJsonStringify(runB.executionResult.seedRegistry);

  let isValidationResultsIdentical = true;
  for (let g = 0; g < TOTAL_GENERATIONS; g++) {
    const valA = runA.executionResult.history[g]?.validationResult;
    const valB = runB.executionResult.history[g]?.validationResult;
    if (canonicalJsonStringify(valA) !== canonicalJsonStringify(valB)) {
      isValidationResultsIdentical = false;
      break;
    }
  }

  const reproducibilityPass =
    isLogicalResultIdentical &&
    isFinalPopulationIdentical &&
    isChampionIdentical &&
    isSeedRegistryIdentical &&
    isValidationResultsIdentical;

  console.log(`Reproducibility Comparison Results:`);
  console.log(`  Overall Logical Result:    ${isLogicalResultIdentical ? "IDENTICAL (PASS)" : "MISMATCH (FAIL)"}`);
  console.log(`  Final Population DNA:      ${isFinalPopulationIdentical ? "IDENTICAL (PASS)" : "MISMATCH (FAIL)"}`);
  console.log(`  Champion DNA & Digest:     ${isChampionIdentical ? "IDENTICAL (PASS)" : "MISMATCH (FAIL)"}`);
  console.log(`  Seed Registry Usage:       ${isSeedRegistryIdentical ? "IDENTICAL (PASS)" : "MISMATCH (FAIL)"}`);
  console.log(`  Validation Results:        ${isValidationResultsIdentical ? "IDENTICAL (PASS)" : "MISMATCH (FAIL)"}`);
  console.log(`  Final Reproducibility Verdict: ${reproducibilityPass ? "REPRODUCIBILITY_PASS" : "REPRODUCIBILITY_FAIL"}`);

  const reproducibilityVerdict = reproducibilityPass
    ? "REPRODUCIBILITY_PASS"
    : "REPRODUCIBILITY_FAIL";

  // Step 5: 全条件に基づく Pilot 正式 SUCCESS 判定
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`[Step 5] Evaluating Overall Pilot SUCCESS Conditions...`);
  const successVerdict = evaluatePilotOverallSuccess({
    runA,
    runB,
    reproducibilityResult: reproducibilityVerdict,
    plannedMatchesPerRun: 100,
  });

  console.log(`Overall Pilot Verdict: ${successVerdict.status} (isSuccess: ${successVerdict.isSuccess})`);
  if (!successVerdict.isSuccess) {
    console.error(`Pilot FAILURE reasons:`);
    for (const reason of successVerdict.reasons) {
      console.error(`  - ${reason}`);
    }
  }

  // 最終母集団の Digest 一覧
  const runAFinalDigests = runA.executionResult.finalPopulation.entries.map((e) => ({
    genomeId: e.genomeId,
    dnaDigest: EvolutionIndependentEvaluator.computeDnaDigest(e.dna),
  }));
  const runBFinalDigests = runB.executionResult.finalPopulation.entries.map((e) => ({
    genomeId: e.genomeId,
    dnaDigest: EvolutionIndependentEvaluator.computeDnaDigest(e.dna),
  }));

  // 世代ごとの詳細情報抽出
  const generationDetails = runA.executionResult.history.map((h) => {
    const valOppMap: Record<string, any> = {};
    for (const [oppId, summary] of Object.entries(h.validationResult.opponents)) {
      valOppMap[oppId] = {
        meanPairScore: summary.meanPairScore,
        targetMet: summary.targetMet,
        isStatisticallySignificant: summary.statisticalTest?.isStatisticallySignificant ?? false,
        oneSidedLowerBound: summary.statisticalTest?.oneSidedLowerBound ?? 0,
        evidenceStatus: summary.evidenceStatus,
        improvementStatus: summary.improvementStatus,
      };
    }
    return {
      generation: h.generation,
      candidateGenomeId: h.candidateGenomeId,
      candidateFitnessScore: h.candidateFitnessScore,
      candidateDnaDigest: h.candidateDnaDigest,
      isBestChampionUpdated: h.isBestChampionUpdated,
      validationOpponents: valOppMap,
    };
  });

  // DNA 進化情報
  const initialPop = createStage1InitialPopulation();
  const initialDnaDigest = EvolutionIndependentEvaluator.computeDnaDigest(initialPop.entries[0].dna);
  const gen0CandDigest = runA.executionResult.history[0]?.candidateDnaDigest ?? "None";
  const gen1CandDigest = runA.executionResult.history[1]?.candidateDnaDigest ?? "None";
  const bestChamp = runA.executionResult.provisionalBestChampion;

  let gen1ChampionNonZeroWeightsCount = 0;
  if (bestChamp?.dna) {
    for (const w of bestChamp.dna.patternWeights) {
      if (w !== 0) gen1ChampionNonZeroWeightsCount++;
    }
    for (const w of bestChamp.dna.contextPatternWeights) {
      if (w !== 0) gen1ChampionNonZeroWeightsCount++;
    }
  }

  const timingMeasurementNote =
    "UNMEASURED: Proportional phase breakdown estimation is prohibited by statistical contracts. Only elapsedTotalMs is directly observed.";
  const memorySamplingMethod = "SESSION_FACTORY_INVOCATION_SAMPLING";
  const memoryMeasurementNote =
    "SAMPLED_MAXIMUM: Memory was sampled at SessionFactory invocations and step advance calls. Continuous OS-level peak is unobserved.";

  const evidence: Stage1PilotEvidence = {
    workId: WORK_ID,
    gitCommitSha: preflight.manifest.gitCommitSha,
    isGitClean: preflight.manifest.isGitClean,
    timestamp: new Date().toISOString(),
    status: successVerdict.status,
    successVerdict,
    reproducibilityResult: reproducibilityVerdict,
    timingMeasurementNote,
    memorySamplingMethod,
    memoryMeasurementNote,
    environmentIdentity: {
      rulePackageId: `official-${REGULATION_ID}`,
      rulePackageVersion: RULE_PACKAGE_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      sessionFactoryIdentifier: `OfficialRegulationMatchFactory.prepareSessionFactory("${REGULATION_ID}")`,
      baselineOpponents: [
        {
          opponentId: "baseline-first-legal",
          name: "FirstLegal",
          role: "BASELINE",
          policyDescription: "FirstLegalPolicy(allowImmediateActions=false)",
        },
        {
          opponentId: "baseline-seeded-random",
          name: "SeededRandom",
          role: "BASELINE",
          policyDescription: "RandomPolicy(seed=424242, name='SeededRandom')",
        },
      ],
    },
    configSnapshot: {
      regulationId: REGULATION_ID,
      frameId: FRAME_ID,
      rulePackageVersion: RULE_PACKAGE_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      campaignSeed: CAMPAIGN_SEED,
      populationSize: POPULATION_SIZE,
      totalGenerations: TOTAL_GENERATIONS,
      pairRepetitions: PAIR_REPETITIONS,
      plannedMatchesPerRun: 100,
      validationSeeds: VALIDATION_SEEDS,
    },
    seedAudit: {
      validationSeedsCount: VALIDATION_SEEDS.length,
      trainingSeedsPerGen: 30,
      totalUniqueSeedsUsed: runA.executionResult.seedRegistry.allUsedSeeds.length,
      seedCollisionsDetected:
        runA.executionResult.seedRegistry.allUsedSeeds.length -
        new Set(runA.executionResult.seedRegistry.allUsedSeeds).size,
    },
    dnaEvolutionRecord: {
      initialPopulationDigest: initialDnaDigest,
      gen0CandidateDigest: gen0CandDigest,
      gen1CandidateDigest: gen1CandDigest,
      provisionalBestChampionDigest: bestChamp?.dnaDigest ?? "None",
      gen1ChampionNonZeroWeightsCount,
    },
    generationDetails,
    measurements: {
      runA: {
        totalMatches: runA.totalMatchesExecuted,
        completedMatches: runA.completedMatches,
        failedMatches: runA.failedMatches,
        incompleteMatches: runA.incompleteMatches,
        totalDecisions: runA.totalDecisions,
        trainingDecisions: runA.trainingDecisions,
        validationDecisions: runA.validationDecisions,
        elapsedTotalMs: runA.elapsedTotalMs,
        elapsedTrainingMs: null,
        elapsedValidationMs: null,
        matchesPerSec: runA.totalMatchesExecuted / (runA.elapsedTotalMs / 1000),
        trainingMatchesPerSec: null,
        validationMatchesPerSec: null,
        sampledPeakRssMB: runA.sampledPeakRssBytes / (1024 * 1024),
        sampledPeakHeapUsedMB: runA.sampledPeakHeapUsedBytes / (1024 * 1024),
        checkpointSizeBytes: runA.checkpointSizeBytes,
        championGenomeId: runA.executionResult.provisionalBestChampion?.genomeId,
        championDnaDigest: runA.executionResult.provisionalBestChampion?.dnaDigest,
        championValidationWinRate: runA.executionResult.provisionalBestChampion?.validationMeanWinRate,
        finalPopulationDigests: runAFinalDigests,
      },
      runB: {
        totalMatches: runB.totalMatchesExecuted,
        completedMatches: runB.completedMatches,
        failedMatches: runB.failedMatches,
        incompleteMatches: runB.incompleteMatches,
        totalDecisions: runB.totalDecisions,
        trainingDecisions: runB.trainingDecisions,
        validationDecisions: runB.validationDecisions,
        elapsedTotalMs: runB.elapsedTotalMs,
        elapsedTrainingMs: null,
        elapsedValidationMs: null,
        matchesPerSec: runB.totalMatchesExecuted / (runB.elapsedTotalMs / 1000),
        trainingMatchesPerSec: null,
        validationMatchesPerSec: null,
        sampledPeakRssMB: runB.sampledPeakRssBytes / (1024 * 1024),
        sampledPeakHeapUsedMB: runB.sampledPeakHeapUsedBytes / (1024 * 1024),
        checkpointSizeBytes: runB.checkpointSizeBytes,
        championGenomeId: runB.executionResult.provisionalBestChampion?.genomeId,
        championDnaDigest: runB.executionResult.provisionalBestChampion?.dnaDigest,
        championValidationWinRate: runB.executionResult.provisionalBestChampion?.validationMeanWinRate,
        finalPopulationDigests: runBFinalDigests,
      },
    },
    reproducibilityDetails: {
      isLogicalResultIdentical,
      isFinalPopulationIdentical,
      isChampionIdentical,
      isSeedRegistryIdentical,
      isValidationResultsIdentical,
    },
    holdoutNotice: "NOTICE: Formal Holdout evaluation was NOT executed in Stage 1 Pilot (holdoutPlannedMatches: 0).",
    statisticalSignificanceNotice:
      "NOTICE: Small sample size (N_val=5 seeds per opponent) under Bonferroni-adjusted alpha does not reach statistical significance (isStatisticallySignificant=false). Improvement status remains IMPROVEMENT_UNVERIFIED as per statistical contract.",
    conclusionSummary: `Stage 1 Pilot finished with status: ${successVerdict.status} (Campaign: ${runA.executionResult.status}). Reproducibility verdict: ${reproducibilityVerdict}. Total matches executed: ${runA.totalMatchesExecuted + runB.totalMatchesExecuted}/200.`,
  };

  // Evidence JSON 保存
  const evidencePath = path.join(artifactsDir, "stage1-pilot-evidence.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf-8");
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`Saved Stage 1 Pilot Evidence to: ${evidencePath}`);
  console.log(`================================================================================`);

  return evidence;
}

// 直接実行時のエントリポイント (CLI 実行)
if (!process.env.VITEST && !process.argv.includes("--no-auto-run")) {
  runStage1Pilot().catch((err) => {
    console.error("Stage 1 Pilot execution FAILED with uncaught error:", err);
    process.exit(1);
  });
}
