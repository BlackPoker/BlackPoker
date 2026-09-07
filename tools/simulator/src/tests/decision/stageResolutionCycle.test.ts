import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionRequest } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { PassTracker } from "../../engine/session/PassTracker";
import { CoreFlowCoordinator } from "../../engine/session/CoreFlowCoordinator";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { MatchLogRecorder } from "../../engine/log/MatchLogRecorder";

describe("Stage TOP Resolution & Consecutive PASS Cycle Tests (Phase 6.0)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const createTestState = () => {
    const soldier1 = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const soldier2 = {
      unitId: "soldier-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c2", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
    };

    const state = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: 16,
          hand: [
            { id: "key-h7", suit: "H", rank: "7", value: 7 },
            { id: "cost-d1", suit: "D", rank: "1", value: 1 },
            { id: "key-d8", suit: "D", rank: "8", value: 8 },
            { id: "cost-d2", suit: "D", rank: "2", value: 2 },
            { id: "key-c10", suit: "C", rank: "10", value: 10 },
            { id: "cost-d3", suit: "D", rank: "3", value: 3 },
          ],
          field: [soldier1],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: 16,
          hand: [
            { id: "p2-key-s8", suit: "S", rank: "8", value: 8 },
            { id: "p2-cost-d1", suit: "D", rank: "1", value: 1 },
            { id: "p2-counter-c10", suit: "C", rank: "10", value: 10 },
            { id: "p2-cost-d2", suit: "D", rank: "2", value: 2 },
            { id: "p2-cost-c4", suit: "C", rank: "4", value: 4 },
          ],
          field: [soldier2],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      stateVersion: 1,
      turnCount: 1,
    } as Record<string, any>;

    TurnManager.initializeToMain(state, "p1");
    return state;
  };

  /**
   * Test 1: 2 consecutive PASS -> Stage TOP 1 item resolved
   * - Stage depth decreases by 1
   * - Resolved request is moved to stage.history with status "resolved"
   * - chance returns to turnPlayer
   */
  it("Test 1: should resolve exactly 1 Stage TOP item when 2 consecutive PASS occur", () => {
    const state = createTestState();
    const registry = new CommandRegistry();
    const passTracker = new PassTracker();

    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;

    // 2つのリクエストをステージに積む: req1 (up), req2 (twist)
    const contextP1: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      keyCards: [state.players.p1.hand[0]],
      targetComponent: state.players.p1.field[0],
    };
    const req1 = registry.createRequest(upAction, contextP1);

    const keyTwist1 = state.players.p1.hand.find((c: any) => c.id === "key-d8");
    const contextP1Twist: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      keyCards: [keyTwist1],
      targetComponent: state.players.p1.field[0],
    };
    const req2 = registry.createRequest(twistAction, contextP1Twist);

    expect(state.stage.requests.length).toBe(2);
    expect(state.stage.requests[0].id).toBe(req1.id);
    expect(state.stage.requests[1].id).toBe(req2.id);

    // 1回目のPASS (p1)
    passTracker.recordPass();
    const event1 = CoreFlowCoordinator.tryResolveStageTop(state, rulePackage, registry, passTracker, 2);
    expect(event1).toBeNull();
    expect(state.stage.requests.length).toBe(2);

    // 2回目のPASS (p2) -> 連続PASS成立でTOP（req2）が解決
    passTracker.recordPass();
    state.chancePlayer = "p2";
    const event2 = CoreFlowCoordinator.tryResolveStageTop(state, rulePackage, registry, passTracker, 2);

    expect(event2).not.toBeNull();
    expect(event2?.type).toBe("STAGE_TOP_RESOLVED");
    if (event2?.type === "STAGE_TOP_RESOLVED") {
      expect(event2.actionRequest.id).toBe(req2.id);
      expect(event2.actionRequest.status).toBe("resolved");
      expect(event2.nextChancePlayerId).toBe("p1");
    }

    // Stage深さが2から1へ減少
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].id).toBe(req1.id);

    // history に req2 が追加されていること
    expect(state.stage.history.length).toBe(1);
    expect(state.stage.history[0].id).toBe(req2.id);
    expect(state.stage.history[0].status).toBe("resolved");

    // チャンスプレイヤーが p1 に復帰していること
    expect(state.chancePlayer).toBe("p1");
  });

  /**
   * Test 2: Stage TOP / BOTTOM Inversion Prevention
   */
  it("Test 2: should resolve requests[requests.length - 1] (Stage TOP), NOT requests[0] (BOTTOM)", () => {
    const state = createTestState();
    const registry = new CommandRegistry();
    const passTracker = new PassTracker();

    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;

    // reqBottom (index 0): action.up
    const keyUp = state.players.p1.hand.find((c: any) => c.id === "key-h7");
    const reqBottom = registry.createRequest(upAction, {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      keyCards: [keyUp],
      targetComponent: state.players.p1.field[0],
    });

    // reqTop (index 1): action.twist
    const keyTwist = state.players.p1.hand.find((c: any) => c.id === "key-d8");
    const reqTop = registry.createRequest(twistAction, {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      keyCards: [keyTwist],
      targetComponent: state.players.p1.field[0],
    });

    expect(state.stage.requests[0].id).toBe(reqBottom.id);
    expect(state.stage.requests[1].id).toBe(reqTop.id);

    // 2連続PASS実行
    passTracker.recordPass();
    passTracker.recordPass();

    const event = CoreFlowCoordinator.tryResolveStageTop(state, rulePackage, registry, passTracker, 2);

    expect(event?.type).toBe("STAGE_TOP_RESOLVED");
    if (event?.type === "STAGE_TOP_RESOLVED") {
      // 解決されたのは TOP である reqTop
      expect(event.actionRequest.id).toBe(reqTop.id);
      expect(event.actionRequest.id).not.toBe(reqBottom.id);
    }

    // 残っているのは BOTTOM である reqBottom
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].id).toBe(reqBottom.id);
  });

  /**
   * Test 3: Unexpected Exception Propagation
   * - If an unexpected technical error occurs during resolution,
   *   it must propagate out of tryResolveStageTop (not swallowed into fake STAGE_TOP_RESOLVED).
   * - No false STAGE_TOP_RESOLVED returned.
   * - Request is NOT marked resolved, NOT popped from stage, NOT added to history.
   * - Stage depth remains unchanged.
   */
  it("Test 3: should propagate unexpected exceptions and NOT return fake STAGE_TOP_RESOLVED", () => {
    const state = createTestState();
    const registry = new CommandRegistry();
    const passTracker = new PassTracker();

    // 予期せぬ例外を投げるカスタムハンドラーでモック
    registry.register("explodeCommand", () => {
      throw new Error("UNEXPECTED_SYSTEM_CRASH");
    });

    const explodingAction = {
      id: "action.exploding",
      name: "自爆アクション",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      effect: [{ explodeCommand: {} }] as any,
    };

    const req = registry.createRequest(explodingAction as any, {
      state,
      playerKey: "p1",
      actions: [explodingAction as any, ...rulePackage.actions],
      components: rulePackage.components,
    });

    expect(state.stage.requests.length).toBe(1);
    const depthBefore = state.stage.requests.length;

    passTracker.recordPass();
    passTracker.recordPass();

    // tryResolveStageTop 内でエラーが握り潰されず、呼び出し元へ確実に伝播すること
    expect(() => {
      CoreFlowCoordinator.tryResolveStageTop(
        state,
        { ...rulePackage, actions: [explodingAction as any, ...rulePackage.actions] },
        registry,
        passTracker,
        2
      );
    }).toThrow("UNEXPECTED_SYSTEM_CRASH");

    // 受入条件:
    // 1. Stage 深さが減少しないこと（未解決リクエストが消滅しない）
    expect(state.stage.requests.length).toBe(depthBefore);
    expect(state.stage.requests[0].id).toBe(req.id);
    // 2. 失敗したリクエストが勝手に resolved にされないこと
    expect(state.stage.requests[0].status).not.toBe("resolved");
    // 3. history に移動しないこと
    expect(state.stage.history.length).toBe(0);
  });

  /**
   * Test 4: Effect Resolution Interruption (WAITING_FOR_DECISION)
   * - When an action effect requires player decision during resolution,
   *   STAGE_RESOLUTION_INTERRUPTED is returned.
   * - Request remains on Stage.
   */
  it("Test 4: should return STAGE_RESOLUTION_INTERRUPTED and keep request on stage when decision needed", () => {
    const state = createTestState();
    const registry = new CommandRegistry();
    const passTracker = new PassTracker();

    const interactiveAction = {
      id: "action.interactive",
      name: "ユニット選択アクション",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      effect: [
        {
          selectUnits: {
            id: "targetSelect",
            condition: { component: "character.soldier" },
            count: 1,
          },
        },
      ] as any,
    };

    const req = registry.createRequest(interactiveAction as any, {
      state,
      playerKey: "p1",
      actions: [interactiveAction as any, ...rulePackage.actions],
      components: rulePackage.components,
    });

    expect(state.stage.requests.length).toBe(1);

    passTracker.recordPass();
    passTracker.recordPass();

    const event = CoreFlowCoordinator.tryResolveStageTop(
      state,
      { ...rulePackage, actions: [interactiveAction as any, ...rulePackage.actions] },
      registry,
      passTracker,
      2
    );

    expect(event).not.toBeNull();
    expect(event?.type).toBe("STAGE_RESOLUTION_INTERRUPTED");
    if (event?.type === "STAGE_RESOLUTION_INTERRUPTED") {
      expect(state.stage.requests.length).toBe(1);
      expect(event.actionRequest.id).toBe(req.id);
      expect(event.decisionRequest).toBeDefined();
      expect(event.continuation).toBeDefined();
    }
  });

  /**
   * Test 5: Target Disappearance Resolution (Target lost at resolution time)
   * - Counter on counter whose target request was already cancelled:
   *   Must resolve WITHOUT effect, pop from Stage, send key cards to grave,
   *   and NOT throw "キャンセル対象のリクエストが見つかりません" or cause stall cycle.
   */
  it("Test 5: should resolve without effect, pop from stage, and send key cards to grave when target disappears", () => {
    const state = createTestState();
    const registry = new CommandRegistry();
    const passTracker = new PassTracker();

    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;

    // 1. req1: up (1 keyCard)
    state.chancePlayer = "p1";
    const req1 = registry.createRequest(upAction, {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      keyCards: [state.players.p1.hand.find((c: any) => c.id === "key-h7")],
      targetComponent: state.players.p1.field[0],
    });

    // 2. req2: counter targeting req1
    state.chancePlayer = "p2";
    const req2 = registry.createRequest(counterAction, {
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
      keyCards: [state.players.p2.hand.find((c: any) => c.id === "p2-counter-c10")],
      targetRequest: req1,
    });

    // 3. req3: second counter also targeting req1 (e.g. earlier counter)
    state.chancePlayer = "p1";
    const req3 = registry.createRequest(counterAction, {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      keyCards: [state.players.p1.hand.find((c: any) => c.id === "key-c10")],
      targetRequest: req1,
    });

    // ステージ深さは 3: [req1, req2, req3] (TOP is req3)
    expect(state.stage.requests.length).toBe(3);

    // 解決 1: req3 (TOP) を解決 -> req1 がキャンセルされてステージから除去される
    passTracker.recordPass();
    passTracker.recordPass();
    const event1 = CoreFlowCoordinator.tryResolveStageTop(state, rulePackage, registry, passTracker, 2);
    expect(event1?.type).toBe("STAGE_TOP_RESOLVED");
    if (event1?.type === "STAGE_TOP_RESOLVED") {
      expect(event1.actionRequest.id).toBe(req3.id);
    }

    // req3 解決後、req3 は履歴へ。req1 も cancelRequest により履歴へ。
    // ステージに残っているのは req2 のみ！
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].id).toBe(req2.id);
    expect(state.stage.requests[0].targets?.[0]).toEqual(
      expect.objectContaining({ type: "request", requestId: req1.id })
    );

    // 解決 2: 次の2連続PASSで req2 (TOP) を解決
    // req2 の対象 req1 は既にキャンセルされてステージ上に存在しない（対象喪失）
    passTracker.recordPass();
    passTracker.recordPass();

    // ここで例外をスローせず、効果スキップで正常に解決されること！
    const event2 = CoreFlowCoordinator.tryResolveStageTop(state, rulePackage, registry, passTracker, 2);
    expect(event2?.type).toBe("STAGE_TOP_RESOLVED");
    if (event2?.type === "STAGE_TOP_RESOLVED") {
      expect(event2.actionRequest.id).toBe(req2.id);
      expect(event2.actionRequest.status).toBe("resolved");
    }

    // req2 はステージから正常にポップされていること
    expect(state.stage.requests.length).toBe(0);

    // req2 のステータスは "resolved" で履歴に追加されていること
    const historyReq2 = state.stage.history.find((r: any) => r.id === req2.id);
    expect(historyReq2).toBeDefined();
    expect(historyReq2.status).toBe("resolved");

    // req2 のキーカード（p2-counter-c10）が墓地へ送られていること
    const p2Grave = state.players.p2.grave;
    expect(p2Grave.some((c: any) => c.id === "p2-counter-c10")).toBe(true);
  });

  /**
   * Test 5b: Unit Target Disappearance (e.g. soldier killed before up resolves)
   */
  it("Test 5b: should resolve without effect when target unit is eliminated before resolution", () => {
    const state = createTestState();
    const registry = new CommandRegistry();
    const passTracker = new PassTracker();

    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;

    // reqUp: target soldier-1
    const reqUp = registry.createRequest(upAction, {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      keyCards: [state.players.p1.hand[0]],
      targetComponent: state.players.p1.field[0],
    });

    expect(state.stage.requests.length).toBe(1);

    // 兵士が解決前に墓地へ送られたとする (e.g. 他のアクションによる除去)
    const deadSoldier = state.players.p1.field.shift();
    state.players.p1.grave.push(deadSoldier);
    expect(state.players.p1.field.length).toBe(0);

    // 2連続PASSで reqUp を解決
    passTracker.recordPass();
    passTracker.recordPass();

    const event = CoreFlowCoordinator.tryResolveStageTop(state, rulePackage, registry, passTracker, 2);
    expect(event?.type).toBe("STAGE_TOP_RESOLVED");
    if (event?.type === "STAGE_TOP_RESOLVED") {
      expect(event.actionRequest.id).toBe(reqUp.id);
    }

    // ステージから除去され、フォグは作成されない（効果不発）
    expect(state.stage.requests.length).toBe(0);
    expect(state.players.p1.fog.length).toBe(0);

    // キーカードは墓地へ送られていること
    expect(state.players.p1.grave.some((c: any) => c.id === "key-h7")).toBe(true);
    expect(reqUp.status).toBe("resolved");
  });

  /**
   * Test 6: PassTracker reset
   * - consecutivePassCount resets on action queue and on stage resolve
   */
  it("Test 6: should reset PassTracker upon stage resolution and upon queuing new actions", () => {
    const state = createTestState();
    const registry = new CommandRegistry();
    const passTracker = new PassTracker();

    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    registry.createRequest(upAction, {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
      keyCards: [state.players.p1.hand[0]],
      targetComponent: state.players.p1.field[0],
    });

    // 1 PASS
    passTracker.recordPass();
    expect(passTracker.consecutivePassCount).toBe(1);

    // 2 PASS -> Stage TOP 解決
    passTracker.recordPass();
    expect(passTracker.consecutivePassCount).toBe(2);

    CoreFlowCoordinator.tryResolveStageTop(state, rulePackage, registry, passTracker, 2);
    // 解決後にリセットされていること
    expect(passTracker.consecutivePassCount).toBe(0);

    // 新しいPASSを記録
    passTracker.recordPass();
    expect(passTracker.consecutivePassCount).toBe(1);

    // 新しいアクションが処理されるとリセットされること
    passTracker.reset();
    expect(passTracker.consecutivePassCount).toBe(0);
  });
});
