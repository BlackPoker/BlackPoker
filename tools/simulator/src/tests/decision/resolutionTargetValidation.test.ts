import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionRequest, ActionDefinition } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { ActionRequestValidator } from "../../engine/rules/ActionRequestValidator";
import { validateTargetsAtResolution } from "../../engine/rules/ResolutionTargetValidator";
import { TurnManager } from "../../engine/rules/TurnManager";
import { MatchLogRecorder } from "../../engine/log/MatchLogRecorder";

describe("Resolution Target Validation & Invalid-Target Resolution Contract (Phase 6.0.1)", () => {
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
            { id: "p1-key-1", suit: "H", rank: "7", value: 7 },
            { id: "p1-cost-1", suit: "D", rank: "1", value: 1 },
          ],
          field: [soldier1],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: 16,
          hand: [
            { id: "p2-key-1", suit: "C", rank: "10", value: 10 },
            { id: "p2-cost-1", suit: "D", rank: "2", value: 2 },
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

  const createTestContext = (state: any, logRecorder?: MatchLogRecorder): CommandContext => {
    return {
      state,
      components: rulePackage.components,
      actions: rulePackage.actions,
      playerKey: "p1",
      logRecorder,
    };
  };

  it("リクエスト対象が解決時点で存在しない場合、効果をスキップしカノニカル順序で解決完了する", () => {
    const state = createTestState();
    // リクエスト配置済みのため手札からは消費されている
    state.players.p1.hand = [];
    state.players.p2.hand = [];
    const logRecorder = new MatchLogRecorder({ matchId: "test-req-invalid" });
    const context = createTestContext(state, logRecorder);
    const registry = new CommandRegistry();

    // 先行リクエスト req1
    const req1: ActionRequest = {
      id: "req-1",
      actionId: "action.attack",
      controller: "p1",
      keyCards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      status: "pending",
      sequence: 1,
    };

    // カウンターリクエスト req2 (req1 を対象)
    const counterAction: any = {
      id: "action.test.counter",
      name: "テストカウンター",
      timing: "chance",
      targets: [
        {
          id: "targetRequest",
          type: "request",
          condition: { status: "pending" },
        },
      ],
      effect: [
        {
          command: "cancelRequest",
        },
      ],
    };

    const req2: ActionRequest = {
      id: "req-2",
      actionId: "action.test.counter",
      action: counterAction,
      controller: "p2",
      keyCards: [{ id: "p2-key-1", suit: "C", rank: "10", value: 10 }],
      targets: [{ type: "request", requestId: "req-1", actionId: "action.attack" }],
      status: "pending",
      sequence: 2,
    };

    state.stage.requests = [req1, req2];

    // 解決前に req1 が Stage から除去されたとする（対象消失）
    state.stage.requests = [req2];

    // req2 の解決
    const result = registry.resolveTopRequest(context);

    // 1. 解決結果契約
    expect(result.type).toBe("COMPLETED");
    expect(result.request.id).toBe("req-2");
    expect(result.request.status).toBe("resolved");

    // 2. Stage から除去され history へ送られている
    expect(state.stage.requests.length).toBe(0);
    expect(state.stage.history.length).toBe(1);
    expect(state.stage.history[0].id).toBe("req-2");

    // 3. キーカードが墓地へ送られている
    expect(state.players.p2.grave).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "p2-key-1" })])
    );

    // 4. ログ記録（カノニカル順序 & effectSkipped & reason）
    const events = logRecorder.getEvents();
    const resolveStartedIdx = events.findIndex((e) => e.type === "request.resolve.started");
    const stagePoppedIdx = events.findIndex((e) => e.type === "stage.popped");
    const cardMovedIdx = events.findIndex((e) => e.type === "card.moved");
    const resolvedIdx = events.findIndex((e) => e.type === "request.resolved");

    expect(resolveStartedIdx).toBeGreaterThan(-1);
    expect(stagePoppedIdx).toBeGreaterThan(resolveStartedIdx);
    expect(cardMovedIdx).toBeGreaterThan(stagePoppedIdx);
    expect(resolvedIdx).toBeGreaterThan(cardMovedIdx);

    const resolvedEvent = events[resolvedIdx] as any;
    expect(resolvedEvent.requestId).toBe("req-2");
    expect(resolvedEvent.effectSkipped).toBe(true);
    expect(resolvedEvent.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
  });

  it("ユニット対象が解決時点でフィールドに存在しない場合、効果をスキップし不発解決完了する", () => {
    const state = createTestState();
    state.players.p1.hand = [];
    state.players.p2.hand = [];
    const logRecorder = new MatchLogRecorder({ matchId: "test-unit-invalid" });
    const context = createTestContext(state, logRecorder);
    const registry = new CommandRegistry();

    const twistAction: any = {
      id: "action.test.twist",
      name: "テストツイスト",
      timing: "action",
      targets: [
        {
          id: "targetUnit",
          type: "unit",
          condition: { componentType: "character" },
        },
      ],
      effect: [
        {
          command: "toggleUnitState",
        },
      ],
    };

    const req: ActionRequest = {
      id: "req-twist",
      actionId: "action.test.twist",
      action: twistAction,
      controller: "p1",
      keyCards: [{ id: "p1-key-1", suit: "H", rank: "7", value: 7 }],
      targets: [{ type: "unit", unitId: "soldier-2", kind: "一般兵", componentId: "character.soldier" }],
      status: "pending",
      sequence: 1,
    };

    state.stage.requests = [req];

    // 解決前に対象ユニット soldier-2 がフィールドから消失（例: 破壊・墓地送り）
    state.players.p2.field = [];

    const result = registry.resolveTopRequest(context);

    expect(result.type).toBe("COMPLETED");
    expect(result.request.status).toBe("resolved");
    expect(state.stage.requests.length).toBe(0);
    expect(state.stage.history[0].id).toBe("req-twist");

    // キーカードは墓地へ移動
    expect(state.players.p1.grave).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "p1-key-1" })])
    );

    const events = logRecorder.getEvents();
    const resolvedEvent = events.find((e) => e.type === "request.resolved") as any;
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.effectSkipped).toBe(true);
    expect(resolvedEvent.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
  });

  it("DSLターゲット条件（状態・条件）が解決時点で不適合の場合、効果をスキップする", () => {
    const state = createTestState();
    const logRecorder = new MatchLogRecorder({ matchId: "test-condition-invalid" });
    const context = createTestContext(state, logRecorder);
    const registry = new CommandRegistry();

    const actionWithCond: any = {
      id: "action.test.charge_only",
      name: "チャージ限定アクション",
      timing: "action",
      targets: [
        {
          id: "targetUnit",
          type: "unit",
          condition: {
            componentType: "character",
            state: "charge",
          },
        },
      ],
      effect: [
        {
          command: "toggleUnitState",
        },
      ],
    };

    const req: ActionRequest = {
      id: "req-charge-only",
      actionId: "action.test.charge_only",
      action: actionWithCond,
      controller: "p1",
      keyCards: [{ id: "p1-key-1", suit: "H", rank: "7", value: 7 }],
      targets: [{ type: "unit", unitId: "soldier-1", kind: "一般兵", componentId: "character.soldier" }],
      status: "pending",
      sequence: 1,
    };

    state.stage.requests = [req];

    // 解決前に対象ユニットの状態が rest に変化
    state.players.p1.field[0].state = "rest";

    const result = registry.resolveTopRequest(context);

    expect(result.type).toBe("COMPLETED");
    expect(result.request.status).toBe("resolved");
    expect(state.stage.requests.length).toBe(0);

    // ユニット状態が toggle されていない（効果スキップ）
    expect(state.players.p1.field[0].state).toBe("rest");

    const events = logRecorder.getEvents();
    const resolvedEvent = events.find((e) => e.type === "request.resolved") as any;
    expect(resolvedEvent.effectSkipped).toBe(true);
    expect(resolvedEvent.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
  });

  it("中断再開時（resumeInterruptedEffect）にはターゲット再検証を行わない契約を満たす", () => {
    const state = createTestState();
    const logRecorder = new MatchLogRecorder({ matchId: "test-resume-no-reval" });
    const context = createTestContext(state, logRecorder);
    const registry = new CommandRegistry();

    // 2ステップの効果を持つアクション（ステップ1完了後に中断）
    const twoStepAction: any = {
      id: "action.test.interruptible",
      name: "中断可能アクション",
      timing: "action",
      targets: [
        {
          id: "targetUnit",
          type: "unit",
          condition: { componentType: "character" },
        },
      ],
      effect: [
        {
          // 外部決定要求による中断をシミュレート
          command: "customDecisionStep" as any,
        },
        {
          command: "toggleUnitState",
        },
      ],
    };

    // EffectInterpreter のモック的フック
    (registry as any).effectInterpreter.executeEffectsWithInterruption = (
      _effects: any[],
      ctx: CommandContext,
      startIndex: number
    ) => {
      if (startIndex === 0) {
        return {
          interrupted: true,
          effectIndex: 0,
          effectStepId: "step-1",
          selectionId: "select-1",
          candidates: [],
        };
      } else {
        ctx.state.players.p1.field[0].state = "rest";
        return { interrupted: false };
      }
    };

    const req: ActionRequest = {
      id: "req-int",
      actionId: "action.test.interruptible",
      action: twoStepAction,
      controller: "p1",
      keyCards: [{ id: "p1-key-1", suit: "H", rank: "7", value: 7 }],
      targets: [{ type: "unit", unitId: "soldier-1", kind: "一般兵", componentId: "character.soldier" }],
      status: "pending",
      sequence: 1,
    };

    state.stage.requests = [req];

    // 初回解決呼び出し -> 中断
    const firstResolve = registry.resolveTopRequest(context);
    expect(firstResolve.type).toBe("WAITING_FOR_DECISION");
    expect(firstResolve.continuation).toBeDefined();

    // 中断中に対象ユニットの状態が変化（charge/drive ではなく rest になった等）
    state.players.p1.field[0].state = "exhausted";

    // 中断再開 (resumeRequest)
    const resumeResult = registry.resumeRequest(
      req,
      firstResolve.continuation!,
      ["opt-1"],
      context
    );

    // 再開時は対象再検証を行わず、残りのステップが正常に完了する契約
    expect(resumeResult.type).toBe("COMPLETED");
    expect(resumeResult.request.status).toBe("resolved");
    expect(state.stage.requests.length).toBe(0);
    expect(state.stage.history[0].id).toBe("req-int");

    const events = logRecorder.getEvents();
    const resolvedEvent = events.find((e) => e.type === "request.resolved") as any;
    expect(resolvedEvent.effectSkipped).toBe(false);
  });

  it("ActionRequestValidator と ResolutionTargetValidator で共通条件評価ロジックが一致する", () => {
    const state = createTestState();
    const context = createTestContext(state);
    const validator = new ActionRequestValidator();

    const action: any = {
      id: "action.test.validate",
      name: "検証アクション",
      timing: "action",
      targets: [
        {
          id: "targetUnit",
          type: "unit",
          condition: {
            componentType: "character",
            characterType: "soldier",
          },
        },
      ],
    };

    const req: ActionRequest = {
      id: "req-val",
      actionId: "action.test.validate",
      controller: "p1",
      keyCards: [],
      targets: [{ type: "unit", unitId: "soldier-1", kind: "一般兵", componentId: "character.soldier" }],
      status: "pending",
      sequence: 1,
    };

    // 1. 正常時: 両方とも妥当
    const resAtResolution = validateTargetsAtResolution(action, req, context);
    expect(resAtResolution.isValid).toBe(true);
    expect(() =>
      validator.validateActionRequest(action, {
        ...context,
        targetComponent: state.players.p1.field[0],
      })
    ).not.toThrow();

    // 2. キャラクタータイプ不適合時
    state.players.p1.field[0].kind = "特殊兵";
    state.players.p1.field[0].componentId = "character.special";

    const resMismatch = validateTargetsAtResolution(action, req, context);
    expect(resMismatch.isValid).toBe(false);
    expect(resMismatch.reason).toBe("TARGET_INVALID_AT_RESOLUTION");

    expect(() =>
      validator.validateActionRequest(action, {
        ...context,
        targetComponent: state.players.p1.field[0],
      })
    ).toThrow(/キャラクタータイプが不適合です/);
  });
});
