import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { PlayerBoard } from "../../ui/game/PlayerBoard";
import { PlayerBoardViewModel } from "../../ui/game/PlayerObservationPresenter";
import { UnitBattleDisplayInfo } from "../../ui/game/BattleRelationPresenter";

describe("BP-SIM-PRO-RAREPACK-POLISH-3: Bulwark Horizontal Scroll Left-Clipping Fix", () => {
  const createMockBulwark = (id: string, rank: string) => ({
    unitId: id,
    kind: "防壁",
    componentId: "character.bulwark",
    state: "charge",
    face: "down",
    size: 0,
    cards: [{ suit: "S", rank, value: Number(rank) || 0 }],
  });

  const createMockSoldier = (id: string, rank: string) => ({
    unitId: id,
    kind: "一般兵",
    componentId: "character.soldier",
    state: "charge",
    face: "up",
    size: Number(rank) || 0,
    cards: [{ suit: "H", rank, value: Number(rank) || 0 }],
  });

  const createMockViewModel = (overrides: Partial<PlayerBoardViewModel> = {}): PlayerBoardViewModel => ({
    playerKey: "p1",
    name: "Player A",
    isViewer: true,
    isTurnPlayer: false,
    isChancePlayer: false,
    lifeDisplay: "15",
    handCount: 3,
    handCards: [],
    fieldUnits: [],
    fog: [],
    graveCount: 0,
    graveCards: [],
    canViewFullGrave: true,
    ...overrides,
  });

  describe("1. 防壁描画順の維持 ([...bulwarkUnits].reverse())", () => {
    it("防壁が3枚配置された場合、画面左→右で ③, ②, ① の順（ライフ側＝右端が①）に描画される", () => {
      const b1 = createMockBulwark("b1", "1");
      const b2 = createMockBulwark("b2", "2");
      const b3 = createMockBulwark("b3", "3");

      const battleRelationMap = new Map<string, UnitBattleDisplayInfo>([
        ["b1", { unitId: "b1", badge: "①", label: "防壁①", bulwarkPosition: "①", ownerPlayerKey: "p1", blockedByBadges: [], role: undefined }],
        ["b2", { unitId: "b2", badge: "②", label: "防壁②", bulwarkPosition: "②", ownerPlayerKey: "p1", blockedByBadges: [], role: undefined }],
        ["b3", { unitId: "b3", badge: "③", label: "防壁③", bulwarkPosition: "③", ownerPlayerKey: "p1", blockedByBadges: [], role: undefined }],
      ]);

      const viewModel = createMockViewModel({
        fieldUnits: [b1, b2, b3],
      });

      const html = renderToString(
        <PlayerBoard
          playerKey="p1"
          viewModel={viewModel}
          battleRelationMap={battleRelationMap}
        />
      );

      // DOM内の出現順序を検証: B③ -> B② -> B①
      const posB3 = html.indexOf("B③");
      const posB2 = html.indexOf("B②");
      const posB1 = html.indexOf("B①");

      expect(posB3).toBeGreaterThan(-1);
      expect(posB2).toBeGreaterThan(posB3);
      expect(posB1).toBeGreaterThan(posB2);
    });
  });

  describe("2. スクロールコンテナと中央寄せコンテナの分離構造 (Outer/Inner)", () => {
    it("防壁列が Outer (overflow-x-auto) と Inner (min-w-full w-max justify-center) に分離されている", () => {
      const b1 = createMockBulwark("b1", "1");
      const viewModel = createMockViewModel({
        fieldUnits: [b1],
      });

      const html = renderToString(
        <PlayerBoard
          playerKey="p1"
          viewModel={viewModel}
        />
      );

      // 防壁ヘッダーが存在すること
      expect(html).toContain("防壁 (1体・ライフ側 →)");

      // 単一要素で justify-center + overflow-x-auto を併用していないこと（見切れ原因の排除）
      expect(html).not.toMatch(/overflow-x-auto[^>]*justify-center/);
      expect(html).not.toMatch(/justify-center[^>]*overflow-x-auto/);

      // Outer: overflow-x-auto no-scrollbar
      expect(html).toContain("overflow-x-auto no-scrollbar");

      // Inner: min-w-full w-max flex justify-center
      expect(html).toContain("min-w-full");
      expect(html).toContain("w-max");
      expect(html).toContain("justify-center");
    });

    it("兵士列も同様に Outer (overflow-x-auto) と Inner (min-w-full w-max justify-center) に分離されている", () => {
      const s1 = createMockSoldier("s1", "5");
      const viewModel = createMockViewModel({
        fieldUnits: [s1],
      });

      const html = renderToString(
        <PlayerBoard
          playerKey="p1"
          viewModel={viewModel}
        />
      );

      // 兵士ヘッダー
      expect(html).toContain("兵士 (1体)");

      // Outer/Inner 分離構造の検証
      expect(html).toContain("min-w-full w-max");
    });
  });

  describe("3. 多数防壁（画面幅超過時）のレイアウト構造", () => {
    it("防壁が5枚以上配置された場合でも、Outer/Inner構造により左端カードへの到達性が保証される", () => {
      const bulwarks = [
        createMockBulwark("b1", "1"),
        createMockBulwark("b2", "2"),
        createMockBulwark("b3", "3"),
        createMockBulwark("b4", "4"),
        createMockBulwark("b5", "5"),
        createMockBulwark("b6", "6"),
      ];

      const battleRelationMap = new Map<string, UnitBattleDisplayInfo>();
      const digits = ["①", "②", "③", "④", "⑤", "⑥"];
      bulwarks.forEach((b, idx) => {
        battleRelationMap.set(b.unitId, {
          unitId: b.unitId,
          badge: digits[idx],
          label: `防壁 ${digits[idx]}`,
          bulwarkPosition: digits[idx],
          ownerPlayerKey: "p1",
          blockedByBadges: [],
          role: undefined,
        });
      });

      const viewModel = createMockViewModel({
        fieldUnits: bulwarks,
      });

      const html = renderToString(
        <PlayerBoard
          playerKey="p1"
          viewModel={viewModel}
          battleRelationMap={battleRelationMap}
        />
      );

      // 防壁数ヘッダー
      expect(html).toContain("防壁 (6体・ライフ側 →)");

      // 左端 (B⑥) から 右端 (B①) までのすべての防壁が描画されていること
      expect(html).toContain("B⑥");
      expect(html).toContain("B⑤");
      expect(html).toContain("B④");
      expect(html).toContain("B③");
      expect(html).toContain("B②");
      expect(html).toContain("B①");

      // 逆順（ライフ側＝右端）の整合性
      const posB6 = html.indexOf("B⑥");
      const posB1 = html.indexOf("B①");
      expect(posB6).toBeLessThan(posB1);
    });
  });

  describe("4. PlayerBoard 全体の回帰検証", () => {
    it("兵士・防壁・手札・ZoneStrip・Playerヘッダーが正常に描画される", () => {
      const s1 = createMockSoldier("s1", "5");
      const b1 = createMockBulwark("b1", "1");
      const viewModel = createMockViewModel({
        fieldUnits: [s1, b1],
        handCards: [{ id: "h1", suit: "S", rank: "A" }],
        handCount: 1,
        fog: [{ fogId: "f1", bindings: { target: "s1", amount: 1 } }],
        graveCount: 2,
      });

      const html = renderToString(
        <PlayerBoard
          playerKey="p1"
          viewModel={viewModel}
        />
      );

      // ヘッダー
      expect(html).toContain("Player A");
      expect(html).toContain("LIFE:");
      expect(html).toContain("HAND:");

      // ZoneStrip
      expect(html).toContain("FOG");
      expect(html).toContain("墓地");

      // FIELD
      expect(html).toContain("FIELD");
      expect(html).toMatch(/ユニット:\s*(<!-- -->)?2(<!-- -->)?体/);
      expect(html).toContain("兵士 (1体)");
      expect(html).toContain("防壁 (1体・ライフ側 →)");

      // HAND
      expect(html).toContain("HAND");
      expect(html).toMatch(/手札:\s*(<!-- -->)?1(<!-- -->)?枚/);
      expect(html).toContain("♠");
      expect(html).toContain("A");
    });
  });
});
