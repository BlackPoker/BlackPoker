import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { ScenarioHandSetupPanel } from "../../ui/playtest/ScenarioHandSetupPanel";
import {
  STANDARD_54_DECK_CARDS,
  SimulatorDeckProfile,
} from "../../engine/regulation/SimulatorDeckProfileResolver";

describe("ScenarioHandSetupPanel UI Component Tests [BP-SIM-PRO-STRATEGY-PHASE-2]", () => {
  const standardProfile: SimulatorDeckProfile = {
    id: "standard54",
    name: "Standard 54-Card Deck",
    cardCount: 54,
    cards: STANDARD_54_DECK_CARDS,
    defaultRareCardSelections: [{ suit: "J", rank: "Joker", occurrence: 0 }],
  };

  it("renders candidates grouped by suit with min-h-[44px] touch targets", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ScenarioHandSetupPanel
          deckProfile={standardProfile}
          scenarioHandCount={3}
          matchMode="humanVsHuman"
          confirmedSelections={{}}
          onConfirmSelections={vi.fn()}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    const panel = root.findByProps({ "data-testid": "scenario-setup-panel" });
    expect(panel).toBeDefined();

    const textContent = JSON.stringify(renderer!.toJSON());
    expect(textContent).toContain("スペード (♠)");
    expect(textContent).toContain("ハート (♥)");
    expect(textContent).toContain("ダイヤ (♦)");
    expect(textContent).toContain("クラブ (♣)");
    expect(textContent).toContain("ジョーカー (★)");

    const cardButtons = root.findAll(
      (node) =>
        node.type === "button" &&
        node.props["aria-label"] !== undefined &&
        typeof node.props.className === "string" &&
        node.props.className.includes("min-h-[44px]")
    );
    expect(cardButtons.length).toBe(54);
  });

  it("selection contract: 0, 1, 2 cards disable confirm; 3 cards enable confirm; 4th card cannot be added; re-tapping deselects", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ScenarioHandSetupPanel
          deckProfile={standardProfile}
          scenarioHandCount={3}
          matchMode="humanVsHuman"
          confirmedSelections={{}}
          onConfirmSelections={vi.fn()}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    const confirmButton = root.findByProps({ "data-testid": "confirm-scenario-button" });
    expect(confirmButton.props.disabled).toBe(true);

    const spadeAce = root.findByProps({ "aria-label": "♠A" });
    const heartKing = root.findByProps({ "aria-label": "♥K" });
    const diamondQueen = root.findByProps({ "aria-label": "♦Q" });
    const clubJack = root.findByProps({ "aria-label": "♣J" });

    // 1 card selected -> disabled
    act(() => {
      spadeAce.props.onClick();
    });
    expect(confirmButton.props.disabled).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).toContain("選択中: 1 / 3 枚");

    // 2 cards selected -> disabled
    act(() => {
      heartKing.props.onClick();
    });
    expect(confirmButton.props.disabled).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).toContain("選択中: 2 / 3 枚");

    // 3 cards selected -> enabled!
    act(() => {
      diamondQueen.props.onClick();
    });
    expect(confirmButton.props.disabled).toBe(false);
    expect(JSON.stringify(renderer!.toJSON())).toContain("選択中: 3 / 3 枚");

    // 4th card tapped -> ignored (still 3 cards)
    act(() => {
      clubJack.props.onClick();
    });
    expect(confirmButton.props.disabled).toBe(false);
    expect(JSON.stringify(renderer!.toJSON())).toContain("選択中: 3 / 3 枚");

    // Re-tapping selected card deselects it -> back to 2 cards, disabled
    act(() => {
      heartKing.props.onClick();
    });
    expect(confirmButton.props.disabled).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).toContain("選択中: 2 / 3 枚");
  });

  it("Joker occurrence: Joker #1 and Joker #2 are treated as distinct selectable cards", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ScenarioHandSetupPanel
          deckProfile={standardProfile}
          scenarioHandCount={3}
          matchMode="humanVsHuman"
          confirmedSelections={{}}
          onConfirmSelections={vi.fn()}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    const joker1 = root.findByProps({ "aria-label": "Joker" });
    const joker2 = root.findByProps({ "aria-label": "Joker (#2)" });
    const spadeAce = root.findByProps({ "aria-label": "♠A" });

    // Select Joker #1, Joker #2, and ♠A together
    act(() => {
      joker1.props.onClick();
      joker2.props.onClick();
      spadeAce.props.onClick();
    });

    const confirmButton = root.findByProps({ "data-testid": "confirm-scenario-button" });
    expect(confirmButton.props.disabled).toBe(false);
    expect(JSON.stringify(renderer!.toJSON())).toContain("選択中: 3 / 3 枚");
  });

  it("Human vs Human: sequential selection with strict privacy during handoff and completion", () => {
    const handleConfirm = vi.fn();
    const handleReset = vi.fn();

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ScenarioHandSetupPanel
          deckProfile={standardProfile}
          scenarioHandCount={3}
          matchMode="humanVsHuman"
          confirmedSelections={{}}
          onConfirmSelections={handleConfirm}
          onResetSelections={handleReset}
        />
      );
    });

    const root = renderer!.root;

    // 1. Player A selects ♠A, ♥K, ♦Q
    expect(JSON.stringify(renderer!.toJSON())).toContain("Player A: シナリオ手札選択 (1/2)");
    const spadeAce = root.findByProps({ "aria-label": "♠A" });
    const heartKing = root.findByProps({ "aria-label": "♥K" });
    const diamondQueen = root.findByProps({ "aria-label": "♦Q" });

    act(() => {
      spadeAce.props.onClick();
      heartKing.props.onClick();
      diamondQueen.props.onClick();
    });

    const confirmButton = root.findByProps({ "data-testid": "confirm-scenario-button" });
    act(() => {
      confirmButton.props.onClick();
    });

    // 2. Handoff Screen: strict privacy check
    const handoff = root.findByProps({ "data-testid": "scenario-setup-handoff" });
    expect(handoff).toBeDefined();

    const handoffText = JSON.stringify(renderer!.toJSON());
    expect(handoffText).toContain("Player B に画面を渡してください");
    expect(handoffText).toContain("Player A のシナリオ手札は保護されました");

    // CRITICAL: Player A's chosen cards MUST NOT be present anywhere in the handoff DOM
    expect(handoffText).not.toContain("♠A");
    expect(handoffText).not.toContain("♥K");
    expect(handoffText).not.toContain("♦Q");
    expect(handoffText).not.toContain("S-A");
    expect(handoffText).not.toContain("H-K");
    expect(handoffText).not.toContain("D-Q");

    // 3. Proceed to Player B
    const proceedButton = root.findByProps({ "data-testid": "proceed-p2-scenario-button" });
    act(() => {
      proceedButton.props.onClick();
    });

    expect(JSON.stringify(renderer!.toJSON())).toContain("Player B: シナリオ手札選択 (2/2)");

    // CRITICAL: Player B's view MUST NOT contain Player A's chosen card identities as selected
    const p2Text = JSON.stringify(renderer!.toJSON());
    expect(p2Text).toContain("選択中: 0 / 3 枚");

    // Player B selects ♣A, ♣K, ♣Q
    const clubAce = root.findByProps({ "aria-label": "♣A" });
    const clubKing = root.findByProps({ "aria-label": "♣K" });
    const clubQueen = root.findByProps({ "aria-label": "♣Q" });

    act(() => {
      clubAce.props.onClick();
      clubKing.props.onClick();
      clubQueen.props.onClick();
    });

    const confirmP2Button = root.findByProps({ "data-testid": "confirm-scenario-button" });
    act(() => {
      confirmP2Button.props.onClick();
    });

    // Verify callback payload
    expect(handleConfirm).toHaveBeenCalledWith({
      p1: [
        { suit: "S", rank: "A", occurrence: 0 },
        { suit: "H", rank: "K", occurrence: 0 },
        { suit: "D", rank: "Q", occurrence: 0 },
      ],
      p2: [
        { suit: "C", rank: "A", occurrence: 0 },
        { suit: "C", rank: "K", occurrence: 0 },
        { suit: "C", rank: "Q", occurrence: 0 },
      ],
    });
  });

  it("completed view strictly preserves privacy: shows only 選択済み (3枚), never reveals card identity", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ScenarioHandSetupPanel
          deckProfile={standardProfile}
          scenarioHandCount={3}
          matchMode="humanVsHuman"
          confirmedSelections={{
            p1: [
              { suit: "S", rank: "A", occurrence: 0 },
              { suit: "H", rank: "K", occurrence: 0 },
              { suit: "D", rank: "Q", occurrence: 0 },
            ],
            p2: [
              { suit: "C", rank: "A", occurrence: 0 },
              { suit: "C", rank: "K", occurrence: 0 },
              { suit: "C", rank: "Q", occurrence: 0 },
            ],
          }}
          onConfirmSelections={vi.fn()}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    const completed = root.findByProps({ "data-testid": "scenario-setup-completed" });
    expect(completed).toBeDefined();

    const completedText = JSON.stringify(renderer!.toJSON());
    expect(completedText).toContain("シナリオ手札設定完了");
    expect(completedText).toContain("Player A:");
    expect(completedText).toContain("Player B:");
    expect(completedText).toContain("シナリオ手札選択済み");
    expect(completedText).toContain("(3枚)");

    // CRITICAL: Cards MUST NOT be in the completed DOM
    expect(completedText).not.toContain("♠A");
    expect(completedText).not.toContain("♥K");
    expect(completedText).not.toContain("♦Q");
    expect(completedText).not.toContain("♣A");
    expect(completedText).not.toContain("♣K");
    expect(completedText).not.toContain("♣Q");
  });

  it("Human vs AI: Human selects 3 cards, AI is shown as 自動選択（非公開）", () => {
    const handleConfirm = vi.fn();

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ScenarioHandSetupPanel
          deckProfile={standardProfile}
          scenarioHandCount={3}
          matchMode="humanVsAi"
          confirmedSelections={{}}
          onConfirmSelections={handleConfirm}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("シナリオ手札選択 (Player)");
    expect(text).toContain("AI: 自動選択");

    const spadeAce = root.findByProps({ "aria-label": "♠A" });
    const heartKing = root.findByProps({ "aria-label": "♥K" });
    const diamondQueen = root.findByProps({ "aria-label": "♦Q" });

    act(() => {
      spadeAce.props.onClick();
      heartKing.props.onClick();
      diamondQueen.props.onClick();
    });

    const confirmButton = root.findByProps({ "data-testid": "confirm-scenario-button" });
    act(() => {
      confirmButton.props.onClick();
    });

    // In Human vs AI, only p1 is confirmed by the UI (p2 is resolved at match start)
    expect(handleConfirm).toHaveBeenCalledWith({
      p1: [
        { suit: "S", rank: "A", occurrence: 0 },
        { suit: "H", rank: "K", occurrence: 0 },
        { suit: "D", rank: "Q", occurrence: 0 },
      ],
    });
  });
});
