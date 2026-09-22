import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TutorialBoard } from "../src/components/TutorialBoard";
import type { BoardState, PlayerBoard } from "../src/types";

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

describe("TutorialBoardの防壁face表示", () => {
  it("fixedモードでもBoardCard.faceのdownとupをそのまま描画する", () => {
    const board = boardWithFaces("down", "up");
    render(
      <TutorialBoard
        board={board}
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
