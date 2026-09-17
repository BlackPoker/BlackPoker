import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { GameSession } from "../../engine/session/GameSession";
import type { RulePackage } from "../../domain/rules/RulePackage";
import { buildFieldUnitFromComponent } from "../../engine/rules/commandHandlers";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import {
  enumeratePhysicalCardsInGrave,
  findPhysicalCardInGrave,
  removePhysicalCardFromGrave,
  validateGraveTopInvariant,
} from "../../engine/rules/graveCardUtils";
import { GraveTopCoordinator } from "../../engine/rules/GraveTopCoordinator";
import { MatchLogRecorder } from "../../engine/log/MatchLogRecorder";

describe("Official Regulation: Grave TOP Foundation 1.0 Comprehensive Tests", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let standardFormat: any;
  let standardPackReg: any;
  let standardRulePackage: RulePackage;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    standardFormat = await getFormat("standard");
    standardPackReg = await getRegulation("standard-pack");
    standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg
    );
  });

  // =========================================================================
  // 1. Foundation Invariants 1 - 15 (Section 53)
  // =========================================================================
  describe("Foundation Core Invariants (Rules 1-15)", () => {
    it("Invariant 1: Empty grave has undefined graveTopCardId and undefined Observation", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: { life: [], hand: [], field: [], grave: [], graveTopCardId: undefined },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      validateGraveTopInvariant(state.players.p1);
      expect(state.players.p1.graveTopCardId).toBeUndefined();

      const obsP1 = ObservationFactory.createObservation(state, "p1");
      const p1ViewFromP1 = obsP1.players.find((p) => p.playerId === "p1")!;
      expect(p1ViewFromP1.graveTopCard).toBeUndefined();

      const obsP2 = ObservationFactory.createObservation(state, "p2");
      const p1ViewFromP2 = obsP2.players.find((p) => p.playerId === "p1")!;
      expect(p1ViewFromP2.graveTopCard).toBeUndefined();
    });

    it("Invariant 2: Single raw card move -> auto TOP without decision request", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: { life: [], hand: [], field: [], grave: [], graveTopCardId: undefined },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const card = { id: "c-raw-1", suit: "S", rank: "A", value: 1 };
      GraveTopCoordinator.addCardToGrave(state.players.p1, card, state, "p1");

      expect(state.players.p1.graveTopCardId).toBe("c-raw-1");
      expect(state.pendingGraveTopSelections).toBeUndefined();
      validateGraveTopInvariant(state.players.p1);

      const obsP1 = ObservationFactory.createObservation(state, "p1");
      const p1ViewFromP1 = obsP1.players.find((p) => p.playerId === "p1")!;
      expect((p1ViewFromP1.graveTopCard as any).cardInstanceId).toBe("c-raw-1");

      const obsP2 = ObservationFactory.createObservation(state, "p2");
      const p1ViewFromP2 = obsP2.players.find((p) => p.playerId === "p1")!;
      expect((p1ViewFromP2.graveTopCard as any).cardInstanceId).toBe("c-raw-1");
    });

    it("Invariant 3: Single card wrapper move -> auto TOP without decision request", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: { life: [], hand: [], field: [], grave: [], graveTopCardId: undefined },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const card = { id: "c-sol-1", suit: "H", rank: "7", value: 7 };
      const unit = {
        unitId: "u-sol-1",
        component: "character.soldier",
        cards: [card],
      };

      const result = GraveTopCoordinator.addUnitToGrave(state.players.p1, unit, state, "p1");
      expect(result.requiresDecision).toBe(false);
      expect(state.players.p1.graveTopCardId).toBe("c-sol-1");
      expect(state.pendingGraveTopSelections).toBeUndefined();
      validateGraveTopInvariant(state.players.p1);

      const obsP2 = ObservationFactory.createObservation(state, "p2");
      const p1ViewFromP2 = obsP2.players.find((p) => p.playerId === "p1")!;
      expect((p1ViewFromP2.graveTopCard as any).cardInstanceId).toBe("c-sol-1");
    });

    it("Invariant 4 & 5: Multi-card unit move -> undefined TOP, pending decision for Grave Owner", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: { life: [], hand: [], field: [], grave: [], graveTopCardId: undefined },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const cardA = { id: "c-sol-base", suit: "D", rank: "10", value: 10 };
      const cardB = { id: "c-equip", suit: "C", rank: "K", value: 13 };
      const multiUnit = {
        unitId: "u-armed",
        component: "character.soldier",
        cards: [cardA, cardB],
      };

      const result = GraveTopCoordinator.addUnitToGrave(state.players.p1, multiUnit, state, "p1");
      expect(result.requiresDecision).toBe(true);
      expect(result.candidateCardIds).toEqual(["c-sol-base", "c-equip"]);
      expect(state.players.p1.graveTopCardId).toBeUndefined();
      expect(state.pendingGraveTopSelections?.length).toBe(1);

      const pending = state.pendingGraveTopSelections[0];
      expect(pending.playerId).toBe("p1"); // Invariant 5: Owner selection
      expect(pending.candidateCardIds).toEqual(["c-sol-base", "c-equip"]);
      expect(pending.reason).toBe("MULTI_CARD_GRAVE_MOVE");

      validateGraveTopInvariant(state.players.p1, true);
    });

    it("Invariant 6: Batch candidates -> only newly moved batch cards are candidates, existing cards excluded", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            life: [],
            hand: [],
            field: [],
            grave: [
              { id: "c-old-1", suit: "S", rank: "2", value: 2 },
              { id: "c-old-2", suit: "H", rank: "3", value: 3 },
            ],
            graveTopCardId: "c-old-2",
          },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const newUnit = {
        unitId: "u-new",
        cards: [
          { id: "c-batch-1", suit: "C", rank: "4", value: 4 },
          { id: "c-batch-2", suit: "D", rank: "5", value: 5 },
          { id: "c-batch-3", suit: "S", rank: "6", value: 6 },
        ],
      };

      const result = GraveTopCoordinator.addUnitToGrave(state.players.p1, newUnit, state, "p1");
      expect(result.requiresDecision).toBe(true);
      expect(result.candidateCardIds).toEqual(["c-batch-1", "c-batch-2", "c-batch-3"]);
      // Existing cards must NOT be candidates
      expect(result.candidateCardIds).not.toContain("c-old-1");
      expect(result.candidateCardIds).not.toContain("c-old-2");

      expect(state.players.p1.graveTopCardId).toBeUndefined();
      validateGraveTopInvariant(state.players.p1, true);
    });

    it("Invariant 7: Middle card selection -> choosing middle card from candidates sets graveTopCardId", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: { life: [], hand: [], field: [], grave: [], graveTopCardId: undefined },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const cards = [
        { id: "c-1", suit: "S", rank: "A", value: 1 },
        { id: "c-2-mid", suit: "H", rank: "J", value: 11 },
        { id: "c-3", suit: "D", rank: "K", value: 13 },
      ];
      GraveTopCoordinator.addUnitToGrave(state.players.p1, { unitId: "u-1", cards }, state, "p1");

      expect(state.pendingGraveTopSelections?.length).toBe(1);

      // Select middle card
      GraveTopCoordinator.applyGraveTopSelection(state, "p1", "c-2-mid");
      expect(state.players.p1.graveTopCardId).toBe("c-2-mid");
      expect(state.pendingGraveTopSelections?.length).toBe(0);
      validateGraveTopInvariant(state.players.p1);
    });

    it("Invariant 8, 9 & 10: Observation & Opponent Privacy vs Owner Full View", () => {
      const cardA = { id: "c-inner-A", suit: "S", rank: "8", value: 8 };
      const cardB = { id: "c-inner-B", suit: "H", rank: "9", value: 9 };
      const multiUnit = {
        unitId: "u-multi",
        component: "character.soldier",
        cards: [cardA, cardB],
      };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            life: [],
            hand: [],
            field: [],
            grave: [multiUnit],
            graveTopCardId: "c-inner-B",
          },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      // Owner view (p1): can view all physical cards in grave (2 cards)
      const obsP1 = ObservationFactory.createObservation(state, "p1");
      const p1ViewFromP1 = obsP1.players.find((p) => p.playerId === "p1")!;
      expect(p1ViewFromP1.grave.length).toBe(2);
      expect((p1ViewFromP1.graveTopCard as any).cardInstanceId).toBe("c-inner-B");

      // Opponent view (p2)
      const obsP2 = ObservationFactory.createObservation(state, "p2");
      const p1ViewFromP2 = obsP2.players.find((p) => p.playerId === "p1")!;
      // Invariant 8: Top card is exposed
      expect((p1ViewFromP2.graveTopCard as any).cardInstanceId).toBe("c-inner-B");
      // Invariant 9: Opponent sees ONLY the graveTopCard (length 1), non-top cards in wrapper hidden
      expect(p1ViewFromP2.grave.length).toBe(1);
      expect((p1ViewFromP2.grave[0] as any).cardInstanceId).toBe("c-inner-B");
    });

    it("Invariant 11: Non-TOP removal -> TOP unchanged, no decision requested", () => {
      const c1 = { id: "c-1", suit: "S", rank: "A", value: 1 };
      const c2 = { id: "c-2", suit: "H", rank: "2", value: 2 };
      const c3 = { id: "c-top", suit: "D", rank: "3", value: 3 };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            life: [],
            hand: [],
            field: [],
            grave: [c1, c2, c3],
            graveTopCardId: "c-top",
          },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const removedCard = GraveTopCoordinator.removeCardFromGrave(state.players.p1, "c-1", state, "p1");
      expect(removedCard.id).toBe("c-1");
      expect(state.players.p1.graveTopCardId).toBe("c-top");
      expect(state.pendingGraveTopSelections).toBeUndefined();
      validateGraveTopInvariant(state.players.p1);
    });

    it("Invariant 12: TOP removal with 2+ remaining -> undefined TOP, pending decision with ALL remaining cards", () => {
      const c1 = { id: "c-1", suit: "S", rank: "A", value: 1 };
      const c2 = { id: "c-2", suit: "H", rank: "2", value: 2 };
      const cTop = { id: "c-top", suit: "D", rank: "3", value: 3 };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            life: [],
            hand: [],
            field: [],
            grave: [c1, c2, cTop],
            graveTopCardId: "c-top",
          },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const removedCard = GraveTopCoordinator.removeCardFromGrave(state.players.p1, "c-top", state, "p1");
      expect(removedCard.id).toBe("c-top");
      expect(state.players.p1.graveTopCardId).toBeUndefined();
      expect(state.pendingGraveTopSelections?.length).toBe(1);
      expect(state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["c-1", "c-2"]);
      expect(state.pendingGraveTopSelections[0].reason).toBe("TOP_REMOVED");
      validateGraveTopInvariant(state.players.p1, true);
    });

    it("Invariant 13: TOP removal with 1 remaining -> auto-promotes remaining card to TOP without decision", () => {
      const c1 = { id: "c-sole-remaining", suit: "S", rank: "A", value: 1 };
      const cTop = { id: "c-top", suit: "D", rank: "3", value: 3 };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            life: [],
            hand: [],
            field: [],
            grave: [c1, cTop],
            graveTopCardId: "c-top",
          },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const removedCard = GraveTopCoordinator.removeCardFromGrave(state.players.p1, "c-top", state, "p1");
      expect(removedCard.id).toBe("c-top");
      expect(state.players.p1.graveTopCardId).toBe("c-sole-remaining");
      expect(state.pendingGraveTopSelections?.length ?? 0).toBe(0);
      validateGraveTopInvariant(state.players.p1);
    });

    it("Invariant 14: Last removal (0 remaining) -> undefined TOP without decision", () => {
      const cTop = { id: "c-last", suit: "D", rank: "3", value: 3 };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            life: [],
            hand: [],
            field: [],
            grave: [cTop],
            graveTopCardId: "c-last",
          },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const removedCard = GraveTopCoordinator.removeCardFromGrave(state.players.p1, "c-last", state, "p1");
      expect(removedCard.id).toBe("c-last");
      expect(state.players.p1.graveTopCardId).toBeUndefined();
      expect(state.pendingGraveTopSelections?.length ?? 0).toBe(0);
      validateGraveTopInvariant(state.players.p1);
    });

    it("Invariant 15: Fail-closed on duplicate or invalid card IDs", () => {
      // 1. Duplicate card IDs in grave must throw
      const duplicatePlayer: any = {
        life: [],
        hand: [],
        field: [],
        grave: [
          { id: "c-dup", suit: "S", rank: "2", value: 2 },
          { id: "c-dup", suit: "H", rank: "3", value: 3 },
        ],
        graveTopCardId: "c-dup",
      };
      expect(() => validateGraveTopInvariant(duplicatePlayer)).toThrow(/重複したcard\.id/);

      // 2. Applying selection where card is not in candidates must throw
      const stateWithPending: any = {
        stateVersion: 1,
        players: {
          p1: {
            life: [],
            hand: [],
            field: [],
            grave: [
              { id: "c-valid-1", suit: "S", rank: "4", value: 4 },
              { id: "c-valid-2", suit: "D", rank: "5", value: 5 },
              { id: "c-other-preexisting", suit: "C", rank: "2", value: 2 },
            ],
            graveTopCardId: undefined,
          },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
        pendingGraveTopSelections: [
          {
            playerId: "p1",
            candidateCardIds: ["c-valid-1", "c-valid-2"],
            reason: "MULTI_CARD_GRAVE_MOVE",
          },
        ],
      };
      // Card is in grave but NOT in candidates
      expect(() =>
        GraveTopCoordinator.applyGraveTopSelection(stateWithPending, "p1", "c-other-preexisting")
      ).toThrow(/候補に含まれていません/);

      // Card is not in grave at all
      expect(() =>
        GraveTopCoordinator.applyGraveTopSelection(stateWithPending, "p1", "c-nonexistent")
      ).toThrow(/墓地に存在しません/);
    });
  });

  // =========================================================================
  // 2. Damage Batch & Partial Move (Rule 5.4.4)
  // =========================================================================
  describe("Damage Batch Processing & Partial Move (Rule 5.4.4)", () => {
    it("Damage 1: single damage card -> auto TOP", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: { life: [], hand: [], field: [], grave: [], graveTopCardId: undefined },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const dmgCard = { id: "c-dmg-1", suit: "S", rank: "2", value: 2 };
      const res = GraveTopCoordinator.addDamageBatchToGrave(state.players.p1, [dmgCard], state, "p1");
      expect(res.requiresDecision).toBe(false);
      expect(state.players.p1.graveTopCardId).toBe("c-dmg-1");
      validateGraveTopInvariant(state.players.p1);
    });

    it("Damage 3: 3 damage cards -> batch decision with 3 candidates", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: { life: [], hand: [], field: [], grave: [], graveTopCardId: undefined },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const dmgCards = [
        { id: "c-dmg-1", suit: "S", rank: "2", value: 2 },
        { id: "c-dmg-2", suit: "H", rank: "3", value: 3 },
        { id: "c-dmg-3", suit: "D", rank: "4", value: 4 },
      ];
      const res = GraveTopCoordinator.addDamageBatchToGrave(state.players.p1, dmgCards, state, "p1");
      expect(res.requiresDecision).toBe(true);
      expect(res.candidateCardIds).toEqual(["c-dmg-1", "c-dmg-2", "c-dmg-3"]);
      expect(state.players.p1.graveTopCardId).toBeUndefined();
      validateGraveTopInvariant(state.players.p1, true);
    });

    it("Partial damage (Rule 5.4.4): 2 cards moved -> batch decision with 2 candidates", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: { life: [], hand: [], field: [], grave: [], graveTopCardId: undefined },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      // Only 2 cards actually moved
      const movedCards = [
        { id: "c-part-1", suit: "C", rank: "5", value: 5 },
        { id: "c-part-2", suit: "S", rank: "6", value: 6 },
      ];
      const res = GraveTopCoordinator.addDamageBatchToGrave(state.players.p1, movedCards, state, "p1");
      expect(res.requiresDecision).toBe(true);
      expect(res.candidateCardIds).toEqual(["c-part-1", "c-part-2"]);
      validateGraveTopInvariant(state.players.p1, true);
    });

    it("Partial damage (Rule 5.4.4): 1 card moved -> auto TOP", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: { life: [], hand: [], field: [], grave: [], graveTopCardId: undefined },
          p2: { life: [], hand: [], field: [], grave: [] },
        },
      };

      const movedCards = [{ id: "c-single-part", suit: "H", rank: "8", value: 8 }];
      const res = GraveTopCoordinator.addDamageBatchToGrave(state.players.p1, movedCards, state, "p1");
      expect(res.requiresDecision).toBe(false);
      expect(state.players.p1.graveTopCardId).toBe("c-single-part");
      validateGraveTopInvariant(state.players.p1);
    });
  });

  // =========================================================================
  // 3. Immediate Interruption in Effect Execution
  // =========================================================================
  describe("Immediate Post-Command Interruption in EffectInterpreter", () => {
    it("Command moving multi-card unit immediately halts with selectionType zoneTop and resumeNextIndex", () => {
      const registry = new CommandRegistry();
      const interpreter = (registry as any).effectInterpreter as EffectInterpreter;

      const cardA = { id: "c-arm-1", suit: "S", rank: "A", value: 1 };
      const cardB = { id: "c-arm-2", suit: "H", rank: "K", value: 13 };
      const unit = {
        unitId: "u-target",
        component: "character.soldier",
        cards: [cardA, cardB],
      };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: { hand: [], field: [unit], life: [], grave: [] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      let secondCommandExecuted = false;
      registry.register("testSecondCommand", () => {
        secondCommandExecuted = true;
      });

      const effects: any[] = [
        {
          moveToGraveyard: {
            target: "target",
          },
        },
        {
          testSecondCommand: {},
        },
      ];

      const context: CommandContext = {
        state,
        playerKey: "p1",
        targetComponent: unit,
      };

      const result = interpreter.executeEffectsWithInterruption(effects, context);

      // Must immediately halt after step1
      expect((result as any).interrupted).toBe(true);
      expect((result as any).selectionType).toBe("zoneTop");
      expect((result as any).resumeNextIndex).toBe(1);
      // Step 2 must NOT have executed yet
      expect(secondCommandExecuted).toBe(false);
      // Pending grave top selection exists
      expect(state.pendingGraveTopSelections?.length).toBe(1);

      // Apply decision
      GraveTopCoordinator.applyGraveTopSelection(state, "p1", "c-arm-1");
      expect(state.players.p1.graveTopCardId).toBe("c-arm-1");

      // Resume from resumeNextIndex (1)
      const remainingEffects = effects.slice((result as any).resumeNextIndex!);
      const resumeResult = interpreter.executeEffectsWithInterruption(remainingEffects, context);
      expect((resumeResult as any).interrupted).toBeUndefined();
      expect(secondCommandExecuted).toBe(true);
    });
  });

  // =========================================================================
  // 4. Precedence of Pending Decision over Game Finish
  // =========================================================================
  describe("Game Finish Precedence", () => {
    it("Damage taking Life to 0 requires Grave TOP Decision BEFORE Match Finished", () => {
      const card1 = { id: "c-dmg-a", suit: "S", rank: "10", value: 10 };
      const card2 = { id: "c-dmg-b", suit: "H", rank: "J", value: 11 };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: {
            hand: [],
            field: [],
            life: [], // ライフ0
            grave: [card1, card2],
            graveTopCardId: undefined,
          },
        },
        // Pending Grave TOP selection exists for p2
        pendingGraveTopSelections: [
          {
            playerId: "p2",
            candidateCardIds: ["c-dmg-a", "c-dmg-b"],
            reason: "MULTI_CARD_GRAVE_MOVE",
          },
        ],
      };

      const session = new GameSession(state, standardRulePackage);
      const step: any = session.advance();

      // Must return WAITING_FOR_DECISION for Grave TOP before declaring FINISHED
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");
      expect(step.request.playerId).toBe("p2");

      // Resolve the decision
      const choicePat = step.request.patterns.findIndex(
        (p: any) =>
          p.effectSelectionRef !== undefined &&
          step.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes("c-dmg-a")
      );
      expect(choicePat).toBeGreaterThanOrEqual(0);

      const nextStep: any = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: choicePat,
      });

      // After resolving Grave TOP, the game finish transition proceeds
      expect(session.state.players.p2.graveTopCardId).toBe("c-dmg-a");
      expect(nextStep.type).toBe("FINISHED");
      expect((nextStep as any).result?.winner).toBe("p1");
    });
  });

  // =========================================================================
  // 5. Deterministic Replay & Snapshot / Restore
  // =========================================================================
  describe("Deterministic Replay & Snapshot / Restore", () => {
    it("Fresh session deterministic replay reproduces exact matching StateHash", () => {
      const makeInitialState = () => ({
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [],
            field: [],
            life: [{ id: "l1" }],
            grave: [],
            graveTopCardId: undefined,
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
        pendingGraveTopSelections: [
          {
            playerId: "p1",
            candidateCardIds: ["c-replay-1", "c-replay-2", "c-replay-3"],
            reason: "MULTI_CARD_GRAVE_MOVE",
          },
        ],
      });

      const runSession = () => {
        const s = makeInitialState();
        s.players.p1.grave = [
          { id: "c-replay-1", suit: "S", rank: "A", value: 1 },
          { id: "c-replay-2", suit: "H", rank: "K", value: 13 },
          { id: "c-replay-3", suit: "D", rank: "Q", value: 12 },
        ];
        const session = new GameSession(s, standardRulePackage);
        const step1: any = session.advance();
        expect(step1.type).toBe("WAITING_FOR_DECISION");

        const patIndex = step1.request.patterns.findIndex(
          (p: any) =>
            p.effectSelectionRef !== undefined &&
            step1.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes("c-replay-2")
        );
        session.submitDecision({
          decisionId: step1.request.decisionId,
          stateVersion: step1.request.stateVersion,
          selectedPatternRef: patIndex,
        });
        return StateHasher.hash(session.state);
      };

      const hash1 = runSession();
      const hash2 = runSession();
      expect(hash2).toBe(hash1);
    });

    it("Snapshot & restore during ZONE_TOP_SELECTION preserves state and produces matching StateHash", () => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [],
            field: [],
            life: [{ id: "l1" }],
            grave: [
              { id: "c-snap-1", suit: "C", rank: "2", value: 2 },
              { id: "c-snap-2", suit: "C", rank: "3", value: 3 },
            ],
            graveTopCardId: undefined,
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
        pendingGraveTopSelections: [
          {
            playerId: "p1",
            candidateCardIds: ["c-snap-1", "c-snap-2"],
            reason: "MULTI_CARD_GRAVE_MOVE",
          },
        ],
      };

      const session = new GameSession(state, standardRulePackage);
      const step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");

      // Create snapshot
      const snapshot = session.createSnapshot();
      expect(snapshot.snapshotFormatVersion).toBe(1);

      // Restore session
      const restored = GameSession.fromSnapshot(snapshot, standardRulePackage);

      const pat = step.request.patterns.findIndex(
        (p: any) =>
          p.effectSelectionRef !== undefined &&
          step.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes("c-snap-1")
      );

      session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: pat,
      });

      restored.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: pat,
      });

      expect(session.state.players.p1.graveTopCardId).toBe("c-snap-1");
      expect(restored.state.players.p1.graveTopCardId).toBe("c-snap-1");
      expect(StateHasher.hash(restored.state)).toBe(StateHasher.hash(session.state));
    });
  });

  // =========================================================================
  // 6. AI Policy Compatibility & Schema Stability
  // =========================================================================
  describe("AI Policy Compatibility & Feature Schema Stability", () => {
    const makePendingState = () => ({
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [],
          field: [],
          life: [{ id: "l1" }],
          grave: [
            { id: "c-ai-1", suit: "S", rank: "4", value: 4 },
            { id: "c-ai-2", suit: "H", rank: "5", value: 5 },
          ],
          graveTopCardId: undefined,
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      pendingGraveTopSelections: [
        {
          playerId: "p1" as const,
          candidateCardIds: ["c-ai-1", "c-ai-2"],
          reason: "MULTI_CARD_GRAVE_MOVE" as const,
        },
      ],
    });

    it("FirstLegalPolicy handles ZONE_TOP_SELECTION legally", () => {
      const session = new GameSession(makePendingState(), standardRulePackage);
      const step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      const policy = new FirstLegalPolicy();
      const decision = policy.choose(step.request);
      expect(decision.selectedPatternRef).toBeGreaterThanOrEqual(0);

      session.submitDecision(decision);
      expect(session.state.players.p1.graveTopCardId).toBeDefined();
    });

    it("RandomPolicy (seeded) handles ZONE_TOP_SELECTION legally", () => {
      const session = new GameSession(makePendingState(), standardRulePackage);
      const step: any = session.advance();

      const policy = new RandomPolicy(12345);
      const decision = policy.choose(step.request);
      expect(decision.selectedPatternRef).toBeGreaterThanOrEqual(0);

      session.submitDecision(decision);
      expect(session.state.players.p1.graveTopCardId).toBeDefined();
    });

    it("GenomePolicy handles ZONE_TOP_SELECTION legally", () => {
      const session = new GameSession(makePendingState(), standardRulePackage);
      const step: any = session.advance();

      const dna = createManualGenericGenomeDNA();
      const policy = new GenomePolicy(dna);
      const decision = policy.choose(step.request);
      expect(decision.selectedPatternRef).toBeGreaterThanOrEqual(0);

      session.submitDecision(decision);
      expect(session.state.players.p1.graveTopCardId).toBeDefined();
    });

    it("FEATURE_SCHEMA_VERSION = 1 and DNA dimension = 1482 remain strictly intact", () => {
      expect(FEATURE_SCHEMA_VERSION).toBe(1);
      const dna = createManualGenericGenomeDNA();
      expect(dna.patternWeights.length + dna.contextPatternWeights.length).toBe(1482);
    });
  });

  // =========================================================================
  // 7. Canonical Match Log Verification
  // =========================================================================
  describe("Canonical Match Log Verification", () => {
    it("zone.top.changed events recorded accurately for single move, decision, and auto-promotion", () => {
      const logRecorder = new MatchLogRecorder({ matchId: "test-match-log" });
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      // 1. Single card move -> zone.top.changed
      const c1 = { id: "c-log-1", suit: "S", rank: "A", value: 1 };
      GraveTopCoordinator.addCardToGrave(state.players.p1, c1, state, "p1", logRecorder);

      const e1 = (logRecorder as any).events.find((e: any) => e.type === "zone.top.changed");
      expect(e1).toBeDefined();
      expect((e1 as any).cardId).toBe("c-log-1");
      expect((e1 as any).playerId).toBe("p1");

      // 2. Decision resolution -> zone.top.changed
      state.pendingGraveTopSelections = [
        {
          playerId: "p1",
          candidateCardIds: ["c-log-2", "c-log-3"],
          reason: "MULTI_CARD_GRAVE_MOVE",
        },
      ];
      state.players.p1.grave.push(
        { id: "c-log-2", suit: "H", rank: "2", value: 2 },
        { id: "c-log-3", suit: "D", rank: "3", value: 3 }
      );
      GraveTopCoordinator.applyGraveTopSelection(state, "p1", "c-log-3", logRecorder);

      const topEvents = (logRecorder as any).events.filter((e: any) => e.type === "zone.top.changed");
      expect(topEvents.length).toBe(2);
      expect((topEvents[1] as any).cardId).toBe("c-log-3");

      // 3. TOP removal with 1 remaining -> auto-promotes -> zone.top.changed
      // Remove c-log-3, leaving c-log-1 and c-log-2. Remove c-log-2 as well to leave 1 card.
      GraveTopCoordinator.removeCardFromGrave(state.players.p1, "c-log-3", state, "p1", logRecorder);
      // Now c-log-1 and c-log-2 remain (2 cards). Top is undefined pending decision.
      // Resolve top to c-log-2.
      GraveTopCoordinator.applyGraveTopSelection(state, "p1", "c-log-2", logRecorder);
      // Remove c-log-2 -> only c-log-1 remains -> auto-promoted!
      GraveTopCoordinator.removeCardFromGrave(state.players.p1, "c-log-2", state, "p1", logRecorder);

      expect(state.players.p1.graveTopCardId).toBe("c-log-1");
      const lastTopEvent = (logRecorder as any).events[(logRecorder as any).events.length - 1];
      expect(lastTopEvent.type).toBe("zone.top.changed");
      expect((lastTopEvent as any).cardId).toBe("c-log-1");
    });

    it("Opponent cannot see candidate IDs from DecisionRequestedEvent", () => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [],
            field: [],
            life: [{ id: "l1" }],
            grave: [
              { id: "c-priv-1", suit: "S", rank: "2", value: 2 },
              { id: "c-priv-2", suit: "H", rank: "3", value: 3 },
            ],
            graveTopCardId: undefined,
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
        pendingGraveTopSelections: [
          {
            playerId: "p1",
            candidateCardIds: ["c-priv-1", "c-priv-2"],
            reason: "MULTI_CARD_GRAVE_MOVE",
          },
        ],
      };

      const session = new GameSession(state, standardRulePackage);
      const step: any = session.advance();

      // Check log events
      const reqEvent = (session.logRecorder as any).events.find((e: any) => e.type === "decision.requested");
      expect(reqEvent).toBeDefined();
      expect((reqEvent as any).source).toBe("ZONE_TOP_SELECTION");
      // Canonical DecisionRequestedEvent does NOT expose raw candidateCardIds
      expect((reqEvent as any).candidateCardIds).toBeUndefined();
    });
  });

  // =========================================================================
  // 8. Reanimate Multi-Card Integration
  // =========================================================================
  describe("Reanimate Multi-Card Integration with Grave TOP Foundation", () => {
    it("Reanimate extracting card from multi-card wrapper correctly updates wrapper and triggers TOP selection if TOP was removed", () => {
      const cardInside1 = { id: "c-wrap-1", suit: "C", rank: "3", value: 3 };
      const cardInside2 = { id: "c-wrap-2", suit: "D", rank: "7", value: 7 };
      const multiUnit = {
        unitId: "u-in-grave",
        component: "character.soldier",
        cards: [cardInside1, cardInside2],
      };

      const targetCard = { id: "c-field-sol", suit: "D", rank: "5", value: 5 };
      const targetUnit = {
        ...buildFieldUnitFromComponent({
          componentId: "character.soldier",
          playerKey: "p1",
          card: targetCard,
          components: fullRulePackage.components,
        }),
        cards: [targetCard],
      };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [
              { id: "c-s2", suit: "S", rank: "2", value: 2 },
              { id: "c-h3", suit: "H", rank: "3", value: 3 },
            ],
            field: [targetUnit],
            life: [{ id: "l1" }],
            grave: [multiUnit],
            graveTopCardId: "c-wrap-2", // c-wrap-2 is current TOP
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const session = new GameSession(state, standardRulePackage);
      const s1: any = session.advance();
      const reanimatePat = s1.request.patterns.findIndex(
        (p: any) =>
          p.actionSelectionRef !== undefined &&
          s1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
      );
      const s2: any = session.submitDecision({
        decisionId: s1.request.decisionId,
        stateVersion: s1.request.stateVersion,
        selectedPatternRef: reanimatePat,
      });
      const s3: any = session.submitDecision({
        decisionId: s2.request.decisionId,
        stateVersion: s2.request.stateVersion,
        selectedPatternRef: s2.request.patterns.findIndex((p: any) => p.kind === "PASS"),
      });
      const s4: any = session.submitDecision({
        decisionId: s3.request.decisionId,
        stateVersion: s3.request.stateVersion,
        selectedPatternRef: s3.request.patterns.findIndex((p: any) => p.kind === "PASS"),
      });

      // s4 is WAITING_FOR_DECISION for selectCards (choosing card from grave)
      expect(s4.type).toBe("WAITING_FOR_DECISION");
      expect(s4.request.source.effectStepId).toBe("selectCards");

      // Extract c-wrap-2 (the current TOP)
      const extractTopPat = s4.request.patterns.findIndex(
        (p: any) =>
          p.effectSelectionRef !== undefined &&
          s4.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes("c-wrap-2")
      );

      session.submitDecision({
        decisionId: s4.request.decisionId,
        stateVersion: s4.request.stateVersion,
        selectedPatternRef: extractTopPat,
      });

      // After removing c-wrap-2, c-wrap-1 and targetUnit (now in grave) remain
      validateGraveTopInvariant(session.state.players.p1, (session.state.pendingGraveTopSelections?.length ?? 0) > 0);
      expect(session.state.players.p1.field.some((u: any) => u.cards?.some((c: any) => c.id === "c-wrap-2"))).toBe(true);
    });
  });
});
