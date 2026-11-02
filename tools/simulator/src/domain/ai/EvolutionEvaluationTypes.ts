/**
 * Evolution Independent Evaluator Types (BP-SIM-AI-V92-WORK3-EVALUATOR-FOUNDATION)
 *
 * Standard＋Pack における Decision DNA の強さを客観的・統計的・決定論的に評価するための型定義。
 *
 * 最重要設計原則:
 * 1. 2大評価軸の分離 (絶対的能力水準 vs 進化的向上度)
 * 2. 座席反転ペア対戦 (Leg 0: Candidate=P1, Leg 1: Candidate=P2)
 * 3. ペア単位スコアリング (Xi in {0.0, 0.25, 0.5, 0.75, 1.0})
 * 4. 2層ステータス (Evidence Status: VALID/INSUFFICIENT/INVALID, Improvement Status: VERIFIED/UNVERIFIED/REGRESSION)
 * 5. 小標本・分散ゼロに対応した厳格な統計検定 (Student t + Exact Binomial Test + Bonferroni 補正)
 * 6. Seed空間の厳格な分離と重複衝突検知 (Train / Val / Holdout)
 */

import { DecisionDNA } from "./DecisionDNATypes";
import { BatchMatchContext, BatchSimulationOptions } from "../simulation/BatchSimulationTypes";
import { DecisionPolicy } from "../../engine/simulation/DecisionPolicy";

export const EVALUATOR_VERSION = 1 as const;
export const DEFAULT_SIGNIFICANCE_ALPHA = 0.05 as const;
export const DEFAULT_MINIMUM_COMPLETED_PAIRS = 5 as const;

// =============================================================================
// エラー型定義
// =============================================================================

export class EvaluationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationConfigurationError";
  }
}

export class EvaluationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationIntegrityError";
  }
}

export class EvaluationSeedCollisionError extends Error {
  readonly collidingSeeds: readonly number[];
  constructor(message: string, collidingSeeds: readonly number[]) {
    super(message);
    this.name = "EvaluationSeedCollisionError";
    this.collidingSeeds = collidingSeeds;
  }
}

// =============================================================================
// Seed 分離定義
// =============================================================================

export type EvaluationSeedCategory = "TRAINING" | "VALIDATION" | "HOLDOUT";

export interface EvaluationSeedSet {
  readonly category: EvaluationSeedCategory;
  readonly seeds: readonly number[];
}

// =============================================================================
// 対戦相手定義
// =============================================================================

export interface EvaluationOpponentDefinition {
  readonly opponentId: string;
  readonly name: string;
  readonly policyFactory: (
    seat: "p1" | "p2",
    matchSeed: number,
    playerSeeds: { readonly p1: number; readonly p2: number }
  ) => DecisionPolicy;
  /** 設計上の初期仮説目標ペア勝率 (例: 0.55) */
  readonly targetWinRate: number;
}

// =============================================================================
// 座席反転ペア対戦結果
// =============================================================================

export interface PairedLegOutcome {
  readonly legIndex: 0 | 1;
  readonly candidateSeat: "p1" | "p2";
  readonly opponentSeat: "p1" | "p2";
  readonly completed: boolean;
  readonly winner?: "p1" | "p2" | "draw";
  readonly candidateWon: boolean;
  readonly candidateDraw: boolean;
  readonly candidateLost: boolean;
  readonly totalDecisions: number;
  readonly turnCount: number;
  readonly reason?: string;
  readonly failed: boolean;
  readonly incomplete: boolean;
  readonly finalStateHash?: string;
}

export interface PairedMatchResult {
  readonly pairIndex: number;
  readonly matchSeed: number;
  readonly opponentId: string;
  readonly candidateGenomeId: string;
  readonly candidateDnaDigest: string;
  readonly leg0: PairedLegOutcome;
  readonly leg1: PairedLegOutcome;
  /** ペアスコア: (leg0スコア + leg1スコア) / 2。値域: {0.0, 0.25, 0.5, 0.75, 1.0} */
  readonly pairScore: number;
  readonly status: "COMPLETED" | "INCOMPLETE" | "FAILED";
}

// =============================================================================
// 統計検定結果
// =============================================================================

export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly confidenceLevel: number; // e.g. 0.95
}

export type StatisticalTestMethod = "STUDENT_T" | "EXACT_BINOMIAL" | "COMBINED" | "UNDEFINED";

export interface StatisticalTestResult {
  readonly method: StatisticalTestMethod;
  readonly statistic?: number; // e.g. t-statistic
  readonly pValue: number; // One-tailed p-value (H1: mean > 0.5 or pairWins > pairLosses)
  readonly degreesOfFreedom?: number;
  readonly isStatisticallySignificant: boolean;
  readonly testNotes?: string;
}

export type EvidenceStatus = "VALID" | "INSUFFICIENT_EVIDENCE" | "INVALID_EVIDENCE";

export type ImprovementStatus =
  | "IMPROVEMENT_VERIFIED"
  | "IMPROVEMENT_UNVERIFIED"
  | "CONFIRMED_REGRESSION";

export interface OpponentEvaluationSummary {
  readonly opponentId: string;
  readonly opponentName: string;
  readonly totalPairs: number;
  readonly completedPairs: number;
  readonly incompletePairs: number;
  readonly failedPairs: number;
  readonly pairScores: readonly number[];
  readonly meanPairScore: number;
  readonly sampleVariance: number;
  readonly standardError: number;
  readonly confidenceInterval95: ConfidenceInterval;
  readonly statisticalTest: StatisticalTestResult;
  readonly targetWinRate: number;
  readonly targetMet: boolean;
  readonly evidenceStatus: EvidenceStatus;
  readonly improvementStatus: ImprovementStatus;
}

// =============================================================================
// 総合評価結果
// =============================================================================

export interface IndependentEvaluationResult {
  readonly evaluatorVersion: number;
  readonly candidateGenomeId: string;
  readonly candidateDnaDigest: string;
  readonly rulePackageVersion: string;
  readonly featureSchemaVersion: number;
  readonly regulationId: string;
  readonly seedCategory: EvaluationSeedCategory;
  readonly significanceLevelAlpha: number;
  readonly bonferroniAdjustedAlpha: number;
  readonly opponents: Record<string, OpponentEvaluationSummary>;
  readonly pairs: readonly PairedMatchResult[];
  readonly totalPairs: number;
  readonly totalMatches: number;
  readonly allTargetsMet: boolean;
  readonly evidenceStatus: EvidenceStatus;
  readonly improvementStatus: ImprovementStatus;
  readonly summaryText: string;
  readonly timestamp: string;
}

// =============================================================================
// 評価実行設定
// =============================================================================

export interface EvaluationConfig {
  readonly candidateDNA: DecisionDNA;
  readonly seeds: readonly number[];
  readonly seedCategory: EvaluationSeedCategory;
  readonly opponents: readonly EvaluationOpponentDefinition[];
  readonly sessionFactory: BatchSimulationOptions["sessionFactory"];
  readonly maxDecisionsPerMatch?: number;
  readonly significanceLevelAlpha?: number;
  readonly minimumCompletedPairs?: number;
  readonly regulationId?: string;
  readonly rulePackageVersion?: string;
  readonly featureSchemaVersion?: number;
}
