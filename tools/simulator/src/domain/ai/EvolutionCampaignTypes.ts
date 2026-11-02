/**
 * Evolution Campaign Types (BP-SIM-AI-V92-WORK3-CAMPAIGN-ORCHESTRATOR)
 *
 * Standard＋Pack における多世代進化学習（Evolution Campaign）を
 * ステップ駆動で統括・追跡・管理するための型定義。
 *
 * 設計原則:
 * 1. 既存基盤の再利用 (EvolutionLoop, GenerationRunner, EvolutionIndependentEvaluator の統合)
 * 2. 厳格な世代境界 (ステップ駆動: g -> g+1, P_(g+1) は未対戦オフスプリング)
 * 3. 客観的 Champion 選定 (世代内 Fitness 最上位候補を固定 Baseline で Validation 評価し追跡)
 * 4. 2層ステータスと暫定最良の分離 (Validation 暫定最良と Holdout 認定済み Champion の明確な区別)
 * 5. 完全性保証付き Checkpoint / Resume (SHA-256 改ざん検出、アトミック書き込み、二重実行防止)
 * 6. 厳格な Seed Registry 管理 (Training / Validation / Holdout の履歴管理と非重複保証)
 * 7. Early Stopping (未改善と無効 Evidence の明確な区別)
 */

import { DecisionDNA } from "./DecisionDNATypes";
import {
  PopulationSnapshot,
} from "./PopulationSelectionTypes";
import {
  GenerationRunnerConfig,
  GenerationRunnerEnvironmentContext,
} from "./GenerationRunnerTypes";
import {
  EvaluationOpponentDefinition,
  EvaluationSeedSet,
  IndependentEvaluationLogicalResult,
  OpponentEvaluationSummary,
} from "./EvolutionEvaluationTypes";
import { BatchSimulationOptions } from "../simulation/BatchSimulationTypes";

export const CAMPAIGN_VERSION = 1 as const;

// =============================================================================
// エラー型定義
// =============================================================================

export class EvolutionCampaignConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvolutionCampaignConfigurationError";
  }
}

export class EvolutionCampaignIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvolutionCampaignIntegrityError";
  }
}

export class EvolutionCampaignExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvolutionCampaignExecutionError";
  }
}

// =============================================================================
// Champion 追跡・選定情報
// =============================================================================

export interface CampaignChampionInfo {
  /** 選定された世代番号 (0 .. G-1) */
  readonly generation: number;
  /** ゲノム ID */
  readonly genomeId: string;
  /** Decision DNA (完全クローン) */
  readonly dna: DecisionDNA;
  /** Full Semantic SHA-256 Digest */
  readonly dnaDigest: string;
  /** 選定理由・背景の説明テキスト */
  readonly selectionReason: string;
  /** 世代内自己対戦での適応度スコア */
  readonly fitnessScore: number;
  /** Validation 評価における全 Baseline に対する平均ペア勝率 */
  readonly validationMeanWinRate: number;
  /** 各 Baseline 対戦相手に対する詳細評価サマリ */
  readonly validationOpponentSummaries: Record<string, OpponentEvaluationSummary>;
  /**
   * 本番 Holdout 認定済みフラグ (Work 3-2 では常に false)
   * ※ Validation 暫定最良 Champion と、Holdout テスト合格 Champion を厳格に区別
   */
  readonly isHoldoutVerified: boolean;
}

// =============================================================================
// 世代実行記録 (Campaign Generation History)
// =============================================================================

export interface CampaignGenerationRecord {
  /** 世代番号 g */
  readonly generation: number;
  /** 世代基準 Seed */
  readonly generationSeed: number;
  /** 自己対戦ストリームの識別子 */
  readonly trainingSeedScheduleIdentity: string;
  /** 自己対戦の総試合数 (N(N-1) * R) */
  readonly trainingMatchCount: number;
  /** この世代の最上位 Champion 候補の Genome ID */
  readonly candidateGenomeId: string;
  /** Champion 候補の Full DNA Digest */
  readonly candidateDnaDigest: string;
  /** Champion 候補の世代内自己対戦 Fitness スコア */
  readonly candidateFitnessScore: number;
  /** 候補個体に対する独立 Validation 評価の論理結果 */
  readonly validationResult: IndependentEvaluationLogicalResult;
  /** この世代で歴代最良 Champion (provisionalBestChampion) が更新されたか */
  readonly isBestChampionUpdated: boolean;
  /** 実行完了タイムスタンプ */
  readonly timestamp: string;
}

