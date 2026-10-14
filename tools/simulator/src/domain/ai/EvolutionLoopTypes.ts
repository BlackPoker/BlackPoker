/**
 * Evolution Loop Types (BP-SIM-AI-EVOLUTION-LOOP-DESIGN-V1-R2 / BP-SIM-AI-EVOLUTION-LOOP-V1)
 *
 * BlackPoker Simulator AI基盤における複数世代進化ループ（Evolution Loop）の公開型定義。
 * 設計仕様書: tools/simulator/docs/ai-evolution-loop-design-v1.md
 *
 * 設計原則:
 * 1. GenerationRunner への一元委譲 ("One Generation Only" 契約の不変維持)
 * 2. 決定論的シードスケジュール (campaignSeed + sourceGeneration 直接導出、非連鎖)
 * 3. 疎結合な Public Logical Contract (オブジェクト参照同一性への非依存、Variable N 合法)
 * 4. REEVALUATION_REQUIRED 時の即時論理停止 (自動リトライ排除)
 * 5. Runner エラーの完全透過伝搬 (同一エラーインスタンスの throw)
 * 6. メモリ爆発防止 (世代履歴レコードからの中間 PopulationSnapshot 排除)
 * 7. 論理結果と実行時メトリクス Sidecar の完全分離
 */

import {
  FitnessEvaluationSnapshot,
  PopulationSnapshot,
  SelectionReadiness,
} from "./PopulationSelectionTypes";
import {
  GenerationEvaluationManifest,
  GenerationRunnerConfig,
  GenerationRunnerEnvironmentContext,
  GenerationRunnerRuntimeMetrics,
} from "./GenerationRunnerTypes";
import { OffspringLineageMetadata } from "./GeneticOperatorTypes";
import { BatchSimulationOptions } from "../simulation/BatchSimulationTypes";

/**
 * Canonical Stream Prefix & Schedule Identity
 */
export const EVOLUTION_LOOP_STREAM_PREFIX = "evolution-loop-generation-v1";

export function canonicalGenerationStreamKey(sourceGeneration: number): string {
  return `${EVOLUTION_LOOP_STREAM_PREFIX}-${sourceGeneration}`;
}

export function canonicalLoopSeedScheduleIdentity(campaignSeed: number): string {
  return `${EVOLUTION_LOOP_STREAM_PREFIX}:campaign-seed=${campaignSeed}`;
}

/**
 * Evolution Loop の設定パラメータ
 */
export interface EvolutionLoopConfig {
  /** 実行対象の世代遷移数 (finite integer >= 1) */
  readonly generationCount: number;
  /** 各世代の GenerationRunner へ渡す設定オーバーライド */
  readonly runnerConfig?: Partial<GenerationRunnerConfig>;
}

/**
 * Evolution Loop の実行パラメータ
 */
export interface RunEvolutionLoopParams {
  /** 初期母集団スナップショット (g = initialPopulation.generation) */
  readonly initialPopulation: PopulationSnapshot;
  /** ループ全体の基準シード (finite integer, 0 / negative legal) */
  readonly campaignSeed: number;
  /** 全世代共通の不変実行環境コンテキスト */
  readonly environment: GenerationRunnerEnvironmentContext;
  /** 全世代共通の GameSession 生成ファクトリ */
  readonly sessionFactory: BatchSimulationOptions["sessionFactory"];
  /** ループ設定 */
  readonly config: EvolutionLoopConfig;
}

/**
 * 進化ループ全体の論理マニフェスト (完全決定論的)
 */
export interface EvolutionLoopManifest {
  readonly initialGeneration: number;
  readonly requestedTransitions: number;
  readonly targetGeneration: number;
  readonly campaignSeed: number;
  readonly generationSeedScheduleIdentity: string;
}

/**
 * GenerationBuildResult から世代履歴へ投影される軽量メタデータ
 */
