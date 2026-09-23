import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TutorialBoard } from "../src/components/TutorialBoard";
import { routeBetween } from "../src/components/boardRoutes";
import type { BoardState, Operation, PlayerBoard } from "../src/types";

const emptyPlayer = (): PlayerBoard => ({
  hand: [],
  soldiers: [],
  bulwarks: [],
  life: [],
  grave: [],
});

const boardWithFaces = (aFace: "up" | "down", bFace: "up" | "down"): BoardState => ({
  A: {
    ...emptyPlayer(),
    bulwarks: [{ card: "D5", face: aFace, state: "charge" }],
  },
  B: {
    ...emptyPlayer(),
    bulwarks: [{ card: "D8", face: bFace, state: "charge" }],
  },
  turn: "A",
});
const stateBoard = (zone: "hand" | "soldiers", state: "charge" | "drive"): BoardState => ({
  A: { ...emptyPlayer(), [zone]: [{ card: "C6", face: "up", state }] },
  B: emptyPlayer(),
  turn: "A",
});

describe("TutorialBoardの防壁face表示", () => {
  it("fixedモードでもBoardCard.faceのdownとupをそのまま描画する", () => {
    const board = boardWithFaces("down", "up");
    render(
      <TutorialBoard
        board={board}
        before={board}
        after={board}
        operations={[]}
        applied={false}
        real={false}
        stepId="face-test"
      />,
    );

    const playerA = within(screen.getByTestId("A-bulwarks"));
    const playerB = within(screen.getByTestId("B-bulwarks"));
    expect(playerA.getByLabelText("A 防壁の裏向きカード 裏向き 縦向き")).toHaveTextContent("BP");
    expect(playerA.queryByText("♢5")).toBeNull();
    expect(playerB.getByLabelText("B ♢8 表向き 縦向き")).toHaveTextContent("♢8");
  });

  it("scenarioのbefore: downからafter: upへの公開を描画できる", () => {
    const before = boardWithFaces("down", "down");
    const after = boardWithFaces("up", "down");
    const operation = [{
      player: "A" as const,
      from: "bulwarks" as const,
      to: "bulwarks" as const,
      cards: ["D5"],
      label: "防壁を公開",
    }];
    const view = render(
      <TutorialBoard
        board={before}
        before={before}
        after={after}
        operations={operation}
        applied={false}
        real={false}
        stepId="reveal-test"
      />,
    );
    expect(within(screen.getByTestId("A-bulwarks")).getByText("BP")).toBeVisible();

    view.rerender(
      <TutorialBoard
        board={after}
        before={before}
        after={after}
        operations={operation}
        applied
        real={false}
        stepId="reveal-test"
      />,
    );
    expect(within(screen.getByTestId("A-bulwarks")).getByText("♢5")).toBeVisible();
  });
});

