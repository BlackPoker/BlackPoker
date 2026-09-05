import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import {
  POLICY_EXPERIMENT_RESULT_VERSION,
  PolicyExperimentConfigurationError,
  PolicyExperimentOptions,
  PolicyExperimentParticipant,
} from "../../domain/ai/PolicyExperimentTypes";
import { PolicyExperimentRunner } from "../../engine/ai/PolicyExperimentRunner";
import { BaselineParticipants, createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { DecisionBehaviorObserverPolicy } from "../../engine/ai/DecisionBehaviorObserverPolicy";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { DecisionPolicy } from "../../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { PATTERN_FEATURE_NAMES } from "../../domain/ai/DecisionFeatureTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Policy Baseline Evaluation & Experiment Harness (Phase 3.2)", () => {
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

  describe("A. Configuration & Fail-Fast Validation", () => {
    it("1. experimentResultVersion は 1 であること", () => {
      expect(PolicyExperimentRunner.VERSION).toBe(1);
      expect(POLICY_EXPERIMENT_RESULT_VERSION).toBe(1);
    });

    it("2. 不正な participant ID (空文字・空白) で fail-fast すること", () => {
      const validPart = BaselineParticipants.createFirstLegal();
      const invalidPart: PolicyExperimentParticipant = {
        id: "   ",
        name: "Invalid",
        policyFactory: () => BaselineParticipants.createFirstLegal().policyFactory({} as any, "p1"),
      };

      expect(() =>
        PolicyExperimentRunner.run({
          experimentId: "exp-001",
          environmentRef: "test-env",
          baseSeed: 42,
          matchesPerSeat: 2,
          participantA: invalidPart,
          participantB: validPart,
          sessionFactory: createTestSessionFactory(),
        })
      ).toThrow(PolicyExperimentConfigurationError);
    });

    it("3. participant A と participant B の ID が重複している場合に fail-fast すること", () => {
      const part1 = BaselineParticipants.createFirstLegal("same-id", "P1");
      const part2 = BaselineParticipants.createRandom("same-id", "P2");

      expect(() =>
        PolicyExperimentRunner.run({
          experimentId: "exp-001",
          environmentRef: "test-env",
          baseSeed: 42,
          matchesPerSeat: 2,
          participantA: part1,
          participantB: part2,
          sessionFactory: createTestSessionFactory(),
        })
      ).toThrow(PolicyExperimentConfigurationError);
    });

    it("4. matchesPerSeat が 0, 負数, 非整数, NaN の場合に fail-fast すること", () => {
      const pA = BaselineParticipants.createFirstLegal();
      const pB = BaselineParticipants.createRandom();

      for (const invalid of [0, -1, 1.5, NaN, Infinity]) {
        expect(() =>
          PolicyExperimentRunner.run({
            experimentId: "exp-001",
            environmentRef: "test-env",
            baseSeed: 42,
            matchesPerSeat: invalid,
            participantA: pA,
            participantB: pB,
            sessionFactory: createTestSessionFactory(),
          })
        ).toThrow(PolicyExperimentConfigurationError);
      }
    });

    it("5. baseSeed が NaN または非有限数の場合に fail-fast すること", () => {
      const pA = BaselineParticipants.createFirstLegal();
      const pB = BaselineParticipants.createRandom();

      for (const invalid of [NaN, Infinity, -Infinity]) {
        expect(() =>
          PolicyExperimentRunner.run({
            experimentId: "exp-001",
            environmentRef: "test-env",
            baseSeed: invalid,
            matchesPerSeat: 2,
            participantA: pA,
            participantB: pB,
            sessionFactory: createTestSessionFactory(),
          })
        ).toThrow(PolicyExperimentConfigurationError);
      }
    });

    it("6. participant または session の factory が未設定・非関数の場合に fail-fast すること", () => {
      const pA = BaselineParticipants.createFirstLegal();
      const pBInvalid = { ...BaselineParticipants.createRandom(), policyFactory: null as any };

      expect(() =>
        PolicyExperimentRunner.run({
          experimentId: "exp-001",
          environmentRef: "test-env",
          baseSeed: 42,
          matchesPerSeat: 2,
          participantA: pA,
          participantB: pBInvalid,
          sessionFactory: createTestSessionFactory(),
        })
      ).toThrow(PolicyExperimentConfigurationError);

      expect(() =>
        PolicyExperimentRunner.run({
          experimentId: "exp-001",
          environmentRef: "test-env",
          baseSeed: 42,
          matchesPerSeat: 2,
          participantA: pA,
          participantB: BaselineParticipants.createRandom(),
          sessionFactory: "not-a-function" as any,
        })
      ).toThrow(PolicyExperimentConfigurationError);
    });

    it("7. Config Error 時に sessionFactory, participantA.policyFactory, participantB.policyFactory の呼出回数がすべて 0 回であること", () => {
      let sessionCalls = 0;
      let pACalls = 0;
      let pBCalls = 0;

      const pA: PolicyExperimentParticipant = {
        id: "pA",
        name: "A",
        policyFactory: () => {
          pACalls++;
          return BaselineParticipants.createFirstLegal().policyFactory({} as any, "p1");
        },
      };

      const pB: PolicyExperimentParticipant = {
        id: "pB",
        name: "B",
        policyFactory: () => {
          pBCalls++;
          return BaselineParticipants.createRandom().policyFactory({} as any, "p2");
        },
      };

      expect(() =>
        PolicyExperimentRunner.run({
          experimentId: "", // 不正
          environmentRef: "env",
          baseSeed: 42,
          matchesPerSeat: 2,
          participantA: pA,
          participantB: pB,
          sessionFactory: () => {
            sessionCalls++;
            return createTestSessionFactory()();
          },
        })
      ).toThrow(PolicyExperimentConfigurationError);

      expect(sessionCalls).toBe(0);
      expect(pACalls).toBe(0);
      expect(pBCalls).toBe(0);
    });
  });

  describe("B. Pairwise Experiment & Seat Swap Execution", () => {
    it("8. Seat Assignment: Leg 1 では p1=A, p2=B、Leg 2 では p1=B, p2=A であること", () => {
      const pA = BaselineParticipants.createFirstLegal("part-a", "FirstLegalA");
      const pB = BaselineParticipants.createRandom("part-b", "RandomB");

      const result = PolicyExperimentRunner.run({
        experimentId: "seat-swap-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 100,
        matchesPerSeat: 2,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      });

      expect(result.legs).toHaveLength(2);
      expect(result.legs[0].legId).toBe("leg-a-as-p1");
      expect(result.legs[0].seatAssignments).toEqual({ p1: "part-a", p2: "part-b" });

      expect(result.legs[1].legId).toBe("leg-b-as-p1");
      expect(result.legs[1].seatAssignments).toEqual({ p1: "part-b", p2: "part-a" });
    });

    it("9. Leg 1 と Leg 2 で同一 matchIndex の matchSeed および playerSeeds が完全に一致すること", () => {
      const pA = BaselineParticipants.createFirstLegal("part-a", "FirstLegalA");
      const pB = BaselineParticipants.createRandom("part-b", "RandomB");

      const result = PolicyExperimentRunner.run({
        experimentId: "seed-plan-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 999,
        matchesPerSeat: 3,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      });

      const leg1 = result.legs[0];
      const leg2 = result.legs[1];

      for (let i = 0; i < 3; i++) {
        expect(leg1.matches[i].matchSeed).toBe(leg2.matches[i].matchSeed);
        expect(leg1.matches[i].playerSeeds).toEqual(leg2.matches[i].playerSeeds);
      }
    });

    it("10. Participant winner mapping: p1 / p2 勝利が正しい participantId へ変換され集計されること", () => {
      const pA = BaselineParticipants.createFirstLegal("pA", "Player A");
      const pB = BaselineParticipants.createFirstLegal("pB", "Player B", true); // preferPass

      const result = PolicyExperimentRunner.run({
        experimentId: "winner-mapping-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 2,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      });

      const sumA = result.summary.participants["pA"];
      const sumB = result.summary.participants["pB"];

      expect(sumA).toBeDefined();
      expect(sumB).toBeDefined();
      expect(sumA.wins + sumB.wins + sumA.draws).toBe(result.summary.totalCompletedMatches);
    });

    it("11. Seat aggregate: asP1 と asP2 の戦績がそれぞれ独立・正確に集計されること", () => {
      const pA = BaselineParticipants.createFirstLegal("pA", "Player A");
      const pB = BaselineParticipants.createRandom("pB", "Player B");

      const result = PolicyExperimentRunner.run({
        experimentId: "seat-aggregate-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 3,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      });

      const sumA = result.summary.participants["pA"];
      expect(sumA.asP1.scheduledMatches).toBe(3);
      expect(sumA.asP2.scheduledMatches).toBe(3);
      expect(sumA.scheduledMatches).toBe(6);

      expect(sumA.wins).toBe(sumA.asP1.wins + sumA.asP2.wins);
      expect(sumA.losses).toBe(sumA.asP1.losses + sumA.asP2.losses);
      expect(sumA.draws).toBe(sumA.asP1.draws + sumA.asP2.draws);
    });

    it("12. Outcome Conservation: wins + losses + draws === completedMatches が常に成立すること", () => {
      const pA = BaselineParticipants.createFirstLegal("pA", "Player A");
      const pB = BaselineParticipants.createRandom("pB", "Player B");

      const result = PolicyExperimentRunner.run({
        experimentId: "conservation-test-1",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 123,
        matchesPerSeat: 4,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      });

      for (const pId of ["pA", "pB"]) {
        const pSummary = result.summary.participants[pId];
        expect(pSummary.wins + pSummary.losses + pSummary.draws).toBe(pSummary.completedMatches);
        expect(pSummary.asP1.wins + pSummary.asP1.losses + pSummary.asP1.draws).toBe(
          pSummary.asP1.completedMatches
        );
        expect(pSummary.asP2.wins + pSummary.asP2.losses + pSummary.asP2.draws).toBe(
          pSummary.asP2.completedMatches
        );
      }
    });

    it("13. Scheduled Conservation: completed + incomplete + failed === scheduledMatches が常に成立すること", () => {
      const pA = BaselineParticipants.createFirstLegal("pA", "Player A");
      const pB = BaselineParticipants.createRandom("pB", "Player B");

      const result = PolicyExperimentRunner.run({
        experimentId: "conservation-test-2",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 123,
        matchesPerSeat: 4,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      });

      for (const pId of ["pA", "pB"]) {
        const pSummary = result.summary.participants[pId];
        expect(
          pSummary.completedMatches + pSummary.incompleteMatches + pSummary.failedMatches
        ).toBe(pSummary.scheduledMatches);
        expect(
          pSummary.asP1.completedMatches +
            pSummary.asP1.incompleteMatches +
            pSummary.asP1.failedMatches
        ).toBe(pSummary.asP1.scheduledMatches);
        expect(
          pSummary.asP2.completedMatches +
            pSummary.asP2.incompleteMatches +
            pSummary.asP2.failedMatches
        ).toBe(pSummary.asP2.scheduledMatches);
      }
    });

    it("14. INCOMPLETE は draw に数えられないこと", () => {
      const pA = BaselineParticipants.createFirstLegal("pA", "Player A");
      const pB = BaselineParticipants.createRandom("pB", "Player B");

      // maxDecisionsPerMatch を 1 に制限して INCOMPLETE を強制発生させる
      const result = PolicyExperimentRunner.run({
        experimentId: "incomplete-not-draw-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 123,
        matchesPerSeat: 2,
        maxDecisionsPerMatch: 1,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      });

      expect(result.summary.totalIncompleteMatches).toBe(4);
      expect(result.summary.totalCompletedMatches).toBe(0);

      const sumA = result.summary.participants["pA"];
      expect(sumA.incompleteMatches).toBe(4);
      expect(sumA.draws).toBe(0);
      expect(sumA.completedMatches).toBe(0);
      expect(sumA.winRateOnCompleted).toBe(0);
    });

    it("15. FAILED は draw に数えられないこと", () => {
      const pA = BaselineParticipants.createFirstLegal("pA", "Player A");
      // 意図的に例外を投げる Policy
      const pBFailing: PolicyExperimentParticipant = {
        id: "pB-failing",
        name: "FailingB",
        policyFactory: () => ({
          descriptor: { kind: "failing", policyVersion: 1 },
          choose: () => {
            throw new Error("Intentional error for testing");
          },
        }),
      };

      const result = PolicyExperimentRunner.run({
        experimentId: "failed-not-draw-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 123,
        matchesPerSeat: 2,
        participantA: pA,
        participantB: pBFailing,
        sessionFactory: createTestSessionFactory(),
      });

      expect(result.summary.totalFailedMatches).toBe(4);
      const sumA = result.summary.participants["pA"];
      expect(sumA.failedMatches).toBe(4);
      expect(sumA.draws).toBe(0);
      expect(sumA.completedMatches).toBe(0);
    });
  });

  describe("C. Generic Behavior Metrics & Observer", () => {
    it("16. Observer が underlyingPolicy の selectedPatternRef を変更せず透過すること", () => {
      let recordedRef: number | undefined;
      const basePolicy = BaselineParticipants.createFirstLegal().policyFactory({} as any, "p1");

      const observer = new DecisionBehaviorObserverPolicy(
        basePolicy,
        "test-p1",
        "leg-1",
        0,
        "p1",
        () => {}
      );

      const mockRequest: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "m1",
        decisionId: "d1",
        stateVersion: 1,
        playerId: "p1",
        source: { type: "ACTION_REQUEST", playerId: "p1" },
        observation: {} as any,
        catalog: {} as any,
        patterns: [
          { patternId: "pat-1", kind: "ACTION" },
          { patternId: "pat-2", kind: "PASS" },
        ],
      };

      const originalRes = basePolicy.choose(mockRequest);
      const observerRes = observer.choose(mockRequest);

      expect(observerRes.selectedPatternRef).toBe(originalRes.selectedPatternRef);
      expect(observerRes.decisionId).toBe(originalRes.decisionId);
    });

    it("17. 不正な selectedPatternRef (負数・範囲外) を返す Policy でも Observer が throw せず透過すること", () => {
      const badPolicy: DecisionPolicy = {
        descriptor: { kind: "bad", policyVersion: 1 },
        choose: () => ({
          decisionId: "d-bad",
          stateVersion: 1,
          selectedPatternRef: 9999, // 範囲外
        }),
      };

      let recordedRecord: any = null;
      const observer = new DecisionBehaviorObserverPolicy(
        badPolicy,
        "bad-p",
        "leg-1",
        0,
        "p1",
        (r) => {
          recordedRecord = r;
        }
      );

      const mockRequest: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "m1",
        decisionId: "d1",
        stateVersion: 1,
        playerId: "p1",
        source: { type: "ACTION_REQUEST", playerId: "p1" },
        observation: {} as any,
        catalog: {} as any,
        patterns: [{ patternId: "pat-1", kind: "ACTION" }],
      };

      expect(() => observer.choose(mockRequest)).not.toThrow();
      const res = observer.choose(mockRequest);
      expect(res.selectedPatternRef).toBe(9999);
      // 安全に OTHER として記録されていること
      expect(recordedRecord?.selectedPatternKind).toBe("OTHER");
    });

    it("18. Behavior Counter: ACTION, PASS, EFFECT_SELECTION が正しく加算・集計されること", () => {
      const pA = BaselineParticipants.createFirstLegal("pA", "FirstLegal");
      const pB = BaselineParticipants.createRandom("pB", "Random");

      const result = PolicyExperimentRunner.run({
        experimentId: "behavior-counter-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 2,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      });

      const behA = result.behavior["pA"];
      const behB = result.behavior["pB"];

      expect(behA.totalObservedDecisions).toBeGreaterThan(0);
      expect(
        behA.actionSelections + behA.passSelections + behA.effectSelections + behA.otherSelections
      ).toBe(behA.totalObservedDecisions);

      expect(behA.actionSelectionRate).toBeGreaterThanOrEqual(0);
      expect(behA.actionSelectionRate).toBeLessThanOrEqual(1);
    });

    it("19. FAILED 試合の失敗前 Decision が Behavior Summary に保持されること", () => {
      let decisionCount = 0;
      const failingAfter3: PolicyExperimentParticipant = {
        id: "pB-fail-after-3",
        name: "FailAfter3",
        policyFactory: () => ({
          descriptor: { kind: "failAfter3", policyVersion: 1 },
          choose: (req) => {
            decisionCount++;
            if (decisionCount > 3) {
              throw new Error("Failure after 3 decisions");
            }
            return { decisionId: req.decisionId, stateVersion: req.stateVersion, selectedPatternRef: 0 };
          },
        }),
      };

      const pA = BaselineParticipants.createFirstLegal("pA", "FirstLegal");

      const result = PolicyExperimentRunner.run({
        experimentId: "behavior-in-failed-match-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 1,
        participantA: pA,
        participantB: failingAfter3,
        sessionFactory: createTestSessionFactory(),
      });

      expect(result.summary.totalFailedMatches).toBeGreaterThan(0);
      // 失敗前に下された意思決定が Behavior Summary に正しく記録されていること
      expect(result.behavior["pB-fail-after-3"].totalObservedDecisions).toBeGreaterThanOrEqual(1);
    });

    it("20. INCOMPLETE 試合の Decision も Behavior Summary に含まれること", () => {
      const pA = BaselineParticipants.createFirstLegal("pA", "Player A");
      const pB = BaselineParticipants.createRandom("pB", "Player B");

      const result = PolicyExperimentRunner.run({
        experimentId: "behavior-incomplete-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 123,
        matchesPerSeat: 1,
        maxDecisionsPerMatch: 5,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      });

      expect(result.summary.totalIncompleteMatches).toBe(2);
      expect(result.behavior["pA"].totalObservedDecisions).toBeGreaterThan(0);
      expect(result.behavior["pB"].totalObservedDecisions).toBeGreaterThan(0);
    });

    it("21. 観測 Decision が 0 件の場合、各 rate が NaN ではなく 0 であること", () => {
      // 1手も打たずに即座に sessionFactory で失敗させるケース
      const failingSessionRunner = () => {
        throw new Error("Immediate session factory fail");
      };

      const result = PolicyExperimentRunner.run({
        experimentId: "zero-decision-rate-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 123,
        matchesPerSeat: 1,
        participantA: BaselineParticipants.createFirstLegal("pA", "A"),
        participantB: BaselineParticipants.createRandom("pB", "B"),
        sessionFactory: failingSessionRunner,
      });

      const behA = result.behavior["pA"];
      expect(behA.totalObservedDecisions).toBe(0);
      expect(behA.actionSelectionRate).toBe(0);
      expect(behA.passSelectionRate).toBe(0);
      expect(behA.effectSelectionRate).toBe(0);
      expect(Number.isNaN(behA.actionSelectionRate)).toBe(false);
    });
  });

  describe("D. Logical / Diagnostic Separation & Determinism", () => {
    it("22. errorMessage / errorStack が Logical Result に混入せず Diagnostic 領域へ分離されること", () => {
      const pAFailing: PolicyExperimentParticipant = {
        id: "pA-failing",
        name: "FailingA",
        policyFactory: () => ({
          descriptor: { kind: "failing", policyVersion: 1 },
          choose: () => {
            throw new Error(`Dynamic runtime decision failure: decision-${Math.random()}`);
          },
        }),
      };

      const result = PolicyExperimentRunner.run({
        experimentId: "logical-failure-separation-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 1,
        participantA: pAFailing,
        participantB: BaselineParticipants.createRandom("pB", "B"),
        sessionFactory: createTestSessionFactory(),
      });

      const leg1 = result.legs[0];
      expect(leg1.failures.length).toBeGreaterThan(0);

      for (const logicalFailure of leg1.failures) {
        expect((logicalFailure as any).errorMessage).toBeUndefined();
        expect((logicalFailure as any).errorStack).toBeUndefined();
        expect(logicalFailure.errorName).toBeDefined();
        expect(logicalFailure.phase).toBeDefined();
      }

      // matches[i].failure からも排除されていること
      for (const m of leg1.matches) {
        if (m.failure) {
          expect((m.failure as any).errorMessage).toBeUndefined();
          expect((m.failure as any).errorStack).toBeUndefined();
        }
      }

      // 診断メトリクス側には errorMessage が保持されていること
      const diagFailures = result.runtimeMetrics?.legs[0]?.diagnosticFailures;
      expect(diagFailures).toBeDefined();
      expect(diagFailures![0].errorMessage).toContain("Dynamic runtime decision failure");
    });

    it("23. 実行時の errorMessage が異なっても Logical Experiment Result が deepEqual であること", () => {
      let counter = 0;
      const createDynamicFailingParticipant = () => ({
        id: "p-dynamic-fail",
        name: "DynamicFail",
        policyFactory: () => ({
          descriptor: { kind: "fail", policyVersion: 1 },
          choose: () => {
            counter++;
            throw new Error(`Non-deterministic error message token: ${counter}`);
          },
        }),
      });

      const run1 = PolicyExperimentRunner.run({
        experimentId: "diff-msg-det-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 1,
        participantA: createDynamicFailingParticipant(),
        participantB: BaselineParticipants.createRandom("pB", "B"),
        sessionFactory: createTestSessionFactory(),
      });

      const run2 = PolicyExperimentRunner.run({
        experimentId: "diff-msg-det-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 1,
        participantA: createDynamicFailingParticipant(),
        participantB: BaselineParticipants.createRandom("pB", "B"),
        sessionFactory: createTestSessionFactory(),
      });

      // runtimeMetrics を除外した論理結果
      const { runtimeMetrics: r1, ...logical1 } = run1;
      const { runtimeMetrics: r2, ...logical2 } = run2;

      expect(logical1).toEqual(logical2);
      expect(JSON.stringify(logical1)).toBe(JSON.stringify(logical2));
    });

    it("24. 同一設定で 2 回実行した Logical Experiment Result が完全一致 (JSON 完全一致) すること", () => {
      const pA = BaselineParticipants.createFirstLegal("pA", "A");
      const pB = BaselineParticipants.createRandom("pB", "B");

      const options: PolicyExperimentOptions = {
        experimentId: "determinism-check",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 55555,
        matchesPerSeat: 3,
        maxDecisionsPerMatch: 200,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      };

      const result1 = PolicyExperimentRunner.run(options);
      const result2 = PolicyExperimentRunner.run(options);

      const { runtimeMetrics: rm1, ...logical1 } = result1;
      const { runtimeMetrics: rm2, ...logical2 } = result2;

      expect(logical1).toEqual(logical2);
      expect(JSON.stringify(logical1)).toBe(JSON.stringify(logical2));
    });

    it("25. Logical Result が JSON round-trip 可能であり、関数や Genome full weights を含まないこと", () => {
      const pA = BaselineParticipants.createZeroGenome("zero-pA", "ZeroA");
      const pB = BaselineParticipants.createManualGenericGenome("manual-pB", "ManualB");

      const result = PolicyExperimentRunner.run({
        experimentId: "json-safety-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 2,
        participantA: pA,
        participantB: pB,
        sessionFactory: createTestSessionFactory(),
      });

      const { runtimeMetrics, ...logicalResult } = result;
      const serialized = JSON.stringify(logicalResult);
      const parsed = JSON.parse(serialized);

      expect(parsed).toEqual(logicalResult);

      // 関数が含まれていないこと
      expect((parsed.participants.a as any).policyFactory).toBeUndefined();
      expect((parsed.participants.b as any).policyFactory).toBeUndefined();

      // 1482 重み配列が含まれていないこと
      expect(serialized).not.toContain("patternWeights");
      expect(serialized).not.toContain("contextPatternWeights");
    });
  });

  describe("E. Isolation & Failure Resiliency", () => {
    it("26. Match 間で GameSession および Policy インスタンスがすべて別オブジェクト参照 (Fresh Identity) であること", () => {
      const sessions: GameSession[] = [];
      const policiesA: DecisionPolicy[] = [];
      const policiesB: DecisionPolicy[] = [];

      const pA: PolicyExperimentParticipant = {
        id: "pA",
        name: "A",
        policyFactory: (ctx, seat) => {
          const p = BaselineParticipants.createFirstLegal().policyFactory(ctx, seat);
          policiesA.push(p);
          return p;
        },
      };

      const pB: PolicyExperimentParticipant = {
        id: "pB",
        name: "B",
        policyFactory: (ctx, seat) => {
          const p = BaselineParticipants.createRandom().policyFactory(ctx, seat);
          policiesB.push(p);
          return p;
        },
      };

      PolicyExperimentRunner.run({
        experimentId: "isolation-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 2,
        participantA: pA,
        participantB: pB,
        sessionFactory: () => {
          const s = createTestSessionFactory()();
          sessions.push(s);
          return s;
        },
      });

      // 2 matches * 2 legs = 4 sessions
      expect(sessions.length).toBe(4);
      expect(new Set(sessions).size).toBe(4);

      // 各 match ごとに fresh な Policy インスタンス
      expect(policiesA.length).toBe(4);
      expect(new Set(policiesA).size).toBe(4);

      expect(policiesB.length).toBe(4);
      expect(new Set(policiesB).size).toBe(4);

      // 同一 match 内でも A と B の Policy は別オブジェクト
      expect(policiesA[0]).not.toBe(policiesB[0]);
    });

    it("27. 特定 Match が FAILED になっても同一 Leg 内の次 Match が継続実行されること (Match Failure Isolation)", () => {
      let matchCount = 0;
      const failingFirstMatchOnly: PolicyExperimentParticipant = {
        id: "p-fail-first",
        name: "FailFirst",
        policyFactory: () => {
          matchCount++;
          if (matchCount === 1) {
            throw new Error("Failure on first match factory");
          }
          return BaselineParticipants.createFirstLegal().policyFactory({} as any, "p1");
        },
      };

      const result = PolicyExperimentRunner.run({
        experimentId: "match-isolation-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 2,
        participantA: failingFirstMatchOnly,
        participantB: BaselineParticipants.createRandom("pB", "B"),
        sessionFactory: createTestSessionFactory(),
      });

      const leg1 = result.legs[0];
      expect(leg1.matches[0].status).toBe("FAILED");
      expect(leg1.matches[1].status).not.toBe("FAILED");
    });

    it("28. Leg 1 が全滅 (FAILED) しても Leg 2 がスキップされずに完走すること (Leg Failure Isolation)", () => {
      let leg1Calls = 0;
      const failLeg1Only: PolicyExperimentParticipant = {
        id: "p-fail-leg1",
        name: "FailLeg1",
        policyFactory: (_ctx, seat) => {
          // Leg 1 では p1 = A
          if (seat === "p1") {
            leg1Calls++;
            throw new Error("Leg 1 factory failure");
          }
          return BaselineParticipants.createFirstLegal().policyFactory({} as any, seat);
        },
      };

      const result = PolicyExperimentRunner.run({
        experimentId: "leg-isolation-test",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 2,
        participantA: failLeg1Only,
        participantB: BaselineParticipants.createRandom("pB", "B"),
        sessionFactory: createTestSessionFactory(),
      });

      expect(result.legs[0].failures.length).toBe(2);
      expect(result.legs[1].summary.completedCount).toBeGreaterThan(0);
    });
  });

  describe("F. Baseline Policy Suite & Behavior Discrimination", () => {
    it("29. 4種類の Baseline Policy (FirstLegal, Random, ZeroGenome, ManualGenome) が正常実行できること", () => {
      const pFL = BaselineParticipants.createFirstLegal();
      const pRnd = BaselineParticipants.createRandom();
      const pZero = BaselineParticipants.createZeroGenome();
      const pManual = BaselineParticipants.createManualGenericGenome();

      expect(pFL.id).toBeDefined();
      expect(pRnd.id).toBeDefined();
      expect(pZero.id).toBeDefined();
      expect(pManual.id).toBeDefined();

      const result = PolicyExperimentRunner.run({
        experimentId: "baseline-suite-smoke",
        environmentRef: "rules-vnext:playtest",
        baseSeed: 42,
        matchesPerSeat: 1,
        participantA: pZero,
        participantB: pManual,
        sessionFactory: createTestSessionFactory(),
      });

      expect(result.summary.totalScheduledMatches).toBe(2);
      expect(result.summary.totalCompletedMatches).toBe(2);
    });

    it("30. Manual Generic Genome が nonzero weight を持ち、Action ID を一切使用していないこと", () => {
      const manualDNA = createManualGenericGenomeDNA();

      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      const passIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
      const effIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_effect_selection");

      expect(manualDNA.patternWeights[actIdx]).toBe(5.0);
      expect(manualDNA.patternWeights[passIdx]).toBe(-3.0);
      expect(manualDNA.patternWeights[effIdx]).toBe(5.0);

      // Action ID は不使用
      const json = JSON.stringify(manualDNA);
      expect(json).not.toContain("action.attack");
      expect(json).not.toContain("action.end");
      expect(json).not.toContain("action.block");
    });

    it("31. 制御された同一 DecisionRequest において、Zero Genome と Manual Generic Genome が異なる選択 (selectedPatternRef) を行うこと", () => {
      const zeroDNA = DecisionDNACodec.createZeroDecisionDNA();
      const manualDNA = createManualGenericGenomeDNA();

      const zeroPolicy = new GenomePolicy(zeroDNA);
      const manualPolicy = new GenomePolicy(manualDNA);

      // PASS (インデックス0) と ACTION (インデックス1) が並んだ状況
      // Zero Genome はタイブレークにより先頭のインデックス0 (PASS) を選択
      // Manual Genome は pattern_is_action (+5.0) vs pattern_is_pass (-3.0) によりインデックス1 (ACTION) を選択
      const controlledRequest: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "controlled-001",
        decisionId: "dec-controlled",
        stateVersion: 1,
        playerId: "p1",
        source: { type: "ACTION_REQUEST", playerId: "p1" },
        observation: {
          viewerPlayerId: "p1",
          turnPlayerId: "p1",
          chancePlayerId: "p1",
          players: [
            {
              playerId: "p1",
              name: "P1",
              isViewer: true,
              lifeCount: 1,
              lifeDisplay: "1",
              handCount: 0,
              handCards: [],
              fieldCount: 0,
              fieldUnits: [],
              fogCount: 0,
              fogCards: [],
              trumpCount: 0,
              trumpCards: [],
              graveCount: 0,
              graveCards: [],
            },
            {
              playerId: "p2",
              name: "P2",
              isViewer: false,
              lifeCount: 1,
              lifeDisplay: "1",
              handCount: 0,
              handCards: [],
              fieldCount: 0,
              fieldUnits: [],
              fogCount: 0,
              fogCards: [],
              trumpCount: 0,
              trumpCards: [],
              graveCount: 0,
              graveCards: [],
            },
          ],
          stageRequests: [],
        } as any,
        catalog: {
          actions: [{ actionId: "action.test", actionName: "Test", speed: "normal", timing: "main" }],
          cardSelections: [],
          unitSelections: [],
          costPayments: [],
          targetSelections: [],
          effectSelections: [],
          orderSelections: [],
        },
        patterns: [
          { patternId: "pat-pass", kind: "PASS" },
          { patternId: "pat-act", kind: "ACTION", actionSelectionRef: 0 },
        ],
      };

      const resZero = zeroPolicy.choose(controlledRequest);
      const resManual = manualPolicy.choose(controlledRequest);

      expect(resZero.selectedPatternRef).toBe(0); // PASS
      expect(resManual.selectedPatternRef).toBe(1); // ACTION
      expect(resZero.selectedPatternRef).not.toBe(resManual.selectedPatternRef);
    });
  });
});
