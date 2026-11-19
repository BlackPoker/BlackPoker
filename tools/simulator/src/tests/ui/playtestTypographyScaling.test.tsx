import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { UnitCard } from "../../ui/game/UnitCard";
import { GameStatusBar } from "../../ui/game/GameStatusBar";
import { PlayerZoneStrip } from "../../ui/game/PlayerZoneStrip";
import { StagePanel } from "../../ui/game/StagePanel";
import { MobileDecisionDock } from "../../ui/decision/MobileDecisionDock";
import {
  FONT_SCALE_NUMERIC_MAP,
  ALLOWED_FONT_SCALES,
  applyFontScaleToDom,
} from "../../ui/preferences/PlaytestUserPreferences";

describe("PlaytestTypographyScaling (Phase 4B)", () => {
  let originalDocument: unknown;

  beforeEach(() => {
    originalDocument = (globalThis as Record<string, unknown>).document;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).document = originalDocument;
    vi.restoreAllMocks();
  });

  describe("1. CSSカスタムプロパティ --bp-font-scale のトークン定義", () => {
    it("ALLOWED_FONT_SCALES の全4段階に対応するスケール値が正確に定義されていること", () => {
      expect(ALLOWED_FONT_SCALES).toEqual(["100%", "115%", "130%", "150%"]);
      expect(FONT_SCALE_NUMERIC_MAP["100%"]).toBe(1.0);
      expect(FONT_SCALE_NUMERIC_MAP["115%"]).toBe(1.15);
      expect(FONT_SCALE_NUMERIC_MAP["130%"]).toBe(1.3);
      expect(FONT_SCALE_NUMERIC_MAP["150%"]).toBe(1.5);
    });

    it("applyFontScaleToDom で各要素の --bp-font-scale に正しく数値が設定されること", () => {
      const mockProps = new Map<string, string>();
      const mockElement = {
        style: {
          setProperty: (k: string, v: string) => mockProps.set(k, v),
        },
      } as unknown as HTMLElement;

      (globalThis as Record<string, unknown>).document = {
        documentElement: mockElement,
      };

      for (const scale of ALLOWED_FONT_SCALES) {
        applyFontScaleToDom(scale, mockElement);
        expect(mockProps.get("--bp-font-scale")).toBe(String(FONT_SCALE_NUMERIC_MAP[scale]));
      }
    });
  });

  describe("2. UnitCard バッジの文字切れ防止と min-h-* 契約", () => {
    const mockUnit = {
      unitId: "u-test-1",
      kind: "soldier",
      state: "charge",
      cards: [{ id: "c-1", suit: "S", rank: "10", value: 10 }],
    };

    it("選択マーカー付き UnitCard のバッジが固定高さ h-4 ではなく min-h-* で描画されること", () => {
      const html = renderToString(
        React.createElement(UnitCard, {
          unit: mockUnit,
          selectionMarker: {
            badge: "①",
            isSelected: true,
          },
        })
      );

      // 固定高 h-4 のみではなく min-h-[16px] または min-h-[20px] を含む
      expect(html).toContain("min-h-[16px]");
      expect(html).toContain("lg:min-h-[20px]");
      expect(html).toMatch(/①.*✓/);
    });
  });

  describe("3. PlayerZoneStrip の文字切れ防止とレイアウト耐性", () => {
    it("PlayerZoneStrip のバッジが py-0.5 および leading-snug で文字切れを防ぐこと", () => {
      const html = renderToString(
        React.createElement(PlayerZoneStrip, {
          items: [
            {
              id: "grave",
              label: "墓地",
              count: 3,
              badge: "TOP: ♠A",
            },
          ],
        })
      );

      expect(html).toContain("text-[9.5px] lg:text-[10px]");
      expect(html).toContain("leading-snug");
      expect(html).toContain("min-h-[22px]");
    });
  });

  describe("4. GameStatusBar のフォント構造と情報可視化", () => {
    it("GameStatusBar が flex-wrap を持ち、TURN・手番・CHANCE・FOCUS がすべて表示されること", () => {
      const html = renderToString(
        React.createElement(GameStatusBar, {
          turnPlayer: "p1",
          chancePlayer: "p2",
          focusPlayer: "p1",
          turnCount: 3,
          players: {
            p1: { name: "Player A" },
            p2: { name: "Player B" },
          },
        })
      );

      expect(html).toContain("flex-wrap");
      expect(html).toContain("TURN");
      expect(html).toContain("CHANCE:");
      expect(html).toContain("FOCUS:");
      expect(html).toContain("Player A");
      expect(html).toContain("Player B");
    });
  });

  describe("5. StagePanel のフォント構造とスクロール耐性", () => {
    it("StagePanel がリクエスト一覧を独立スクロール (overflow-y-auto) で保持すること", () => {
      const html = renderToString(
        React.createElement(StagePanel, {
          requests: [
            { id: "req-1", actionId: "action.attack", action: { name: "アタック" }, controller: "p1" },
            { id: "req-2", actionId: "action.block", action: { name: "ブロック" }, controller: "p2" },
          ],
        })
      );

      expect(html).toContain("STAGE (LIFO)");
      expect(html).toContain("overflow-y-auto");
    });
  });

  describe("6. MobileDecisionDock のフォントサイズと min-h-[44px] タッチ領域", () => {
    it("MobileDecisionDock が min-h-[44px] を維持し、主要操作文字が text-xs であること", () => {
      const mockRequest: any = {
        decisionId: "dec-1",
        stateVersion: 1,
        playerId: "p1",
        source: { type: "ACTION_REQUEST" },
        patterns: [{ kind: "PASS" }],
        catalog: { effectSelections: [] },
      };

      const html = renderToString(
        React.createElement(MobileDecisionDock, {
          request: mockRequest,
          onOpenSheet: () => {},
          onSubmit: () => {},
          sheetMode: "collapsed",
        })
      );

      expect(html).toContain("min-h-[44px]");
      expect(html).toContain("PASS");
      expect(html).toContain("text-xs");
    });
  });
});
