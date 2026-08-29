import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { GameSession } from "../../engine/session/GameSession";
import { TriggerProcessingCoordinator } from "../../engine/rules/TriggerProcessingCoordinator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { PatternExecutor } from "../../engine/decision/PatternExecutor";

describe("Phase 16.5 Hotfix Consistency Tests", () => {
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
          life: [{ id: "l1", suit: "S", rank: "A", value: 1 }],
          hand: [],
          field: [],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [{ id: "l2", suit: "D", rank: "K", value: 13 }],
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

  it("A: Unit with <攻撃> only in ComponentDefinition (unit.labels is empty) is selectable in findSelectableUnits", () => {
    const registry = new CommandRegistry();
    const effectInterpreter = registry.getEffectInterpreter();

    const customComp = {
      id: "comp.attacker.custom",
      type: "character",
      properties: { characterType: "soldier" },
      display: { labels: ["攻撃"] },
    };

    const unitWithoutLabels = {
      unitId: "u-attacker-1",
      componentId: "comp.attacker.custom",
      state: "charge",
      labels: [], // unit 側には labels がない
    };

    const state = createBaseState();
    state.players.p1.field.push(unitWithoutLabels);

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: [customComp as any],
    };

    const selectable = effectInterpreter.findSelectableUnits(
      {
        relation: "self",
        condition: { state: "charge", label: "攻撃", componentType: "character" },
      },
      context
    );

    expect(selectable.length).toBe(1);
    expect(selectable[0].unitId).toBe("u-attacker-1");
  });

  it("B: Unit with <防御> only in ComponentDefinition (unit.labels is empty) is selectable for block assignment", () => {
    const customComp = {
      id: "comp.defender.custom",
      type: "character",
      properties: { characterType: "soldier" },
      display: { labels: ["防御"] },
    };

    const blockerUnit = {
      unitId: "u-defender-1",
      componentId: "comp.defender.custom",
      state: "charge",
      labels: [], // 空配列
    };

    const state = createBaseState();
    state.players.p2.field.push(blockerUnit);

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(attacker);

    const mockRequest: any = {
      id: "req-block-test",
      actionId: "action.block",
      controller: "p2",
    };

    const { request } = LegalPatternGenerator.generateBlockAssignmentDecision(
      state,
      "p2",
      mockRequest,
      "selectBlockAssignments",
      [attacker],
      [blockerUnit],
      [customComp as any]
    );

    // 0体ブロックと1体ブロック（u-defender-1 -> u-att-1）の2パターンが生成されること
    expect(request.patterns.length).toBe(2);
    const assignedPattern = request.patterns.find((p) => {
      const effSel = request.catalog.effectSelections[p.effectSelectionRef!];
      return effSel?.assignments?.[0]?.selectedUnitIds?.includes("u-defender-1");
    });
    expect(assignedPattern).toBeDefined();
  });

  it("C: Custom componentId without character.* prefix is selectable when ComponentDefinition.type === 'character'", () => {
    const registry = new CommandRegistry();
    const effectInterpreter = registry.getEffectInterpreter();

    const customKnight = {
      id: "my_pack.custom_unit_999", // character. プレフィックスなし
      type: "character",
      properties: { characterType: "bulwark" },
      display: { labels: ["防御"] },
    };

    const unit = {
      unitId: "unit-custom-1",
      componentId: "my_pack.custom_unit_999",
      state: "charge",
    };

    const state = createBaseState();
    state.players.p1.field.push(unit);

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: [customKnight as any],
    };

    const selectable = effectInterpreter.findSelectableUnits(
      {
        relation: "self",
        condition: { componentType: "character", label: "防御" },
      },
      context
    );

    expect(selectable.length).toBe(1);
    expect(selectable[0].unitId).toBe("unit-custom-1");
  });

  it("D & E: Action with sequential selectUnits interrupts twice, maintains matching stateVersion at Decision2, and finishes cleanly", () => {
    const multiSelectAction: ActionDefinition = {
      id: "action.multiSelect",
      name: "マルチ選択",
      type: "magic",
      request: {
        trigger: "direct",
        speed: "normal",
        timing: "main",
      },
      effect: [
        {
          selectUnits: {
            id: "step1",
            saveAs: "firstSelection",
            relation: "self",
            condition: { state: "charge" },
          },
        },
        {
          selectUnits: {
            id: "step2",
            saveAs: "secondSelection",
            relation: "self",
            condition: { state: "charge" },
          },
        },
      ],
    };

    const state = createBaseState();
    state.players.p1.field.push(
      { unitId: "u1", componentId: "character.soldier", state: "charge", labels: ["攻撃"] },
      { unitId: "u2", componentId: "character.soldier", state: "charge", labels: ["攻撃"] }
    );

    const customRules: RulePackage = {
      ...rulePackage,
      actions: [...rulePackage.actions, multiSelectAction],
    };

    const session = new GameSession(state, customRules);

    // 1. メイン行動 Decision (action.multiSelect を選択)
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const actPatRef = step1.request.patterns.findIndex((p: any) => {
      const act = step1.request.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.multiSelect";
    });
    session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: actPatRef,
    });

    // 2. 全員 PASS して stage の multiSelect を解決開始
    const step3 = session.advance();
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected decision");
    session.submitDecision({ decisionId: step3.request.decisionId, stateVersion: step3.request.stateVersion, selectedPatternRef: step3.request.patterns.findIndex((p: any) => p.kind === "PASS") });
    const step5 = session.advance();
    if (step5.type !== "WAITING_FOR_DECISION") throw new Error("Expected decision");
    const step6 = session.submitDecision({ decisionId: step5.request.decisionId, stateVersion: step5.request.stateVersion, selectedPatternRef: step5.request.patterns.findIndex((p: any) => p.kind === "PASS") });

    // 3. 第1回目の中断 Decision (firstSelection)
    expect(step6.type).toBe("WAITING_FOR_DECISION");
    if (step6.type !== "WAITING_FOR_DECISION") return;
    expect(step6.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step6.request.stateVersion).toBe(session.stateVersion); // stateVersion 一致

    const sel1Ref = step6.request.patterns.findIndex((p: any) => {
      const effSel = step6.request.catalog.effectSelections[p.effectSelectionRef!];
      return effSel?.selectedValues?.includes("u1");
    });

    // 第1回目の選択を submitDecision
    const step7 = session.submitDecision({
      decisionId: step6.request.decisionId,
      stateVersion: step6.request.stateVersion,
      selectedPatternRef: sel1Ref,
    });

    // 4. E: 第2回目の中断 Decision (secondSelection) の stateVersion が current stateVersion と一致し stale 判定されないこと
    expect(step7.type).toBe("WAITING_FOR_DECISION");
    if (step7.type !== "WAITING_FOR_DECISION") return;
    expect(step7.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step7.request.stateVersion).toBe(session.stateVersion); // E: 一致していること！

    const sel2Ref = step7.request.patterns.findIndex((p: any) => {
      const effSel = step7.request.catalog.effectSelections[p.effectSelectionRef!];
      return effSel?.selectedValues?.includes("u2");
    });

    // 第2回目の選択を submitDecision（stale 例外がスローされず正常受理されること）
    const step8 = session.submitDecision({
      decisionId: step7.request.decisionId,
      stateVersion: step7.request.stateVersion,
      selectedPatternRef: sel2Ref,
    });

    // 5. D: 解決完了して通常ターン進行に戻ること
    expect(state.stage.history.some((r: any) => r.actionId === "action.multiSelect" && r.status === "resolved")).toBe(true);
    expect(step8.type).toBe("WAITING_FOR_DECISION"); // 次のターンの行動判断へ
  });

  it("F: Direct immediate action interrupting with EFFECT_RESOLUTION has matching pendingDecision.stateVersion and current stateVersion", () => {
    const immediateSelectAction: ActionDefinition = {
      id: "action.immediateSelect",
      name: "即時選択",
      type: "magic",
      request: {
        trigger: "direct",
        speed: "immediate", // 即時アクション
        timing: "main",
      },
      effect: [
        {
          selectUnits: {
            id: "stepImmediate",
            saveAs: "immediateChoice",
            relation: "self",
            condition: { state: "charge" },
          },
        },
      ],
    };

    const state = createBaseState();
    state.players.p1.field.push(
      { unitId: "u1", componentId: "character.soldier", state: "charge", labels: ["攻撃"] }
    );

    const customRules: RulePackage = {
      ...rulePackage,
      actions: [...rulePackage.actions, immediateSelectAction],
    };

    const session = new GameSession(state, customRules);

    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const actPatRef = step1.request.patterns.findIndex((p: any) => {
      const act = step1.request.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.immediateSelect";
    });

    // 即時アクションを選択して submit
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: actPatRef,
    });

    // 即時解決の途中で EFFECT_RESOLUTION 中断
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") return;
    expect(step2.request.source.type).toBe("EFFECT_RESOLUTION");

    // F: pendingDecision.stateVersion と session.stateVersion が一致していること
    expect(step2.request.stateVersion).toBe(session.stateVersion);

    // 回答を提出して stale 例外が発生せず正常完了すること
    const selRef = step2.request.patterns.findIndex((p: any) => {
      const effSel = step2.request.catalog.effectSelections[p.effectSelectionRef!];
      return effSel?.selectedValues?.includes("u1");
    });

    expect(() => {
      session.submitDecision({
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: selRef,
      });
    }).not.toThrow();
  });

  it("G: When second interruption after resume is unitAssignment, it correctly generates assignment Decision", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const attacker = {
      unitId: "u-att-1",
      componentId: "character.soldier",
      state: "drive",
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const blocker = {
      unitId: "u-blk-1",
      componentId: "character.soldier",
      state: "charge",
      labels: ["防御"],
    };
    state.players.p1.field.push(attacker);
    state.players.p2.field.push(blocker);

    const complexAction: ActionDefinition = {
      id: "action.complexCombat",
      name: "複合戦闘",
      type: "magic",
      request: {
        trigger: "direct",
        speed: "normal",
        timing: "main",
      },
      effect: [
        { selectUnits: { id: "step1", saveAs: "firstSel" } },
        { selectBlockAssignments: { id: "step2", saveAs: "blockSel" } },
      ],
    };

    const mockRequest: any = {
      id: "req-complex-1",
      actionId: "action.complexCombat",
      controller: "p2",
      keyCards: [],
      status: "resolving",
      action: complexAction,
    };

    const continuation: any = {
      sourceRequestId: "req-complex-1",
      effectPath: [0], // step1 完了後
      effectStepId: "step1",
      selectionId: "firstSel",
    };

    const context: CommandContext = {
      state,
      playerKey: "p2",
      actions: [complexAction],
      components: rulePackage.components,
    };

    // step1 の選択を受け取って resumeRequest
    const resumeResult = registry.resumeRequest(
      mockRequest,
      continuation,
      ["u-dummy"],
      context
    );

    // G: 2回目の中断が selectBlockAssignments (unitAssignment) の DecisionRequest となること
    expect(resumeResult.type).toBe("WAITING_FOR_DECISION");
    if (resumeResult.type !== "WAITING_FOR_DECISION") return;
    expect(resumeResult.decisionRequest.catalog.effectSelections).toBeDefined();

    // pattern に unitAssignment が含まれていること
    const hasAssignments = resumeResult.decisionRequest.catalog.effectSelections.some(
      (sel: any) => sel.assignments !== undefined
    );
    expect(hasAssignments).toBe(true);
  });

  it("H: requestBuffer validation failure does NOT mutate requests count OR requests array order", () => {
    const state = createBaseState();
    const coordinator = new TriggerProcessingCoordinator();
    const registry = new CommandRegistry();

    // 順序が異なる複数の誘発リクエストを用意
    const reqLowPriority = {
      actionId: "action.low",
      controller: "p2",
      action: {
        id: "action.low",
        name: "低優先",
        request: { trigger: "damage", timing: "auto", speed: "normal" },
      } as any,
      sourceEvent: { type: "unitStateChanged" },
      sequence: 10,
    };

    // validation で必ず失敗する不正アクション（キーカード要求を満たさない等）
    const reqInvalidHighPriority = {
      actionId: "action.twist",
      controller: "p1",
      action: rulePackage.actions.find((a) => a.id === "action.twist")!, // keyCard diamond が必要
      keyCards: [], // 0枚のため validation 失敗
      sourceEvent: { type: "unitStateChanged" },
      sequence: 1,
    };

    state.requestBuffer.requests = [reqLowPriority, reqInvalidHighPriority];

    // 初期の並び順（配列参照）をディープコピーして保持
    const originalRequestsSnapshot = [...state.requestBuffer.requests];

    expect(() => {
      coordinator.processPendingTriggers(state, rulePackage, registry);
    }).toThrow();

    // H: 件数だけでなく配列の並び順も一切変更されていないこと
    expect(state.requestBuffer.requests.length).toBe(2);
    expect(state.requestBuffer.requests[0]).toBe(originalRequestsSnapshot[0]);
    expect(state.requestBuffer.requests[1]).toBe(originalRequestsSnapshot[1]);
  });

  it("I: Action without key (e.g. setBulwark) generates DecisionPattern without keyCardSelectionRef and skips key selection", () => {
    const state = createBaseState();
    state.players.p1.life = [{ id: "l1", suit: "S", rank: "2", value: 2 }];
    state.players.p1.hand = [{ id: "h1", suit: "H", rank: "5", value: 5 }];

    const { request: decisionReq } = LegalPatternGenerator.generateActionRequestDecision(
      state,
      "p1",
      rulePackage
    );


    // setBulwark アクションのパターンを検索
    const setBulwarkActionRef = decisionReq.catalog.actions.findIndex(
      (a) => a.actionId === "action.setBulwark"
    );
    expect(setBulwarkActionRef).toBeGreaterThanOrEqual(0);

    const bulwarkPatterns = decisionReq.patterns.filter(
      (p) => p.actionSelectionRef === setBulwarkActionRef
    );
    expect(bulwarkPatterns.length).toBeGreaterThan(0);

    // C: 全ての setBulwark パターンで keyCardSelectionRef が undefined であること
    for (const p of bulwarkPatterns) {
      expect(p.keyCardSelectionRef).toBeUndefined();
    }

    // D & E: DecisionPanel 側の availableKeyRefs 導出ロジックで keyCardSelectionRef !== undefined のみ抽出されると空配列になること
    const availableKeyRefs = Array.from(
      new Set(bulwarkPatterns.map((p) => p.keyCardSelectionRef).filter((r): r is number => r !== undefined))
    );
    expect(availableKeyRefs.length).toBe(0);
  });
});

