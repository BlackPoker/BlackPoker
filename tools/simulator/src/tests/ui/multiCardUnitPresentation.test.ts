import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MultiCardUnitStack } from "../../ui/game/MultiCardUnitStack";
import { UnitDetailModal } from "../../ui/game/UnitDetailModal";
import { UnitCard } from "../../ui/game/UnitCard";

describe("Multi-card Unit Presentation Tests", () => {
  describe("MultiCardUnitStack Component", () => {
    it("1. cardsが1枚のユニット: 従来の単一カード表示（Fan/Stackにならない、×Nバッジなし）", () => {
      const singleCard = [{ id: "c-1", suit: "S", rank: 7 }];
      const html = renderToString(
        React.createElement(MultiCardUnitStack, {
          cards: singleCard,
          faceDown: false,
        })
      );

      expect(html).toContain("♠");
      expect(html).toContain("7");
      expect(html).not.toContain("multi-card-count-badge");
      expect(html).not.toContain("×1");
      expect(html).not.toContain("multi-card-detail-button");
    });

    it("2. cardsが2枚のユニット（装備兵など）: MultiCardUnitStackと枚数バッジ「×2」が表示される", () => {
      const twoCards = [
        { id: "c-1", suit: "S", rank: 7 },
        { id: "c-2", suit: "H", rank: 4 },
      ];
      const html = renderToString(
        React.createElement(MultiCardUnitStack, {
          cards: twoCards,
          faceDown: false,
          onOpenDetail: () => {},
        })
      );

      expect(html).toContain("multi-card-stack");
      expect(html).toContain("multi-card-count-badge");
      expect(html).toContain("×2");
      expect(html).toContain("multi-card-detail-button");
      expect(html).toContain("詳細");
      // 1枚目と2枚目のランクが表示に含まれる
      expect(html).toContain("7");
      expect(html).toContain("4");
    });

    it("3. cardsが3枚以上のユニット（魔王/巨人等）: 枚数バッジ「×3」が表示され、背面レイヤーが描画される", () => {
      const threeCards = [
        { id: "c-1", suit: "S", rank: 10 },
        { id: "c-2", suit: "D", rank: 5 },
        { id: "c-3", suit: "C", rank: 2 },
      ];
      const html = renderToString(
        React.createElement(MultiCardUnitStack, {
          cards: threeCards,
          faceDown: false,
          onOpenDetail: () => {},
        })
      );

      expect(html).toContain("multi-card-count-badge");
      expect(html).toContain("×3");
      expect(html).toContain("multi-card-detail-button");
    });

    it("4. 0枚のユニット: 'カードなし'と表示される", () => {
      const html = renderToString(
        React.createElement(MultiCardUnitStack, {
          cards: [],
        })
      );
      expect(html).toContain("カードなし");
    });

    it("5. スタックおよび詳細ボタンをクリックした際、stopPropagationが呼ばれること", () => {
      let stopPropagationCalled = false;
      let openDetailCalled = false;

      const mockEvent = {
        stopPropagation: () => {
          stopPropagationCalled = true;
        },
      } as unknown as React.MouseEvent;

      const element = MultiCardUnitStack({
        cards: [
          { id: "c-1", suit: "S", rank: 7 },
          { id: "c-2", suit: "H", rank: 4 },
        ],
        onOpenDetail: () => {
          openDetailCalled = true;
        },
      });

      expect(element).not.toBeNull();
      // スタックコンテナのonClickハンドラをシミュレート
      const stackContainerProps = (element as any).props.children[0].props;
      stopPropagationCalled = false;
      openDetailCalled = false;
      stackContainerProps.onClick(mockEvent);

      expect(stopPropagationCalled).toBe(true);
      expect(openDetailCalled).toBe(true);

      // 詳細ボタンのonClickハンドラをシミュレート
      const detailButtonProps = (element as any).props.children[1].props;
      stopPropagationCalled = false;
      openDetailCalled = false;
      detailButtonProps.onClick(mockEvent);

      expect(stopPropagationCalled).toBe(true);
      expect(openDetailCalled).toBe(true);
    });
  });

  describe("UnitCard & Information Visibility Secret Boundary", () => {
    it("A: 伏せ防壁 (viewerが相手): カードコード・ランクは非公開、SIZE/防壁数字は '?'", () => {
      const bulwarkUnit = {
        unitId: "u-bulwark-opp",
        componentId: "character.bulwark",
        kind: "防壁",
        state: "charge",
        face: "down",
        cards: [{ suit: "D", rank: 8, code: "D8" }],
      };

      const html = renderToString(
        React.createElement(UnitCard, {
          unit: bulwarkUnit,
          showCardDetails: false, // 相手視点
          field: [bulwarkUnit],
        })
      );

      // 防壁数字が ? であること
      expect(html).toContain("?");
      // 秘密情報 D8, ♢8, 8 が漏洩しないこと
      expect(html).not.toContain("♢8");
      expect(html).not.toContain("D8");
    });

    it("B: 伏せ防壁 (viewerがオーナー本人): カード内容・防壁数字が確認可能", () => {
      const bulwarkUnit = {
        unitId: "u-bulwark-own",
        componentId: "character.bulwark",
        kind: "防壁",
        state: "charge",
        face: "down",
        cards: [{ suit: "D", rank: 8, code: "D8" }],
      };

      const html = renderToString(
        React.createElement(UnitCard, {
          unit: bulwarkUnit,
          showCardDetails: true, // オーナー本人視点
          field: [bulwarkUnit],
        })
      );

      // 防壁数字 8 が確認できる
      expect(html).toContain("8");
      // ? に隠蔽されない
      expect(html).not.toContain("?");
      expect(html).toContain("♢");
    });

    it("C: 兵士の複数枚構成 (装備兵) が UnitCard 上でスタック表示される", () => {
      const soldierUnit = {
        unitId: "u-soldier-equipped",
        componentId: "character.soldier",
        kind: "兵士",
        state: "charge",
        face: "up",
        size: 11,
        cards: [
          { suit: "S", rank: 7, code: "S7" },
          { suit: "H", rank: 4, code: "H4" },
        ],
      };

      const html = renderToString(
        React.createElement(UnitCard, {
          unit: soldierUnit,
          showCardDetails: true,
          field: [soldierUnit],
        })
      );

      expect(html).toContain("×2");
      expect(html).toContain("multi-card-stack");
      expect(html).toContain("SIZE:");
      expect(html).toContain("11");
    });
  });

  describe("Secondary Up / Down (Fog) Chips", () => {
    it("兵士に付与されたFogが小さなchip (text-[8px]) として横並び表示されること", () => {
      const soldierUnit = {
        unitId: "u-soldier-1",
        kind: "兵士",
        state: "charge",
        face: "up",
        size: 9,
        cards: [{ suit: "S", rank: 7 }],
      };

      const fogs = [
        {
          fogId: "fog-1",
          bindings: { amount: 2 },
          ownerPlayerId: "p1",
          card: { suit: "S", rank: 2 },
        },
        {
          fogId: "fog-2",
          bindings: { amount: -1 },
          ownerPlayerId: "p2",
          card: { suit: "D", rank: 1 },
        },
      ];

      const html = renderToString(
        React.createElement(UnitCard, {
          unit: soldierUnit,
          fogs: fogs,
          showCardDetails: true,
          field: [soldierUnit],
        })
      );

      expect(html).toContain("fog-chip");
      expect(html).toContain("↑2");
      expect(html).toContain("↓1");
      expect(html).toContain("text-[8px]");
    });

    it("4件以上のFogがある場合、'+N' ボタンが表示されること", () => {
      const soldierUnit = {
        unitId: "u-soldier-1",
        kind: "兵士",
        state: "charge",
        face: "up",
        size: 12,
        cards: [{ suit: "S", rank: 7 }],
      };

      const fogs = [
        { fogId: "f-1", bindings: { amount: 1 } },
        { fogId: "f-2", bindings: { amount: 2 } },
        { fogId: "f-3", bindings: { amount: -1 } },
        { fogId: "f-4", bindings: { amount: 3 } },
      ];

      const html = renderToString(
        React.createElement(UnitCard, {
          unit: soldierUnit,
          fogs: fogs,
          showCardDetails: true,
          field: [soldierUnit],
        })
      );

      expect(html).toContain("+1");
    });

    it("防壁にはFogが表示されないこと", () => {
      const bulwarkUnit = {
        unitId: "u-bulwark-1",
        componentId: "character.bulwark",
        kind: "防壁",
        state: "charge",
        face: "up",
        cards: [{ suit: "D", rank: 8 }],
      };

      const fogs = [{ fogId: "f-1", bindings: { amount: 1 } }];

      const html = renderToString(
        React.createElement(UnitCard, {
          unit: bulwarkUnit,
          fogs: fogs,
          showCardDetails: true,
          field: [bulwarkUnit],
        })
      );

      expect(html).not.toContain("fog-chip");
    });
  });

  describe("UnitDetailModal Component", () => {
    it("isOpen=false の場合、何もレンダリングされないこと", () => {
      const html = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: false,
          onClose: () => {},
          unit: { cards: [{ suit: "S", rank: 7 }] },
          unitDisplayName: "兵士①",
          isBulwark: false,
          isDrive: false,
          displaySize: 7,
          showCardDetails: true,
          isFaceDown: false,
        })
      );

      expect(html).toBe("");
    });

    it("isOpen=true の場合、全構成カードと状態サマリーが詳細表示されること", () => {
      const unit = {
        unitId: "u-demon",
        cards: [
          { suit: "S", rank: 10 },
          { suit: "H", rank: 8 },
          { suit: "D", rank: 6 },
        ],
      };

      const html = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: true,
          onClose: () => {},
          unit: unit,
          unitDisplayName: "魔王",
          isBulwark: false,
          isDrive: true,
          displaySize: 24,
          showCardDetails: true,
          isFaceDown: false,
          fogs: [
            {
              fogId: "fog-1",
              bindings: { amount: 3 },
              ownerPlayerId: "p1",
              card: { suit: "S", rank: 3 },
            },
          ],
        })
      );

      expect(html).toContain("unit-detail-modal-container");
      expect(html).toContain("魔王");
      expect(html).toContain("DRIVE");
      expect(html).not.toContain("行動済");
      expect(html).not.toContain("兵士");
      expect(html).toContain("24");
      expect(html).toContain("構成カード (3枚)");
      expect(html).toContain("#1");
      expect(html).toContain("#2");
      expect(html).toContain("#3");
      expect(html).toContain("10");
      expect(html).toContain("8");
      expect(html).toContain("6");
      expect(html).toContain("付与 Fog (1件)");
      expect(html).toContain("↑ アップ");
    });

    it("伏せ非公開の場合、構成カードが裏面表示（???）となること", () => {
      const unit = {
        unitId: "u-hidden",
        cards: [
          { suit: "S", rank: 10 },
          { suit: "H", rank: 8 },
        ],
      };

      const html = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: true,
          onClose: () => {},
          unit: unit,
          unitDisplayName: "相手の兵士",
          isBulwark: false,
          isDrive: false,
          displaySize: "?",
          showCardDetails: false,
          isFaceDown: true,
        })
      );

      expect(html).toContain("???");
      expect(html).not.toContain("♠10");
      expect(html).not.toContain("♡8");
    });
  });

  describe("Generic Unit Detail Semantics Tests (UI Phase 2.8-R1)", () => {
    it("A: 防壁ではないGeneric Unitに対し、自動的に「兵士」という文字列を付与しない", () => {
      const genericUnit = {
        unitId: "u-generic-1",
        cards: [
          { suit: "S", rank: 10 },
          { suit: "H", rank: 8 },
        ],
      };

      const html = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: true,
          onClose: () => {},
          unit: genericUnit,
          unitDisplayName: "魔王",
          isBulwark: false,
          isDrive: true,
          displaySize: 18,
          showCardDetails: true,
          isFaceDown: false,
        })
      );

      expect(html).toContain("魔王");
      expect(html).not.toContain("兵士");
    });

    it("B: unitDisplayName='魔王'のようなGeneric UnitでもDetail Modalが正常描画される", () => {
      const demonUnit = {
        unitId: "u-demon-boss",
        cards: [
          { suit: "S", rank: 10, code: "S10" },
          { suit: "H", rank: 10, code: "H10" },
          { suit: "D", rank: 10, code: "D10" },
        ],
      };

      const html = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: true,
          onClose: () => {},
          unit: demonUnit,
          unitDisplayName: "魔王",
          isBulwark: false,
          isDrive: false,
          displaySize: 30,
          showCardDetails: true,
          isFaceDown: false,
        })
      );

      expect(html).toContain("unit-detail-modal-container");
      expect(html).toContain("魔王");
      expect(html).toContain("構成カード (3枚)");
      expect(html).toContain("30");
      expect(html).toContain("CHARGE");
    });

    it("C: DRIVE時に「行動済」の文字列が存在しない", () => {
      const unit = {
        unitId: "u-test-drive",
        cards: [{ suit: "S", rank: 5 }],
      };

      const html = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: true,
          onClose: () => {},
          unit: unit,
          unitDisplayName: "巨人",
          isBulwark: false,
          isDrive: true,
          displaySize: 5,
          showCardDetails: true,
          isFaceDown: false,
        })
      );

      expect(html).toContain("DRIVE");
      expect(html).not.toContain("行動済");
      expect(html).not.toContain("未行動");
    });

    it("D: CHARGE時に「未行動」の文字列が存在しない", () => {
      const unit = {
        unitId: "u-test-charge",
        cards: [{ suit: "H", rank: 3 }],
      };

      const html = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: true,
          onClose: () => {},
          unit: unit,
          unitDisplayName: "リアニメーター",
          isBulwark: false,
          isDrive: false,
          displaySize: 3,
          showCardDetails: true,
          isFaceDown: false,
        })
      );

      expect(html).toContain("CHARGE");
      expect(html).not.toContain("未行動");
      expect(html).not.toContain("行動済");
    });

    it("E: CHARGE / DRIVE 自体は表示される", () => {
      const chargeHtml = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: true,
          onClose: () => {},
          unit: { cards: [{ suit: "C", rank: 2 }] },
          unitDisplayName: "ユニットA",
          isBulwark: false,
          isDrive: false,
          displaySize: 2,
          showCardDetails: true,
          isFaceDown: false,
        })
      );
      expect(chargeHtml).toContain("状態:");
      expect(chargeHtml).toContain("CHARGE");

      const driveHtml = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: true,
          onClose: () => {},
          unit: { cards: [{ suit: "C", rank: 2 }] },
          unitDisplayName: "ユニットA",
          isBulwark: false,
          isDrive: true,
          displaySize: 2,
          showCardDetails: true,
          isFaceDown: false,
        })
      );
      expect(driveHtml).toContain("状態:");
      expect(driveHtml).toContain("DRIVE");
    });

    it("F: isBulwark=true の場合は「防壁」バッジが表示される", () => {
      const bulwarkUnit = {
        unitId: "u-bulwark-detail",
        componentId: "character.bulwark",
        kind: "防壁",
        cards: [{ suit: "D", rank: 8, code: "D8" }],
      };

      const html = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: true,
          onClose: () => {},
          unit: bulwarkUnit,
          unitDisplayName: "防壁①",
          isBulwark: true,
          isDrive: false,
          displaySize: "?",
          bulwarkRank: "8",
          showCardDetails: true,
          isFaceDown: false,
        })
      );

      expect(html).toContain("防壁①");
      expect(html).toContain("防壁");
      expect(html).toContain("防壁数字:");
      expect(html).toContain("8");
    });

    it("G: 明示的な kind を持つユニットはその分類バッジが表示される", () => {
      const soldierUnit = {
        unitId: "u-soldier-detail",
        kind: "兵士",
        cards: [{ suit: "S", rank: 7, code: "S7" }],
      };

      const html = renderToString(
        React.createElement(UnitDetailModal, {
          isOpen: true,
          onClose: () => {},
          unit: soldierUnit,
          unitDisplayName: "兵士①",
          isBulwark: false,
          isDrive: false,
          displaySize: 7,
          showCardDetails: true,
          isFaceDown: false,
        })
      );

      expect(html).toContain("兵士①");
      expect(html).toContain("兵士");
      expect(html).toContain("SIZE:");
      expect(html).toContain("7");
    });
  });
});

