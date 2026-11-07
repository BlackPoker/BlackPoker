/**
 * BlackPoker Work 4-1 — Million Match Simulation Infrastructure Types
 *
 * 100万試合 (50万座席反転ペア) 規模の自動対戦を支える O(1) メモリストリーミング、
 * チャンク単位 JSONL 保存、アトミック Checkpoint/Resume、決定論的無衝突 Seed 空間、
 * 異常分類・再現 Evidence、およびルール網羅性 (Coverage) レポートのドメイン型定義。
 */

export const MILLION_MATCH_INFRA_VERSION = "1.0.0" as const;
export const COMPACT_OUTCOME_SCHEMA_VERSION = "1.0.0" as const;
export const CHECKPOINT_SCHEMA_VERSION = "1.0.0" as const;

/**
 * キャンペーンの目的区分
 * - QUALITY_AUDIT: 目的A (ルール・Coreの品質検証、不正状態遷移・膠着・偏り・実体化失敗の検出)
 * - AI_EVOLUTION:  目的B (AI・DNAの進化学習・多相手適応度評価・多様性/収束計測)
 * 目的Aと目的Bは別キャンペーンとして厳格に管理し、試合数や評価結果を混同しない。
 */
export type CampaignPurpose = "QUALITY_AUDIT" | "AI_EVOLUTION";

/**
 * ランナー実行モード
 */
export type LargeScaleExecutionMode =
  | "PLAN_ONLY"
  | "BENCHMARK"
  | "PILOT"
  | "RESUME"
  | "EXECUTE";

/**
 * 段階的検証ステージ区分
 */
export type ScaleVerificationStage =
  | "STAGE_A_1K"
  | "STAGE_B_10K"
  | "STAGE_C_100K_LOCKED"
  | "STAGE_D_1M_LOCKED"
  | "CUSTOM_PILOT";

/**
 * 座席識別子
 */
export type SeatKey = "p1" | "p2";

/**
 * 参加 Policy / DNA の識別情報
 */
export interface ParticipantPolicySpec {
  readonly policyId: string;
  readonly name: string;
  readonly kind: "GENOME" | "FIRST_LEGAL" | "SEEDED_RANDOM" | "CUSTOM";
  readonly genomeId?: string;
  readonly dnaDigest?: string;
  readonly sourcePath?: string;
  readonly role: "CANDIDATE" | "REFERENCE_CHAMPION" | "BASELINE" | "SELF_PLAY" | "MUTANT";
}

/**
 * ペア対戦カード定義 (座席反転ペアの2プレイヤー構成)
 */
export interface MatchupPairingSpec {
  readonly matchupId: string;
  readonly name: string;
  readonly agentA: ParticipantPolicySpec;
  readonly agentB: ParticipantPolicySpec;
  /** ペア割り当て重み (ローテーション比率) */
  readonly weight: number;
}

/**
 * 参加 DNA / Policy の真正性・出所証明エントリ (Work 4-1 R2)
 */
export interface ChampionDnaAuthenticityEntry {
  readonly policyId: string;
  readonly name: string;
  readonly role: ParticipantPolicySpec["role"];
  readonly genomeId: string;
  readonly dnaDigest: string;
  readonly sourceKind: "OFFICIAL_STAGE3_CHECKPOINT" | "SYNTHETIC_TEST_INJECTION" | "DETERMINISTIC_ZERO_BASELINE";
  readonly sourcePath: string;
  readonly checkpointChecksum?: string;
  readonly checkpointFileSha256?: string;
  readonly manifestSha256Verified?: boolean;
}

/**
 * キャンペーン全体で使用された Champion DNA 真正性監査情報 (Work 4-1 R2)
 */
export interface ChampionAuthenticityRecord {
  readonly authenticityMode: "OFFICIAL_CHAMPIONS_VERIFIED" | "SYNTHETIC_TEST_INJECTED";
  readonly fallbackAllowedInCli: false;
  readonly verifiedAt: string;
  readonly entries: readonly ChampionDnaAuthenticityEntry[];
}

