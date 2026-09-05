import { describe, it, expect } from "vitest";
import {
  executeFirstPlayerDetermination,
  applyGameStart,
  isFirstPlayerDeterminationExhausted,
  isGameStartDrawLifeExhausted,
} from "../../engine/session/setup/commonSetupProcedures";
import { OfficialSetupRuleUnspecifiedError } from "../../domain/regulation/RegulationDefinition";

describe("Official Common Setup Procedures Tests (3.9.2 & 3.9.3)", () => {
  // =========================================================================
  // 3.9.2 先攻決定テスト
  // =========================================================================
  describe("3.9.2 First Player Determination", () => {
    it("Test 1: should determine P1 as first player in a single round when P1 card rank is higher", () => {
      const p1 = {
        name: "Player A",
        life: [{ id: "p1-c1", suit: "S", rank: "K", value: 13 }],
        grave: [],
      };
      const p2 = {
        name: "Player B",
        life: [{ id: "p2-c1", suit: "H", rank: "Q", value: 12 }],
        grave: [],
      };

      const result = executeFirstPlayerDetermination(p1, p2);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.firstPlayer).toBe("p1");
        expect(result.rounds.length).toBe(1);
        expect(result.rounds[0].result).toBe("p1");
        // カードが両者の墓地へ移動していること
        expect(p1.grave.length).toBe(1);
        expect(p1.grave[0].id).toBe("p1-c1");
        expect(p1.grave[0].unitId).toBe("unit-first-draw-p1-c1");
        expect(p2.grave.length).toBe(1);
        expect(p2.grave[0].id).toBe("p2-c1");
      }
    });

    it("Test 2: should determine P2 as first player in a single round when P2 card rank is higher", () => {
      const p1 = {
        name: "Player A",
        life: [{ id: "p1-c1", suit: "D", rank: "4", value: 4 }],
        grave: [],
      };
      const p2 = {
        name: "Player B",
        life: [{ id: "p2-c1", suit: "C", rank: "9", value: 9 }],
        grave: [],
      };

      const result = executeFirstPlayerDetermination(p1, p2);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.firstPlayer).toBe("p2");
        expect(result.rounds.length).toBe(1);
        expect(result.rounds[0].result).toBe("p2");
        expect(p1.grave.length).toBe(1);
        expect(p2.grave.length).toBe(1);
      }
    });

    it("Test 3: should handle tie by comparing next cards and moving all revealed cards to grave", () => {
      const p1 = {
        name: "Player A",
        life: [
          { id: "p1-c1", suit: "S", rank: "5", value: 5 }, // Round 1: tie
          { id: "p1-c2", suit: "H", rank: "10", value: 10 }, // Round 2: win
        ],
        grave: [],
      };
      const p2 = {
        name: "Player B",
        life: [
          { id: "p2-c1", suit: "D", rank: "5", value: 5 }, // Round 1: tie
          { id: "p2-c2", suit: "C", rank: "8", value: 8 }, // Round 2: lose
        ],
        grave: [],
      };

      const result = executeFirstPlayerDetermination(p1, p2);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.firstPlayer).toBe("p1");
        expect(result.rounds.length).toBe(2);
        expect(result.rounds[0].result).toBe("tie");
        expect(result.rounds[1].result).toBe("p1");

        // 全カード (2枚ずつ) が墓地へ
        expect(p1.grave.length).toBe(2);
        expect(p1.grave.map((c: any) => c.id)).toEqual(["p1-c1", "p1-c2"]);
        expect(p2.grave.length).toBe(2);
        expect(p2.grave.map((c: any) => c.id)).toEqual(["p2-c1", "p2-c2"]);
      }
    });

    it("Test 4: should return RULE_UNSPECIFIED without winner/loser when P1 life is exhausted during comparison", () => {
      const p1 = {
        name: "Player A",
        life: [
          { id: "p1-c1", suit: "S", rank: "5", value: 5 }, // Round 1: tie
          // Round 2: P1 has no cards left!
        ],
        grave: [],
      };
      const p2 = {
        name: "Player B",
        life: [
          { id: "p2-c1", suit: "D", rank: "5", value: 5 }, // Round 1: tie
          { id: "p2-c2", suit: "C", rank: "8", value: 8 },
        ],
        grave: [],
      };

      const result = executeFirstPlayerDetermination(p1, p2);

      expect(result.success).toBe(false);
      if (isFirstPlayerDeterminationExhausted(result)) {
        expect(result.reasonCode).toBe("FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED");
        expect(result.exhaustedPlayers).toEqual(["p1"]);
        expect(result.winner).toBeUndefined();
        expect(result.loser).toBeUndefined();
        // 公開された Round 1 のカードは墓地に送られていること
        expect(p1.grave.length).toBe(1);
        expect(p1.grave[0].id).toBe("p1-c1");
        expect(p2.grave.length).toBe(1);
        expect(p2.grave[0].id).toBe("p2-c1");
      }
    });

    it("Test 5: should return RULE_UNSPECIFIED without winner/loser when P2 life is exhausted during comparison", () => {
      const p1 = {
        name: "Player A",
        life: [
          { id: "p1-c1", suit: "S", rank: "7", value: 7 },
          { id: "p1-c2", suit: "H", rank: "3", value: 3 },
        ],
        grave: [],
      };
      const p2 = {
        name: "Player B",
        life: [
          { id: "p2-c1", suit: "D", rank: "7", value: 7 },
        ],
        grave: [],
      };

      const result = executeFirstPlayerDetermination(p1, p2);

      expect(result.success).toBe(false);
      if (isFirstPlayerDeterminationExhausted(result)) {
        expect(result.reasonCode).toBe("FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED");
        expect(result.exhaustedPlayers).toEqual(["p2"]);
        expect(result.winner).toBeUndefined();
        expect(result.loser).toBeUndefined();
      }
    });

    it("Test 6: should return RULE_UNSPECIFIED with exhaustedPlayers ['p1', 'p2'] when both lives are exhausted simultaneously", () => {
      const p1 = {
        name: "Player A",
        life: [
          { id: "p1-c1", suit: "S", rank: "7", value: 7 },
        ],
        grave: [],
      };
      const p2 = {
        name: "Player B",
        life: [
          { id: "p2-c1", suit: "D", rank: "7", value: 7 },
        ],
        grave: [],
      };

      const result = executeFirstPlayerDetermination(p1, p2);

      expect(result.success).toBe(false);
      if (isFirstPlayerDeterminationExhausted(result)) {
        expect(result.reasonCode).toBe("FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED");
        expect(result.exhaustedPlayers).toEqual(["p1", "p2"]);
        expect(result.winner).toBeUndefined();
        expect(result.loser).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // 3.9.3 ゲーム開始テスト (Validation First & Zero Partial Mutation)
  // =========================================================================
  describe("3.9.3 Game Start Procedure", () => {
    it("Test 7: should draw 1 card to Hand and initialize turn/chance info on success", () => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: undefined,
        chancePlayer: undefined,
        players: {
          p1: {
            name: "Player A",
            life: [{ id: "p1-l1", suit: "S", rank: "2", value: 2 }],
            hand: [{ id: "p1-h1", suit: "H", rank: "4", value: 4 }],
          },
          p2: {
            name: "Player B",
            life: [{ id: "p2-l1", suit: "D", rank: "3", value: 3 }],
            hand: [{ id: "p2-h1", suit: "C", rank: "5", value: 5 }],
          },
        },
      };

      const result = applyGameStart(state, "p1");

      expect(result.success).toBe(true);
      if (result.success) {
        // 先攻 (p1) のみ 1枚ドロー
        expect(state.players.p1.hand.length).toBe(2);
        expect(state.players.p1.hand[1].id).toBe("p1-l1");
        expect(state.players.p1.life.length).toBe(0);

        // 後攻 (p2) はドローなし
        expect(state.players.p2.hand.length).toBe(1);
        expect(state.players.p2.life.length).toBe(1);

        // ターンおよびチャンスの確定
        expect(state.turnPlayer).toBe("p1");
        expect(state.chancePlayer).toBe("p1");
        expect(state.nonTurnPlayer).toBe("p2");
        expect(state.turnCount).toBe(1);
        expect(state.actionCount).toBe(0);
        expect(state.stateVersion).toBe(2);
      }
    });

    it("Test 8: Zero Partial Mutation - should NOT mutate state at all when first player life is empty", () => {
      const state: any = {
        stateVersion: 1,
        matchId: "test-match",
        turnPlayer: undefined,
        chancePlayer: undefined,
        turnCount: 0,
        actionCount: 0,
        stage: { requests: [] },
        requestBuffer: { requests: [], history: [] },
        players: {
          p1: {
            name: "Player A",
            life: [], // Life is empty!
            hand: [{ id: "p1-h1", suit: "H", rank: "4", value: 4 }],
            field: [],
            grave: [],
          },
          p2: {
            name: "Player B",
            life: [{ id: "p2-l1", suit: "D", rank: "3", value: 3 }],
            hand: [{ id: "p2-h1", suit: "C", rank: "5", value: 5 }],
            field: [],
            grave: [],
          },
        },
      };

      // 実行前のディープコピー
      const before = JSON.parse(JSON.stringify(state));

      const result = applyGameStart(state, "p1");

      // 結果は success: false かつ GAME_START_DRAW_LIFE_EXHAUSTED
      expect(result.success).toBe(false);
      if (isGameStartDrawLifeExhausted(result)) {
        expect(result.reasonCode).toBe("GAME_START_DRAW_LIFE_EXHAUSTED");
        expect(result.affectedPlayer).toBe("p1");
        expect(result.exhaustedPlayers).toEqual(["p1"]);
        expect(result.winner).toBeUndefined();
        expect(result.loser).toBeUndefined();
      }

      // 【Zero Partial Mutation 検証】
      // state が実行前と 1bit も変わらず完全に一致していること
      expect(state).toEqual(before);

      // 個別フィールドの厳格アサーション
      expect(state.turnPlayer).toBeUndefined();
      expect(state.chancePlayer).toBeUndefined();
      expect(state.turnCount).toBe(0);
      expect(state.stateVersion).toBe(1);
      expect(state.players.p1.life.length).toBe(0);
      expect(state.players.p1.hand.length).toBe(1);
    });

    it("Test 9: OfficialSetupRuleUnspecifiedError can be constructed and inspected mechanically", () => {
      const outcome = {
        type: "RULE_UNSPECIFIED" as const,
        reasonCode: "GAME_START_DRAW_LIFE_EXHAUSTED" as const,
        reason: "ゲーム開始ドロー処理中に先攻プレイヤー (p1) のライフが不足しています",
        exhaustedPlayers: ["p1"] as const,
        affectedPlayer: "p1" as const,
      };

      const err = new OfficialSetupRuleUnspecifiedError(outcome);

      expect(err.errorCode).toBe("RULE_UNSPECIFIED");
      expect(err.reasonCode).toBe("GAME_START_DRAW_LIFE_EXHAUSTED");
      if (err.setupOutcome.reasonCode === "GAME_START_DRAW_LIFE_EXHAUSTED") {
        expect(err.setupOutcome.affectedPlayer).toBe("p1");
      }
      expect(err.name).toBe("OfficialSetupRuleUnspecifiedError");
      expect(err.message).toContain("GAME_START_DRAW_LIFE_EXHAUSTED");
    });
  });
});
