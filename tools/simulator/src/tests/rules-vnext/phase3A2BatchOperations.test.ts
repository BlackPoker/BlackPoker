import { describe, it, expect, vi } from "vitest";
import {
  moveMatchingUnitsToGraveyardHandler,
  transformMatchingUnitsHandler,
} from "../../engine/rules/commandHandlers";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { CommandContext } from "../../engine/rules/CommandRegistry";
import { ComponentDefinition } from "../../domain/rules/RulePackage";
import { CharacterTransformService } from "../../engine/rules/CharacterTransformService";

describe("作業3A-2: 一括変形・一括墓地移動テスト", () => {
  const mockComponents: ComponentDefinition[] = [
    {
      id: "character.soldier",
      name: "一般兵",
      type: "character",
      zone: "field",
      display: { kind: "一般兵" },
      unitCondition: {
        cards: { count: 1, rank: "2..10" },
        face: "up",
      },
      properties: { characterType: "soldier" },
    },
    {
      id: "character.hero",
      name: "英雄",
      type: "character",
      zone: "field",
      display: { kind: "英雄" },
      unitCondition: {
        cards: { count: 1, rank: "J..K" },
        face: "up",
      },
      properties: { characterType: "soldier" },
    },
    {
      id: "character.ace",
      name: "エース",
      type: "character",
      zone: "field",
      display: { kind: "エース" },
      unitCondition: {
        cards: { count: 1, rank: "A" },
        face: "up",
      },
      properties: { characterType: "soldier" },
    },
    {
      id: "character.bulwark",
      name: "防壁",
      type: "character",
      zone: "field",
      display: { kind: "防壁" },
      unitCondition: {
        cards: { count: 1 },
        face: "down",
      },
      properties: { characterType: "bulwark" },
    },
  ];

  describe("1. moveMatchingUnitsToGraveyard: 剣の雨の全体除去とバッチ墓地TOP管理", () => {
    it("指定サイズ以下の全兵士（自軍・敵軍）が一括で墓地へ送られ、2体以上破壊時は pendingGraveTopSelections が登録されること", () => {
      const exprEval = new ExpressionEvaluator();
      const abilityEval = new AbilityEvaluator();
      const mockInterpreter: any = {
        dispatchEvent: vi.fn(),
      };

      const handler = moveMatchingUnitsToGraveyardHandler(exprEval, abilityEval, mockInterpreter);

      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            field: [
              // 破壊対象 (サイズ 5 <= 10)
              {
                unitId: "u-p1-s5",
                componentId: "character.soldier",
                cards: [{ id: "c-s5", suit: "S", rank: "5", value: 5 }],
              },
              // 破壊対象 (サイズ 8 <= 10)
              {
                unitId: "u-p1-s8",
                componentId: "character.soldier",
                cards: [{ id: "c-s8", suit: "S", rank: "8", value: 8 }],
              },
              // 残存 (サイズ 12 > 10)
              {
                unitId: "u-p1-q",
                componentId: "character.hero",
                cards: [{ id: "c-q", suit: "S", rank: "Q", value: 12 }],
              },
              // 残存 (防壁は兵士ではない)
              {
                unitId: "u-p1-b",
                componentId: "character.bulwark",
                cards: [{ id: "c-b1", suit: "H", rank: "2", value: 2 }],
              },
            ],
            grave: [],
          },
          p2: {
            field: [
              // 破壊対象 (サイズ 1 <= 10)
              {
                unitId: "u-p2-a",
                componentId: "character.ace",
                cards: [{ id: "c-p2-a", suit: "H", rank: "A", value: 1 }],
              },
              // 残存 (サイズ 13 > 10)
              {
                unitId: "u-p2-k",
                componentId: "character.hero",
                cards: [{ id: "c-p2-k", suit: "H", rank: "K", value: 13 }],
              },
            ],
            grave: [],
          },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        components: mockComponents,
        currentAction: { id: "action.swordRain" } as any,
      };

      // キーカード合計値 10 以下の兵士を一括除去
      handler({ componentType: "soldier", maxSize: 10 }, context);

      // P1 フィールド: 2体破壊され、2体残存
      expect(state.players.p1.field.length).toBe(2);
      expect(state.players.p1.field.map((u: any) => u.unitId)).toEqual(["u-p1-q", "u-p1-b"]);

      // P1 墓地: ユニット構造を完全維持して2体追加
      expect(state.players.p1.grave.length).toBe(2);
      expect(state.players.p1.grave[0].unitId).toBe("u-p1-s5");
      expect(state.players.p1.grave[1].unitId).toBe("u-p1-s8");

      // P1 は2枚が同時破壊されたため、graveTopCardId は未定で pendingGraveTopSelections に登録される
      expect(state.players.p1.graveTopCardId).toBeUndefined();
      expect(state.pendingGraveTopSelections).toBeDefined();
      const p1Pending = state.pendingGraveTopSelections.find((p: any) => p.playerId === "p1");
      expect(p1Pending).toBeDefined();
      expect(p1Pending.candidateCardIds).toEqual(["c-s5", "c-s8"]);

      // P2 フィールド: 1体破壊され、1体残存
      expect(state.players.p2.field.length).toBe(1);
      expect(state.players.p2.field[0].unitId).toBe("u-p2-k");

      // P2 墓地: 1体追加され、単一移動のため自動で graveTopCardId が設定される（Pending不要）
      expect(state.players.p2.grave.length).toBe(1);
      expect(state.players.p2.graveTopCardId).toBe("c-p2-a");
      const p2Pending = state.pendingGraveTopSelections.find((p: any) => p.playerId === "p2");
      expect(p2Pending).toBeUndefined();

      // 各破壊カードについて cardMoved イベントが発行されたこと (計3件)
      expect(mockInterpreter.dispatchEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe("2. transformMatchingUnits: 奇襲の全防壁変形とAll-or-Nothing保証", () => {
    it("自陣の全防壁（CHARGE / DRIVE混在）が一括して兵士に変形され、属性が完全継承されること", () => {
      const exprEval = new ExpressionEvaluator();
      const mockInterpreter: any = {
        dispatchEvent: vi.fn(),
      };

      const handler = transformMatchingUnitsHandler(exprEval, mockInterpreter);

      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            field: [
              // 防壁1 (CHARGE): 元カードが 2..10 なので 一般兵 へ
              {
                unitId: "u-b1",
                kind: "防壁",
                componentId: "character.bulwark",
                state: "charge",
                face: "down",
                cards: [{ id: "c-d3", suit: "D", rank: "3", value: 3 }],
                labels: ["防御"],
                enteredTurn: 1,
                enteredFieldTurn: 1,
                enteredFieldBeforeGame: false,
              },
              // 防壁2 (DRIVE): コスト等で DRIVE された防壁。元カードが K なので 英雄 へ
              {
                unitId: "u-b2",
                kind: "防壁",
                componentId: "character.bulwark",
                state: "drive",
                face: "down",
                cards: [{ id: "c-sk", suit: "S", rank: "K", value: 13 }],
                labels: ["防御"],
                enteredTurn: 2,
                enteredFieldTurn: 2,
                enteredFieldBeforeGame: false,
              },
              // 防壁3 (CHARGE): 元カードが A なので エース へ
              {
                unitId: "u-b3",
                kind: "防壁",
                componentId: "character.bulwark",
                state: "charge",
                face: "down",
                cards: [{ id: "c-ha", suit: "H", rank: "A", value: 1 }],
                labels: ["防御"],
                enteredTurn: 0,
                enteredFieldTurn: 0,
                enteredFieldBeforeGame: true,
              },
            ],
          },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        components: mockComponents,
        currentAction: { id: "action.surprise" } as any,
      };

      handler({ relation: "self", componentType: "bulwark", destination: "soldier" }, context);

      const field = state.players.p1.field;
      expect(field.length).toBe(3);

      // 防壁1 -> 一般兵 (charge維持, enteredFieldTurn維持)
      expect(field[0].unitId).toBe("u-b1");
      expect(field[0].componentId).toBe("character.soldier");
      expect(field[0].kind).toBe("一般兵");
      expect(field[0].face).toBe("up");
      expect(field[0].state).toBe("charge");
      expect(field[0].enteredFieldTurn).toBe(1);

      // 防壁2 -> 英雄 (drive維持, enteredFieldTurn維持)
      expect(field[1].unitId).toBe("u-b2");
      expect(field[1].componentId).toBe("character.hero");
      expect(field[1].kind).toBe("英雄");
      expect(field[1].face).toBe("up");
      expect(field[1].state).toBe("drive");
      expect(field[1].enteredFieldTurn).toBe(2);

      // 防壁3 -> エース (charge維持, enteredFieldBeforeGame維持)
      expect(field[2].unitId).toBe("u-b3");
      expect(field[2].componentId).toBe("character.ace");
      expect(field[2].kind).toBe("エース");
      expect(field[2].face).toBe("up");
      expect(field[2].enteredFieldBeforeGame).toBe(true);
    });

    it("Preflight で1体でも不正がある場合、例外がスローされ盤面は一切変更されないこと (All-or-Nothing)", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            field: [
              // 正常な防壁
              {
                unitId: "u-ok",
                kind: "防壁",
                componentId: "character.bulwark",
                state: "charge",
                cards: [{ id: "c-1", suit: "S", rank: "5", value: 5 }],
              },
              // 不正な防壁（カードなし）
              {
                unitId: "u-bad",
                kind: "防壁",
                componentId: "character.bulwark",
                state: "charge",
                cards: [],
              },
            ],
          },
        },
      };

      const originalFieldSnapshot = JSON.stringify(state.players.p1.field);

      expect(() => {
        CharacterTransformService.transformMatchingCharacters({
          playerKey: "p1",
          state,
          components: mockComponents,
          condition: { characterType: "bulwark" },
          options: { destination: "soldier" },
        });
      }).toThrow();

      // 盤面が1ミリも変更されていないこと（u-ok も変形されず防壁のまま）
      expect(JSON.stringify(state.players.p1.field)).toBe(originalFieldSnapshot);
      expect(state.players.p1.field[0].componentId).toBe("character.bulwark");
    });
  });
});
