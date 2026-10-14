import {
  FitnessEvaluationSnapshot,
  PopulationSnapshot,
  SelectionReadiness,
} from "./PopulationSelectionTypes";
import {
  FitnessEvaluationConfig,
  DEFAULT_FITNESS_EVALUATION_CONFIG,
} from "./FitnessEvaluationTypes";
import {
  GenerationBuilderConfig,
  GenerationBuildResult,
} from "./GenerationBuilderTypes";
import { BatchMatchContext, BatchSimulationOptions } from "../simulation/BatchSimulationTypes";

/**
 * 試合実行フェーズ識別型 (Runner 障害診断用)
 */
export type GenerationRunnerExecutionPhase =
  | "SESSION_FACTORY"
  | "POLICY_FACTORY"
  | "RUNNER";

/**
 * 試合実行時障害の診断情報コンテナ
 * ※ 実在する試合の診断情報 (phase, matchIndex, p1, p2, causeName) を保持する。
 * ※ causeMessage はデバッグ用情報 (Debug Detail) であり、決定論的比較保証の対象外。
 */
export interface GenerationRunnerExecutionDiagnostics {
  readonly phase: GenerationRunnerExecutionPhase;
  readonly matchIndex: number;
  readonly p1GenomeId: string;
  readonly p2GenomeId: string;
  readonly causeName?: string;
  readonly causeMessage?: string;
}

/**
 * カノニカルスケジュールにおける単一試合記述子
 */
export interface GenerationEvaluationMatch {
  readonly matchIndex: number;
  readonly pairIndex: number;
  readonly repetitionIndex: number;
  readonly legIndex: 0 | 1;
  readonly p1GenomeId: string;
  readonly p2GenomeId: string;
  readonly matchSeed: number;
}

/**
 * 試合実行結果の最小記述子 (Outcome集計用)
 */
export interface GenerationMatchOutcome {
  readonly matchIndex: number;
  readonly p1GenomeId: string;
  readonly p2GenomeId: string;
  readonly completed: boolean;
  readonly winner?: "p1" | "p2" | undefined;
}

/**
 * 評価実行の純粋論理マニフェスト (決定論的メタデータ)
 * ※ wall-clock やタイムスタンプは含めない。
 */
export interface GenerationEvaluationManifest {
  readonly generation: number;
  readonly populationSize: number;
  readonly pairRepetitions: number;
  readonly totalMatches: number;
  readonly generationSeed: number;
  readonly evaluationScheduleId: string;
  readonly seedScheduleIdentity: string;
}

/**
 * 実行環境コンテキスト (Caller 提供の不変環境情報)
 */
export interface GenerationRunnerEnvironmentContext {
  readonly environmentRef: string;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
}

/**
 * Generation Runner の設定パラメータ
 */
export interface GenerationRunnerConfig {
  readonly pairRepetitions: number;
  readonly maxDecisionsPerMatch: number;
  readonly fitnessConfig: FitnessEvaluationConfig;
  readonly builderConfig?: Partial<GenerationBuilderConfig>;
}

/**
 * Generation Runner のデフォルト設定値
 */
export const DEFAULT_GENERATION_RUNNER_CONFIG: GenerationRunnerConfig = Object.freeze({
  pairRepetitions: 1,
  maxDecisionsPerMatch: 500,
  fitnessConfig: DEFAULT_FITNESS_EVALUATION_CONFIG,
});

/**
 * Generation Runner の実行パラメータ
 */
export interface RunGenerationParams {
  readonly population: PopulationSnapshot;
  readonly generationSeed: number;
  readonly environment: GenerationRunnerEnvironmentContext;
  readonly sessionFactory: BatchSimulationOptions["sessionFactory"];
  readonly config?: Partial<GenerationRunnerConfig>;
}

/**
 * 世代交代が正常完了した論理結果
 */
export interface GenerationRunnerAdvancedResult {
  readonly status: "ADVANCED";
  readonly nextPopulation: PopulationSnapshot;
  readonly buildResult: GenerationBuildResult;
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly manifest: GenerationEvaluationManifest;
}

