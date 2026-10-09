import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { DecisionPanel } from "../../ui/decision/DecisionPanel";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";

function extractText(instance: TestRenderer.ReactTestInstance): string {
  if (typeof instance.children === "string") return instance.children;
  if (!Array.isArray(instance.children)) return "";
  return instance.children
    .map((c) => (typeof c === "string" ? c : typeof c === "object" ? extractText(c) : ""))
    .join("");
}

function findButtons(
  root: TestRenderer.ReactTestInstance,
  predicate?: (text: string, btn: TestRenderer.ReactTestInstance) => boolean
): TestRenderer.ReactTestInstance[] {
  const buttons = root.findAllByType("button");
  if (!predicate) return buttons;
  return buttons.filter((btn) => predicate(extractText(btn), btn));
}

function findButton(
  root: TestRenderer.ReactTestInstance,
  predicate: (text: string, btn: TestRenderer.ReactTestInstance) => boolean
): TestRenderer.ReactTestInstance {
  const found = findButtons(root, predicate);
  if (found.length === 0) {
    const list = root.findAllByType("button").map((b) => `"${extractText(b)}"`).join(", ");
    throw new Error(`Button not found. Available buttons: [${list}]`);
  }
  return found[0];
}

describe("BP-SIM-PRO-RAREPACK-POLISH-4: Two-Key-Card Progressive Selector", () => {
  // モックDecisionRequestの作成
  // 防壁破壊（2枚Key: Heart/Joker + Diamond）を想定
  // 手札: ♥A(c-hA), ♥K(c-hK), ♦3(c-d3), ♦4(c-d4), ♠5(c-s5, ペアにならないカード)
  // 合法ペア:
  // ref 0: [c-hA, c-d3] (♥A + ♦3)
  // ref 1: [c-hA, c-d4] (♥A + ♦4)
  // ref 2: [c-hK, c-d3] (♥K + ♦3)
  // ref 3: [c-hK, c-d4] (♥K + ♦4)
  const mockDecisionRequestTwoKey: DecisionRequest = {
    decisionId: "dec-destroy-bulwark-001",
    stateVersion: 1,
    turnNumber: 3,
    phase: "action",
    playerId: "p1",
    catalog: {
      actions: [
        {
          actionId: "action.destroyBulwark",
          actionName: "防壁破壊",
          speed: "normal",
          timing: "ACTION",
        },
        {
          actionId: "action.simpleOneKey",
          actionName: "単一キーアクション",
          speed: "normal",
          timing: "ACTION",
        },
      ],
      cardSelections: [
        // 2-key selections
        {
          cardIds: ["c-hA", "c-d3"],
          displayCodes: ["♥A", "♦3"],
        },
        {
          cardIds: ["c-hA", "c-d4"],
          displayCodes: ["♥A", "♦4"],
        },
        {
          cardIds: ["c-hK", "c-d3"],
          displayCodes: ["♥K", "♦3"],
        },
        {
          cardIds: ["c-hK", "c-d4"],
          displayCodes: ["♥K", "♦4"],
        },
        // 1-key selection
        {
          cardIds: ["c-s5"],
          displayCodes: ["♠5"],
        },
      ],
      costPayments: [
        {
          summary: "コストなし",
        },
      ],
      targetSelections: [
        {
          targetId: "b-p2-1",
          displayName: "防壁①",
        },
      ],
      effectSelections: [],
    },
    patterns: [
      // 防壁破壊 (actionRef: 0)
      { actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0 },
      { actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 0 },
      { actionSelectionRef: 0, keyCardSelectionRef: 2, costPaymentRef: 0, targetSelectionRef: 0 },
      { actionSelectionRef: 0, keyCardSelectionRef: 3, costPaymentRef: 0, targetSelectionRef: 0 },
      // 単一キーアクション (actionRef: 1)
      { actionSelectionRef: 1, keyCardSelectionRef: 4, costPaymentRef: 0, targetSelectionRef: 0 },
    ],
    observation: {
      players: [
        {
          playerId: "p1",
          name: "Player A",
          handCards: [
            { id: "c-hA", cardInstanceId: "c-hA", suit: "heart", rank: "A" },
            { id: "c-hK", cardInstanceId: "c-hK", suit: "heart", rank: "K" },
            { id: "c-d3", cardInstanceId: "c-d3", suit: "diamond", rank: "3" },
            { id: "c-d4", cardInstanceId: "c-d4", suit: "diamond", rank: "4" },
            { id: "c-s5", cardInstanceId: "c-s5", suit: "spade", rank: "5" },
          ],
        },
        {
          playerId: "p2",
          name: "Player B",
          handCards: [
            // 相手の手札 (非公開情報)
            { id: "c-secret-1", cardInstanceId: "c-secret-1", suit: "spade", rank: "A" },
          ],
        },
      ],
    } as any,
  } as any;

  it("1. 多数ペアが存在する場合、初期状態で全ペア一覧ボタンを表示せず1枚目選択候補を表示する", () => {
    const onSubmit = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={mockDecisionRequestTwoKey}
          onSubmit={onSubmit}
          initialActionRef={0}
        />
      );
    });

    const root = renderer!.root;
    const text = extractText(root);

    // 完成ペアの一覧（"♥A+♦3" など）が直接ボタンとして列挙されていないこと
    expect(text).not.toContain("♥A+♦3");
    expect(text).not.toContain("♥K+♦4");

    // 「1枚目のキーカードを選択してください:」が表示されていること
    expect(text).toContain("1枚目のキーカードを選択してください");

    // 1枚目候補にペアを構成可能なカード（♥A, ♥K, ♦3, ♦4）が存在すること
    // かつ、キーカードに含まれない ♠5 は候補に存在しないこと
    const step1Buttons = findButtons(root, (_t, btn) => {
      const aria = btn.props["aria-label"] || "";
      return aria.startsWith("1枚目として");
    });

    expect(step1Buttons.length).toBe(4);
    const ariaLabels = step1Buttons.map((b) => b.props["aria-label"]);
    expect(ariaLabels.some((l) => l.includes("♥A"))).toBe(true);
    expect(ariaLabels.some((l) => l.includes("♥K"))).toBe(true);
    expect(ariaLabels.some((l) => l.includes("♦3"))).toBe(true);
    expect(ariaLabels.some((l) => l.includes("♦4"))).toBe(true);
    expect(ariaLabels.some((l) => l.includes("♠5"))).toBe(false);
  });

  it("2. 1枚目選択により2枚目候補が合法な相手のみに絞り込まれる", () => {
    const onSubmit = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={mockDecisionRequestTwoKey}
          onSubmit={onSubmit}
          initialActionRef={0}
        />
      );
    });

    const root = renderer!.root;

    // 1枚目として ♥A を選択
    const btnHeartA = findButton(root, (_t, btn) => (btn.props["aria-label"] || "").includes("♥A"));
    act(() => {
      btnHeartA.props.onClick();
    });

    const textAfterFirst = extractText(root);
    expect(textAfterFirst).toContain("1枚目:");
    expect(textAfterFirst).toContain("2枚目を選択");

    // 2枚目候補ボタンを取得
    const step2Buttons = findButtons(root, (_t, btn) => {
      const aria = btn.props["aria-label"] || "";
      return aria.startsWith("2枚目として");
    });

    // ♥A とペアを組めるのは ♦3, ♦4 のみ（♥K はハート同士なので除外、♠5 は無関係なので除外）
    expect(step2Buttons.length).toBe(2);
    const step2Aria = step2Buttons.map((b) => b.props["aria-label"]);
    expect(step2Aria.some((l) => l.includes("♦3"))).toBe(true);
    expect(step2Aria.some((l) => l.includes("♦4"))).toBe(true);
    expect(step2Aria.some((l) => l.includes("♥K"))).toBe(false);
  });

  it("3. 2枚目選択により既存の keyCardSelectionRef が正しく確定しペア表示に切り替わる", () => {
    const onSubmit = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={mockDecisionRequestTwoKey}
          onSubmit={onSubmit}
          initialActionRef={0}
        />
      );
    });

    const root = renderer!.root;

    // 1枚目: ♥A
    const btnHeartA = findButton(root, (_t, btn) => (btn.props["aria-label"] || "").includes("♥A"));
    act(() => {
      btnHeartA.props.onClick();
    });

    // 2枚目: ♦4
    const btnDia4 = findButton(root, (_t, btn) => (btn.props["aria-label"] || "").includes("♦4"));
    act(() => {
      btnDia4.props.onClick();
    });

    // ペア確定表示に切り替わっていること
    const textAfterSecond = extractText(root);
    expect(textAfterSecond).toContain("確定ペア:");
    expect(textAfterSecond).toContain("変更");

    // リクエスト決定ボタン（patternRef: 1 (actionRef:0, keyRef:1[♥A+♦4], costRef:0, targetRef:0)）
    const submitBtn = findButton(root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
    act(() => {
      submitBtn.props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedPatternRef: 1, // patterns[1] が選ばれている
      }),
      expect.anything()
    );
  });

  it("4. 逆順操作（B → A: ♦4 → ♥A）でも同一の keyCardSelectionRef に到達する", () => {
    const onSubmit = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={mockDecisionRequestTwoKey}
          onSubmit={onSubmit}
          initialActionRef={0}
        />
      );
    });

    const root = renderer!.root;

    // 先に 1枚目: ♦4 を選択
    const btnDia4 = findButton(root, (_t, btn) => (btn.props["aria-label"] || "").includes("♦4"));
    act(() => {
      btnDia4.props.onClick();
    });

    // 2枚目候補に ♥A, ♥K が出ていること
    const step2Buttons = findButtons(root, (_t, btn) => {
      const aria = btn.props["aria-label"] || "";
      return aria.startsWith("2枚目として");
    });
    expect(step2Buttons.length).toBe(2);

    // 2枚目: ♥A を選択
    const btnHeartA = findButton(root, (_t, btn) => (btn.props["aria-label"] || "").includes("♥A"));
    act(() => {
      btnHeartA.props.onClick();
    });

    // 決定実行
    const submitBtn = findButton(root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
    act(() => {
      submitBtn.props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // 逆順でも patternRef: 1 (keyRef: 1 [♥A+♦4]) と全く同一
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedPatternRef: 1,
      }),
      expect.anything()
    );
  });

  it("5. 途中選択のリセットと変更操作が正常に機能する", () => {
    const onSubmit = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={mockDecisionRequestTwoKey}
          onSubmit={onSubmit}
          initialActionRef={0}
        />
      );
    });

    const root = renderer!.root;

    // 1枚目選択
    const btnHeartA = findButton(root, (_t, btn) => (btn.props["aria-label"] || "").includes("♥A"));
    act(() => {
      btnHeartA.props.onClick();
    });
    expect(extractText(root)).toContain("2枚目を選択");

    // 取消ボタンをクリック
    const cancelBtn = findButton(root, (t) => t === "取消");
    act(() => {
      cancelBtn.props.onClick();
    });
    expect(extractText(root)).toContain("1枚目のキーカードを選択してください");

    // ペア確定後の変更ボタン
    act(() => {
      findButton(root, (_t, btn) => (btn.props["aria-label"] || "").includes("♥A")).props.onClick();
    });
    act(() => {
      findButton(root, (_t, btn) => (btn.props["aria-label"] || "").includes("♦3")).props.onClick();
    });
    expect(extractText(root)).toContain("確定ペア:");

    const changeBtn = findButton(root, (t) => t === "変更");
    act(() => {
      changeBtn.props.onClick();
    });
    expect(extractText(root)).toContain("1枚目のキーカードを選択してください");
  });

  it("6. Action切り替えや decisionId 変更時にキーカード選択状態が完全にリセットされる", () => {
    const onSubmit = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={mockDecisionRequestTwoKey}
          onSubmit={onSubmit}
          initialActionRef={0}
        />
      );
    });

    const root = renderer!.root;

    // 1枚目選択
    act(() => {
      findButton(root, (_t, btn) => (btn.props["aria-label"] || "").includes("♥A")).props.onClick();
    });
    expect(extractText(root)).toContain("2枚目を選択");

    // 単一キーアクション (actionRef: 1) に切り替え
    const singleActionBtn = findButton(root, (t) => t.includes("単一キーアクション"));
    act(() => {
      singleActionBtn.props.onClick();
    });

    // 1枚キーカードアクションなので段階選択ではなく通常表示になり、Auto Select または通常ボタンになる
    expect(extractText(root)).not.toContain("2枚目を選択");

    // 防壁破壊に戻す
    const destroyBulwarkBtn = findButton(root, (t) => t.includes("防壁破壊"));
    act(() => {
      destroyBulwarkBtn.props.onClick();
    });

    // 1枚目未選択（STEP 1）に初期化されていること
    expect(extractText(root)).toContain("1枚目のキーカードを選択してください");
  });

  it("7. 合法ペアが1組のみの場合は従来の Auto Select が維持され確定表示になる", () => {
    const singlePairRequest: DecisionRequest = {
      ...mockDecisionRequestTwoKey,
      decisionId: "dec-single-pair-001",
      catalog: {
        ...mockDecisionRequestTwoKey.catalog,
        cardSelections: [
          {
            cardIds: ["c-hA", "c-d3"],
            displayCodes: ["♥A", "♦3"],
          },
        ],
      },
      patterns: [
        { actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0 },
      ],
    } as any;

    const onSubmit = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={singlePairRequest}
          onSubmit={onSubmit}
        />
      );
    });

    const root = renderer!.root;
    // アクションを選択
    const actionBtn = findButton(root, (t) => t.includes("防壁破壊"));
    act(() => {
      actionBtn.props.onClick();
    });

    // 候補が1組のみのため、handleSelectAction の Auto Select により確定ペア表示になる
    const text = extractText(root);
    expect(text).toContain("確定ペア:");
  });

  it("8. 1枚Key Card アクションでは従来のボタン一覧表示が維持される", () => {
    const onSubmit = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={mockDecisionRequestTwoKey}
          onSubmit={onSubmit}
          initialActionRef={1} // 単一キーアクション
        />
      );
    });

    const root = renderer!.root;
    const text = extractText(root);

    // 段階選択UIのテキストが出ないこと
    expect(text).not.toContain("1枚目のキーカードを選択してください");
    expect(text).not.toContain("2枚目を選択");
  });

  it("9. 非公開手札情報（相手の手札カードなど）がDOMに一切漏洩しない", () => {
    const onSubmit = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={mockDecisionRequestTwoKey}
          onSubmit={onSubmit}
          initialActionRef={0}
        />
      );
    });

    const root = renderer!.root;
    const json = JSON.stringify(renderer!.toJSON());

    // 相手プレイヤーの秘匿カードID "c-secret-1" が DOM 内に存在しないこと
    expect(json).not.toContain("c-secret-1");
  });
});
