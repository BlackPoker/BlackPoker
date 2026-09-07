import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionRequest, ActionDefinition } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { ActionRequestValidator } from "../../engine/rules/ActionRequestValidator";
import { validateTargetsAtResolution } from "../../engine/rules/ResolutionTargetValidator";
import { TurnManager } from "../../engine/rules/TurnManager";
import { MatchLogRecorder } from "../../engine/log/MatchLogRecorder";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";

describe("Resolution Target Validation & Invalid-Target Resolution Contract (Phase 6.0.1 / 6.0.1.1)", () => {
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

  // ---------------------------------------------------------------------------
  // 必須回帰テスト 1: componentType: character からの暗黙 state 除去
  // ---------------------------------------------------------------------------
  it("【必須1】componentType: character のみの条件では、state が charge/drive 以外でも Target Invalid にしない", () => {
    const state = createTestState();
    const context = createTestContext(state);

    const actionWithCharOnly: any = {
      id: "action.test.char_only",
      name: "キャラクターのみ対象",
      targets: [
        {
          id: "targetChar",
          type: "unit",
          condition: { componentType: "character" },
        },
      ],
    };

    const req: ActionRequest = {
      id: "req-char-only",
      actionId: "action.test.char_only",
      controller: "p1",
      keyCards: [],
      targets: [
        {
          type: "unit",
          unitId: "soldier-1",
          kind: "一般兵",
          componentId: "character.soldier",
          targetDefinitionId: "targetChar",
        },
      ],
      status: "pending",
      sequence: 1,
    };

    // 1. charge 状態: 妥当
    state.players.p1.field[0].state = "charge";
    const resCharge = validateTargetsAtResolution(actionWithCharOnly, req, context);
    expect(resCharge.isValid).toBe(true);

    // 2. drive 状態: 妥当
    state.players.p1.field[0].state = "drive";
    const resDrive = validateTargetsAtResolution(actionWithCharOnly, req, context);
    expect(resDrive.isValid).toBe(true);

    // 3. rest 状態（charge/drive 以外）: componentType: character のみなら state を理由に Invalid にしない！
    state.players.p1.field[0].state = "rest";
    const resRest = validateTargetsAtResolution(actionWithCharOnly, req, context);
    expect(resRest.isValid).toBe(true);

    // 4. exhausted 状態: 妥当
    state.players.p1.field[0].state = "exhausted";
    const resExhausted = validateTargetsAtResolution(actionWithCharOnly, req, context);
    expect(resExhausted.isValid).toBe(true);

    // 5. ただし character でないコンポーネントなら Invalid となる
    state.players.p1.field[0].kind = undefined;
    state.players.p1.field[0].componentId = "non_character_object";
    const contextWithNonChar = {
      ...context,
      components: [{ id: "non_character_object", name: "Fog", type: "fog", zone: "fog" }],
    };
    const resNotChar = validateTargetsAtResolution(actionWithCharOnly, req, contextWithNonChar);
    expect(resNotChar.isValid).toBe(false);
    expect(resNotChar.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
  });

  // ---------------------------------------------------------------------------
  // 必須回帰テスト 2: condition.state: charge 明示時のみ他状態で Target Invalid となる
  // ---------------------------------------------------------------------------
  it("【必須2】condition.state: charge を明示したときのみ他状態で Target Invalid となる", () => {
    const state = createTestState();
    const context = createTestContext(state);

    const actionWithExplicitState: any = {
      id: "action.test.explicit_charge",
      name: "明示的チャージ条件アクション",
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
    };

    const req: ActionRequest = {
      id: "req-explicit-state",
      actionId: "action.test.explicit_charge",
      controller: "p1",
      keyCards: [],
      targets: [
        {
          type: "unit",
          unitId: "soldier-1",
          kind: "一般兵",
          componentId: "character.soldier",
          targetDefinitionId: "targetUnit",
        },
      ],
      status: "pending",
      sequence: 1,
    };

    // charge 状態: 適合
    state.players.p1.field[0].state = "charge";
    const resCharge = validateTargetsAtResolution(actionWithExplicitState, req, context);
    expect(resCharge.isValid).toBe(true);

    // drive 状態: state: charge に違反するため Target Invalid
    state.players.p1.field[0].state = "drive";
    const resDrive = validateTargetsAtResolution(actionWithExplicitState, req, context);
    expect(resDrive.isValid).toBe(false);
    expect(resDrive.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
    expect(resDrive.detail).toMatch(/ターゲットユニットの状態が不適合です/);

    // rest 状態: Target Invalid
    state.players.p1.field[0].state = "rest";
    const resRest = validateTargetsAtResolution(actionWithExplicitState, req, context);
    expect(resRest.isValid).toBe(false);
    expect(resRest.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
  });

  // ---------------------------------------------------------------------------
  // 必須回帰テスト 3: 複数 Target Definition で各対象が対応する Definition で検証される
  // ---------------------------------------------------------------------------
  it("【必須3】複数 Target Definition を持つ Action で各対象が対応する Definition で厳密に検証される", () => {
    const state = createTestState();
    const context = createTestContext(state);

    // attacker は charge、defender は rest を要求する2対象アクション
    const multiTargetAction: any = {
      id: "action.test.multi_target",
      name: "2対象アクション",
      targets: [
        {
          id: "attacker",
          type: "unit",
          condition: { state: "charge" },
        },
        {
          id: "defender",
          type: "unit",
          condition: { state: "rest" },
        },
      ],
    };

    // soldier-1: charge, soldier-2: rest
    state.players.p1.field[0].state = "charge";
    state.players.p2.field[0].state = "rest";

    // 正常バインド: attacker -> soldier-1(charge), defender -> soldier-2(rest)
    const validReq: ActionRequest = {
      id: "req-multi-1",
      actionId: "action.test.multi_target",
      controller: "p1",
      keyCards: [],
      targets: [
        {
          type: "unit",
          unitId: "soldier-1",
          kind: "一般兵",
          componentId: "character.soldier",
          targetDefinitionId: "attacker",
        },
        {
          type: "unit",
          unitId: "soldier-2",
          kind: "一般兵",
          componentId: "character.soldier",
          targetDefinitionId: "defender",
        },
      ],
      status: "pending",
      sequence: 1,
    };

    const resValid = validateTargetsAtResolution(multiTargetAction, validReq, context);
    expect(resValid.isValid).toBe(true);

    // defender 側の soldier-2 が charge だった場合:
    // もし attacker[0] の条件で評価されていたら charge なので通ってしまうが、
    // defender の条件 (rest) で評価されるため正しく Target Invalid になること！
    state.players.p2.field[0].state = "charge";
    const resDefenderMismatch = validateTargetsAtResolution(multiTargetAction, validReq, context);
    expect(resDefenderMismatch.isValid).toBe(false);
    expect(resDefenderMismatch.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
    expect(resDefenderMismatch.detail).toMatch(/ターゲットユニットの状態が不適合です/);
  });

  // ---------------------------------------------------------------------------
  // 必須回帰テスト 4: targetDefinitionId のない legacy single-target Request の互換動作
  // ---------------------------------------------------------------------------
  it("【必須4】targetDefinitionId のない legacy single-target Request が互換動作する", () => {
    const state = createTestState();
    const context = createTestContext(state);

    const singleTargetAction: any = {
      id: "action.test.single",
      name: "単一対象アクション",
      targets: [
        {
          id: "onlyTarget",
          type: "unit",
          condition: { componentType: "character" },
        },
      ],
    };

    // targetDefinitionId なしのレガシーリクエスト
    const legacyReq: ActionRequest = {
      id: "req-legacy-single",
      actionId: "action.test.single",
      controller: "p1",
      keyCards: [],
      targets: [
        {
          type: "unit",
          unitId: "soldier-1",
          kind: "一般兵",
          componentId: "character.soldier",
        },
      ],
      status: "pending",
      sequence: 1,
    };

    // targets.length === 1 なので例外なく唯一の定義で検証され妥当
    const res = validateTargetsAtResolution(singleTargetAction, legacyReq, context);
    expect(res.isValid).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 必須回帰テスト 5: targetDefinitionId のない multi-target Request は fail-fast する
  // ---------------------------------------------------------------------------
  it("【必須5】targetDefinitionId のない multi-target Request を黙って targets[0] で評価せず fail-fast する", () => {
    const state = createTestState();
    const context = createTestContext(state);

    const multiTargetAction: any = {
      id: "action.test.multi_strict",
      name: "複数対象アクション",
      targets: [
        { id: "targetA", type: "unit" },
        { id: "targetB", type: "unit" },
      ],
    };

    // targetDefinitionId を持たないリクエスト
    const ambiguousReq: ActionRequest = {
      id: "req-ambiguous",
      actionId: "action.test.multi_strict",
      controller: "p1",
      keyCards: [],
      targets: [
        {
          type: "unit",
          unitId: "soldier-1",
          kind: "一般兵",
          componentId: "character.soldier",
        },
      ],
      status: "pending",
      sequence: 1,
    };

    // 複数定義があるのに targetDefinitionId が未指定の場合、暗黙フォールバックせず例外スロー
    expect(() => validateTargetsAtResolution(multiTargetAction, ambiguousReq, context)).toThrow(
      /複数のターゲット定義が存在しますが、リクエストのターゲットに targetDefinitionId が指定されていません/
    );
  });

  // ---------------------------------------------------------------------------
  // 必須回帰テスト 6: resumeRequest の完了契約（Canonical Resolution Order）と invariant
  // ---------------------------------------------------------------------------
  it("【必須6】resumeRequest の全正常完了経路が Canonical Resolution Order を守り、不正時は fail-fast する", () => {
    const state = createTestState();
    state.players.p1.hand = [];
    state.players.p2.hand = [];
    const logRecorder = new MatchLogRecorder({ matchId: "test-resume-order" });
    const context = createTestContext(state, logRecorder);
    const registry = new CommandRegistry();

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
          command: "customDecisionStep" as any,
        },
        {
          command: "toggleUnitState",
        },
      ],
    };

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
      targets: [
        {
          type: "unit",
          unitId: "soldier-1",
          kind: "一般兵",
          componentId: "character.soldier",
          targetDefinitionId: "targetUnit",
        },
      ],
      status: "pending",
      sequence: 1,
    };

    state.stage.requests = [req];

    // 初回解決 -> 中断
    const firstResolve = registry.resolveTopRequest(context);
    expect(firstResolve.type).toBe("WAITING_FOR_DECISION");
    expect(firstResolve.continuation).toBeDefined();

    // 中断再開 (resumeRequest)
    const resumeResult = registry.resumeRequest(
      req,
      firstResolve.continuation!,
      ["opt-1"],
      context
    );

    expect(resumeResult.type).toBe("COMPLETED");
    expect(resumeResult.request.status).toBe("resolved");
    expect(state.stage.requests.length).toBe(0);
    expect(state.stage.history[0].id).toBe("req-int");

    // カノニカル順序のログ記録確認: stage.popped -> card.moved -> request.resolved
    const events = logRecorder.getEvents();
    const stagePoppedIdx = events.findIndex((e) => e.type === "stage.popped");
    const cardMovedIdx = events.findIndex((e) => e.type === "card.moved");
    const resolvedIdx = events.findIndex((e) => e.type === "request.resolved");

    expect(stagePoppedIdx).toBeGreaterThan(-1);
    expect(cardMovedIdx).toBeGreaterThan(stagePoppedIdx);
    expect(resolvedIdx).toBeGreaterThan(cardMovedIdx);

    // 不正な resume（action / effect が存在しない場合）は fail-fast する
    const corruptedReq: ActionRequest = {
      id: "req-corrupted",
      actionId: "non.existent.action",
      controller: "p1",
      keyCards: [],
      status: "resolving",
      sequence: 99,
    };
    expect(() =>
      registry.resumeRequest(
        corruptedReq,
        firstResolve.continuation!,
        ["opt-1"],
        context
      )
    ).toThrow(/アクション定義または効果定義が存在しません/);
  });

  // ---------------------------------------------------------------------------
  // 既存契約: リクエスト対象消失時の不発解決
  // ---------------------------------------------------------------------------
  it("リクエスト対象が解決時点で存在しない場合、効果をスキップしカノニカル順序で解決完了する", () => {
    const state = createTestState();
    state.players.p1.hand = [];
    state.players.p2.hand = [];
    const logRecorder = new MatchLogRecorder({ matchId: "test-req-invalid" });
    const context = createTestContext(state, logRecorder);
    const registry = new CommandRegistry();

    const req1: ActionRequest = {
      id: "req-1",
      actionId: "action.attack",
      controller: "p1",
      keyCards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      status: "pending",
      sequence: 1,
    };

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
      targets: [
        {
          type: "request",
          requestId: "req-1",
          actionId: "action.attack",
          targetDefinitionId: "targetRequest",
        },
      ],
      status: "pending",
      sequence: 2,
    };

    state.stage.requests = [req1, req2];

    // 解決前に req1 が Stage から除去されたとする（対象消失）
    state.stage.requests = [req2];

    const result = registry.resolveTopRequest(context);

    expect(result.type).toBe("COMPLETED");
    expect(result.request.id).toBe("req-2");
    expect(result.request.status).toBe("resolved");
    expect(state.stage.requests.length).toBe(0);
    expect(state.stage.history.length).toBe(1);
    expect(state.stage.history[0].id).toBe("req-2");

    expect(state.players.p2.grave).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "p2-key-1" })])
    );

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

  // ---------------------------------------------------------------------------
  // 既存契約: ユニット対象消失時の不発解決
  // ---------------------------------------------------------------------------
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
      targets: [
        {
          type: "unit",
          unitId: "soldier-2",
          kind: "一般兵",
          componentId: "character.soldier",
          targetDefinitionId: "targetUnit",
        },
      ],
      status: "pending",
      sequence: 1,
    };

    state.stage.requests = [req];

    // 解決前に対象ユニット soldier-2 がフィールドから消失
    state.players.p2.field = [];

    const result = registry.resolveTopRequest(context);

    expect(result.type).toBe("COMPLETED");
    expect(result.request.status).toBe("resolved");
    expect(state.stage.requests.length).toBe(0);
    expect(state.stage.history[0].id).toBe("req-twist");

    expect(state.players.p1.grave).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "p1-key-1" })])
    );

    const events = logRecorder.getEvents();
    const resolvedEvent = events.find((e) => e.type === "request.resolved") as any;
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.effectSkipped).toBe(true);
    expect(resolvedEvent.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
  });

  // ---------------------------------------------------------------------------
  // ActionRequestValidator と ResolutionTargetValidator の共通条件評価一致
  // ---------------------------------------------------------------------------
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
      targets: [
        {
          type: "unit",
          unitId: "soldier-1",
          kind: "一般兵",
          componentId: "character.soldier",
          targetDefinitionId: "targetUnit",
        },
      ],
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

  // ---------------------------------------------------------------------------
  // R1-1: 不存在 targetDefinitionId は TARGET_INVALID_AT_RESOLUTION で握りつぶさず fail-fast する
  // ---------------------------------------------------------------------------
  it("【R1-1】不存在な targetDefinitionId が指定されたリクエストは TARGET_INVALID_AT_RESOLUTION で正常終了せず fail-fast（例外送出）する", () => {
    const state = createTestState();
    const context = createTestContext(state);
    const registry = new CommandRegistry();

    const action: any = {
      id: "action.test.non_existent_def",
      name: "不存在ターゲット定義アクション",
      targets: [
        {
          id: "validDefId",
          type: "unit",
          condition: { componentType: "character" },
        },
      ],
      effect: [{ command: "toggleUnitState" }],
    };

    // リクエストの targetDefinitionId が "nonExistentDef"（アクション定義に存在しない）
    const corruptedReq: ActionRequest = {
      id: "req-corrupted-def",
      actionId: "action.test.non_existent_def",
      action,
      controller: "p1",
      keyCards: [{ id: "p1-key-1", suit: "H", rank: "7", value: 7 }],
      targets: [
        {
          type: "unit",
          unitId: "soldier-1",
          kind: "一般兵",
          componentId: "character.soldier",
          targetDefinitionId: "nonExistentDef",
        },
      ],
      status: "pending",
      sequence: 1,
    };

    // 1. validateTargetsAtResolution 単体での fail-fast（例外送出）
    expect(() => validateTargetsAtResolution(action, corruptedReq, context)).toThrow(
      /アクション定義 \[action\.test\.non_existent_def\] 内に対応するターゲット定義ID \[nonExistentDef\] が存在しません（Invariant Violation）/
    );

    // 2. resolveTopRequest 経由でも TARGET_INVALID_AT_RESOLUTION として握りつぶされず fail-fast すること
    state.stage.requests = [corruptedReq];
    expect(() => registry.resolveTopRequest(context)).toThrow(
      /アクション定義 \[action\.test\.non_existent_def\] 内に対応するターゲット定義ID \[nonExistentDef\] が存在しません（Invariant Violation）/
    );
  });

  // ---------------------------------------------------------------------------
  // R1-2: 正しい Definition + 消失 Target は TARGET_INVALID_AT_RESOLUTION で正常解決する
  // ---------------------------------------------------------------------------
  it("【R1-2】正しい targetDefinitionId を持ち、対象そのものが消失した場合は TARGET_INVALID_AT_RESOLUTION として効果をスキップし正常解決する", () => {
    const state = createTestState();
    state.players.p1.hand = [];
    state.players.p2.hand = [];
    const logRecorder = new MatchLogRecorder({ matchId: "test-valid-def-disappeared-target" });
    const context = createTestContext(state, logRecorder);
    const registry = new CommandRegistry();

    const action: any = {
      id: "action.test.disappeared_target",
      name: "対象消失テストアクション",
      targets: [
        {
          id: "targetUnit",
          type: "unit",
          condition: { componentType: "character" },
        },
      ],
      effect: [{ command: "toggleUnitState" }],
    };

    // 正しい targetDefinitionId: "targetUnit"
    const req: ActionRequest = {
      id: "req-disappeared",
      actionId: "action.test.disappeared_target",
      action,
      controller: "p1",
      keyCards: [{ id: "p1-key-1", suit: "H", rank: "7", value: 7 }],
      targets: [
        {
          type: "unit",
          unitId: "soldier-1",
          kind: "一般兵",
          componentId: "character.soldier",
          targetDefinitionId: "targetUnit",
        },
      ],
      status: "pending",
      sequence: 1,
    };

    state.stage.requests = [req];

    // 対象ユニット soldier-1 がフィールドから墓地へ消失
    state.players.p1.field = [];

    // 1. validateTargetsAtResolution は例外を出さず TARGET_INVALID_AT_RESOLUTION を返す
    const valResult = validateTargetsAtResolution(action, req, context);
    expect(valResult.isValid).toBe(false);
    expect(valResult.reason).toBe("TARGET_INVALID_AT_RESOLUTION");

    // 2. resolveTopRequest は例外なく正常完了し、効果のみスキップされる（不発解決）
    const resolveResult = registry.resolveTopRequest(context);
    expect(resolveResult.type).toBe("COMPLETED");
    expect(resolveResult.request.status).toBe("resolved");
    expect(state.stage.requests.length).toBe(0);

    const events = logRecorder.getEvents();
    const resolvedEvent = events.find((e) => e.type === "request.resolved") as any;
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.effectSkipped).toBe(true);
    expect(resolvedEvent.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
  });

  // ---------------------------------------------------------------------------
  // R1-3: Official Light + Entry16 に複数 targets 定義のアクションが存在しないことを静的確認
  // ---------------------------------------------------------------------------
  it("【R1-3】Official Light + Entry16 の全ActionDefinitionにおいて targets が複数定義（length > 1）のActionが存在しないことを静的確認する", async () => {
    const catalog = await loadRegulationCatalog();
    const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", {
      assertImplemented: true,
    });
    const format = validation.format!;
    const regulation = validation.regulation!;
    const officialPackage = RegulationRulePackageSelector.selectRulePackage(
      rulePackage,
      format,
      regulation
    );

    // 公式ルールパッケージに含まれる全アクションの targets 定義数を検証
    for (const action of officialPackage.actions) {
      const targetsLength = action.targets ? action.targets.length : 0;
      expect(
        targetsLength,
        `公式アクション [${action.id}] の targets 数が複数 (${targetsLength}) です。現在のOfficial baselineには複数ターゲット定義アクションが存在しない前提です。`
      ).toBeLessThanOrEqual(1);
    }
  });
});
