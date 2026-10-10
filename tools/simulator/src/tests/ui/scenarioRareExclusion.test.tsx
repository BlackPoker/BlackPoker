import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { RareCardSetupPanel } from "../../ui/playtest/RareCardSetupPanel";
import {
  STANDARD_54_DECK_CARDS,
  SimulatorDeckProfile,
} from "../../engine/regulation/SimulatorDeckProfileResolver";

describe("Scenario Hand / Rare Card Mutual Exclusion UI Tests [BP-SIM-PRO-STRATEGY-PHASE-2]", () => {
  const standardProfile: SimulatorDeckProfile = {
    id: "standard54",
    name: "Standard 54-Card Deck",
    cardCount: 54,
    cards: STANDARD_54_DECK_CARDS,
    defaultRareCardSelections: [{ suit: "J", rank: "Joker", occurrence: 0 }],
  };

  it("cards chosen for Scenario Hand are disabled and cannot be selected as Rare Card", () => {
    const p1Scenario = [
      { suit: "S" as const, rank: "A", occurrence: 0 },
      { suit: "H" as const, rank: "K", occurrence: 0 },
      { suit: "J" as const, rank: "Joker", occurrence: 0 }, // Joker #0 chosen in Scenario Hand
    ];

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RareCardSetupPanel
          deckProfile={standardProfile}
          rareCardCount={1}
          matchMode="humanVsAi"
          confirmedSelections={{}}
          excludedSelections={{ p1: p1Scenario }}
          onConfirmSelections={vi.fn()}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;

    // ♠A, ♥K, Joker #0 must be disabled
    const spadeAce = root.findByProps({ "aria-label": "♠A" });
    const heartKing = root.findByProps({ "aria-label": "♥K" });
    const joker1 = root.findByProps({ "aria-label": "Joker" });

    expect(spadeAce.props.disabled).toBe(true);
    expect(spadeAce.props.className).toContain("cursor-not-allowed");
    expect(heartKing.props.disabled).toBe(true);
    expect(joker1.props.disabled).toBe(true);

    // Tapping disabled card does NOT select it
    act(() => {
      spadeAce.props.onClick();
    });

    const confirmButton = root.findByProps({ "data-testid": "confirm-rare-button" });
    expect(confirmButton.props.disabled).toBe(true); // Still 0 cards selected
  });

  it("occurrence distinction: Joker #0 is disabled when in Scenario Hand, but Joker #1 remains selectable", () => {
    const p1Scenario = [
      { suit: "S" as const, rank: "A", occurrence: 0 },
      { suit: "H" as const, rank: "K", occurrence: 0 },
      { suit: "J" as const, rank: "Joker", occurrence: 0 }, // Only Joker #0 in Scenario
    ];

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RareCardSetupPanel
          deckProfile={standardProfile}
          rareCardCount={1}
          matchMode="humanVsAi"
          confirmedSelections={{}}
          excludedSelections={{ p1: p1Scenario }}
          onConfirmSelections={vi.fn()}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;

    const joker1 = root.findByProps({ "aria-label": "Joker" });
    const joker2 = root.findByProps({ "aria-label": "Joker (#2)" });

    // Joker #0 is disabled
    expect(joker1.props.disabled).toBe(true);

    // Joker #1 is NOT disabled -> can be selected!
    expect(joker2.props.disabled).toBe(false);

    act(() => {
      joker2.props.onClick();
    });

    const confirmButton = root.findByProps({ "data-testid": "confirm-rare-button" });
    expect(confirmButton.props.disabled).toBe(false); // 1 card selected!
  });

  it("H2H isolation: Player B's Rare selection only excludes Player B's Scenario Hand, not Player A's", () => {
    const p1Scenario = [
      { suit: "S" as const, rank: "A", occurrence: 0 },
      { suit: "H" as const, rank: "K", occurrence: 0 },
      { suit: "D" as const, rank: "Q", occurrence: 0 },
    ];
    const p2Scenario = [
      { suit: "C" as const, rank: "A", occurrence: 0 },
      { suit: "C" as const, rank: "K", occurrence: 0 },
      { suit: "C" as const, rank: "Q", occurrence: 0 },
    ];

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RareCardSetupPanel
          deckProfile={standardProfile}
          rareCardCount={1}
          matchMode="humanVsHuman"
          confirmedSelections={{}}
          excludedSelections={{ p1: p1Scenario, p2: p2Scenario }}
          onConfirmSelections={vi.fn()}
          onResetSelections={vi.fn()}
        />
      );
    });

    const root = renderer!.root;

    // During P1 selection: ♠A is disabled, but ♣A (P2's scenario) is selectable
    const p1SpadeAce = root.findByProps({ "aria-label": "♠A" });
    const p1ClubAce = root.findByProps({ "aria-label": "♣A" });
    expect(p1SpadeAce.props.disabled).toBe(true);
    expect(p1ClubAce.props.disabled).toBe(false);

    // P1 selects Diamond 2 and proceeds to handoff -> P2
    const diamond2 = root.findByProps({ "aria-label": "♦2" });
    act(() => {
      diamond2.props.onClick();
    });
    const confirmP1 = root.findByProps({ "data-testid": "confirm-rare-button" });
    act(() => {
      confirmP1.props.onClick();
    });

    const proceedP2 = root.findByProps({ "data-testid": "proceed-p2-button" });
    act(() => {
      proceedP2.props.onClick();
    });

    // During P2 selection: ♣A is disabled (P2's scenario), but ♠A is selectable for P2!
    const p2SpadeAce = root.findByProps({ "aria-label": "♠A" });
    const p2ClubAce = root.findByProps({ "aria-label": "♣A" });
    expect(p2ClubAce.props.disabled).toBe(true);
    expect(p2SpadeAce.props.disabled).toBe(false);
  });
});
