/**
 * Fitness Evaluator (BP-SIM-AI-FITNESS-DESIGN-V1 / BP-SIM-AI-FITNESS-EVAL-V1)
 *
 * BlackPoker Simulator AI基盤における Outcome-First Fitness 評価器。
 *
 * 最重要設計原則:
 * "Victory is the objective. Life is a resource, not a score."
 *
 * 入力:
 *   PolicyParticipantOutcomeSummary (Canonical 勝敗カウントのみ)
 *   または PolicyExperimentResult.summary.participants
 *
 * 出力:
 *   FitnessEvaluationResult (VALID | INSUFFICIENT_EVIDENCE | INVALID)
 *
 * 厳格な隔離原則:
 *   GameState, Player Life, Turn Count, Damage, Telemetry, Behavior Summary へは
 *   一切依存せず、勝敗の Outcome のみから決定論的に適応度を評価する。
 */

import {
  PolicyParticipantOutcomeSummary,
  PolicyExperimentResult,
} from "../../domain/ai/PolicyExperimentTypes";
import {
  FitnessEvaluationConfig,
  FitnessEvaluationResult,
  FitnessEvaluationConfigurationError,
  FitnessInputIntegrityError,
  DEFAULT_FITNESS_EVALUATION_CONFIG,
} from "../../domain/ai/FitnessEvaluationTypes";

export class FitnessEvaluator {
  /**
   * 評価設定の検証とデフォルト値の解決 (Fail-Fast)
   */
  public static validateConfig(
    config?: Partial<FitnessEvaluationConfig>
  ): FitnessEvaluationConfig {
    const minimumCompletedMatches =
      config?.minimumCompletedMatches !== undefined
        ? config.minimumCompletedMatches
        : DEFAULT_FITNESS_EVALUATION_CONFIG.minimumCompletedMatches;

    const minimumCompletionRate =
      config?.minimumCompletionRate !== undefined
        ? config.minimumCompletionRate
        : DEFAULT_FITNESS_EVALUATION_CONFIG.minimumCompletionRate;

    if (
      typeof minimumCompletedMatches !== "number" ||
      !Number.isFinite(minimumCompletedMatches) ||
      !Number.isInteger(minimumCompletedMatches) ||
      minimumCompletedMatches < 1
    ) {
      throw new FitnessEvaluationConfigurationError(
        `Invalid minimumCompletedMatches: must be a finite integer >= 1, got ${minimumCompletedMatches}`
      );
    }

    if (
      typeof minimumCompletionRate !== "number" ||
      !Number.isFinite(minimumCompletionRate) ||
      minimumCompletionRate <= 0 ||
      minimumCompletionRate > 1
    ) {
      throw new FitnessEvaluationConfigurationError(
        `Invalid minimumCompletionRate: must be a finite number > 0 and <= 1, got ${minimumCompletionRate}`
      );
    }

    return Object.freeze({
      minimumCompletedMatches,
      minimumCompletionRate,
    });
  }

  /**
   * 入力データの整合性検証 (Fail-Fast)
   *
   * 不整合データを暗黙に補正せず、Input / Contract Error として例外を送出する。
   */
  public static validateIntegrity(summary: PolicyParticipantOutcomeSummary): void {
    if (!summary || typeof summary !== "object") {
      throw new FitnessInputIntegrityError(
        "Outcome summary must be a valid non-null object"
      );
    }

    const {
      scheduledMatches,
      completedMatches,
      wins,
      losses,
      draws,
      incompleteMatches,
      failedMatches,
    } = summary;

    const counts = [
      { name: "scheduledMatches", val: scheduledMatches },
      { name: "completedMatches", val: completedMatches },
      { name: "wins", val: wins },
      { name: "losses", val: losses },
      { name: "draws", val: draws },
      { name: "incompleteMatches", val: incompleteMatches },
      { name: "failedMatches", val: failedMatches },
    ];

    for (const { name, val } of counts) {
      if (
        typeof val !== "number" ||
        !Number.isFinite(val) ||
        !Number.isInteger(val) ||
        val < 0
      ) {
        throw new FitnessInputIntegrityError(
          `Invalid count for ${name}: expected non-negative finite integer, got ${val}`
        );
      }
    }

    if (scheduledMatches < 1) {
      throw new FitnessInputIntegrityError(
        `scheduledMatches must be >= 1, got ${scheduledMatches}`
      );
    }

    if (wins + losses + draws !== completedMatches) {
      throw new FitnessInputIntegrityError(
        `Outcome conservation violated: wins (${wins}) + losses (${losses}) + draws (${draws}) !== completedMatches (${completedMatches})`
      );
    }

    if (completedMatches + incompleteMatches + failedMatches !== scheduledMatches) {
      throw new FitnessInputIntegrityError(
        `Scheduled match conservation violated: completed (${completedMatches}) + incomplete (${incompleteMatches}) + failed (${failedMatches}) !== scheduledMatches (${scheduledMatches})`
      );
    }
  }

