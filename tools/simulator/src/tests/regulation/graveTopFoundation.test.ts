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
import { EffectPathCodec } from "../../engine/rules/EffectPathCodec";
import { GameSession } from "../../engine/session/GameSession";
import type { RulePackage, ActionRequest } from "../../domain/rules/RulePackage";
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

  // =========================================================================
  // 9. Grave TOP Foundation 1.0-R1: Final Effect Interruption & Order Hardening
  // =========================================================================
  describe("Grave TOP Foundation 1.0-R1: Final Effect Interruption & Order Hardening", () => {
    it("Test 28: Final top-level effect generates pending Grave TOP selection -> interrupts immediately before Request finalization", () => {
      const registry = new CommandRegistry();
      const logRecorder = new MatchLogRecorder({ matchId: "match-r1-1" });

      const action: any = {
        id: "test.finalEffectInterruption",
        name: "Test Final Effect Interruption",
        type: "magic",
        key: { count: 1 },
        effect: [
          {
            moveToGraveyard: { target: "target" },
          },
        ],
      };

      const keyCard = { id: "k-test-1", suit: "S", rank: "A", value: 1 };
      const request: any = {
        id: "req-final-1",
        actionId: "test.finalEffectInterruption",
        controller: "p1",
        keyCards: [keyCard],
        status: "resolving",
        action,
      };

      const unit = {
        unitId: "u-target-1",
        cards: [
          { id: "c-multi-a", suit: "H", rank: "2", value: 2 },
          { id: "c-multi-b", suit: "D", rank: "3", value: 3 },
        ],
      };

      const state: any = {
        stateVersion: 1,
        matchId: "match-r1-1",
        turnPlayer: "p1",
        stage: {
          requests: [request],
          history: [],
        },
        players: {
          p1: { hand: [], field: [unit], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        targetComponent: unit,
        logRecorder,
      };

      // 最終効果を実行
      const result = registry.resolveRequest(request, context);

      // 1. 即時中断されること (WAITING_FOR_DECISION)
      expect(result.type).toBe("WAITING_FOR_DECISION");
      expect(result.continuation).toBeDefined();
      expect(result.continuation!.effectStepId).toBe("zoneTopSelection");
      expect(result.continuation!.effectPath).toEqual([1]); // resumeNextIndex = effects.length (1)

      // 2. Request は Stage 上に残っていること (pop されていない)
      expect(state.stage.requests.length).toBe(1);
      expect(state.stage.requests[0].id).toBe("req-final-1");

      // 3. Request status は resolving を維持していること (resolved になっていない)
      expect(request.status).toBe("resolving");

      // 4. Key Cards はまだ墓地に送られていないこと
      expect(request.keyCards).toBeDefined();
      expect(request.keyCards!.length).toBe(1);
      const isKeyCardInGrave = state.players.p1.grave.some(
        (entry: any) => entry.id === "k-test-1" || entry.cards?.some((c: any) => c.id === "k-test-1")
      );
      expect(isKeyCardInGrave).toBe(false);

      // 5. request.resolved / stage.popped ログが発行されていないこと
      const resolvedLog = (logRecorder as any).events.find((e: any) => e.type === "request.resolved");
      expect(resolvedLog).toBeUndefined();
      const poppedLog = (logRecorder as any).events.find((e: any) => e.type === "stage.popped");
      expect(poppedLog).toBeUndefined();

      // 6. pendingGraveTopSelections が 1 件存在すること
      expect(state.pendingGraveTopSelections?.length).toBe(1);
      expect(state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["c-multi-a", "c-multi-b"]);
    });

    it("Test 29: Resume from final top-level effect (startIndex === effects.length) executes 0 commands and finalizes exactly once", () => {
      const registry = new CommandRegistry();
      const logRecorder = new MatchLogRecorder({ matchId: "match-r1-2" });

      let commandRunCount = 0;
      registry.register("testCountedCommand", (args, ctx) => {
        commandRunCount++;
        GraveTopCoordinator.addUnitToGrave(ctx.state.players.p1, {
          unitId: "u-cnt",
          cards: [
            { id: "c-cnt-1", suit: "S", rank: "2", value: 2 },
            { id: "c-cnt-2", suit: "H", rank: "3", value: 3 },
          ],
        }, ctx.state, "p1", ctx.logRecorder);
      });

      const action: any = {
        id: "test.countedAction",
        name: "Test Counted Action",
        type: "magic",
        key: { count: 1 },
        effect: [
          {
            testCountedCommand: {},
          },
        ],
      };

      const keyCard = { id: "k-cnt-key", suit: "C", rank: "5", value: 5 };
      const request: any = {
        id: "req-counted-1",
        actionId: "test.countedAction",
        controller: "p1",
        keyCards: [keyCard],
        status: "resolving",
        action,
      };

      const state: any = {
        stateVersion: 1,
        matchId: "match-r1-2",
        turnPlayer: "p1",
        stage: {
          requests: [request],
          history: [],
        },
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        logRecorder,
      };

      // 最初の解決 -> 中断
      const result = registry.resolveRequest(request, context);
      expect(result.type).toBe("WAITING_FOR_DECISION");
      expect(commandRunCount).toBe(1);
      expect(result.continuation!.effectPath).toEqual([1]); // startIndex = effects.length

      // 墓地TOP選択を解決
      GraveTopCoordinator.applyGraveTopSelection(state, "p1", "c-cnt-1", logRecorder);
      expect(state.players.p1.graveTopCardId).toBe("c-cnt-1");
      expect(state.pendingGraveTopSelections?.length ?? 0).toBe(0);

      // 再開実行
      const resumeResult = registry.resumeRequest(
        request,
        result.continuation!,
        ["c-cnt-1"],
        result.context!
      );

      // コマンドは再実行されない (commandRunCount は 1 のまま)
      expect(commandRunCount).toBe(1);

      // 解決完了契約が 1 回のみ実行される
      expect(resumeResult.type).toBe("COMPLETED");
      expect(state.stage.requests.length).toBe(0); // Stage から除去
      expect(state.stage.history.length).toBe(1); // History へ追加
      expect(request.status).toBe("resolved");

      // Key Cards が墓地へ送られている
      const keyInGrave = state.players.p1.grave.some((e: any) => e.id === "k-cnt-key");
      expect(keyInGrave).toBe(true);

      // ログが記録されている
      const resolvedLog = (logRecorder as any).events.find((e: any) => e.type === "request.resolved");
      expect(resolvedLog).toBeDefined();
      const poppedLog = (logRecorder as any).events.find((e: any) => e.type === "stage.popped");
      expect(poppedLog).toBeDefined();
    });

    it("Test 30: Nested branch (ifResult) mid-command pending: cmdA interrupts, cmdB does not run; on resume, cmdB runs once and condition is NOT re-evaluated", () => {
      const registry = new CommandRegistry();
      const logRecorder = new MatchLogRecorder({ matchId: "match-r1-3" });

      let cmdARunCount = 0;
      let cmdBRunCount = 0;

      registry.register("nestCmdA", (args, ctx) => {
        cmdARunCount++;
        GraveTopCoordinator.addUnitToGrave(ctx.state.players.p1, {
          unitId: "u-nest",
          cards: [
            { id: "c-nest-a", suit: "S", rank: "4", value: 4 },
            { id: "c-nest-b", suit: "H", rank: "5", value: 5 },
          ],
        }, ctx.state, "p1", ctx.logRecorder);
      });

      registry.register("nestCmdB", () => {
        cmdBRunCount++;
      });

      const action: any = {
        id: "test.nestedIfResult",
        name: "Test Nested IfResult",
        type: "magic",
        key: { count: 1 },
        effect: [
          {
            ifResult: {
              id: "condResult",
              equals: true,
              then: [
                { nestCmdA: {} },
                { nestCmdB: {} },
              ],
            },
          },
        ],
      };

      const keyCard = { id: "k-nest-key", suit: "D", rank: "9", value: 9 };
      const request: any = {
        id: "req-nest-1",
        actionId: "test.nestedIfResult",
        controller: "p1",
        keyCards: [keyCard],
        status: "resolving",
        action,
      };

      const state: any = {
        stateVersion: 1,
        matchId: "match-r1-3",
        turnPlayer: "p1",
        stage: {
          requests: [request],
          history: [],
        },
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        results: { condResult: true },
        logRecorder,
      };

      // 解決開始
      const result = registry.resolveRequest(request, context);

      // 1. 中断されること
      expect(result.type).toBe("WAITING_FOR_DECISION");
      expect(cmdARunCount).toBe(1);
      // cmdB は実行されていないこと
      expect(cmdBRunCount).toBe(0);

      // 2. effectPath に branch identity (then = 0) と innerIndex (1) が含まれていること
      expect(result.continuation!.effectPath).toEqual([0, 0, 1]);

      // 3. 条件の再評価が行われないことの検証:
      // context.results.condResult を false に改ざんしても、再開時は保存された branch identity (then) を使用
      (result.context as any).results.condResult = false;

      // 墓地TOP選択を解決
      GraveTopCoordinator.applyGraveTopSelection(state, "p1", "c-nest-a", logRecorder);

      // 再開
      const resumeResult = registry.resumeRequest(
        request,
        result.continuation!,
        ["c-nest-a"],
        result.context!
      );

      // 4. 再開後の検証
      expect(resumeResult.type).toBe("COMPLETED");
      // cmdA は再実行されない
      expect(cmdARunCount).toBe(1);
      // cmdB は 1 回だけ実行される
      expect(cmdBRunCount).toBe(1);
      // Request は正常に解決完了
      expect(request.status).toBe("resolved");
      expect(state.stage.requests.length).toBe(0);
    });

    it("Test 31: Nested branch final command pending: inner command causes pending; on resume, advances to next outer command safely", () => {
      const registry = new CommandRegistry();
      const logRecorder = new MatchLogRecorder({ matchId: "match-r1-4" });

      let innerRunCount = 0;
      let outerNextRunCount = 0;

      registry.register("nestInnerFinalCmd", (args, ctx) => {
        innerRunCount++;
        GraveTopCoordinator.addUnitToGrave(ctx.state.players.p1, {
          unitId: "u-fin",
          cards: [
            { id: "c-fin-1", suit: "S", rank: "8", value: 8 },
            { id: "c-fin-2", suit: "D", rank: "9", value: 9 },
          ],
        }, ctx.state, "p1", ctx.logRecorder);
      });

      registry.register("outerNextCmd", () => {
        outerNextRunCount++;
      });

      const action: any = {
        id: "test.nestedFinalCmd",
        name: "Test Nested Final Command",
        type: "magic",
        key: { count: 1 },
        effect: [
          {
            ifResult: {
              id: "cond",
              equals: true,
              then: [
                { nestInnerFinalCmd: {} }, // ブランチ内最後のコマンド
              ],
            },
          },
          {
            outerNextCmd: {}, // トップレベルの次のコマンド
          },
        ],
      };

      const keyCard = { id: "k-fin-key", suit: "H", rank: "7", value: 7 };
      const request: any = {
        id: "req-fin-nest",
        actionId: "test.nestedFinalCmd",
        controller: "p1",
        keyCards: [keyCard],
        status: "resolving",
        action,
      };

      const state: any = {
        stateVersion: 1,
        matchId: "match-r1-4",
        turnPlayer: "p1",
        stage: {
          requests: [request],
          history: [],
        },
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        results: { cond: true },
        logRecorder,
      };

      const result = registry.resolveRequest(request, context);
      expect(result.type).toBe("WAITING_FOR_DECISION");
      expect(innerRunCount).toBe(1);
      expect(outerNextRunCount).toBe(0);

      // ブランチ内最終コマンドで中断したため、再開位置は外側の次インデックス [1]
      expect(result.continuation!.effectPath).toEqual([1]);

      GraveTopCoordinator.applyGraveTopSelection(state, "p1", "c-fin-1", logRecorder);

      const resumeResult = registry.resumeRequest(
        request,
        result.continuation!,
        ["c-fin-1"],
        result.context!
      );

      expect(resumeResult.type).toBe("COMPLETED");
      expect(innerRunCount).toBe(1);
      expect(outerNextRunCount).toBe(1);
      expect(request.status).toBe("resolved");
    });

    it("Test 32: Nested else branch mid-command pending: encodes branchCode: 1 (ELSE) and resumes correctly without re-evaluating condition", () => {
      const registry = new CommandRegistry();
      const logRecorder = new MatchLogRecorder({ matchId: "match-r1-5" });

      let elseCmdARunCount = 0;
      let elseCmdBRunCount = 0;

      registry.register("elseCmdA", (args, ctx) => {
        elseCmdARunCount++;
        GraveTopCoordinator.addUnitToGrave(ctx.state.players.p1, {
          unitId: "u-else",
          cards: [
            { id: "c-else-1", suit: "C", rank: "2", value: 2 },
            { id: "c-else-2", suit: "S", rank: "3", value: 3 },
          ],
        }, ctx.state, "p1", ctx.logRecorder);
      });

      registry.register("elseCmdB", () => {
        elseCmdBRunCount++;
      });

      const action: any = {
        id: "test.elseAction",
        name: "Test Else Action",
        type: "magic",
        key: { count: 1 },
        effect: [
          {
            ifResult: {
              id: "cond",
              equals: true,
              then: [{ elseCmdB: {} }],
              else: [
                { elseCmdA: {} },
                { elseCmdB: {} },
              ],
            },
          },
        ],
      };

      const keyCard = { id: "k-else-key", suit: "S", rank: "10", value: 10 };
      const request: any = {
        id: "req-else-1",
        actionId: "test.elseAction",
        controller: "p1",
        keyCards: [keyCard],
        status: "resolving",
        action,
      };

      const state: any = {
        stateVersion: 1,
        matchId: "match-r1-5",
        turnPlayer: "p1",
        stage: {
          requests: [request],
          history: [],
        },
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        results: { cond: false }, // false -> else ブランチを実行
        logRecorder,
      };

      const result = registry.resolveRequest(request, context);
      expect(result.type).toBe("WAITING_FOR_DECISION");
      expect(elseCmdARunCount).toBe(1);
      expect(elseCmdBRunCount).toBe(0);

      // branchCode: 1 (ELSE), innerIndex: 1
      expect(result.continuation!.effectPath).toEqual([0, 1, 1]);

      // 改ざん: results.cond を true に変更
      (result.context as any).results.cond = true;

      GraveTopCoordinator.applyGraveTopSelection(state, "p1", "c-else-1", logRecorder);

      const resumeResult = registry.resumeRequest(
        request,
        result.continuation!,
        ["c-else-1"],
        result.context!
      );

      expect(resumeResult.type).toBe("COMPLETED");
      expect(elseCmdARunCount).toBe(1);
      expect(elseCmdBRunCount).toBe(1);
      expect(request.status).toBe("resolved");
    });

    it("Test 33: Backward compatibility for 1-element effectPath [index]", () => {
      expect(EffectPathCodec.normalize(2)).toEqual([2]);
      expect(EffectPathCodec.normalize([2])).toEqual([2]);
      expect(EffectPathCodec.normalize(undefined)).toEqual([0]);
      expect(EffectPathCodec.getTopIndex([2])).toBe(2);
      expect(EffectPathCodec.advanceLastIndex([2])).toEqual([3]);
    });

    it("Test 34: Fail-safe: executeEffects breaks loop when pending selection occurs", () => {
      const registry = new CommandRegistry();
      const interpreter = (registry as any).effectInterpreter as EffectInterpreter;
      let subsequentExecuted = false;

      registry.register("triggerPendingCmd", (args, ctx) => {
        GraveTopCoordinator.addUnitToGrave(ctx.state.players.p1, {
          unitId: "u-fc",
          cards: [
            { id: "c-fc-1", suit: "H", rank: "1", value: 1 },
            { id: "c-fc-2", suit: "D", rank: "2", value: 2 },
          ],
        }, ctx.state, "p1");
      });

      registry.register("subsequentCmd", () => {
        subsequentExecuted = true;
      });

      const state: any = {
        stateVersion: 1,
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
      };

      interpreter.executeEffects([{ triggerPendingCmd: {} }, { subsequentCmd: {} }], context);
      expect(subsequentExecuted).toBe(false);
      expect(state.pendingGraveTopSelections?.length).toBe(1);
    });

    it("Test 35: Fail-closed: finalizeRequestResolution throws Error when pendingGraveTopSelections is non-empty", () => {
      const registry = new CommandRegistry();
      const state: any = {
        stateVersion: 1,
        stage: { requests: [], history: [] },
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
        pendingGraveTopSelections: [
          {
            playerId: "p1",
            candidateCardIds: ["c-1", "c-2"],
            reason: "MULTI_CARD_GRAVE_MOVE",
          },
        ],
      };

      const request: any = {
        id: "req-fc-err",
        actionId: "action.test",
        controller: "p1",
        status: "resolving",
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
      };

      expect(() => {
        registry.finalizeRequestResolution(request, context, { effectExecuted: true });
      }).toThrow("finalizeRequestResolution: 未解決の pendingGraveTopSelections が存在します。");
    });

    it("Test 36: Nested branch snapshot restore and deterministic resume", () => {
      const solCard = { id: "c-sol-1", suit: "C", rank: "3", value: 3 };

      const state: any = {
        stateVersion: 1,
        matchId: "match-nested-snap",
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [
              { id: "k-s2", suit: "S", rank: "2", value: 2 },
              { id: "k-d1", suit: "D", rank: "1", value: 1 },
            ],
            field: [],
            life: [{ id: "l1" }],
            grave: [],
          },
          p2: {
            hand: [],
            field: [
              {
                ...buildFieldUnitFromComponent({
                  componentId: "character.soldier",
                  playerKey: "p2",
                  card: solCard,
                  components: fullRulePackage.components,
                }),
                cards: [solCard],
              },
            ],
            life: [
              { id: "l2-a", suit: "H", rank: "8", value: 8 },
              { id: "l2-b", suit: "D", rank: "9", value: 9 },
            ],
            grave: [],
          },
        },
      };

      const session = new GameSession(state, standardRulePackage);
      let s: any = session.advance();
      const dlPat = s.request.patterns.findIndex(
        (p: any) =>
          p.actionSelectionRef !== undefined &&
          s.request.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance"
      );
      s = session.submitDecision({ decisionId: s.request.decisionId, stateVersion: s.request.stateVersion, selectedPatternRef: dlPat });
      s = session.submitDecision({ decisionId: s.request.decisionId, stateVersion: s.request.stateVersion, selectedPatternRef: s.request.patterns.findIndex((p: any) => p.kind === "PASS") });
      s = session.submitDecision({ decisionId: s.request.decisionId, stateVersion: s.request.stateVersion, selectedPatternRef: s.request.patterns.findIndex((p: any) => p.kind === "PASS") });

      // Death Lance damage 2 on p2 causes 2 cards to move to p2 grave -> triggers ZONE_TOP_SELECTION for p2
      expect(s.type).toBe("WAITING_FOR_DECISION");
      expect(s.request.source.type).toBe("ZONE_TOP_SELECTION");

      // Snapshot 保存
      const snapshot = session.createSnapshot();
      expect(snapshot.snapshotFormatVersion).toBe(1);

      // Snapshot から復元
      const restored = GameSession.fromSnapshot(snapshot, standardRulePackage);

      // 両方で同じ選択を提出
      const topPat = s.request.patterns.findIndex(
        (p: any) =>
          p.effectSelectionRef !== undefined &&
          s.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes("l2-a")
      );

      const nextOrig = session.submitDecision({
        decisionId: s.request.decisionId,
        stateVersion: s.request.stateVersion,
        selectedPatternRef: topPat,
      });
      const nextRestored = restored.submitDecision({
        decisionId: s.request.decisionId,
        stateVersion: s.request.stateVersion,
        selectedPatternRef: topPat,
      });

      expect(StateHasher.hash(restored.state)).toBe(StateHasher.hash(session.state));
    });
  });
});