/**
 * 通常試合用のコンパクト Outcome レコード (JSONL 1行 = 1試合)
 *
 * 【O(1) メモリ・省容量契約】
 * 生の GameState や全 DecisionTrace は保持せず、決定論的再現と統計分析に必要な最小情報を記録。
 */
export interface CompactMatchOutcomeRecord {
  readonly schemaVersion: typeof COMPACT_OUTCOME_SCHEMA_VERSION;
  readonly matchIndex: number;
  readonly pairIndex: number;
  readonly legIndex: 0 | 1;
  readonly matchId: string;
  readonly matchupId: string;
  readonly matchSeed: number;
  readonly playerSeeds: {
    readonly p1: number;
    readonly p2: number;
  };
  readonly p1PolicyId: string;
  readonly p2PolicyId: string;
  readonly p1DnaDigest?: string;
  readonly p2DnaDigest?: string;
  readonly status: "COMPLETED" | "INCOMPLETE" | "FAILED";
  readonly completed: boolean;
  readonly winner?: "p1" | "p2" | "draw";
  readonly reason: string;
  readonly totalDecisions: number;
  readonly turnCount: number;
  readonly passDecisions: number;
  readonly maxConsecutivePasses: number;
  readonly streamingDecisions: number;
  readonly maxLegalPatterns: number;
  readonly instantiationFailures: number;
  readonly reachedDecisionLimit: boolean;
  readonly finalStateHash: string;
  readonly durationMs?: number;
  readonly anomalyId?: string;
  readonly sampledLogFile?: string;
}

/**
 * JSONL チャンクファイルのマニフェストエントリ
 */
export interface ChunkManifestEntry {
  readonly chunkIndex: number;
  readonly fileName: string;
  readonly relativePath: string;
  readonly startMatchIndex: number;
  readonly endMatchIndex: number;
  readonly matchCount: number;
  readonly byteSize: number;
  readonly sha256: string;
}

/**
 * 異常・要注意試合の分類カテゴリ
 * - STALL_SUSPECTED: 意思決定上限 (500回) 到達や極端な連続PASSによる膠着疑い (直ちにルール不具合とは断定せず分離分析)
 * - INSTANTIATION_FAILURE: ストリーミング合法手の Core 実体化失敗 (重大エラー)
 * - STATE_INVARIANT_VIOLATION: StateVersion/StateHash/Stage/Chance/Request の不整合・破損 (重大エラー)
 * - ILLEGAL_ACTION_OR_EMPTY_LEGAL: 違法手実行または未決着局面での合法手0件欠落 (重大エラー)
 * - UNHANDLED_EXCEPTION: 実行時未捕捉例外 (重大エラー)
 */
export type AnomalyCategory =
  | "STALL_SUSPECTED"
  | "INSTANTIATION_FAILURE"
  | "STATE_INVARIANT_VIOLATION"
  | "ILLEGAL_ACTION_OR_EMPTY_LEGAL"
  | "UNHANDLED_EXCEPTION";

/**
 * 異常試合の決定論的再現・診断 Evidence レコード
 */
export interface AnomalyDiagnosticRecord {
  readonly anomalyId: string;
  readonly campaignId: string;
  readonly workId: string;
  readonly matchIndex: number;
  readonly pairIndex: number;
  readonly legIndex: 0 | 1;
  readonly matchId: string;
  readonly matchSeed: number;
  readonly playerSeeds: {
    readonly p1: number;
    readonly p2: number;
  };
  readonly regulationId: string;
  readonly frameId: string;
  readonly p1Policy: ParticipantPolicySpec;
  readonly p2Policy: ParticipantPolicySpec;
  readonly category: AnomalyCategory;
  readonly isCriticalCoreError: boolean;
  readonly summaryMessage: string;
  readonly errorName?: string;
  readonly errorStack?: string;
  readonly totalDecisionsAtAnomaly: number;
  readonly turnCountAtAnomaly: number;
  readonly lastNormalStateVersion: number;
  readonly lastNormalStateHash: string;
  readonly lastDecisionInfo?: {
    readonly stepCount: number;
    readonly playerId: string;
    readonly selectedPatternRef: number;
    readonly selectedKind: string;
    readonly actionId?: string;
    readonly isStreaming: boolean;
    readonly legalPatternCount: number;
  };
  readonly reproductionRecipe: {
    readonly cliCommand: string;
    readonly matchSeed: number;
    readonly p1Seed: number;
    readonly p2Seed: number;
    readonly p1PolicyId: string;
    readonly p2PolicyId: string;
    readonly regulationId: string;
    readonly maxDecisions: number;
  };
  /** 末尾の意思決定トレース抜粋 */
  readonly decisionTraceTail: readonly any[];
  /** Canonical Match Log (末尾イベントまたは全イベント) */
  readonly canonicalMatchLogSummary: {
    readonly totalEvents: number;
    readonly tailEvents: readonly any[];
  };
}

