import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { MobileBottomSheet } from "../../ui/game/MobileBottomSheet";
import { MobileVisibleHandStrip } from "../../ui/decision/MobileVisibleHandStrip";
import { MobileDecisionDock } from "../../ui/decision/MobileDecisionDock";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

describe("BP-SIM-UI-MOBILE-HAND-VISIBILITY-R1: Mobile Action Selection Hand Visibility Tests", () => {
  const createMockRequest = (overrides: Partial<DecisionRequest> = {}): DecisionRequest => ({
    protocolVersion: "1.0",
    matchId: "match-1",
    decisionId: "dec-100",
    stateVersion: 1,
    playerId: "p1",
    source: { type: "ACTION_REQUEST", playerId: "p1" },
    observation: {} as any,
    catalog: {} as any,
    patterns: [
      { patternId: "p-pass", kind: "PASS" },
      { patternId: "p-attack-1", kind: "ACTION" },
      { patternId: "p-attack-2", kind: "ACTION" },
    ],
    ...overrides,
  });

  const mockHandCards = [
    { id: "c1", suit: "S", rank: "A", value: 14 },
    { id: "c2", suit: "H", rank: "K", value: 13 },
    { id: "c3", suit: "D", rank: "Q", value: 12 },
  ];

  // =========================================================================
  // Case 1: collapsed
  // =========================================================================
  describe("Case 1: collapsed 状態の表示整合性", () => {
    it("MobileDecisionDock は通常操作可能であり、不要な duplicate Hand Strip は表示されない", () => {
      const request = createMockRequest();
      const dockHtml = renderToString(
        <MobileDecisionDock
          request={request}
          sheetMode="collapsed"
          onOpenSheet={() => {}}
          onSubmit={() => {}}
          canUndo={true}
          onUndo={() => {}}
        />
      );

      // Dock 内の必須アクション
      expect(dockHtml).toContain("戻る");
      expect(dockHtml).toContain("PASS");
      expect(dockHtml).toContain("行動を選ぶ");

      // Dock 側には duplicate 手札ストリップが存在しないこと (盤面PlayerBoardの手札を使用)
      expect(dockHtml).not.toContain("data-testid=\"mobile-sheet-hand-strip\"");
      expect(dockHtml).not.toContain("data-testid=\"mobile-dock-hand-cards\"");

      // MobileBottomSheet は collapsed 時 translate-y-full で退避
      const sheetHtml = renderToString(
        <MobileBottomSheet
          mode="collapsed"
          onModeChange={() => {}}
          onClose={() => {}}
          persistentContent={<MobileVisibleHandStrip handCards={mockHandCards} />}
        >
          <div>Decision Options</div>
        </MobileBottomSheet>
      );
      expect(sheetHtml).toContain("translate-y-full");
    });
  });

  // =========================================================================
  // Case 2: sheetMode="half"
  // =========================================================================
  describe("Case 2: sheetMode='half' での Persistent Hand Strip 表示", () => {
    it("active human の可視手札が Bottom Sheet 内に表示され、♠A等のカード identity が確認可能", () => {
      const sheetHtml = renderToString(
        <MobileBottomSheet
          mode="half"
          onModeChange={() => {}}
          onClose={() => {}}
          title="Player A の行動選択"
          persistentContent={<MobileVisibleHandStrip handCards={mockHandCards} />}
        >
          <div data-testid="decision-options">
            <button>アタック 1</button>
            <button>アタック 2</button>
          </div>
        </MobileBottomSheet>
      );

      // Sheet が表示状態 (translate-y-0)
      expect(sheetHtml).toContain("translate-y-0");

      // Persistent Hand Strip が存在
      expect(sheetHtml).toContain("data-testid=\"mobile-sheet-hand-strip\"");
      expect(sheetHtml).toContain("HAND (3)");

      // カード identity が正しく描画されていること
      expect(sheetHtml).toContain("♠");
      expect(sheetHtml).toContain("A");
      expect(sheetHtml).toContain("♥");
      expect(sheetHtml).toContain("K");
      expect(sheetHtml).toContain("♦");
      expect(sheetHtml).toContain("Q");
    });
  });

  // =========================================================================
  // Case 3: sheetMode="expanded"
  // =========================================================================
  describe("Case 3: sheetMode='expanded' でも手札を維持", () => {
    it("expanded に拡大した場合でも Persistent Hand Strip が維持されること", () => {
      const sheetHtml = renderToString(
        <MobileBottomSheet
          mode="expanded"
          onModeChange={() => {}}
          onClose={() => {}}
          persistentContent={<MobileVisibleHandStrip handCards={mockHandCards} />}
        >
          <div>Expanded Decisions</div>
        </MobileBottomSheet>
      );

      expect(sheetHtml).toContain("data-testid=\"mobile-sheet-hand-strip\"");
      expect(sheetHtml).toContain("HAND (3)");
      expect(sheetHtml).toContain("♠");
      expect(sheetHtml).toContain("A");
    });
  });

  // =========================================================================
  // Case 4: Vertical Scroll Independence
  // =========================================================================
  describe("Case 4: Vertical Scroll Independence (行動候補スクロール領域との完全分離)", () => {
    it("Persistent Hand Strip は shrink-0 であり、Decision Content の overflow-y-auto の外（兄弟要素）に配置される", () => {
      const sheetHtml = renderToString(
        <MobileBottomSheet
          mode="half"
          onModeChange={() => {}}
          onClose={() => {}}
          persistentContent={<MobileVisibleHandStrip handCards={mockHandCards} />}
        >
          <div data-testid="decision-list">
            {Array.from({ length: 20 }, (_, i) => (
              <div key={i}>Action {i + 1}</div>
            ))}
          </div>
        </MobileBottomSheet>
      );

      // persistentContent コンテナが shrink-0 であること
      expect(sheetHtml).toContain("data-testid=\"mobile-sheet-persistent-content\"");
      expect(sheetHtml).toContain("shrink-0 border-b border-zinc-200");

      // decision content コンテナが overflow-y-auto flex-1 であること
      expect(sheetHtml).toContain("data-testid=\"mobile-sheet-decision-content\"");
      expect(sheetHtml).toContain("overflow-y-auto flex-1");

      // persistent-content が decision-content の親ではなく前方の兄弟要素であること
      const persistentIndex = sheetHtml.indexOf("data-testid=\"mobile-sheet-persistent-content\"");
      const decisionIndex = sheetHtml.indexOf("data-testid=\"mobile-sheet-decision-content\"");
      expect(persistentIndex).toBeGreaterThan(-1);
      expect(decisionIndex).toBeGreaterThan(-1);
      expect(persistentIndex).toBeLessThan(decisionIndex);
    });
  });

  // =========================================================================
  // Case 5: 多数の手札の横スクロール
  // =========================================================================
  describe("Case 5: 多数の手札 (12枚) の横スクロールとカード潰れ防止", () => {
    it("12枚の手札が overflow-x-auto で横スクロール可能かつ各カードが shrink-0 flex-none で潰されない", () => {
      const twelveCards = [
        { id: "c-1", suit: "S", rank: "A", value: 14 },
        { id: "c-2", suit: "S", rank: "2", value: 2 },
        { id: "c-3", suit: "S", rank: "3", value: 3 },
        { id: "c-4", suit: "S", rank: "4", value: 4 },
        { id: "c-5", suit: "S", rank: "5", value: 5 },
        { id: "c-6", suit: "S", rank: "6", value: 6 },
        { id: "c-7", suit: "S", rank: "7", value: 7 },
        { id: "c-8", suit: "S", rank: "8", value: 8 },
        { id: "c-9", suit: "S", rank: "9", value: 9 },
        { id: "c-10", suit: "S", rank: "10", value: 10 },
        { id: "c-11", suit: "S", rank: "J", value: 11 },
        { id: "c-12", suit: "S", rank: "Q", value: 12 },
      ];

      const html = renderToString(
        <MobileVisibleHandStrip handCards={twelveCards} />
      );

      // 横スクロールコンテナ属性
      expect(html).toContain("overflow-x-auto");
      expect(html).toContain("no-scrollbar");
      expect(html).toContain("touch-pan-x");

      // 各カードラッパーが shrink-0 flex-none であること (1列に圧縮・変形されない)
      expect(html).toContain("shrink-0 flex-none");

      // 先頭カード (c-1: ♠A) と 末尾カード (c-12: ♠Q) が両方とも DOM に存在すること
      expect(html).toContain("data-testid=\"mobile-hand-card-c-1\"");
      expect(html).toContain("data-testid=\"mobile-hand-card-c-12\"");
      expect(html).toContain("HAND (12)");
    });
  });

  // =========================================================================
  // Case 6: Hidden hand
  // =========================================================================
  describe("Case 6: Hidden Hand の情報保護", () => {
    it("visibility: 'HIDDEN' または faceUp: false のカードの Suit/Rank/ID は DOM に出力されない", () => {
      const secretCards = [
        { id: "secret-1", visibility: "HIDDEN", faceUp: false, suit: "H", rank: "K" },
        { id: "secret-2", visibility: "HIDDEN", faceUp: true, suit: "D", rank: "A" },
        { id: "secret-3", visibility: "VISIBLE", faceUp: false, suit: "C", rank: "Joker" },
      ];

      const html = renderToString(
        <MobileVisibleHandStrip handCards={secretCards} />
      );

      // 可視カードが 0 枚のため、Hand Strip 自体が描画されない (null)
      expect(html).toBe("");
      expect(html).not.toContain("secret-1");
      expect(html).not.toContain("secret-2");
      expect(html).not.toContain("secret-3");
      expect(html).not.toContain("Joker");
    });
  });

  // =========================================================================
  // Case 7: Opponent / Non-Viewer Hand
  // =========================================================================
  describe("Case 7: Opponent / Non-Viewer Hand の保護", () => {
    it("handCards が空または undefined の場合、Hand Strip は描画されず相手手札は一切漏洩しない", () => {
      const htmlEmpty = renderToString(
        <MobileVisibleHandStrip handCards={[]} />
      );
      expect(htmlEmpty).toBe("");

      const htmlUndef = renderToString(
        <MobileVisibleHandStrip handCards={undefined} />
      );
      expect(htmlUndef).toBe("");
    });
  });

  // =========================================================================
  // Case 8: Desktop UI 整合性
  // =========================================================================
  describe("Case 8: Desktop UI への非干渉", () => {
    it("MobileBottomSheet は lg:hidden を維持し、デスクトップ表示に影響を与えない", () => {
      const html = renderToString(
        <MobileBottomSheet
          mode="half"
          onModeChange={() => {}}
          onClose={() => {}}
          persistentContent={<MobileVisibleHandStrip handCards={mockHandCards} />}
        >
          <div>Desktop Decision Panel</div>
        </MobileBottomSheet>
      );

      // lg:hidden が存在すること
      expect(html).toContain("lg:hidden");
    });
  });
});
