import { DecisionPolicy } from "../../engine/simulation/DecisionPolicy";
import { GameSession } from "../../engine/session/GameSession";

/**
 * Batch Simulation の結果フォーマットバージョン
 */
export const BATCH_SIMULATION_RESULT_VERSION = 1;

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
 * 試合実行中に発生した例外・失敗の記録
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
 * 単一試合のコンパクト実行結果
 * ※ メモリ保護のため、デフォルトでは巨大な GameState, DecisionTrace, MatchLog を保持しません。
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
  readonly durationMs?: number;
}

/**
 * バッチ全体の統計サマリー
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
  readonly totalExecutionTimeMs: number;
}

/**
 * バッチシミュレーション実行設定
 */
export interface BatchSimulationOptions {
  /** 実行する総試合数 (1以上の整数) */
  readonly matchCount: number;
  /** バッチ全体のベースシード (各試合シードはここから純粋関数で導出) */
  readonly baseSeed: number;
  /** 1試合あたりの最大意思決定回数 (デフォルト: 500) */
  readonly maxDecisionsPerMatch?: number;
  /** 各試合の独立した fresh な GameSession を生成するファクトリ関数 */
  readonly sessionFactory: (context: BatchMatchContext) => GameSession;
  /** 各試合の独立した fresh な DecisionPolicy を生成するファクトリ関数 */
  readonly policyFactory: (context: BatchMatchContext) => Record<string, DecisionPolicy>;
  /** 1試合完了ごとの進捗コールバック */
  readonly onMatchCompleted?: (
    result: BatchMatchResult,
    progress: { completedCount: number; totalCount: number }
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
}
