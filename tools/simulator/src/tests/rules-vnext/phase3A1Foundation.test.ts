import { describe, it, expect, vi } from "vitest";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { CommandContext } from "../../engine/rules/CommandRegistry";
import { isSoldierType, isBulwarkType } from "../../engine/rules/characterUtils";
import { setAllUnitStateHandler } from "../../engine/rules/commandHandlers";
import { ComponentDefinition } from "../../domain/rules/RulePackage";

describe("作業3A-1: 式評価・共通兵士判定テスト", () => {
  const mockComponents: ComponentDefinition[] = [
    { id: "character.soldier", name: "一般兵", type: "character", zone: "field", properties: { characterType: "soldier" } },
    { id: "character.hero", name: "英雄", type: "character", zone: "field", properties: { characterType: "soldier" } },
    { id: "character.ace", name: "エース", type: "character", zone: "field", properties: { characterType: "soldier" } },
    { id: "character.magician", name: "魔術士", type: "character", zone: "field", properties: { characterType: "soldier" } },
    { id: "character.armedSoldier", name: "装備兵", type: "character", zone: "field", properties: { characterType: "soldier" } },
    { id: "character.bulwark", name: "防壁", type: "character", zone: "field", properties: { characterType: "bulwark" } },
  ];

  describe("1. ExpressionEvaluator: keyCards.totalRankValue", () => {
    const evaluator = new ExpressionEvaluator();

    it("複数キーカードのランク合計値を正しく算出すること", () => {
      const context: CommandContext = {
        state: {} as any,
        playerKey: "p1",
        keyCards: [
          { id: "c1", suit: "S", rank: "5", value: 5 },
          { id: "c2", suit: "S", rank: "8", value: 8 },
        ],
      };

      const cond = "keyCards.totalRankValue >= 13";
      expect(evaluator.evaluateCondition(cond, context)).toBe(true);

      const condStrict = "keyCards.totalRankValue == 13";
      expect(evaluator.evaluateCondition(condStrict, context)).toBe(true);

      const boundVal = evaluator.resolveBindingValue("keyCards.totalRankValue", context);
      expect(boundVal).toBe(13);
    });

    it("単一 keyCard のみ指定された場合もフォールバックで合計値を算出すること", () => {
      const context: CommandContext = {
        state: {} as any,
        playerKey: "p1",
        keyCard: { id: "c1", suit: "H", rank: "10", value: 10 },
      };

      expect(evaluator.evaluateCondition("keyCards.totalRankValue == 10", context)).toBe(true);
      expect(evaluator.resolveBindingValue("keyCards.totalRankValue", context)).toBe(10);
    });

    it("キーカードが存在しない場合は 0 を返すこと", () => {
      const context: CommandContext = {
        state: {} as any,
        playerKey: "p1",
      };

      expect(evaluator.evaluateCondition("keyCards.totalRankValue == 0", context)).toBe(true);
      expect(evaluator.resolveBindingValue("keyCards.totalRankValue", context)).toBe(0);
    });
  });

  describe("2. characterUtils: 共通兵士判定 (isSoldierType)", () => {
    it("一般兵・英雄・エース・魔術士・装備兵のすべてが isSoldierType === true と判定されること", () => {
      const soldier = { unitId: "u1", componentId: "character.soldier" };
      const hero = { unitId: "u2", componentId: "character.hero" };
      const ace = { unitId: "u3", componentId: "character.ace" };
      const magician = { unitId: "u4", componentId: "character.magician" };
      const armedSoldier = { unitId: "u5", componentId: "character.armedSoldier" };
      const bulwark = { unitId: "u6", componentId: "character.bulwark" };

      expect(isSoldierType(soldier, mockComponents)).toBe(true);
      expect(isSoldierType(hero, mockComponents)).toBe(true);
      expect(isSoldierType(ace, mockComponents)).toBe(true);
      expect(isSoldierType(magician, mockComponents)).toBe(true);
      expect(isSoldierType(armedSoldier, mockComponents)).toBe(true);

      expect(isSoldierType(bulwark, mockComponents)).toBe(false);
      expect(isBulwarkType(bulwark, mockComponents)).toBe(true);
    });
  });

  describe("3. setAllUnitStateHandler: componentType: 'soldier' で全兵士種別が漏れなく更新されること", () => {
    it("一般兵・英雄・エース・魔術士がチャージ状態に更新され、防壁は除外されること", () => {
      const mockInterpreter: any = {
        dispatchEvent: vi.fn(),
      };
      const handler = setAllUnitStateHandler(new ExpressionEvaluator(), mockInterpreter);

      const state: any = {
        players: {
          p1: {
            field: [
              { unitId: "u-soldier", componentId: "character.soldier", state: "drive" },
              { unitId: "u-hero", componentId: "character.hero", state: "drive" },
              { unitId: "u-ace", componentId: "character.ace", state: "drive" },
              { unitId: "u-magician", componentId: "character.magician", state: "drive" },
              { unitId: "u-bulwark", componentId: "character.bulwark", state: "drive" },
            ],
          },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        components: mockComponents,
      };

      handler({ relation: "self", componentType: "soldier", state: "charge" }, context);

      const field = state.players.p1.field;
      // 兵士種別4体は charge に更新
      expect(field[0].state).toBe("charge");
      expect(field[1].state).toBe("charge");
      expect(field[2].state).toBe("charge");
      expect(field[3].state).toBe("charge");
      // 防壁は drive のまま維持
      expect(field[4].state).toBe("drive");

      // 4件の unitStateChanged イベントが発行されたこと
      expect(mockInterpreter.dispatchEvent).toHaveBeenCalledTimes(4);
    });
  });
});