/**
 * 適応度評価は完了したが次世代へ進めない論理結果
 */
export interface GenerationRunnerReevaluationRequiredResult {
  readonly status: "REEVALUATION_REQUIRED";
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly reason: string;
  readonly readiness: SelectionReadiness;
  readonly manifest: GenerationEvaluationManifest;
  readonly nextPopulation?: undefined;
  readonly buildResult?: undefined;
}

/**
 * 決定論的論理結果 (Deep Equal 保証対象)
 */
export type GenerationRunnerLogicalResult =
  | GenerationRunnerAdvancedResult
  | GenerationRunnerReevaluationRequiredResult;

/**
 * 実行時メトリクス (Sidecar, Deep Equal 対象外)
 */
export interface GenerationRunnerRuntimeMetrics {
  readonly totalExecutionTimeMs: number;
  readonly matchExecutionElapsedMs: number;
  readonly matchesPerSecond: number;
  readonly totalDecisions: number;
}

/**
 * Generation Runner の総合実行結果
 */
export interface GenerationRunnerExecutionResult {
  readonly logicalResult: GenerationRunnerLogicalResult;
  readonly runtimeMetrics?: GenerationRunnerRuntimeMetrics;
}

/**
 * Generation Runner 基底エラー型
 */
export class GenerationRunnerError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GenerationRunnerError";
  }
}

/**
 * 開始前事前検証 (Preflight Validation) で検出された静的設定不備を表すエラー型
 */
export class GenerationRunnerConfigurationError extends GenerationRunnerError {
  public constructor(message: string) {
    super(message);
    this.name = "GenerationRunnerConfigurationError";
  }
}

/**
 * データ整合性違反、保存則違反、Comparable Context 不整合、
 * または Runner ↔ Builder 間の Contract Drift (事前判定と生成判定の乖離) を表すエラー型
 */
export class GenerationRunnerIntegrityError extends GenerationRunnerError {
  public constructor(message: string) {
    super(message);
    this.name = "GenerationRunnerIntegrityError";
  }
}

/**
 * 試合実行ループ内 (SESSION_FACTORY, POLICY_FACTORY, RUNNER) の実行時障害を表すエラー型
 * ※実在する試合の診断情報 (phase, matchIndex, p1, p2, causeName) を必須として保持する。
 * ※causeMessage はデバッグ用情報 (Debug Detail) であり、決定論的比較保証の対象外。
 */
export class GenerationRunnerExecutionError extends GenerationRunnerError {
  public readonly phase: GenerationRunnerExecutionPhase;
  public readonly matchIndex: number;
  public readonly p1GenomeId: string;
  public readonly p2GenomeId: string;
  public readonly causeName?: string;
  public readonly causeMessage?: string;

  public constructor(
    message: string,
    diagnostics: GenerationRunnerExecutionDiagnostics
  ) {
    super(message);
    this.name = "GenerationRunnerExecutionError";
    this.phase = diagnostics.phase;
    this.matchIndex = diagnostics.matchIndex;
    this.p1GenomeId = diagnostics.p1GenomeId;
    this.p2GenomeId = diagnostics.p2GenomeId;
    this.causeName = diagnostics.causeName;
    this.causeMessage = diagnostics.causeMessage;
  }
}

/**
 * Canonical Evaluation Schedule ID 命名規則
 */
export function canonicalEvaluationScheduleId(
  pairRepetitions: number,
  maxDecisionsPerMatch: number
): string {
  return `double-round-robin-v1:r=${pairRepetitions}:max-decisions=${maxDecisionsPerMatch}`;
}

/**
 * Canonical Seed Schedule Identity 命名規則
 */
export function canonicalSeedScheduleIdentity(generationSeed: number): string {
  return `evolution-evaluation-pair-v1:generation-seed=${generationSeed}`;
}

/**
 * Evaluation Stream Key 生成規則
 */
export function getEvaluationPairStreamKey(pairIndex: number, repetitionIndex: number): string {
  return `evolution-evaluation-pair-v1-${pairIndex}-${repetitionIndex}`;
}