// =============================================================================
// Seed Registry (シード使用履歴管理)
// =============================================================================

export interface CampaignSeedRegistry {
  /** 世代ごとの自己対戦使用済み Seed リスト (世代番号 -> matchSeed 配列) */
  readonly trainingSeedsByGeneration: Record<number, readonly number[]>;
  /** 全世代共通の Validation 用固定 Seed 配列 */
  readonly validationSeeds: readonly number[];
  /** 本番 Holdout 用予定 Seed 配列 (Work 3-2 では未使用・空配列) */
  readonly holdoutSeeds: readonly number[];
  /** 使用済みの全 Seed の一意配列 (重複チェック用) */
  readonly allUsedSeeds: readonly number[];
}

// =============================================================================
// Early Stopping 状態
// =============================================================================

export interface CampaignEarlyStoppingState {
  readonly enabled: boolean;
  /** 改善なしを許容する連続世代数 (patience) */
  readonly patience: number;
  /** 早期終了の判定を開始する最小世代数 */
  readonly minGenerations: number;
  /** 現在の連続未改善世代カウント */
  readonly noImprovementCount: number;
  /** これまでに記録された最良 Validation 平均勝率 */
  readonly bestValidationMeanScore: number;
  /** 早期終了が発動したか */
  readonly triggered: boolean;
}

// =============================================================================
// Checkpoint 状態 (世代間の中断・再開用)
// =============================================================================

export interface CampaignCheckpointState {
  readonly checkpointVersion: number;
  readonly campaignId: string;
  readonly campaignSeed: number;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly featureSchemaVersion: number;
  readonly totalTargetGenerations: number;
  /** 完了した世代数 (0 から始まる) */
  readonly completedGenerations: number;
  /** 次に処理すべき世代番号 (= completedGenerations) */
  readonly nextGenerationToProcess: number;
  /** 次世代母集団 P_(g+1) (未対戦オフスプリング) */
  readonly nextPopulation: PopulationSnapshot;
  /** 歴代暫定最良 Champion */
  readonly provisionalBestChampion: CampaignChampionInfo | null;
  /** 世代履歴レコード一覧 */
  readonly history: readonly CampaignGenerationRecord[];
  /** Seed Registry 履歴 */
  readonly seedRegistry: CampaignSeedRegistry;
  /** Early Stopping 状態 */
  readonly earlyStoppingState: CampaignEarlyStoppingState;
  /** チェックポイント作成タイムスタンプ */
  readonly timestamp: string;
  /** 完全性検証用 SHA-256 チェックサム (checksum プロパティを除く内容のハッシュ) */
  readonly checksum: string;
}

// =============================================================================
// Checkpoint 永続化インターフェース (純粋抽象化: Node fs/path 依存の排除)
// =============================================================================

export interface CampaignCheckpointStorage {
  /** 指定されたパスにテキストデータを原子的 (Atomic) に保存する */
  save(filePath: string, content: string): void;
  /** 指定されたパスからテキストデータを読み込む（存在しない場合は null） */
  load(filePath: string): string | null;
  /** ファイルまたはエントリが存在するか判定する */
  exists(filePath: string): boolean;
}

/**
 * メモリ内でチェックポイントを保持するインメモリストレージ実装
 * （テスト用、またはブラウザ/UI環境向け参照実装）
 */
export class InMemoryCampaignCheckpointStorage implements CampaignCheckpointStorage {
  private readonly store = new Map<string, string>();

  public save(filePath: string, content: string): void {
    this.store.set(filePath, content);
  }

  public load(filePath: string): string | null {
    return this.store.get(filePath) ?? null;
  }

  public exists(filePath: string): boolean {
    return this.store.has(filePath);
  }

  public clear(): void {
    this.store.clear();
  }

  public get entries(): ReadonlyMap<string, string> {
    return this.store;
  }
}

