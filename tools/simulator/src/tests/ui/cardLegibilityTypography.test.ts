import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import * as fs from "fs";
import * as path from "path";
import { CardView } from "../../ui/game/CardView";
import { UnitCard } from "../../ui/game/UnitCard";
import {
  formatSuitSymbol,
  formatOfficialSuitSymbol,
  isRedSuit,
  formatCardDisplay,
} from "../../engine/rules/cardUtils";

describe("Card Legibility & Typography Tests (BP-SIM-SCENARIO-1.3-CARD-LEGIBILITY-PACK-STATE - Scope A)", () => {
  // 1. CSS SSOT 定義の検証
  it("1: index.css に @font-face (BlackPoker Suit) と .bp-card-suit, .bp-card-suit-red, .bp-card-rank が定義され、Webfont と書体・カラー分離が指定されていること", () => {
    const cssPath = path.resolve(__dirname, "../../index.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // @font-face 定義の検証 (A, B, C, D)
    expect(cssContent).toContain("@font-face");
    expect(cssContent).toContain('font-family: "BlackPoker Suit"');
    expect(cssContent).toContain('src: url("./assets/fonts/suit-regular.woff") format("woff")');
    expect(cssContent).toContain("font-style: normal");
    expect(cssContent).toMatch(/@font-face[^{]*\{[^}]*font-weight:\s*400/);

    // Suit: BlackPoker Suit を first family とし、font-weight: 400 (E, F, H)
    expect(cssContent).toContain(".bp-card-suit");
    expect(cssContent).toContain('font-family: "BlackPoker Suit", "Open Sans", sans-serif');
    expect(cssContent).toMatch(/\.bp-card-suit[^{]*\{[^}]*font-weight:\s*400/);
    expect(cssContent).not.toMatch(/\.bp-card-suit[^{]*\{[^}]*Times New Roman/);
    expect(cssContent).not.toMatch(/\.bp-card-suit[^{]*\{[^}]*Yu Mincho/);

    // ActionList 公式赤カラー定義の検証 (#a22041)
    expect(cssContent).toContain(".bp-card-suit-red");
    expect(cssContent).toMatch(/\.bp-card-suit-red[^{]*\{[^}]*color:\s*#a22041/);

    // Rank: Serif / 明朝系維持 (G)
    expect(cssContent).toContain(".bp-card-rank");
    expect(cssContent).toContain("Times New Roman");
    expect(cssContent).toContain("Yu Mincho");
    expect(cssContent).toContain("Hiragino Mincho ProN");
    expect(cssContent).toContain("serif");
    expect(cssContent).toContain("font-variant-numeric: lining-nums tabular-nums");

    // 後方互換 alias
    expect(cssContent).toContain(".bp-card-glyph");
  });

  // 2. Desktop CardView のタイポグラフィとサイズ検証
  it("2: Desktop CardView で Rank に bp-card-rank text-[13px] font-bold、Suit に bp-card-suit text-[22px] が適用され、font-mono が除去されていること", () => {
    const htmlSpade = renderToString(
      React.createElement(CardView, {
        card: { id: "c-1", suit: "S", rank: "10", value: 10 },
        compact: false,
      })
    );

    // Rank element (desktop)
    expect(htmlSpade).toContain("text-[13px] font-bold bp-card-rank");
    // Suit element (desktop: text-[22px] で Rank より大きく強調)
    expect(htmlSpade).toContain("text-[22px] bp-card-suit my-auto");
    // Suit symbol
    expect(htmlSpade).toContain("♠");
    expect(htmlSpade).toContain("10");
    expect(htmlSpade).not.toContain("bp-card-suit-red");

    // Desktop view must NOT use font-mono for card identity
    expect(htmlSpade).not.toContain("text-[10px] font-mono font-black");

    // 赤スート (Heart): ActionList 公式赤 (#a22041 / bp-card-suit-red) が適用され、♥ が表示されること
    const htmlHeart = renderToString(
      React.createElement(CardView, {
        card: { id: "c-h", suit: "H", rank: "A", value: 1 },
        compact: false,
      })
    );
    expect(htmlHeart).toContain("text-[22px] bp-card-suit my-auto");
    expect(htmlHeart).toContain("bp-card-suit-red");
    expect(htmlHeart).toContain("text-[#a22041]");
    expect(htmlHeart).toContain("♥");
  });

  // 3. Mobile Compact CardView のタイポグラフィとサイズ検証
  it("3: Mobile Compact CardView で 1行表示に bp-card-suit text-[18px] と bp-card-rank font-bold text-[13px] が分離適用され、赤スートに bp-card-suit-red が適用されること", () => {
    const html = renderToString(
      React.createElement(CardView, {
        card: { id: "c-2", suit: "H", rank: "J", value: 11 },
        compact: true,
      })
    );

    expect(html).toContain("bp-card-suit text-[18px]");
    expect(html).toContain("bp-card-suit-red");
    expect(html).toContain("text-[#a22041]");
    expect(html).toContain("bp-card-rank font-bold text-[13px]");
    expect(html).toContain("♥");
    expect(html).toContain("J");
  });

  // 4. Mobile UnitCard のタイポグラフィとサイズ検証
  it("4: Mobile UnitCard の primaryCard 表示に bp-card-suit text-[18px] と bp-card-rank が分離適用され、赤スートに bp-card-suit-red が適用されること", () => {
    const unitClub = {
      unitId: "u-soldier-1",
      kind: "兵士",
      componentId: "character.soldier",
      state: "charge" as const,
      face: "up" as const,
      cards: [{ id: "c-3", suit: "C", rank: "K", value: 13 }],
    };

    const htmlClub = renderToString(
      React.createElement(UnitCard, {
        unit: unitClub,
      })
    );

    // Mobile card text container with separated suit and rank
    expect(htmlClub).toContain("bp-card-suit text-[18px]");
    expect(htmlClub).toContain("bp-card-rank");
    expect(htmlClub).toContain("♣");
    expect(htmlClub).toContain("K");
    expect(htmlClub).not.toContain("bp-card-suit-red");

    // 赤スート (Diamond)
    const unitDiam = {
      unitId: "u-soldier-2",
      kind: "兵士",
      componentId: "character.soldier",
      state: "charge" as const,
      face: "up" as const,
      cards: [{ id: "c-4", suit: "D", rank: "5", value: 5 }],
    };

    const htmlDiam = renderToString(
      React.createElement(UnitCard, {
        unit: unitDiam,
      })
    );
    expect(htmlDiam).toContain("bp-card-suit text-[18px]");
    expect(htmlDiam).toContain("bp-card-suit-red");
    expect(htmlDiam).toContain("text-[#a22041]");
    expect(htmlDiam).toContain("♦");
    expect(htmlDiam).toContain("5");
  });

  // 5. 絵文字バリエーションセレクター禁止と4スート公式Webフォント・カラー適用の検証
  it("5: スート記号 (♠, ♥, ♦, ♣) が公式Webフォント対応記号で提供され、赤スート (♥, ♦) の判定および絵文字バリエーションセレクター (\\uFE0F) の禁止が徹底されていること", () => {
    expect(formatOfficialSuitSymbol("S")).toBe("♠");
    expect(formatOfficialSuitSymbol("H")).toBe("♥");
    expect(formatOfficialSuitSymbol("D")).toBe("♦");
    expect(formatOfficialSuitSymbol("C")).toBe("♣");

    expect(isRedSuit("H")).toBe(true);
    expect(isRedSuit("D")).toBe(true);
    expect(isRedSuit("S")).toBe(false);
    expect(isRedSuit("C")).toBe(false);

    // 既存 plain-text 契約も非絵文字であることを維持
    expect(formatSuitSymbol("S")).toBe("♠");
    expect(formatSuitSymbol("H")).toBe("♡");
    expect(formatSuitSymbol("D")).toBe("♢");
    expect(formatSuitSymbol("C")).toBe("♣");

    const suits = ["S", "H", "D", "C"];
    for (const s of suits) {
      const symbol = formatOfficialSuitSymbol(s);
      expect(symbol).not.toContain("\uFE0F");
      expect(symbol.length).toBe(1); // 単一コードポイント (plain text glyph)
    }

    const cards = [
      { suit: "S", rank: "A" },
      { suit: "H", rank: "10" },
      { suit: "D", rank: "K" },
      { suit: "C", rank: "2" },
    ];
    for (const c of cards) {
      const display = formatCardDisplay(c);
      expect(display).not.toContain("\uFE0F");
    }
  });

  // 6. Joker の表示形式
  it("6: Joker カードが ★ および JK / Joker として正しく表示されること", () => {
    const jokerCard = { id: "c-jk", suit: "J", rank: "Joker", value: 0 };
    const htmlDesktop = renderToString(
      React.createElement(CardView, {
        card: jokerCard,
        compact: false,
      })

    );
    expect(htmlDesktop).toContain("★");
    expect(htmlDesktop).toContain("JK");

    const htmlCompact = renderToString(
      React.createElement(CardView, {
        card: jokerCard,
        compact: true,
      })
    );
    expect(htmlCompact).toContain("★");
    expect(htmlCompact).toContain("JK");
  });

  // 7. フォントアセット存在検証
  it("7: suit-regular.woff フォントファイルが assets/fonts に存在し、ファイルサイズが正常であること", () => {
    const fontPath = path.resolve(__dirname, "../../assets/fonts/suit-regular.woff");
    expect(fs.existsSync(fontPath)).toBe(true);
    const stats = fs.statSync(fontPath);
    expect(stats.size).toBe(1652);
  });

  // 8. 4スートすべての包括的タイポグラフィ・カラー検証 (BP-SIM-SCENARIO-1.3-R4)
  it("8: (BP-SIM-SCENARIO-1.3-R4) 4スートすべて (♠, ♣, ♥, ♦) が CardView において公式Webフォント class (bp-card-suit) を持ち、赤スート (♥, ♦) のみ ActionList 赤 (#a22041 / bp-card-suit-red) が適用され、サイズが数字より大きく分離されていること", () => {
    const testCases = [
      { suit: "S", expectedSymbol: "♠", isRed: false },
      { suit: "C", expectedSymbol: "♣", isRed: false },
      { suit: "H", expectedSymbol: "♥", isRed: true },
      { suit: "D", expectedSymbol: "♦", isRed: true },
    ];

    for (const tc of testCases) {
      // Desktop
      const htmlDesktop = renderToString(
        React.createElement(CardView, {
          card: { id: `c-${tc.suit}`, suit: tc.suit, rank: "10", value: 10 },
          compact: false,
        })
      );
      expect(htmlDesktop).toContain("bp-card-suit");
      expect(htmlDesktop).toContain("text-[22px]");
      expect(htmlDesktop).toContain("bp-card-rank");
      expect(htmlDesktop).toContain("text-[13px]");
      expect(htmlDesktop).toContain(tc.expectedSymbol);
      expect(htmlDesktop).not.toContain("\uFE0F");
      if (tc.isRed) {
        expect(htmlDesktop).toContain("bp-card-suit-red");
        expect(htmlDesktop).toContain("text-[#a22041]");
      } else {
        expect(htmlDesktop).not.toContain("bp-card-suit-red");
      }

      // Mobile Compact
      const htmlCompact = renderToString(
        React.createElement(CardView, {
          card: { id: `c-${tc.suit}-compact`, suit: tc.suit, rank: "10", value: 10 },
          compact: true,
        })
      );
      expect(htmlCompact).toContain("bp-card-suit");
      expect(htmlCompact).toContain("text-[18px]");
      expect(htmlCompact).toContain("bp-card-rank");
      expect(htmlCompact).toContain("text-[13px]");
      expect(htmlCompact).toContain(tc.expectedSymbol);
      expect(htmlCompact).not.toContain("\uFE0F");
      if (tc.isRed) {
        expect(htmlCompact).toContain("bp-card-suit-red");
        expect(htmlCompact).toContain("text-[#a22041]");
      } else {
        expect(htmlCompact).not.toContain("bp-card-suit-red");
      }
    }
  });

  // 9. CSS Layer & Display Override 防止検証 (BP-SIM-UI-1.4-MATCH-SETUP-SUIT-FIX)
  it("9: (BP-SIM-UI-1.4-MATCH-SETUP-SUIT-FIX) index.css の .bp-card-suit が @layer components 内に定義され、display: inline-block 等のレイアウトプロパティを持たず、Tailwindの .hidden を妨げないこと", () => {
    const cssPath = path.resolve(__dirname, "../../index.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // @layer components 内に配置されていること
    expect(cssContent).toMatch(/@layer\s+components\s*\{[\s\S]*\.bp-card-suit[\s\S]*\}/);

    // .bp-card-suit 自体に display: inline-block 等が指定されていないこと（.hidden を override しない）
    const suitBlockMatch = cssContent.match(/\.bp-card-suit\s*\{([^}]*)\}/);
    expect(suitBlockMatch).not.toBeNull();
    const suitBlockContent = suitBlockMatch![1];
    expect(suitBlockContent).not.toContain("display");
    expect(suitBlockContent).not.toContain("inline-block");

    // compact={true} 時にデスクトップ用の suit コンテナが非表示 (hidden) になり、重複表示されないこと
    const htmlCompact = renderToString(
      React.createElement(CardView, {
        card: { id: "c-test-compact", suit: "S", rank: "9", value: 9 },
        compact: true,
      })
    );
    // compact表示では desktop 側の "hidden sm:block" は生成されず "hidden" となり、
    // かつ .bp-card-suit に display が無いため .hidden (display: none) がブラウザで正常に機能する
    expect(htmlCompact).toContain("hidden");
    expect(htmlCompact).not.toContain("hidden sm:block");
  });

  // 10. UnitCard battle relation: Legacy Sequential badge への fallback 廃止検証 (BP-SIM-UI-1.5-R1-HUMAN-IDENTITY-CLOSURE)
  it("10: (BP-SIM-UI-1.5-R1-HUMAN-IDENTITY-CLOSURE) UnitCard の battle relation で humanLabel が存在しない場合でも targetBadge / blockedByBadges の丸数字へ fallback せず、generic 表示で fail closed すること", () => {
    // 10.1: アタッカーで blockedByHumanLabels なし・blockedByBadges ありの場合
    const attackerUnit = {
      unitId: "u-atk",
      kind: "一般兵",
      state: "charge",
      face: "up",
      cards: [{ suit: "S", rank: "10" }],
    };
    const attackerBattleInfo: any = {
      unitId: "u-atk",
      role: "attacker",
      badge: "①",
      label: "① ♠10 一般兵",
      blockedByHumanLabels: [],
      blockedByBadges: ["②", "③"],
    };

    const htmlAttacker = renderToString(
      React.createElement(UnitCard, {
        unit: attackerUnit,
        battleDisplayInfo: attackerBattleInfo,
      })
    );
    // 丸数字への fallback は行われず、generic 表示となる
    expect(htmlAttacker).toContain("ATTACK 攻撃中");
    expect(htmlAttacker).toContain("ATK 攻撃中");
    expect(htmlAttacker).not.toContain("②");
    expect(htmlAttacker).not.toContain("③");

    // 10.2: ブロッカーで targetHumanLabel なし・targetBadge ありの場合
    const blockerUnit = {
      unitId: "u-blk",
      kind: "一般兵",
      state: "charge",
      face: "up",
      cards: [{ suit: "C", rank: "2" }],
    };
    const blockerBattleInfo: any = {
      unitId: "u-blk",
      role: "blocker",
      badge: "②",
      label: "② ♣2 一般兵",
      targetBadge: "①",
    };

    const htmlBlocker = renderToString(
      React.createElement(UnitCard, {
        unit: blockerUnit,
        battleDisplayInfo: blockerBattleInfo,
      })
    );
    // 丸数字への fallback は行われず、generic 表示となる
    expect(htmlBlocker).toContain("BLOCK 防御中");
    expect(htmlBlocker).toContain("BLK 防御中");
    expect(htmlBlocker).not.toContain("①");

    // 10.3: humanLabel が正常に存在する場合は RichCardText 経由で公式スートとともに表示されること
    const validBlockerBattleInfo: any = {
      unitId: "u-blk",
      role: "blocker",
      badge: "②",
      label: "② ♣2 一般兵",
      targetHumanLabel: "一般兵 ♠10",
      targetBadge: "①",
    };
    const htmlValidBlocker = renderToString(
      React.createElement(UnitCard, {
        unit: blockerUnit,
        battleDisplayInfo: validBlockerBattleInfo,
      })
    );
    expect(htmlValidBlocker).toContain("一般兵");
    expect(htmlValidBlocker).toContain("bp-card-suit");
    expect(htmlValidBlocker).toContain("♠");
    expect(htmlValidBlocker).toContain("10");
    expect(htmlValidBlocker).not.toContain("①");
  });
});