describe("固定盤面の変化表示", () => {
  it("ゾーン間operationを実測位置のSVG矢印に変換する", () => {
    const rectangle = (left: number, top: number, right: number, bottom: number) => ({
      left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top,
      toJSON: () => ({}),
    });
    const positions = {
      hand: rectangle(10, 300, 80, 460),
      soldiers: rectangle(90, 300, 220, 375),
      bulwarks: rectangle(90, 385, 220, 460),
      life: rectangle(230, 300, 310, 375),
      grave: rectangle(230, 385, 310, 460),
    };
    expect(routeBetween(positions.hand, positions.soldiers, Object.values(positions),
      { left: 2, top: 294, right: 318, bottom: 498 }, new Set())).not.toBeNull();
    const original = HTMLElement.prototype.getBoundingClientRect;
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("persistent-board")) return rectangle(0, 0, 320, 500);
      if (this.classList.contains("player-A")) return rectangle(0, 250, 320, 500);
      if (this.classList.contains("player-B")) return rectangle(0, 0, 320, 250);
      return positions[this.dataset.zone as keyof typeof positions] ?? original.call(this);
    });
    try {
      const before = stateBoard("hand", "charge");
      const after = stateBoard("soldiers", "charge");
      render(<TutorialBoard board={after} before={before} after={after}
        operations={[{ player: "A", from: "hand", to: "soldiers", cards: ["C6"], label: "兵士へ" }]}
        applied real={false} stepId="summon" />);
      const route = document.querySelector('path.board-route[data-from="hand"][data-to="soldiers"]');
      if (!route) throw new Error(document.querySelector(".board-overlay")?.outerHTML ?? "overlayなし");
      expect(route).toHaveAttribute("d", expect.stringContaining("L"));
    } finally {
      spy.mockRestore();
    }
  });

  it("ゾーン間移動は障害になるゾーンを避けた経路を生成する", () => {
    const hand = { left: 0, top: 0, right: 60, bottom: 100 };
    const middle = { left: 70, top: 0, right: 180, bottom: 45 };
    const soldier = { left: 190, top: 0, right: 250, bottom: 45 };
    const points = routeBetween(hand, soldier, [hand, middle, soldier],
      { left: -6, top: -6, right: 256, bottom: 106 }, new Set());
    expect(points).not.toBeNull();
    expect(points!.length).toBeGreaterThan(1);
    expect(points!.every(({ x, y }) => x <= middle.left - 1 || x >= middle.right + 1 ||
      y <= middle.top - 1 || y >= middle.bottom + 1)).toBe(true);
  });

  it("同一ゾーンの向き変更は回転表示にし、SVG移動矢印を出さない", () => {
    const before = stateBoard("soldiers", "charge");
    const after = stateBoard("soldiers", "drive");
    const operations: Operation[] = [{ player: "A", from: "soldiers", to: "soldiers",
      cards: ["C6"], label: "♣6をドライブ" }];
    render(<TutorialBoard board={after} before={before} after={after} operations={operations}
      applied real={false} stepId="attack" />);
    expect(screen.getByRole("list", { name: "カードの変化" })).toHaveTextContent("♣6：チャージ → ドライブ");
    expect(within(screen.getByTestId("A-soldiers")).getByText(/↻ チャージ → ドライブ/)).toBeVisible();
    expect(document.querySelector(".board-route")).toBeNull();
  });

  it("同じ手札への追加とブロッカー指定には無意味な矢印を引かない", () => {
    const before: BoardState = { A: emptyPlayer(), B: emptyPlayer(), turn: "A" };
    const after = stateBoard("hand", "charge");
    const view = render(<TutorialBoard board={after} before={before} after={after}
      operations={[{ player: "A", from: "hand", to: "hand", cards: ["C6"], label: "手札に追加" }]}
      applied real={false} stepId="setup" />);
    expect(within(screen.getByTestId("A-hand")).getByText("♣6を追加")).toBeVisible();
    expect(document.querySelector(".board-route")).toBeNull();
    view.rerender(<TutorialBoard board={after} before={after} after={after}
      operations={[{ player: "A", from: "hand", to: "hand", cards: ["C6"], label: "♣6でブロック" }]}
      applied real={false} stepId="block" />);
    expect(within(screen.getByTestId("A-hand")).getByText("ブロッカーに指定")).toBeVisible();
    expect(screen.getByRole("list", { name: "カードの変化" })).toHaveTextContent("♣6：ブロッカーに指定");
    expect(document.querySelector(".board-route")).toBeNull();
  });

  it("realモードではSVG overlayを表示しない", () => {
    const board = stateBoard("hand", "charge");
    const view = render(<TutorialBoard board={board} before={board} after={board}
      operations={[]} applied={false} real stepId="real-hand" />);
    expect(document.querySelector("svg.board-overlay")).toBeNull();
    view.rerender(<TutorialBoard board={board} before={board} after={board}
      operations={[]} applied real stepId="real-hand" />);
    expect(document.querySelector("svg.board-overlay")).toBeNull();
  });

  it("ターン交代とカード移動なしを矢印なしの短い表示にする", () => {
    const before = stateBoard("soldiers", "charge");
    const after: BoardState = { ...before, turn: "B" };
    const view = render(<TutorialBoard board={after} before={before} after={after}
      operations={[]} applied real={false} stepId="end"
      cause={{ phase: "resolve", text: "エンドでターン交代" }} />);
    expect(screen.getByLabelText("ターン：PLAYER AからPLAYER Bへ")).toBeVisible();
    expect(document.querySelector(".board-route")).toBeNull();
    view.rerender(<TutorialBoard board={before} before={before} after={before}
      operations={[]} applied real={false} stepId="no-block"
      cause={{ phase: "trigger", text: "ブロッカーなし" }} />);
    expect(document.querySelector(".board-still-label")).toHaveTextContent("カード移動なし");
    expect(document.querySelector(".board-route")).toBeNull();
  });
});
