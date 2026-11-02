/**
 * Evolution Independent Evaluator Types (BP-SIM-AI-V92-WORK3-EVALUATOR-FOUNDATION)
 *
 * Standard＋Pack における Decision DNA の強さを客観的・統計的・決定論的に評価するための型定義。
 *
 * 最重要設計原則:
 * 1. 2大評価軸の分離 (Baseline 絶対的能力水準 vs 過去Champion進化的向上度)
 * 2. 座席反転ペア対戦 (Leg 0: Candidate=P1, Leg 1: Candidate=P2) による先後手バイアスの緩和
 * 3. ペア単位スコアリング (Xi in {0.0, 0.25, 0.5, 0.75, 1.0})
 * 4. 2層ステータス (Evidence Status: VALID/INSUFFICIENT/INVALID, Improvement Status: VERIFIED/UNVERIFIED/REGRESSION)
 * 5. 厳格な統計契約: 両側信頼区間と片側信頼下限の明確な区別、分散ゼロ時の仮説・検定・信頼限界の一致
 * 6. Seed空間の厳格な分離と重複衝突検知 (Train / Val / Holdout, Holdout は Seed Registry 必須)
 * 7. 決定論的論理結果 (logicalResult) と実行時メトリクス (runtimeMetrics) の Sidecar 分離
 */

import { DecisionDNA } from "./DecisionDNATypes";
import { BatchSimulationOptions } from "../simulation/BatchSimulationTypes";
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

/**
 * 評価用 Seed 集合の定義。
 *
 * 保証範囲と限界 (Limitation):
 * - Evaluator 単体での assertNoSeedCollision は、渡された seedRegistry 配列内の非重複（カテゴリ間衝突のないこと）を検証する純粋検査機能です。
 * - Evaluator 単体では、渡された seedRegistry が過去の全世代の学習・検証で消費されたすべての Seed を網羅・真正に含んでいるかまでは保証できません。
 * - 本番 Holdout における完全な未使用性の真正性保証は、Work 3-2 の Campaign Evidence / Manifest（不変学習履歴マニフェスト）との連携によって達成される責務です。
 */
export interface EvaluationSeedSet {
  readonly category: EvaluationSeedCategory;
  readonly seeds: readonly number[];
}

// =============================================================================
// 対戦相手定義 (Baseline 優位性と進化的改善の分離・Champion 真正性保証)
// =============================================================================

/**
 * 対戦相手の役割区分:
 * - "BASELINE": 固定基準ポリシー (例: FirstLegal, SeededRandom 等)。絶対的能力水準の検証に用いる。
 * - "REFERENCE_CHAMPION": 初期世代または過去の Champion ゲノム。進化的改善 (Evolutionary Improvement) の検証に用いる。
 */
export type EvaluationOpponentRole = "BASELINE" | "REFERENCE_CHAMPION";

export interface BaseEvaluationOpponentDefinition {
  readonly opponentId: string;
  readonly name: string;
  /** 設計上の目標ペア勝率 (例: 0.55) */
  readonly targetWinRate: number;
}

/**
 * 固定 Baseline 対戦相手の定義。
 * 任意の DecisionPolicy ファクトリを受け入れ可能。
 */
export interface BaselineOpponentDefinition extends BaseEvaluationOpponentDefinition {
  readonly role?: "BASELINE";
  readonly policyFactory: (
    seat: "p1" | "p2",
    matchSeed: number,
    playerSeeds: { readonly p1: number; readonly p2: number }
  ) => DecisionPolicy;
}

/**
 * 過去 Champion 対戦相手の定義 (真正性保証)。
 *
 * 偽装防止契約:
 * 1. 任意の policyFactory の直接注入を禁止 (never)。
 * 2. 実際の検証済み referenceDNA の提供を必須化。
 * 3. 必要に応じて expectedDnaDigest を照合。
 * 4. 実際の対戦 Policy は referenceDNA から確定的に内部生成 (GenomePolicy) される。
 */
export interface ReferenceChampionOpponentDefinition extends BaseEvaluationOpponentDefinition {
  readonly role: "REFERENCE_CHAMPION";
  /** 参照 Champion の DecisionDNA (スキーマ・有限値検証が必須) */
  readonly referenceDNA: DecisionDNA;
  /** 期待される Full DNA Digest (指定時は完全一致を検証) */
  readonly expectedDnaDigest?: string;
  /** 任意の policyFactory の指定は禁止 (偽装防止) */
  readonly policyFactory?: never;
}

export type EvaluationOpponentDefinition =
  | BaselineOpponentDefinition
  | ReferenceChampionOpponentDefinition;

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
  /**
   * ペアスコア: (leg0スコア + leg1スコア) / 2。値域: {0.0, 0.25, 0.5, 0.75, 1.0}
   * FAILED または INCOMPLETE の無効ペアの場合は null となり、集計から除外される。
   */
  readonly pairScore: number | null;
  readonly status: "COMPLETED" | "INCOMPLETE" | "FAILED";
}

