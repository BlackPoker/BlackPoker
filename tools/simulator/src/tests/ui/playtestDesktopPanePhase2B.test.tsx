import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import { DecisionPanel } from "../../ui/decision/DecisionPanel";
import type { DecisionRequest } from "../../domain/decision/DecisionRequest";

describe("Playtest UI Redesign Phase 2B: Desktop 2-Pane Independent Scroll, Sticky Decision Actions & Log/Debug Tabs", () => {
  const sampleActionRequest: DecisionRequest = {
    protocolVersion: "1.0.0",
    matchId: "match-phase2b",
    decisionId: "dec-phase2b-1",
    stateVersion: 1,
    playerId: "p1",
    source: {
      type: "ACTION_REQUEST",
      playerId: "p1",
    },
    catalog: {
      actions: [
        {
          actionSelectionRef: 0,
          actionId: "action.setBulwark",
          actionName: "防壁設置",
          timing: "main",
          speed: "normal",
          cost: "なし",
        } as any,
      ],
      cardSelections: [
        {
          cardSelectionRef: 0,
          cardIds: ["c1"],
          displayCodes: ["♠5"],
        } as any,
      ],
      costPayments: [],
      targetSelections: [],
      effectSelections: [],
    } as any,
    patterns: [
      {
        patternRef: 0,
        patternId: "pat-0",
        kind: "ACTION",
        actionSelectionRef: 0,
        keyCardSelectionRef: 0,
      } as any,
      {
        patternRef: 1,
        patternId: "pat-pass",
        kind: "PASS",
      } as any,
    ],
    observation: {
      players: [
        { playerId: "p1", handCards: [{ id: "c1", code: "S5", suit: "S", rank: 5, value: 5 }] },
        { playerId: "p2", handCards: [] },
      ],
    } as any,
  };

  it("1. 対戦中のデスクトップレイアウトでページ全体の縦スクロールが抑制(lg:h-screen lg:overflow-hidden)され、1920px横幅を活用するmax-w-[1840px]と左右ペイン独立スクロールが適用されていること", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    const setupScreen = renderer.root.findByType(MatchSetupScreen);
    await act(async () => {
      setupScreen.props.onStartMatch();
    });

    const rootContainer = renderer.root.findByProps({ "data-testid": "playtest-root-container" });
    expect(String(rootContainer.props.className)).toContain("lg:h-screen");
    expect(String(rootContainer.props.className)).toContain("lg:overflow-hidden");

    const activeMain = renderer.root.findByProps({ "data-testid": "playtest-active-main" });
    expect(String(activeMain.props.className)).toContain("max-w-[1840px]");
    expect(String(activeMain.props.className)).not.toContain("max-w-[1440px]");
    expect(String(activeMain.props.className)).toContain("min-h-0");

    const leftPane = renderer.root.findByProps({ "data-testid": "playtest-left-pane" });
    expect(String(leftPane.props.className)).toContain("lg:col-span-7");
    expect(String(leftPane.props.className)).toContain("lg:overflow-y-auto");
    expect(String(leftPane.props.className)).toContain("lg:min-h-0");

    const rightPane = renderer.root.findByProps({ "data-testid": "playtest-right-pane" });
    expect(String(rightPane.props.className)).toContain("lg:col-span-5");
    expect(String(rightPane.props.className)).toContain("lg:overflow-y-auto");
    expect(String(rightPane.props.className)).toContain("lg:min-h-0");
  });

  it("2. DecisionPanelの判断選択領域が独立スクロール可能(decision-panel-scroll-body)であり、ヘッダー(1つ戻る・PASS)とフッター(リクエスト決定ボタン)がスクロール領域外に常時固定されていること", () => {
    const onSubmit = vi.fn();
    const onUndo = vi.fn();

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={sampleActionRequest}
          onSubmit={onSubmit}
          onUndo={onUndo}
          canUndo={true}
        />
      );
    });

    const panel = renderer.root.findByProps({ "data-testid": "decision-panel" });
    expect(String(panel.props.className)).toContain("flex flex-col max-h-full min-h-0");

    const header = renderer.root.findByProps({ "data-testid": "decision-panel-header" });
    expect(String(header.props.className)).toContain("shrink-0");

    const scrollBody = renderer.root.findByProps({ "data-testid": "decision-panel-scroll-body" });
    expect(String(scrollBody.props.className)).toContain("overflow-y-auto");
    expect(String(scrollBody.props.className)).toContain("min-h-0");

    const stickyFooter = renderer.root.findByProps({ "data-testid": "decision-panel-sticky-footer" });
    expect(String(stickyFooter.props.className)).toContain("shrink-0");

    // アクションを選択すると、scrollBodyの外側にあるstickyFooter内に決定ボタンが表示されること
    const actionButtons = scrollBody.findAllByType("button");
    expect(actionButtons.length).toBeGreaterThan(0);
    act(() => {
      actionButtons[0].props.onClick();
    });

    const footerButtons = stickyFooter.findAllByType("button");
    expect(footerButtons.length).toBe(2); // 「リクエストのみ」と「リクエスト＆PASS (推奨)」
  });

  it("3. 右ペイン下部のGameLogとDebugPanelがタブ化され、縦積みによる高さ溢れを起こさずタブ切替できること", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    const setupScreen = renderer.root.findByType(MatchSetupScreen);
    await act(async () => {
      setupScreen.props.onStartMatch();
    });

    const tabBar = renderer.root.findByProps({ "data-testid": "desktop-log-debug-tabs" });
    expect(tabBar).toBeDefined();

    const logTabBtn = renderer.root.findByProps({ "data-testid": "desktop-tab-log" });
    const debugTabBtn = renderer.root.findByProps({ "data-testid": "desktop-tab-debug" });

    // 初期状態は対戦ログタブがアクティブ
    expect(String(logTabBtn.props.className)).toContain("bg-zinc-950 text-white");

    // デバッグタブをクリックすると DebugPanel 表示に切り替わること
    act(() => {
      debugTabBtn.props.onClick();
    });
    expect(String(debugTabBtn.props.className)).toContain("bg-zinc-950 text-white");

    // 再度対戦ログタブをクリックすると GameLog 表示に戻ること
    act(() => {
      logTabBtn.props.onClick();
    });
    expect(String(logTabBtn.props.className)).toContain("bg-zinc-950 text-white");
  });
});
