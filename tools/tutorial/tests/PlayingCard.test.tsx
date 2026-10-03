import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PlayingCard } from "../src/components/PlayingCard";
import { ruleCatalog } from "../src/lib/rule-display";
import "../src/book.css";

it.each([["H7", "7", "♥", "red-suit"], ["D8", "8", "♦", "red-suit"],
  ["S2", "2", "♠", "black-suit"], ["C6", "6", "♣", "black-suit"],
  ["SA", "A", "♠", "black-suit"], ["HJ", "J", "♥", "red-suit"],
  ["DQ", "Q", "♦", "red-suit"], ["CK", "K", "♣", "black-suit"], ["D10", "10", "♦", "red-suit"]])(
  "%sは中央のrank/suitを1組だけ、赤黒と記号の両方で示す", (code, rank, suit, color) => {
    const { container } = render(<PlayingCard code={code} />);
    expect(screen.getByRole("img", { name: `${suit}${rank} 縦向き` })).toBeVisible();
    expect(container.querySelectorAll(".card-rank")).toHaveLength(1);
    expect(container.querySelectorAll(".card-suit")).toHaveLength(1);
    expect(container.querySelector(".card-rank")).toHaveTextContent(rank);
    expect(container.querySelector(".card-suit")).toHaveTextContent(suit);
    expect(container.querySelector(".card-face")).toHaveClass(color);
    expect(getComputedStyle(container.querySelector(".card-face")!).color).toBe(color === "red-suit" ? "rgb(185, 28, 28)" : "rgb(24, 24, 27)");
  },
);
it("裏面はrank/suitを描画せず、driveはカード全体を回転する", () => {
  const view = render(<PlayingCard code="H7" face="down" state="drive" />);
  expect(screen.getByRole("img", { name: "裏向きカード 横向き" })).toHaveTextContent("BP");
  expect(document.querySelector(".card-rank")).toBeNull();
  expect(document.querySelector(".card-suit")).toBeNull();
  expect(getComputedStyle(document.querySelector(".playing-card")!).transform).toBe("rotate(90deg)");
  view.rerender(<PlayingCard code="H7" face="up" state="drive" />);
  expect(screen.getByRole("img", { name: "♥7 横向き" })).toBeVisible();
  expect(document.querySelectorAll(".card-rank")).toHaveLength(1);
});
it("表示用ルールカタログにも旧スート表記を残さない", () => {
  expect(JSON.stringify(ruleCatalog)).not.toMatch(/[♡♢]/);
});
