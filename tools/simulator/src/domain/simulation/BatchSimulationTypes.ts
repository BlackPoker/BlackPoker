import { DecisionPolicy } from "../../engine/simulation/DecisionPolicy";
import { GameSession } from "../../engine/session/GameSession";

/**
 * Batch Simulation の結果フォーマットバージョン
 */
export const BATCH_SIMULATION_RESULT_VERSION = 1;

/**
 * Batch Simulation Runtime Telemetry のフォーマットバージョン
 */
export const BATCH_RUNTIME_TELEMETRY_VERSION = 1;

/**
 * バッチシミュレーションの設定不備を示すエラー
 */
export class BatchSimulationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchSimulationConfigurationError";
  }
}

/**
 * 単一試合の実行ステータス
 * - COMPLETED: 正常に決着がついた (winner, reason あり)
 * - INCOMPLETE: 最大判断回数 (maxDecisionsPerMatch) 到達等で決着がつかずに終了
 * - FAILED: セッション初期化、ポリシー初期化、またはシミュレーション実行中に例外が発生
 */
export type BatchMatchStatus = "COMPLETED" | "INCOMPLETE" | "FAILED";

/**
 * 試合ごとの乱数シード・メタデータ文脈情報
 */
export interface BatchMatchContext {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly baseSeed: number;
  readonly matchSeed: number;
  readonly playerSeeds: Record<string, number>;
  readonly metadata?: Record<string, any>;
}

/**
 * 試合事前計画（実行前に決定論的に導出可能なメタデータ）
 */
export interface BatchMatchPlan {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly baseSeed: number;
  readonly matchSeed: number;
  readonly playerSeeds: Record<string, number>;
}

/**
 * 試合実行中に発生した例外・失敗の記録 (Failure Reproduction Recipe)
 */
export interface BatchFailureRecord {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly baseSeed: number;
  readonly matchSeed: number;
  readonly playerSeeds: Record<string, number>;
  readonly errorName: string;
  readonly errorMessage: string;
  readonly errorStack?: string;
  readonly phase: "SESSION_FACTORY" | "POLICY_FACTORY" | "RUNNER" | "UNKNOWN";
}

/**
 * 単一試合の論理実行結果 (Logical Batch Match Result)
 * ※ 決定論的一致保証の対象となる純粋な論理結果。
 * ※ メモリ保護のため、デフォルトでは巨大な GameState, DecisionTrace, MatchLog を保持しません。
 * ※ 実行時間 (matchTotalElapsedMs / durationMs) などの非決定論的実行時メトリクスは分離されています。
 */
export interface BatchMatchResult {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly status: BatchMatchStatus;
  readonly completed: boolean;
  readonly winner?: string;
  readonly reason?: string;
  readonly totalDecisions: number;
  readonly turnCount: number;
  readonly finalStateHash?: string;
  readonly matchSeed: number;
  readonly playerSeeds: Record<string, number>;
  readonly failure?: BatchFailureRecord;
}

/**
 * バッチ全体の論理統計サマリー (Logical Batch Summary)
 * ※ 決定論的一致保証の対象となる純粋な論理統計。
 * ※ 実行時間 (batchWallClockElapsedMs) などの非決定論的実行時メトリクスは分離されています。
 */
export interface BatchSimulationSummary {
  readonly totalMatches: number;
  readonly completedCount: number;
  readonly incompleteCount: number;
  readonly failedCount: number;
  readonly winsByPlayer: Record<string, number>;
  readonly drawCount: number;
  readonly winRates: Record<string, number>;
  readonly averageDecisionsPerCompletedMatch: number;
  readonly averageTurnsPerCompletedMatch: number;
}

/**
 * 試合ごとの非決定論的実行時メトリクス (Match Runtime Latency Metrics)
 */
export interface BatchMatchRuntimeMetrics {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly status: BatchMatchStatus;
  /** 主指標: 1試合の全処理ウォールクロック時間 (ms) */
  readonly matchTotalElapsedMs: number;
  /** 内訳: Session生成・Regulationセットアップ所要時間 (ms) */
  readonly setupElapsedMs: number;
  /** 内訳: SimulationRunner.run() ループ純粋実行時間 (ms, 未到達時は 0) */
  readonly simulationElapsedMs: number;
  /** 1試合中の意思決定回数 */
  readonly totalDecisions: number;
  /**
   * @deprecated 後方互換性のためのエイリアス。matchTotalElapsedMs と同一値を返します。
   */
  readonly durationMs: number;
}

