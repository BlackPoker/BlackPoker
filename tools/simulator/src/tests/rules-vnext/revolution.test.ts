import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TriggerProcessingCoordinator } from "../../engine/rules/TriggerProcessingCoordinator";

describe("Revolution & Revolution Draw Integration Tests (Phase 19)", () => {
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
            { id: "l1-4", suit: "C", rank: "5", value: 5 },
          ],
          hand: [],
          field: [],
          fog: [],
          trump: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l2-1", suit: "C", rank: "5", value: 5 },
            { id: "l2-2", suit: "S", rank: "6", value: 6 },
            { id: "l2-3", suit: "H", rank: "7", value: 7 },
            { id: "l2-4", suit: "D", rank: "8", value: 8 },
          ],
          hand: [],
          field: [],
          fog: [],
          trump: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    } as any;
  };

  // ==========================================
  // 1. 革命 damageJudge テスト (Test A〜J)
  // ==========================================

  it("Test A: No revolution -> normal rule (attacker 8 vs blocker 5 -> blocker dies, attacker survives)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "att-8",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-8", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "blk-5",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-5", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-8" },
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

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.ruleVariant).toBe("normal");
    expect(combat.attackerMovedToGrave).toBe(false);
    expect(combat.blockersMovedToGrave).toEqual(["blk-5"]);
    expect(combat.differenceDamage).toBeUndefined();

    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
    expect(state.players.p1.life.length).toBe(4);
    expect(state.players.p2.life.length).toBe(4);
  });

  it("Test B: p1 Revolution face-up -> attacker 8 vs blocker 5 -> attacker dies and takes 3 difference damage", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      name: "革命",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-8",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-8", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "blk-5",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-5", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-8" },
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

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.ruleVariant).toBe("revolution");
    expect(combat.attackerMovedToGrave).toBe(true); // 大きい attacker が死亡
    expect(combat.blockersMovedToGrave).toEqual([]);
    expect(combat.differenceDamage).toEqual({ amount: 3, targetPlayerKey: "p1" });

    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(4); // 死亡アタッカー(1) + 3点ダメージ(3) = 4
    expect(state.players.p1.life.length).toBe(1); // 初期4枚 - 3点ダメージ = 1枚
    expect(state.players.p2.field.length).toBe(1); // blocker 生存
    expect(state.players.p2.life.length).toBe(4);
  });

  it("Test C: Revolution face-up -> attacker 5 vs blockers [3, 4] -> all blockers die and p2 takes 2 difference damage", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-5",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-5", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blk1 = {
      unitId: "blk-3",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-3", suit: "H", rank: "3", value: 3 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-5" },
    };
    const blk2 = {
      unitId: "blk-4",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-4", suit: "D", rank: "4", value: 4 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-5" },
    };

    state.players.p1.field.push(attacker);
    state.players.p2.field.push(blk1, blk2);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.ruleVariant).toBe("revolution");
    expect(combat.attackerMovedToGrave).toBe(false); // 小さい attacker は生存
    expect(combat.blockersMovedToGrave).toEqual(["blk-3", "blk-4"]); // 大きい blocker 陣営 (3+4=7) が全滅
    expect(combat.differenceDamage).toEqual({ amount: 2, targetPlayerKey: "p2" }); // 7 - 5 = 2 点ダメージ

    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.life.length).toBe(2); // 初期4枚 - 2点ダメージ = 2枚
    expect(state.players.p2.grave.length).toBe(4); // 死亡ブロッカー(2) + 2点ダメージ(2) = 4
  });

  it("Test D: Revolution face-up -> 7 vs 7 -> both die and 0 damage", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-7",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-7", suit: "S", rank: "7", value: 7 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "blk-7",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-7", suit: "H", rank: "7", value: 7 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-7" },
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

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.ruleVariant).toBe("revolution");
    expect(combat.attackerMovedToGrave).toBe(true);
    expect(combat.blockersMovedToGrave).toEqual(["blk-7"]);
    expect(combat.differenceDamage).toBeUndefined();

    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p1.life.length).toBe(4);
    expect(state.players.p2.life.length).toBe(4);
  });

  it("Test E: Only p2 has Revolution face-up -> applies revolution rule to p1 attack as well", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    // p2 のみが表向き革命を保持
    state.players.p2.trump.push({
      id: "trump-rev-p2",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-8",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-8", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "blk-5",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-5", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-8" },
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

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 全体適用のため革命ルールになる
    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.ruleVariant).toBe("revolution");
    expect(combat.attackerMovedToGrave).toBe(true);
    expect(combat.differenceDamage).toEqual({ amount: 3, targetPlayerKey: "p1" });
  });

  it("Test F: Revolution face-down -> normal rule", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "down",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-8",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-8", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "blk-5",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-5", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-8" },
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

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.ruleVariant).toBe("normal");
    expect(combat.attackerMovedToGrave).toBe(false);
    expect(combat.blockersMovedToGrave).toEqual(["blk-5"]);
  });

  it("Test G: Both players have Revolution face-up -> revolution applied only once (no doubled damage)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });
    state.players.p2.trump.push({
      id: "trump-rev-p2",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-8",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-8", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "blk-5",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-5", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-8" },
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

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.ruleVariant).toBe("revolution");
    expect(combat.differenceDamage).toEqual({ amount: 3, targetPlayerKey: "p1" });
    expect(state.players.p1.life.length).toBe(1); // 4 - 3 = 1 (二重ダメージの 6点 ではない)
  });

  it("Test H: Revolution face-up vs bulwark -> bulwark rules remain unaffected", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-8",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-8", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "bw-5",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-5", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-8" },
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

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.combatType).toBe("soldierVsBulwark");
    expect(combat.attackerMovedToGrave).toBe(false); // 不一致で生存
    expect(combat.blockersMovedToGrave).toEqual(["bw-5"]); // 防壁は墓地へ
  });

  it("Test I: Revolution face-up vs unblocked soldier -> deals current size direct damage without modification", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-6",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-6", suit: "S", rank: "6", value: 6 }],
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

    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.combatType).toBe("unblocked");
    expect(combat.directDamageAmount).toBe(6);
    expect(state.players.p2.life.length).toBe(0); // 4 - 6 = 0
  });

  it("Test J: CURRENT SIZE regression test (printed 6 with +3 fog -> current size 9 vs blocker 8 -> attacker 9 dies under revolution)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-6-boosted",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-6", suit: "S", rank: "6", value: 6 }], // printed 6
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    // p1 の fog で +3 補正 (current size: 6 + 3 = 9)
    state.players.p1.fog.push({
      fogId: "fog-boost",
      bindings: { target: "att-6-boosted", amount: 3 },
    });

    const blocker = {
      unitId: "blk-8",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-8", suit: "H", rank: "8", value: 8 }], // current size: 8
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-6-boosted" },
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

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 9 (attacker) vs 8 (blocker) -> 革命下では大きい 9 (attacker) が死亡、差分 1 点ダメージを p1 へ
    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.attackerInitialSize).toBe(9);
    expect(combat.blockerInitialTotalSize).toBe(8);
    expect(combat.attackerMovedToGrave).toBe(true);
    expect(combat.blockersMovedToGrave).toEqual([]);
    expect(combat.differenceDamage).toEqual({ amount: 1, targetPlayerKey: "p1" });

    expect(state.players.p1.life.length).toBe(3); // 4 - 1 = 3
    expect(state.players.p2.field.length).toBe(1); // blocker 生存
  });

  // ==========================================
  // 2. 革命ドロー テスト (Test K〜W)
  // ==========================================

  it("Test K: p1 Revolution face-up & 1 unblocked soldier -> triggers 1 revolutionDraw and draws 1 card", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
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

    // 1体の未ブロック兵士により revolutionDraw が 1件バッファに積まれる
    expect(state.requestBuffer.requests.length).toBe(1);
    expect(state.requestBuffer.requests[0].actionId).toBe("action.revolutionDraw");
    expect(state.requestBuffer.requests[0].controller).toBe("p1");

    // 即時解決
    const procResult = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(procResult.immediateResolvedCount).toBe(1);

    // ライフから1枚引いて手札に入る
    expect(state.players.p1.hand.length).toBe(1);
    expect(state.players.p1.hand[0].rank).toBe("2");
    expect(state.players.p1.life.length).toBe(3);
  });

  it("Test L: 2 unblocked soldiers -> triggers 2 revolutionDraw and draws 2 cards", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const att1 = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "3", value: 3 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const att2 = {
      unitId: "att-2",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-2", suit: "H", rank: "4", value: 4 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(att1, att2);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 2体の未ブロック兵士から 2件の revolutionDraw が積まれる
    expect(state.requestBuffer.requests.length).toBe(2);
    expect(state.requestBuffer.requests.every((r: any) => r.actionId === "action.revolutionDraw")).toBe(true);

    coordinator.processPendingTriggers(state, rulePackage, registry);

    expect(state.players.p1.hand.length).toBe(2);
    expect(state.players.p1.life.length).toBe(2);
  });

  it("Test M: 1 unblocked soldier & 1 blocked soldier -> triggers only 1 revolutionDraw", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const unblockedAtt = {
      unitId: "att-unblocked",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "3", value: 3 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blockedAtt = {
      unitId: "att-blocked",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-2", suit: "H", rank: "4", value: 4 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "blk-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-1", suit: "D", rank: "4", value: 4 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-blocked" },
    };

    state.players.p1.field.push(unblockedAtt, blockedAtt);
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

    // unblocked 兵士の 1件のみ
    expect(state.requestBuffer.requests.length).toBe(1);
    expect(state.requestBuffer.requests[0].actionId).toBe("action.revolutionDraw");

    coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(state.players.p1.hand.length).toBe(1);
  });

  it("Test N: p1 has no Revolution -> 0 revolutionDraw triggers", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
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

    expect(state.requestBuffer.requests.filter((r: any) => r.actionId === "action.revolutionDraw").length).toBe(0);
  });

  it("Test O: p1 Revolution face-down -> 0 revolutionDraw triggers", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "down",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
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

    expect(state.requestBuffer.requests.filter((r: any) => r.actionId === "action.revolutionDraw").length).toBe(0);
  });

  it("Test P: Only p2 has Revolution -> p1 unblocked attacker does NOT get revolutionDraw", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-rev-p2",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
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

    expect(state.requestBuffer.requests.filter((r: any) => r.actionId === "action.revolutionDraw").length).toBe(0);
  });

  it("Test Q: Equipped soldier (2 cards) unblocked -> triggers exactly 1 revolutionDraw", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const equippedAttacker = {
      unitId: "equipped-att",
      componentId: "character.soldier",
      state: "drive",
      cards: [
        { id: "c-1", suit: "S", rank: "3", value: 3 },
        { id: "c-2", suit: "D", rank: "8", value: 8 },
      ],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(equippedAttacker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 装備兵 1体につき 1件
    expect(state.requestBuffer.requests.filter((r: any) => r.actionId === "action.revolutionDraw").length).toBe(1);
  });

  it("Test R: 0 attackers -> 0 revolutionDraw triggers", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    expect(state.requestBuffer.requests.filter((r: any) => r.actionId === "action.revolutionDraw").length).toBe(0);
  });

  it("Test S: Blocker eliminated before damageJudge -> combatType becomes unblocked and triggers revolutionDraw", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(attacker);

    // ブロッカーは既に場に存在しない（p2.field は空）
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    expect(state.requestBuffer.requests.filter((r: any) => r.actionId === "action.revolutionDraw").length).toBe(1);
  });

  it("Test T & U & V: Controller/definitionOwner, immediate resolution, chancePlayer preservation, single actionResolved emission", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
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

    const initialChance = state.chancePlayer;
    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // Test T: controller & definitionOwner は p1
    const revReq = state.requestBuffer.requests[0];
    expect(revReq.controller).toBe("p1");
    expect(revReq.definitionOwner).toBe("p1");
    expect(revReq.triggerBindings?.combat).toBeDefined();

    // 即時解決
    coordinator.processPendingTriggers(state, rulePackage, registry);

    // Test U: stage.requests には残らず、stage.history に resolved として記録
    expect(state.stage.requests.length).toBe(0);
    const resolvedRevReq = state.stage.history.find((r: any) => r.actionId === "action.revolutionDraw");
    expect(resolvedRevReq).toBeDefined();
    expect(resolvedRevReq.status).toBe("resolved");
    expect(state.chancePlayer).toBe(initialChance);

    // Test V: actionResolved(action.revolutionDraw) は 1 回のみ発行
    expect(emittedEvents.filter((id) => id === "action.revolutionDraw").length).toBe(1);
  });

  it("Test W: life=0 -> draws 0 cards, resolves normally, and emits actionResolved", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    state.players.p1.life = []; // ライフ0枚

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
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

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 解決
    const procResult = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(procResult.immediateResolvedCount).toBe(1);
    expect(state.players.p1.hand.length).toBe(0); // 0枚ドロー
    expect(emittedEvents.filter((id) => id === "action.revolutionDraw").length).toBe(1);
  });
});
