import {
  PolicyExperimentParticipantRef,
  PolicyParticipantOutcomeSummary,
  PolicyExperimentSummary,
} from "./PolicyExperimentTypes";
import { BatchMatchContext } from "../simulation/BatchSimulationTypes";

/**
 * Genome Sensitivity Result のフォーマットバージョン
 */
export const GENOME_SENSITIVITY_RESULT_VERSION = 1;

/**
 * Decision-level での合法手の比較スコアレコード
 */
export interface ScoredPatternComparison {
  readonly patternRef: number;
  readonly kind: string;
  readonly logicalPatternKey?: string;
  readonly scoreA: number;
  readonly scoreB: number;
  readonly scoreDelta: number;
}

/**
 * Decision-level での観測サマリ (ランタイムGUID等の可変要素を含まない)
 */
export interface DecisionRequestSummary {
  readonly viewerPlayerId: string;
  readonly turnPlayerId: string;
  readonly chancePlayerId: string;
  readonly sourceType: string;
  readonly turnCount: number;
  readonly legalPatternCount: number;
}

/**
 * 同一 DecisionRequest に対する 2 つの DNA の意思決定比較結果
 */
export interface DecisionSensitivityComparison {
  readonly requestSummary: DecisionRequestSummary;
  readonly dnaA: PolicyExperimentParticipantRef;
  readonly dnaB: PolicyExperimentParticipantRef;
  readonly patterns: readonly ScoredPatternComparison[];
  readonly selectedPatternRefA: number;
  readonly selectedPatternRefB: number;
  readonly selectedLogicalPatternKeyA?: string;
  readonly selectedLogicalPatternKeyB?: string;
  readonly selectionSeparated: boolean;
  readonly differingScoreCount: number;
  readonly maxAbsoluteScoreDelta: number;
  readonly meanAbsoluteScoreDelta: number;
}

/**
 * Participant ごとの Generic 行動メトリクス
 */
export interface GenericBehaviorMetrics {
  readonly totalObservedDecisions: number;
  readonly actionSelections: number;
  readonly passSelections: number;
  readonly effectSelections: number;
  readonly otherSelections: number;
  readonly actionSelectionRate: number;
  readonly passSelectionRate: number;
  readonly effectSelectionRate: number;
  readonly otherSelectionRate: number;
}

/**
 * Match-level での Generic 行動分離サマリ
 */
export interface MatchBehaviorSeparationSummary {
  readonly participantAId: string;
  readonly participantBId: string;
  readonly metricsA: GenericBehaviorMetrics;
  readonly metricsB: GenericBehaviorMetrics;
  readonly actionRateDelta: number;
  readonly passRateDelta: number;
  readonly effectSelectionRateDelta: number;
  readonly otherRateDelta: number;
  readonly behaviorSeparated: boolean;
}

/**
 * 総合判定ステータス
 */
export type GenomeSensitivityStatus =
  | "POLICY_SEPARABLE"
  | "NOT_SEPARABLE"
  | "INSUFFICIENT_EVIDENCE";

/**
 * 決定論的 Logical Result (実行時間等の非決定論的情報を除外)
 */
export interface GenomeSensitivityLogicalResult {
  readonly version: number;
  readonly featureSchemaVersion: number;
  readonly dnaFormatVersion: number;
  readonly scoringModel: string;
  readonly environmentRef: string;
  readonly baseSeed: number;
  readonly matchesPerSeat: number;
  readonly dnaA: PolicyExperimentParticipantRef;
  readonly dnaB: PolicyExperimentParticipantRef;
  readonly decisionComparison?: DecisionSensitivityComparison;
  readonly experimentSummary: PolicyExperimentSummary;
  readonly outcomeA: PolicyParticipantOutcomeSummary;
  readonly outcomeB: PolicyParticipantOutcomeSummary;
  readonly matchBehaviorSummary: MatchBehaviorSeparationSummary;
  readonly decisionSeparated: boolean;
  readonly matchBehaviorSeparated: boolean;
  readonly deterministic: boolean;
  readonly overallStatus: GenomeSensitivityStatus;
}

/**
 * Genome Sensitivity / Policy Separability 評価オプション
 */
export interface GenomeSensitivityEvaluationOptions {
  readonly experimentId: string;
  readonly environmentRef: string;
  readonly baseSeed: number;
  readonly matchesPerSeat: number;
  readonly maxDecisionsPerMatch?: number;
  readonly dnaA: Readonly<import("./DecisionDNATypes").DecisionDNA>;
  readonly dnaB: Readonly<import("./DecisionDNATypes").DecisionDNA>;
  readonly participantAName?: string;
  readonly participantBName?: string;
  readonly sessionFactory: (context: BatchMatchContext) => import("../../engine/session/GameSession").GameSession;
  readonly sampleRequest?: Readonly<import("../decision/DecisionRequest").DecisionRequest>;
}

/**
 * 実行時メトリクス
 */
export interface GenomeSensitivityRuntimeMetrics {
  readonly executionDurationMs: number;
}

/**
 * Genome Sensitivity / Policy Separability 評価の全体結果
 */
export interface GenomeSensitivityResult {
  readonly logicalResult: GenomeSensitivityLogicalResult;
  readonly runtimeMetrics: GenomeSensitivityRuntimeMetrics;
}

