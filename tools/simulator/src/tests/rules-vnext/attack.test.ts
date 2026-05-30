import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import * as path from "path";

describe("Attack Action Integration Tests (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should allow turnPlayer who is also chancePlayer to request attack and create combat state upon resolve (A, B, C, G)", () => {
    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;

    expect(attackAction.request.speed).toBe("normal");
    expect(attackAction.request.timing).toBe("main");

    const soldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [soldier],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
          hand: [],
          field: [],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: soldier,
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // A. リクエスト可能であることをアサート
    const req = registry.createRequest(attackAction, context);
    expect(state.stage.requests.length).toBe(1);
    expect(req.status).toBe("pending");

    // 解決前の状態アサート
    expect(state.combat).toBeUndefined();

    // 解決
    registry.resolveTopRequest(context);
    expect(req.status).toBe("resolved");

    // B. combat state が作成されることをアサート
    expect(state.combat).toBeDefined();
    expect(state.combat.status).toBe("attacking");

    // C. combat に情報が正しく記録されることをアサート
    expect(state.combat.attackerUnitId).toBe("soldier-1");
    expect(state.combat.attackerPlayerKey).toBe("p1");
    expect(state.combat.defenderPlayerKey).toBe("p2");

    // アタッカーがドライブ状態に移行していることをアサート
    expect(soldier.state).toBe("drive");

    // G. アタック解決だけではダメージ判定や墓地移動が発生しないことをアサート
    expect(state.players.p2.life.length).toBe(1); // ダメージはまだ与えられない
    expect(state.players.p1.grave.length).toBe(0); // 墓地移動も発生しない
  });

  it("should fail when targeting a unit not owned by the requester (D)", () => {
    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;

    const soldierOfP2 = {
      unitId: "soldier-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [], // 自分のフィールドにはいない
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [soldierOfP2],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: soldierOfP2,
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // D. 自分のキャラクターでない場合 ValidationError
    expect(() => registry.createRequest(attackAction, context)).toThrow(
      "アタッカーは自分のフィールドに存在するユニットである必要があります。"
    );
  });

  it("should fail when targeting a non-character component (D)", () => {
    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;

    const nonCharTarget = {
      unitId: "fog-1",
      componentId: "fog.up",
      state: "charge",
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [nonCharTarget],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: nonCharTarget as any,
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // D. キャラクターでない場合 ValidationError
    expect(() => registry.createRequest(attackAction, context)).toThrow(
      "ターゲットがキャラクターではありません。"
    );
  });

  it("should fail when targeting a unit in drive state (D)", () => {
    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;

    const driveSoldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive", // ドライブ状態！
      cards: [],
      labels: [],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [driveSoldier],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: driveSoldier,
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // D. ドライブ状態の場合 ValidationError
    expect(() => registry.createRequest(attackAction, context)).toThrow(
      "ドライブ状態のキャラクターはアタッカーに指定できません。現在: drive"
    );
  });

  it("should fail when requester is not turnPlayer or not chancePlayer (E)", () => {
    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;

    const soldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [],
      labels: [],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [soldier],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    // Case 1: requester is p2 (not turnPlayer)
    const contextP2: CommandContext = {
      state,
      playerKey: "p2",
      targetComponent: soldier,
      targetPlayerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.createRequest(attackAction, contextP2)).toThrow(ValidationError);

    // Case 2: requester is p1 but chancePlayer is p2 (not chancePlayer)
    TurnManager.passChance(state); // chancePlayer becomes p2
    const contextP1NotChance: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: soldier,
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.createRequest(attackAction, contextP1NotChance)).toThrow(ValidationError);
  });

  it("should fail when stage is not empty (F)", () => {
    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;

    const soldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [],
      labels: [],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [soldier],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [],
          grave: [],
          fog: [],
        }
      },
      stage: {
        requests: [
          { id: "req-1", actionId: "action.up", status: "pending" } as any
        ]
      }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: soldier,
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // F. stage が空でない状態でアタックリクエストすると ValidationError
    expect(() => registry.createRequest(attackAction, context)).toThrow(ValidationError);
  });
});
