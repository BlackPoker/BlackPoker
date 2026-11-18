import React from "react";
import { renderToString } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { MobileDecisionDock } from "../../ui/decision/MobileDecisionDock";
import { MobileBottomSheet } from "../../ui/game/MobileBottomSheet";
import { MobileVisibleHandStrip } from "../../ui/decision/MobileVisibleHandStrip";
import { DecisionPanel, DecisionPanelDraftState } from "../../ui/decision/DecisionPanel";
import { CardView } from "../../ui/game/CardView";
import { UnitCard } from "../../ui/game/UnitCard";
import type { DecisionRequest } from "../../domain/decision/DecisionRequest";

describe("Playtest UI Redesign Phase 3: Tablet Portrait/Landscape, Mobile Regression & Breakpoint State Preservation", () => {
  const sampleUnitTargetActionRequest: DecisionRequest = {
    protocolVersion: "1.0.0",
    matchId: "match-phase3",
    decisionId: "dec-phase3-action-unit",
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
          actionId: "action.up",
          actionName: "アップ",
          timing: "quick",
          speed: "quick",
          cost: "D",
        } as any,
      ],
      cardSelections: [
        {
          cardSelectionRef: 0,
          cardIds: ["k1"],
          displayCodes: ["♥2"],
        } as any,
      ],
      costPayments: [
        {
          costPaymentRef: 0,
          discardedCardIds: ["d1"],
          summary: "手札 ♦3 破棄",
        } as any,
      ],
      targetSelections: [
        {
          targetSelectionRef: 0,
          targetType: "unit",
          targetUnitId: "u-soldier-1",
          displayName: "① Player A の一般兵 (♠5)",
          primaryLabel: "① Player A の一般兵 (♠5)",
        } as any,
        {
          targetSelectionRef: 1,
          targetType: "unit",
          targetUnitId: "u-soldier-2",
          displayName: "② Player A の一般兵 (♣6)",
          primaryLabel: "② Player A の一般兵 (♣6)",
        } as any,
      ],
      effectSelections: [],
    } as any,
    patterns: [
      {
        patternRef: 0,
        patternId: "pat-up-u1",
        kind: "ACTION",
        actionSelectionRef: 0,
        keyCardSelectionRef: 0,
        costPaymentRef: 0,
        targetSelectionRef: 0,
      } as any,
      {
        patternRef: 1,
        patternId: "pat-up-u2",
        kind: "ACTION",
        actionSelectionRef: 0,
        keyCardSelectionRef: 0,
        costPaymentRef: 0,
        targetSelectionRef: 1,
      } as any,
      {
        patternRef: 2,
        patternId: "pat-pass",
        kind: "PASS",
      } as any,
    ],
    observation: {
      players: [
        {
          playerId: "p1",
          handCards: [
            { id: "k1", suit: "H", rank: "2", value: 2 },
            { id: "d1", suit: "D", rank: "3", value: 3 },
          ],
          field: [
            { unitId: "u-soldier-1", kind: "一般兵", state: "charge", cards: [{ id: "sc1", suit: "S", rank: "5", value: 5 }] },
            { unitId: "u-soldier-2", kind: "一般兵", state: "charge", cards: [{ id: "sc2", suit: "C", rank: "6", value: 6 }] },
          ],
        },
        { playerId: "p2", handCards: [], field: [] },
      ],
    } as any,
  };

  it("1. タブレット縦向き(md:)でMobileDecisionDockとMobileBottomSheetがmax-w-md制限を解除してmd:max-w-3xlへ拡張され、スマホ(<768px)では既存のmax-w-md flex-col構造が維持されること", () => {
    const dockHtml = renderToString(
      <MobileDecisionDock
        request={sampleUnitTargetActionRequest}
        sheetMode="collapsed"
        onOpenSheet={() => {}}
        onSubmit={() => {}}
        canUndo={true}
        onUndo={() => {}}
      />
    );

    expect(dockHtml).toContain('data-testid="mobile-decision-dock"');
    expect(dockHtml).toContain("max-w-md md:max-w-3xl");
    expect(dockHtml).toContain("flex-col md:flex-row");

    const sheetHtml = renderToString(
      <MobileBottomSheet
        mode="half"
        onModeChange={() => {}}
        onClose={() => {}}
        title="Player A の行動選択"
        persistentContent={
          <MobileVisibleHandStrip
            handCards={[{ id: "c1", suit: "S", rank: "A", value: 14 }]}
          />
        }
      >
        <div>Sheet Content</div>
      </MobileBottomSheet>
    );

    expect(sheetHtml).toContain('data-testid="mobile-bottom-sheet-panel"');
    expect(sheetHtml).toContain("md:max-w-3xl md:mx-auto");
    expect(sheetHtml).toContain("md:gap-2");
  });

  it("2. ACTION_REQUESTで対象ユニットを持つアクションを選択した際、盤面の候補ユニットにマーカーが付与され、盤面ユニットタップ(lastBoardUnitClick)で対象選択が切り替わること", () => {
    const onSubmit = vi.fn();
    let latestMarkers = new Map<string, { badge: string; isSelected: boolean }>();

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={sampleUnitTargetActionRequest}
          onSubmit={onSubmit}
          onSelectionMarkersChange={(m) => {
            latestMarkers = m;
          }}
        />
      );
    });

    // アクション「アップ」を選択
    const scrollBody = renderer.root.findByProps({ "data-testid": "decision-panel-scroll-body" });
    const actionButtons = scrollBody.findAllByType("button");
    act(() => {
      actionButtons[0].props.onClick();
    });

    // 盤面の2体の候補ユニットにマーカーが付与されていること
    expect(latestMarkers.has("u-soldier-1")).toBe(true);
    expect(latestMarkers.has("u-soldier-2")).toBe(true);

    // 盤面の u-soldier-2 をタップ (lastBoardUnitClick)
    act(() => {
      renderer.update(
        <DecisionPanel
          request={sampleUnitTargetActionRequest}
          onSubmit={onSubmit}
          onSelectionMarkersChange={(m) => {
            latestMarkers = m;
          }}
          lastBoardUnitClick={{ unitId: "u-soldier-2", seq: 1 }}
        />
      );
    });

    expect(latestMarkers.get("u-soldier-2")?.isSelected).toBe(true);
    expect(latestMarkers.get("u-soldier-1")?.isSelected).toBe(false);

    // 固定フッターの「リクエスト＆PASS (推奨)」をクリックして送信すると u-soldier-2 対象のパターン (patternRef: 1) が送信されること
    const stickyFooter = renderer.root.findByProps({ "data-testid": "decision-panel-sticky-footer" });
    const footerButtons = stickyFooter.findAllByType("button");
    act(() => {
      footerButtons[1].props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].selectedPatternRef).toBe(1);
  });

  it("3. ブレークポイント境界(1023px <-> 1024px)を跨いでDecisionPanelが再マウントされても、draftStateRefにより選択中のアクション・対象状態が完全に保持されること", () => {
    const draftStateRef: React.MutableRefObject<DecisionPanelDraftState | null> = { current: null };
    const onSubmit = vi.fn();

    let desktopRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      desktopRenderer = TestRenderer.create(
        <DecisionPanel
          request={sampleUnitTargetActionRequest}
          onSubmit={onSubmit}
          draftStateRef={draftStateRef}
        />
      );
    });

    // Desktop (1024px) 側でアクション「アップ」を選択し、盤面タップで u-soldier-2 を選択
    const scrollBody = desktopRenderer.root.findByProps({ "data-testid": "decision-panel-scroll-body" });
    act(() => {
      scrollBody.findAllByType("button")[0].props.onClick();
    });
    act(() => {
      desktopRenderer.update(
        <DecisionPanel
          request={sampleUnitTargetActionRequest}
          onSubmit={onSubmit}
          draftStateRef={draftStateRef}
          lastBoardUnitClick={{ unitId: "u-soldier-2", seq: 1 }}
        />
      );
    });

    expect(draftStateRef.current?.selectedActionRef).toBe(0);
    expect(draftStateRef.current?.selectedTargetRef).toBe(1);

    // 1024px -> 1023px ブレークポイント跨ぎをシミュレート (Desktop 側アンマウント -> MobileBottomSheet 側マウント)
    act(() => {
      desktopRenderer.unmount();
    });

    let tabletPortraitRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      tabletPortraitRenderer = TestRenderer.create(
        <DecisionPanel
          request={sampleUnitTargetActionRequest}
          onSubmit={onSubmit}
          draftStateRef={draftStateRef}
        />
      );
    });

    // 再マウント直後から選択状態が復元され、固定フッターに決定ボタンが表示されていること
    const restoredFooter = tabletPortraitRenderer.root.findByProps({ "data-testid": "decision-panel-sticky-footer" });
    const restoredButtons = restoredFooter.findAllByType("button");
    expect(restoredButtons.length).toBe(2);

    act(() => {
      restoredButtons[1].props.onClick();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].selectedPatternRef).toBe(1);
  });

  it("4. 高密度盤面(手札多数・兵士/防壁多数・複数ブロッカー)でCardViewとUnitCardがshrink-0を持ち、BlockAssignmentEditorの決定領域がsticky bottom-0で固定されていること", () => {
    const cardHtml = renderToString(
      <CardView card={{ id: "c1", suit: "S", rank: "A", value: 14 }} size="md" inPlayerBoard={true} />
    );
    expect(cardHtml).toContain("shrink-0");

    const unitHtml = renderToString(
      <UnitCard
        unit={{
          unitId: "u-dense-1",
          kind: "一般兵",
          state: "drive",
          face: "up",
          currentSize: 8,
          cards: [{ id: "c2", suit: "H", rank: "8", value: 8 }],
        }}
      />
    );
    expect(unitHtml).toContain("shrink-0");

    const blockRequest: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "match-block",
      decisionId: "dec-block-1",
      stateVersion: 2,
      playerId: "p2",
      source: {
        type: "EFFECT_RESOLUTION",
        sourceRequestRef: "req-block",
        effectStepId: "step-block",
        playerId: "p2",
      },
      catalog: {
        actions: [],
        cardSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [
          {
            effectSelectionRef: 0,
            selectionType: "unitAssignment",
            assignments: [{ sourceUnitId: "atk-1", selectedUnitIds: [] }],
          } as any,
          {
            effectSelectionRef: 1,
            selectionType: "unitAssignment",
            assignments: [{ sourceUnitId: "atk-1", selectedUnitIds: ["blk-1"] }],
          } as any,
        ],
      } as any,
      patterns: [
        { patternRef: 0, patternId: "pat-b0", kind: "EFFECT_SELECTION", effectSelectionRef: 0 } as any,
        { patternRef: 1, patternId: "pat-b1", kind: "EFFECT_SELECTION", effectSelectionRef: 1 } as any,
      ],
      observation: {
        players: [
          { playerId: "p1", field: [{ unitId: "atk-1", kind: "一般兵", state: "drive", cards: [{ suit: "S", rank: "7" }] }] },
          { playerId: "p2", field: [{ unitId: "blk-1", kind: "一般兵", state: "charge", cards: [{ suit: "H", rank: "8" }] }] },
        ],
      } as any,
    };

    const blockHtml = renderToString(
      <DecisionPanel request={blockRequest} onSubmit={() => {}} />
    );
    expect(blockHtml).toContain('data-testid="block-assignment-sticky-confirm"');
    expect(blockHtml).toContain("sticky bottom-0");
    // SHORTCUT 行が重複せず1回のみ出力されること
    const shortcutMatches = blockHtml.match(/SHORTCUT:/g) || [];
    expect(shortcutMatches.length).toBe(1);

    // 盤面上のブロッカー候補 (blk-1) をタップ (lastBoardUnitClick) すると割当てがトグルされ送信できること
    const onBlockSubmit = vi.fn();
    let blockRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      blockRenderer = TestRenderer.create(
        <DecisionPanel request={blockRequest} onSubmit={onBlockSubmit} />
      );
    });
    act(() => {
      blockRenderer.update(
        <DecisionPanel
          request={blockRequest}
          onSubmit={onBlockSubmit}
          lastBoardUnitClick={{ unitId: "blk-1", seq: 1 }}
        />
      );
    });
    const confirmArea = blockRenderer.root.findByProps({ "data-testid": "block-assignment-sticky-confirm" });
    const confirmBtn = confirmArea.findByType("button");
    expect(confirmBtn.props.disabled).toBe(false);
    act(() => {
      confirmBtn.props.onClick();
    });
    expect(onBlockSubmit).toHaveBeenCalledTimes(1);
    expect(onBlockSubmit.mock.calls[0][0].selectedPatternRef).toBe(1);
  });
});
