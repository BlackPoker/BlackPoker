import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { formatActionSummary } from "../../engine/rules/formatActionSummary";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Summon Soldier Action Integration Test (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should load summonSoldier action and soldier component correctly", () => {
    const summonAction = rulePackage.actions.find((a) => a.id === "action.summonSoldier");
    const soldierComponent = rulePackage.components.find((c) => c.id === "character.soldier");

    expect(summonAction).toBeDefined();
    expect(summonAction?.name).toBe("兵士召喚");
    expect(soldierComponent).toBeDefined();
    expect(soldierComponent?.name).toBe("一般兵");
  });

  it("should format action summary for Summon Soldier action correctly", () => {
    const summonAction = rulePackage.actions.find((a) => a.id === "action.summonSoldier")!;
    const summary = formatActionSummary(summonAction);
    expect(summary).toBe("兵士召喚 @直接-通常-メイン | $BL | ★2-10");
  });

  it("should summon soldier unit and consume key card via CommandRegistry", () => {
    const summonAction = rulePackage.actions.find((a) => a.id === "action.summonSoldier")!;
    
    // モックシミュレーター状態
    const keyCard = { id: "h7-uuid", code: "♡7", suit: "H", rank: "7", value: 7 };
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: 16,
          hand: [keyCard], // 手札にキーカードを持つ
          field: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();

    // summonUnit 命令の実行
    const effectCmd = summonAction.effect?.find((e: any) => e.summonUnit);
    expect(effectCmd).toBeDefined();

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
    };

    registry.execute("summonUnit", (effectCmd as any).summonUnit, context);

    // 検証：手札からキーカードが消費されたこと
    expect(state.players.p1.hand.length).toBe(0);

    // 検証：場に一般兵が召喚されたこと
    expect(state.players.p1.field.length).toBe(1);
    const summonedUnit = state.players.p1.field[0];
    expect(summonedUnit.kind).toBe("一般兵");
    expect(summonedUnit.componentId).toBe("character.soldier");
    expect(summonedUnit.state).toBe("charge"); // チャージ状態
    expect(summonedUnit.cards.length).toBe(1);
    expect(summonedUnit.cards[0].id).toBe("h7-uuid");
  });
});
