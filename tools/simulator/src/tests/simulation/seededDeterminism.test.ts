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
import { StateHasher } from "../../engine/simulation/StateHasher";

describe("AI Self-Play Foundation, State Hash v2 & Decision Trace v2 Tests (BP-SIM-AI-1.1.2-20260903-2355)", () => {
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
  // 2. StateHasher (State Hash v2) Formal Target, Cost, Bindings & Event Tests
  // --------------------------------------------------------------------------
  describe("StateHasher Deterministic Logical State Hash v2 Tests", () => {
    const baseState = {
      presetId: "TEST-001",
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stateVersion: 5,
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "c1", suit: "S", rank: "A", value: 1 }],
          hand: [{ id: "c2", suit: "H", rank: "7", value: 7 }],
          field: [
            {
              unitId: "u1",
              componentId: "soldier",
              kind: "一般兵",
              state: "charge",
              face: "up",
              cards: [{ id: "c3", suit: "S", rank: "6", value: 6 }],
              labels: ["soldier"],
              battle: {
                role: "attacker",
                targetPlayerKey: "p2",
              },
            },
          ],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [{ id: "c4", suit: "H", rank: "2", value: 2 }],
          hand: [{ id: "c5", suit: "D", rank: "K", value: 13 }],
          field: [
            {
              unitId: "u2",
              componentId: "bulwark",
              kind: "防壁",
              state: "charge",
              face: "down",
              cards: [{ id: "c6", suit: "H", rank: "5", value: 5 }],
              labels: ["bulwark"],
              battle: {
                role: "blocker",
                blocksUnitId: "u1",
              },
            },
          ],
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
            keyCards: [{ id: "c7", suit: "S", rank: "6", value: 6 }],
            targets: [{ type: "unit", unitId: "u1", kind: "一般兵", componentId: "soldier" }],
          },
        ],
      },
      requestBuffer: {
        requests: [],
      },
    };

    it("produces identical hash (sh2-...) for deep-cloned state", () => {
      const cloned = JSON.parse(JSON.stringify(baseState));
      const hash1 = StateHasher.hash(baseState);
      const hash2 = StateHasher.hash(cloned);

      expect(hash1).toBe(hash2);
      expect(hash1.startsWith("sh2-")).toBe(true);
      expect(StateHasher.VERSION).toBe(2);
    });

    it("produces identical hash regardless of object key insertion order", () => {
      const reorderedState = {
        stateVersion: 5,
        turnPlayer: "p1",
        stage: {
          requests: [
            {
              sequence: 1,
              targets: [{ componentId: "soldier", kind: "一般兵", unitId: "u1", type: "unit" }],
              status: "open",
              controller: "p1",
              actionId: "action.attack",
              id: "req-1",
              keyCards: [{ value: 6, rank: "6", suit: "S", id: "c7" }],
            },
          ],
        },
        requestBuffer: { requests: [] },
        chancePlayer: "p1",
        presetId: "TEST-001",
        players: {
          p2: {
            field: [
              {
                battle: { blocksUnitId: "u1", role: "blocker" },
                labels: ["bulwark"],
                face: "down",
                cards: [{ id: "c6", rank: "5", suit: "H", value: 5 }],
                state: "charge",
                kind: "防壁",
                componentId: "bulwark",
                unitId: "u2",
              },
            ],
            grave: [],
            fog: [],
            hand: [{ value: 13, suit: "D", rank: "K", id: "c5" }],
            life: [{ value: 2, rank: "2", suit: "H", id: "c4" }],
            name: "Player B",
          },
          p1: {
            fog: [],
            life: [{ suit: "S", value: 1, rank: "A", id: "c1" }],
            grave: [],
            name: "Player A",
            hand: [{ rank: "7", value: 7, suit: "H", id: "c2" }],
            field: [
              {
                battle: { targetPlayerKey: "p2", role: "attacker" },
                labels: ["soldier"],
                cards: [{ rank: "6", suit: "S", value: 6, id: "c3" }],
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

    // 56.A: player target p1 / p2 -> 異なる Hash
    it("produces different hash when player target points to p1 vs p2", () => {
      const stateTargetP1 = JSON.parse(JSON.stringify(baseState));
      stateTargetP1.stage.requests[0].targets = [{ type: "player", targetPlayerKey: "p1" }];

      const stateTargetP2 = JSON.parse(JSON.stringify(baseState));
      stateTargetP2.stage.requests[0].targets = [{ type: "player", targetPlayerKey: "p2" }];

      expect(StateHasher.hash(stateTargetP1)).not.toBe(StateHasher.hash(stateTargetP2));
    });

    // 56.B: unit target 参照先違い -> 異なる Hash
    it("produces different hash when unit target points to u1 vs u2", () => {
      const stateTargetU1 = JSON.parse(JSON.stringify(baseState));
      stateTargetU1.stage.requests[0].targets = [{ type: "unit", unitId: "u1", kind: "一般兵" }];

      const stateTargetU2 = JSON.parse(JSON.stringify(baseState));
      stateTargetU2.stage.requests[0].targets = [{ type: "unit", unitId: "u2", kind: "防壁" }];

      expect(StateHasher.hash(stateTargetU1)).not.toBe(StateHasher.hash(stateTargetU2));
    });

    // 56.C: request target 参照先違い -> 異なる Hash
    it("produces different hash when request target points to req-A vs req-B", () => {
      const stateTargetReqA = JSON.parse(JSON.stringify(baseState));
      stateTargetReqA.stage.requests[0].targets = [{ type: "request", requestId: "req-A", actionId: "action.attack" }];

      const stateTargetReqB = JSON.parse(JSON.stringify(baseState));
      stateTargetReqB.stage.requests[0].targets = [{ type: "request", requestId: "req-B", actionId: "action.block" }];

      expect(StateHasher.hash(stateTargetReqA)).not.toBe(StateHasher.hash(stateTargetReqB));
    });

    // 56.D: CostPayment runtime ID 違い・論理同一 -> 同 Hash
    it("produces identical hash when CostPayment has different runtime IDs pointing to identical logical topology", () => {
      const stateCost1 = JSON.parse(JSON.stringify(baseState));
      stateCost1.stage.requests[0].selectedCostPayment = {
        lifeCount: 0,
        discardedCardIds: ["card-runtime-1788442924001-c1"],
        drivenBulwarkUnitIds: ["unit-runtime-1788442924001-u1"],
        sacrificedUnitIds: [],
        summary: "$D (♣4 破棄)",
      };

      const stateCost2 = JSON.parse(JSON.stringify(baseState));
      stateCost2.stage.requests[0].selectedCostPayment = {
        lifeCount: 0,
        discardedCardIds: ["card-runtime-1788999999991-c1"],
        drivenBulwarkUnitIds: ["unit-runtime-1788999999991-u1"],
        sacrificedUnitIds: [],
        summary: "表示テキストが異なっていても除外される",
      };

      expect(StateHasher.hash(stateCost1)).toBe(StateHasher.hash(stateCost2));
    });

    // 56.E: CostPayment 選択対象違い -> 異 Hash
    it("produces different hash when CostPayment selects different card count or unit", () => {
      const stateCostA = JSON.parse(JSON.stringify(baseState));
      stateCostA.stage.requests[0].selectedCostPayment = {
        lifeCount: 1,
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
      };

      const stateCostB = JSON.parse(JSON.stringify(baseState));
      stateCostB.stage.requests[0].selectedCostPayment = {
        lifeCount: 2,
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
      };

      expect(StateHasher.hash(stateCostA)).not.toBe(StateHasher.hash(stateCostB));
    });

    // 56.F: nested triggerBindings runtime IDs 差のみ -> 同 Hash
    it("produces identical hash when nested triggerBindings contain different runtime IDs of same topology", () => {
      const stateBind1 = JSON.parse(JSON.stringify(baseState));
      stateBind1.requestBuffer.requests = [
        {
          id: "buf-1",
          actionId: "action.draw",
          controller: "p1",
          sequence: 1,
          triggerBindings: {
            attacker: {
              unitId: "unit-runtime-1788442924001-abc",
            },
            contextId: "fixed-ctx",
          },
        },
      ];

      const stateBind2 = JSON.parse(JSON.stringify(baseState));
      stateBind2.requestBuffer.requests = [
        {
          id: "buf-1",
          actionId: "action.draw",
          controller: "p1",
          sequence: 1,
          triggerBindings: {
            attacker: {
              unitId: "unit-runtime-1788999999991-xyz",
            },
            contextId: "fixed-ctx",
          },
        },
      ];

      expect(StateHasher.hash(stateBind1)).toBe(StateHasher.hash(stateBind2));
    });

    // 56.G: sourceEvent runtime timestamp 差のみ -> 同 Hash
    it("produces identical hash when sourceEvent has different timestamp/createdAt", () => {
      const stateEvt1 = JSON.parse(JSON.stringify(baseState));
      stateEvt1.requestBuffer.requests = [
        {
          id: "buf-1",
          actionId: "action.draw",
          controller: "p1",
          sequence: 1,
          sourceEvent: {
            type: "cardMoved",
            name: "draw",
            payload: {
              fromZone: "life",
              toZone: "hand",
              timestamp: 1788442924000,
              createdAt: 1788442924000,
            },
          },
        },
      ];

      const stateEvt2 = JSON.parse(JSON.stringify(baseState));
      stateEvt2.requestBuffer.requests = [
        {
          id: "buf-1",
          actionId: "action.draw",
          controller: "p1",
          sequence: 1,
          sourceEvent: {
            type: "cardMoved",
            name: "draw",
            payload: {
              fromZone: "life",
              toZone: "hand",
              timestamp: 1788999999999,
              createdAt: 1788999999999,
            },
          },
        },
      ];

      expect(StateHasher.hash(stateEvt1)).toBe(StateHasher.hash(stateEvt2));
    });

    // 56.H: sourceEvent gameplay-relevant payload 差 -> 異 Hash
    it("produces different hash when sourceEvent has different gameplay payload (fromZone)", () => {
      const stateEvtA = JSON.parse(JSON.stringify(baseState));
      stateEvtA.requestBuffer.requests = [
        {
          id: "buf-1",
          actionId: "action.draw",
          controller: "p1",
          sequence: 1,
          sourceEvent: {
            type: "cardMoved",
            payload: { fromZone: "life", toZone: "hand" },
          },
        },
      ];

      const stateEvtB = JSON.parse(JSON.stringify(baseState));
      stateEvtB.requestBuffer.requests = [
        {
          id: "buf-1",
          actionId: "action.draw",
          controller: "p1",
          sequence: 1,
          sourceEvent: {
            type: "cardMoved",
            payload: { fromZone: "deck", toZone: "hand" },
          },
        },
      ];

      expect(StateHasher.hash(stateEvtA)).not.toBe(StateHasher.hash(stateEvtB));
    });

    it("produces different hash when Stage LIFO order is inverted", () => {
      const reqA = { id: "req-A", actionId: "action.attack", controller: "p1", sequence: 1 };
      const reqB = { id: "req-B", actionId: "action.block", controller: "p2", sequence: 2 };

      const stateOrderAB = {
        ...baseState,
        stage: { requests: [reqA, reqB] },
      };

      const stateOrderBA = {
        ...baseState,
        stage: { requests: [reqB, reqA] },
      };

      expect(StateHasher.hash(stateOrderAB)).not.toBe(StateHasher.hash(stateOrderBA));
    });
  });

  // --------------------------------------------------------------------------
  // 3. Decision Trace v2 & Deterministic Re-execution Tests
  // --------------------------------------------------------------------------
  describe("Decision Trace v2 & Deterministic Re-execution Tests", () => {
    it("produces identical Decision Trace v2, logicalDecisionId, logicalPatternKey and state hashes (sh2) for identical seeds", () => {
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

      // 57.A: Decision Trace Version = 2
      expect(result1.decisionTraceVersion).toBe(2);
      expect(result2.decisionTraceVersion).toBe(2);

      // 勝敗・ターン数・判断回数の一致
      expect(result1.completed).toBe(result2.completed);
      expect(result1.winner).toBe(result2.winner);
      expect(result1.reason).toBe(result2.reason);
      expect(result1.totalDecisions).toBe(result2.totalDecisions);
      expect(result1.turnCount).toBe(result2.turnCount);

      // Final State Hash の一致 (sh2-...)
      expect(result1.finalStateHash).toBeDefined();
      expect(result1.finalStateHash?.startsWith("sh2-")).toBe(true);
      expect(result1.finalStateHash).toBe(result2.finalStateHash);

      // Decision Trace レコードの検証
      expect(result1.decisionTrace.length).toBeGreaterThan(0);
      expect(result1.decisionTrace.length).toBe(result2.decisionTrace.length);

      for (let i = 0; i < result1.decisionTrace.length; i++) {
        const rec1 = result1.decisionTrace[i];
        const rec2 = result2.decisionTrace[i];

        expect(rec1.stepCount).toBe(rec2.stepCount);
        expect(rec1.playerId).toBe(rec2.playerId);
        expect(rec1.stateVersion).toBe(rec2.stateVersion);

        // 57.B, 57.C: logicalDecisionId が存在し、同一 seed で完全一致
        expect(rec1.logicalDecisionId).toBeDefined();
        expect(rec1.logicalDecisionId.startsWith("d2-")).toBe(true);
        expect(rec1.logicalDecisionId).toBe(rec2.logicalDecisionId);

        // 57.D: runtimeDecisionId は GameSession 照合用として存在確認 (決定論的一致は要求しない)
        expect(rec1.runtimeDecisionId).toBeDefined();
        expect(rec2.runtimeDecisionId).toBeDefined();

        // State Hash v2 の一致
        expect(rec1.stateHash).toBe(rec2.stateHash);
        expect(rec1.stateHash.startsWith("sh2-")).toBe(true);

        // 57.E: 全 legal pattern に logicalPatternKey が存在
        for (const lp of rec1.legalPatterns) {
          expect(lp.logicalPatternKey).toBeDefined();
          expect(typeof lp.logicalPatternKey).toBe("string");
        }

        // 57.F, 57.G: selectedLogicalPatternKey が候補内に存在し、同一 seed で一致
        expect(rec1.selectedLogicalPatternKey).toBeDefined();
        expect(rec1.selectedLogicalPatternKey).toBe(rec2.selectedLogicalPatternKey);
        const matchingLp = rec1.legalPatterns.find(
          (lp) => lp.patternRef === rec1.selectedPatternRef
        );
        expect(matchingLp?.logicalPatternKey).toBe(rec1.selectedLogicalPatternKey);

        // 選択されたパターン種別と Policy 記述子の一致
        expect(rec1.selectedPatternKind).toBe(rec2.selectedPatternKind);
        expect(rec1.policyDescriptor).toEqual(rec2.policyDescriptor);
      }
    });

    // 57.H, 57.I: 実際の EFFECT_SELECTION record が 1 件以上存在し、effectSelectionRef / logicalPatternKey があること
    it("reaches real EFFECT_SELECTION records in gameplay and preserves effectSelectionRef and logicalPatternKey", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, playtestRulePackage);
      const policies = {
        p1: new FirstLegalPolicy(),
        p2: new FirstLegalPolicy(),
      };

      const result = SimulationRunner.run(session, policies, { maxDecisions: 100 });

      // EFFECT_SELECTION のレコードを抽出
      const effectRecords = result.decisionTrace.filter(
        (rec) =>
          rec.selectedPatternKind === "EFFECT_SELECTION" ||
          rec.legalPatterns.some((lp) => lp.kind === "EFFECT_SELECTION")
      );

      // 57.H: EFFECT_SELECTION が実際に 1 件以上発生していることを assert
      expect(effectRecords.length).toBeGreaterThan(0);

      // 57.I: effectSelectionRef と logicalPatternKey の存在確認
      for (const rec of effectRecords) {
        for (const lp of rec.legalPatterns) {
          if (lp.kind === "EFFECT_SELECTION") {
            expect(lp.effectSelectionRef).toBeDefined();
            expect(lp.logicalPatternKey).toContain("EFFECT_SELECTION");
            expect(lp.logicalPatternKey).toContain(`e=${lp.effectSelectionRef}`);
          }
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // 4. AI Secret Information Isolation in Decision Trace (57.J)
  // --------------------------------------------------------------------------
  describe("AI Policy Observation & Decision Trace Secret Information Isolation", () => {
    it("Decision Trace does not leak opponent raw secrets (hand, bulwark, life identities) into JSON trace", () => {
      const state = createCoreBattlePresetState();
      state.players.p2.hand = [
        { id: "super-secret-hand-SA", suit: "S", rank: "A", value: 1, code: "SA" },
      ];
      state.players.p2.field = [
        {
          unitId: "secret-bulwark-unit",
          componentId: "bulwark",
          kind: "防壁",
          state: "charge",
          face: "down",
          cards: [{ id: "super-secret-bulwark-HK", suit: "H", rank: "K", value: 13, code: "HK" }],
        },
      ];
      state.players.p2.life = [
        { id: "super-secret-life-DQ", suit: "D", rank: "Q", value: 12, code: "DQ" },
      ];

      const session = new GameSession(state, playtestRulePackage);
      const policies = {
        p1: new FirstLegalPolicy(),
        p2: new FirstLegalPolicy(),
      };

      const result = SimulationRunner.run(session, policies, { maxDecisions: 10 });
      const traceJson = JSON.stringify(result.decisionTrace);

      // Decision Trace に相手の手札・防壁・Life秘密情報が含まれていないこと
      expect(traceJson).not.toContain("super-secret-hand-SA");
      expect(traceJson).not.toContain("super-secret-bulwark-HK");
      expect(traceJson).not.toContain("super-secret-life-DQ");
    });
  });
});
