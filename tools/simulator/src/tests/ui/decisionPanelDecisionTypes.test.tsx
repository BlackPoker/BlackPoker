import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeAll } from "vitest";
import path from "path";
import { DecisionPanel, formatCostPaymentDisplay } from "../../ui/decision/DecisionPanel";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionRequest } from "../../domain/rules/RulePackage";
import { TurnManager } from "../../engine/rules/TurnManager";

/**
 * テストレンダラー内のボタン探索ヘルパー
 */
function extractText(instance: TestRenderer.ReactTestInstance): string {
  if (typeof instance.children === "string") return instance.children;
  if (!Array.isArray(instance.children)) return "";
  return instance.children
    .map((c) => (typeof c === "string" ? c : typeof c === "object" ? extractText(c) : ""))
    .join("");
}

function findButton(
  root: TestRenderer.ReactTestInstance,
  predicate: (text: string, btn: TestRenderer.ReactTestInstance) => boolean
): TestRenderer.ReactTestInstance {
  const buttons = root.findAllByType("button");
  const found = buttons.find((btn) => predicate(extractText(btn), btn));
  if (!found) {
    const list = buttons.map((b) => `"${extractText(b)}"`).join(", ");
    throw new Error(`Button not found. Available buttons: [${list}]`);
  }
  return found;
}

function findAllButtons(
  root: TestRenderer.ReactTestInstance,
  predicate: (text: string, btn: TestRenderer.ReactTestInstance) => boolean
): TestRenderer.ReactTestInstance[] {
  const buttons = root.findAllByType("button");
  return buttons.filter((btn) => predicate(extractText(btn), btn));
}

/**
 * UI Component Evidence トラッカー
 */
export class UIComponentEvidenceTracker {
  private records: Map<string, { type: string; evidenceTest: string; status: "PASS" | "FAIL"; summary: string }> = new Map();

  record(type: string, evidenceTest: string, status: "PASS" | "FAIL", summary: string) {
    this.records.set(type, { type, evidenceTest, status, summary });
  }

  getCount(): number {
    return this.records.size;
  }

  getAll(): Array<{ type: string; evidenceTest: string; status: "PASS" | "FAIL"; summary: string }> {
    return Array.from(this.records.values());
  }

  isAllPass(): boolean {
    return this.records.size === 7 && Array.from(this.records.values()).every((r) => r.status === "PASS");
  }
}

export const uiComponentEvidenceTracker = new UIComponentEvidenceTracker();

