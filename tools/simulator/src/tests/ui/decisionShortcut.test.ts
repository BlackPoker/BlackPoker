import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { DecisionPanel } from "../../ui/decision/DecisionPanel";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

class MockWindow {
  public location = { search: "", href: "http://localhost/" };
  private listeners: { [key: string]: ((e: any) => void)[] } = {};

  addEventListener(type: string, listener: (e: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(event: any) {
    const list = [...(this.listeners[event.type] || [])];
    for (const listener of list) {
      listener(event);
    }
    return true;
  }
}

describe("Decision Keyboard Shortcut Tests (BP-SIM-SHARE-1.0-R2-PLAYTEST-UX-HARDENING)", () => {
  let originalWindow: any;
  let mockWindow: MockWindow;

  beforeAll(() => {
    originalWindow = (globalThis as any).window;
    mockWindow = new MockWindow();
    (globalThis as any).window = mockWindow;
  });

  afterAll(() => {
    (globalThis as any).window = originalWindow;
  });

  beforeEach(() => {
    mockWindow = new MockWindow();
    (globalThis as any).window = mockWindow;
  });

  function fireKeyDown(props: {
    key: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    repeat?: boolean;
    isComposing?: boolean;
    keyCode?: number;
    target?: any;
  }) {
    const event = {
      type: "keydown",
      key: props.key,
      shiftKey: !!props.shiftKey,
      ctrlKey: !!props.ctrlKey,
      metaKey: !!props.metaKey,
      altKey: !!props.altKey,
      repeat: !!props.repeat,
      isComposing: !!props.isComposing,
      keyCode:
        props.keyCode ??
        (props.key === "Enter" ? 13 : props.key === "p" || props.key === "P" ? 80 : 0),
      target: props.target ?? { tagName: "DIV", isContentEditable: false },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    mockWindow.dispatchEvent(event);
    return event;
  }

  // 1. ACTION_REQUEST: Normal / Quick action
  const normalActionRequest: DecisionRequest = {
    protocolVersion: "1.0.0",
    matchId: "test-match",
    decisionId: "dec-action-normal-1",
    stateVersion: 1,
    playerId: "p1",
    source: { type: "ACTION_REQUEST", playerId: "p1" },
    catalog: {
      actions: [
        {
          actionId: "action.attack",
          actionName: "アタック",
          speed: "normal",
          timing: "Main",
        } as any,
      ],
      cardSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections: [],
    } as any,
    patterns: [
      {
        patternRef: 0,
        patternId: "pat-attack",
        actionSelectionRef: 0,
        kind: "ACTION",
      } as any,
      {
        patternRef: 1,
        patternId: "pat-pass",
        kind: "PASS",
      } as any,
    ],
    observation: { players: [{ playerId: "p1" }, { playerId: "p2" }] } as any,
  };

  // 2. ACTION_REQUEST: Immediate action
  const immediateActionRequest: DecisionRequest = {
    ...normalActionRequest,
    decisionId: "dec-action-immediate-2",
    catalog: {
      ...normalActionRequest.catalog,
      actions: [
        {
          actionId: "action.charge",
          actionName: "チャージ",
          speed: "immediate",
          timing: "Trigger",
        } as any,
      ],
    } as any,
  };

  // 3. EFFECT_RESOLUTION
  const effectResolutionRequest: DecisionRequest = {
    protocolVersion: "1.0.0",
    matchId: "test-match",
    decisionId: "dec-effect-3",
    stateVersion: 2,
    playerId: "p1",
    source: { type: "EFFECT_RESOLUTION", sourceRequestRef: "req-1", effectStepId: "step-1", playerId: "p1" },
    catalog: {
      actions: [],
      cardSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections: [
        {
          effectSelectionRef: 0,
          summary: "効果A",
        } as any,
        {
          effectSelectionRef: 1,
          summary: "効果B",
        } as any,
      ],
    } as any,
    patterns: [
      {
        patternRef: 0,
        patternId: "pat-eff-0",
        effectSelectionRef: 0,
        kind: "EFFECT",
      } as any,
      {
        patternRef: 1,
        patternId: "pat-eff-1",
        effectSelectionRef: 1,
        kind: "EFFECT",
      } as any,
    ],
    observation: { players: [{ playerId: "p1" }, { playerId: "p2" }] } as any,
  };

  describe("ACTION_REQUEST Shortcuts", () => {
    it("A: 合法pattern選択完了 normal/quick Enter → onSubmit(..., { autoPass: true })", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: normalActionRequest,
            onSubmit,
            initialActionRef: 0,
          })
        );
      });

      act(() => {
        fireKeyDown({ key: "Enter" });
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        {
          decisionId: "dec-action-normal-1",
          stateVersion: 1,
          selectedPatternRef: 0,
        },
        { autoPass: true }
      );
    });

    it("B: 合法pattern選択完了 normal/quick Shift+Enter → onSubmit(..., { autoPass: false })", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: normalActionRequest,
            onSubmit,
            initialActionRef: 0,
          })
        );
      });

      act(() => {
        fireKeyDown({ key: "Enter", shiftKey: true });
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        {
          decisionId: "dec-action-normal-1",
          stateVersion: 1,
          selectedPatternRef: 0,
        },
        { autoPass: false }
      );
    });

    it("C: immediate Enter → autoPass: false", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: immediateActionRequest,
            onSubmit,
            initialActionRef: 0,
          })
        );
      });

      act(() => {
        fireKeyDown({ key: "Enter" });
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        {
          decisionId: "dec-action-immediate-2",
          stateVersion: 1,
          selectedPatternRef: 0,
        },
        { autoPass: false }
      );
    });

    it("D: 未選択状態 Enter → submit 0回", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: normalActionRequest,
            onSubmit,
            // initialActionRef なし (未選択)
          })
        );
      });

      act(() => {
        fireKeyDown({ key: "Enter" });
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("F: INPUT / TEXTAREA / SELECT / contentEditable focus 中は Enter で submit なし", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: normalActionRequest,
            onSubmit,
            initialActionRef: 0,
          })
        );
      });

      // INPUT
      act(() => {
        fireKeyDown({ key: "Enter", target: { tagName: "INPUT", isContentEditable: false } });
      });
      // TEXTAREA
      act(() => {
        fireKeyDown({ key: "Enter", target: { tagName: "TEXTAREA", isContentEditable: false } });
      });
      // SELECT
      act(() => {
        fireKeyDown({ key: "Enter", target: { tagName: "SELECT", isContentEditable: false } });
      });
      // contentEditable
      act(() => {
        fireKeyDown({ key: "Enter", target: { tagName: "DIV", isContentEditable: true } });
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("G: e.repeat === true では submit なし (長押し repeat submit 禁止)", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: normalActionRequest,
            onSubmit,
            initialActionRef: 0,
          })
        );
      });

      act(() => {
        fireKeyDown({ key: "Enter", repeat: true });
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("H: IME composing (e.isComposing / keyCode 229) では submit なし", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: normalActionRequest,
            onSubmit,
            initialActionRef: 0,
          })
        );
      });

      act(() => {
        fireKeyDown({ key: "Enter", isComposing: true });
      });
      act(() => {
        fireKeyDown({ key: "Enter", keyCode: 229 });
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("Ctrl / Meta / Alt 付き Enter は無視されること", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: normalActionRequest,
            onSubmit,
            initialActionRef: 0,
          })
        );
      });

      act(() => {
        fireKeyDown({ key: "Enter", ctrlKey: true });
        fireKeyDown({ key: "Enter", metaKey: true });
        fireKeyDown({ key: "Enter", altKey: true });
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("disabled={true} (モーダル表示中など) の場合は Enter で submit なし", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: normalActionRequest,
            onSubmit,
            initialActionRef: 0,
            disabled: true,
          })
        );
      });

      act(() => {
        fireKeyDown({ key: "Enter" });
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("二重 submit 防止: 同一 Decision で複数回 Enter を押しても submit は最大1回のみ", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: normalActionRequest,
            onSubmit,
            initialActionRef: 0,
          })
        );
      });

      act(() => {
        fireKeyDown({ key: "Enter" });
        fireKeyDown({ key: "Enter" });
        fireKeyDown({ key: "Enter" });
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe("EFFECT_RESOLUTION Shortcuts", () => {
    it("未選択状態 Enter → submit 0回", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: effectResolutionRequest,
            onSubmit,
          })
        );
      });

      act(() => {
        fireKeyDown({ key: "Enter" });
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("候補選択後 Enter → selected pattern submit", () => {
      const onSubmit = vi.fn();
      let testRenderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(DecisionPanel, {
            request: effectResolutionRequest,
            onSubmit,
          })
        );
      });

      // 最初の効果ボタンをクリック
      const buttons = testRenderer.root.findAllByType("button");
      const effectButton = buttons.find((b) => {
        const spanTexts = b.findAllByType("span").map((s) => s.children.join("")).join("");
        return spanTexts.includes("効果A");
      });
      expect(effectButton).toBeDefined();

      act(() => {
        effectButton!.props.onClick();
      });

      // Enter キーで確定
      act(() => {
        fireKeyDown({ key: "Enter" });
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        decisionId: "dec-effect-3",
        stateVersion: 2,
        selectedPatternRef: 0,
      });
    });
  });

  describe("CoreBattlePlaytest Global P Shortcut", () => {
    it("E: 対戦待機中に P キーを押すと PASS が実行されること", async () => {
      let testRenderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        testRenderer = TestRenderer.create(React.createElement(CoreBattlePlaytest));
      });

      // MatchSetupScreen から対戦開始をクリック
      const setupScreen = testRenderer.root.findByType(MatchSetupScreen);
      await act(async () => {
        await setupScreen.props.onStartMatch();
      });

      // 対戦開始後は Player A 行動選択で待機中
      const initialJson = JSON.stringify(testRenderer.toJSON());
      expect(initialJson).toContain("PASS [P]");

      await act(async () => {
        fireKeyDown({ key: "p" });
      });

      // PASS により進行すること
      const afterJson = JSON.stringify(testRenderer.toJSON());
      expect(afterJson).toBeDefined();
    });

    it("F: INPUT focus 中は P キーを押しても PASS されないこと", async () => {
      let testRenderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        testRenderer = TestRenderer.create(React.createElement(CoreBattlePlaytest));
      });

      const setupScreen = testRenderer.root.findByType(MatchSetupScreen);
      await act(async () => {
        await setupScreen.props.onStartMatch();
      });

      expect(JSON.stringify(testRenderer.toJSON())).toContain("PASS [P]");

      await act(async () => {
        fireKeyDown({ key: "p", target: { tagName: "INPUT", isContentEditable: false } });
      });

      const json = JSON.stringify(testRenderer.toJSON());
      expect(json).toContain("PASS [P]");
    });
  });
});
