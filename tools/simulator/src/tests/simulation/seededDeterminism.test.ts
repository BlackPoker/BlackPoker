import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { SeededRandom } from "../../engine/random/RandomSource";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { RandomPolicy, FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

describe("AI Self-Play Foundation & Seeded Determinism Tests (BP-SIM-AI-1.0-20260903-0029)", () => {
  let playtestRulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    playtestRulePackage = getPlaytestRulePackage(fullPackage);
  });

  // --------------------------------------------------------------------------
  // 1. SeededRandom PRNG Determinism
  // --------------------------------------------------------------------------
  describe("SeededRandom PRNG Tests", () => {
    it("generates identical sequence for the same seed", () => {
      const rng1 = new SeededRandom(12345);
      const rng2 = new SeededRandom(12345);

      const seq1 = Array.from({ length: 100 }, () => rng1.next());
      const seq2 = Array.from({ length: 100 }, () => rng2.next());

      expect(seq1).toEqual(seq2);
    });

    it("generates different sequences for different seeds", () => {
      const rng1 = new SeededRandom(12345);
      const rng2 = new SeededRandom(67890);

      const seq1 = Array.from({ length: 20 }, () => rng1.next());
      const seq2 = Array.from({ length: 20 }, () => rng2.next());

      expect(seq1).not.toEqual(seq2);
    });

    it("nextInt produces values strictly within [min, max]", () => {
      const rng = new SeededRandom(42);
      for (let i = 0; i < 200; i++) {
        const val = rng.nextInt(3, 7);
        expect(val).toBeGreaterThanOrEqual(3);
        expect(val).toBeLessThanOrEqual(7);
      }
    });

    it("choice selects items deterministically", () => {
      const items = ["A", "B", "C", "D", "E"];
      const rng1 = new SeededRandom(999);
      const rng2 = new SeededRandom(999);

      const choices1 = Array.from({ length: 20 }, () => rng1.choice(items));
      const choices2 = Array.from({ length: 20 }, () => rng2.choice(items));

      expect(choices1).toEqual(choices2);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Deterministic Match Replay
  // --------------------------------------------------------------------------
  describe("Deterministic Match Replay Tests", () => {
    it("produces 100% identical decision traces and final outcomes for identical seeds", () => {
      const SEED_P1 = 1001;
      const SEED_P2 = 2002;

      // Run 1
      const state1 = createCoreBattlePresetState();
      const session1 = new GameSession(state1, playtestRulePackage);
      const policies1 = {
        p1: new RandomPolicy(new SeededRandom(SEED_P1)),
        p2: new RandomPolicy(new SeededRandom(SEED_P2)),
      };
      const result1 = SimulationRunner.run(session1, policies1, { maxDecisions: 150 });

      // Run 2 (Same Seeds)
      const state2 = createCoreBattlePresetState();
      const session2 = new GameSession(state2, playtestRulePackage);
      const policies2 = {
        p1: new RandomPolicy(new SeededRandom(SEED_P1)),
        p2: new RandomPolicy(new SeededRandom(SEED_P2)),
      };
      const result2 = SimulationRunner.run(session2, policies2, { maxDecisions: 150 });

      // 検証: 勝敗・ターン数・判断回数の一致
      expect(result1.completed).toBe(result2.completed);
      expect(result1.winner).toBe(result2.winner);
      expect(result1.reason).toBe(result2.reason);
      expect(result1.totalDecisions).toBe(result2.totalDecisions);
      expect(result1.turnCount).toBe(result2.turnCount);

      // 検証: 論理決定列 (タイムスタンプ・runtimeIdを除く各ステップの選択パターン・アクション) の完全一致
      const logicalTrace1 = result1.decisionTrace.map((t) => ({
        stepCount: t.stepCount,
        playerId: t.playerId,
        stateVersion: t.stateVersion,
        selectedPatternRef: t.selectedPatternRef,
        patternKind: t.patternKind,
        actionId: t.actionId,
        policyKind: t.policyKind,
      }));

      const logicalTrace2 = result2.decisionTrace.map((t) => ({
        stepCount: t.stepCount,
        playerId: t.playerId,
        stateVersion: t.stateVersion,
        selectedPatternRef: t.selectedPatternRef,
        patternKind: t.patternKind,
        actionId: t.actionId,
        policyKind: t.policyKind,
      }));

      expect(logicalTrace1.length).toBeGreaterThan(0);
      expect(logicalTrace1).toEqual(logicalTrace2);

      // 検証: 最終ライフ・盤面状態の完全一致
      expect(result1.finalState.players.p1.life.length).toBe(result2.finalState.players.p1.life.length);
      expect(result1.finalState.players.p2.life.length).toBe(result2.finalState.players.p2.life.length);
    });

    it("produces different decision sequences for different seeds", () => {
      const stateA = createCoreBattlePresetState();
      const sessionA = new GameSession(stateA, playtestRulePackage);
      const policiesA = {
        p1: new RandomPolicy(new SeededRandom(111)),
        p2: new RandomPolicy(new SeededRandom(222)),
      };
      const resultA = SimulationRunner.run(sessionA, policiesA, { maxDecisions: 150 });

      const stateB = createCoreBattlePresetState();
      const sessionB = new GameSession(stateB, playtestRulePackage);
      const policiesB = {
        p1: new RandomPolicy(new SeededRandom(888)),
        p2: new RandomPolicy(new SeededRandom(999)),
      };
      const resultB = SimulationRunner.run(sessionB, policiesB, { maxDecisions: 150 });

      // 異なるシードでは Decision 列が異なること
      const traceA = resultA.decisionTrace.map((t) => t.selectedPatternRef);
      const traceB = resultB.decisionTrace.map((t) => t.selectedPatternRef);
      expect(traceA).not.toEqual(traceB);
    });
  });

  // --------------------------------------------------------------------------
  // 3. AI Secret Information Isolation
  // --------------------------------------------------------------------------
  describe("AI Policy Observation & Secret Information Isolation", () => {
    it("AI policy only receives legal DecisionRequest and never receives raw GameState secrets", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, playtestRulePackage);

      let capturedRequest: DecisionRequest | undefined;

      // Request を監視する Policy
      const spyingPolicy = {
        descriptor: { kind: "spy", policyVersion: 1 },
        choose(req: Readonly<DecisionRequest>) {
          capturedRequest = req;
          return {
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: 0,
          };
        },
      };

      SimulationRunner.run(session, { p1: spyingPolicy, p2: new FirstLegalPolicy() }, { maxDecisions: 1 });

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest?.decisionId).toBeDefined();
      expect(capturedRequest?.patterns).toBeDefined();

      // observation が存在する場合、相手の秘密情報が漏洩していないこと
      if (capturedRequest?.observation) {
        const p2Obs = capturedRequest.observation.players.find((p) => p.playerId === "p2");
        if (p2Obs) {
          // 相手手札は HIDDEN
          expect(p2Obs.handCards[0].visibility).toBe("HIDDEN");
          expect((p2Obs.handCards[0] as any).suit).toBeUndefined();
        }
      }
    });
  });
});
