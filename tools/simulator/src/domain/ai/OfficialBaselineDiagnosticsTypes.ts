/**
 * BlackPoker Official Baseline Diagnostics Contract v1
 * 
 * AI Self-Play Phase 3.4: Incomplete Root Cause & Policy Distinguishability Diagnostics
 * 
 * 【契約原則】
 * 1. 論理結果と実行時メタデータの厳格な分離:
 *    logical payload には wall clock, duration, absolute path, stack trace を一切含めない。
 * 2. 決定論的再現性の保証:
 *    同一 config での Run A と Run B の論理ペイロードは 1bit も違わず完全一致する。
 * 3. 汎用 Core Flow 指標:
 *    特定 Action 名（action.attack 等）に依存せず、State Hash, Pattern Kind, Stage Depth, Turn Progress 等の抽象指標で計測する。
 */

export const OFFICIAL_BASELINE_DIAGNOSTICS_VERSION = "1.0.0";

/**
 * 再現レシピ（各未完走対戦を単一で決定論的に再実行するための最小情報）
 */
export interface IncompleteReproductionRecipe {
  readonly regulationId: string;
  readonly baseSeed: number;
  readonly pairId: string;
  readonly legId: string;
  readonly matchIndex: number;
  readonly matchSeed: number;
  readonly p1ParticipantId: string;
  readonly p2ParticipantId: string;
  readonly maxDecisions: number;
}

/**
 * 段階的実行バジェット結果
 */
export interface StepBudgetOutcome {
  readonly maxDecisions: number;
  readonly finalDecisionCount: number;
  readonly finalTurnCount: number;
  readonly finalStateHash: string;
  readonly completed: boolean;
  readonly outcomeCategory: "FINISHED_BY_1000" | "STILL_INCOMPLETE_1000" | "FINISHED_BY_2000" | "STILL_INCOMPLETE_2000";
  readonly winner?: string;
  readonly reason?: string;
}

/**
 * 論理状態再訪メトリクス
 */
export interface StateRecurrenceMetrics {
  readonly observedDecisionCount: number;
  readonly uniqueStateHashCount: number;
  readonly repeatedStateVisitCount: number;
  readonly firstRepeatedStateDecision: number | null;
  readonly maxVisitsPerStateHash: number;
  readonly shortestObservedRepeatDistance: number | null;
}

/**
 * ターン進行度メトリクス
 */
export interface TurnProgressMetrics {
  readonly initialTurnCount: number;
  readonly finalTurnCount: number;
  readonly turnsAdvanced: number;
  readonly decisionsPerTurn: number;
}

/**
 * ステージ深度診断メトリクス
 */
export interface StageDiagnosticsMetrics {
  readonly maxStageDepth: number;
  readonly finalStageDepth: number;
}

/**
 * Stage空状態PASS診断メトリクス
 * （stageDepth === 0 && decisionPlayer === turnPlayer && chancePlayer === turnPlayer && selectedPatternKind === "PASS"）
 */
export interface StageEmptyPassMetrics {
  readonly stageEmptyPassCount: number;
  readonly maxConsecutiveStageEmptyPass: number;
  readonly hasStateRecurrence: boolean;
  readonly isDeterministicCycleCandidate: boolean;
}

/**
 * 決定的ポリシー周期検出診断
 */
export interface DeterministicCycleDiagnostics {
  readonly isDeterministicCycleCandidate: boolean;
  readonly cyclePeriod?: number;
  readonly firstCycleStep?: number;
}

/**
 * コンパクト軌跡情報（巨大な raw trace を保管せず周期性検証に必要な要約のみを保持）
 */
export interface CompactTrajectorySummary {
  readonly firstRepeatIndex: number | null;
  readonly repeatCount: number;
  readonly cyclePeriod?: number;
  readonly sampleStateHashes: readonly string[];
}

/**
 * 未完走ケース診断レコード
 */
export interface IncompleteCaseRecord {
  readonly caseId: string;
  readonly pairId: string;
  readonly legId: string;
  readonly participantP1: { readonly id: string; readonly name: string };
  readonly participantP2: { readonly id: string; readonly name: string };
  readonly matchIndex: number;
  readonly matchSeed: number;
  readonly reproductionRecipe: IncompleteReproductionRecipe;
  readonly primary500: {
    readonly maxDecisions: 500;
    readonly finalDecisionCount: number;
    readonly finalTurnCount: number;
    readonly finalStateHash: string;
    readonly completed: false;
  };
  readonly secondary1000: StepBudgetOutcome;
  readonly tertiary2000?: StepBudgetOutcome;
  readonly finalClassification:
    | "FINISHED_BY_1000"
    | "FINISHED_BY_2000"
    | "STILL_INCOMPLETE_WITH_STATE_RECURRENCE"
    | "STILL_INCOMPLETE_WITHOUT_EXACT_STATE_RECURRENCE";
  readonly stateRecurrence: StateRecurrenceMetrics;
  readonly turnProgress: TurnProgressMetrics;
  readonly stageDiagnostics: StageDiagnosticsMetrics;
  readonly stageEmptyPassDiagnostics: StageEmptyPassMetrics;
  readonly cycleDiagnostics?: DeterministicCycleDiagnostics;
  readonly compactTrajectory: CompactTrajectorySummary;
}

