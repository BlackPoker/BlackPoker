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
  it("1: index.css に .bp-card-glyph が定義され、Serif/明朝系フォントスタックと等幅数字が指定されていること", () => {
    const cssPath = path.resolve(__dirname, "../../index.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    expect(cssContent).toContain(".bp-card-glyph");
    expect(cssContent).toContain("Times New Roman");
    expect(cssContent).toContain("Yu Mincho");
    expect(cssContent).toContain("Hiragino Mincho ProN");
    expect(cssContent).toContain("serif");
    expect(cssContent).toContain("font-variant-numeric: lining-nums tabular-nums");
  });

  // 2. Desktop CardView のタイポグラフィとサイズ検証
  it("2: Desktop CardView で Rank に bp-card-glyph text-[13px] font-bold が適用され、font-mono が除去されていること", () => {
    const html = renderToString(
      React.createElement(CardView, {
        card: { id: "c-1", suit: "S", rank: "10", value: 10 },
        compact: false,
      })
    );

    // Rank element (desktop)
    expect(html).toContain("text-[13px] font-bold bp-card-glyph");
    // Suit element (desktop: text-[17px])
    expect(html).toContain("text-[17px] bp-card-glyph my-auto");
    // Suit symbol
    expect(html).toContain("♠");
    expect(html).toContain("10");

    // Desktop view must NOT use font-mono for card identity
    // (Notice: faceDown might use font-mono, but card view itself shouldn't on rank/suit)
    expect(html).not.toContain("text-[10px] font-mono font-black");
  });

  // 3. Mobile Compact CardView のタイポグラフィとサイズ検証
  it("3: Mobile Compact CardView で 1行表示に bp-card-glyph font-bold text-[13px] が適用されていること", () => {
    const html = renderToString(
      React.createElement(CardView, {
        card: { id: "c-2", suit: "H", rank: "J", value: 11 },
        compact: true,
      })
    );

    expect(html).toContain("bp-card-glyph font-bold text-[13px]");
    expect(html).toContain("♡");
    expect(html).toContain("J");
  });

  // 4. Mobile UnitCard のタイポグラフィとサイズ検証
  it("4: Mobile UnitCard の primaryCard 表示に bp-card-glyph text-[13px] font-bold が適用されていること", () => {
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

    // Mobile card text container
    expect(html).toContain("font-bold text-zinc-950 bp-card-glyph text-[13px]");
    expect(html).toContain("♣K");
  });

  // 5. 絵文字バリエーションセレクター禁止の検証
  it("5: スート記号 (♠, ♡, ♢, ♣) に絵文字バリエーションセレクター (\\uFE0F) が含まれないこと", () => {
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
});
