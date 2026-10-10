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

describe("MatchSetupScreen Readiness & Reset Dependency Tests [BP-SIM-PRO-STRATEGY-PHASE-2 / R1]", () => {
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

  // =========================================================================
  // 1. Sequential Setup: Scenario未完了時はRare locked、完了時にRare解禁
  // =========================================================================
  describe("Sequential Setup Contract (Scenario Hand -> Rare Card)", () => {
    it("Strategy requirements: Rare panel is locked while Scenario Hand is incomplete, unlocked when ready", () => {
      const handleStart = vi.fn();

      // 1. Initial State: Scenario Hand not ready
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

      // Scenario Hand panel is visible
      expect(root.findAllByProps({ "data-testid": "scenario-setup-panel" })).toHaveLength(1);

      // Rare Card panel is locked (sequential requirement)
      expect(root.findAllByProps({ "data-testid": "rare-setup-locked" })).toHaveLength(1);
      expect(root.findAllByProps({ "data-testid": "rare-setup-panel" })).toHaveLength(0);

      // Start button is disabled
      const startButton = root.findByProps({ "data-testid": "start-match-button" });
      expect(startButton.props.disabled).toBe(true);
      const warningText = root.findByProps({ "data-testid": "setup-warning-text" });
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

      // Scenario Hand completed banner is visible
      expect(root.findAllByProps({ "data-testid": "scenario-setup-completed" })).toHaveLength(1);

      // Rare Card panel is now unlocked and accessible
      expect(root.findAllByProps({ "data-testid": "rare-setup-locked" })).toHaveLength(0);
      expect(root.findAllByProps({ "data-testid": "rare-setup-panel" })).toHaveLength(1);

      // Start button still disabled because Rare Card is not ready yet
      expect(startButton.props.disabled).toBe(true);
      const warningRare = root.findByProps({ "data-testid": "setup-warning-text" });
      expect(warningRare.props.children).toContain("※レアカードの選択を完了してください");

      // 3. Both Scenario and Rare ready -> Start enabled
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

      expect(startButton.props.disabled).toBe(false);
      expect(root.findAllByProps({ "data-testid": "setup-warning-text" })).toHaveLength(0);
    });

    it("Human vs AI: Human Scenario 3 unlocks Rare Card panel, Human Rare 1 enables Start", () => {
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
      // Rare is unlocked because Human Scenario is ready
      expect(root.findAllByProps({ "data-testid": "rare-setup-locked" })).toHaveLength(0);
      expect(root.findAllByProps({ "data-testid": "rare-setup-completed" })).toHaveLength(1);
      const startButton = root.findByProps({ "data-testid": "start-match-button" });
      expect(startButton.props.disabled).toBe(false);
    });
  });

  // =========================================================================
  // 2. Scenario Reset Dependency: Scenario リセット時に Rare もリセットされ再 locked
  // =========================================================================
  describe("Scenario Reset Dependency", () => {
    it("Scenario Hand reset triggers Rare Card reset and returns Rare panel to locked state", () => {
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
      const scenarioResetButton = root.findByProps({ "data-testid": "reset-scenario-button" });
      expect(scenarioResetButton).toBeDefined();

      act(() => {
        scenarioResetButton.props.onClick();
      });

      // Both resets are called
      expect(handleResetScenario).toHaveBeenCalledTimes(1);
      expect(handleResetRare).toHaveBeenCalledTimes(1);

      // Now simulate parent state update (confirmed selections cleared)
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
            confirmedScenarioHandSelections={{}}
            confirmedRareCardSelections={{}}
            onResetScenarioHandSelections={handleResetScenario}
            onResetRareCardSelections={handleResetRare}
            onStartMatch={vi.fn()}
            onOpenReplayVerify={vi.fn()}
          />
        );
      });

      // Rare Card panel is locked again
      expect(root.findAllByProps({ "data-testid": "rare-setup-locked" })).toHaveLength(1);
      expect(root.findAllByProps({ "data-testid": "rare-setup-panel" })).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. Mode Change State Reset & Privacy Disposal (Issue A)
  // =========================================================================
  describe("Mode Change State Reset & Hidden Information Disposal", () => {
    it("H2H Scenario selection in progress is discarded and reset to P1 selecting when mode changes", () => {
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
            onStartMatch={vi.fn()}
            onOpenReplayVerify={vi.fn()}
          />
        );
      });

      const root = renderer!.root;

      // 1. In H2H, P1 selects 3 cards
      const candidateButtons = root.findAllByProps({ "data-testid": "scenario-candidate-card" });
      expect(candidateButtons.length).toBeGreaterThanOrEqual(3);

      act(() => {
        candidateButtons[0].props.onClick();
        candidateButtons[1].props.onClick();
        candidateButtons[2].props.onClick();
      });

      // Confirm P1
      const confirmP1Button = root.findByProps({ "data-testid": "confirm-scenario-button" });
      expect(confirmP1Button.props.disabled).toBe(false);

      act(() => {
        confirmP1Button.props.onClick();
      });

      // Now on handoff screen
      expect(root.findAllByProps({ "data-testid": "scenario-setup-handoff" })).toHaveLength(1);

      // 2. Mode changed to humanVsAi
      act(() => {
        renderer.update(
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
            onStartMatch={vi.fn()}
            onOpenReplayVerify={vi.fn()}
          />
        );
      });

      // Handoff screen must be gone
      expect(root.findAllByProps({ "data-testid": "scenario-setup-handoff" })).toHaveLength(0);

      // 3. Mode changed back to humanVsHuman
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
            onStartMatch={vi.fn()}
            onOpenReplayVerify={vi.fn()}
          />
        );
      });

      // Must be back at Player A selecting (1/2), 0/3 selected, NOT handoff, NOT reusing stale P1 selection
      expect(root.findAllByProps({ "data-testid": "scenario-setup-handoff" })).toHaveLength(0);
      expect(root.findAllByProps({ "data-testid": "scenario-setup-panel" })).toHaveLength(1);
      const freshConfirmButton = root.findByProps({ "data-testid": "confirm-scenario-button" });
      expect(freshConfirmButton.props.disabled).toBe(true); // 0/3 selected -> disabled
    });
  });

  // =========================================================================
  // 4. Existing Environment Regression (RarePack / Pack)
  // =========================================================================
  describe("Existing Environment Regression", () => {
    it("RarePack requires only Rare (scenarioHandCount = 0) and Rare panel is immediately available", () => {
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
      expect(root.findAllByProps({ "data-testid": "rare-setup-locked" })).toHaveLength(0);
      expect(root.findAllByProps({ "data-testid": "rare-setup-completed" })).toHaveLength(1);

      const startButton = root.findByProps({ "data-testid": "start-match-button" });
      expect(startButton.props.disabled).toBe(false);
    });

    it("Standard Pack requires neither (immediately ready)", () => {
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
      expect(root.findAllByProps({ "data-testid": "rare-setup-locked" })).toHaveLength(0);

      const startButton = root.findByProps({ "data-testid": "start-match-button" });
      expect(startButton.props.disabled).toBe(false);
    });
  });
});