/**
 * バッチ全体の非決定論的実行時メトリクス (Batch Runtime Telemetry & Aggregate Statistics)
 * ※ 実行タイミングによって変動するため、Logical Deterministic Comparison の対象外です。
 */
export interface BatchSimulationRuntimeMetrics {
  /** テレメトリフォーマットバージョン (1) */
  readonly runtimeTelemetryVersion: number;
  /** 実際に実行された試合数 (stopOnError等で中断された場合は matchCount より小さくなります) */
  readonly executedMatchCount: number;
  /** 実行並列度 (現在は 1 固定) */
  readonly concurrency: number;
  /** バッチ全体の実際のウォールクロック経過時間 (ms) */
  readonly batchWallClockElapsedMs: number;
  /** 各試合の matchTotalElapsedMs の単純和 (Aggregate Match Latency, ms) ※ CPU時間ではありません */
  readonly sumMatchTotalElapsedMs: number;
  /** 1試合あたり平均実行時間 (ms) */
  readonly meanMatchTotalElapsedMs: number;
  /** 1試合あたり中央値実行時間 (ms) */
  readonly medianMatchTotalElapsedMs: number;
  /** 1試合あたり95パーセンタイル実行時間 (Nearest-Rank法, ms) */
  readonly p95MatchTotalElapsedMs: number;
  /** 1試合あたり最小実行時間 (ms) */
  readonly minMatchTotalElapsedMs: number;
  /** 1試合あたり最大実行時間 (ms) */
  readonly maxMatchTotalElapsedMs: number;
  /** 実スループット (試合数 / 秒) */
  readonly matchesPerSecond: number;
  /** バッチ全体の総意思決定回数 */
  readonly totalDecisionCount: number;
  /** 意思決定1回あたりの平均所要時間 (ms) */
  readonly meanMsPerDecision: number;
  /** 全試合の個別実行時メトリクス */
  readonly matchMetrics: readonly BatchMatchRuntimeMetrics[];
  /**
   * @deprecated 後方互換性のためのエイリアス。batchWallClockElapsedMs と同一値を返します。
   */
  readonly totalExecutionTimeMs: number;
}

/**
 * バッチシミュレーション実行設定
 */
export interface BatchSimulationOptions {
  /** 実行する総試合数 (1以上の有限整数) */
  readonly matchCount: number;
  /** バッチ全体のベースシード (各試合シードはここから純粋関数で導出) */
  readonly baseSeed: number;
  /** 1試合あたりの最大意思決定回数 (デフォルト: 500, 指定時は1以上の有限整数) */
  readonly maxDecisionsPerMatch?: number;
  /** 各試合の独立した fresh な GameSession を生成するファクトリ関数 */
  readonly sessionFactory: (context: BatchMatchContext) => GameSession;
  /** 各試合の独立した fresh な DecisionPolicy を生成するファクトリ関数 */
  readonly policyFactory: (context: BatchMatchContext) => Record<string, DecisionPolicy>;
  /** 1試合完了ごとの進捗コールバック (第3引数に実行時メトリクスを任意受け取り可能) */
  readonly onMatchCompleted?: (
    result: BatchMatchResult,
    progress: { completedCount: number; totalCount: number },
    metrics?: BatchMatchRuntimeMetrics
  ) => void;
  /** エラー発生時にバッチを即時中断するか (デフォルト: false = Failure Isolation により継続) */
  readonly stopOnError?: boolean;
}

/**
 * バッチシミュレーションの最終結果
 */
export interface BatchSimulationResult {
  readonly batchResultVersion: number;
  readonly baseSeed: number;
  readonly matchCount: number;
  readonly matches: readonly BatchMatchResult[];
  readonly summary: BatchSimulationSummary;
  readonly failures: readonly BatchFailureRecord[];
  /** 非決定論的な実行時メトリクス (診断・性能分析用) */
  readonly runtimeMetrics?: BatchSimulationRuntimeMetrics;
}
