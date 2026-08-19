import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { ActionRequestValidator } from "../../engine/rules/ActionRequestValidator";

describe("DamageJudge Multi-Combat Integration Tests (Phase 17)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const createBaseState = () => {
    return {
      stateVersion: 1,
      version: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "l1-1", suit: "S", rank: "2", value: 2 },
            { id: "l1-2", suit: "H", rank: "3", value: 3 },
            { id: "l1-3", suit: "D", rank: "4", value: 4 },
          ],
          hand: [],
          field: [],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l2-1", suit: "C", rank: "5", value: 5 },
            { id: "l2-2", suit: "S", rank: "6", value: 6 },
            { id: "l2-3", suit: "H", rank: "7", value: 7 },
            { id: "l2-4", suit: "D", rank: "8", value: 8 },
            { id: "l2-5", suit: "C", rank: "9", value: 9 },
            { id: "l2-6", suit: "S", rank: "10", value: 10 },
          ],
          hand: [],
          field: [],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    } as any;
  };

  it("Test A: Single unblocked attacker deals direct damage equal to current size and survives with battle cleanup", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(attacker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    expect(req.status).toBe("resolved");
    // p2 に 6 点の直接ダメージ -> life が 6 枚減って 0 枚になる
    expect(state.players.p2.life.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(6);
    // アタッカーは生存し、battle が cleanup されていること
    expect(state.players.p1.field.length).toBe(1);
    expect(attacker.battle).toBeUndefined();
  });

  it("Test B: Multiple unblocked attackers sequentially deal direct damage and survive", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker1 = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "2", value: 2 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const attacker2 = {
      unitId: "u-att-2",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-2", suit: "H", rank: "3", value: 3 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(attacker1, attacker2);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // p2 に 2 + 3 = 5 点の直接ダメージ
    expect(state.players.p2.life.length).toBe(1); // 6 - 5 = 1
    expect(state.players.p2.grave.length).toBe(5);
    // 双方のアタッカーが生存し、battle が cleanup されていること
    expect(state.players.p1.field.length).toBe(2);
    expect(attacker1.battle).toBeUndefined();
    expect(attacker2.battle).toBeUndefined();
  });

  it("Test C: Soldier attacker vs Soldier blocker (Attacker wins: size 8 vs 5)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "u-blk-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-1", suit: "C", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(blocker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // blocker 敗北 -> 墓地へ
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
    // attacker 勝利 -> 生存 & battle cleanup
    expect(state.players.p1.field.length).toBe(1);
    expect(attacker.battle).toBeUndefined();
    // 直接ダメージは発生しない
    expect(state.players.p2.life.length).toBe(6);
  });

  it("Test D: Soldier attacker vs Soldier blocker (Blocker wins: size 5 vs 8)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "u-blk-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-1", suit: "C", rank: "8", value: 8 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(blocker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // attacker 敗北 -> 墓地へ
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    // blocker 勝利 -> 生存 & battle cleanup
    expect(state.players.p2.field.length).toBe(1);
    expect(blocker.battle).toBeUndefined();
  });

  it("Test E: Soldier attacker vs Soldier blocker (Draw: size 7 vs 7 -> both to grave)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "7", value: 7 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "u-blk-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-1", suit: "C", rank: "7", value: 7 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(blocker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 双方墓地へ
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
  });

  it("Test F: Multiple Soldier blockers vs Attacker (Attacker wins: size 9 vs 3+4=7)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "9", value: 9 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker1 = {
      unitId: "u-blk-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-1", suit: "C", rank: "3", value: 3 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    const blocker2 = {
      unitId: "u-blk-2",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-2", suit: "D", rank: "4", value: 4 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(blocker1, blocker2);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // ブロッカー2体とも墓地へ
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(2);
    // アタッカー生存 & battle cleanup
    expect(state.players.p1.field.length).toBe(1);
    expect(attacker.battle).toBeUndefined();
  });

  it("Test G: Multiple Soldier blockers vs Attacker (Blockers win: size 6 vs 3+4=7)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker1 = {
      unitId: "u-blk-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-1", suit: "C", rank: "3", value: 3 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    const blocker2 = {
      unitId: "u-blk-2",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-2", suit: "D", rank: "4", value: 4 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(blocker1, blocker2);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // アタッカー墓地へ
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    // ブロッカー2体とも生存 & battle cleanup
    expect(state.players.p2.field.length).toBe(2);
    expect(blocker1.battle).toBeUndefined();
    expect(blocker2.battle).toBeUndefined();
  });

  it("Test H: Multiple Soldier blockers vs Attacker (Draw: size 7 vs 3+4=7 -> all to grave)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "7", value: 7 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker1 = {
      unitId: "u-blk-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-1", suit: "C", rank: "3", value: 3 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    const blocker2 = {
      unitId: "u-blk-2",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-2", suit: "D", rank: "4", value: 4 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(blocker1, blocker2);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 全員墓地へ
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(2);
  });

  it("Test I: Bulwark Joker destroys attacker and bulwark goes to grave", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "u-bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-1", suit: "Joker", rank: "Joker", value: 20 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(bulwark);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // Joker防壁により双方墓地へ
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
  });

  it("Test J: Bulwark number match destroys attacker and bulwark goes to grave", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [
        { id: "c-att-1", suit: "S", rank: "3", value: 3 },
        { id: "c-att-2", suit: "H", rank: "8", value: 8 },
      ],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "u-bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-1", suit: "C", rank: "8", value: 8 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(bulwark);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 数字一致(8)により双方墓地へ
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
  });

  it("Test K & L: Bulwark number mismatch leaves attacker surviving, but bulwark ALWAYS goes to grave", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [
        { id: "c-att-1", suit: "S", rank: "3", value: 3 },
        { id: "c-att-2", suit: "H", rank: "8", value: 8 },
      ],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "u-bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-1", suit: "D", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(bulwark);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 不一致のため attacker 生存 & battle cleanup
    expect(state.players.p1.field.length).toBe(1);
    expect(attacker.battle).toBeUndefined();
    // 防壁は必ず墓地へ
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
  });

  it("Test N: Soldier comparison uses effective size with fog modifiers (6 + 3 = 9 vs 8 -> attacker wins)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "u-blk-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-1", suit: "C", rank: "8", value: 8 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    // p1 の fog に +3 補正を付加
    state.players.p1.fog.push({
      fogId: "fog-up-1",
      componentId: "fog.up",
      bindings: { target: "u-att-1", amount: 3 },
    });

    state.players.p1.field.push(attacker);
    state.players.p2.field.push(blocker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 有効サイズ 9 vs 8 で attacker が勝利
    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
  });

  it("Test O: Direct damage uses effective size with fog modifiers (6 + 3 = 9 damage)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.fog.push({
      fogId: "fog-up-1",
      componentId: "fog.up",
      bindings: { target: "u-att-1", amount: 3 },
    });
    state.players.p1.field.push(attacker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 9点ダメージ -> p2 の life 6枚がすべて削られる
    expect(state.players.p2.life.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(6);
  });

  it("Test P: Bulwark matching uses printed rank, NOT effective size (card 6 with size 9 matches bulwark 6)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.fog.push({
      fogId: "fog-up-1",
      componentId: "fog.up",
      bindings: { target: "u-att-1", amount: 3 }, // 有効サイズは 9 になる
    });
    const bulwark = {
      unitId: "u-bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-1", suit: "D", rank: "6", value: 6 }], // 記載数字 6
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-1" },
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(bulwark);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 記載数字 6 が一致するため attacker も墓地へ
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
  });

  it("Test Q: Mixed multiple combats (Unblocked + Soldier vs Soldier + Multi-Soldier + Bulwark) in single damageJudge", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    // Attacker 1: Unblocked (size 2)
    const att1 = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-1", suit: "S", rank: "2", value: 2 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    // Attacker 2: vs Soldier (size 8 vs 5 -> att2 wins)
    const att2 = {
      unitId: "att-2",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-2", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blk2 = {
      unitId: "blk-2",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-2", suit: "C", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-2" },
    };
    // Attacker 3: vs Multi-Soldier (size 5 vs 3+4=7 -> att3 loses)
    const att3 = {
      unitId: "att-3",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-3", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blk3a = {
      unitId: "blk-3a",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-3a", suit: "C", rank: "3", value: 3 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-3" },
    };
    const blk3b = {
      unitId: "blk-3b",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-3b", suit: "D", rank: "4", value: 4 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-3" },
    };
    // Attacker 4: vs Bulwark mismatch (cards:[4] vs bulwark:[7] -> att4 survives, bulwark dies)
    const att4 = {
      unitId: "att-4",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-4", suit: "S", rank: "4", value: 4 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark4 = {
      unitId: "bw-4",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-4", suit: "H", rank: "7", value: 7 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-4" },
    };

    state.players.p1.field.push(att1, att2, att3, att4);
    state.players.p2.field.push(blk2, blk3a, blk3b, bulwark4);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // p1 生存: att1, att2, att4 (att3 は死亡)
    expect(state.players.p1.field.map((u: any) => u.unitId).sort()).toEqual(["att-1", "att-2", "att-4"]);
    expect(state.players.p1.grave.length).toBe(1); // att3
    // p2 生存: blk3a, blk3b (blk2, bulwark4 は死亡)
    expect(state.players.p2.field.map((u: any) => u.unitId).sort()).toEqual(["blk-3a", "blk-3b"]);
    expect(state.players.p2.grave.length).toBe(2 + 2); // blk2 + bulwark4 + 2点直接ダメージ
    // att1 の直接ダメージ (2点)
    expect(state.players.p2.life.length).toBe(4); // 6 - 2 = 4
    // 全生存ユニットの battle が cleanup されていること
    expect(att1.battle).toBeUndefined();
    expect(att2.battle).toBeUndefined();
    expect(att4.battle).toBeUndefined();
    expect(blk3a.battle).toBeUndefined();
    expect(blk3b.battle).toBeUndefined();
  });

  it("Test R: 0-attacker damageJudge resolves cleanly as no-op without throwing", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(damageJudgeAction, context);
    expect(() => {
      registry.resolveTopRequest(context);
    }).not.toThrow();
    expect(req.status).toBe("resolved");
  });

  it("Test S: Blocker eliminated before damageJudge causes attacker to be treated as unblocked", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "3", value: 3 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(attacker);
    // blocker は事前に墓地へ移動したため field に存在しない

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // unblocked として 3点直接ダメージ
    expect(state.players.p2.life.length).toBe(3); // 6 - 3 = 3
    expect(state.players.p1.field.length).toBe(1);
    expect(attacker.battle).toBeUndefined();
  });

  it("Test T: Attacker eliminated before damageJudge leaves orphan blocker surviving and cleans up battle", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const orphanBlocker = {
      unitId: "u-blk-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-1", suit: "C", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-missing" },
    };
    state.players.p2.field.push(orphanBlocker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // orphan blocker は墓地に送られず生存し、battle が削除される
    expect(state.players.p2.field.length).toBe(1);
    expect(orphanBlocker.battle).toBeUndefined();
  });

  it("Test V: Legacy card unit sent to grave by damageJudge triggers nextGeneration via TriggerResolver", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    // p1 のライフに Joker を配置
    state.players.p1.life = [
      { id: "l-joker", suit: "Joker", rank: "Joker", value: 20 }
    ];

    // p1 の Legacy 兵士 (J)
    const legacyAttacker = {
      unitId: "u-att-legacy",
      kind: "英雄",
      componentId: "character.hero",
      state: "drive",
      cards: [{ id: "c-legacy-J", suit: "S", rank: "J", value: 11 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    // p2 の強力なブロッカー (13)
    const strongBlocker = {
      unitId: "u-blk-strong",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-K", suit: "C", rank: "K", value: 13 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "u-att-legacy" },
    };
    state.players.p1.field.push(legacyAttacker);
    state.players.p2.field.push(strongBlocker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // legacyAttacker が墓地へ送られたことにより、世代交代が requestBuffer に積まれること
    expect(state.requestBuffer.requests.length).toBe(1);
    expect(state.requestBuffer.requests[0].actionId).toBe("action.nextGeneration");
  });

  it("Test W: Direct damage (life -> grave) does NOT trigger nextGeneration even if legacy card is damaged", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    // p2 のライフに Legacy カード (K) を配置
    state.players.p2.life = [
      { id: "l-legacy-K", suit: "S", rank: "K", value: 13 }
    ];

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "2", value: 2 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(attacker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // direct damage による life -> grave では世代交代は誘発しない (fromZone: "life")
    expect(state.requestBuffer.requests.length).toBe(0);
  });

  it("Test X: actionResolved(action.damageJudge) is emitted exactly once via CommandRegistry, not directly from judgeDamageHandler", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(attacker);

    const emittedEvents: string[] = [];
    const originalDispatch = registry.getEffectInterpreter().dispatchEvent.bind(registry.getEffectInterpreter());
    registry.getEffectInterpreter().dispatchEvent = (event: any, ctx: any) => {
      if (event.type === "actionResolved") {
        emittedEvents.push(event.payload.actionId);
      }
      originalDispatch(event, ctx);
    };

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    expect(req.status).toBe("resolved");
    // actionResolved は CommandRegistry 経由で 1 回だけ発行されること
    expect(emittedEvents.filter((id) => id === "action.damageJudge").length).toBe(1);
  });

  it("Test Y: calculate-then-apply separation ensures preceding combat graveyard mutation does not affect succeeding combat size evaluation", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    // Attacker 1: 兵士 (size 4) vs Blocker 1 (size 6 -> att1 loses and dies)
    const att1 = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-1", suit: "S", rank: "4", value: 4 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blk1 = {
      unitId: "blk-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-1", suit: "C", rank: "6", value: 6 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-1" },
    };

    // Attacker 2: 兵士 (size 5) vs Blocker 2 (size 5 -> draw, both die)
    const att2 = {
      unitId: "att-2",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-2", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blk2 = {
      unitId: "blk-2",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-2", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-2" },
    };

    state.players.p1.field.push(att1, att2);
    state.players.p2.field.push(blk1, blk2);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // att1 は死亡、att2 も死亡
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(2);
    // blk1 は生存、blk2 は死亡
    expect(state.players.p2.field.map((u: any) => u.unitId)).toEqual(["blk-1"]);
    expect(state.players.p2.grave.length).toBe(1);
    expect(blk1.battle).toBeUndefined();
  });

  it("Test Z: ActionRequestValidator does NOT reject damageJudge request when 0 attackers on field", () => {
    const validator = new ActionRequestValidator();
    const state = createBaseState();

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      triggered: true,
    };

    // アタッカー0体でもバリデーション例外がスローされないこと
    expect(() => {
      validator.validateActionRequest(damageJudgeAction, context);
    }).not.toThrow();
  });
});
