/**
 * Official Baseline Measurement Contract (Phase 3.3)
 *
 * 【設計原則】
 * 1. 論理ペイロードと実行時メトリクスの完全分離:
 *    durationMs, executionTimeMs, errorStack, wall clock タイムスタンプ等を論理成果物から排除。
 * 2. 決定論的一致性 (Logical Repeatability):
 *    同一設定・同一シードであれば、Run A と Run B で logicalDigest が 100% 一致可能。
 * 3. 汎用診断情報:
 *    Feature Collision, Feature Activation Coverage, Genome Argmax Ties, Counterfactual Agreement を
 *    特定アクション名に依存しない汎用メタデータとして保持。
 */

export const OFFICIAL_BASELINE_MEASUREMENT_VERSION = "1.0.0";

export interface SetupAuditConfig {
  readonly baseSeed: number;
  readonly auditCount: number;
}

export interface SetupNonReadyEntry {
  readonly matchIndex: number;
  readonly matchSeed: number;
  readonly outcomeType: "TERMINAL" | "RULE_UNSPECIFIED";
  readonly reasonCode?: string;
}

export interface SetupAuditSummary {
  readonly plannedSetups: number;
  readonly readySetups: number;
  readonly terminalSetups: number;
  readonly ruleUnspecifiedSetups: number;
  readonly reasonBreakdown: {
    readonly FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED: number;
    readonly GAME_START_DRAW_LIFE_EXHAUSTED: number;
    readonly [reasonCode: string]: number;
  };
  readonly nonReadyEntries: readonly SetupNonReadyEntry[];
}

export interface BaselineMatchupSummary {
  readonly pairId: string;
  readonly participantA: {
    readonly id: string;
    readonly name: string;
  };
  readonly participantB: {
    readonly id: string;
    readonly name: string;
  };
  readonly scheduledMatches: number;
  readonly completedMatches: number;
  readonly incompleteMatches: number;
  readonly setupRuleGapMatches: number;
  readonly technicalFailedMatches: number;
  readonly aWins: number;
  readonly bWins: number;
  readonly draws: number;
  readonly aAsP1: number;
  readonly aAsP2: number;
  readonly bAsP1: number;
  readonly bAsP2: number;
  readonly p1Wins: number;
  readonly p2Wins: number;
  readonly p1WinRate: number;
  readonly p2WinRate: number;
  readonly winRateOnCompleted: number;
}

export interface ParticipantBehaviorMetrics {
  readonly participantId: string;
  readonly totalObservedDecisions: number;
  readonly actionSelections: number;
  readonly passSelections: number;
  readonly effectSelections: number;
  readonly otherSelections: number;
  readonly actionRequestDecisions: number;
  readonly effectResolutionDecisions: number;
  readonly otherSourceDecisions: number;
  readonly actionSelectionRate: number;
  readonly passSelectionRate: number;
  readonly effectSelectionRate: number;
}

export interface FeatureCollisionMetrics {
  readonly participantId: string;
  readonly encodedDecisions: number;
  readonly decisionsWithPatternCollision: number;
  readonly collisionDecisionRate: number;
  readonly totalEncodedPatterns: number;
  readonly collidingPatterns: number;
  readonly collisionGroupCount: number;
  readonly maxCollisionGroupSize: number;
  readonly logicalPatternKeyMissingCount: number;
}

export interface FeatureActivationItem {
  readonly totalFeatures: number;
  readonly activatedFeatures: number;
  readonly coverageRate: number;
  readonly featureCounts: { readonly [featureName: string]: number };
  readonly neverActivatedFeatures: readonly string[];
}

export interface FeatureActivationCoverage {
  readonly context: FeatureActivationItem;
  readonly pattern: FeatureActivationItem;
}

export interface GenomeArgmaxTieMetrics {
  readonly participantId: string;
  readonly scoredDecisions: number;
  readonly decisionsWithArgmaxTie: number;
  readonly argmaxTieRate: number;
  readonly totalTopTiedPatterns: number;
  readonly maxTopTieCount: number;
  readonly argmaxTieWithFeatureCollisionCount?: number;
}

export interface CounterfactualAgreementMetrics {
  readonly participantId: string;
  readonly referenceComparableDecisions: number;
  readonly sameAsFirstLegalCount: number;
  readonly sameAsFirstLegalRate: number;
  readonly sameAsZeroGenomeCount: number;
  readonly sameAsZeroGenomeRate: number;
}

export interface BaselineRepeatabilityMetrics {
  readonly runADigest: string;
  readonly runBDigest: string;
  readonly matched: boolean;
  readonly exactLogicalEquality: boolean;
  readonly diagnosticErrorCount: number;
}

export interface OfficialBaselineMeasurementConfig {
  readonly measurementId: string;
  readonly workId: string;
  readonly environmentRef: string;
  readonly regulationId: string;
  readonly baseSeed: number;
  readonly setupAuditCount: number;
  readonly matchesPerSeat: number;
  readonly maxDecisionsPerMatch: number;
}

/**
 * 論理ペイロード (Logical Artifact)
 * ※ logicalDigest 計算の対象。duration や timestamp などの実行時メタデータは含みません。
 */
export interface OfficialBaselineLogicalPayload {
  readonly measurementResultVersion: string;
  readonly measurementId: string;
  readonly workId: string;
  readonly environmentRef: string;
  readonly regulationId: string;
  readonly rulesVersion: string;
  readonly featureSchemaVersion: string;
  readonly dnaFormatVersion: string;
  readonly baseSeed: number;
  readonly setupAudit: SetupAuditSummary;
  readonly matchups: readonly BaselineMatchupSummary[];
  readonly participantBehavior: readonly ParticipantBehaviorMetrics[];
  readonly featureDiagnostics: {
    readonly featureCollisions: readonly FeatureCollisionMetrics[];
    readonly activationCoverage: FeatureActivationCoverage;
    readonly genomeArgmaxTies: readonly GenomeArgmaxTieMetrics[];
    readonly counterfactualAgreements: readonly CounterfactualAgreementMetrics[];
  };
  readonly notes: readonly string[];
}

/**
 * 最終的な保存アーティファクト
 */
export interface OfficialBaselineMeasurementResult extends OfficialBaselineLogicalPayload {
  readonly logicalDigest: string;
  readonly repeatability: BaselineRepeatabilityMetrics;
}
