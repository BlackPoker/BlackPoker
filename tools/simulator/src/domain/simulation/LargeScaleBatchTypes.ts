import { PolicyDescriptor } from "../../engine/simulation/DecisionPolicy";
import {
  ExecutionManifest,
  ModelManifestEntry,
  PlayerPolicyManifestEntry,
  GitExecutionMetadata,
} from "../../engine/simulation/ExecutionManifest";

/**
 * 大規模バッチ実行基盤のフォーマットバージョン
 */
export const LARGE_SCALE_BATCH_VERSION = "1.0.0";

/**
 * 単一試合の実行ステータス
 * - COMPLETED: 正常にゲーム終了条件に達して決着
 * - INCOMPLETE: 最大判断回数超過などにより未決着で終了
 * - FAILED: 例外・エラー発生により中断（他の試合への影響は隔離）
 */
export type LargeScaleMatchStatus = "COMPLETED" | "INCOMPLETE" | "FAILED";

/**
 * 各座席（プレイヤーキー）のポリシーおよび DNA メタデータ
 */
export interface LargeScaleSeatInfo {
  readonly playerKey: string;
  readonly policyId: string;
  readonly policyDescriptor: PolicyDescriptor;
  readonly dnaDigest?: string;
}

/**
 * 試合実行中に発生した例外・失敗の記録 (Failure Isolation Record)
 */
export interface LargeScaleFailureRecord {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly phase: "SESSION_SETUP" | "POLICY_SETUP" | "SIMULATION" | "TEARDOWN";
  readonly errorName: string;
  readonly errorMessage: string;
  readonly errorStack?: string;
  readonly occurredAtStep?: number;
  /** 原因調査用の直前意思決定トレーススナップショット (失敗試合のみ保持) */
  readonly decisionTraceSnapshot?: readonly any[];
  /** 失敗時の Canonical Match Log (取得可能な場合) */
  readonly canonicalMatchLog?: any;
}

/**
 * 単一試合の決定論的サマリー結果
 *
 * 【メモリ保護契約】:
 * 全試合の生の GameState や巨大な DecisionTrace 配列は保持せず、
 * 決定論的検証に必要な traceDigest, finalStateHash, メトリクスのみを保持します。
 */
export interface LargeScaleMatchResult {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly status: LargeScaleMatchStatus;
  readonly completed: boolean;
  readonly winner?: string;
  readonly reason?: string;
  readonly totalDecisions: number;
  readonly turnCount: number;
  readonly finalStateHash?: string;
  readonly traceDigest?: string;
  readonly durationMs: number;
  readonly baseSeed: number;
  readonly matchSeed: number;
  readonly playerSeeds: Record<string, number>;
  readonly seats: Record<string, LargeScaleSeatInfo>;
  readonly regulationId: string;
  readonly rulePackageDigest: string;
  readonly failure?: LargeScaleFailureRecord;
}

/**
 * メモリ使用量サンプリング点
 */
export interface MemorySample {
  readonly matchIndex: number;
  readonly rssBytes: number;
  readonly heapTotalBytes: number;
  readonly heapUsedBytes: number;
  readonly externalBytes: number;
}

/**
 * メモリ使用量テレメトリ
 */
export interface MemoryTelemetry {
  readonly baselineRssBytes: number;
  readonly baselineHeapUsedBytes: number;
  readonly peakRssBytes: number;
  readonly peakHeapUsedBytes: number;
  readonly finalRssBytes: number;
  readonly finalHeapUsedBytes: number;
  readonly heapGrowthBytes: number;
  readonly rssGrowthBytes: number;
  readonly samples: readonly MemorySample[];
}

/**
 * CPU 使用量テレメトリ
 */
export interface CpuTelemetry {
  readonly userCpuTimeMs: number;
  readonly systemCpuTimeMs: number;
  readonly totalCpuTimeMs: number;
  readonly cpuUtilizationPercent: number;
}

/**
 * 処理時間（レイテンシ）のパーセンタイル分布
 */
export interface LatencyPercentiles {
  readonly meanMs: number;
  readonly medianMs: number;
  readonly p90Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
}

/**
 * バッチ全体の性能・リソース計測指標
 */
export interface LargeScalePerformanceMetrics {
  readonly totalMatches: number;
  readonly executedMatches: number;
  readonly wallClockElapsedMs: number;
  readonly matchesPerSecond: number;
  readonly latencies: LatencyPercentiles;
  readonly totalDecisions: number;
  readonly meanMsPerDecision: number | null;
  /** 1万試合実行に要する推定所要時間（秒） */
  readonly estimated10kMatchesDurationSec: number;
  /** 1万試合実行に要する推定所要時間（時間） */
  readonly estimated10kMatchesDurationHours: number;
  /** メモリ監視統計 */
  readonly memory: MemoryTelemetry;
  /** CPU 監視統計 */
  readonly cpu: CpuTelemetry;
}

/**
 * バッチ全体の論理統計サマリー
 */
export interface LargeScaleBatchSummary {
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
 * 中断・再開用のチェックポイント状態
 */
export interface BatchCheckpointState {
  readonly checkpointVersion: string;
  readonly batchId: string;
  readonly baseSeed: number;
  readonly experimentFingerprint: string;
  readonly regulationId: string;
  readonly rulePackageDigest: string;
  readonly playerPoliciesDigest: string;
  readonly totalTargetMatches: number;
  readonly maxDecisionsPerMatch: number;
  readonly lastCompletedIndex: number;
  readonly timestamp: string;
  readonly completedMatches: readonly LargeScaleMatchResult[];
  readonly failures: readonly LargeScaleFailureRecord[];
  /** 整合性検証用チェックサム */
  readonly checksum: string;
}

/**
 * 大規模バッチ実行設定
 */
export interface LargeScaleBatchConfig {
  readonly batchId: string;
  readonly workId: string;
  readonly baseSeed: number;
  readonly matchCount: number;
  readonly maxDecisionsPerMatch?: number;
  readonly regulationId: string;
  readonly rulePackageId?: string;
  readonly rulePackageVersion?: string;
  readonly rootDir?: string;
  /** Git HEAD の期待値（指定されている場合、実際の Git HEAD と照合して二重検証） */
  readonly expectedGitCommitSha?: string;
  readonly models?: readonly ModelManifestEntry[];
  readonly playerPolicies?: readonly PlayerPolicyManifestEntry[];
  readonly memorySamplingInterval?: number;
  readonly checkpointInterval?: number;
  readonly checkpointDir?: string;
  readonly onProgress?: (progress: {
    completedMatches: number;
    totalMatches: number;
    currentSpeedMps: number;
    heapUsedMb: number;
  }) => void;
}

/**
 * 大規模バッチ正式 Evidence ペイロード
 */
export interface LargeScaleBatchEvidence {
  readonly schemaVersion: string;
  readonly workId: string;
  readonly generatedAt: string;
  readonly executionManifest: ExecutionManifest;
  readonly configuration: {
    readonly batchId: string;
    readonly workId: string;
    readonly baseSeed: number;
    readonly matchCount: number;
    readonly maxDecisionsPerMatch: number;
    readonly regulationId: string;
  };
  readonly summary: LargeScaleBatchSummary;
  readonly performance: LargeScalePerformanceMetrics;
  readonly matches: readonly LargeScaleMatchResult[];
  readonly isolatedFailures: readonly LargeScaleFailureRecord[];
  readonly reproducibilityRecipe: {
    readonly baseSeed: number;
    readonly sampleIndices: readonly number[];
  };
}