/**
 * Seed 空間割り当て設定および状態
 */
export interface SeedSpaceSpec {
  readonly allocatorVersion: string;
  readonly purpose: CampaignPurpose;
  readonly campaignSeed: number;
  readonly rangeStart: number;
  readonly rangeSize: number;
  readonly rangeEnd: number;
  readonly affineMultiplier: number;
  readonly affineOffset: number;
  readonly totalPlannedPairs: number;
  readonly totalPlannedMatches: number;
  readonly protectedRangesVerified: boolean;
  readonly zeroCollisionVerified: boolean;
  readonly reservedFutureHoldoutRange: {
    readonly start: number;
    readonly end: number;
  };
}

/**
 * 実行性能テレメトリー (Section 8)
 */
export interface ExecutionPerformanceTelemetry {
  readonly totalPlannedMatches: number;
  readonly executedMatches: number;
  readonly totalElapsedMs: number;
  readonly matchesPerSecond: number;
  readonly decisionsPerSecond: number;
  readonly latencyMs: {
    readonly mean: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly min: number;
    readonly max: number;
  };
  readonly cpu: {
    readonly userCpuTimeMs: number;
    readonly systemCpuTimeMs: number;
    readonly totalCpuTimeMs: number;
    readonly cpuUtilizationPercent: number;
  };
  readonly memory: {
    readonly baselineRssBytes: number;
    readonly baselineHeapUsedBytes: number;
    readonly peakRssBytes: number;
    readonly peakHeapUsedBytes: number;
    readonly finalRssBytes: number;
    readonly finalHeapUsedBytes: number;
    readonly rssGrowthBytes: number;
    readonly heapGrowthBytes: number;
    readonly heapGrowthPer1kMatchesBytes: number;
    readonly gcAvailable: boolean;
    readonly gcInvocationsCount: number;
    readonly memorySamples: readonly {
      readonly matchIndex: number;
      readonly rssBytes: number;
      readonly heapUsedBytes: number;
      readonly heapTotalBytes: number;
    }[];
  };
  readonly storage: {
    readonly totalChunksCount: number;
    readonly totalChunksBytes: number;
    readonly anomalyFilesBytes: number;
    readonly sampleFilesBytes: number;
    readonly totalArtifactsBytes: number;
    readonly bytesPerMatch: number;
    readonly estimated100kMatchesMb: number;
    readonly estimated1MMatchesMb: number;
  };
  readonly checkpointing: {
    readonly checkpointIntervalMatches: number;
    readonly checkpointSavesCount: number;
    readonly totalCheckpointSaveMs: number;
    readonly meanCheckpointSaveMs: number;
    readonly maxCheckpointSaveMs: number;
    readonly resumedCount: number;
    readonly lastResumeElapsedMs: number | "UNMEASURED";
  };
  readonly actionSpaceStreaming: {
    readonly matchesWithStreamingCount: number;
    readonly streamingDecisionsCount: number;
    readonly maxLegalPatternsCount: number;
    readonly totalEvaluatedStreamingPatterns: number;
    readonly streamingEvaluationTotalElapsedMs: number;
  };
  readonly scaleProjections: {
    readonly estimated10kMatchesSec: number;
    readonly estimated100kMatchesHours: number;
    readonly estimated1MMatchesHours: number;
  };
}

