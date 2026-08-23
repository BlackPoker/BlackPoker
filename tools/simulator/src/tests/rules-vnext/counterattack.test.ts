import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TriggerProcessingCoordinator } from "../../engine/rules/TriggerProcessingCoordinator";

describe("Counterattack Action Integration Tests (Phase 18)", () => {
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

  it("Test A: p2 face-up Fortress & bulwark mismatch -> counterattack triggers and deals 2 damage to p1", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    // p2 表向き要塞
    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      name: "要塞",
      face: "up",
      zone: "trump",
    });

    // p1 アタッカー: rank 6 (size 6)
    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    // p2 防壁: rank 5 (不一致)
    const bulwark = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-1" },
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

    // damageJudge の実行
    const djReq = registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // damageJudge により p2 防壁が墓地へ移動し、反撃が requestBuffer に積まれる
    expect(state.requestBuffer.requests.length).toBe(1);
    expect(state.requestBuffer.requests[0].actionId).toBe("action.counterattack");
    expect(state.requestBuffer.requests[0].controller).toBe("p2");
    expect(state.requestBuffer.requests[0].definitionOwner).toBe("p2");

    // 即時誘発の処理
    const procResult = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(procResult.immediateResolvedCount).toBe(1);

    // p1 は反撃により 2 点ダメージを受ける (初期4枚 -> 2枚)
    expect(state.players.p1.life.length).toBe(2);
    expect(state.players.p1.grave.length).toBe(2);
  });

  it("Test B: Bulwark matched (both attacker and bulwark die) -> counterattack still deals 2 damage to p1 attacker owner", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      name: "要塞",
      face: "up",
      zone: "trump",
    });

    // p1 アタッカー: rank 8
    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    // p2 防壁: rank 8 (一致 -> アタッカーも墓地へ)
    const bulwark = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw", suit: "H", rank: "8", value: 8 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-1" },
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

    // アタッカー・防壁双方が死亡
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p2.field.length).toBe(0);

    // 即時解決
    coordinator.processPendingTriggers(state, rulePackage, registry);

    // アタッカーが既に場に存在しなくても、アタッカーオーナー (p1) へ 2 点ダメージ
    expect(state.players.p1.life.length).toBe(2);
  });

  it("Test C: Without Fortress -> counterattack does NOT trigger", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    // 要塞なし
    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-1" },
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

    // 要塞がないため反撃は誘発しない
    expect(state.requestBuffer.requests.length).toBe(0);
  });

  it("Test D: Fortress face down -> counterattack does NOT trigger", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    // 要塞が裏向き
    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      name: "要塞",
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
    const bulwark = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-1" },
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

    // 要塞が裏向きのため反撃は誘発しない
    expect(state.requestBuffer.requests.length).toBe(0);
  });

  it("Test E: Bulwark field -> grave outside of damageJudge (e.g. destroyBulwark) -> does NOT trigger counterattack", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      name: "要塞",
      face: "up",
      zone: "trump",
    });

    const bulwark = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "charge",
      cards: [{ id: "c-bw", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
    };
    state.players.p2.field.push(bulwark);

    // p1 手札に防壁破壊のキーカード (♡A + ♢A) を用意
    const keyCards = [
      { id: "k-heart-A", suit: "H", rank: "A", value: 1 },
      { id: "k-diamond-A", suit: "D", rank: "A", value: 1 },
    ];
    state.players.p1.hand.push(...keyCards);

    // destroyBulwark の実行
    const destroyAction = rulePackage.actions.find((a) => a.id === "action.destroyBulwark")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards,
      targetComponent: bulwark,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(destroyAction, context);
    registry.resolveTopRequest(context);

    // 防壁は墓地へ行くが、damageJudge 起因ではないため反撃は誘発しない
    expect(state.players.p2.grave.length).toBe(1);
    expect(state.requestBuffer.requests.filter((r: any) => r.actionId === "action.counterattack").length).toBe(0);
  });

  it("Test F: Bulwark moved to grave with cause=damageJudge but combat.role != blocker -> does NOT trigger counterattack", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      name: "要塞",
      face: "up",
      zone: "trump",
    });

    const bulwark = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "attacker", targetPlayerKey: "p1" }, // blocker ではなく attacker
    };
    state.players.p2.field.push(bulwark);

    const event = {
      type: "cardMoved",
      payload: {
        card: bulwark.cards[0],
        fromZone: "field",
        toZone: "grave",
        playerKey: "p2",
        characterType: "bulwark",
        cause: { actionId: "action.damageJudge", command: "judgeDamage" },
        combat: { role: "attacker" }, // blocker ではない
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.triggerResolver.resolveTriggers(event, context);

    // combat.role が blocker でないため反撃は誘発しない
    expect(state.requestBuffer.requests.filter((r: any) => r.actionId === "action.counterattack").length).toBe(0);
  });

  it("Test G: Two bulwarks moved to grave in same damageJudge -> triggers counterattack twice for 4 total damage", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      name: "要塞",
      face: "up",
      zone: "trump",
    });

    // 2体のアタッカー
    const att1 = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const att2 = {
      unitId: "att-2",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att-2", suit: "D", rank: "7", value: 7 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };

    // 2体の防壁
    const bw1 = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-1", suit: "H", rank: "2", value: 2 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-1" },
    };
    const bw2 = {
      unitId: "bw-2",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw-2", suit: "C", rank: "3", value: 3 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-2" },
    };

    state.players.p1.field.push(att1, att2);
    state.players.p2.field.push(bw1, bw2);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 2体の防壁が墓地へ行ったため、反撃が 2 件バッファに積まれる
    expect(state.requestBuffer.requests.length).toBe(2);
    expect(state.requestBuffer.requests.every((r: any) => r.actionId === "action.counterattack")).toBe(true);

    // 即時誘発処理
    const procResult = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(procResult.immediateResolvedCount).toBe(2);

    // 2 + 2 = 4 点ダメージで p1 のライフは 4 -> 0
    expect(state.players.p1.life.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(4);
  });

  it("Test H & I & J & K: Counterattack metadata, history, chancePlayer preservation, single actionResolved emission", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      name: "要塞",
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
    const bulwark = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-1" },
    };

    state.players.p1.field.push(attacker);
    state.players.p2.field.push(bulwark);

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

    // Test H: controller & definitionOwner は防壁オーナー (p2)
    const counterReq = state.requestBuffer.requests[0];
    expect(counterReq.controller).toBe("p2");
    expect(counterReq.definitionOwner).toBe("p2");

    // 即時解決
    coordinator.processPendingTriggers(state, rulePackage, registry);

    // Test I: immediate なので stage.requests には残らず、stage.history に resolved として残る
    expect(state.stage.requests.length).toBe(0);
    const resolvedCounterReq = state.stage.history.find((r: any) => r.actionId === "action.counterattack");
    expect(resolvedCounterReq).toBeDefined();
    expect(resolvedCounterReq.status).toBe("resolved");

    // Test J: chancePlayer は不変
    expect(state.chancePlayer).toBe(initialChance);

    // Test K: actionResolved(action.counterattack) は 1 回のみ発行
    expect(emittedEvents.filter((id) => id === "action.counterattack").length).toBe(1);
  });

  it("Test L: Counterattack damage moving life -> grave does NOT trigger nextGeneration", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      name: "要塞",
      face: "up",
      zone: "trump",
    });

    // p1 のライフに遺産カード (J) を配置
    state.players.p1.life = [
      { id: "l-legacy", suit: "S", rank: "J", value: 11 },
      { id: "l-2", suit: "H", rank: "3", value: 3 },
    ];

    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwark = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-1" },
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

    // counterattack を解決（p1 のライフから J が墓地へ移動）
    coordinator.processPendingTriggers(state, rulePackage, registry);

    // life -> grave 移動のため、世代交代 (nextGeneration) は誘発しない
    expect(state.requestBuffer.requests.filter((r: any) => r.actionId === "action.nextGeneration").length).toBe(0);
  });
});
