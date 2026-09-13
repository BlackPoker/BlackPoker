import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { UnitCard } from "../../ui/game/UnitCard";
import { CardView } from "../../ui/game/CardView";
import { PlayerBoard } from "../../ui/game/PlayerBoard";
import { PlayerBoardViewModel } from "../../ui/game/PlayerObservationPresenter";
import { UnitBattleDisplayInfo } from "../../ui/game/BattleRelationPresenter";

describe("UI Phase 3.4: Mobile Readability Polish Tests", () => {
  // 1. モバイル場カードの Target 番号見切れ修正・共存性
  describe("1. モバイル場カード Target 番号と Selection Marker", () => {
    const mockSoldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      face: "up",
      size: 5,
      cards: [{ suit: "S", rank: "5", value: 5 }],
    };

    const mockDisplayInfo: UnitBattleDisplayInfo = {
      unitId: "soldier-1",
      badge: "①",
      label: "① ♠5 一般兵",
      ownerPlayerKey: "p1",
      role: "attacker",
      blockedByBadges: ["B①"],
    };

    it("テスト1: mobile compact 兵士で Target 番号 ① が欠けずに描画され、内側寄り配置クラスを含む", () => {
      const html = renderToString(
        React.createElement(UnitCard, {
          unit: mockSoldier,
          battleDisplayInfo: mockDisplayInfo,
          showCardDetails: true,
          selectionMarker: { badge: "①", isSelected: false },
        })
      );

      // Target relation badge ①
      expect(html).toContain("①");
      // selectionMarker がモバイルで内側へ寄せるクラス (-top-2 -left-1) を持つこと
      expect(html).toContain("-top-2 -left-1 sm:-top-3.5 sm:-left-2.5");
      // selectionMarker のサイズがモバイルで w-5 h-5 (10px) であること
      expect(html).toContain("w-5 h-5 sm:w-7 sm:h-7");
      expect(html).toContain("text-[10px] sm:text-sm");
    });

    it("テスト2: ①, ② 等が selectionMarker と battleRole (ATK/BLK) と共存できる", () => {
      const html = renderToString(
        React.createElement(UnitCard, {
          unit: mockSoldier,
          battleDisplayInfo: mockDisplayInfo,
          showCardDetails: true,
          selectionMarker: { badge: "②", isSelected: true },
        })
      );

      // selectionMarker の ②
      expect(html).toContain("②");
      // Target 番号の ①
      expect(html).toContain("①");
      // バトルロール (ATK 攻撃中)
      expect(html).toContain("ATK 攻撃中");
      // 選択状態のスタイル
      expect(html).toContain("ring-zinc-950");
    });
  });

  // 2. 相手墓地モーダルの 3-state 表示契約
  describe("2. 相手墓地モーダルの 3値表示契約", () => {
    const baseOpponentViewModel: PlayerBoardViewModel = {
      playerKey: "p2",
      name: "Player 2",
      isTurnPlayer: false,
      isChancePlayer: false,
      isViewer: false,
      canViewFullGrave: false, // 相手視点 (非公開)
      lifeDisplay: "3/3",
      handCount: 5,
      handCards: [],
      fieldUnits: [],
      graveCount: 0,
      graveCards: [],
      graveTopCard: undefined,
      fog: [],
    };

    it("テスト3: 相手墓地モーダルで graveCount > 0 && graveTopCard がある場合、公開トップ情報がテキスト表示される", () => {
      const vm: PlayerBoardViewModel = {
        ...baseOpponentViewModel,
        graveCount: 8,
        graveTopCard: { id: "c-spade-3", suit: "S", rank: "3", value: 3 },
      };

      const html = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p2",
          viewModel: vm,
          initialShowGraveModal: true,
        })
      );

      // ZoneStrip 上のバッジ形式
      expect(html).toContain("TOP: ♠3");

      // モーダル内部の表示テキスト
      expect(html).toContain("墓地トップ（公開）: ♠3");
      // 総枚数表示
      expect(html).toContain("8 枚");
      // 「墓地は空です」と誤認表示されない
      expect(html).not.toContain("墓地は空です");
    });

    it("テスト4: 相手墓地モーダルで graveCount === 0 の場合、空表示（「墓地は空です」）になる", () => {
      const vm: PlayerBoardViewModel = {
        ...baseOpponentViewModel,
        graveCount: 0,
        graveTopCard: undefined,
      };

      const html = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p2",
          viewModel: vm,
          initialShowGraveModal: true,
        })
      );

      // 空表示
      expect(html).toContain("墓地は空です");
      expect(html).toContain("0 枚");
      expect(html).not.toContain("墓地トップ（公開）:");
      expect(html).not.toContain("墓地トップ情報を表示できません");
    });

    it("テスト5: 相手墓地モーダルで graveCount > 0 && graveTopCard がない場合、fail-safe 表示（「墓地トップ情報を表示できません」）になる", () => {
      const vm: PlayerBoardViewModel = {
        ...baseOpponentViewModel,
        graveCount: 5,
        graveTopCard: undefined, // データ不整合・欠落シチュエーション
      };

      const html = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p2",
          viewModel: vm,
          initialShowGraveModal: true,
        })
      );

      // 「墓地は空です」と誤認させず、データ不整合を隠さないfail-safeテキスト
      expect(html).toContain("墓地トップ情報を表示できません");
      expect(html).toContain("5 枚");
      expect(html).not.toContain("墓地は空です");
    });
  });

  // 3. モバイル Charge / Drive 表示の矢印化
  describe("3. モバイル Charge / Drive 表示の矢印化 (↑ / →)", () => {
    it("テスト6: mobile compact で Charge=↑, Drive=→ となりツールチップ title を持つ", () => {
      const chargeUnit = {
        unitId: "u-charge",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        size: 3,
        cards: [{ suit: "C", rank: "3", value: 3 }],
      };

      const driveUnit = {
        unitId: "u-drive",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "drive",
        face: "up",
        size: 3,
        cards: [{ suit: "C", rank: "3", value: 3 }],
      };

      const htmlCharge = renderToString(
        React.createElement(UnitCard, { unit: chargeUnit, showCardDetails: true })
      );
      const htmlDrive = renderToString(
        React.createElement(UnitCard, { unit: driveUnit, showCardDetails: true })
      );

      // Charge は ↑
      expect(htmlCharge).toContain(">↑<");
      expect(htmlCharge).toContain('title="Charge (↑)"');

      // Drive は →
      expect(htmlDrive).toContain(">→<");
      expect(htmlDrive).toContain('title="Drive (→)"');
    });

    it("テスト7: C / D 状態略号が mobile compact に残っていない", () => {
      const chargeUnit = {
        unitId: "u-charge",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        size: 3,
        cards: [{ suit: "C", rank: "3", value: 3 }],
      };

      const driveUnit = {
        unitId: "u-drive",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "drive",
        face: "up",
        size: 3,
        cards: [{ suit: "C", rank: "3", value: 3 }],
      };

      const htmlCharge = renderToString(
        React.createElement(UnitCard, { unit: chargeUnit, showCardDetails: true })
      );
      const htmlDrive = renderToString(
        React.createElement(UnitCard, { unit: driveUnit, showCardDetails: true })
      );

      // モバイル要約領域に >C< や >D< がないこと
      expect(htmlCharge).not.toContain(">C<");
      expect(htmlDrive).not.toContain(">D<");

      // ただしデスクトップ表示用には CHARGE / DRIVE が残っていること
      expect(htmlCharge).toContain("CHARGE");
      expect(htmlDrive).toContain("DRIVE");
    });
  });

  // 4. スート文字色の黒/zinc統一 (赤文字廃止)
  describe("4. スート文字色の黒/zinc統一", () => {
    it("テスト8: ♦10 / ♥4 等の赤系スートが text-red-600 を持たず text-zinc-950 で描画される", () => {
      const redUnit = {
        unitId: "u-red",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        size: 10,
        cards: [{ suit: "D", rank: "10", value: 10 }],
      };

      const html = renderToString(
        React.createElement(UnitCard, { unit: redUnit, showCardDetails: true })
      );

      // ♦10 (♢10) を含む
      expect(html).toContain("♢10");
      // text-red-600 を含まない
      expect(html).not.toContain("text-red-600");
      // text-zinc-950 を含む
      expect(html).toContain("text-zinc-950");
    });

    it("テスト8.2: CardView でも全スート (♠, ♡, ♢, ♣, ★) が text-zinc-950 で統一されている", () => {
      const suits = ["S", "H", "D", "C", "J"];
      for (const s of suits) {
        const html = renderToString(
          React.createElement(CardView, {
            card: { id: `c-${s}`, suit: s, rank: "7", value: 7 },
          })
        );
        expect(html).not.toContain("text-red-600");
        expect(html).toContain("text-zinc-950");
      }
    });
  });

  // 5. 秘匿防壁の機密性保護
  describe("5. 秘匿防壁の機密性保護", () => {
    it("テスト9: hidden opponent Bulwark から suit/rank が漏洩しない (🂠 および ? 表示)", () => {
      const hiddenBulwark = {
        unitId: "bw-opp",
        kind: "防壁",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [{ visibility: "HIDDEN", id: "c-hidden-secret" }],
      };

      const displayInfo: UnitBattleDisplayInfo = {
        unitId: "bw-opp",
        badge: "①",
        label: "① 防壁",
        bulwarkPosition: "①",
        ownerPlayerKey: "p2",
        blockedByBadges: [],
      };

      const html = renderToString(
        React.createElement(UnitCard, {
          unit: hiddenBulwark,
          battleDisplayInfo: displayInfo,
          showCardDetails: false,
        })
      );

      expect(html).toContain("🂠");
      expect(html).toContain("?");
      // スート記号が漏洩していないこと
      expect(html).not.toContain("♠");
      expect(html).not.toContain("♡");
      expect(html).not.toContain("♢");
      expect(html).not.toContain("♣");
    });
  });

  // 6. 防壁 compact card の縦空白削減 & スクロール親要素上部余白
  describe("6. 防壁コンパクト表示とスクロール余白", () => {
    it("防壁コンパクト表示で min-h-[46px] が撤廃され gap-0.5 が適用されている", () => {
      const bulwarkUnit = {
        unitId: "bw-1",
        kind: "防壁",
        componentId: "character.bulwark",
        state: "charge",
        face: "up",
        size: 7,
        cards: [{ suit: "S", rank: "7", value: 7 }],
      };

      const html = renderToString(
        React.createElement(UnitCard, {
          unit: bulwarkUnit,
          showCardDetails: true,
        })
      );

      expect(html).not.toContain("min-h-[46px]");
      expect(html).toContain("gap-0.5");
      expect(html).toContain("mt-0.5 pt-0.5 border-t border-zinc-200");
    });

    it("PlayerBoard の soldierRow / bulwarkRow に pt-2 sm:pt-3.5 の上部余白が確保されている", () => {
      const vm: PlayerBoardViewModel = {
        playerKey: "p1",
        name: "Player 1",
        isTurnPlayer: true,
        isChancePlayer: false,
        isViewer: true,
        canViewFullGrave: true,
        lifeDisplay: "3/3",
        handCount: 5,
        handCards: [],
        fieldUnits: [
          {
            unitId: "s-1",
            kind: "一般兵",
            componentId: "character.soldier",
            state: "charge",
            face: "up",
            cards: [{ suit: "S", rank: "5", value: 5 }],
          },
          {
            unitId: "bw-1",
            kind: "防壁",
            componentId: "character.bulwark",
            state: "charge",
            face: "up",
            cards: [{ suit: "D", rank: "7", value: 7 }],
          },
        ],
        graveCount: 0,
        graveCards: [],
        fog: [],
      };

      const html = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p1",
          viewModel: vm,
        })
      );

      // soldierRow と bulwarkRow のスクロール親要素に pt-2 sm:pt-3.5 が設定されていること
      expect(html).toContain("p-1 pt-2 sm:pt-3.5 rounded bg-zinc-50 border border-zinc-200 items-center justify-end overflow-x-auto no-scrollbar");
    });
  });
});
