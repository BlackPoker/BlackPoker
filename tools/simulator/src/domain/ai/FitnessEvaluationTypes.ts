/**
 * Fitness Evaluation Types (BP-SIM-AI-FITNESS-DESIGN-V1 / BP-SIM-AI-FITNESS-EVAL-V1)
 *
 * BlackPoker Simulator AI基盤における Outcome-First Fitness (適応度) 評価型定義。
 * 設計仕様書: tools/simulator/docs/ai-fitness-design-v1.md
 *
 * 最重要設計原則:
 * "Victory is the objective. Life is a resource, not a score."
 */

/**
 * Fitness 評価ステータス (3値)
 */
export type FitnessEvaluationStatus =
  | "VALID"                  // 評価証拠が十分であり、Authoritative Fitness Score を持つ
  | "INSUFFICIENT_EVIDENCE"  // 完了試合数または完了率が不足。Authoritative Score は持たず保留
  | "INVALID";               // FAILED 試合が存在し失格。Authoritative Score を一切持たない

/**
 * Fitness 評価結果 (Discriminated Union)
 * ai-fitness-design-v1.md Section 6.2 / Section 8 に完全準拠
 */
export type FitnessEvaluationResult =
  | {
      readonly status: "VALID";
      readonly fitnessScore: number; // [0.0, 1.0] 有界の実数値 (Authoritative)
      readonly completedMatches: number; // >= minimumCompletedMatches (> 0)
      readonly completionRate: number; // >= minimumCompletionRate
      readonly scheduledMatches: number;
      readonly wins: number;
      readonly losses: number;
      readonly draws: number;
    }
  | {
      readonly status: "INSUFFICIENT_EVIDENCE";
      readonly fitnessScore: null; // Authoritative スコアなし（通常の次世代選択対象外）
      readonly provisionalScore: number | null; // 参考用 MPA (completedMatches > 0 のみ算出。completedMatches === 0 では null)
      readonly completedMatches: number;
      readonly completionRate: number;
      readonly scheduledMatches: number;
      readonly wins: number;
      readonly losses: number;
      readonly draws: number;
    }
  | {
      readonly status: "INVALID";
      readonly fitnessScore: null; // Authoritative スコアなし（失格・除外）
      readonly failedMatches: number; // > 0
      readonly scheduledMatches: number;
    };

/**
 * Fitness 評価設定パラメータ (Provisional Defaults: 初期仮値 overridable)
 */
export interface FitnessEvaluationConfig {
  /** 最小完了試合数 (有限の正の整数 >= 1) */
  readonly minimumCompletedMatches: number;
  /** 最小完了率 (0 < rate <= 1 の有限実数) */
  readonly minimumCompletionRate: number;
}

/**
 * Fitness 評価の初期仮値 (Provisional Defaults)
 */
export const DEFAULT_FITNESS_EVALUATION_CONFIG: FitnessEvaluationConfig = Object.freeze({
  minimumCompletedMatches: 10,
  minimumCompletionRate: 0.50,
});

/**
 * Fitness 設定値の不備を示すエラー型 (Fail-Fast)
 */
export class FitnessEvaluationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitnessEvaluationConfigurationError";
  }
}

/**
 * Outcome Summary のデータ不整合を示すエラー型 (Fail-Fast)
 */
export class FitnessInputIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitnessInputIntegrityError";
  }
}