// =============================================================================
// 統計検定結果 (両側信頼区間と片側信頼下限の厳格分離)
// =============================================================================

/**
 * 両側信頼区間 (Two-sided Confidence Interval)
 * 例: 両側 95% 信頼区間 (alpha=0.05, 各側 0.025)
 */
export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly confidenceLevel: number; // 常に両側信頼水準 (例: 0.95)
}

export type StatisticalTestMethod = "STUDENT_T" | "EXACT_BINOMIAL" | "HOEFFDING_BOUND" | "UNDEFINED";

export interface StatisticalTestResult {
  readonly method: StatisticalTestMethod;
  readonly statistic?: number; // e.g. t-statistic
  readonly pValue: number | null; // 片側 p 値 (検定手法と 1:1 一致、定義不能時は null)
  readonly degreesOfFreedom?: number;
  readonly criticalValue?: number; // 片側臨界値 (例: t_{alphaUsed, df})
  readonly alphaUsed: number; // 実際に適用された片側有意水準 (Bonferroni 補正後)
  readonly isStatisticallySignificant: boolean;
  /**
   * 片側 (1 - alphaUsed) 信頼下限 (One-sided lower confidence bound)
   * 改善検定 (H0: mu <= 0.5 vs H1: mu > 0.5) において oneSidedLowerBound > 0.5 <=> pValue < alphaUsed
   */
  readonly oneSidedLowerBound: number;
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
  readonly role: EvaluationOpponentRole;
  /** REFERENCE_CHAMPION の場合の参照 Genome ID (メタデータより取得) */
  readonly championGenomeId?: string;
  /** REFERENCE_CHAMPION の場合の参照 Full DNA Digest */
  readonly championDnaDigest?: string;
  readonly totalPairs: number;
  readonly completedPairs: number;
  readonly incompletePairs: number;
  readonly failedPairs: number;
  readonly pairScores: readonly number[];
  readonly meanPairScore: number;
  readonly sampleVariance: number;
  readonly standardError: number;
  readonly confidenceInterval95: ConfidenceInterval; // 両側 95% 信頼区間
  readonly statisticalTest: StatisticalTestResult; // 片側検定および片側信頼下限
  readonly targetWinRate: number;
  readonly targetMet: boolean;
  readonly evidenceStatus: EvidenceStatus;
  readonly improvementStatus: ImprovementStatus;
}

// =============================================================================
// 総合評価結果 (論理結果と実行時 Sidecar の分離)
// =============================================================================

export interface IndependentEvaluationLogicalResult {
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
  /**
   * 全ての対戦相手に対して目標ペア勝率を達成しているか。
   * EvidenceStatus が VALID でない場合は常に false。
   */
  readonly allTargetsMet: boolean;
  /**
   * 全ての BASELINE 対戦相手に対して目標達成かつ統計的有意差を維持しているか。
   * EvidenceStatus が VALID でない場合は常に false。
   */
  readonly baselineSuperior: boolean;
  /**
   * REFERENCE_CHAMPION が存在し、かつその比較において有意に改善しているか。
   * EvidenceStatus が VALID でない場合、または Candidate と Champion の Digest が同一の場合は常に false。
   */
  readonly championImproved: boolean;
  readonly evidenceStatus: EvidenceStatus;
  readonly improvementStatus: ImprovementStatus;
  readonly summaryText: string;
}

export interface IndependentEvaluationRuntimeMetrics {
  readonly timestamp: string;
  readonly totalExecutionTimeMs: number;
}

export interface IndependentEvaluationResult extends IndependentEvaluationLogicalResult {
  readonly logicalResult: IndependentEvaluationLogicalResult;
  readonly runtimeMetrics: IndependentEvaluationRuntimeMetrics;
  readonly timestamp: string; // 後方互換性フィールド (runtimeMetrics.timestamp と同値)
}

// =============================================================================
// 評価実行設定
// =============================================================================

export interface EvaluationConfig {
  readonly candidateDNA: DecisionDNA;
  readonly seeds: readonly number[];
  readonly seedCategory: EvaluationSeedCategory;
  readonly seedRegistry?: readonly EvaluationSeedSet[];
  readonly opponents: readonly EvaluationOpponentDefinition[];
  readonly sessionFactory: BatchSimulationOptions["sessionFactory"];
  readonly maxDecisionsPerMatch?: number;
  /**
   * 改善検定の片側有意水準 (0 < alpha < 0.5)。
   * 通常利用は 0.05。0.5 以上の値は片側検定の境界として無効であり Fail-Fast で拒絶される。
   */
  readonly significanceLevelAlpha?: number;
  readonly minimumCompletedPairs?: number;
  readonly regulationId?: string;
  readonly rulePackageVersion?: string;
  readonly featureSchemaVersion?: number;
}