/**
 * 対戦カード別の勝敗・ペアスコア統計
 */
export interface MatchupQualityStats {
  readonly matchupId: string;
  readonly name: string;
  readonly agentAPolicyId: string;
  readonly agentBPolicyId: string;
  readonly totalPairs: number;
  readonly completedPairs: number;
  readonly totalMatches: number;
  readonly completedMatches: number;
  readonly agentAWinsAsP1: number;
  readonly agentAWinsAsP2: number;
  readonly agentBWinsAsP1: number;
  readonly agentBWinsAsP2: number;
  readonly draws: number;
  readonly agentAMeanPairScore: number;
  readonly agentAPairScoreVariance: number;
  readonly agentAStandardError: number;
}

/**
 * ゲーム品質テレメトリー (Section 8)
 */
export interface GameQualityTelemetry {
  readonly totalMatches: number;
  readonly completedMatches: number;
  readonly incompleteMatches: number;
  readonly failedMatches: number;
  readonly coreInstantiationFailuresCount: number;
  readonly stateInvariantViolationsCount: number;
  readonly illegalOrEmptyLegalCount: number;
  readonly unhandledExceptionsCount: number;
  readonly suspectedStallMatchesCount: number;
  readonly totalDecisions: number;
  readonly meanDecisionsPerMatch: number;
  readonly maxDecisionsInSingleMatch: number;
  readonly minDecisionsInSingleMatch: number;
  readonly meanTurnsPerMatch: number;
  readonly maxTurnsInSingleMatch: number;
  readonly totalPassDecisions: number;
  readonly passRatio: number;
  readonly maxConsecutivePassesInSingleMatch: number;
  readonly seatWinRates: {
    readonly p1Wins: number;
    readonly p2Wins: number;
    readonly draws: number;
    readonly p1WinRate: number;
    readonly p2WinRate: number;
    readonly drawRate: number;
  };
  readonly reasonDistribution: Record<string, number>;
  readonly matchupStats: Record<string, MatchupQualityStats>;
  readonly anomalyCountsByCategory: Record<AnomalyCategory, number>;
  readonly anomalousMatchIds: readonly string[];
}

/**
 * 進化学習テレメトリーおよび 100万試合拡張設計見積もり (Section 8 & 11)
 */
export interface EvolutionCampaignTelemetry {
  readonly campaignPurpose: CampaignPurpose;
  readonly generationCount: number | "UNMEASURED";
  readonly populationSize: number | "UNMEASURED";
  readonly bestChampionGenomeId: string;
  readonly bestChampionDnaDigest: string;
  readonly meanFitness: number | "UNMEASURED";
  readonly maxFitness: number | "UNMEASURED";
  readonly dnaDiversityL2Mean: number | "UNMEASURED";
  readonly generationImprovementDelta: number | "UNMEASURED";
  readonly baselineWinRateSummary: Record<string, number>;
  readonly referenceChampionWinRate: number | "UNMEASURED";
  readonly trainValidationSeparated: boolean;
  readonly overfittingOrStagnationFlag: string | "UNMEASURED";
  /** 100万試合進化学習の拡張配分計画と計算量見積もり (Section 11) */
  readonly millionMatchEvolutionAllocationPlan: {
    readonly description: string;
    readonly opponentMixRatios: {
      readonly currentChampionSelfPlay: number;
      readonly pastHallOfFameChampions: number;
      readonly diverseMutantArchetypes: number;
      readonly seededRandomExploration: number;
      readonly firstLegalSanity: number;
    };
    readonly plannedGenerationsFor1M: number;
    readonly populationSizeFor1M: number;
    readonly trainingMatchesPerGeneration: number;
    readonly validationMatchesPerGeneration: number;
    readonly totalEvolutionMatches: number;
    readonly separateQualityAuditMatches: number;
    readonly SeparateHoldoutMatches: number;
    readonly estimatedWallClockHoursAtMeasuredSpeed: number;
  };
}

/**
 * ルール・アクション・カード効果の網羅性 (Coverage) レポート (Section 12)
 */
