import { describe, it, expect } from "vitest";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import { createSeatControllers } from "../../engine/playtest/PlaytestSeatController";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

describe("PlaytestPolicyFactory Tests", () => {
  describe("1. Policy インスタンスの生成", () => {
    it("FirstLegalPolicy が正常に生成されること", () => {
      const policy = PlaytestPolicyFactory.createPolicy("firstLegal", undefined, "p2");
      expect(policy).toBeDefined();
      expect(policy.descriptor.kind).toBe("firstLegal");
    });

    it("SeededRandom が有効な matchSeed で正常に生成されること", () => {
      const policy = PlaytestPolicyFactory.createPolicy("seededRandom", 20260907, "p2");
      expect(policy).toBeDefined();
      expect(policy.descriptor.kind).toBe("random");
      expect(policy.descriptor.name).toBe("SeededRandom-p2");
    });

    it("ManualGenericGenome が正常に生成されること", () => {
      const policy = PlaytestPolicyFactory.createPolicy("manualGenericGenome", undefined, "p2");
      expect(policy).toBeDefined();
      expect(policy.descriptor.kind).toBe("genome");
      expect(policy.descriptor.name).toBe("ManualGenericGenome");
    });

    it("ZeroGenome が正常に生成されること", () => {
      const policy = PlaytestPolicyFactory.createPolicy("zeroGenome", undefined, "p2");
      expect(policy).toBeDefined();
      expect(policy.descriptor.kind).toBe("genome");
      expect(policy.descriptor.name).toBe("ZeroGenome");
    });

    it("未知の policyId の場合は fail-fast すること", () => {
      expect(() => PlaytestPolicyFactory.createPolicy("unknown" as any, 12345, "p2")).toThrow(
        /Unknown PlaytestPolicyId/
      );
    });
  });

  describe("2. SeededRandom の厳格シード制約 (暗黙 fallback 禁止)", () => {
    it("matchSeed が undefined の場合 fail-fast すること (Core Battle 等)", () => {
      expect(() => PlaytestPolicyFactory.createPolicy("seededRandom", undefined, "p2")).toThrow(
        /SeededRandom policy requires a valid match seed/
      );
    });

    it("matchSeed が NaN または非有限数の場合 fail-fast すること", () => {
      expect(() => PlaytestPolicyFactory.createPolicy("seededRandom", NaN, "p2")).toThrow(
        /SeededRandom policy requires a valid match seed/
      );
    });
  });

  describe("3. 決定論的シード導出と再現性", () => {
    it("同一 matchSeed かつ同一 seat から導出される seed は完全に一致すること", () => {
      const seed1 = PlaytestPolicyFactory.derivePolicySeed(42, "p2");
      const seed2 = PlaytestPolicyFactory.derivePolicySeed(42, "p2");
      expect(seed1).toBe(seed2);
    });

    it("異なる seat または異なる matchSeed からは異なる seed が導出されること", () => {
      const seedP1 = PlaytestPolicyFactory.derivePolicySeed(42, "p1");
      const seedP2 = PlaytestPolicyFactory.derivePolicySeed(42, "p2");
      const seedOtherMatch = PlaytestPolicyFactory.derivePolicySeed(43, "p2");

      expect(seedP1).not.toBe(seedP2);
      expect(seedP2).not.toBe(seedOtherMatch);
    });

    it("同一 matchSeed の SeededRandom は同一の判断列を再現すること", () => {
      const policyA = PlaytestPolicyFactory.createPolicy("seededRandom", 12345, "p2");
      const policyB = PlaytestPolicyFactory.createPolicy("seededRandom", 12345, "p2");

      const dummyRequest: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "test-match",
        catalog: {} as any,
        decisionId: "req-1",
        stateVersion: 1,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        observation: {} as any,
        patterns: [
          { patternRef: 0, patternId: "p0", kind: "ACTION" } as any,
          { patternRef: 1, patternId: "p1", kind: "ACTION" } as any,
          { patternRef: 2, patternId: "p2", kind: "ACTION" } as any,
          { patternRef: 3, patternId: "p3", kind: "PASS" } as any,
        ],
      };

      const choicesA: number[] = [];
      const choicesB: number[] = [];

      for (let i = 0; i < 20; i++) {
        choicesA.push(policyA.choose(dummyRequest).selectedPatternRef);
        choicesB.push(policyB.choose(dummyRequest).selectedPatternRef);
      }

      expect(choicesA).toEqual(choicesB);
    });
  });

  describe("4. createPoliciesForMatch", () => {
    it("Human vs AI (p1=Human, p2=AI) の場合 p2 のみ Policy が生成されること", () => {
      const seatControllers = createSeatControllers("humanVsAi", "p1", "firstLegal");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers);

      expect(policies.p1).toBeUndefined();
      expect(policies.p2).toBeDefined();
      expect(policies.p2.descriptor.kind).toBe("firstLegal");
    });

    it("Human vs AI (p1=AI, p2=Human) の場合 p1 のみ Policy が生成されること", () => {
      const seatControllers = createSeatControllers("humanVsAi", "p2", "manualGenericGenome");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers);

      expect(policies.p1).toBeDefined();
      expect(policies.p1.descriptor.kind).toBe("genome");
      expect(policies.p2).toBeUndefined();
    });

    it("Human vs Human の場合 Policy は生成されないこと", () => {
      const seatControllers = createSeatControllers("humanVsHuman");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers);

      expect(policies.p1).toBeUndefined();
      expect(policies.p2).toBeUndefined();
    });
  });
});
