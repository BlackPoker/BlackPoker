import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import * as path from "path";

describe("Block Action Integration Tests (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should allow defender to request block and record relationship in battle property upon resolve (A, B, C)", () => {
    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;

    expect(blockAction.request.speed).toBe("normal");
    expect(blockAction.request.timing).toBe("block");

    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive", // アタッカーはすでにアタック解決によりドライブ状態
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
      battle: {
        role: "attacker",
        targetPlayerKey: "p2", // p2を攻撃している！
      }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"], // 防御ラベルあり
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
          field: [bulwark],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1"); // p1の手番
    TurnManager.passChance(state); // チャンスを p2（防御側）に移す！これで timing: block の条件を満たす

    const context: CommandContext = {
      state,
      playerKey: "p2", // 防御側プレイヤーが実行
      targetComponent: bulwark, // ブロッカー
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // A. リクエスト可能であることをアサート
    expect(bulwark.battle).toBeUndefined();
    const req = registry.createRequest(blockAction, context);
    expect(state.stage.requests.length).toBe(1);
    expect(req.status).toBe("pending");

    // 解決
    registry.resolveTopRequest(context);
    expect(req.status).toBe("resolved");

    // B. blocker.battle が作成されることをアサート
    expect(bulwark.battle).toBeDefined();
    expect(bulwark.battle.role).toBe("blocker");
    expect(bulwark.battle.blocksUnitId).toBe("soldier-1");

    // C. ブロッカーがドライブ状態に移行していることをアサート
    expect(bulwark.state).toBe("drive");
  });

  it("should fail when targeting a unit not owned by the requester (D)", () => {
    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;

    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      battle: { role: "attacker", targetPlayerKey: "p2" }
    };

    const bulwarkOfP1: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [soldier, bulwarkOfP1], // 攻撃側の場にある防壁
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
    TurnManager.passChance(state); // チャンスを p2 に移す

    const context: CommandContext = {
      state,
      playerKey: "p2", // p2が実行しようとするが、ターゲットはp1の防壁
      targetComponent: bulwarkOfP1,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // D. 自分の所有でないためエラー
    expect(() => registry.createRequest(blockAction, context)).toThrow(
      "ブロッカーは自分のフィールドに存在するユニットである必要があります。"
    );
  });

  it("should fail when target unit does not have defense label (E)", () => {
    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;

    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      battle: { role: "attacker", targetPlayerKey: "p2" }
    };

    const attackerOnlySoldier: any = {
      unitId: "soldier-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      labels: ["攻撃"], // 防御ラベルなし！
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          field: [soldier],
        },
        p2: {
          name: "Player B",
          field: [attackerOnlySoldier],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");
    TurnManager.passChance(state);

    const context: CommandContext = {
      state,
      playerKey: "p2",
      targetComponent: attackerOnlySoldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // E. 防御ラベルなしのためエラー
    expect(() => registry.createRequest(blockAction, context)).toThrow(
      "防御ラベルを持たないキャラクターはブロッカーに指定できません。"
    );
  });

  it("should fail when target is in drive state (F)", () => {
    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;

    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      battle: { role: "attacker", targetPlayerKey: "p2" }
    };

    const driveBulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "drive", // すでにドライブ状態！
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [soldier] },
        p2: { name: "Player B", field: [driveBulwark] }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");
    TurnManager.passChance(state);

    const context: CommandContext = {
      state,
      playerKey: "p2",
      targetComponent: driveBulwark,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // F. ドライブ状態のためエラー
    expect(() => registry.createRequest(blockAction, context)).toThrow(
      "ドライブ状態のキャラクターはブロッカーに指定できません。現在: drive"
    );
  });

  it("should fail when opponent's attacker is not targeting the block requester", () => {
    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;

    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      battle: {
        role: "attacker",
        targetPlayerKey: "p3", // 自分（p2）ではなく p3 を狙っている！
      }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [soldier] },
        p2: { name: "Player B", field: [bulwark] }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");
    TurnManager.passChance(state);

    const context: CommandContext = {
      state,
      playerKey: "p2",
      targetComponent: bulwark,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 自分を狙うアタッカーがないためエラー
    expect(() => registry.createRequest(blockAction, context)).toThrow(
      "自分を攻撃している相手のアタッカーが存在しないため、ブロックできません。"
    );
  });

  it("should fail when attempting to block own attacker", () => {
    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;

    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      battle: {
        role: "attacker",
        targetPlayerKey: "p2", // 相手を攻撃中
      }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [soldier, bulwark] }, // 自分の場にアタッカーと防壁が両方ある
        p2: { name: "Player B", field: [] }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");
    // チャンスを p1 に戻して（または持たせて）p1がブロックリクエストしようとする
    const context: CommandContext = {
      state,
      playerKey: "p1", // 攻撃側プレイヤー自身がブロックしようとする
      targetComponent: bulwark,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 自分を狙う相手のアタッカー（自分以外の所有）ではないためエラー
    expect(() => registry.createRequest(blockAction, context)).toThrow(
      "自分を攻撃している相手のアタッカーが存在しないため、ブロックできません。"
    );
  });

  it("should fail when no attacker exists (G)", () => {
    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [] }, // アタッカーはいない
        p2: { name: "Player B", field: [bulwark] }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");
    TurnManager.passChance(state);

    const context: CommandContext = {
      state,
      playerKey: "p2",
      targetComponent: bulwark,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // アタッカー不在のためタイミング検証エラー
    expect(() => registry.createRequest(blockAction, context)).toThrow(ValidationError);
  });
});