  /**
   * 単一 Participant の Outcome Summary から Fitness を決定論的に評価
   *
   * @param summary ParticipantOutcomeSummary (winRateOnCompleted は無視し canonical counts のみ使用)
   * @param config 評価設定 (省略時は初期仮値 DEFAULT_FITNESS_EVALUATION_CONFIG を適用)
   */
  public static evaluateParticipant(
    summary: PolicyParticipantOutcomeSummary,
    config?: Partial<FitnessEvaluationConfig>
  ): FitnessEvaluationResult {
    const resolvedConfig = FitnessEvaluator.validateConfig(config);
    FitnessEvaluator.validateIntegrity(summary);

    const {
      scheduledMatches,
      completedMatches,
      wins,
      losses,
      draws,
      failedMatches,
    } = summary;

    // Phase 1: Fail-Closed Gate
    // FAILED 試合が 1 件でも存在する場合、即座に失格・除外 (Tier 3)
    if (failedMatches > 0) {
      return {
        status: "INVALID",
        fitnessScore: null,
        scheduledMatches,
        failedMatches,
      };
    }

    // Phase 2: Evidence Sufficiency Gate
    const completionRate = completedMatches / scheduledMatches;

    if (
      completedMatches < resolvedConfig.minimumCompletedMatches ||
      completionRate < resolvedConfig.minimumCompletionRate
    ) {
      // 0 試合完了の場合は全敗 (0.0) ではなく厳格に null (データ不在)
      const provisionalScore =
        completedMatches > 0
          ? (wins * 1.0 + draws * 0.5) / completedMatches
          : null;

      return {
        status: "INSUFFICIENT_EVIDENCE",
        fitnessScore: null,
        provisionalScore,
        scheduledMatches,
        completedMatches,
        completionRate,
        wins,
        losses,
        draws,
      };
    }

    // Phase 3: VALID Authoritative Score Calculation (Tier 1)
    const fitnessScore = (wins * 1.0 + draws * 0.5) / completedMatches;

    return {
      status: "VALID",
      fitnessScore,
      scheduledMatches,
      completedMatches,
      completionRate,
      wins,
      losses,
      draws,
    };
  }

  /**
   * PolicyExperimentResult 全体の participants を評価
   *
   * @param experimentResult 実験結果 (summary.participants のみを使用)
   * @param config 評価設定
   */
  public static evaluateExperiment(
    experimentResult: PolicyExperimentResult,
    config?: Partial<FitnessEvaluationConfig>
  ): Record<string, FitnessEvaluationResult> {
    if (
      !experimentResult ||
      typeof experimentResult !== "object" ||
      !experimentResult.summary ||
      typeof experimentResult.summary !== "object" ||
      !experimentResult.summary.participants ||
      typeof experimentResult.summary.participants !== "object"
    ) {
      throw new FitnessInputIntegrityError(
        "Invalid experimentResult: missing summary.participants"
      );
    }

    const results: Record<string, FitnessEvaluationResult> = {};
    for (const [participantId, summary] of Object.entries(
      experimentResult.summary.participants
    )) {
      results[participantId] = FitnessEvaluator.evaluateParticipant(
        summary,
        config
      );
    }

    return results;
  }
}
