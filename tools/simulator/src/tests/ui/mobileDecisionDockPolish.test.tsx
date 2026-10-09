import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { MobileDecisionDock } from "../../ui/decision/MobileDecisionDock";
import { CardView } from "../../ui/game/CardView";
import { UnitCard } from "../../ui/game/UnitCard";
import { PlayerBoard } from "../../ui/game/PlayerBoard";
import { PlayerZoneStrip } from "../../ui/game/PlayerZoneStrip";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

describe("BP-SIM-PRO-RAREPACK-POLISH-2: Mobile UI & PlayerBoard Readability", () => {
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
      { patternId: "p-act", kind: "ACTION" },
    ],
    ...overrides,
  });

  const mockCards = [
    { id: "c1", suit: "S", rank: "A", value: 14 },
    { id: "c2", suit: "D", rank: "3", value: 3 },
    { id: "c3", suit: "C", rank: "K", value: 13 },
  ];

  describe("1. Mobile Decision Dock の冗長表示短縮", () => {
    it("通常行動選択時: 'Player A の行動選択' ではなく 'P1' と表示される", () => {
      const request = createMockRequest({ playerId: "p1" });
      const html = renderToString(
        <MobileDecisionDock
          request={request}
          sheetMode="collapsed"
          onOpenSheet={() => {}}
          onSubmit={() => {}}
        />
      );

      expect(html).toContain("P1");
      expect(html).not.toContain("Player A の行動選択");
      expect(html).not.toContain("Player A の");
    });

    it("P2通常行動選択時: 'P2' と表示される", () => {
      const request = createMockRequest({ playerId: "p2" });
      const html = renderToString(
        <MobileDecisionDock
          request={request}
          sheetMode="collapsed"
          onOpenSheet={() => {}}
          onSubmit={() => {}}
        />
      );

      expect(html).toContain("P2");
      expect(html).not.toContain("Player B の行動選択");
    });

    it("墓地TOP選択時: 'P1 墓地TOP' と短縮表記される", () => {
      const request = createMockRequest({
        playerId: "p1",
        source: { type: "ZONE_TOP_SELECTION", zone: "grave", playerId: "p1" },
      });
      const html = renderToString(
        <MobileDecisionDock
          request={request}
          sheetMode="collapsed"
          onOpenSheet={() => {}}
          onSubmit={() => {}}
        />
      );

      expect(html).toContain("P1 墓地TOP");
      expect(html).not.toContain("Player A の墓地TOP選択");
    });

    it("効果・対象選択時: 'P1 効果選択' と短縮表記される", () => {
      const request = createMockRequest({
        playerId: "p1",
        source: { type: "EFFECT_RESOLUTION", sourceRequestRef: "req-1", effectStepId: "step-1", playerId: "p1" },
      });
      const html = renderToString(
        <MobileDecisionDock
          request={request}
          sheetMode="collapsed"
          onOpenSheet={() => {}}
          onSubmit={() => {}}
        />
      );

      expect(html).toContain("P1 効果選択");
      expect(html).not.toContain("Player A の効果・対象選択");
    });
  });

  describe("2. Mobile Decision Dock への手札表示とレイアウト", () => {
    it("可視手札が渡された場合、サマリーバー内にCardView compactで描画される", () => {
      const request = createMockRequest();
      const html = renderToString(
        <MobileDecisionDock
          request={request}
          handCards={mockCards}
          sheetMode="collapsed"
          onOpenSheet={() => {}}
          onSubmit={() => {}}
        />
      );

      expect(html).toContain("data-testid=\"mobile-dock-hand-cards\"");
      // ♠A, ♦3, ♣K の表示
      expect(html).toContain("♠");
      expect(html).toContain("A");
      expect(html).toContain("♦");
      expect(html).toContain("3");
      expect(html).toContain("♣");
      expect(html).toContain("K");
    });

    it("手札コンテナは横スクロール可能 (overflow-x-auto) かつラベルやバッジは固定 (shrink-0)", () => {
      const request = createMockRequest();
      const html = renderToString(
        <MobileDecisionDock
          request={request}
          handCards={mockCards}
          sheetMode="collapsed"
          onOpenSheet={() => {}}
          onSubmit={() => {}}
          canUndo={true}
          onUndo={() => {}}
        />
      );

      // 横スクロール可能コンテナ
      expect(html).toContain("overflow-x-auto");
      expect(html).toContain("no-scrollbar");
      expect(html).toContain("flex-1 min-w-0");

      // 固定要素
      expect(html).toContain("shrink-0");

      // アクションボタンが押し出されない構造 (コンテナ外に独立配置)
      expect(html).toContain("PASS");
      expect(html).toContain("行動を選ぶ");
      expect(html).toContain("戻る");
    });
  });

  describe("3. Hidden Information (非公開情報) の保護", () => {
    it("非公開カード (visibility: 'HIDDEN' または faceUp: false) のSuit/Rank/内容はDOMに出力されない", () => {
      const request = createMockRequest();
      const hiddenCards = [
        { id: "secret-1", visibility: "HIDDEN", faceUp: false, suit: "H", rank: "Q" },
        { id: "secret-2", visibility: "HIDDEN", faceUp: false, code: "HQ" },
      ];
      const html = renderToString(
        <MobileDecisionDock
          request={request}
          handCards={hiddenCards}
          sheetMode="collapsed"
          onOpenSheet={() => {}}
          onSubmit={() => {}}
        />
      );

      expect(html).not.toContain("♥");
      expect(html).not.toContain(">Q<");
      expect(html).not.toContain("HQ");
      expect(html).not.toContain("secret-1");
      expect(html).not.toContain("secret-2");
    });

    it("handCardsが空 (相手の手番など) の場合はDockに手札カードが出力されない", () => {
      const request = createMockRequest({ playerId: "p2" });
      const html = renderToString(
        <MobileDecisionDock
          request={request}
          handCards={[]}
          sheetMode="collapsed"
          onOpenSheet={() => {}}
          onSubmit={() => {}}
        />
      );

      // 手札コンテナ内にカード要素が存在しない
      expect(html).toContain("data-testid=\"mobile-dock-hand-cards\"");
      expect(html).not.toContain("bp-card-suit");
      expect(html).not.toContain("bp-card-rank");
    });
  });

  describe("4. PlayerBoard 内の文字サイズ微小拡大 (+0.2pt 相当 / 約+0.5px)", () => {
    const mockViewModel = {
      playerKey: "p1",
      name: "Player A",
      isViewer: true,
      isTurnPlayer: true,
      isChancePlayer: true,
      lifeDisplay: "15",
      handCount: 3,
      handCards: mockCards,
      fieldUnits: [],
      fog: [],
      graveCount: 2,
      graveCards: [],
      canViewFullGrave: true,
    };

    it("PlayerBoard ヘッダーの各テキストがモバイル時に拡大され、Desktopクラスが維持される", () => {
      const html = renderToString(
        <PlayerBoard
          playerKey="p1"
          viewModel={mockViewModel}
        />
      );

      // Player名: text-[12.5px] lg:text-xs
      expect(html).toContain("text-[12.5px]");
      expect(html).toContain("lg:text-xs");

      // P1バッジ: text-[9.5px] lg:text-[9px]
      expect(html).toContain("text-[9.5px]");
      expect(html).toContain("lg:text-[9px]");

      // LIFE & HAND サマリー: text-[10.5px] lg:text-[10px], text-[12.5px] lg:text-xs
      expect(html).toContain("text-[10.5px]");
      expect(html).toContain("lg:text-[10px]");

      // FIELD & HAND ヘッダー: text-[9.5px] lg:text-[9px]
      expect(html).toContain("FIELD");
      expect(html).toContain("HAND");
    });

    it("PlayerZoneStrip の文字サイズがモバイル時に text-[9.5px] となり、Desktop用 lg:text-[10px] が維持される", () => {
      const html = renderToString(
        <PlayerZoneStrip
          items={[
            { id: "fog", label: "FOG", count: 1 },
            { id: "grave", label: "墓地", count: 2 },
          ]}
        />
      );

      expect(html).toContain("text-[9.5px]");
      expect(html).toContain("lg:text-[10px]");
    });
  });

  describe("5. PlayerBoard 内のカードスート・数字拡大 (Suit: 20px, Rank: 14px)", () => {
    it("PlayerBoard 内の手札 CardView は inPlayerBoard={true} により Suit 20px / Rank 14px となる", () => {
      const html = renderToString(
        <CardView
          card={{ suit: "S", rank: "A" }}
          inPlayerBoard={true}
          compact={true}
        />
      );

      expect(html).toContain("bp-card-board");
      expect(html).toContain("text-[20px]");
      expect(html).toContain("text-[14px]");
    });

    it("PlayerBoard 外の通常 CardView は Suit 18px / Rank 13px を維持する", () => {
      const html = renderToString(
        <CardView
          card={{ suit: "S", rank: "A" }}
          inPlayerBoard={false}
          compact={true}
        />
      );

      expect(html).not.toContain("bp-card-board");
      expect(html).toContain("text-[18px]");
      expect(html).toContain("text-[13px]");
    });

    it("UnitCard のモバイル表示で Suit 20px / Rank 14px (bp-card-board) となる", () => {
      const mockUnit = {
        unitId: "u1",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        size: 7,
        cards: [{ suit: "H", rank: "7", value: 7 }],
      };

      const html = renderToString(
        <UnitCard
          unit={mockUnit}
          showCardDetails={true}
        />
      );

      // モバイル用カード glyph
      expect(html).toContain("bp-card-board");
      expect(html).toContain("text-[20px]");
      expect(html).toContain("text-[14px]");

      // モバイルフォントサイズ微小拡大 (+0.2pt / +0.5px)
      expect(html).toContain("text-[9.5px]");
      expect(html).toContain("text-[8.5px]");
      expect(html).toContain("text-[10.5px]");
      expect(html).toContain("text-[11.5px]");
    });
  });
});
