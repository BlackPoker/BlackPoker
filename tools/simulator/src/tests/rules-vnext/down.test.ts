import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { formatActionSummary } from "../../engine/rules/formatActionSummary";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Down Action Integration Test (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should load down action and down fog component correctly", () => {
    const downAction = rulePackage.actions.find((a) => a.id === "action.down");
    const downFog = rulePackage.components.find((c) => c.id === "fog.down");

    expect(downAction).toBeDefined();
    expect(downAction?.name).toBe("ダウン");
    expect(downFog).toBeDefined();
    expect(downFog?.name).toBe("ダウン");
  });

  it("should format action summary for Down action correctly", () => {
    const downAction = rulePackage.actions.find((a) => a.id === "action.down")!;
    const summary = formatActionSummary(downAction);
    expect(summary).toBe("ダウン @直接-通常-クイック | $D | ★♠2-10 | 対象: 兵士1体");
  });

  it("should apply down fog, reduce size, and keep soldier on field (Case A: Spade 2 against Size 5)", () => {
    const downAction = rulePackage.actions.find((a) => a.id === "action.down")!;

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
              cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
              labels: ["攻撃", "防御"],
            }
          ],
          fog: [],
          grave: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const targetUnit = state.players.p1.field[0];
    const keyCard = { id: "key-spade-2", suit: "S", rank: "2", value: 2 }; // Spade 2

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
      targetComponent: targetUnit,
    };

    // ダウンアクションの効果を一括実行
    if (downAction.effect) {
      registry.executeEffects(downAction.effect, context);
    }

    // 検証：
    // 1. fog が1つ作成され、bindings.amount が -2 になっていること
    expect(state.players.p1.fog.length).toBe(1);
    const createdFog = state.players.p1.fog[0];
    expect(createdFog.componentId).toBe("fog.down");
    expect(createdFog.bindings.target).toBe("soldier-1");
    expect(createdFog.bindings.amount).toBe(-2);

    // 2. 兵士が墓地へ行かず、フィールドに残っていること
    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p1.grave.length).toBe(0);

    // 3. サイズが 5 + (-2) = 3 になっていること
    const finalSize = registry.calculateUnitSize(targetUnit, state.players.p1);
    expect(finalSize).toBe(3);
  });

  it("should apply down fog, trigger graveyard move and remove fog (Case B: Spade 5 against Size 5)", () => {
    const downAction = rulePackage.actions.find((a) => a.id === "action.down")!;

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
              cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
              labels: ["攻撃", "防御"],
            }
          ],
          fog: [],
          grave: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const targetUnit = state.players.p1.field[0];
    const keyCard = { id: "key-spade-5", suit: "S", rank: "5", value: 5 }; // Spade 5

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
      targetComponent: targetUnit,
    };

    // ダウンアクションの効果を一括実行
    if (downAction.effect) {
      registry.executeEffects(downAction.effect, context);
    }

    // 検証：
    // 1. サイズが0以下になるため、兵士はフィールドから除外され、墓地へ移動していること
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.grave[0].unitId).toBe("soldier-1");

    // 2. 作成された fog.down が if の then 節によって除去され、フォグ領域に残らないこと
    expect(state.players.p1.fog.length).toBe(0);
  });
});
