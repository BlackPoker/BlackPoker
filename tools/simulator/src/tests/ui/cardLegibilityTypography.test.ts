import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import * as fs from "fs";
import * as path from "path";
import { CardView } from "../../ui/game/CardView";
import { UnitCard } from "../../ui/game/UnitCard";
import { formatSuitSymbol, formatCardDisplay } from "../../engine/rules/cardUtils";

describe("Card Legibility & Typography Tests (BP-SIM-SCENARIO-1.3-CARD-LEGIBILITY-PACK-STATE - Scope A)", () => {
  // 1. CSS SSOT 定義の検証
  it("1: index.css に @font-face (BlackPoker Suit) と .bp-card-suit, .bp-card-rank が定義され、Webfont と書体分離が指定されていること", () => {
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
  it("2: Desktop CardView で Rank に bp-card-rank text-[13px] font-bold、Suit に bp-card-suit text-[17px] が適用され、font-mono が除去されていること", () => {
    const html = renderToString(
      React.createElement(CardView, {
        card: { id: "c-1", suit: "S", rank: "10", value: 10 },
        compact: false,
      })
    );

    // Rank element (desktop)
    expect(html).toContain("text-[13px] font-bold bp-card-rank");
    // Suit element (desktop: text-[17px])
    expect(html).toContain("text-[17px] bp-card-suit my-auto");
    // Suit symbol
    expect(html).toContain("♠");
    expect(html).toContain("10");

    // Desktop view must NOT use font-mono for card identity
    // (Notice: faceDown might use font-mono, but card view itself shouldn't on rank/suit)
    expect(html).not.toContain("text-[10px] font-mono font-black");
  });

  // 3. Mobile Compact CardView のタイポグラフィとサイズ検証
  it("3: Mobile Compact CardView で 1行表示に bp-card-suit text-[13px] と bp-card-rank font-bold text-[13px] が分離適用されていること", () => {
    const html = renderToString(
      React.createElement(CardView, {
        card: { id: "c-2", suit: "H", rank: "J", value: 11 },
        compact: true,
      })
    );

    expect(html).toContain("bp-card-suit text-[13px]");
    expect(html).toContain("bp-card-rank font-bold text-[13px]");
    expect(html).toContain("♡");
    expect(html).toContain("J");
  });

  // 4. Mobile UnitCard のタイポグラフィとサイズ検証
  it("4: Mobile UnitCard の primaryCard 表示に bp-card-suit と bp-card-rank が分離適用されていること", () => {
    const unit = {
      unitId: "u-soldier-1",
      kind: "兵士",
      componentId: "character.soldier",
      state: "charge" as const,
      face: "up" as const,
      cards: [{ id: "c-3", suit: "C", rank: "K", value: 13 }],
    };

    const html = renderToString(
      React.createElement(UnitCard, {
        unit,
      })
    );

    // Mobile card text container with separated suit and rank
    expect(html).toContain("bp-card-suit");
    expect(html).toContain("bp-card-rank");
    expect(html).toContain("♣");
    expect(html).toContain("K");
  });

  // 5. 絵文字バリエーションセレクター禁止とシンボルコントラクト維持の検証
  it("5: スート記号 (♠, ♡, ♢, ♣) に絵文字バリエーションセレクター (\\uFE0F) が含まれず、アウトライン表記 (♡, ♢) が維持されていること", () => {
    expect(formatSuitSymbol("S")).toBe("♠");
    expect(formatSuitSymbol("H")).toBe("♡");
    expect(formatSuitSymbol("D")).toBe("♢");
    expect(formatSuitSymbol("C")).toBe("♣");

    // filled 化 (♥, ♦) されていないこと
    expect(formatSuitSymbol("H")).not.toBe("♥");
    expect(formatSuitSymbol("D")).not.toBe("♦");

    const suits = ["S", "H", "D", "C"];
    for (const s of suits) {
      const symbol = formatSuitSymbol(s);
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
});