export interface RuleCoverageReport {
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly totalDefinedActionsCount: number;
  readonly offeredActionsCount: number;
  readonly executedActionsCount: number;
  readonly actionCoverageRatio: number;
  readonly offeredActionCounts: Record<string, number>;
  readonly executedActionCounts: Record<string, number>;
  readonly unreachedDefinedActionIds: readonly string[];
  readonly totalDefinedComponentsCount: number;
  readonly observedComponentsCount: number;
  readonly componentCoverageRatio: number;
  readonly observedComponentCounts: Record<string, number>;
  readonly unreachedComponentIds: readonly string[];
  readonly formatLimitationsAndUnimplementedNotes: readonly string[];
}

/**
 * 逐次更新用の内部アキュムレータ状態 (Checkpoint にシリアライズ可能)
 */
export interface StreamingAggregatorState {
  readonly completedMatches: number;
  readonly incompleteMatches: number;
  readonly failedMatches: number;
  readonly coreInstantiationFailuresCount: number;
  readonly stateInvariantViolationsCount: number;
  readonly illegalOrEmptyLegalCount: number;
  readonly unhandledExceptionsCount: number;
  readonly suspectedStallMatchesCount: number;
  readonly totalDecisions: number;
  readonly maxDecisionsInSingleMatch: number;
  readonly minDecisionsInSingleMatch: number;
  readonly totalTurns: number;
  readonly maxTurnsInSingleMatch: number;
  readonly totalPassDecisions: number;
  readonly maxConsecutivePassesInSingleMatch: number;
  readonly matchesWithStreamingCount: number;
  readonly streamingDecisionsCount: number;
  readonly maxLegalPatternsCount: number;
  readonly totalEvaluatedStreamingPatterns: number;
  readonly streamingEvaluationTotalElapsedMs: number;
  readonly p1Wins: number;
  readonly p2Wins: number;
  readonly draws: number;
  readonly reasonDistribution: Record<string, number>;
  readonly anomalyCountsByCategory: Record<AnomalyCategory, number>;
  readonly anomalousMatchIds: string[];
  /** レイテンシ計測用: 総和・最小・最大 + 固定細粒度ヒストグラムバケット (0.1ms刻み〜10,000ms) */
  readonly latencyTotalMs: number;
  readonly latencyMinMs: number;
  readonly latencyMaxMs: number;
  readonly latencyHistogramBuckets: Record<string, number>;
  /** 対戦カード別の逐次集計状態 */
  readonly matchups: Record<
    string,
    {
      readonly matchupId: string;
      readonly name: string;
      readonly agentAPolicyId: string;
      readonly agentBPolicyId: string;
      totalPairs: number;
      completedPairs: number;
      totalMatches: number;
      completedMatches: number;
      agentAWinsAsP1: number;
      agentAWinsAsP2: number;
      agentBWinsAsP1: number;
      agentBWinsAsP2: number;
      draws: number;
      /** Welford 法によるペアスコアの平均・分散計算用 */
      welfordCount: number;
      welfordMean: number;
      welfordM2: number;
    }
  >;
  /** Coverage 追跡用カウンタ */
  readonly offeredActionCounts: Record<string, number>;
  readonly executedActionCounts: Record<string, number>;
  readonly observedComponentCounts: Record<string, number>;
  /** 決定論的結果照合用 Running Rolling Hash (SHA-256 chain) */
  readonly deterministicOutcomeChainHash: string;
}

/**
 * 分割実行セッション履歴エントリ (時間分割・試合数分割実行の追跡用)
 */
export interface ExecutionSessionHistoryEntry {
  readonly sessionIndex: number;
  readonly executionMode: LargeScaleExecutionMode;
  readonly startMatchIndex: number;
  readonly endMatchIndex: number;
  readonly addedMatchesCount: number;
  readonly cumulativeMatchesCount: number;
  readonly sessionElapsedMs: number;
  readonly stopReason: "CAMPAIGN_COMPLETED" | "SESSION_MATCH_LIMIT_REACHED" | "TIME_BUDGET_REACHED" | "TEST_EARLY_STOP";
  readonly sessionMatchLimit?: number;
  readonly timeBudgetMinutes?: number;
  readonly workersCount?: number;
  readonly timestamp: string;
}