// =============================================================================
// Campaign 実行設定
// =============================================================================

export interface EvolutionCampaignConfig {
  /** キャンペーンの一意識別子 */
  readonly campaignId: string;
  /** 公式レギュレーション ID (default: "standard-pack") */
  readonly regulationId?: string;
  /** フレーム ID (default: "entry16") */
  readonly frameId?: string;
  /** ルールパッケージバージョン (default: "1.0.0") */
  readonly rulePackageVersion?: string;
  /** Feature Schema バージョン (default: 6) */
  readonly featureSchemaVersion?: number;
  /** キャンペーン全体の基準シード */
  readonly campaignSeed: number;
  /** 目標総世代遷移数 G (1 以上) */
  readonly totalGenerations: number;
  /** 初期母集団スナップショット P_0 (generation = 0) */
  readonly initialPopulation: PopulationSnapshot;
  /** Validation 用固定 Baseline 対戦相手群 */
  readonly validationOpponents: readonly EvaluationOpponentDefinition[];
  /** Validation 用全世代共通の固定 Seed 群 */
  readonly validationSeeds: readonly number[];
  /** GameSession 生成ファクトリ */
  readonly sessionFactory: BatchSimulationOptions["sessionFactory"];
  /** GenerationRunner 向け設定オーバーライド (maxDecisionsPerMatch 等) */
  readonly runnerConfig?: Partial<GenerationRunnerConfig>;
  /** Early Stopping 設定 */
  readonly earlyStopping?: {
    readonly patience: number;
    readonly minGenerations?: number;
  };
  /** チェックポイント保存先ディレクトリ (省略時はメモリ内のみ) */
  readonly checkpointDir?: string;
  /** チェックポイント永続化ストレージアダプタ (未指定時は InMemoryStorage を使用) */
  readonly checkpointStorage?: CampaignCheckpointStorage;
  /** チェックポイント保存世代間隔 (default: 1 = 毎世代) */
  readonly checkpointIntervalGenerations?: number;
  /** Validation 有意水準 (default: 0.05, 0 < alpha < 0.5) */
  readonly significanceLevelAlpha?: number;
  /** Validation 最小完了ペア数 (default: 5) */
  readonly minimumCompletedPairs?: number;
  /** 試合あたり最大意思決定数 (default: 500) */
  readonly maxDecisionsPerMatch?: number;
  /** 再開用チェックポイントファイルパス (指定時はロードして再開) */
  readonly resumeFromCheckpointPath?: string;
}

// =============================================================================
// Campaign 総合結果 (論理結果と実行時 Sidecar の分離)
// =============================================================================

export type CampaignStatus =
  | "COMPLETED"
  | "EARLY_STOPPED"
  | "FAILED"
  | "REEVALUATION_REQUIRED";

export interface CampaignLogicalResult {
  readonly campaignVersion: number;
  readonly campaignId: string;
  readonly campaignSeed: number;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly featureSchemaVersion: number;
  readonly totalTargetGenerations: number;
  readonly completedGenerations: number;
  readonly status: CampaignStatus;
  readonly stopReason: string;
  /** 全世代を通じて最良であった暫定 Champion (未対戦 P_(g+1) は除外) */
  readonly provisionalBestChampion: CampaignChampionInfo | null;
  /** 全世代の実行履歴レコード */
  readonly history: readonly CampaignGenerationRecord[];
  /** 最終的に生成された母集団 (未対戦オフスプリング) */
  readonly finalPopulation: PopulationSnapshot;
  /** Campaign 全体で使用された Seed Registry */
  readonly seedRegistry: CampaignSeedRegistry;
  /** 人間可読なサマリーテキスト */
  readonly summaryText: string;
}

export interface CampaignRuntimeMetrics {
  readonly timestamp: string;
  readonly totalExecutionTimeMs: number;
  readonly generationsExecuted: number;
  readonly totalTrainingMatches: number;
  readonly totalValidationMatches: number;
}

export interface CampaignExecutionResult extends CampaignLogicalResult {
  readonly logicalResult: CampaignLogicalResult;
  readonly runtimeMetrics: CampaignRuntimeMetrics;
  readonly timestamp: string;
}
