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
import { StateHasher } from "../../engine/simulation/StateHasher";

describe("AI Self-Play Foundation, Decision Trace v1 & State Hash Tests (BP-SIM-AI-1.1-20260903-2216)", () => {
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
  // 2. StateHasher Unit Tests
  // --------------------------------------------------------------------------
  describe("StateHasher Deterministic Logical State Hash Tests", () => {
    const baseState = {
      presetId: "TEST-001",
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stateVersion: 5,
      players: {
        p1: {
          name: "Player A",
          life: [{ suit: "S", rank: "A", value: 1 }],
          hand: [{ suit: "H", rank: "7", value: 7 }],
          field: [
            {
              unitId: "u1",
              componentId: "soldier",
              kind: "一般兵",
              state: "charge",
              face: "up",
              cards: [{ suit: "S", rank: "6", value: 6 }],
              labels: ["soldier"],
            },
          ],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [{ suit: "H", rank: "2", value: 2 }],
          hand: [{ suit: "D", rank: "K", value: 13 }],
          field: [],
          fog: [],
          grave: [],
        },
      },
      stage: {
        requests: [
          {
            id: "req-1",
            actionId: "action.attack",
            controller: "p1",
            status: "open",
            sequence: 1,
          },
        ],
      },
    };

    // ケース A: 同じ論理 GameState を deep clone したもの -> 同一 Hash
    it("produces identical hash for deep-cloned state", () => {
      const cloned = JSON.parse(JSON.stringify(baseState));
      const hash1 = StateHasher.hash(baseState);
      const hash2 = StateHasher.hash(cloned);

      expect(hash1).toBe(hash2);
      expect(hash1.startsWith("sh1-")).toBe(true);
    });

    // ケース B: object property の挿入順序が異なるが論理内容が同一 -> 同一 Hash
    it("produces identical hash regardless of object key insertion order", () => {
      const reorderedState = {
        stateVersion: 5,
        turnPlayer: "p1",
        stage: {
          requests: [
            {
              sequence: 1,
              status: "open",
              controller: "p1",
              actionId: "action.attack",
              id: "req-1",
            },
          ],
        },
        chancePlayer: "p1",
        presetId: "TEST-001",
        players: {
          p2: {
            field: [],
            grave: [],
            fog: [],
            hand: [{ value: 13, suit: "D", rank: "K" }],
            life: [{ value: 2, rank: "2", suit: "H" }],
            name: "Player B",
          },
          p1: {
            fog: [],
            life: [{ suit: "S", value: 1, rank: "A" }],
            grave: [],
            name: "Player A",
            hand: [{ rank: "7", value: 7, suit: "H" }],
            field: [
              {
                labels: ["soldier"],
                cards: [{ rank: "6", suit: "S", value: 6 }],
                face: "up",
                state: "charge",
                kind: "一般兵",
                componentId: "soldier",
                unitId: "u1",
              },
            ],
          },
        },
        turnCount: 1,
      };

      const hash1 = StateHasher.hash(baseState);
      const hash2 = StateHasher.hash(reorderedState);

      expect(hash1).toBe(hash2);
    });

    // ケース C: 論理状態の変更で Hash が変化する
    it("produces different hash when logical state changes", () => {
      const hashBase = StateHasher.hash(baseState);

      // turnPlayer 変更
      const modifiedTurn = { ...baseState, turnPlayer: "p2" };
      expect(StateHasher.hash(modifiedTurn)).not.toBe(hashBase);

      // ライフ変更
      const modifiedLife = {
        ...baseState,
        players: {
          ...baseState.players,
          p1: {
            ...baseState.players.p1,
            life: [], // 0枚
          },
        },
      };
      expect(StateHasher.hash(modifiedLife)).not.toBe(hashBase);

      // Stage Requests 変更
      const modifiedStage = {
        ...baseState,
        stage: { requests: [] },
      };
      expect(StateHasher.hash(modifiedStage)).not.toBe(hashBase);
    });

    // ケース D: 除外対象 (タイムスタンプ・UI状態など) の違いでは Hash が変わらない
    it("produces identical hash when non-logical runtime properties differ", () => {
      const stateWithUi = {
        ...baseState,
        timestamp: 1788360000000,
        uiSelection: "selected-1",
        renderCount: 42,
      };

      const stateWithOtherUi = {
        ...baseState,
        timestamp: 1788399999999,
        uiSelection: "selected-2",
        renderCount: 99,
      };

      const hash1 = StateHasher.hash(stateWithUi);
      const hash2 = StateHasher.hash(stateWithOtherUi);

      expect(hash1).toBe(hash2);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Decision Trace v1 & Deterministic Re-execution
  // --------------------------------------------------------------------------
  describe("Decision Trace v1 & Deterministic Re-execution Tests", () => {
    it("produces identical Decision Trace v1 and state hashes for identical seeds", () => {
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

      // 1. Decision Trace Format Version
      expect(result1.decisionTraceVersion).toBe(1);
      expect(result2.decisionTraceVersion).toBe(1);

      // 2. 勝敗・ターン数・判断回数の一致
      expect(result1.completed).toBe(result2.completed);
      expect(result1.winner).toBe(result2.winner);
      expect(result1.reason).toBe(result2.reason);
      expect(result1.totalDecisions).toBe(result2.totalDecisions);
      expect(result1.turnCount).toBe(result2.turnCount);

      // 3. Final State Hash の一致
      expect(result1.finalStateHash).toBeDefined();
      expect(result1.finalStateHash).toBe(result2.finalStateHash);

      // 4. 各ステップの Decision Trace Record (stateHash, legalPatterns, policyDescriptor, selectedPatternRef) の完全一致
      expect(result1.decisionTrace.length).toBeGreaterThan(0);
      expect(result1.decisionTrace.length).toBe(result2.decisionTrace.length);

      for (let i = 0; i < result1.decisionTrace.length; i++) {
        const rec1 = result1.decisionTrace[i];
        const rec2 = result2.decisionTrace[i];

        expect(rec1.stepCount).toBe(rec2.stepCount);
        expect(rec1.playerId).toBe(rec2.playerId);
        expect(rec1.stateVersion).toBe(rec2.stateVersion);

        // State Hash の一致 (意思決定直前の論理状態の一致)
        expect(rec1.stateHash).toBe(rec2.stateHash);
        expect(rec1.stateHash.startsWith("sh1-")).toBe(true);

        // 選択可能パターンの完全一致
        expect(rec1.legalPatterns).toEqual(rec2.legalPatterns);

        // 選択されたパターンの一致
        expect(rec1.selectedPatternRef).toBe(rec2.selectedPatternRef);
        expect(rec1.selectedPatternKind).toBe(rec2.selectedPatternKind);
        expect(rec1.actionId).toBe(rec2.actionId);

        // Policy 記述子の一致
        expect(rec1.policyDescriptor).toEqual(rec2.policyDescriptor);
      }
    });

    it("produces different state hashes and decision traces for different seeds", () => {
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

      const hashesA = resultA.decisionTrace.map((t) => t.stateHash);
      const hashesB = resultB.decisionTrace.map((t) => t.stateHash);

      expect(hashesA).not.toEqual(hashesB);
    });
  });

  // --------------------------------------------------------------------------
  // 4. AI Secret Information Isolation in Decision Trace
  // --------------------------------------------------------------------------
  describe("AI Policy Observation & Decision Trace Secret Information Isolation", () => {
    it("Decision Trace does not leak opponent raw secrets into JSON trace", () => {
      const state = createCoreBattlePresetState();
      // 相手手札に秘密カードを明示的に注入
      state.players.p2.hand = [
        { id: "super-secret-card-1", suit: "S", rank: "A", value: 1, code: "SA" },
      ];

      const session = new GameSession(state, playtestRulePackage);
      const policies = {
        p1: new FirstLegalPolicy(),
        p2: new FirstLegalPolicy(),
      };

      const result = SimulationRunner.run(session, policies, { maxDecisions: 10 });
      const traceJson = JSON.stringify(result.decisionTrace);

      // Decision Trace に相手の手札秘密情報が含まれていないこと
      expect(traceJson).not.toContain("super-secret-card-1");
      expect(traceJson).not.toContain('"code":"SA"');
    });
  });
});
