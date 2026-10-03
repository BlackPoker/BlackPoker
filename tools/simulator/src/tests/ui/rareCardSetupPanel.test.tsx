import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { RareCardSetupPanel } from "../../ui/playtest/RareCardSetupPanel";
import {
  STANDARD_54_DECK_CARDS,
  SimulatorDeckProfile,
} from "../../engine/regulation/SimulatorDeckProfileResolver";

describe("RareCardSetupPanel UI Component Tests [BP-SIM-REG-5.0-J-RARE-SELECTION]", () => {
  const standardProfile: SimulatorDeckProfile = {
    id: "standard54",
    name: "Standard 54-Card Deck",
    cardCount: 54,
    cards: STANDARD_54_DECK_CARDS,
    defaultRareCardSelections: [{ suit: "J", rank: "Joker", occurrence: 0 }],
  };

  it("renders candidates grouped by suit with min-h-[44px] accessible touch targets", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RareCardSetupPanel
          deckProfile={standardProfile}
          rareCardCount={1}
          matchMode="humanVsHuman"
          confirmedSelections={{}}
          onConfirmSelections={vi.fn()}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    const panel = root.findByProps({ "data-testid": "rare-setup-panel" });
    expect(panel).toBeDefined();

    // Verify suit headers
    const textContent = JSON.stringify(renderer!.toJSON());
    expect(textContent).toContain("スペード (♠)");
    expect(textContent).toContain("ハート (♥)");
    expect(textContent).toContain("ダイヤ (♦)");
    expect(textContent).toContain("クラブ (♣)");
    expect(textContent).toContain("ジョーカー (★)");

    // Verify candidate card buttons have min-h-[44px] touch target class
    const cardButtons = root.findAll(
      (node) =>
        node.type === "button" &&
        node.props["aria-label"] !== undefined &&
        typeof node.props.className === "string" &&
        node.props.className.includes("min-h-[44px]")
    );
    expect(cardButtons.length).toBe(54);
  });

  it("Human vs Human: sequential selection with strict privacy during handoff and completion", () => {
    const handleConfirm = vi.fn();
    const handleReset = vi.fn();

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RareCardSetupPanel
          deckProfile={standardProfile}
          rareCardCount={1}
          matchMode="humanVsHuman"
          confirmedSelections={{}}
          onConfirmSelections={handleConfirm}
          onResetSelections={handleReset}
        />
      );
    });

    const root = renderer!.root;

    // 1. Initial State: Player A selection
    expect(JSON.stringify(renderer!.toJSON())).toContain("Player A: レアカード選択 (1/2)");

    // Confirm button is initially disabled
    const confirmButtonInitial = root.findByProps({ "data-testid": "confirm-rare-button" });
    expect(confirmButtonInitial.props.disabled).toBe(true);

    // Select Spade A (candidate: suit: S, rank: A, occurrence: 0, label: "♠A")
    const spadeAButton = root.findByProps({ "aria-label": "♠A" });
    act(() => {
      spadeAButton.props.onClick();
    });

    // Confirm button is now enabled
    const confirmButtonP1 = root.findByProps({ "data-testid": "confirm-rare-button" });
    expect(confirmButtonP1.props.disabled).toBe(false);

    // Confirm Player A's selection -> transitions to handoff
    act(() => {
      confirmButtonP1.props.onClick();
    });

    // 2. Handoff Screen
    const handoff = root.findByProps({ "data-testid": "rare-setup-handoff" });
    expect(handoff).toBeDefined();
    const handoffText = JSON.stringify(renderer!.toJSON());
    expect(handoffText).toContain("Player B に画面を渡してください");

    // STRICT PRIVACY CONTRACT: P1's card identity ("♠A") MUST NOT be in DOM during handoff!
    expect(handoffText).not.toContain("♠A");

    // Proceed to Player B selection
    const proceedButton = root.findByProps({ "data-testid": "proceed-p2-button" });
    act(() => {
      proceedButton.props.onClick();
    });

    // 3. Player B Selection Screen
    expect(JSON.stringify(renderer!.toJSON())).toContain("Player B: レアカード選択 (2/2)");

    // Select Heart K (label: "♥K")
    const heartKButton = root.findByProps({ "aria-label": "♥K" });
    act(() => {
      heartKButton.props.onClick();
    });

    // Confirm Player B's selection
    const confirmButtonP2 = root.findByProps({ "data-testid": "confirm-rare-button" });
    act(() => {
      confirmButtonP2.props.onClick();
    });

    // Callback should receive both P1 and P2 selections
    expect(handleConfirm).toHaveBeenCalledTimes(1);
    expect(handleConfirm).toHaveBeenCalledWith({
      p1: [{ suit: "S", rank: "A", occurrence: 0 }],
      p2: [{ suit: "H", rank: "K", occurrence: 0 }],
    });
  });

  it("Completed summary view protects hidden information (no card identities leaked in DOM)", () => {
    const handleReset = vi.fn();

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RareCardSetupPanel
          deckProfile={standardProfile}
          rareCardCount={1}
          matchMode="humanVsHuman"
          confirmedSelections={{
            p1: [{ suit: "S", rank: "A", occurrence: 0 }],
            p2: [{ suit: "H", rank: "K", occurrence: 0 }],
          }}
          onConfirmSelections={vi.fn()}
          onResetSelections={handleReset}
        />
      );
    });

    const root = renderer!.root;
    const completed = root.findByProps({ "data-testid": "rare-setup-completed" });
    expect(completed).toBeDefined();

    const summaryText = JSON.stringify(renderer!.toJSON());
    expect(summaryText).toContain("レアカード設定完了");
    expect(summaryText).toContain("Player A:");
    expect(summaryText).toContain("レアカード選択済み");
    expect(summaryText).toContain("Player B:");

    // STRICT PRIVACY CONTRACT: The selected cards MUST NEVER appear in completed summary DOM!
    expect(summaryText).not.toContain("♠A");
    expect(summaryText).not.toContain("♥K");
    expect(summaryText).not.toContain("Joker");

    // Reset button
    const resetButton = root.findByProps({ "data-testid": "reset-rare-button" });
    act(() => {
      resetButton.props.onClick();
    });
    expect(handleReset).toHaveBeenCalledTimes(1);
  });

  it("Human vs AI: Human selects card, AI auto-selection noted, callback receives p1 selection", () => {
    const handleConfirm = vi.fn();

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RareCardSetupPanel
          deckProfile={standardProfile}
          rareCardCount={1}
          matchMode="humanVsAi"
          confirmedSelections={{}}
          onConfirmSelections={handleConfirm}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    const textContent = JSON.stringify(renderer!.toJSON());
    expect(textContent).toContain("レアカード選択 (Player)");
    expect(textContent).toContain("AI: 自動選択");

    // Select Joker (occurrence: 0)
    const jokerButton = root.findByProps({ "aria-label": "Joker" });
    act(() => {
      jokerButton.props.onClick();
    });

    // Confirm selection
    const confirmButton = root.findByProps({ "data-testid": "confirm-rare-button" });
    act(() => {
      confirmButton.props.onClick();
    });

    expect(handleConfirm).toHaveBeenCalledWith({
      p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
    });
  });

  it("Human vs AI: Completed summary view indicates AI auto-selected without leaking card", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RareCardSetupPanel
          deckProfile={standardProfile}
          rareCardCount={1}
          matchMode="humanVsAi"
          confirmedSelections={{
            p1: [{ suit: "D", rank: "Q", occurrence: 0 }],
          }}
          onConfirmSelections={vi.fn()}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    const completed = root.findByProps({ "data-testid": "rare-setup-completed" });
    expect(completed).toBeDefined();
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("Player:");
    expect(text).toContain("レアカード選択済み");
    expect(text).toContain("AI:");
    expect(text).toContain("自動選択（非公開）");
    expect(text).not.toContain("♦Q");
  });
});
