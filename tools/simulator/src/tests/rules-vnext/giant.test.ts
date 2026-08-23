import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TriggerProcessingCoordinator } from "../../engine/rules/TriggerProcessingCoordinator";

describe("Giant Character & Bulwark Resistance Integration Tests (Phase 20)", () => {
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

  it("Test A: Giant vs K Bulwark -> bulwarkMatched=true, Giant survives, Bulwark dies, attackerGravePrevented=true", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const giant = {
      unitId: "giant-1",
      componentId: "character.giant",
      kind: "巨人",
      state: "drive",
      cards: [
        { id: "c-giant-h", suit: "H", rank: "K", value: 13 },
        { id: "c-giant-d", suit: "D", rank: "K", value: 13 },
      ],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "bw-k",
      componentId: "character.bulwark",
      kind: "防壁",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-k", suit: "S", rank: "K", value: 13 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "giant-1" },
    };

    state.players.p1.field.push(giant);
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
    expect(combat.bulwarkRevealed).toBe(true);
    expect(combat.bulwarkMatched).toBe(true);
    expect(combat.attackerMovedToGrave).toBe(false);
    expect(combat.attackerGravePrevented).toBe(true);
    expect(combat.blockersMovedToGrave).toEqual(["bw-k"]);

    // 盤面状態の検証
    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p1.field[0].unitId).toBe("giant-1");
    expect(state.players.p1.field[0].battle).toBeUndefined(); // cleanup 済み
    expect(state.players.p1.grave.length).toBe(0);

    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1); // 防壁は墓地へ
  });

  it("Test B: Giant vs Joker Bulwark -> bulwarkMatched=true, Giant survives, Bulwark dies, attackerGravePrevented=true", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const giant = {
      unitId: "giant-1",
      componentId: "character.giant",
      kind: "巨人",
      state: "drive",
      cards: [
        { id: "c-giant-h", suit: "H", rank: "K", value: 13 },
        { id: "c-giant-d", suit: "D", rank: "K", value: 13 },
      ],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const jokerBulwark = {
      unitId: "bw-joker",
      componentId: "character.bulwark",
      kind: "防壁",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-joker", suit: "Joker", rank: "Joker", value: 20 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "giant-1" },
    };

    state.players.p1.field.push(giant);
    state.players.p2.field.push(jokerBulwark);

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
    expect(combat.bulwarkMatched).toBe(true);
    expect(combat.attackerMovedToGrave).toBe(false);
    expect(combat.attackerGravePrevented).toBe(true);
    expect(combat.blockersMovedToGrave).toEqual(["bw-joker"]);

    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
  });

  it("Test C: Giant vs non-matching Bulwark (5) -> bulwarkMatched=false, Giant survives, attackerGravePrevented is undefined", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const giant = {
      unitId: "giant-1",
      componentId: "character.giant",
      kind: "巨人",
      state: "drive",
      cards: [
        { id: "c-giant-h", suit: "H", rank: "K", value: 13 },
        { id: "c-giant-d", suit: "D", rank: "K", value: 13 },
      ],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "bw-5",
      componentId: "character.bulwark",
      kind: "防壁",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-5", suit: "S", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "giant-1" },
    };

    state.players.p1.field.push(giant);
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
    expect(combat.bulwarkMatched).toBe(false);
    expect(combat.attackerMovedToGrave).toBe(false);
    expect(combat.attackerGravePrevented).toBeUndefined(); // 能力発動ではなく通常生存
    expect(combat.blockersMovedToGrave).toEqual(["bw-5"]);

    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
  });

  it("Test D: Normal soldier (with K) vs matching Bulwark K -> attacker dies (ability does not leak)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const normalSoldier = {
      unitId: "soldier-k",
      componentId: "character.soldier",
      kind: "一般兵",
      state: "drive",
      cards: [{ id: "c-k", suit: "H", rank: "K", value: 13 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "bw-k",
      componentId: "character.bulwark",
      kind: "防壁",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-k", suit: "S", rank: "K", value: 13 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "soldier-k" },
    };

    state.players.p1.field.push(normalSoldier);
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
    expect(combat.bulwarkMatched).toBe(true);
    expect(combat.attackerMovedToGrave).toBe(true); // 死亡
    expect(combat.attackerGravePrevented).toBeUndefined();

    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
  });

  it("Test E: Generic unit modifier test (works with custom ComponentDefinition)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const customComponents = [
      ...rulePackage.components,
      {
        id: "character.testSurvivor",
        name: "防壁耐性兵士",
        type: "character",
        zone: "field",
        abilities: [
          {
            damageJudgeModifier: {
              matchup: "soldierVsBulwark",
              rule: "preserveAttackerOnMatchedBulwark",
            },
          },
        ],
      },
    ];

    const testSurvivor = {
      unitId: "survivor-1",
      componentId: "character.testSurvivor",
      state: "drive",
      cards: [{ id: "c-7", suit: "H", rank: "7", value: 7 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "bw-7",
      componentId: "character.bulwark",
      kind: "防壁",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-7", suit: "S", rank: "7", value: 7 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "survivor-1" },
    };

    state.players.p1.field.push(testSurvivor);
    state.players.p2.field.push(bulwark);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: customComponents as any,
    };

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.bulwarkMatched).toBe(true);
    expect(combat.attackerMovedToGrave).toBe(false);
    expect(combat.attackerGravePrevented).toBe(true);

    expect(state.players.p1.field.length).toBe(1);
  });

  it("Test F: Missing ComponentDefinition -> attacker dies without synthesis", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const giant = {
      unitId: "giant-1",
      componentId: "character.giant",
      kind: "巨人",
      state: "drive",
      cards: [
        { id: "c-giant-h", suit: "H", rank: "K", value: 13 },
        { id: "c-giant-d", suit: "D", rank: "K", value: 13 },
      ],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "bw-k",
      componentId: "character.bulwark",
      kind: "防壁",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-k", suit: "S", rank: "K", value: 13 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "giant-1" },
    };

    state.players.p1.field.push(giant);
    state.players.p2.field.push(bulwark);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: [], // 定義を渡さない
    };

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    const combat = req.result!.damageJudge!.combats[0];
    expect(combat.bulwarkMatched).toBe(true);
    expect(combat.attackerMovedToGrave).toBe(true); // 定義がなければ死亡
    expect(combat.attackerGravePrevented).toBeUndefined();

    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1); // 巨人ユニットが墓地へ
    expect(state.players.p1.grave[0].cards.length).toBe(2); // 構成カードは2枚
  });

  it("Test G: Multiple attackers individual evaluation (Giant survives, normal soldier dies)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const giant = {
      unitId: "giant-1",
      componentId: "character.giant",
      state: "drive",
      cards: [
        { id: "c-giant-h", suit: "H", rank: "K", value: 13 },
        { id: "c-giant-d", suit: "D", rank: "K", value: 13 },
      ],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const normalSoldier = {
      unitId: "soldier-5",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-5", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };

    const bulwarkK = {
      unitId: "bw-k",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-k", suit: "H", rank: "K", value: 13 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "giant-1" },
    };
    const bulwark5 = {
      unitId: "bw-5",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-5", suit: "C", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "soldier-5" },
    };

    state.players.p1.field.push(giant, normalSoldier);
    state.players.p2.field.push(bulwarkK, bulwark5);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    expect(req.result!.damageJudge!.combats.length).toBe(2);

    const giantCombat = req.result!.damageJudge!.combats.find((c) => c.attackerUnitId === "giant-1")!;
    expect(giantCombat.attackerMovedToGrave).toBe(false);
    expect(giantCombat.attackerGravePrevented).toBe(true);

    const normalCombat = req.result!.damageJudge!.combats.find((c) => c.attackerUnitId === "soldier-5")!;
    expect(normalCombat.attackerMovedToGrave).toBe(true);
    expect(normalCombat.attackerGravePrevented).toBeUndefined();

    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p1.field[0].unitId).toBe("giant-1");
  });

  it("Test H: Revolution active does NOT interfere with Giant vs Bulwark", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const giant = {
      unitId: "giant-1",
      componentId: "character.giant",
      state: "drive",
      cards: [
        { id: "c-giant-h", suit: "H", rank: "K", value: 13 },
        { id: "c-giant-d", suit: "D", rank: "K", value: 13 },
      ],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "bw-k",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-k", suit: "S", rank: "K", value: 13 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "giant-1" },
    };

    state.players.p1.field.push(giant);
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
    expect(combat.attackerMovedToGrave).toBe(false);
    expect(combat.attackerGravePrevented).toBe(true);
    expect(combat.differenceDamage).toBeUndefined(); // 革命差分ダメージなし
  });

  it("Test I: Counterattack integration (Giant survives, Bulwark dies -> counterattack triggers and resolves)", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    // p2 に表向き要塞
    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      face: "up",
      zone: "trump",
    });

    const giant = {
      unitId: "giant-1",
      componentId: "character.giant",
      state: "drive",
      cards: [
        { id: "c-giant-h", suit: "H", rank: "K", value: 13 },
        { id: "c-giant-d", suit: "D", rank: "K", value: 13 },
      ],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "bw-k",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-k", suit: "S", rank: "K", value: 13 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "giant-1" },
    };

    state.players.p1.field.push(giant);
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

    // 防壁死亡により p2 の action.counterattack が誘発 (K防壁なので nextGeneration も誘発)
    const counterReq = state.requestBuffer.requests.find((r: any) => r.actionId === "action.counterattack");
    expect(counterReq).toBeDefined();
    expect(counterReq.controller).toBe("p2");

    // 反撃を即時解決
    coordinator.processPendingTriggers(state, rulePackage, registry);

    // p1 へ 2 点ダメージ (初期4枚 -> 2枚)
    expect(state.players.p1.life.length).toBe(2);
    // 巨人は field に生存
    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p1.field[0].unitId).toBe("giant-1");
  });

  it("Test J: Giant unblocked deals 26 direct damage (current size 13 + 13 = 26)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const giant = {
      unitId: "giant-1",
      componentId: "character.giant",
      state: "drive",
      cards: [
        { id: "c-giant-h", suit: "H", rank: "K", value: 13 },
        { id: "c-giant-d", suit: "D", rank: "K", value: 13 },
      ],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(giant);

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
    expect(combat.directDamageAmount).toBe(26);
    expect(state.players.p2.life.length).toBe(0); // 4 - 26 = 0
  });

  it("Test K: Giant vs soldier blocker (size 5) -> normal size comparison (blocker dies, Giant survives)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const giant = {
      unitId: "giant-1",
      componentId: "character.giant",
      state: "drive",
      cards: [
        { id: "c-giant-h", suit: "H", rank: "K", value: 13 },
        { id: "c-giant-d", suit: "D", rank: "K", value: 13 },
      ],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "blk-5",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-blk-5", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "giant-1" },
    };

    state.players.p1.field.push(giant);
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
    expect(combat.combatType).toBe("soldierVsSoldiers");
    expect(combat.attackerInitialSize).toBe(26);
    expect(combat.blockerInitialTotalSize).toBe(5);
    expect(combat.attackerMovedToGrave).toBe(false);
    expect(combat.blockersMovedToGrave).toEqual(["blk-5"]);
    expect(combat.attackerGravePrevented).toBeUndefined(); // 通常サイズ比較勝利による生存

    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
  });
});
