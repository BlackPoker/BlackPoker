import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import {
  EnvironmentOption,
} from "../../engine/playtest/PlaytestEnvironmentController";
import {
  STANDARD_54_DECK_CARDS,
  SimulatorDeckProfile,
} from "../../engine/regulation/SimulatorDeckProfileResolver";

describe("MatchSetupScreen Readiness & Reset Dependency Tests [BP-SIM-PRO-STRATEGY-PHASE-2]", () => {
  const standardProfile: SimulatorDeckProfile = {
    id: "standard54",
    name: "Standard 54-Card Deck",
    cardCount: 54,
    cards: STANDARD_54_DECK_CARDS,
    defaultRareCardSelections: [{ suit: "J", rank: "Joker", occurrence: 0 }],
  };

  const strategyEnvironmentOption: EnvironmentOption = {
    id: "official:pro-strategy-mock",
    name: "プロ + ストラテジー (Mock)",
    isOfficial: true,
    regulationId: "pro-strategy",
    setupRequirements: {
      rareCardCount: 1,
      scenarioHandCount: 3,
    },
  };

  const rarePackEnvironmentOption: EnvironmentOption = {
    id: "official:pro-rarePack-mock",
    name: "プロ + レアパック (Mock)",
    isOfficial: true,
    regulationId: "pro-rarePack",
    setupRequirements: {
      rareCardCount: 1,
      scenarioHandCount: 0,
    },
  };

  const packEnvironmentOption: EnvironmentOption = {
    id: "official:standard-pack-mock",
    name: "スタンダード + パック (Mock)",
    isOfficial: true,
    regulationId: "standard-pack",
    setupRequirements: {
      rareCardCount: 0,
      scenarioHandCount: 0,
    },
  };

  const mockOptions = [strategyEnvironmentOption, rarePackEnvironmentOption, packEnvironmentOption];

  it("Strategy requirements: disabled until both Scenario (3 cards) and Rare (1 card) are ready in H2H", () => {
    const handleStart = vi.fn();

    // 1. Initial State: Neither Scenario nor Rare ready
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MatchSetupScreen
          environmentOptions={mockOptions}
          selectedEnvironmentId="official:pro-strategy-mock"
          onSelectEnvironment={vi.fn()}
          matchMode="humanVsHuman"
          onSelectMatchMode={vi.fn()}
          policyId="firstLegal"
          onSelectPolicyId={vi.fn()}
          seedInput="42"
          onSeedInputChange={vi.fn()}
          deckProfile={standardProfile}
          onStartMatch={handleStart}
          onOpenReplayVerify={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    let startButton = root.findByProps({ "data-testid": "start-match-button" });
    expect(startButton.props.disabled).toBe(true);
    let warningText = root.findByProps({ "data-testid": "setup-warning-text" });
    expect(warningText.props.children).toContain("※シナリオ手札の選択を完了してください");

    // 2. Scenario ready, but Rare not ready
    act(() => {
      renderer.update(
        <MatchSetupScreen
          environmentOptions={mockOptions}
          selectedEnvironmentId="official:pro-strategy-mock"
          onSelectEnvironment={vi.fn()}
          matchMode="humanVsHuman"
          onSelectMatchMode={vi.fn()}
          policyId="firstLegal"
          onSelectPolicyId={vi.fn()}
          seedInput="42"
          onSeedInputChange={vi.fn()}
          deckProfile={standardProfile}
          confirmedScenarioHandSelections={{
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
          onStartMatch={handleStart}
          onOpenReplayVerify={vi.fn()}
        />
      );
    });

    startButton = root.findByProps({ "data-testid": "start-match-button" });
    expect(startButton.props.disabled).toBe(true);
    warningText = root.findByProps({ "data-testid": "setup-warning-text" });
    expect(warningText.props.children).toContain("※レアカードの選択を完了してください");

    // 3. Both Scenario and Rare ready -> Start enabled!
    act(() => {
      renderer.update(
        <MatchSetupScreen
          environmentOptions={mockOptions}
          selectedEnvironmentId="official:pro-strategy-mock"
          onSelectEnvironment={vi.fn()}
          matchMode="humanVsHuman"
          onSelectMatchMode={vi.fn()}
          policyId="firstLegal"
          onSelectPolicyId={vi.fn()}
          seedInput="42"
          onSeedInputChange={vi.fn()}
          deckProfile={standardProfile}
          confirmedScenarioHandSelections={{
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
          confirmedRareCardSelections={{
            p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
            p2: [{ suit: "J", rank: "Joker", occurrence: 1 }],
          }}
          onStartMatch={handleStart}
          onOpenReplayVerify={vi.fn()}
        />
      );
    });

    startButton = root.findByProps({ "data-testid": "start-match-button" });
    expect(startButton.props.disabled).toBe(false);
    expect(root.findAllByProps({ "data-testid": "setup-warning-text" })).toHaveLength(0);
  });

  it("Human vs AI: Human Scenario 3 + Human Rare 1 enables Start (AI is resolved automatically)", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MatchSetupScreen
          environmentOptions={mockOptions}
          selectedEnvironmentId="official:pro-strategy-mock"
          onSelectEnvironment={vi.fn()}
          matchMode="humanVsAi"
          onSelectMatchMode={vi.fn()}
          policyId="firstLegal"
          onSelectPolicyId={vi.fn()}
          seedInput="42"
          onSeedInputChange={vi.fn()}
          deckProfile={standardProfile}
          confirmedScenarioHandSelections={{
            p1: [
              { suit: "S", rank: "A", occurrence: 0 },
              { suit: "H", rank: "K", occurrence: 0 },
              { suit: "D", rank: "Q", occurrence: 0 },
            ],
          }}
          confirmedRareCardSelections={{
            p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
          }}
          onStartMatch={vi.fn()}
          onOpenReplayVerify={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    const startButton = root.findByProps({ "data-testid": "start-match-button" });
    expect(startButton.props.disabled).toBe(false);
  });

  it("Scenario Hand reset triggers Rare Card reset to maintain consistency", () => {
    const handleResetScenario = vi.fn();
    const handleResetRare = vi.fn();

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MatchSetupScreen
          environmentOptions={mockOptions}
          selectedEnvironmentId="official:pro-strategy-mock"
          onSelectEnvironment={vi.fn()}
          matchMode="humanVsHuman"
          onSelectMatchMode={vi.fn()}
          policyId="firstLegal"
          onSelectPolicyId={vi.fn()}
          seedInput="42"
          onSeedInputChange={vi.fn()}
          deckProfile={standardProfile}
          confirmedScenarioHandSelections={{
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
          confirmedRareCardSelections={{
            p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
            p2: [{ suit: "J", rank: "Joker", occurrence: 1 }],
          }}
          onResetScenarioHandSelections={handleResetScenario}
          onResetRareCardSelections={handleResetRare}
          onStartMatch={vi.fn()}
          onOpenReplayVerify={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    // Find the reset button on completed Scenario panel
    const scenarioResetButton = root.findByProps({ "data-testid": "reset-scenario-button" });
    expect(scenarioResetButton).toBeDefined();

    act(() => {
      scenarioResetButton.props.onClick();
    });

    // Both scenario reset and rare reset should be called
    expect(handleResetScenario).toHaveBeenCalledTimes(1);
    expect(handleResetRare).toHaveBeenCalledTimes(1);
  });

  it("Existing environment regression: RarePack requires only Rare (scenarioHandCount = 0)", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MatchSetupScreen
          environmentOptions={mockOptions}
          selectedEnvironmentId="official:pro-rarePack-mock"
          onSelectEnvironment={vi.fn()}
          matchMode="humanVsHuman"
          onSelectMatchMode={vi.fn()}
          policyId="firstLegal"
          onSelectPolicyId={vi.fn()}
          seedInput="42"
          onSeedInputChange={vi.fn()}
          deckProfile={standardProfile}
          confirmedRareCardSelections={{
            p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
            p2: [{ suit: "J", rank: "Joker", occurrence: 1 }],
          }}
          onStartMatch={vi.fn()}
          onOpenReplayVerify={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    // Scenario Hand panel is NOT rendered
    expect(root.findAllByProps({ "data-testid": "scenario-setup-panel" })).toHaveLength(0);
    expect(root.findAllByProps({ "data-testid": "scenario-setup-completed" })).toHaveLength(0);

    const startButton = root.findByProps({ "data-testid": "start-match-button" });
    expect(startButton.props.disabled).toBe(false);
  });

  it("Existing environment regression: Standard Pack requires neither (immediately ready)", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MatchSetupScreen
          environmentOptions={mockOptions}
          selectedEnvironmentId="official:standard-pack-mock"
          onSelectEnvironment={vi.fn()}
          matchMode="humanVsHuman"
          onSelectMatchMode={vi.fn()}
          policyId="firstLegal"
          onSelectPolicyId={vi.fn()}
          seedInput="42"
          onSeedInputChange={vi.fn()}
          deckProfile={standardProfile}
          onStartMatch={vi.fn()}
          onOpenReplayVerify={vi.fn()}
        />
      );
    });

    const root = renderer!.root;
    expect(root.findAllByProps({ "data-testid": "scenario-setup-panel" })).toHaveLength(0);
    expect(root.findAllByProps({ "data-testid": "rare-setup-panel" })).toHaveLength(0);

    const startButton = root.findByProps({ "data-testid": "start-match-button" });
    expect(startButton.props.disabled).toBe(false);
  });
});
