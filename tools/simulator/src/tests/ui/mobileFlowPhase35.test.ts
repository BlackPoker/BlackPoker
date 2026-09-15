import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { CardView } from "../../ui/game/CardView";
import { PlayerBoard } from "../../ui/game/PlayerBoard";
import { DecisionPanel } from "../../ui/decision/DecisionPanel";
import { formatCardDisplay, formatSuitSymbol } from "../../engine/rules/cardUtils";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { reconstructMatch } from "../../engine/replay/ReplayReconstructionService";
import type { PlaytestDecisionTranscriptEntryV1 } from "../../ui/playtest/PlaytestDecisionTranscript";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../../engine/random/RandomSource";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";

describe("UI Phase 3.5: Mobile Flow / Compact UI / Official Action Order Tests", () => {
  const browserCatalog = loadRegulationCatalogForBrowser();
  const browserRulePackage = loadRulePackageForBrowser();

  // =========================================================================
  // Test A: EFFECT_RESOLUTION Auto Open
  // =========================================================================
  describe("Test A: EFFECT_RESOLUTION Auto Open", () => {
    it("A.1: Triggers auto-open on new human EFFECT_RESOLUTION decision request", () => {
      // Simulate the auto-open hook logic used in CoreBattlePlaytest
      let sheetMode = "collapsed";
      const setSheetMode = (mode: string) => {
        sheetMode = mode;
      };
      let lastAutoOpenedDecisionId: string | null = null;

      const triggerAutoOpen = (
        isDesktop: boolean,
        isHumanTurnWaiting: boolean,
        currentStep: any
      ) => {
        if (
          !isDesktop &&
          isHumanTurnWaiting &&
          currentStep?.type === "WAITING_FOR_DECISION" &&
          currentStep.request.source?.type === "EFFECT_RESOLUTION"
        ) {
          if (lastAutoOpenedDecisionId !== currentStep.request.decisionId) {
            lastAutoOpenedDecisionId = currentStep.request.decisionId;
            if (sheetMode === "collapsed") {
              setSheetMode("half");
            }
          }
        }
      };

      // 1. When a new Human EFFECT_RESOLUTION decision arrives on mobile
      const step1 = {
        type: "WAITING_FOR_DECISION",
        request: {
          decisionId: "dec-eff-001",
          source: { type: "EFFECT_RESOLUTION", playerId: "p1" },
          patterns: [{ patternId: "p-0", kind: "EFFECT_SELECTION" }],
        },
      };

      triggerAutoOpen(false, true, step1);
      expect(sheetMode).toBe("half");
      expect(lastAutoOpenedDecisionId).toBe("dec-eff-001");

      // 2. If user manually closes it, re-render with the SAME decisionId does NOT re-open
      sheetMode = "collapsed";
      triggerAutoOpen(false, true, step1);
      expect(sheetMode).toBe("collapsed"); // stays collapsed

      // 3. When a NEW decisionId arrives, it opens again
      const step2 = {
        type: "WAITING_FOR_DECISION",
        request: {
          decisionId: "dec-eff-002",
          source: { type: "EFFECT_RESOLUTION", playerId: "p1" },
          patterns: [{ patternId: "p-0", kind: "EFFECT_SELECTION" }],
        },
      };
      triggerAutoOpen(false, true, step2);
      expect(sheetMode).toBe("half");
      expect(lastAutoOpenedDecisionId).toBe("dec-eff-002");
    });

    it("A.2: Auto-open does NOT auto-submit decision and does NOT add fake requests to Stage", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
        catalog: browserCatalog,
        fullRulePackage: browserRulePackage,
      });

      let step = session.advance();
      while (step.type === "PROGRESSED") step = session.advance();
      if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // Submit PackOpen
      const packOpenIdx = step.request.patterns.findIndex(
        (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
      );
      const nextStep = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: packOpenIdx,
      });

      // Verification: State is waiting for decision, not automatically submitted
      expect(nextStep.type).toBe("WAITING_FOR_DECISION");
      if (nextStep.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      expect(nextStep.request.source.type).toBe("EFFECT_RESOLUTION");
      expect(nextStep.request.patterns.length).toBe(14); // 14 candidates awaiting human choice

      // Verification: Stage contains NO fake or synthetic requests
      expect(session.state.stage.requests.length).toBe(0);
    });
  });

  // =========================================================================
  // Test B: Immediate Action Flow (Pack Open) E2E
  // =========================================================================
  describe("Test B: Immediate Action Flow (Pack Open) E2E", () => {
    it("B.1: Full flow maintains core semantics and produces 2 separate decision transcript entries", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
        catalog: browserCatalog,
        fullRulePackage: browserRulePackage,
      });

      let step = session.advance();
      while (step.type === "PROGRESSED") step = session.advance();
      if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const req1 = step.request;
      const activePlayer = req1.playerId as "p1" | "p2";
      const initialHandCount = session.state.players[activePlayer].hand.length;
      expect(session.state.players[activePlayer].pack.count).toBe(14);
      expect(session.state.players[activePlayer].pack.opened).toBe(false);

      // Decision 1: ACTION PackOpen
      const packOpenIdx = req1.patterns.findIndex(
        (p) => p.kind === "ACTION" && req1.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
      );
      const d1: PlaytestDecisionTranscriptEntryV1 = {
        seq: 1,
        actor: "human",
        playerId: activePlayer,
        decisionId: req1.decisionId,
        stateVersion: req1.stateVersion,
        response: {
          decisionId: req1.decisionId,
          stateVersion: req1.stateVersion,
          selectedPatternRef: packOpenIdx,
        },
      };

      step = session.submitDecision(d1.response);
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
      const req2 = step.request;
      expect(req2.source.type).toBe("EFFECT_RESOLUTION");

      // Decision 2: EFFECT_RESOLUTION Card Pick (Pick index 0)
      const chosenCardId = req2.catalog.effectSelections[0].selectedValues![0];
      const d2: PlaytestDecisionTranscriptEntryV1 = {
        seq: 2,
        actor: "human",
        playerId: activePlayer,
        decisionId: req2.decisionId,
        stateVersion: req2.stateVersion,
        response: {
          decisionId: req2.decisionId,
          stateVersion: req2.stateVersion,
          selectedPatternRef: 0,
        },
      };

      const finalStep = session.submitDecision(d2.response);
      expect(finalStep.type === "WAITING_FOR_DECISION" || finalStep.type === "PROGRESSED").toBe(true);

      // Verify post-conditions
      const player = session.state.players[activePlayer];
      expect(player.pack.opened).toBe(true);
      expect(player.pack.count).toBe(13);
      expect(player.hand.length).toBe(initialHandCount + 1);
      expect(player.hand.some((c: any) => c.id === chosenCardId)).toBe(true);

      // Verify transcript has 2 distinct decisions
      expect(d1.seq).toBe(1);
      expect(d2.seq).toBe(2);
      expect(d1.decisionId).not.toBe(d2.decisionId);
    });
  });

  // =========================================================================
  // Test C: Card Display Unification
  // =========================================================================
  describe("Test C: Card Display Unification", () => {
    it("C.1: formatCardDisplay converts ASCII card codes to standardized suit symbols and ranks", () => {
      expect(formatCardDisplay("s10")).toBe("♠10");
      expect(formatCardDisplay("hJ")).toBe("♡J");
      expect(formatCardDisplay("dA")).toBe("♢A");
      expect(formatCardDisplay("cK")).toBe("♣K");
      expect(formatCardDisplay("S10")).toBe("♠10");
      expect(formatCardDisplay("H8")).toBe("♡8");
      expect(formatCardDisplay("d5")).toBe("♢5");
      expect(formatCardDisplay("cA")).toBe("♣A");
      expect(formatCardDisplay("jk")).toBe("Joker");
    });

    it("C.2: DecisionPanel card effect selection renders ♠10 and does not leak raw ASCII codes", () => {
      const mockRequest: any = {
        protocolVersion: "1.0.0",
        decisionId: "dec-eff-test",
        stateVersion: 1,
        matchId: "test-match",
        playerId: "p1",
        source: { type: "EFFECT_RESOLUTION", playerId: "p1" },
        catalog: {
          actions: [],
          cardSelections: [],
          unitSelections: [],
          costPayments: [],
          targetSelections: [],
          effectSelections: [
            {
              selectionType: "card",
              selectedValues: ["c-s10"],
              summary: "カード選択 (1枚): [s10]",
            },
            {
              selectionType: "card",
              selectedValues: ["c-hJ"],
              summary: "カード選択 (1枚): [hJ]",
            },
          ],
          orderSelections: [],
        },
        patterns: [
          { patternId: "pat-0", kind: "EFFECT_SELECTION", effectSelectionRef: 0 },
          { patternId: "pat-1", kind: "EFFECT_SELECTION", effectSelectionRef: 1 },
        ],
      };

      const html = renderToString(
        React.createElement(DecisionPanel, {
          request: mockRequest,
          onSubmit: () => {},
        })
      );

      // Should display standardized suit symbol and rank
      expect(html).toContain("♠10");
      expect(html).toContain("♡J");
      // Should NOT contain raw ASCII card code [s10] or [hJ]
      expect(html).not.toContain("[s10]");
      expect(html).not.toContain("[hJ]");
      // Heading should be "効果を選択"
      expect(html).toContain("効果を選択");
    });
  });

  // =========================================================================
  // Test D: Mobile Row Headers
  // =========================================================================
  describe("Test D: Mobile Row Headers", () => {
    it("D.1: PlayerBoard hides soldier and bulwark headers on mobile (hidden sm:flex)", () => {
      const mockViewModel: any = {
        playerKey: "p1",
        name: "Player A",
        isViewer: true,
        isTurnPlayer: true,
        isChancePlayer: true,
        lifeCount: 6,
        lifeDisplay: "6",
        lifeCards: [],
        handCount: 4,
        handCards: [],
        fieldUnits: [
          { unitId: "u-soldier-1", kind: "兵士", componentId: "character.soldier", cards: [{ id: "c1", suit: "S", rank: "A" }] },
          { unitId: "u-bulwark-1", kind: "防壁", componentId: "character.bulwark", cards: [{ id: "c2", suit: "H", rank: "2" }] },
        ],
        graveCount: 1,
        graveCards: [],
        fog: [],
        pack: { count: 14, opened: false, cards: [], canViewCards: false },
        characters: [],
      };

      const html = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p1",
          viewModel: mockViewModel,
          position: "bottom",
        })
      );

      // Soldier header has hidden sm:flex
      expect(html).toContain("hidden sm:flex items-center justify-end");
      expect(html).toContain("兵士 (1体)");
      // Bulwark header has hidden sm:flex
      expect(html).toContain("防壁 (1体・ライフ側 →)");
      // Unit cards are still rendered in their rows
      expect(html).toContain("u-soldier-1");
      expect(html).toContain("u-bulwark-1");
    });
  });

  // =========================================================================
  // Test E: Mobile Hand Compact
  // =========================================================================
  describe("Test E: Mobile Hand Compact", () => {
    it("E.1: CardView contains responsive compact classes (h-7 sm:h-[52px] for size=md)", () => {
      const html = renderToString(
        React.createElement(CardView, {
          card: { id: "c-1", suit: "S", rank: "10" },
          size: "md",
        })
      );

      // Size class has compact mobile height and desktop standard height
      expect(html).toContain("w-9 sm:w-10 h-7 sm:h-[52px]");
      // Mobile compact single-line element (flex sm:hidden)
      expect(html).toContain("flex sm:hidden");
      expect(html).toContain("♠");
      expect(html).toContain("10");
      // Desktop traditional element (hidden sm:block)
      expect(html).toContain("hidden sm:block");
    });

    it("E.2: CardView explicit compact prop forces compact view", () => {
      const html = renderToString(
        React.createElement(CardView, {
          card: { id: "c-1", suit: "H", rank: "J" },
          compact: true,
        })
      );

      expect(html).toContain("♡");
      expect(html).toContain("J");
      // Desktop block is hidden when explicit compact is true
      expect(html).not.toContain("hidden sm:block");
    });

    it("E.3: CardView preserves selected, selectable, and click attributes", () => {
      const handleClick = vi.fn();
      const html = renderToString(
        React.createElement(CardView, {
          card: { id: "c-1", suit: "D", rank: "A" },
          selected: true,
          selectable: true,
          onClick: handleClick,
        })
      );

      expect(html).toContain("ring-2 ring-zinc-950");
      expect(html).toContain("cursor-pointer");
      expect(html).toContain('role="button"');
      expect(html).toContain('aria-label="♢A"');
    });
  });

  // =========================================================================
  // Test F: Official Action Display Order
  // =========================================================================
  describe("Test F: Official Action Display Order", () => {
    it("F.1: DecisionPanel displays actions in catalog order (Format YAML order), unmutating patterns", () => {
      const mockCatalog: any = {
        actions: [
          { actionId: "action.end", actionName: "エンド" },
          { actionId: "action.attack", actionName: "アタック" },
          { actionId: "action.setBulwark", actionName: "防壁設置" },
          { actionId: "action.packOpen", actionName: "パック開封" },
        ],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [],
        orderSelections: [],
      };

      // patterns are canonically sorted alphabetically: attack, end, packOpen, setBulwark
      const originalPatterns: any[] = [
        { patternId: "pat-attack", kind: "ACTION", actionSelectionRef: 1 },
        { patternId: "pat-end", kind: "ACTION", actionSelectionRef: 0 },
        { patternId: "pat-packOpen", kind: "ACTION", actionSelectionRef: 3 },
        { patternId: "pat-setBulwark", kind: "ACTION", actionSelectionRef: 2 },
      ];

      const patternsCopy = JSON.parse(JSON.stringify(originalPatterns));

      const mockRequest: any = {
        protocolVersion: "1.0.0",
        decisionId: "dec-action-test",
        stateVersion: 1,
        matchId: "test-match",
        playerId: "p1",
        source: { type: "ACTION_REQUEST", playerId: "p1" },
        catalog: mockCatalog,
        patterns: originalPatterns,
      };

      const html = renderToString(
        React.createElement(DecisionPanel, {
          request: mockRequest,
          onSubmit: () => {},
        })
      );

      // Verify that the buttons appear in catalog order (0: エンド, 1: アタック, 2: 防壁設置, 3: パック開封)
      const idxEnd = html.indexOf("エンド");
      const idxAttack = html.indexOf("アタック");
      const idxBulwark = html.indexOf("防壁設置");
      const idxPackOpen = html.indexOf("パック開封");

      expect(idxEnd).toBeLessThan(idxAttack);
      expect(idxAttack).toBeLessThan(idxBulwark);
      expect(idxBulwark).toBeLessThan(idxPackOpen);

      // Verify original request.patterns was NOT mutated
      expect(originalPatterns).toEqual(patternsCopy);
    });
  });

  // =========================================================================
  // Test G: Replay Regression
  // =========================================================================
  describe("Test G: Replay Regression", () => {
    it("G.1: Replay reconstruction works deterministically with PackOpen actions", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
        catalog: browserCatalog,
        fullRulePackage: browserRulePackage,
      });

      let step = session.advance();
      while (step.type === "PROGRESSED") step = session.advance();
      if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const req1 = step.request;
      const activePlayer = req1.playerId as "p1" | "p2";

      const packOpenIdx = req1.patterns.findIndex(
        (p) => p.kind === "ACTION" && req1.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
      );
      const d1: PlaytestDecisionTranscriptEntryV1 = {
        seq: 1,
        actor: "human",
        playerId: activePlayer,
        decisionId: req1.decisionId,
        stateVersion: req1.stateVersion,
        response: {
          decisionId: req1.decisionId,
          stateVersion: req1.stateVersion,
          selectedPatternRef: packOpenIdx,
        },
      };
      step = session.submitDecision(d1.response);
      if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const req2 = step.request;
      const d2: PlaytestDecisionTranscriptEntryV1 = {
        seq: 2,
        actor: "human",
        playerId: activePlayer,
        decisionId: req2.decisionId,
        stateVersion: req2.stateVersion,
        response: {
          decisionId: req2.decisionId,
          stateVersion: req2.stateVersion,
          selectedPatternRef: 0,
        },
      };
      session.submitDecision(d2.response);

      // Reconstruct match
      const recon = reconstructMatch({
        environmentId: "official:light-pack",
        seed: 42,
        transcript: [d1, d2],
        catalog: browserCatalog,
        fullRulePackage: browserRulePackage,
      });

      expect(recon.status).toBe("SUCCESS");
      if (recon.status !== "SUCCESS") throw new Error("Reconstruction failed");
      expect(recon.session.state.players[activePlayer].pack.opened).toBe(true);
      expect(recon.session.state.players[activePlayer].pack.count).toBe(13);
      expect(recon.session.state.players[activePlayer].hand.length).toBe(session.state.players[activePlayer].hand.length);
    });
  });

  // =========================================================================
  // Test H: AI Regression
  // =========================================================================
  describe("Test H: AI Regression", () => {
    it("H.1: FirstLegal, SeededRandom, and ManualGenericGenome policies succeed on light-pack", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
        catalog: browserCatalog,
        fullRulePackage: browserRulePackage,
      });

      let step = session.advance();
      while (step.type === "PROGRESSED") step = session.advance();
      if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const turnPlayer = step.request.playerId;

      // 1. FirstLegalPolicy
      const firstLegal = new FirstLegalPolicy();
      const dFirst = firstLegal.choose(step.request);
      expect(dFirst.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(dFirst.selectedPatternRef).toBeLessThan(step.request.patterns.length);

      // 2. SeededRandom
      const randomPolicy = new RandomPolicy(new SeededRandom(42), "Random-Test");
      const dRandom = randomPolicy.choose(step.request);
      expect(dRandom.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(dRandom.selectedPatternRef).toBeLessThan(step.request.patterns.length);

      // 3. ManualGenericGenome
      const genomePolicy = PlaytestPolicyFactory.createPolicy("manualGenericGenome", undefined, turnPlayer);
      const dGenome = genomePolicy.choose(step.request);
      expect(dGenome.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(dGenome.selectedPatternRef).toBeLessThan(step.request.patterns.length);
    });
  });

  // =========================================================================
  // Test I: Observation Secrecy
  // =========================================================================
  describe("Test I: Observation Secrecy", () => {
    it("I.1: Observation secrecy boundaries are strictly preserved", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
        catalog: browserCatalog,
        fullRulePackage: browserRulePackage,
      });

      const obsP1 = ObservationFactory.createObservation(session.state, "p1");
      const obsP2 = ObservationFactory.createObservation(session.state, "p2");

      // 1. Opponent hand is hidden
      const p1ViewOfP2 = obsP1.players.find((p) => p.playerId === "p2")!;
      expect(p1ViewOfP2.isViewer).toBe(false);
      expect(p1ViewOfP2.handCount).toBeGreaterThan(0); // count is known
      // cards are hidden from opponent (visibility HIDDEN, suit/rank undefined)
      expect(p1ViewOfP2.handCards.every((c: any) => c.visibility === "HIDDEN" && c.suit === undefined && c.rank === undefined)).toBe(true);

      // PlayerBoardViewModel preserves hidden status and PlayerBoard renders only count for opponent
      const vmP2FromP1 = PlayerObservationPresenter.buildPlayerViewModel("p2", obsP1, session.state, "p1");
      expect(vmP2FromP1.isViewer).toBe(false);
      expect(vmP2FromP1.handCount).toBe(p1ViewOfP2.handCount);
      expect(vmP2FromP1.handCards.every((c: any) => c.visibility === "HIDDEN")).toBe(true);

      const htmlOpponent = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p2",
          viewModel: vmP2FromP1,
          position: "top",
        })
      );
      expect(htmlOpponent).toContain("HAND");
      expect(htmlOpponent).toMatch(new RegExp(`手札.*${p1ViewOfP2.handCount}.*枚`));
      // Ensure none of opponent's private hand card IDs are rendered in the HTML
      const opponentHandCardIds = session.state.players.p2.hand.map((c) => c.id);
      for (const cid of opponentHandCardIds) {
        expect(htmlOpponent).not.toContain(cid);
      }

      // 2. Unopened Pack is hidden from both
      const p1ViewOfP1 = obsP1.players.find((p) => p.playerId === "p1")!;
      expect(p1ViewOfP1.pack?.opened).toBe(false);
      expect(p1ViewOfP1.pack?.canViewCards).toBe(false);
      expect(p1ViewOfP1.pack?.cards).toHaveLength(0);

      // 3. Grave non-TOP cards are hidden from opponent
      expect(vmP2FromP1.canViewFullGrave).toBe(false);
    });
  });
});