/**
 * アトミック Checkpoint 状態 (Section 6)
 */
export interface MillionMatchCheckpointState {
  readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  readonly campaignId: string;
  readonly workId: string;
  readonly purpose: CampaignPurpose;
  readonly stage: ScaleVerificationStage;
  readonly configDigest: string;
  readonly gitCommitSha: string;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly featureSchemaVersion: number;
  readonly maxDecisionsPerMatch: number;
  readonly chunkSizeMatches: number;
  readonly totalPlannedPairs: number;
  readonly totalPlannedMatches: number;
  readonly completedPairsCount: number;
  readonly completedMatchesCount: number;
  readonly nextPairIndex: number;
  readonly nextMatchIndex: number;
  readonly workersCount?: number;
  readonly seedSpace: SeedSpaceSpec;
  readonly matchups: readonly MatchupPairingSpec[];
  readonly championAuthenticity?: ChampionAuthenticityRecord;
  readonly completedChunks: readonly ChunkManifestEntry[];
  readonly aggregatorState: StreamingAggregatorState;
  readonly accumulatedElapsedMs: number;
  readonly accumulatedUserCpuMs: number;
  readonly accumulatedSystemCpuMs: number;
  readonly checkpointSavesCount: number;
  readonly totalCheckpointSaveMs: number;
  readonly maxCheckpointSaveMs: number;
  readonly resumedCount: number;
  readonly lastResumeElapsedMs: number | "UNMEASURED";
  readonly sessionHistory?: readonly ExecutionSessionHistoryEntry[];
  readonly memorySamples: readonly {
    readonly matchIndex: number;
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
    readonly heapTotalBytes: number;
  }[];
  readonly baselineRssBytes: number;
  readonly baselineHeapUsedBytes: number;
  readonly peakRssBytes: number;
  readonly peakHeapUsedBytes: number;
  readonly gcInvocationsCount: number;
  readonly timestamp: string;
  /** Checkpoint 自体の完全性検証用 SHA-256 チェックサム */
  readonly checksum: string;
}

/**
 * キャンペーン最終サマリー & Evidence レコード
 */
export interface MillionMatchCampaignEvidence {
  readonly infraVersion: typeof MILLION_MATCH_INFRA_VERSION;
  readonly workId: string;
  readonly campaignId: string;
  readonly purpose: CampaignPurpose;
  readonly stage: ScaleVerificationStage;
  readonly executionMode: LargeScaleExecutionMode;
  readonly gitCommitSha: string;
  readonly isGitClean: boolean;
  readonly configDigest: string;
  readonly timestamp: string;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly featureSchemaVersion: number;
  readonly maxDecisionsPerMatch: number;
  readonly maxConcurrency: number;
  readonly workersCount?: number;
  /** 実行タイミングに依存しない純粋な論理結果の SHA-256 Digest (中断Resumeと無中断実行の一致証明用) */
  readonly logicalResultDigest: string;
  readonly campaignStatus:
    | "COMPLETED_CLEAN"
    | "PARTIAL_SESSION_PAUSED"
    | "COMPLETED_WITH_STALL_SUSPICIONS"
    | "FAILED_CRITICAL_ANOMALY";
  readonly sessionHistory?: readonly ExecutionSessionHistoryEntry[];
  readonly championAuthenticity?: ChampionAuthenticityRecord;
  readonly seedSpace: SeedSpaceSpec;
  readonly matchups: readonly MatchupPairingSpec[];
  readonly chunksManifest: readonly ChunkManifestEntry[];
  readonly performance: ExecutionPerformanceTelemetry;
  readonly gameQuality: GameQualityTelemetry;
  readonly evolution: EvolutionCampaignTelemetry;
  readonly ruleCoverage: RuleCoverageReport;
  readonly hardwareRecommendationsFor1M: {
    readonly recommendedCpuCores: string;
    readonly recommendedRamGb: string;
    readonly recommendedDiskSpaceGb: string;
    readonly rationale: string;
  };
}
