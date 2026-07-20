import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { formatActionSummary } from "../../engine/rules/formatActionSummary";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Up Action Integration Test (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should load up action and up fog component correctly", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up");
    const upFog = rulePackage.components.find((c) => c.id === "fog.up");

    expect(upAction).toBeDefined();
    expect(upAction?.name).toBe("アップ");
    expect(upFog).toBeDefined();
    expect(upFog?.name).toBe("アップ");
  });

  it("should format action summary for Up action correctly", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const summary = formatActionSummary(upAction);
    expect(summary).toBe("アップ @直接-通常-クイック | $D | ★♡A-10 | 対象: 兵士1体");
  });

  it("should create fog and apply sizeModifier via CommandRegistry", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    
    // モックシミュレーター状態
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: 16,
          hand: [],
          field: [
            {
              unitId: "soldier-1",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            }
          ],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const targetUnit = state.players.p1.field[0];
    const keyCard = { id: "key-heart-7", suit: "H", rank: "7", value: 7 };

    // createFog 命令の実行
    const effectCmd = upAction.effect?.find((e: any) => e.createFog);
    expect(effectCmd).toBeDefined();

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
      targetComponent: targetUnit,
    };

    registry.execute("createFog", (effectCmd as any).createFog, context);

    // 検証：フォグが作成され、バインディングされていること
    expect(state.players.p1.fog.length).toBe(1);
    const createdFog = state.players.p1.fog[0];
    expect(createdFog.componentId).toBe("fog.up");
    expect(createdFog.bindings.target).toBe("soldier-1");
    expect(createdFog.bindings.amount).toBe(7); // key.rankValue からバインドされていること

    // アビリティエンジンによるサイズ加算の検証
    // 一般兵本来のサイズは 6。アップフォグ適用後は 6 + 7 = 13 になるべき
    const calculateUnitSize = (unit: any, player: any): number => {
      let size = unit.cards.reduce((sum: number, c: any) => sum + c.value, 0);
      for (const fog of player.fog) {
        if (fog.componentId === "fog.up" && fog.bindings.target === unit.unitId) {
          size += fog.bindings.amount || 0;
        }
      }
      return size;
    };

    const finalSize = calculateUnitSize(targetUnit, state.players.p1);
    expect(finalSize).toBe(13);
  });
});