describe("DecisionPanel 7 Decision Types Component Evidence Tests [BP-SIM-REG-5.0-K-R6]", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  // 1. Action Selection
  it("UI-1: Action Selection - click action button and submit through DecisionPanel", () => {
    const state: any = {
      stateVersion: 1,
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [{ id: "h1", suit: "H", rank: "5", value: 5 }],
          field: [],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
        p2: {
          name: "Player 2",
          life: [{ id: "l2", suit: "D", rank: "2", value: 2 }],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
      },
      stage: { requests: [], history: [] },
      turnUsage: {},
    };
    TurnManager.initializeToMain(state, "p1");

    const { request } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    expect(request.patterns.length).toBeGreaterThan(0);

    const onSubmit = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={request} onSubmit={onSubmit} />
      );
    });

    // Action ボタンを検索してクリック
    const actionBtn = findButton(renderer.root, (text) =>
      text.includes("防壁設置") || text.includes("setBulwark")
    );
    act(() => {
      actionBtn.props.onClick();
    });

    // 決定ボタン（「リクエスト＆PASS」または「リクエストのみ」）をクリック
    const submitBtn = findButton(renderer.root, (text) =>
      text.includes("リクエスト")
    );
    act(() => {
      submitBtn.props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedResponse: DecisionResponse = onSubmit.mock.calls[0][0];
    expect(submittedResponse.decisionId).toBe(request.decisionId);
    expect(submittedResponse.stateVersion).toBe(request.stateVersion);

    const matchedPattern = request.patterns[submittedResponse.selectedPatternRef];
    expect(matchedPattern).toBeDefined();
    expect(matchedPattern.actionSelectionRef).toBeDefined();
    expect(matchedPattern.kind).toBe("ACTION");

    uiComponentEvidenceTracker.record(
      "action",
      "UI-1",
      "PASS",
      `Action Selection verified via DecisionPanel click -> onSubmit (patternRef: ${submittedResponse.selectedPatternRef})`
    );
  });

  // 2. Card / Key Card Selection
  it("UI-2: Card / Key Card Selection - multiple key cards rendered and selected via DecisionPanel", () => {
    // 複数の召喚可能 Soldier を手札に持たせる
    const state: any = {
      stateVersion: 1,
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [
            { id: "s1", suit: "S", rank: "5", value: 5 },
            { id: "s2", suit: "D", rank: "6", value: 6 },
          ],
          field: [
            {
              unitId: "b1",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "charge",
              cards: [{ id: "bc1", suit: "H", rank: "2", value: 2 }],
              labels: ["防御"],
            },
          ],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
        p2: {
          name: "Player 2",
          life: [{ id: "l2", suit: "D", rank: "2", value: 2 }],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
      },
      stage: { requests: [], history: [] },
      turnUsage: {},
    };
    TurnManager.initializeToMain(state, "p1");

    const { request } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    expect(request.catalog.cardSelections.length).toBeGreaterThanOrEqual(2);

    const onSubmit = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={request} onSubmit={onSubmit} />
      );
    });

    // 1. Action ボタン（兵士召喚）をクリック
    const summonBtn = findButton(renderer.root, (text) =>
      text.includes("兵士召喚") || text.includes("summonSoldier")
    );
    act(() => {
      summonBtn.props.onClick();
    });

    // 2. キーカードボタン群を確認し、2枚目のカード（s2: ♦6）をクリック
    const keyCard2 = request.catalog.cardSelections.find((c) => c.cardIds.includes("s2"));
    expect(keyCard2).toBeDefined();
    const keyCard2Ref = request.catalog.cardSelections.indexOf(keyCard2!);

    const keyCardBtn = findButton(renderer.root, (text) =>
      text.includes("6") || text.includes("♦") || text.includes("D")
    );
    act(() => {
      keyCardBtn.props.onClick();
    });

    // 3. 決定ボタンをクリック
    const submitBtn = findButton(renderer.root, (text) => text.includes("リクエスト"));
    act(() => {
      submitBtn.props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedResponse: DecisionResponse = onSubmit.mock.calls[0][0];
    const matchedPattern = request.patterns[submittedResponse.selectedPatternRef];

    expect(matchedPattern).toBeDefined();
    expect(matchedPattern.keyCardSelectionRef).toBe(keyCard2Ref);

    uiComponentEvidenceTracker.record(
      "card",
      "UI-2",
      "PASS",
      `Card Selection verified via DecisionPanel key card click -> onSubmit (keyCardSelectionRef: ${keyCard2Ref})`
    );
  });

  // 3. Unit Target Selection
  it("UI-3: Unit Target Selection - unit target rendered and selected via DecisionPanel", () => {
    // 2体の Soldier ユニットが存在し、action.up で選択可能
    const state: any = {
      stateVersion: 1,
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [
            { id: "k1", suit: "H", rank: "2", value: 2 },
            { id: "d1", suit: "D", rank: "3", value: 3 },
          ],
          field: [
            {
              unitId: "u1",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "sc1", suit: "S", rank: "5", value: 5 }],
              labels: ["攻撃", "防御"],
            },
            {
              unitId: "u2",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "sc2", suit: "C", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            },
          ],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
        p2: {
          name: "Player 2",
          life: [{ id: "l2", suit: "D", rank: "2", value: 2 }],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
      },
      stage: { requests: [], history: [] },
      turnUsage: {},
    };
    TurnManager.initializeToMain(state, "p1");

    const { request } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    const unitTargets = request.catalog.targetSelections.filter((t) => t.targetType === "unit");
    expect(unitTargets.length).toBeGreaterThanOrEqual(2);

    const target2 = unitTargets.find((t) => t.targetUnitId === "u2");
    expect(target2).toBeDefined();
    const target2Ref = request.catalog.targetSelections.indexOf(target2!);

    const onSubmit = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={request} onSubmit={onSubmit} />
      );
    });

    // 1. Action ボタン（アップ）をクリック
    const upBtn = findButton(renderer.root, (text) => text.includes("アップ") || text.includes("up"));
    act(() => {
      upBtn.props.onClick();
    });

    // 2. Unit Target ボタン（u2 に対応するボタン）をクリック
    const unitTargetBtn = findButton(renderer.root, (text) =>
      text.includes("u2") || text.includes("6") || (target2?.primaryLabel ? text.includes(target2.primaryLabel) : false)
    );
    act(() => {
      unitTargetBtn.props.onClick();
    });

    // 3. 決定ボタンをクリック
    const submitBtn = findButton(renderer.root, (text) => text.includes("リクエスト"));
    act(() => {
      submitBtn.props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedResponse: DecisionResponse = onSubmit.mock.calls[0][0];
    const matchedPattern = request.patterns[submittedResponse.selectedPatternRef];

    expect(matchedPattern).toBeDefined();
    expect(matchedPattern.targetSelectionRef).toBe(target2Ref);
    const selectedTarget = request.catalog.targetSelections[matchedPattern.targetSelectionRef!];
    expect(selectedTarget.targetType).toBe("unit");
    expect(selectedTarget.targetUnitId).toBe("u2");

    uiComponentEvidenceTracker.record(
      "unit target",
      "UI-3",
      "PASS",
      `Unit Target Selection verified via DecisionPanel target button click -> onSubmit (targetUnitId: u2)`
    );
  });

  // 4. Player Target Selection
  it("UI-4: Player Target Selection - player target rendered and selected via DecisionPanel", () => {
    // action.throwing: プレイヤー対象（p2）
    const state: any = {
      stateVersion: 1,
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [
            { id: "k1", suit: "S", rank: "3", value: 3 },
            { id: "k2", suit: "C", rank: "4", value: 4 },
          ],
          field: [],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
        p2: {
          name: "Player 2",
          life: [{ id: "l2", suit: "D", rank: "2", value: 2 }],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
      },
      stage: { requests: [], history: [] },
      turnUsage: {},
    };
    TurnManager.initializeToMain(state, "p1");

    const { request } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    const playerTarget = request.catalog.targetSelections.find((t) => t.targetType === "player");
    expect(playerTarget).toBeDefined();
    expect(playerTarget!.targetPlayerKey).toBe("p2");
    const playerTargetRef = request.catalog.targetSelections.indexOf(playerTarget!);

    const onSubmit = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={request} onSubmit={onSubmit} />
      );
    });

    // 1. Action ボタン（投擲）をクリック
    const throwingBtn = findButton(renderer.root, (text) =>
      text.includes("投擲") || text.includes("throwing")
    );
    act(() => {
      throwingBtn.props.onClick();
    });

    // 2. Player Target ボタンをクリック
    const playerBtn = findButton(renderer.root, (text) =>
      text.includes("Player B") || text.includes("相手") || text.includes("p2") || (playerTarget?.primaryLabel ? text.includes(playerTarget.primaryLabel) : false)
    );
    act(() => {
      playerBtn.props.onClick();
    });

    // 3. 決定ボタンをクリック
    const submitBtn = findButton(renderer.root, (text) => text.includes("リクエスト"));
    act(() => {
      submitBtn.props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedResponse: DecisionResponse = onSubmit.mock.calls[0][0];
    const matchedPattern = request.patterns[submittedResponse.selectedPatternRef];

    expect(matchedPattern).toBeDefined();
    expect(matchedPattern.targetSelectionRef).toBe(playerTargetRef);
    const selectedTarget = request.catalog.targetSelections[matchedPattern.targetSelectionRef!];
    expect(selectedTarget.targetType).toBe("player");
    expect(selectedTarget.targetPlayerKey).toBe("p2");

    uiComponentEvidenceTracker.record(
      "player target",
      "UI-4",
      "PASS",
      `Player Target Selection verified via DecisionPanel player target button click -> onSubmit (targetPlayerKey: p2)`
    );
  });

  // 5. Request Target Selection
  it("UI-5: Request Target Selection - request target rendered and selected with onHighlightRequest integration", () => {
    // action.counter: ステージ上のリクエスト対象 (req-up)
    const state: any = {
      stateVersion: 1,
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p2",
      players: {
        p1: {
          name: "Player 1",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
        p2: {
          name: "Player 2",
          life: [{ id: "l2", suit: "D", rank: "2", value: 2 }],
          hand: [
            { id: "ck", suit: "C", rank: "10", value: 10 },
            { id: "cd", suit: "D", rank: "2", value: 2 },
          ],
          field: [],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
      },
      stage: {
        requests: [
          {
            id: "req-up",
            actionId: "action.up",
            controller: "p1",
            sequence: 1,
            status: "pending",
            keyCards: [{ id: "k-up", suit: "H", rank: "2", value: 2 }],
          },
        ],
        history: [],
      },
      turnUsage: {},
    };

    const { request } = LegalPatternGenerator.generateActionRequestDecision(state, "p2", rulePackage);
    const reqTarget = request.catalog.targetSelections.find((t) => t.targetType === "request");
    expect(reqTarget).toBeDefined();
    expect(reqTarget!.targetRequestId).toBe("req-up");
    const reqTargetRef = request.catalog.targetSelections.indexOf(reqTarget!);

    const onSubmit = vi.fn();
    const onHighlightRequest = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={request}
          onSubmit={onSubmit}
          onHighlightRequest={onHighlightRequest}
        />
      );
    });

    // 1. Action ボタン（カウンター）をクリック
    const counterBtn = findButton(renderer.root, (text) =>
      text.includes("カウンター") || text.includes("counter")
    );
    act(() => {
      counterBtn.props.onClick();
    });

    // 2. Request Target ボタンをクリック
    const reqTargetBtn = findButton(renderer.root, (text) =>
      text.includes("req-up") || text.includes("TOP") || text.includes("アップ") || (reqTarget?.primaryLabel ? text.includes(reqTarget.primaryLabel) : false)
    );
    act(() => {
      reqTargetBtn.props.onClick();
    });

    // onHighlightRequest が対象リクエストIDで呼び出されたことを検証
    expect(onHighlightRequest).toHaveBeenCalledWith("req-up");

    // 3. 決定ボタンをクリック
    const submitBtn = findButton(renderer.root, (text) => text.includes("リクエスト"));
    act(() => {
      submitBtn.props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedResponse: DecisionResponse = onSubmit.mock.calls[0][0];
    const matchedPattern = request.patterns[submittedResponse.selectedPatternRef];

    expect(matchedPattern).toBeDefined();
    expect(matchedPattern.targetSelectionRef).toBe(reqTargetRef);
    const selectedTarget = request.catalog.targetSelections[matchedPattern.targetSelectionRef!]!;
    expect(selectedTarget.targetType).toBe("request");
    expect(selectedTarget.targetRequestId).toBe("req-up");

    uiComponentEvidenceTracker.record(
      "request target",
      "UI-5",
      "PASS",
      `Request Target Selection verified via DecisionPanel request target click with onHighlightRequest -> onSubmit (targetRequestId: req-up)`
    );
  });

  // 6. Cost Payment Selection
  it("UI-6: Cost Payment Selection - multiple cost candidates rendered and selected via DecisionPanel", () => {
    // 手札コストとして複数の破棄カード候補が存在する盤面
    const state: any = {
      stateVersion: 1,
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [
            { id: "k1", suit: "H", rank: "2", value: 2 },
            { id: "d1", suit: "D", rank: "3", value: 3 },
            { id: "d2", suit: "C", rank: "4", value: 4 },
          ],
          field: [
            {
              unitId: "u1",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "sc1", suit: "S", rank: "5", value: 5 }],
              labels: ["攻撃", "防御"],
            },
          ],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
        p2: {
          name: "Player 2",
          life: [{ id: "l2", suit: "D", rank: "2", value: 2 }],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          pack: [],
          rareCards: [],
        },
      },
      stage: { requests: [], history: [] },
      turnUsage: {},
    };
    TurnManager.initializeToMain(state, "p1");

    const { request } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    expect(request.catalog.costPayments.length).toBeGreaterThanOrEqual(2);

    const cost2 = request.catalog.costPayments.find((c) => c.discardedCardIds.includes("d2"));
    expect(cost2).toBeDefined();
    const cost2Ref = request.catalog.costPayments.indexOf(cost2!);

    const onSubmit = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={request} onSubmit={onSubmit} />
      );
    });

    // 1. Action ボタン（アップ）をクリック
    const upBtn = findButton(renderer.root, (text) => text.includes("アップ") || text.includes("up"));
    act(() => {
      upBtn.props.onClick();
    });

    // 2. Cost ボタン（d2破棄を含むコストボタン）をクリック
    const expectedCostLabel = formatCostPaymentDisplay(cost2!, request);
    const costBtn = findButton(renderer.root, (text) => text.includes(expectedCostLabel));
    act(() => {
      costBtn.props.onClick();
    });

    // 3. 決定ボタンをクリック
    const submitBtn = findButton(renderer.root, (text) => text.includes("リクエスト"));
    act(() => {
      submitBtn.props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedResponse: DecisionResponse = onSubmit.mock.calls[0][0];
    const matchedPattern = request.patterns[submittedResponse.selectedPatternRef];

    expect(matchedPattern).toBeDefined();
    expect(matchedPattern.costPaymentRef).toBe(cost2Ref);

    uiComponentEvidenceTracker.record(
      "cost",
      "UI-6",
      "PASS",
      `Cost Payment Selection verified via DecisionPanel cost button click -> onSubmit (costPaymentRef: ${cost2Ref})`
    );
  });

  // 7. Effect-Time Selection
  it("UI-7: Effect-Time Selection - EFFECT_RESOLUTION candidates rendered, clicked, and submitted via DecisionPanel", () => {
    const effectRequest: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "test-effect-match",
      decisionId: "dec-effect-ui-7",
      stateVersion: 1,
      playerId: "p1",
      source: {
        type: "EFFECT_RESOLUTION",
        sourceRequestRef: "req-eff-1",
        effectStepId: "step-eff-1",
        playerId: "p1",
      },
      catalog: {
        actions: [],
        cardSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [
          {
            effectSelectionRef: 0,
            summary: "効果オプションA（手札回収）",
          } as any,
          {
            effectSelectionRef: 1,
            summary: "効果オプションB（ライフ回復）",
          } as any,
        ],
      } as any,
      patterns: [
        {
          patternRef: 0,
          patternId: "pat-eff-0",
          effectSelectionRef: 0,
          kind: "EFFECT_SELECTION",
        } as any,
        {
          patternRef: 1,
          patternId: "pat-eff-1",
          effectSelectionRef: 1,
          kind: "EFFECT_SELECTION",
        } as any,
      ],
      observation: { players: [{ playerId: "p1" }, { playerId: "p2" }] } as any,
    };

    const onSubmit = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={effectRequest} onSubmit={onSubmit} />
      );
    });

    // 1. 効果オプションBボタンをクリック
    const optionBBtn = findButton(renderer.root, (text) =>
      text.includes("効果オプションB") || text.includes("ライフ回復")
    );
    act(() => {
      optionBBtn.props.onClick();
    });

    // 2. 「決定して解決する」ボタンをクリック
    const submitBtn = findButton(renderer.root, (text) =>
      text.includes("決定して解決する")
    );
    act(() => {
      submitBtn.props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedResponse: DecisionResponse = onSubmit.mock.calls[0][0];
    expect(submittedResponse.decisionId).toBe(effectRequest.decisionId);
    expect(submittedResponse.stateVersion).toBe(effectRequest.stateVersion);
    expect(submittedResponse.selectedPatternRef).toBe(1);

    uiComponentEvidenceTracker.record(
      "effect-time",
      "UI-7",
      "PASS",
      `Effect-Time Selection verified via DecisionPanel effect option click -> submit (selectedPatternRef: 1)`
    );
  });

  // 8. 全 7 種網羅の総合検証
  it("UI-ALL: Confirms all 7 UI Component Decision Types are PASS with 0 NOT_COVERED", () => {
    expect(uiComponentEvidenceTracker.getCount()).toBe(7);
    expect(uiComponentEvidenceTracker.isAllPass()).toBe(true);

    const records = uiComponentEvidenceTracker.getAll();
    const types = records.map((r) => r.type);
    expect(types).toEqual([
      "action",
      "card",
      "unit target",
      "player target",
      "request target",
      "cost",
      "effect-time",
    ]);

    for (const r of records) {
      expect(r.status).toBe("PASS");
      expect(r.summary.length).toBeGreaterThan(0);
    }
  });
});