export interface EvolutionGenerationBuildMetadata {
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly generationSeed: number;
  readonly selectionSeed: number;
  readonly populationSize: number;
  readonly eliteCount: number;
  readonly offspringCount: number;
  readonly eliteGenomeIds: readonly string[];
  readonly offspringLineages: readonly OffspringLineageMetadata[];
}

/**
 * ADVANCED 成功時の世代履歴レコード
 */
export interface EvolutionGenerationAdvancedRecord {
  readonly status: "ADVANCED";
  readonly stepIndex: number;
  readonly sourceGeneration: number;
  readonly targetGeneration: number;
  readonly generationSeed: number;
  readonly manifest: GenerationEvaluationManifest;
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly buildMetadata: EvolutionGenerationBuildMetadata;
}

/**
 * REEVALUATION_REQUIRED 停止時の世代履歴レコード
 */
export interface EvolutionGenerationReevaluationRecord {
  readonly status: "REEVALUATION_REQUIRED";
  readonly stepIndex: number;
  readonly sourceGeneration: number;
  readonly generationSeed: number;
  readonly manifest: GenerationEvaluationManifest;
  readonly fitnessSnapshot: FitnessEvaluationSnapshot;
  readonly reason: string;
  readonly readiness: SelectionReadiness;
}

/**
 * 世代履歴レコード型
 */
export type EvolutionGenerationRecord =
  | EvolutionGenerationAdvancedRecord
  | EvolutionGenerationReevaluationRecord;

/**
 * 世代遷移が要求数すべて完了した論理結果
 */
export interface EvolutionLoopCompletedResult {
  readonly status: "COMPLETED";
  readonly manifest: EvolutionLoopManifest;
  readonly completedTransitions: number;
  readonly finalPopulation: PopulationSnapshot;
  readonly generations: readonly EvolutionGenerationRecord[];
}

/**
 * 途中で評価不足により停止した論理結果
 */
export interface EvolutionLoopReevaluationRequiredResult {
  readonly status: "REEVALUATION_REQUIRED";
  readonly manifest: EvolutionLoopManifest;
  readonly completedTransitions: number;
  readonly finalPopulation: PopulationSnapshot;
  readonly generations: readonly EvolutionGenerationRecord[];
  readonly reason: string;
  readonly readiness: SelectionReadiness;
}

/**
 * Evolution Loop の決定論的論理結果型 (Deep Equal 保証対象)
 */
export type EvolutionLoopLogicalResult =
  | EvolutionLoopCompletedResult
  | EvolutionLoopReevaluationRequiredResult;

/**
 * 単一世代の実行時メトリクスレコード
 */
export interface EvolutionGenerationRuntimeRecord {
  readonly stepIndex: number;
  readonly sourceGeneration: number;
  readonly generationSeed: number;
  readonly runnerMetrics?: GenerationRunnerRuntimeMetrics;
}

/**
 * ループ全体の実行時メトリクスコンテナ
 */
export interface EvolutionLoopRuntimeMetrics {
  readonly totalExecutionTimeMs: number;
  readonly generations: readonly EvolutionGenerationRuntimeRecord[];
}

/**
 * Evolution Loop 総合実行結果
 */
export interface EvolutionLoopExecutionResult {
  readonly logicalResult: EvolutionLoopLogicalResult;
  readonly runtimeMetrics: EvolutionLoopRuntimeMetrics;
}

/**
 * Evolution Loop 基底エラー型
 */
export class EvolutionLoopError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EvolutionLoopError";
  }
}

/**
 * ループ固有の静的設定不備を表すエラー型
 */
export class EvolutionLoopConfigurationError extends EvolutionLoopError {
  public constructor(message: string) {
    super(message);
    this.name = "EvolutionLoopConfigurationError";
  }
}

/**
 * 世代間チェーン整合性契約違反を表すエラー型
 */
export class EvolutionLoopIntegrityError extends EvolutionLoopError {
  public constructor(message: string) {
    super(message);
    this.name = "EvolutionLoopIntegrityError";
  }
}
