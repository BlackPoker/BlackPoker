import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TutorialBoard } from "../src/components/TutorialBoard";
import scenario from "../src/data/tutorials/entry16.json";
import type { BoardState, Operation, PlayerBoard, TutorialStep } from "../src/types";

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
  it("before盤面のカードから移動先へ直線矢印を表示し、afterでは消す", () => {
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
      const view = render(<TutorialBoard board={before} before={before} after={after}
        operations={[{ player: "A", from: "hand", to: "soldiers", cards: ["C6"], label: "兵士へ" }]}
        applied={false} real={false} stepId="summon" />);
      const route = document.querySelector('line.board-route[data-from="hand"][data-to="soldiers"]');
      if (!route) throw new Error(document.querySelector(".board-overlay")?.outerHTML ?? "overlayなし");
      expect(route).toHaveAttribute("data-source", "card");
      expect(route).toHaveAttribute("x1");
      expect(route).toHaveAttribute("x2");
      view.rerender(<TutorialBoard board={after} before={before} after={after}
        operations={[{ player: "A", from: "hand", to: "soldiers", cards: ["C6"], label: "兵士へ" }]}
        applied real={false} stepId="summon" />);
      expect(document.querySelector(".board-route")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("冒頭のsetupは完成済み盤面とfocusだけを示し、架空の移動を持たない", () => {
    const steps = scenario.steps.filter((step) => ["welcome", "practice-a", "practice-b", "practice-life"].includes(step.id));
    const ready = steps[0].board.before;
    for (const step of steps) {
      expect(step.board.before).toEqual(ready);
      expect(step.board.after).toEqual(ready);
      expect(step.operations).toEqual([]);
    }
    expect(ready.A.soldiers[0].card).toBe("C6");
    expect(ready.B.soldiers[0].card).toBe("H7");
    expect(ready.A.life.length).toBeGreaterThan(0);
    expect(ready.B.life.length).toBeGreaterThan(0);
    const step = steps[1] as unknown as TutorialStep;
    render(<TutorialBoard board={step.board.before} before={step.board.before} after={step.board.after}
      operations={step.operations} applied={false} real={false} stepId={step.id}
      cause={step.cause} focusZones={step.focusZones} />);
    expect(screen.getByTestId("A-soldiers")).toHaveClass("focused-zone");
    expect(screen.getByTestId("A-bulwarks")).toHaveClass("focused-zone");
    expect(document.querySelector(".board-route")).toBeNull();
  });

  it("real-lifeは物理配置ガイドであり、手札からライフへのゲーム操作ではない", () => {
    const step = scenario.steps.find((s) => s.id === "real-life")!;
    expect(step.operations).toEqual([]);
    expect(step.placementGuide).toContain("手札を経由せず");
    expect(scenario.steps.find((s) => s.id === "real-hand")!.operations[0]).toMatchObject({ from: "life", to: "hand" });
  });

  it.each([
    ["summon-cost-l", "life", "grave"],
    ["summon", "hand", "soldiers"],
    ["draw", "life", "hand"],
    ["set-bulwark-place", "hand", "bulwarks"],
    ["direct-damage", "life", "grave"],
  ])("%sの実際のゾーン移動をbeforeで直線予告する", (id, from, to) => {
    const step = scenario.steps.find((s) => s.id === id)! as unknown as TutorialStep;
    render(<TutorialBoard board={step.board.before} before={step.board.before}
      after={step.board.after} operations={step.operations} applied={false}
      real={false} stepId={step.id} cause={step.cause} />);
    const route = document.querySelector(`line.board-route[data-from="${from}"][data-to="${to}"]`);
    expect(route).toBeInTheDocument();
    expect(route).toHaveAttribute("data-source", "card");
    expect(document.querySelector("path.board-route")).toBeNull();
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