/**
 * スコマージン要約統計
 */
export interface ScoreMarginSummary {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
  readonly p90: number;
}

/**
 * ポリシー識別性診断メトリクス
 */
export interface PolicyDistinguishabilityMetrics {
  readonly comparableRequests: number;
  readonly requestsWithOneLogicalChoice: number;
  readonly requestsWithMultipleLogicalChoices: number;
  readonly choiceDiversity: {
    readonly firstLegalVsZeroDifferent: number;
    readonly firstLegalVsManualDifferent: number;
    readonly zeroVsManualDifferent: number;
    readonly firstLegalVsZeroAgreementRate: number;
    readonly firstLegalVsManualAgreementRate: number;
    readonly zeroVsManualAgreementRate: number;
  };
  readonly zeroGenome: {
    readonly scoredRequests: number;
    readonly allLegalScoresEqualRequests: number;
    readonly argmaxTieRequests: number;
    readonly uniqueTopRequests: number;
    readonly selectedPatternRefDistribution: Record<string, number>;
  };
  readonly manualGenericGenome: {
    readonly scoredRequests: number;
    readonly singleChoiceRequests: number;
    readonly uniqueArgmaxRequests: number;
    readonly argmaxTieRequests: number;
    readonly zeroMarginRequests: number;
    readonly positiveMarginRequests: number;
    readonly manualDifferentFromFirstLegal: number;
    readonly manualDifferentFromZero: number;
    readonly marginSummary: ScoreMarginSummary;
  };
  readonly featureRelationship: {
    readonly argmaxTieWithCollisionCooccurrenceCount: number;
    readonly cooccurrenceRateOnTies: number;
  };
  readonly patternOrdering: {
    readonly samePatternRefCount: number;
    readonly sameLogicalPatternKeyCount: number;
  };
}

/**
 * 診断設定
 */
export interface OfficialBaselineDiagnosticsConfig {
  readonly diagnosticsVersion: string;
  readonly workId: string;
  readonly sourceBaselineDigest: string;
  readonly regulationId: string;
  readonly baseSeed: number;
  readonly primaryMaxDecisions: number;
  readonly secondaryMaxDecisions: number;
  readonly tertiaryMaxDecisions: number;
  readonly matchesPerSeat: number;
}

/**
 * 決定論的ダイジェスト計算対象となる論理ペイロード
 */
export interface OfficialBaselineDiagnosticsLogicalPayload {
  readonly diagnosticsVersion: string;
  readonly workId: string;
  readonly sourceBaselineDigest: string;
  readonly regulationId: string;
  readonly baseSeed: number;
  readonly primaryMaxDecisions: number;
  readonly secondaryMaxDecisions: number;
  readonly tertiaryMaxDecisions: number;
  readonly totalPrimaryMatches: number;
  readonly totalIncompleteCases: number;
  readonly matchedPhase33BaselineIncompleteCount: boolean;
  readonly incompleteOutcomeCounts: {
    readonly finishedBy1000: number;
    readonly finishedBy2000: number;
    readonly stillIncompleteWithRecurrence: number;
    readonly stillIncompleteWithoutRecurrence: number;
    readonly deterministicCycleCandidates: number;
  };
  readonly incompleteCases: readonly IncompleteCaseRecord[];
  readonly policyDistinguishability: PolicyDistinguishabilityMetrics;
  readonly stateRecurrenceSummary: {
    readonly casesWithRecurrence: number;
    readonly casesWithoutRecurrence: number;
    readonly maxVisitsObserved: number;
    readonly minRepeatDistanceObserved: number | null;
  };
  readonly stageEmptyPassSummary: {
    readonly totalCasesWithStageEmptyPass: number;
    readonly maxConsecutiveObserved: number;
    readonly cooccurrenceWithRecurrenceCases: number;
    readonly cooccurrenceWithCycleCandidates: number;
  };
  readonly conclusions: readonly string[];
  readonly notes: readonly string[];
}

/**
 * 診断全体の最終結果
 */
export interface OfficialBaselineDiagnosticsResult extends OfficialBaselineDiagnosticsLogicalPayload {
  readonly logicalDigest: string;
  readonly repeatability: {
    readonly runADigest: string;
    readonly runBDigest: string;
    readonly matched: boolean;
    readonly exactLogicalEquality: boolean;
    readonly diagnosticErrorCount: number;
  };
}
