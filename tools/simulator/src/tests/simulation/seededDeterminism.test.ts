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

describe("AI Self-Play Foundation, State Hash v2 & Decision Trace v1 Tests (BP-SIM-AI-1.1.1-20260903-2311)", () => {
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
  // 2. StateHasher (State Hash v2) Unit Tests
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
            targets: [{ kind: "unit", unitId: "u1" }],
          },
        ],
      },
      requestBuffer: {
        requests: [],
      },
    };

    // A. 同一 Logical State deep clone -> 同一 sh2
    it("produces identical hash (sh2-...) for deep-cloned state", () => {
      const cloned = JSON.parse(JSON.stringify(baseState));
      const hash1 = StateHasher.hash(baseState);
      const hash2 = StateHasher.hash(cloned);

      expect(hash1).toBe(hash2);
      expect(hash1.startsWith("sh2-")).toBe(true);
      expect(StateHasher.VERSION).toBe(2);
    });

    // B. object key order 違い -> 同一 sh2
    it("produces identical hash regardless of object key insertion order", () => {
      const reorderedState = {
        stateVersion: 5,
        turnPlayer: "p1",
        stage: {
          requests: [
            {
              sequence: 1,
              targets: [{ unitId: "u1", kind: "unit" }],
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

    // C. timestamp / UI 状態だけ違う -> 同一 sh2
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

      expect(StateHasher.hash(stateWithUi)).toBe(StateHasher.hash(stateWithOtherUi));
    });

    // D. Life が変わる -> Hash 変化
    it("produces different hash when life changes", () => {
      const modifiedLife = {
        ...baseState,
        players: {
          ...baseState.players,
          p1: {
            ...baseState.players.p1,
            life: [],
          },
        },
      };
      expect(StateHasher.hash(modifiedLife)).not.toBe(StateHasher.hash(baseState));
    });

    // E. turnPlayer が変わる -> Hash 変化
    it("produces different hash when turnPlayer changes", () => {
      const modifiedTurn = { ...baseState, turnPlayer: "p2" };
      expect(StateHasher.hash(modifiedTurn)).not.toBe(StateHasher.hash(baseState));
    });

    // F. chancePlayer が変わる -> Hash 変化
    it("produces different hash when chancePlayer changes", () => {
      const modifiedChance = { ...baseState, chancePlayer: "p2" };
      expect(StateHasher.hash(modifiedChance)).not.toBe(StateHasher.hash(baseState));
    });

    // G. Stage Request の keyCards が変わる -> Hash 変化
    it("produces different hash when stage request keyCards change", () => {
      const modifiedKeyCards = {
        ...baseState,
        stage: {
          requests: [
            {
              ...baseState.stage.requests[0],
              keyCards: [{ id: "c7-diff", suit: "H", rank: "K", value: 13 }],
            },
          ],
        },
      };
      expect(StateHasher.hash(modifiedKeyCards)).not.toBe(StateHasher.hash(baseState));
    });

    // H. Stage Request の targets が変わる -> Hash 変化
    it("produces different hash when stage request targets change", () => {
      const modifiedTargets = {
        ...baseState,
        stage: {
          requests: [
            {
              ...baseState.stage.requests[0],
              targets: [{ kind: "unit", unitId: "u2" }], // u1 ではなく u2 を対象
            },
          ],
        },
      };
      expect(StateHasher.hash(modifiedTargets)).not.toBe(StateHasher.hash(baseState));
    });

    // I. Request Buffer 内容が変わる -> Hash 変化
    it("produces different hash when requestBuffer changes", () => {
      const modifiedBuffer = {
        ...baseState,
        requestBuffer: {
          requests: [
            {
              id: "buf-1",
              actionId: "action.draw",
              controller: "p1",
              sequence: 1,
            },
          ],
        },
      };
      expect(StateHasher.hash(modifiedBuffer)).not.toBe(StateHasher.hash(baseState));
    });

    // ------------------------------------------------------------------------
    // Entity Identity & Reference & Stage LIFO Tests
    // ------------------------------------------------------------------------
    it("distinguishes multiple runtime entities without collapsing them into a single string", () => {
      // 2つの異なる動的ユニットを持つ State
      const stateWithTwoDynamicUnits = {
        ...baseState,
        players: {
          ...baseState.players,
          p1: {
            ...baseState.players.p1,
            field: [
              {
                unitId: "unit-runtime-1788442924001-abc",
                componentId: "soldier",
                kind: "一般兵",
                state: "charge",
                cards: [{ id: "card-runtime-1788442924001-c1", suit: "S", rank: "6", value: 6 }],
              },
              {
                unitId: "unit-runtime-1788442924002-def",
                componentId: "soldier",
                kind: "一般兵",
                state: "charge",
                cards: [{ id: "card-runtime-1788442924002-c2", suit: "H", rank: "6", value: 6 }],
              },
            ],
          },
        },
      };

      // 異なるタイムスタンプだが論理トポロジーが同一の State
      const stateWithOtherDynamicTimestamps = {
        ...baseState,
        players: {
          ...baseState.players,
          p1: {
            ...baseState.players.p1,
            field: [
              {
                unitId: "unit-runtime-1788999999991-xyz",
                componentId: "soldier",
                kind: "一般兵",
                state: "charge",
                cards: [{ id: "card-runtime-1788999999991-c1", suit: "S", rank: "6", value: 6 }],
              },
              {
                unitId: "unit-runtime-1788999999992-uvw",
                componentId: "soldier",
                kind: "一般兵",
                state: "charge",
                cards: [{ id: "card-runtime-1788999999992-c2", suit: "H", rank: "6", value: 6 }],
              },
            ],
          },
        },
      };

      // トポロジーが同じなら同一 Hash
      expect(StateHasher.hash(stateWithTwoDynamicUnits)).toBe(StateHasher.hash(stateWithOtherDynamicTimestamps));
    });

    it("produces different hash when entity reference points to a different entity", () => {
      // Blocker が Unit 1 をブロック
      const stateBlocksU1 = JSON.parse(JSON.stringify(baseState));
      stateBlocksU1.players.p2.field[0].battle.blocksUnitId = "u1";

      // Blocker が Unit 2 (自分自身または別Unit) をブロック
      const stateBlocksU2 = JSON.parse(JSON.stringify(baseState));
      stateBlocksU2.players.p2.field[0].battle.blocksUnitId = "u2";

      expect(StateHasher.hash(stateBlocksU1)).not.toBe(StateHasher.hash(stateBlocksU2));
    });

    it("produces different hash for different Stage LIFO orders", () => {
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

      // Stage の LIFO 配列順序が異なれば Hash も異なる
      expect(StateHasher.hash(stateOrderAB)).not.toBe(StateHasher.hash(stateOrderBA));
    });
  });

  // --------------------------------------------------------------------------
  // 3. Decision Trace v1 & Deterministic Re-execution Tests
  // --------------------------------------------------------------------------
  describe("Decision Trace v1 & Deterministic Re-execution Tests", () => {
    it("produces identical Decision Trace v1 and state hashes (sh2) for identical seeds", () => {
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

      // 1. Decision Trace Format Version & State Hash Version
      expect(result1.decisionTraceVersion).toBe(1);
      expect(result2.decisionTraceVersion).toBe(1);

      // 2. 勝敗・ターン数・判断回数の一致
      expect(result1.completed).toBe(result2.completed);
      expect(result1.winner).toBe(result2.winner);
      expect(result1.reason).toBe(result2.reason);
      expect(result1.totalDecisions).toBe(result2.totalDecisions);
      expect(result1.turnCount).toBe(result2.turnCount);

      // 3. Final State Hash の一致 (sh2-...)
      expect(result1.finalStateHash).toBeDefined();
      expect(result1.finalStateHash?.startsWith("sh2-")).toBe(true);
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

        // State Hash v2 の一致 (意思決定直前の論理状態の一致)
        expect(rec1.stateHash).toBe(rec2.stateHash);
        expect(rec1.stateHash.startsWith("sh2-")).toBe(true);

        // 選択可能パターンの完全一致 (各 selectionRef を含む)
        expect(rec1.legalPatterns).toEqual(rec2.legalPatterns);

        // 選択されたパターンの一致
        expect(rec1.selectedPatternRef).toBe(rec2.selectedPatternRef);
        expect(rec1.selectedPatternKind).toBe(rec2.selectedPatternKind);
        expect(rec1.actionId).toBe(rec2.actionId);

        // Policy 記述子の一致
        expect(rec1.policyDescriptor).toEqual(rec2.policyDescriptor);
      }
    });

    it("captures selection refs in legalPatterns for ACTION, PASS and EFFECT_SELECTION", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, playtestRulePackage);
      const policies = {
        p1: new FirstLegalPolicy(),
        p2: new FirstLegalPolicy(),
      };

      const result = SimulationRunner.run(session, policies, { maxDecisions: 15 });

      expect(result.decisionTrace.length).toBeGreaterThan(0);

      // 各レコードの legalPatterns に selection refs プロパティが存在すること
      for (const record of result.decisionTrace) {
        for (const lp of record.legalPatterns) {
          expect(lp.patternRef).toBeDefined();
          expect(lp.kind).toBeDefined();

          if (lp.kind === "ACTION") {
            expect(lp.actionSelectionRef).toBeDefined();
          } else if (lp.kind === "PASS") {
            expect(lp.actionSelectionRef).toBeUndefined();
          } else if (lp.kind === "EFFECT_SELECTION") {
            expect(lp.effectSelectionRef).toBeDefined();
          }
        }
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
    it("Decision Trace does not leak opponent raw secrets (hand, bulwark, life identities) into JSON trace", () => {
      const state = createCoreBattlePresetState();
      // 相手手札に秘密カードを明示的に注入
      state.players.p2.hand = [
        { id: "super-secret-hand-SA", suit: "S", rank: "A", value: 1, code: "SA" },
      ];
      // 相手伏せ防壁に秘密カードを明示的に注入
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
      // 相手 Life に秘密カードを明示的に注入
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
