import { describe, it, expect, beforeAll } from "vitest";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { TurnManager } from "../../engine/rules/TurnManager";
import * as path from "path";

describe("Blocker State & Event Integrity Tests (Phase 21B.6)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext/examples");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("P0-1: Blocker (soldier) should stay in CHARGE state after Block resolves and emit NO unitStateChanged event", () => {
    const soldierAttacker: any = {
      unitId: "soldier-atk",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-atk", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };

    const soldierBlocker: any = {
      unitId: "soldier-blk",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-blk", suit: "C", rank: "5", value: 5 }],
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [soldierAttacker], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [soldierBlocker], hand: [], grave: [], life: [] },
      },
      stage: { requests: [] },
    };

    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;
    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const emittedEvents: any[] = [];
    const context: CommandContext = {
      state,
      playerKey: "p2",
      selections: {
        blocks: [
          {
            sourceUnitId: "soldier-atk",
            selectedUnitIds: ["soldier-blk"],
          },
        ],
      },
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // イベント捕捉
    registry.onEvent((ev) => emittedEvents.push(ev));

    registry.createRequest(blockAction, context);
    registry.resolveTopRequest(context);

    // 1. battle 情報が付与されていること
    expect(soldierBlocker.battle).toBeDefined();
    expect(soldierBlocker.battle.role).toBe("blocker");
    expect(soldierBlocker.battle.blocksUnitId).toBe("soldier-atk");

    // 2. ブロッカーの state は charge のままであること (P0-1)
    expect(soldierBlocker.state).toBe("charge");

    // 3. unitStateChanged イベントが発行されていないこと (P0-1)
    const stateChangeEvents = emittedEvents.filter((e) => e.type === "unitStateChanged");
    expect(stateChangeEvents.length).toBe(0);

    // 4. DamageJudge は charge 状態のブロッカーでも battle 情報だけで正しく動作すること
    const djAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const djContext: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    registry.createRequest(djAction, djContext);
    registry.resolveTopRequest(djContext);

    // 8 vs 5 -> ブロッカーが墓地へ移動
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.some((u: any) => u.unitId === "soldier-blk")).toBe(true);
    expect(state.players.p1.field.some((u: any) => u.unitId === "soldier-atk")).toBe(true);
  });

  it("P0-1: Blocker (bulwark) should stay in CHARGE state after Block resolves", () => {
    const soldierAttacker: any = {
      unitId: "soldier-atk",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-atk", suit: "H", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "c-bw", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [soldierAttacker], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [bulwark], hand: [], grave: [], life: [] },
      },
      stage: { requests: [] },
    };

    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;
    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p2",
      selections: {
        blocks: [
          {
            sourceUnitId: "soldier-atk",
            selectedUnitIds: ["bulwark-1"],
          },
        ],
      },
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(blockAction, context);
    registry.resolveTopRequest(context);

    // ブロッカーの state は charge のまま
    expect(bulwark.state).toBe("charge");
    expect(bulwark.battle?.role).toBe("blocker");

    // DamageJudge (5一致 -> 両者墓地へ)
    const djAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const djContext: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    registry.createRequest(djAction, djContext);
    registry.resolveTopRequest(djContext);

    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p2.field.length).toBe(0);
  });
});
