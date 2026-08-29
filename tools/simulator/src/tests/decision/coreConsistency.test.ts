import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { GameSession } from "../../engine/session/GameSession";
import { PatternExecutor } from "../../engine/decision/PatternExecutor";
import { TriggerProcessingCoordinator } from "../../engine/rules/TriggerProcessingCoordinator";
import { RequestBufferProcessor } from "../../engine/rules/RequestBufferProcessor";
import { isSoldierType, isCharacterComponent, hasUnitLabel } from "../../engine/rules/characterUtils";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";

describe("Core Architecture Consistency Tests (Phase 16.5)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const createTestState = () => {
    const handKeyCard = { id: "key-d", code: "D5", suit: "D", rank: "5", value: 5 };
    const handCostCard = { id: "cost-c", code: "C2", suit: "C", rank: "2", value: 2 };
    const lifeCard = { id: "life-1", code: "H5", suit: "H", rank: "5", value: 5 };

    const soldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const bulwark = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "b1", suit: "D", rank: "5", value: 5 }],
      labels: ["防御"],
    };

    return {
      stateVersion: 1,
      version: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: [lifeCard],
          hand: [handKeyCard, handCostCard],
          field: [soldier],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [{ id: "l2", suit: "D", rank: "K", value: 13 }],
          hand: [],
          field: [bulwark],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    } as any;
  };

  it("A & B & C: Cost must be paid upon request creation, remain paid on stage, and NOT be paid again at resolveTopRequest", () => {
    const state = createTestState();
    const registry = new CommandRegistry();
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: state.players.p1.hand[0], // key: diamond
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 初期手札枚数 = 2
    expect(state.players.p1.hand.length).toBe(2);

    // A: createRequest 成立の瞬間にコスト (D) が消費される
    const req = registry.createRequest(twistAction, context);
    expect(state.players.p1.hand.length).toBe(1); // 1枚消費済み
    expect(state.players.p1.grave.length).toBe(1);

    // B: stage に pending の間、すでに支払済み
    expect(state.stage.requests.length).toBe(1);
    expect(req.status).toBe("pending");
    expect(state.players.p1.hand.length).toBe(1);

    // C: resolveTopRequest 実行時に二重支払いは発生しない
    const resolveResult = registry.resolveTopRequest(context);
    expect(resolveResult?.type).toBe("COMPLETED");
    expect(req.status).toBe("resolved");
    expect(state.players.p1.hand.length).toBe(1); // 手札は減っていない（二重消費なし）
    expect(state.players.p1.grave.length).toBe(1);
  });

  it("D: When a request is cancelled on stage, paid cost is NOT refunded", () => {
    const state = createTestState();
    const registry = new CommandRegistry();
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: state.players.p1.hand[0],
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(twistAction, context);
    expect(state.players.p1.hand.length).toBe(1);

    // カウンター等で request が cancelled に変更された場合
    req.status = "cancelled";
    const result = registry.resolveTopRequest(context);

    expect(result?.type).toBe("COMPLETED");
    expect(result?.request.status).toBe("cancelled");
    // コストは返還されず手札は1枚のまま
    expect(state.players.p1.hand.length).toBe(1);
  });

  it("E: EFFECT_RESOLUTION interruption and resumption should NOT double-pay costs", () => {
    const state = createTestState();
    const session = new GameSession(state, rulePackage);

    // p1 が attack をリクエスト
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected decision");
    const attackPatRef = step1.request.patterns.findIndex((p: any) => {
      const act = step1.request.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });
    session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: attackPatRef,
    });

    // p1 PASS, p2 PASS
    const step3 = session.advance();
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected decision");
    session.submitDecision({ decisionId: step3.request.decisionId, stateVersion: step3.request.stateVersion, selectedPatternRef: step3.request.patterns.findIndex((p: any) => p.kind === "PASS") });
    const step5 = session.advance();
    if (step5.type !== "WAITING_FOR_DECISION") throw new Error("Expected decision");
    const step6 = session.submitDecision({ decisionId: step5.request.decisionId, stateVersion: step5.request.stateVersion, selectedPatternRef: step5.request.patterns.findIndex((p: any) => p.kind === "PASS") });

    // アタッカー選択 (soldier-1)
    if (step6.type !== "WAITING_FOR_DECISION") throw new Error("Expected decision");
    const selRef = step6.request.patterns.findIndex((p) => {
      const effSel = step6.request.catalog.effectSelections[p.effectSelectionRef!];
      return effSel.selectedValues?.includes("soldier-1");
    });

    const initialGraveCount = state.players.p1.grave.length;
    session.submitDecision({
      decisionId: step6.request.decisionId,
      stateVersion: step6.request.stateVersion,
      selectedPatternRef: selRef,
    });

    // 再開後も余分なコスト消費は発生しない
    expect(state.players.p1.grave.length).toBe(initialGraveCount);
  });

  it("F & G: Generic selectionId in EffectContinuation should bind to context.selections[selectionId]", () => {
    const registry = new CommandRegistry();
    const state = createTestState();

    const mockRequest: any = {
      id: "req-mock-1",
      actionId: "action.custom",
      controller: "p1",
      keyCards: [],
      status: "resolving",
      action: {
        id: "action.custom",
        effect: [
          { selectUnits: { count: 2, saveAs: "sacrifices" } },
        ],
      },
    };

    const continuation: any = {
      sourceRequestId: "req-mock-1",
      effectPath: [0],
      effectStepId: "selectCustomUnits",
      selectionId: "sacrifices", // 任意の selectionId
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // resumeRequest を実行
    const result = registry.resumeRequest(
      mockRequest,
      continuation,
      ["unit-1", "unit-2"],
      context
    );

    expect(result.type).toBe("COMPLETED");
    expect(context.selections?.sacrifices).toEqual(["unit-1", "unit-2"]);
  });

  it("H & I: character / characterType detection without componentId prefix dependency", () => {
    const customSoldierComponent = {
      id: "custom.dark_knight.999", // componentId に "soldier" や "character." が含まれない独自ID
      type: "character",
      properties: { characterType: "soldier" },
      display: { kind: "黒騎士", labels: ["攻撃", "防御"] },
    };

    const customUnit = {
      unitId: "dk-1",
      componentId: "custom.dark_knight.999",
      state: "charge",
      labels: ["攻撃"],
    };

    const components = [customSoldierComponent as any];

    // H: componentId prefix に依存せず character であると判定
    expect(isCharacterComponent(customUnit, components)).toBe(true);

    // I: properties.characterType === "soldier" から兵士と正しく判定
    expect(isSoldierType(customUnit, components)).toBe(true);

    // ラベル判定の共通性
    expect(hasUnitLabel(customUnit, "攻撃", components)).toBe(true);
    expect(hasUnitLabel(customUnit, "防御", components)).toBe(true);
  });

  it("J: startAttackHandler should reject unit that lost attack label at resolution time", () => {
    const state = createTestState();
    const registry = new CommandRegistry();
    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;

    // アタッカーユニットから「攻撃」ラベルを削除
    state.players.p1.field[0].labels = ["防御"]; // 攻撃ラベルなし
    // componentDefinition 側からも攻撃ラベルなしのモック
    const componentsWithoutAttack = rulePackage.components.map((c) =>
      c.id === "character.soldier"
        ? {
            ...c,
            display: { ...c.display, labels: ["防御"] },
            properties: { ...c.properties, labels: ["defense"] },
          }
        : c
    );


    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: componentsWithoutAttack,
      selections: { attackers: ["soldier-1"] },
    };

    expect(() => {
      registry.execute("startAttack", { attackers: "selection.attackers", defender: "opponent" }, context);
    }).toThrow("攻撃ラベルを持たないキャラクターはアタッカーに指定できません。");
  });

  it("K: requestBuffer validation failure should NOT mutate buffer requests, nextRequestSeq, or stage", () => {
    const state = createTestState();
    const coordinator = new TriggerProcessingCoordinator();
    const registry = new CommandRegistry();

    // 不正な条件の誘発リクエストをバッファに積む（例: 相手アタッカーがいないのにブロッカー指定付き action.block）
    const invalidTriggeredReq = {
      actionId: "action.block",
      controller: "p2",
      action: rulePackage.actions.find((a) => a.id === "action.block")!,
      sourceEvent: { type: "actionResolved", payload: {} },
      targetComponent: { unitId: "non-existent" },
    };
    state.requestBuffer.requests.push(invalidTriggeredReq);
    state.nextRequestSeq = 10;

    const initialBufferLen = state.requestBuffer.requests.length;
    const initialStageLen = state.stage.requests.length;
    const initialSeq = state.nextRequestSeq;

    // validation でエラーがスローされる
    expect(() => {
      coordinator.processPendingTriggers(state, rulePackage, registry);
    }).toThrow();

    // バッファ、連番、ステージが一切破壊されていないことを検証
    expect(state.requestBuffer.requests.length).toBe(initialBufferLen);
    expect(state.nextRequestSeq).toBe(initialSeq);
    expect(state.stage.requests.length).toBe(initialStageLen);
  });

  it("L: Stale DecisionResponse with outdated stateVersion should be rejected", () => {
    const request: any = {
      decisionId: "dec-100",
      stateVersion: 5,
      patterns: [{ patternId: "p1", kind: "PASS" }],
    };

    const staleResponse: DecisionResponse = {
      decisionId: "dec-100",
      stateVersion: 4, // 古いバージョン
      selectedPatternRef: 0,
    };

    // 要求バージョンと回答バージョンの不一致で拒否
    expect(() => {
      PatternExecutor.validateResponse(request, staleResponse, 5);
    }).toThrow("State Version が一致しません。");

    // 現在の盤面バージョン (6) と回答バージョン (5) の不一致でも拒否
    const matchedReqResponse: DecisionResponse = {
      decisionId: "dec-100",
      stateVersion: 5,
      selectedPatternRef: 0,
    };
    expect(() => {
      PatternExecutor.validateResponse(request, matchedReqResponse, 6);
    }).toThrow("State Version が現在の盤面状態と一致しません。現在: 6, 回答: 5");
  });
});
