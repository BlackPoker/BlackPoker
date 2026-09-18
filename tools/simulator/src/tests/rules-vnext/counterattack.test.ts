import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TriggerProcessingCoordinator } from "../../engine/rules/TriggerProcessingCoordinator";
import { GraveTopCoordinator } from "../../engine/rules/GraveTopCoordinator";
import { GameSession, TRIGGER_IMMEDIATE_FINALIZATION_STEP_ID } from "../../engine/session/GameSession";
import { StateHasher } from "../../engine/simulation/StateHasher";

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

    // 即時誘発の処理（R3: 墓地TOP選択保留により解決確定は遅延される）
    const procResult = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(procResult.immediateResolvedCount).toBe(0);
    expect(procResult.interruptedImmediateResolution).toBeDefined();
    expect(procResult.interruptedImmediateResolution!.request.status).toBe("resolving");
    expect(state.pendingGraveTopSelections?.length).toBe(1);
    expect(state.stage.history.some((r: any) => r.actionId === "action.counterattack")).toBe(false);
    expect(state.requestBuffer.history.some((h: any) => h.status === "resolvedImmediately")).toBe(false);

    // p1 は反撃により 2 点ダメージを受ける (初期4枚 -> 2枚)
    expect(state.players.p1.life.length).toBe(2);
    expect(state.players.p1.grave.length).toBe(2);

    // 墓地TOP選択を解決
    const pending = state.pendingGraveTopSelections[0];
    GraveTopCoordinator.applyGraveTopSelection(state, pending.playerId, pending.candidateCardIds[0]);

    // 解決確定ヘルパーを呼び出し
    coordinator.finalizeImmediateTriggeredRequest(
      procResult.interruptedImmediateResolution!.request,
      procResult.interruptedImmediateResolution!.context,
      registry
    );

    expect(procResult.interruptedImmediateResolution!.request.status).toBe("resolved");
    expect(state.stage.history.some((r: any) => r.actionId === "action.counterattack")).toBe(true);
    expect(state.stage.history.length).toBe(2); // damageJudge + counterattack
    expect(state.requestBuffer.history.some((h: any) => h.status === "resolvedImmediately")).toBe(true);
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

    // 即時解決の実行（Grave TOP保留により中断）
    const procResult = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(procResult.interruptedImmediateResolution).toBeDefined();

    // アタッカーが既に場に存在しなくても、アタッカーオーナー (p1) へ 2 点ダメージ
    expect(state.players.p1.life.length).toBe(2);

    // 墓地TOP選択と解決確定
    const pending = state.pendingGraveTopSelections[0];
    GraveTopCoordinator.applyGraveTopSelection(state, pending.playerId, pending.candidateCardIds[0]);
    coordinator.finalizeImmediateTriggeredRequest(
      procResult.interruptedImmediateResolution!.request,
      procResult.interruptedImmediateResolution!.context,
      registry
    );
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

    // 即時誘発処理（1件目の反撃実行後、2点ダメージによるGrave TOP選択が発生し一時停止）
    const procResult = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(procResult.immediateResolvedCount).toBe(0);
    expect(procResult.interruptedImmediateResolution).toBeDefined();
    expect(procResult.interruptedImmediateResolution!.request.status).toBe("resolving");
    expect(state.pendingGraveTopSelections?.length).toBe(1);
    // 2件目の反撃はまだバッファに残っており未実行
    expect(state.requestBuffer.requests.length).toBe(1);

    // 1件目の墓地TOP選択を解決
    const pending1 = state.pendingGraveTopSelections[0];
    GraveTopCoordinator.applyGraveTopSelection(state, pending1.playerId, pending1.candidateCardIds[0]);

    // 1件目の反撃を確定
    coordinator.finalizeImmediateTriggeredRequest(
      procResult.interruptedImmediateResolution!.request,
      procResult.interruptedImmediateResolution!.context,
      registry
    );
    expect(procResult.interruptedImmediateResolution!.request.status).toBe("resolved");

    // 2件目の即時誘発処理を実行（2件目の反撃実行後、2点ダメージによるGrave TOP選択が発生し一時停止）
    const procResult2 = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(procResult2.immediateResolvedCount).toBe(0);
    expect(procResult2.interruptedImmediateResolution).toBeDefined();
    expect(procResult2.interruptedImmediateResolution!.request.status).toBe("resolving");
    expect(state.pendingGraveTopSelections?.length).toBe(1);
    expect(state.requestBuffer.requests.length).toBe(0);

    // 2件目の墓地TOP選択を解決
    const pending2 = state.pendingGraveTopSelections[0];
    GraveTopCoordinator.applyGraveTopSelection(state, pending2.playerId, pending2.candidateCardIds[0]);

    // 2件目の反撃を確定
    coordinator.finalizeImmediateTriggeredRequest(
      procResult2.interruptedImmediateResolution!.request,
      procResult2.interruptedImmediateResolution!.context,
      registry
    );
    expect(procResult2.interruptedImmediateResolution!.request.status).toBe("resolved");

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

    // 即時解決（Grave TOP選択保留により中断）
    const procResult = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(procResult.interruptedImmediateResolution).toBeDefined();

    // 決定前は stage.history に追加されず、actionResolved も未発行
    expect(state.stage.history?.some((r: any) => r.actionId === "action.counterattack") ?? false).toBe(false);
    expect(emittedEvents.filter((id) => id === "action.counterattack").length).toBe(0);

    // 墓地TOP選択を適用
    const pending = state.pendingGraveTopSelections[0];
    GraveTopCoordinator.applyGraveTopSelection(state, pending.playerId, pending.candidateCardIds[0]);

    // 解決確定ヘルパーを呼び出し
    coordinator.finalizeImmediateTriggeredRequest(
      procResult.interruptedImmediateResolution!.request,
      procResult.interruptedImmediateResolution!.context,
      registry
    );

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

    // counterattack を実行（p1 のライフから J を含む2枚が墓地へ移動し、Grave TOP保留により中断）
    const procResult = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(procResult.interruptedImmediateResolution).toBeDefined();

    // life -> grave 移動のため、世代交代 (nextGeneration) は誘発しない
    expect(state.requestBuffer.requests.filter((r: any) => r.actionId === "action.nextGeneration").length).toBe(0);

    // 墓地TOP選択と解決確定
    const pending = state.pendingGraveTopSelections[0];
    GraveTopCoordinator.applyGraveTopSelection(state, pending.playerId, pending.candidateCardIds[0]);
    coordinator.finalizeImmediateTriggeredRequest(
      procResult.interruptedImmediateResolution!.request,
      procResult.interruptedImmediateResolution!.context,
      registry
    );
  });

  it("Test M: GameSession Integration - Full counterattack flow with deferred finalization and exact match log sequence", () => {
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

    const session = new GameSession(state, rulePackage, { matchId: "match-ca-int-001" });

    // damageJudge を実行して bulwark を破壊 -> counterattack が requestBuffer に積まれる
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const djContext: CommandContext = {
      state: session.state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      logRecorder: session.logRecorder,
    };
    session.registry.createRequest(damageJudgeAction, djContext);
    session.registry.resolveTopRequest(djContext);

    expect(session.state.requestBuffer.requests.length).toBe(1);
    expect(session.state.requestBuffer.requests[0].actionId).toBe("action.counterattack");

    // advance() を呼ぶと、即時誘発の反撃効果が実行され、2点ダメージで Grave TOP保留となり WAITING_FOR_DECISION に遷移
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") return;

    expect(step1.request.source.type).toBe("ZONE_TOP_SELECTION");
    expect(session.resolvingRequest).toBeDefined();
    expect(session.resolvingRequest.actionId).toBe("action.counterattack");
    expect(session.resolvingRequest.status).toBe("resolving");
    expect(session.continuation?.effectStepId).toBe(TRIGGER_IMMEDIATE_FINALIZATION_STEP_ID);

    // 決定提出前の Match Log を検証
    const logBefore = session.getMatchLog();
    const reqCreatedEvents = logBefore.events.filter((e) => e.type === "request.created" && (e as any).actionRef === "action.counterattack");
    const reqStartedEvents = logBefore.events.filter((e) => e.type === "request.resolve.started" && (e as any).actionRef === "action.counterattack");
    const decReqEvents = logBefore.events.filter((e) => e.type === "decision.requested" && (e as any).source === "ZONE_TOP_SELECTION");
    const reqResolvedEvents = logBefore.events.filter((e) => e.type === "request.resolved" && (e as any).actionRef === "action.counterattack");

    expect(reqCreatedEvents.length).toBe(1);
    expect(reqStartedEvents.length).toBe(1);
    expect(decReqEvents.length).toBe(1);
    // 重要: 決定前は request.resolved が発行されていないこと！
    expect(reqResolvedEvents.length).toBe(0);

    // stage.history にもまだ counterattack は入っていない
    expect(session.state.stage.history.some((r: any) => r.actionId === "action.counterattack")).toBe(false);

    // 墓地TOP選択を提出
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: 0,
    });

    // 決定提出後、counterattack が finalize され、次のステップへ自動進行
    const logAfter = session.getMatchLog();
    const reqResolvedAfter = logAfter.events.filter((e) => e.type === "request.resolved" && (e as any).actionRef === "action.counterattack");
    const decRespEvents = logAfter.events.filter((e) => e.type === "decision.responded");
    const p1ZoneTopEvents = logAfter.events.filter((e) => e.type === "zone.top.changed" && (e as any).playerId === "p1");

    expect(reqResolvedAfter.length).toBe(1);
    expect(decRespEvents.length).toBe(1);
    expect(p1ZoneTopEvents.length).toBe(1);

    // ログ順序の検証: resolve.started -> decision.requested -> decision.responded -> zone.top.changed (p1) -> request.resolved
    const startedIdx = logAfter.events.findIndex((e) => e.type === "request.resolve.started" && (e as any).actionRef === "action.counterattack");
    const decReqIdx = logAfter.events.findIndex((e) => e.type === "decision.requested" && (e as any).source === "ZONE_TOP_SELECTION");
    const decRespIdx = logAfter.events.findIndex((e) => e.type === "decision.responded");
    const zoneTopIdx = logAfter.events.findIndex((e) => e.type === "zone.top.changed" && (e as any).playerId === "p1");
    const resolvedIdx = logAfter.events.findIndex((e) => e.type === "request.resolved" && (e as any).actionRef === "action.counterattack");

    expect(startedIdx).toBeLessThan(decReqIdx);
    expect(decReqIdx).toBeLessThan(decRespIdx);
    expect(decRespIdx).toBeLessThan(zoneTopIdx);
    expect(zoneTopIdx).toBeLessThan(resolvedIdx);

    // stage.history に counterattack が exactly once で登録
    expect(session.state.stage.history.filter((r: any) => r.actionId === "action.counterattack").length).toBe(1);
    expect(session.resolvingRequest).toBeUndefined();
    expect(session.continuation).toBeUndefined();
  });

  it("Test N: Lethal Counterattack - Grave TOP Decision occurs before FINISHED", () => {
    const state = createBaseState();
    // p1 のライフを2枚にする（2点ダメージで致死）
    state.players.p1.life = [
      { id: "l-die-1", suit: "S", rank: "2", value: 2 },
      { id: "l-die-2", suit: "H", rank: "3", value: 3 },
    ];
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

    const session = new GameSession(state, rulePackage, { matchId: "match-ca-lethal-002" });

    // damageJudge 実行
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const djContext: CommandContext = {
      state: session.state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      logRecorder: session.logRecorder,
    };
    session.registry.createRequest(damageJudgeAction, djContext);
    session.registry.resolveTopRequest(djContext);

    // advance() を実行
    const step1 = session.advance();

    // 重要: ライフが 0 になったが、FINISHED ではなく ZONE_TOP_SELECTION の WAITING_FOR_DECISION となること！
    expect(session.state.players.p1.life.length).toBe(0);
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") return;
    expect(step1.request.source.type).toBe("ZONE_TOP_SELECTION");

    // match.finished ログはまだ発行されていない
    const logBefore = session.getMatchLog();
    expect(logBefore.events.some((e) => e.type === "match.finished")).toBe(false);

    // 決定を提出
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: 0,
    });

    // 墓地TOP決定・Finalization 完了後、初めて FINISHED に遷移すること！
    expect(step2.type).toBe("FINISHED");
    if (step2.type === "FINISHED") {
      expect(step2.result.winner).toBe("p2");
    }

    const logAfter = session.getMatchLog();
    const resolvedIdx = logAfter.events.findIndex((e) => e.type === "request.resolved" && (e as any).actionRef === "action.counterattack");
    const finishedIdx = logAfter.events.findIndex((e) => e.type === "match.finished");

    expect(resolvedIdx).toBeGreaterThanOrEqual(0);
    expect(finishedIdx).toBeGreaterThanOrEqual(0);
    // request.resolved の後に match.finished が記録される
    expect(resolvedIdx).toBeLessThan(finishedIdx);
  });

  it("Test O: Snapshot / Restore while Immediate Finalization Pending", () => {
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

    const originalSession = new GameSession(state, rulePackage, { matchId: "match-ca-snap-003" });

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const djContext: CommandContext = {
      state: originalSession.state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      logRecorder: originalSession.logRecorder,
    };
    originalSession.registry.createRequest(damageJudgeAction, djContext);
    originalSession.registry.resolveTopRequest(djContext);

    const origStep1 = originalSession.advance();
    expect(origStep1.type).toBe("WAITING_FOR_DECISION");

    // Snapshot 取得
    const snapshot = originalSession.createSnapshot();
    expect(snapshot.snapshotFormatVersion).toBe(1);
    expect(snapshot.session.continuation?.effectStepId).toBe(TRIGGER_IMMEDIATE_FINALIZATION_STEP_ID);
    expect(snapshot.session.resolvingRequest).toBeDefined();

    // Snapshot から復元
    const restoredSession = GameSession.fromSnapshot(snapshot, rulePackage);

    expect(restoredSession.resolvingRequest).toBeDefined();
    expect(restoredSession.resolvingRequest.id).toBe(originalSession.resolvingRequest.id);
    expect(restoredSession.resolvingRequest.action?.id).toBe("action.counterattack");
    expect(restoredSession.continuation?.effectStepId).toBe(TRIGGER_IMMEDIATE_FINALIZATION_STEP_ID);

    // StateHash 一致確認
    expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));

    // 両セッションで同一の墓地TOP選択を提出
    const origResp = {
      decisionId: originalSession.pendingDecision!.decisionId,
      stateVersion: originalSession.pendingDecision!.stateVersion,
      selectedPatternRef: 0,
    };
    const restResp = {
      decisionId: restoredSession.pendingDecision!.decisionId,
      stateVersion: restoredSession.pendingDecision!.stateVersion,
      selectedPatternRef: 0,
    };

    const origStep2 = originalSession.submitDecision(origResp);
    const restStep2 = restoredSession.submitDecision(restResp);

    expect(origStep2.type).toBe(restStep2.type);
    expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(originalSession.state));

    // 両セッションとも exactly once で counterattack が解決確定
    expect(originalSession.state.stage.history.filter((r: any) => r.actionId === "action.counterattack").length).toBe(1);
    expect(restoredSession.state.stage.history.filter((r: any) => r.actionId === "action.counterattack").length).toBe(1);
  });

  it("Test P: Fresh Synthetic Replay Determinism with Immediate Trigger Decision", () => {
    // Session A のセットアップと実行
    const stateA = createBaseState();
    stateA.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      name: "要塞",
      face: "up",
      zone: "trump",
    });
    const attackerA = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwarkA = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-1" },
    };
    stateA.players.p1.field.push(attackerA);
    stateA.players.p2.field.push(bulwarkA);

    const sessionA = new GameSession(stateA, rulePackage, { matchId: "match-replay-001" });
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const djContextA: CommandContext = {
      state: sessionA.state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      logRecorder: sessionA.logRecorder,
    };
    sessionA.registry.createRequest(damageJudgeAction, djContextA);
    sessionA.registry.resolveTopRequest(djContextA);

    const stepA1 = sessionA.advance();
    expect(stepA1.type).toBe("WAITING_FOR_DECISION");

    // Session A で決定
    const chosenRef = 0;
    sessionA.submitDecision({
      decisionId: (stepA1 as any).request.decisionId,
      stateVersion: (stepA1 as any).request.stateVersion,
      selectedPatternRef: chosenRef,
    });
    const finalHashA = StateHasher.hash(sessionA.state);

    // Fresh Session B を同一初期状態から作成してリプレイ
    const stateB = createBaseState();
    stateB.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      name: "要塞",
      face: "up",
      zone: "trump",
    });
    const attackerB = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const bulwarkB = {
      unitId: "bw-1",
      kind: "防壁",
      componentId: "character.bulwark",
      face: "down",
      state: "drive",
      cards: [{ id: "c-bw", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "att-1" },
    };
    stateB.players.p1.field.push(attackerB);
    stateB.players.p2.field.push(bulwarkB);

    const sessionB = new GameSession(stateB, rulePackage, { matchId: "match-replay-002" });
    const djContextB: CommandContext = {
      state: sessionB.state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      logRecorder: sessionB.logRecorder,
    };
    sessionB.registry.createRequest(damageJudgeAction, djContextB);
    sessionB.registry.resolveTopRequest(djContextB);

    const stepB1 = sessionB.advance();
    expect(stepB1.type).toBe("WAITING_FOR_DECISION");

    // Session B 自身の decisionId を使って同パターンを選択
    sessionB.submitDecision({
      decisionId: (stepB1 as any).request.decisionId,
      stateVersion: (stepB1 as any).request.stateVersion,
      selectedPatternRef: chosenRef,
    });
    const finalHashB = StateHasher.hash(sessionB.state);

    expect(finalHashB).toBe(finalHashA);
  });

  it("Test Q: Fail-closed verification for finalizeImmediateTriggeredRequest", () => {
    const coordinator = new TriggerProcessingCoordinator();
    const registry = new CommandRegistry();
    const state = createBaseState();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const dummyReq: any = {
      id: "req-fail-1",
      actionId: "action.counterattack",
      controller: "p2",
      status: "resolved", // not resolving!
    };

    // status !== "resolving" の場合は throw
    expect(() => {
      coordinator.finalizeImmediateTriggeredRequest(dummyReq, context, registry);
    }).toThrow(/expected 'resolving'/);

    // pendingGraveTopSelections が残っている場合は throw
    dummyReq.status = "resolving";
    state.pendingGraveTopSelections = [
      {
        playerId: "p1",
        candidateCardIds: ["c1", "c2"],
        reason: "MULTI_CARD_GRAVE_MOVE",
      },
    ];

    expect(() => {
      coordinator.finalizeImmediateTriggeredRequest(dummyReq, context, registry);
    }).toThrow(/pendingGraveTopSelections remain/);
  });
});
