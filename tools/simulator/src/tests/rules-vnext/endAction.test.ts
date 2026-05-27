import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import * as path from "path";

describe("End Action (action.end) and Fog Cleanup validation tests", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should allow turnPlayer and chancePlayer to request action.end when stage is empty (A)", () => {
    const endAction = rulePackage.actions.find((a) => a.id === "action.end")!;
    const state: any = {
      players: {
        p1: { name: "Player A", life: [], hand: [], field: [], fog: [] },
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    expect(() => registry.validateAction(endAction, context)).not.toThrow();
  });

  it("should throw ValidationError when requesting action.end if conditions are not met (H)", () => {
    const endAction = rulePackage.actions.find((a) => a.id === "action.end")!;
    const state: any = {
      players: {
        p1: { name: "Player A", life: [], hand: [], field: [], fog: [] },
        p2: { name: "Player B", life: [], hand: [], field: [], fog: [] },
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    // Case 1: Requester is not turnPlayer
    const contextP2: CommandContext = {
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.validateAction(endAction, contextP2)).toThrow(ValidationError);

    // Case 2: Requester is turnPlayer but not chancePlayer
    TurnManager.passChance(state);
    const contextNotChance: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.validateAction(endAction, contextNotChance)).toThrow(ValidationError);

    // Case 3: Stage is not empty
    state.chancePlayer = "p1"; // restore
    state.stage.requests.push({ id: "req-1", actionId: "action.some" } as any);
    const contextStageNotEmpty: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.validateAction(endAction, contextStageNotEmpty)).toThrow(ValidationError);
  });

  it("should remove fog.up & fog.down, restore unit size and switch turn/chance on action.end resolution (B, C, D, E, F, G)", () => {
    const endAction = rulePackage.actions.find((a) => a.id === "action.end")!;
    
    // 一般兵ユニットと防壁ユニット、および要塞を用意
    const soldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const bulwark = {
      unitId: "bulwark-1",
      kind: "ユニット",
      componentId: "character.bulwark",
      face: "down",
      cards: [{ id: "c2", suit: "H", rank: "K", value: 13 }],
      labels: ["防御"],
    };

    const fortress = {
      unitId: "fortress-1",
      kind: "切札",
      componentId: "trump.fortress",
      face: "up",
      cards: [{ id: "c3", suit: "C", rank: "9", value: 9 }],
    };

    // アップフォグとダウンフォグを p1 に適用
    const upFog = {
      fogId: "fog-up-1",
      componentId: "fog.up",
      card: { id: "up-card", suit: "H", rank: "7", value: 7 },
      bindings: { target: "soldier-1", amount: 7 }
    };

    const downFog = {
      fogId: "fog-down-1",
      componentId: "fog.down",
      card: { id: "down-card", suit: "S", rank: "2", value: 2 },
      bindings: { target: "soldier-1", amount: -2 }
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [soldier, bulwark],
          trumps: [fortress],
          fog: [upFog, downFog],
          grave: []
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [],
          fog: [],
          grave: []
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1"); // turnCount = 1

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // アップフォグとダウンフォグが適用されているため、兵士のサイズは 6 + 7 - 2 = 11 であることをアサート
    const sizeBefore = registry.calculateUnitSize(soldier, state.players.p1);
    expect(sizeBefore).toBe(11);

    // エンドアクションを実行・解決
    registry.executeAction(endAction, context);

    // B & D & E: フォグ（fog.up, fog.down）は除去されるが、一般兵・防壁・切札は除去されないことをアサート
    expect(state.players.p1.fog.length).toBe(0); // すべてのフォグが除去されている
    expect(state.players.p1.field).toContain(soldier); // 一般兵はそのまま
    expect(state.players.p1.field).toContain(bulwark); // 防壁はそのまま
    expect(state.players.p1.trumps).toContain(fortress); // 切札はそのまま

    // C: フォグ除去後、サイズ修正が消えて元のサイズ（6）に戻ることをアサート
    const sizeAfter = registry.calculateUnitSize(soldier, state.players.p1);
    expect(sizeAfter).toBe(6);

    // F: turnPlayer / chancePlayer が次プレイヤー（p2）に切り替わっていることをアサート
    expect(state.turnPlayer).toBe("p2");
    expect(state.chancePlayer).toBe("p2");

    // G: turnCount が +1 されて 2 になっていることをアサート
    expect(state.turnCount).toBe(2);
  });
});
