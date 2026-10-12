import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { FitnessEvaluator } from "../../engine/ai/FitnessEvaluator";
import {
  DEFAULT_FITNESS_EVALUATION_CONFIG,
  FitnessEvaluationConfigurationError,
  FitnessInputIntegrityError,
} from "../../domain/ai/FitnessEvaluationTypes";
import {
  PolicyParticipantOutcomeSummary,
  PolicyParticipantSeatSummary,
  PolicyExperimentResult,
} from "../../domain/ai/PolicyExperimentTypes";
import { PolicyExperimentRunner } from "../../engine/ai/PolicyExperimentRunner";
import { BaselineParticipants } from "../../engine/ai/BaselinePolicies";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Outcome-First Fitness Evaluator V1 (BP-SIM-AI-FITNESS-EVAL-V1)", () => {
  const dummySeatSummary: PolicyParticipantSeatSummary = {
    scheduledMatches: 50,
    completedMatches: 50,
    wins: 25,
    losses: 25,
    draws: 0,
    incompleteMatches: 0,
    failedMatches: 0,
    winRateOnCompleted: 0.5,
  };

  const createSummary = (
    overrides: Partial<PolicyParticipantOutcomeSummary>
  ): PolicyParticipantOutcomeSummary => {
    const scheduled = overrides.scheduledMatches ?? 100;
    const completed = overrides.completedMatches ?? 100;
    const wins = overrides.wins ?? 0;
    const losses = overrides.losses ?? (completed - wins);
    const draws = overrides.draws ?? 0;
    const incomplete = overrides.incompleteMatches ?? 0;
    const failed = overrides.failedMatches ?? 0;

    return {
      participantId: overrides.participantId ?? "participant-alpha",
      scheduledMatches: scheduled,
      completedMatches: completed,
      wins,
      losses,
      draws,
      incompleteMatches: incomplete,
      failedMatches: failed,
      winRateOnCompleted: overrides.winRateOnCompleted ?? (completed > 0 ? wins / completed : 0),
      asP1: overrides.asP1 ?? dummySeatSummary,
      asP2: overrides.asP2 ?? dummySeatSummary,
    };
  };

  describe("A. Unit Tests (Specification Conformance)", () => {
    it("Test 1: VALID / 勝敗のみ (70 wins, 30 losses -> fitnessScore = 0.70)", () => {
      const summary = createSummary({
        scheduledMatches: 100,
        completedMatches: 100,
        wins: 70,
        losses: 30,
        draws: 0,
        incompleteMatches: 0,
        failedMatches: 0,
      });

      const result = FitnessEvaluator.evaluateParticipant(summary);

      expect(result.status).toBe("VALID");
      if (result.status === "VALID") {
        expect(result.fitnessScore).toBeCloseTo(0.70, 6);
        expect(result.completedMatches).toBe(100);
        expect(result.completionRate).toBe(1.0);
        expect(result.scheduledMatches).toBe(100);
        expect(result.wins).toBe(70);
        expect(result.losses).toBe(30);
        expect(result.draws).toBe(0);
      }
    });

    it("Test 2: DRAW weighting (40 win, 20 draw, 40 loss -> fitnessScore = 0.50)", () => {
      const summary = createSummary({
        scheduledMatches: 100,
        completedMatches: 100,
        wins: 40,
        draws: 20,
        losses: 40,
        incompleteMatches: 0,
        failedMatches: 0,
      });

      const result = FitnessEvaluator.evaluateParticipant(summary);

      expect(result.status).toBe("VALID");
      if (result.status === "VALID") {
        // (40 * 1.0 + 20 * 0.5 + 40 * 0.0) / 100 = 50 / 100 = 0.50
        expect(result.fitnessScore).toBeCloseTo(0.50, 6);
      }
    });

    it("Test 3: 正常な全敗 (100 completed, 0 win, 100 loss -> VALID, fitnessScore = 0.0 strictly not null)", () => {
      const summary = createSummary({
        scheduledMatches: 100,
        completedMatches: 100,
        wins: 0,
        draws: 0,
        losses: 100,
        incompleteMatches: 0,
        failedMatches: 0,
      });

      const result = FitnessEvaluator.evaluateParticipant(summary);

      expect(result.status).toBe("VALID");
      if (result.status === "VALID") {
        expect(result.fitnessScore).toBe(0.0);
        expect(typeof result.fitnessScore).toBe("number");
        expect(result.fitnessScore).not.toBeNull();
      }
    });

    it("Test 4: 0試合完了 (100 scheduled, 0 completed, 100 incomplete -> INSUFFICIENT_EVIDENCE, fitnessScore = null, provisionalScore = null)", () => {
      const summary = createSummary({
        scheduledMatches: 100,
        completedMatches: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        incompleteMatches: 100,
        failedMatches: 0,
      });

      const result = FitnessEvaluator.evaluateParticipant(summary);

      expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
      if (result.status === "INSUFFICIENT_EVIDENCE") {
        expect(result.fitnessScore).toBeNull();
        expect(result.provisionalScore).toBeNull();
        expect(result.completedMatches).toBe(0);
        expect(result.completionRate).toBe(0.0);
      }
    });

    it("Test 5: 絶対完了数不足 (100 scheduled, 2 completed, 2 wins, 98 incomplete -> INSUFFICIENT_EVIDENCE, provisionalScore = 1.0)", () => {
      const summary = createSummary({
        scheduledMatches: 100,
        completedMatches: 2,
        wins: 2,
        draws: 0,
        losses: 0,
        incompleteMatches: 98,
        failedMatches: 0,
      });

      const result = FitnessEvaluator.evaluateParticipant(summary);

      expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
      if (result.status === "INSUFFICIENT_EVIDENCE") {
        expect(result.fitnessScore).toBeNull();
        expect(result.provisionalScore).toBeCloseTo(1.0, 6);
        expect(result.completedMatches).toBe(2);
        expect(result.completionRate).toBe(0.02);
      }
    });

    it("Test 6: 完了率不足 (1000 scheduled, 20 completed, 20 wins, 980 incomplete -> INSUFFICIENT_EVIDENCE, provisionalScore = 1.0)", () => {
      const summary = createSummary({
        scheduledMatches: 1000,
        completedMatches: 20,
        wins: 20,
        draws: 0,
        losses: 0,
        incompleteMatches: 980,
        failedMatches: 0,
      });

      const result = FitnessEvaluator.evaluateParticipant(summary);

      expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
      if (result.status === "INSUFFICIENT_EVIDENCE") {
        expect(result.fitnessScore).toBeNull();
        expect(result.provisionalScore).toBeCloseTo(1.0, 6);
        expect(result.completedMatches).toBe(20);
        expect(result.completionRate).toBe(0.02); // 2% < 50%
      }
    });

    it("Test 7: FAILED Fail-Closed (100 scheduled, 99 completed, 99 wins, 1 failed -> INVALID, fitnessScore = null)", () => {
      const summary = createSummary({
        scheduledMatches: 100,
        completedMatches: 99,
        wins: 99,
        draws: 0,
        losses: 0,
        incompleteMatches: 0,
        failedMatches: 1,
      });

      const result = FitnessEvaluator.evaluateParticipant(summary);

      expect(result.status).toBe("INVALID");
      if (result.status === "INVALID") {
        expect(result.fitnessScore).toBeNull();
        expect(result.scheduledMatches).toBe(100);
        expect(result.failedMatches).toBe(1);
      }
    });

    it("Test 8: Boundary (completedMatches === minimumCompletedMatches && completionRate === minimumCompletionRate -> VALID)", () => {
      // minimumCompletedMatches = 10, minimumCompletionRate = 0.50
      // 20 scheduled, 10 completed (10 / 20 = 0.50), 10 incomplete
      const summary = createSummary({
        scheduledMatches: 20,
        completedMatches: 10,
        wins: 8,
        draws: 2,
        losses: 0,
        incompleteMatches: 10,
        failedMatches: 0,
      });

      const result = FitnessEvaluator.evaluateParticipant(summary);

      expect(result.status).toBe("VALID");
      if (result.status === "VALID") {
        // (8 * 1.0 + 2 * 0.5) / 10 = 9 / 10 = 0.90
        expect(result.fitnessScore).toBeCloseTo(0.90, 6);
        expect(result.completedMatches).toBe(10);
        expect(result.completionRate).toBe(0.50);
      }
    });

    it("Test 9: winRateOnCompleted Negative Control (winRateOnCompleted の改ざんが結果に一切影響しないこと)", () => {
      const canonicalCounts = {
        scheduledMatches: 100,
        completedMatches: 60,
        wins: 40,
        draws: 10,
        losses: 10,
        incompleteMatches: 40,
        failedMatches: 0,
      };

      const summary1 = createSummary({
        ...canonicalCounts,
        winRateOnCompleted: 0.999999, // 意図的偽装値 A
      });

      const summary2 = createSummary({
        ...canonicalCounts,
        winRateOnCompleted: 0.000001, // 意図的偽装値 B
      });

      const result1 = FitnessEvaluator.evaluateParticipant(summary1);
      const result2 = FitnessEvaluator.evaluateParticipant(summary2);

      expect(result1).toEqual(result2);
      expect(result1.status).toBe("VALID");
      if (result1.status === "VALID") {
        // (40 * 1.0 + 10 * 0.5) / 60 = 45 / 60 = 0.75
        expect(result1.fitnessScore).toBeCloseTo(0.75, 6);
      }
    });

    it("Test 10: Input Integrity (wins + losses + draws !== completedMatches -> reject)", () => {
      const invalidSummary = createSummary({
        scheduledMatches: 100,
        completedMatches: 50,
        wins: 30,
        losses: 30, // 30 + 30 = 60 !== 50
        draws: 0,
        incompleteMatches: 50,
        failedMatches: 0,
      });

      expect(() => FitnessEvaluator.evaluateParticipant(invalidSummary)).toThrow(
        FitnessInputIntegrityError
      );
    });

    it("Test 11: Input Integrity (completed + incomplete + failed !== scheduled -> reject)", () => {
      const invalidSummary = createSummary({
        scheduledMatches: 100,
        completedMatches: 50,
        wins: 25,
        losses: 25,
        draws: 0,
        incompleteMatches: 40, // 50 + 40 + 0 = 90 !== 100
        failedMatches: 0,
      });

      expect(() => FitnessEvaluator.evaluateParticipant(invalidSummary)).toThrow(
        FitnessInputIntegrityError
      );
    });

    it("Test 12: Invalid Config (minimumCompletedMatches / minimumCompletionRate 不正値で reject)", () => {
      const validSummary = createSummary({
        scheduledMatches: 100,
        completedMatches: 100,
        wins: 50,
        losses: 50,
        draws: 0,
        incompleteMatches: 0,
        failedMatches: 0,
      });

      // minimumCompletedMatches < 1
      expect(() =>
        FitnessEvaluator.evaluateParticipant(validSummary, { minimumCompletedMatches: 0 })
      ).toThrow(FitnessEvaluationConfigurationError);

      // minimumCompletedMatches is negative
      expect(() =>
        FitnessEvaluator.evaluateParticipant(validSummary, { minimumCompletedMatches: -5 })
      ).toThrow(FitnessEvaluationConfigurationError);

      // minimumCompletedMatches is fraction
      expect(() =>
        FitnessEvaluator.evaluateParticipant(validSummary, { minimumCompletedMatches: 2.5 })
      ).toThrow(FitnessEvaluationConfigurationError);

      // minimumCompletedMatches is NaN
      expect(() =>
        FitnessEvaluator.evaluateParticipant(validSummary, { minimumCompletedMatches: NaN })
      ).toThrow(FitnessEvaluationConfigurationError);

      // minimumCompletionRate <= 0
      expect(() =>
        FitnessEvaluator.evaluateParticipant(validSummary, { minimumCompletionRate: 0 })
      ).toThrow(FitnessEvaluationConfigurationError);

      // minimumCompletionRate > 1
      expect(() =>
        FitnessEvaluator.evaluateParticipant(validSummary, { minimumCompletionRate: 1.01 })
      ).toThrow(FitnessEvaluationConfigurationError);

      // minimumCompletionRate is NaN
      expect(() =>
        FitnessEvaluator.evaluateParticipant(validSummary, { minimumCompletionRate: NaN })
      ).toThrow(FitnessEvaluationConfigurationError);
    });

    it("Test 13: Determinism (同一入力と設定に対して複数回評価し、JSON.stringify が完全一致すること)", () => {
      const summary = createSummary({
        scheduledMatches: 100,
        completedMatches: 80,
        wins: 50,
        draws: 10,
        losses: 20,
        incompleteMatches: 20,
        failedMatches: 0,
      });

      const res1 = FitnessEvaluator.evaluateParticipant(summary);
      const res2 = FitnessEvaluator.evaluateParticipant(summary);
      const res3 = FitnessEvaluator.evaluateParticipant(summary);

      const json1 = JSON.stringify(res1);
      const json2 = JSON.stringify(res2);
      const json3 = JSON.stringify(res3);

      expect(json1).toBe(json2);
      expect(json2).toBe(json3);
      expect(res1).toEqual(res2);
    });
  });

  describe("B. Production-Path Integration Tests", () => {
    let rulePackage: RulePackage;

    beforeAll(async () => {
      const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
      const fullPackage = await loadRulePackageFromDirectory(rulesDir);
      rulePackage = getPlaytestRulePackage(fullPackage);
    });

    const createTestSessionFactory = () => {
      return () => {
        const rawState = createCoreBattlePresetState();
        const setupResult = MatchSetupCoordinator.setupMatch(rawState);
        return new GameSession(setupResult.state, rulePackage);
      };
    };

    it("Test 14: PolicyExperimentRunner -> real GameSession -> Outcome Summary -> FitnessEvaluator (意図的INCOMPLETE時: INSUFFICIENT_EVIDENCE, provisionalScore = null)", () => {
      const participantA = BaselineParticipants.createFirstLegal("player-alpha", "Player Alpha");
      const participantB = BaselineParticipants.createRandom("player-beta", "Player Beta");

      // maxDecisionsPerMatch = 1 により、実 GameSession で即座に INCOMPLETE を発生させる
      const experimentResult: PolicyExperimentResult = PolicyExperimentRunner.run({
        experimentId: "fitness-eval-integration-incomplete",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 1, // 総予定 2 試合 (Leg 1: 1, Leg 2: 1)
        maxDecisionsPerMatch: 1,
        participantA,
        participantB,
        sessionFactory: createTestSessionFactory(),
      });

      expect(experimentResult.summary.totalScheduledMatches).toBe(2);
      expect(experimentResult.summary.totalCompletedMatches).toBe(0);
      expect(experimentResult.summary.totalIncompleteMatches).toBe(2);
      expect(experimentResult.summary.totalFailedMatches).toBe(0);

      // 実験結果全体を FitnessEvaluator へ渡す
      const fitnessResults = FitnessEvaluator.evaluateExperiment(experimentResult);

      expect(Object.keys(fitnessResults)).toHaveLength(2);

      const resA = fitnessResults["player-alpha"];
      const resB = fitnessResults["player-beta"];

      expect(resA).toBeDefined();
      expect(resB).toBeDefined();

      // 0 試合完了のため、両者 INSUFFICIENT_EVIDENCE かつ provisionalScore = null
      expect(resA.status).toBe("INSUFFICIENT_EVIDENCE");
      expect(resB.status).toBe("INSUFFICIENT_EVIDENCE");

      if (resA.status === "INSUFFICIENT_EVIDENCE") {
        expect(resA.fitnessScore).toBeNull();
        expect(resA.provisionalScore).toBeNull();
        expect(resA.completedMatches).toBe(0);
        expect(resA.completionRate).toBe(0);
        expect(resA.scheduledMatches).toBe(2);
      }

      if (resB.status === "INSUFFICIENT_EVIDENCE") {
        expect(resB.fitnessScore).toBeNull();
        expect(resB.provisionalScore).toBeNull();
        expect(resB.completedMatches).toBe(0);
        expect(resB.completionRate).toBe(0);
        expect(resB.scheduledMatches).toBe(2);
      }
    });

    it("Test 15: PolicyExperimentRunner -> real GameSession -> Outcome Summary -> FitnessEvaluator (正常完了試合ありの実経路評価)", () => {
      const participantA = BaselineParticipants.createFirstLegal("player-alpha", "Player Alpha");
      const participantB = BaselineParticipants.createRandom("player-beta", "Player Beta");

      // 十分な手数上限を与えて実 GameSession を完了させる
      const experimentResult: PolicyExperimentResult = PolicyExperimentRunner.run({
        experimentId: "fitness-eval-integration-completed",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 100,
        matchesPerSeat: 2, // 総予定 4 試合
        maxDecisionsPerMatch: 500,
        participantA,
        participantB,
        sessionFactory: createTestSessionFactory(),
      });

      expect(experimentResult.summary.totalScheduledMatches).toBe(4);
      expect(experimentResult.summary.totalFailedMatches).toBe(0);

      const completed = experimentResult.summary.totalCompletedMatches;
      expect(completed).toBeGreaterThan(0);

      // config override: 完了数が少なくても VALID になるよう閾値を調整して Authoritative Fitness を検証
      const customConfig = {
        minimumCompletedMatches: 1,
        minimumCompletionRate: 0.25,
      };

      const fitnessResults = FitnessEvaluator.evaluateExperiment(experimentResult, customConfig);

      const resA = fitnessResults["player-alpha"];
      const resB = fitnessResults["player-beta"];

      expect(resA).toBeDefined();
      expect(resB).toBeDefined();

      if (resA.status === "VALID") {
        expect(typeof resA.fitnessScore).toBe("number");
        expect(resA.fitnessScore).toBeGreaterThanOrEqual(0.0);
        expect(resA.fitnessScore).toBeLessThanOrEqual(1.0);
      }

      if (resB.status === "VALID") {
        expect(typeof resB.fitnessScore).toBe("number");
        expect(resB.fitnessScore).toBeGreaterThanOrEqual(0.0);
        expect(resB.fitnessScore).toBeLessThanOrEqual(1.0);
      }
    });
  });
});
