import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { MatchLogRecorder } from "../../engine/log/MatchLogRecorder";
import { formatActionSummary } from "../../engine/rules/formatActionSummary";
import { CharacterTransformService } from "../../engine/rules/CharacterTransformService";
import { getCanonicalCardNumber, matchesKeyGroupConstraints } from "../../engine/rules/keyCardGroupUtils";
import { GameSession } from "../../engine/session/GameSession";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { ActionCostEvaluator } from "../../engine/rules/ActionCostEvaluator";
import { isLegalAttackerCandidate, resolveComponentForUnit } from "../../engine/rules/characterUtils";
import { setUnitStateHandler } from "../../engine/rules/commandHandlers";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";

describe("action.reverse (リバース) & Generic Character Transform Tests [BP-SIM-REG-5.0-G-R1-PRO-REVERSE]", () => {
  let rulePackage: RulePackage;
  let reverseAction: ActionDefinition;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    reverseAction = rulePackage.actions.find((a) => a.id === "action.reverse")!;
  });

  // ---------------------------------------------------------------------------
  // 1. Definition & formatActionSummary (Section 6 & 64.1)
  // ---------------------------------------------------------------------------
  describe("1. Definition & Format Summary", () => {
    it("1.1: loads action.reverse with official metadata and specifications", () => {
      expect(reverseAction).toBeDefined();
      expect(reverseAction.id).toBe("action.reverse");
      expect(reverseAction.name).toBe("リバース");
      expect(reverseAction.ruby).toBe("りばーす");
      expect(reverseAction.type).toBe("magic");
      expect(reverseAction.request.trigger).toBe("direct");
      expect(reverseAction.request.speed).toBe("normal");
      expect(reverseAction.request.timing).toBe("quick");
      expect(reverseAction.cost).toBeUndefined(); // Cost: NONE

      // Key condition
      expect(reverseAction.key).toBeDefined();
      expect(reverseAction.key!.count).toBe(2);
      expect(reverseAction.key!.sameRank).toBe(true);
      expect(reverseAction.key!.condition?.card?.zone).toBe("hand");

      // Target condition
      expect(reverseAction.targets).toHaveLength(1);
      expect(reverseAction.targets![0].id).toBe("target");
      expect(reverseAction.targets![0].type).toBe("unit");
      expect(reverseAction.targets![0].condition?.componentType).toBe("character");
    });

    it("1.2: formatActionSummary formats action.reverse correctly with sameRank and character componentType", () => {
      const summary = formatActionSummary(reverseAction);
      expect(summary).toBe("リバース @直接-通常-クイック | ★同じ数字を2枚 | 対象: キャラクター1体");
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Key Card sameRank Constraint Validation & Canonical Card Number (Section 11, Section 3)
  // ---------------------------------------------------------------------------
  describe("2. Key Card sameRank Constraint Validation & Canonical Card Number", () => {
    const createValidatorState = (handCards: any[]) => ({
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: handCards,
          field: [
            {
              unitId: "u1",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "sc1", suit: "S", rank: "5", value: 5 }],
            },
          ],
          grave: [],
          life: [],
          fog: [],
        },
        p2: { hand: [], field: [], grave: [], life: [], fog: [] },
      },
      stage: { requests: [], history: [] },
    });

    const validator = new ActionRequestValidator();

    it("2.1: same rank 2 cards (e.g. 7H and 7S) in hand is VALID", () => {
      const c1 = { id: "c1", suit: "H", rank: "7", value: 7 };
      const c2 = { id: "c2", suit: "S", rank: "7", value: 7 };
      const state: any = createValidatorState([c1, c2]);

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [c1, c2],
        targetComponent: state.players.p1.field[0],
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(() => validator.validateActionRequest(reverseAction, context)).not.toThrow();

      const groupRes = matchesKeyGroupConstraints([c1, c2], reverseAction.key!);
      expect(groupRes.isValid).toBe(true);
    });

    it("2.2: different rank 2 cards (e.g. 7H and 8S) FAILS validation", () => {
      const c1 = { id: "c1", suit: "H", rank: "7", value: 7 };
      const c2 = { id: "c2", suit: "S", rank: "8", value: 8 };
      const state: any = createValidatorState([c1, c2]);

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [c1, c2],
        targetComponent: state.players.p1.field[0],
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(() => validator.validateActionRequest(reverseAction, context)).toThrow(/同じ数字/);

      const groupRes = matchesKeyGroupConstraints([c1, c2], reverseAction.key!);
      expect(groupRes.isValid).toBe(false);
      expect(groupRes.reason).toContain("同じ数字");
    });

    it("2.3: 1 card only FAILS validation (count mismatch)", () => {
      const c1 = { id: "c1", suit: "H", rank: "7", value: 7 };
      const state: any = createValidatorState([c1]);

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [c1],
        targetComponent: state.players.p1.field[0],
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(() => validator.validateActionRequest(reverseAction, context)).toThrow(/キーカードの枚数が一致しません/);
    });

    it("2.4: 3 cards FAILS validation (count mismatch)", () => {
      const c1 = { id: "c1", suit: "H", rank: "7", value: 7 };
      const c2 = { id: "c2", suit: "S", rank: "7", value: 7 };
      const c3 = { id: "c3", suit: "D", rank: "7", value: 7 };
      const state: any = createValidatorState([c1, c2, c3]);

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [c1, c2, c3],
        targetComponent: state.players.p1.field[0],
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(() => validator.validateActionRequest(reverseAction, context)).toThrow(/キーカードの枚数が一致しません/);
    });

    it("2.5: Section 11 tests: ♠A+♣A, ♠J+♢J, ♠Q+♣Q, ♠K+♡K, canonical Joker+Joker all PASS", () => {
      const testPairs = [
        [{ id: "a1", suit: "S", rank: "A" }, { id: "a2", suit: "C", rank: "A" }],
        [{ id: "j1", suit: "S", rank: "J" }, { id: "j2", suit: "D", rank: "J" }],
        [{ id: "q1", suit: "S", rank: "Q" }, { id: "q2", suit: "C", rank: "Q" }],
        [{ id: "k1", suit: "S", rank: "K" }, { id: "k2", suit: "H", rank: "K" }],
        [{ id: "jk1", suit: "joker", rank: "JOKER" }, { id: "jk2", suit: "joker", rank: "JOKER" }],
      ];

      for (const [c1, c2] of testPairs) {
        const state: any = createValidatorState([c1, c2]);
        const context: CommandContext = {
          state,
          playerKey: "p1",
          keyCards: [c1, c2],
          targetComponent: state.players.p1.field[0],
          actions: rulePackage.actions,
          components: rulePackage.components,
        };
        expect(() => validator.validateActionRequest(reverseAction, context)).not.toThrow();
        expect(matchesKeyGroupConstraints([c1, c2], reverseAction.key!).isValid).toBe(true);
      }
    });

    it("2.6: Section 11 tests: non-canonical rank aliases ('1', '11', '12', '13', {suit:'H', rank:'0'}, unknown) all FAIL-CLOSED", () => {
      const invalidCards = [
        { id: "i1", suit: "H", rank: "1" },
        { id: "i2", suit: "S", rank: "11" },
        { id: "i3", suit: "D", rank: "12" },
        { id: "i4", suit: "C", rank: "13" },
        { id: "i5", suit: "H", rank: "0" },
        { id: "i6", suit: "UNKNOWN", rank: "X" },
      ];

      for (const badCard of invalidCards) {
        expect(getCanonicalCardNumber(badCard)).toBeUndefined();
        const partner = { id: "p0", suit: "S", rank: badCard.rank };
        const state: any = createValidatorState([badCard, partner]);
        const context: CommandContext = {
          state,
          playerKey: "p1",
          keyCards: [badCard, partner],
          targetComponent: state.players.p1.field[0],
          actions: rulePackage.actions,
          components: rulePackage.components,
        };
        expect(() => validator.validateActionRequest(reverseAction, context)).toThrow();
        expect(matchesKeyGroupConstraints([badCard, partner], reverseAction.key!).isValid).toBe(false);
      }
    });

    it("2.7: Section 11 test: Same physical card ID twice FAILS validation (fail-closed)", () => {
      const card = { id: "dup-id-1", suit: "H", rank: "7", value: 7 };
      const state: any = createValidatorState([card]);

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [card, card], // duplicated physical card
        targetComponent: state.players.p1.field[0],
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(() => validator.validateActionRequest(reverseAction, context)).toThrow(/重複/);
      expect(matchesKeyGroupConstraints([card, card], reverseAction.key!).isValid).toBe(false);
    });

    it("2.8: getCanonicalCardNumber helper behaves consistently and fail-closed", () => {
      expect(getCanonicalCardNumber({ suit: "S", rank: "A" })).toBe(1);
      expect(getCanonicalCardNumber({ suit: "H", rank: "2" })).toBe(2);
      expect(getCanonicalCardNumber({ suit: "D", rank: "10" })).toBe(10);
      expect(getCanonicalCardNumber({ suit: "C", rank: "J" })).toBe(11);
      expect(getCanonicalCardNumber({ suit: "S", rank: "Q" })).toBe(12);
      expect(getCanonicalCardNumber({ suit: "H", rank: "K" })).toBe(13);
      expect(getCanonicalCardNumber({ suit: "joker", rank: "JOKER" })).toBe(0);
      expect(getCanonicalCardNumber({ suit: "J", rank: "JOKER" })).toBe(0);

      // Non-canonical must be undefined
      expect(getCanonicalCardNumber({ suit: "H", rank: "1" })).toBeUndefined();
      expect(getCanonicalCardNumber({ suit: "S", rank: "11" })).toBeUndefined();
      expect(getCanonicalCardNumber({ suit: "D", rank: "12" })).toBeUndefined();
      expect(getCanonicalCardNumber({ suit: "C", rank: "13" })).toBeUndefined();
      expect(getCanonicalCardNumber({ suit: "H", rank: "0" })).toBeUndefined();
      expect(getCanonicalCardNumber({ suit: "H", rank: "INVALID" })).toBeUndefined();
      expect(getCanonicalCardNumber(null)).toBeUndefined();
      expect(getCanonicalCardNumber(undefined)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. LegalPatternGenerator Combination Filtering (Section 64.11 - 64.13)
  // ---------------------------------------------------------------------------
  describe("3. LegalPatternGenerator Key Combination Filtering", () => {
    it("3.1: generates Action pattern only for same-rank pairs in hand", () => {
      const c7h = { id: "c7h", suit: "H", rank: "7", value: 7 };
      const c7s = { id: "c7s", suit: "S", rank: "7", value: 7 };
      const c8d = { id: "c8d", suit: "D", rank: "8", value: 8 };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [c7h, c7s, c8d],
            field: [
              {
                unitId: "sol-1",
                componentId: "character.soldier",
                state: "charge",
                cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
              },
            ],
            grave: [],
            life: [],
            fog: [],
          },
          p2: { hand: [], field: [], grave: [], life: [], fog: [] },
        },
        stage: { requests: [], history: [] },
        turnCount: 1,
        phase: "main",
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
      const reversePatterns = decision.patterns.filter((p) => {
        const actionDef = decision.catalog.actions[p.actionSelectionRef!];
        return actionDef?.actionId === "action.reverse";
      });

      expect(reversePatterns.length).toBeGreaterThan(0);

      // Verify that every generated reverse pattern uses keys with the same rank
      for (const p of reversePatterns) {
        const cardSel = decision.catalog.cardSelections[p.keyCardSelectionRef!];
        expect(cardSel.cardIds).toHaveLength(2);
        const cards = state.players.p1.hand.filter((c: any) => cardSel.cardIds.includes(c.id));
        expect(getCanonicalCardNumber(cards[0])).toBe(getCanonicalCardNumber(cards[1]));
      }

      // Ensure no pattern combines 7 and 8
      const hasMixed7And8 = reversePatterns.some((p: any) => {
        const cardSel = decision.catalog.cardSelections[p.keyCardSelectionRef!];
        const ids = cardSel.cardIds;
        return ids.includes("c7h") && ids.includes("c8d");
      });
      expect(hasMixed7And8).toBe(false);
    });

    it("3.2: does NOT generate reverse patterns when hand has no matching rank pairs", () => {
      const c7h = { id: "c7h", suit: "H", rank: "7", value: 7 };
      const c8s = { id: "c8s", suit: "S", rank: "8", value: 8 };
      const c9d = { id: "c9d", suit: "D", rank: "9", value: 9 };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [c7h, c8s, c9d],
            field: [
              {
                unitId: "sol-1",
                componentId: "character.soldier",
                state: "charge",
                cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
              },
            ],
            grave: [],
            life: [],
            fog: [],
          },
          p2: { hand: [], field: [], grave: [], life: [], fog: [] },
        },
        stage: { requests: [], history: [] },
        turnCount: 1,
        phase: "main",
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
      const reversePatterns = decision.patterns.filter((p) => {
        const actionDef = decision.catalog.actions[p.actionSelectionRef!];
        return actionDef?.actionId === "action.reverse";
      });
      expect(reversePatterns.length).toBe(0);
    });

    it("3.3: generates reverse pattern for canonical Joker pair", () => {
      const jk1 = { id: "jk1", suit: "joker", rank: "JOKER", value: 0 };
      const jk2 = { id: "jk2", suit: "joker", rank: "JOKER", value: 0 };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [jk1, jk2],
            field: [
              {
                unitId: "sol-1",
                componentId: "character.soldier",
                state: "charge",
                cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
              },
            ],
            grave: [],
            life: [],
            fog: [],
          },
          p2: { hand: [], field: [], grave: [], life: [], fog: [] },
        },
        stage: { requests: [], history: [] },
        turnCount: 1,
        phase: "main",
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
      const reversePatterns = decision.patterns.filter((p) => {
        const actionDef = decision.catalog.actions[p.actionSelectionRef!];
        return actionDef?.actionId === "action.reverse";
      });
      expect(reversePatterns.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Target Candidate Enumeration (Section 64.14 - 64.19)
  // ---------------------------------------------------------------------------
  describe("4. Target Candidate Enumeration", () => {
    it("4.1: enumerates all own and opponent Characters (Soldiers & Bulwarks), excluding non-Characters", () => {
      const p1Soldier = {
        unitId: "p1-sol",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
      };
      const p1Bulwark = {
        unitId: "p1-bul",
        componentId: "character.bulwark",
        state: "charge",
        cards: [{ id: "c2", suit: "H", rank: "6", value: 6 }],
      };
      const p2Soldier = {
        unitId: "p2-sol",
        componentId: "character.soldier",
        state: "drive",
        cards: [{ id: "c3", suit: "C", rank: "7", value: 7 }],
      };
      const p2Bulwark = {
        unitId: "p2-bul",
        componentId: "character.bulwark",
        state: "drive",
        cards: [{ id: "c4", suit: "D", rank: "8", value: 8 }],
      };
      const nonCharUnit = {
        unitId: "p1-fortress",
        componentId: "trump.fortress",
        state: "charge",
        cards: [{ id: "c5", suit: "S", rank: "K", value: 13 }],
      };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [
              { id: "k1", suit: "H", rank: "7", value: 7 },
              { id: "k2", suit: "S", rank: "7", value: 7 },
            ],
            field: [p1Soldier, p1Bulwark, nonCharUnit],
            grave: [],
            life: [],
            fog: [],
          },
          p2: {
            hand: [],
            field: [p2Soldier, p2Bulwark],
            grave: [],
            life: [],
            fog: [],
          },
        },
        stage: { requests: [], history: [] },
        turnCount: 1,
        phase: "main",
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
      const revPatterns = decision.patterns.filter((p) => {
        const actionDef = decision.catalog.actions[p.actionSelectionRef!];
        return actionDef?.actionId === "action.reverse";
      });

      const targetedUnitIds = new Set(
        revPatterns
          .map((p) => {
            const targetSel = decision.catalog.targetSelections[p.targetSelectionRef!];
            return targetSel?.targetUnitId;
          })
          .filter(Boolean)
      );

      // All 4 characters must be candidates
      expect(targetedUnitIds.has("p1-sol")).toBe(true);
      expect(targetedUnitIds.has("p1-bul")).toBe(true);
      expect(targetedUnitIds.has("p2-sol")).toBe(true);
      expect(targetedUnitIds.has("p2-bul")).toBe(true);

      // Non-character must NOT be candidate
      expect(targetedUnitIds.has("p1-fortress")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Option Selection & Unit State Transitions (Section 5, 12)
  // ---------------------------------------------------------------------------
  describe("5. Option Selection & Unit State Transitions (Atomic)", () => {
    const createResolutionState = (initialState: "charge" | "drive", targetOwner = "p1") => {
      const k1 = { id: "k1", suit: "H", rank: "9", value: 9 };
      const k2 = { id: "k2", suit: "S", rank: "9", value: 9 };
      const unit = {
        unitId: "target-unit",
        componentId: "character.soldier",
        state: initialState,
        cards: [{ id: "uc1", suit: "H", rank: "5", value: 5 }],
        enteredFieldTurn: 1,
      };

      return {
        state: {
          turnPlayer: "p1",
          chancePlayer: "p1",
          players: {
            p1: {
              hand: [k1, k2],
              field: targetOwner === "p1" ? [unit] : [],
              grave: [],
              life: [],
              fog: [],
            },
            p2: {
              hand: [],
              field: targetOwner === "p2" ? [unit] : [],
              grave: [],
              life: [],
              fog: [],
            },
          },
          stage: { requests: [], history: [] },
          stateVersion: 1,
          turnCount: 1,
        } as any,
        k1,
        k2,
        unit,
      };
    };

    it("5.1: halts with EFFECT_RESOLUTION selectOption interruption offering charge and drive", () => {
      const { state, k1, k2, unit } = createResolutionState("charge");
      const registry = new CommandRegistry();

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [k1, k2],
        targetComponent: unit,
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      const req = registry.createRequest(reverseAction, context);
      expect(state.stage.requests).toHaveLength(1);

      const resolveResult = registry.resolveTopRequest(context);
      expect(resolveResult).toBeDefined();
      expect(resolveResult!.type).toBe("WAITING_FOR_DECISION");
      expect(resolveResult!.continuation?.selectionId).toBe("reverseState");

      // Verify DecisionRequest
      expect(resolveResult!.decisionRequest?.playerId).toBe("p1");
      expect(resolveResult!.decisionRequest?.source?.type).toBe("EFFECT_RESOLUTION");
      expect(resolveResult!.decisionRequest?.catalog?.effectSelections).toHaveLength(2);
      expect(resolveResult!.decisionRequest?.catalog?.effectSelections[0].selectedValues).toEqual(["charge"]);
      expect(resolveResult!.decisionRequest?.catalog?.effectSelections[1].selectedValues).toEqual(["drive"]);
    });

    it("5.2: Section 12 test: verifies all 4 state choice transitions (charge->charge, charge->drive, drive->charge, drive->drive)", () => {
      const cases: Array<{
        initial: "charge" | "drive";
        selected: "charge" | "drive";
        expectEvent: boolean;
      }> = [
        { initial: "charge", selected: "charge", expectEvent: false },
        { initial: "charge", selected: "drive", expectEvent: true },
        { initial: "drive", selected: "charge", expectEvent: true },
        { initial: "drive", selected: "drive", expectEvent: false },
      ];

      for (const tc of cases) {
        const { state, k1, k2, unit } = createResolutionState(tc.initial);
        const registry = new CommandRegistry();

        const dispatchedEvents: any[] = [];
        const interpreter = registry["effectInterpreter"];
        const originalDispatchEvent = interpreter.dispatchEvent;
        interpreter.dispatchEvent = function (event: any, ctx: any) {
          dispatchedEvents.push(event);
          originalDispatchEvent.call(this, event, ctx);
        };

        const context: CommandContext = {
          state,
          playerKey: "p1",
          keyCards: [k1, k2],
          targetComponent: unit,
          actions: rulePackage.actions,
          components: rulePackage.components,
        };

        const req = registry.createRequest(reverseAction, context);
        const step1 = registry.resolveTopRequest(context)!;
        expect(step1.type).toBe("WAITING_FOR_DECISION");

        const resumeResult = registry.resumeRequest(
          req,
          step1.continuation!,
          [tc.selected],
          step1.context!
        );

        expect(resumeResult.type).toBe("COMPLETED");
        const transformedUnit = state.players.p1.field[0];
        expect(transformedUnit.state).toBe(tc.selected);

        const stateEvt = dispatchedEvents.find((e) => e.type === "unitStateChanged");
        if (tc.expectEvent) {
          expect(stateEvt).toBeDefined();
          expect(stateEvt.payload.fromState).toBe(tc.initial);
          expect(stateEvt.payload.toState).toBe(tc.selected);
          expect(stateEvt.payload.playerKey).toBe("p1");
        } else {
          expect(stateEvt).toBeUndefined();
        }
      }
    });

    it("5.3: Section 5 test: P1 reverses P2's Character (drive -> charge), emitted unitStateChanged has playerKey == 'p2' (NOT 'p1')", () => {
      const { state, k1, k2, unit } = createResolutionState("drive", "p2");
      const registry = new CommandRegistry();

      const dispatchedEvents: any[] = [];
      const interpreter = registry["effectInterpreter"];
      const originalDispatchEvent = interpreter.dispatchEvent;
      interpreter.dispatchEvent = function (event: any, ctx: any) {
        dispatchedEvents.push(event);
        originalDispatchEvent.call(this, event, ctx);
      };

      const context: CommandContext = {
        state,
        playerKey: "p1", // requester is p1
        keyCards: [k1, k2],
        targetComponent: unit, // unit is owned by p2
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      const req = registry.createRequest(reverseAction, context);
      const step1 = registry.resolveTopRequest(context)!;
      expect(step1.type).toBe("WAITING_FOR_DECISION");

      const resumeResult = registry.resumeRequest(
        req,
        step1.continuation!,
        ["charge"],
        step1.context!
      );

      expect(resumeResult.type).toBe("COMPLETED");
      expect(state.players.p2.field[0].state).toBe("charge");

      const stateEvt = dispatchedEvents.find((e) => e.type === "unitStateChanged");
      expect(stateEvt).toBeDefined();
      expect(stateEvt.payload.fromState).toBe("drive");
      expect(stateEvt.payload.toState).toBe("charge");
      // MUST BE p2, NOT p1!
      expect(stateEvt.payload.playerKey).toBe("p2");
    });

    it("5.4: Generic setUnitState command enforces canonical resolution, character check, and target owner", () => {
      const evaluator = new ExpressionEvaluator();
      const emitted: any[] = [];
      const fakeInterpreter: any = {
        dispatchEvent: (ev: any) => emitted.push(ev),
      };
      const handler = setUnitStateHandler(evaluator, fakeInterpreter);

      const targetUnit = {
        unitId: "u-p2-test",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "3" }],
      };
      const nonCharUnit = {
        unitId: "u-non-char",
        componentId: "trump.fortress",
        state: "charge",
        cards: [{ id: "c2", suit: "H", rank: "K" }],
      };

      const state: any = {
        players: {
          p1: { field: [] },
          p2: { field: [targetUnit, nonCharUnit] },
        },
      };

      // 1. Success case: p1 changes p2's targetUnit from charge to drive
      handler(
        { target: "u-p2-test", state: "drive" },
        { state, playerKey: "p1", components: rulePackage.components } as any
      );
      expect(targetUnit.state).toBe("drive");
      expect(emitted).toHaveLength(1);
      expect(emitted[0].payload.playerKey).toBe("p2"); // actual owner!
      expect(emitted[0].payload.fromState).toBe("charge");
      expect(emitted[0].payload.toState).toBe("drive");

      // 2. Fail-closed: non-character
      expect(() => {
        handler(
          { target: "u-non-char", state: "drive" },
          { state, playerKey: "p1", components: rulePackage.components } as any
        );
      }).toThrow(/キャラクターではありません/);

      // 3. Fail-closed: not found in field
      expect(() => {
        handler(
          { target: "u-missing", state: "drive" },
          { state, playerKey: "p1", components: rulePackage.components } as any
        );
      }).toThrow(/存在しません/);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Preflight Validation & Atomic Transformation (Section 7, 8)
  // ---------------------------------------------------------------------------
  describe("6. Preflight Validation & Atomic Transformation (Section 7, 8)", () => {
    it("6.1: target CURRENT Field not found throws fail-closed with UNCHANGED state", () => {
      const state: any = {
        players: {
          p1: { field: [] },
        },
      };

      expect(() => {
        CharacterTransformService.transformCharacter({
          targetUnit: "ghost-unit",
          state,
          components: rulePackage.components,
        });
      }).toThrow(/存在しません/);
    });

    it("6.2: duplicate unitId in Field throws fail-closed with UNCHANGED state", () => {
      const u1 = { unitId: "dup-u", componentId: "character.soldier", state: "charge", cards: [{ id: "c1" }] };
      const u2 = { unitId: "dup-u", componentId: "character.soldier", state: "charge", cards: [{ id: "c2" }] };
      const state: any = {
        players: {
          p1: { field: [u1] },
          p2: { field: [u2] },
        },
      };

      expect(() => {
        CharacterTransformService.transformCharacter({
          targetUnit: "dup-u",
          state,
          components: rulePackage.components,
        });
      }).toThrow(/重複/);

      expect(state.players.p1.field).toHaveLength(1);
      expect(state.players.p2.field).toHaveLength(1);
    });

    it("6.3: non-character unit throws fail-closed with UNCHANGED state", () => {
      const nonChar = { unitId: "fortress-1", componentId: "trump.fortress", state: "charge", cards: [{ id: "c1" }] };
      const state: any = {
        players: {
          p1: { field: [nonChar] },
        },
      };

      expect(() => {
        CharacterTransformService.transformCharacter({
          targetUnit: nonChar,
          state,
          components: rulePackage.components,
        });
      }).toThrow(/キャラクターではありません/);

      expect(state.players.p1.field[0].unitId).toBe("fortress-1");
    });

    it("6.4: invalid requested state throws fail-closed with UNCHANGED state", () => {
      const soldier = {
        unitId: "sol-state-test",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "4" }],
      };
      const state: any = {
        players: {
          p1: { field: [soldier] },
        },
      };

      expect(() => {
        CharacterTransformService.transformCharacter({
          targetUnit: soldier,
          state,
          components: rulePackage.components,
          options: { state: "invalid_state" },
        });
      }).toThrow(/不正です/);

      expect(soldier.state).toBe("charge");
      expect(state.players.p1.field[0].componentId).toBe("character.soldier");
    });

    it("6.5: missing or empty physical card id throws fail-closed with UNCHANGED state", () => {
      const soldier = {
        unitId: "sol-bad-card",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "", suit: "S", rank: "4" }],
      };
      const state: any = {
        players: {
          p1: { field: [soldier] },
        },
      };

      expect(() => {
        CharacterTransformService.transformCharacter({
          targetUnit: soldier,
          state,
          components: rulePackage.components,
        });
      }).toThrow(/カードIDが欠落または空文字/);

      expect(state.players.p1.field[0].componentId).toBe("character.soldier");
    });

    it("6.6: duplicate card id in multi-card soldier throws fail-closed with UNCHANGED state", () => {
      const armedSoldier = {
        unitId: "sol-dup-cards",
        componentId: "character.soldier",
        state: "charge",
        cards: [
          { id: "c-dup", suit: "S", rank: "4" },
          { id: "c-dup", suit: "H", rank: "5" },
        ],
      };
      const state: any = {
        players: {
          p1: { field: [armedSoldier] },
        },
      };

      expect(() => {
        CharacterTransformService.transformCharacter({
          targetUnit: armedSoldier,
          state,
          components: rulePackage.components,
        });
      }).toThrow(/カードIDに重複が存在します/);

      expect(state.players.p1.field).toHaveLength(1);
    });

    it("6.7: resulting unitId collides with existing field unitId throws fail-closed with UNCHANGED state", () => {
      const armedSoldier = {
        unitId: "source-sol",
        componentId: "character.soldier",
        state: "charge",
        cards: [
          { id: "ca", suit: "S", rank: "4" },
          { id: "cb", suit: "H", rank: "5" },
        ],
      };
      // Another unit already has the ID that would be generated: "source-sol-split-ca"
      const conflictingUnit = {
        unitId: "source-sol-split-ca",
        componentId: "character.bulwark",
        state: "charge",
        cards: [{ id: "cx", suit: "D", rank: "9" }],
      };

      const state: any = {
        players: {
          p1: { field: [armedSoldier, conflictingUnit] },
        },
      };

      expect(() => {
        CharacterTransformService.transformCharacter({
          targetUnit: armedSoldier,
          state,
          components: rulePackage.components,
        });
      }).toThrow(/衝突しています/);

      // State is UNCHANGED
      expect(state.players.p1.field).toHaveLength(2);
      expect(state.players.p1.field[0].componentId).toBe("character.soldier");
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Generic Bulwark Resolution (Section 9)
  // ---------------------------------------------------------------------------
  describe("7. Generic Bulwark Resolution (Section 9)", () => {
    it("7.1: resolves 1 card + face down + field + character generically into character.bulwark without hardcoding", () => {
      const resolved = resolveComponentForUnit({
        cards: [{ id: "test-card", suit: "club", rank: "7", face: "down" }],
        face: "down",
        zone: "field",
        components: rulePackage.components,
        componentType: "character",
      });

      expect(resolved).toBeDefined();
      expect(resolved.id).toBe("character.bulwark");
      expect(resolved.properties?.characterType).toBe("bulwark");
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Character Transformation: Soldier -> Bulwark
  // ---------------------------------------------------------------------------
  describe("8. Character Transformation: Soldier -> Bulwark", () => {
    it("8.1: 1-card Soldier transforms into Bulwark preserving unitId, state, and enteredFieldTurn", () => {
      const soldier = {
        unitId: "soldier-1",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        enteredFieldTurn: 2,
        cards: [{ id: "c1", suit: "S", rank: "8", value: 8 }],
      };

      const state: any = {
        players: {
          p1: { field: [soldier] },
        },
      };

      const result = CharacterTransformService.transformCharacter({
        targetUnit: soldier,
        state,
        components: rulePackage.components,
        options: { destination: "opposite" },
      });

      expect(result.results).toHaveLength(1);
      const res = result.results[0];
      expect(res.unitId).toBe("soldier-1");
      expect(res.componentId).toBe("character.bulwark");
      expect(res.characterType).toBe("bulwark");
      expect(res.face).toBe("down");
      expect(res.state).toBe("charge");

      expect(state.players.p1.field).toHaveLength(1);
      const fieldUnit = state.players.p1.field[0];
      expect(fieldUnit.componentId).toBe("character.bulwark");
      expect(fieldUnit.face).toBe("down");
      expect(fieldUnit.enteredFieldTurn).toBe(2);
    });

    it("8.2: Multi-card Soldier splits into N distinct Bulwarks with exact card conservation", () => {
      const c1 = { id: "c1", suit: "S", rank: "8", value: 8 };
      const c2 = { id: "c2", suit: "H", rank: "3", value: 3 };
      const c3 = { id: "c3", suit: "D", rank: "9", value: 9 };
      const armedSoldier = {
        unitId: "armed-sol",
        componentId: "character.armedSoldier",
        state: "charge",
        face: "up",
        cards: [c1, c2, c3],
        enteredFieldTurn: 1,
      };

      const state: any = {
        players: {
          p1: { field: [armedSoldier] },
        },
      };

      const result = CharacterTransformService.transformCharacter({
        targetUnit: armedSoldier,
        state,
        components: rulePackage.components,
      });

      expect(result.results).toHaveLength(3);
      expect(result.results.map((r) => r.unitId)).toEqual([
        "armed-sol-split-c1",
        "armed-sol-split-c2",
        "armed-sol-split-c3",
      ]);

      for (const res of result.results) {
        expect(res.componentId).toBe("character.bulwark");
        expect(res.characterType).toBe("bulwark");
        expect(res.face).toBe("down");
        expect(res.cardIds).toHaveLength(1);
      }

      // Exact card conservation
      const allResultCardIds = result.results.flatMap((r) => r.cardIds);
      expect(allResultCardIds).toEqual(["c1", "c2", "c3"]);

      // In field
      expect(state.players.p1.field).toHaveLength(3);
      expect(state.players.p1.field.map((u: any) => u.unitId)).toEqual([
        "armed-sol-split-c1",
        "armed-sol-split-c2",
        "armed-sol-split-c3",
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Character Transformation: Bulwark -> Soldier
  // ---------------------------------------------------------------------------
  describe("9. Character Transformation: Bulwark -> Soldier", () => {
    it("9.1: Bulwark with rank 2..10 transforms into general Soldier (character.soldier)", () => {
      const card = { id: "c5", suit: "H", rank: "5", value: 5 };
      const bulwark = {
        unitId: "bw-5",
        componentId: "character.bulwark",
        state: "drive",
        face: "down",
        cards: [card],
        enteredFieldTurn: 1,
      };

      const state: any = {
        players: {
          p1: { field: [bulwark] },
        },
      };

      const result = CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      expect(result.results).toHaveLength(1);
      const res = result.results[0];
      expect(res.componentId).toBe("character.soldier");
      expect(res.characterType).toBe("soldier");
      expect(res.face).toBe("up");

      expect(state.players.p1.field[0].componentId).toBe("character.soldier");
      expect(state.players.p1.field[0].face).toBe("up");
    });

    it("9.2: Bulwark with rank J..K transforms into Hero (character.hero)", () => {
      const cardQ = { id: "cq", suit: "S", rank: "Q", value: 12 };
      const bulwark = {
        unitId: "bw-q",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [cardQ],
      };

      const state: any = {
        players: {
          p1: { field: [bulwark] },
        },
      };

      const result = CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      expect(result.results[0].componentId).toBe("character.hero");
      expect(result.results[0].characterType).toBe("soldier");
    });

    it("9.3: Bulwark with rank A transforms into Ace (character.ace)", () => {
      const cardA = { id: "ca", suit: "D", rank: "A", value: 1 };
      const bulwark = {
        unitId: "bw-a",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [cardA],
      };

      const state: any = {
        players: {
          p1: { field: [bulwark] },
        },
      };

      const result = CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      expect(result.results[0].componentId).toBe("character.ace");
      expect(result.results[0].characterType).toBe("soldier");
    });

    it("9.4: Bulwark with Joker transforms into Magician (character.magician)", () => {
      const cardJk = { id: "cjk", suit: "joker", rank: "JOKER", value: 0 };
      const bulwark = {
        unitId: "bw-jk",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [cardJk],
      };

      const state: any = {
        players: {
          p1: { field: [bulwark] },
        },
      };

      const result = CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      expect(result.results[0].componentId).toBe("character.magician");
      expect(result.results[0].characterType).toBe("soldier");
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Entered-turn & Haste Evaluation (Section 13)
  // ---------------------------------------------------------------------------
  describe("10. Entered-turn & Haste Evaluation (Section 13)", () => {
    it("10.1: Bulwark entered this turn transforming to General Soldier cannot attack (no haste)", () => {
      const currentTurn = 3;
      const bulwark = {
        unitId: "bw-t3",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        enteredFieldTurn: 3,
        cards: [{ id: "c5", suit: "S", rank: "5", value: 5 }],
      };

      const state: any = {
        players: { p1: { field: [bulwark] } },
      };

      const result = CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      const newUnit = state.players.p1.field[0];
      expect(newUnit.componentId).toBe("character.soldier");
      expect(newUnit.enteredFieldTurn).toBe(3);

      // Cannot attack this turn because it has no haste!
      const canAttack = isLegalAttackerCandidate(newUnit, rulePackage.components, currentTurn);
      expect(canAttack).toBe(false);
    });

    it("10.2: Bulwark entered this turn transforming to Ace can attack immediately due to Haste", () => {
      const currentTurn = 3;
      const bulwark = {
        unitId: "bw-ace-t3",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        enteredFieldTurn: 3,
        cards: [{ id: "ca", suit: "H", rank: "A", value: 1 }],
      };

      const state: any = {
        players: { p1: { field: [bulwark] } },
      };

      CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      const newUnit = state.players.p1.field[0];
      expect(newUnit.componentId).toBe("character.ace");

      // Can attack because Ace has Haste!
      const canAttack = isLegalAttackerCandidate(newUnit, rulePackage.components, currentTurn);
      expect(canAttack).toBe(true);
    });

    it("10.3: Bulwark entered this turn transforming to Magician can attack immediately due to Haste", () => {
      const currentTurn = 3;
      const bulwark = {
        unitId: "bw-jk-t3",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        enteredFieldTurn: 3,
        cards: [{ id: "cjk", suit: "joker", rank: "JOKER", value: 0 }],
      };

      const state: any = {
        players: { p1: { field: [bulwark] } },
      };

      CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      const newUnit = state.players.p1.field[0];
      expect(newUnit.componentId).toBe("character.magician");

      // Can attack because Magician has Haste!
      const canAttack = isLegalAttackerCandidate(newUnit, rulePackage.components, currentTurn);
      expect(canAttack).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Fog Non-resurrection & Binding Removal (Section 14)
  // ---------------------------------------------------------------------------
  describe("11. Fog Non-resurrection & Binding Removal (Section 14)", () => {
    it("11.1: Fog binding removed on Soldier->Bulwark transform, and does not resurrect on Bulwark->Soldier", () => {
      const abilityEvaluator = new AbilityEvaluator();
      const soldier = {
        unitId: "fog-target-sol",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        cards: [{ id: "c6", suit: "S", rank: "6", value: 6 }],
      };

      const fogCard = { id: "fog-c", suit: "H", rank: "3", value: 3 };
      const fogEntry = {
        componentId: "fog.up",
        card: fogCard,
        bindings: {
          target: "fog-target-sol",
          amount: 3,
        },
      };

      const state: any = {
        players: {
          p1: {
            field: [soldier],
            fog: [fogEntry],
          },
        },
      };

      // Before Reverse: soldier size is 6 + 3 = 9
      const initialSize = abilityEvaluator.calculateUnitSize(soldier, state);
      expect(initialSize).toBe(9);

      // 1. Transform Soldier -> Bulwark
      CharacterTransformService.transformCharacter({
        targetUnit: soldier,
        state,
        components: rulePackage.components,
        options: { clearReceivedEffects: true },
      });

      // Fog remains in fog zone, but target binding is removed
      expect(state.players.p1.fog).toHaveLength(1);
      expect(state.players.p1.fog[0].bindings.target).toBeUndefined();

      // 2. Transform back Bulwark -> Soldier
      const bulwark = state.players.p1.field[0];
      CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
        options: { clearReceivedEffects: true },
      });

      const retransformedSoldier = state.players.p1.field[0];
      expect(retransformedSoldier.componentId).toBe("character.soldier");

      // Verify old Up modifier does NOT resurrect: size is 6, not 9!
      const finalSize = abilityEvaluator.calculateUnitSize(retransformedSoldier, state);
      expect(finalSize).toBe(6);
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Magician Ability Functional Removal (Section 15)
  // ---------------------------------------------------------------------------
  describe("12. Magician Ability Functional Removal (Section 15)", () => {
    it("12.1: Magician reduces Quick Magic cost D to 0; when transformed to Bulwark, cost reduction is removed", () => {
      const costEvaluator = new ActionCostEvaluator();
      const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
      expect(twistAction.cost).toBe("D");
      expect(twistAction.request.timing).toBe("quick");
      expect(twistAction.type).toBe("magic");

      const magician = {
        unitId: "magician-1",
        componentId: "character.magician",
        state: "charge",
        face: "up",
        cards: [{ id: "cjk", suit: "joker", rank: "JOKER", value: 0 }],
      };

      const state: any = {
        players: {
          p1: {
            field: [magician],
          },
        },
      };

      // 1. Before: Magician face up on field -> effective cost is "" (D is removed)
      const costBefore = costEvaluator.resolveEffectiveCost(twistAction, state, "p1", rulePackage.components);
      expect(costBefore).toBe("");

      // 2. Transform Magician -> Bulwark
      CharacterTransformService.transformCharacter({
        targetUnit: magician,
        state,
        components: rulePackage.components,
      });

      // 3. After: Bulwark is face down -> cost reduction is gone, effective cost is "D"
      const costAfter = costEvaluator.resolveEffectiveCost(twistAction, state, "p1", rulePackage.components);
      expect(costAfter).toBe("D");
    });
  });

  // ---------------------------------------------------------------------------
  // 13. Battle Interruption & Cleanup (Section 16)
  // ---------------------------------------------------------------------------
  describe("13. Battle Interruption & Cleanup (Section 16)", () => {
    it("13.1: Attacker target Reverse clears attacker role, while unrelated attacker/blocker remain unchanged", () => {
      const atk1 = {
        unitId: "atk-1",
        componentId: "character.soldier",
        state: "drive",
        battle: { role: "attacker", targetPlayerKey: "p2" },
        cards: [{ id: "c1", suit: "S", rank: "5" }],
      };
      const atk2 = {
        unitId: "atk-2",
        componentId: "character.soldier",
        state: "drive",
        battle: { role: "attacker", targetPlayerKey: "p2" },
        cards: [{ id: "c2", suit: "H", rank: "6" }],
      };
      const blk2 = {
        unitId: "blk-2",
        componentId: "character.soldier",
        state: "drive",
        battle: { role: "blocker", blockedAttackerUnitId: "atk-2" },
        cards: [{ id: "c3", suit: "D", rank: "7" }],
      };

      const state: any = {
        players: {
          p1: { field: [atk1, atk2] },
          p2: { field: [blk2] },
        },
      };

      // Reverse atk1
      CharacterTransformService.transformCharacter({
        targetUnit: atk1,
        state,
        components: rulePackage.components,
        options: { clearBattleRole: true },
      });

      // atk1 transformed to Bulwark and battle is cleared
      expect(state.players.p1.field[0].battle).toBeUndefined();
      expect(state.players.p1.field[0].componentId).toBe("character.bulwark");

      // atk2 and blk2 are UNCHANGED
      expect(state.players.p1.field[1].battle?.role).toBe("attacker");
      expect(state.players.p2.field[0].battle?.role).toBe("blocker");
    });

    it("13.2: Blocker target Reverse clears blocker role; corresponding attacker remains attacker", () => {
      const atk = {
        unitId: "atk-target",
        componentId: "character.soldier",
        state: "drive",
        battle: { role: "attacker", targetPlayerKey: "p2" },
        cards: [{ id: "c1", suit: "S", rank: "5" }],
      };
      const blk = {
        unitId: "blk-target",
        componentId: "character.soldier",
        state: "drive",
        battle: { role: "blocker", blockedAttackerUnitId: "atk-target" },
        cards: [{ id: "c2", suit: "H", rank: "6" }],
      };

      const state: any = {
        players: {
          p1: { field: [atk] },
          p2: { field: [blk] },
        },
      };

      // Reverse blk
      CharacterTransformService.transformCharacter({
        targetUnit: blk,
        state,
        components: rulePackage.components,
        options: { clearBattleRole: true },
      });

      // blk transformed to Bulwark and blocker role cleared
      expect(state.players.p2.field[0].battle).toBeUndefined();
      expect(state.players.p2.field[0].componentId).toBe("character.bulwark");

      // atk is STILL attacker
      expect(state.players.p1.field[0].battle?.role).toBe("attacker");
    });
  });

  // ---------------------------------------------------------------------------
  // 14. Canonical Event Logs & No Fake cardMoved (Section 17, 18)
  // ---------------------------------------------------------------------------
  describe("14. Canonical Event Logs & No Fake cardMoved (Section 17, 18)", () => {
    it("14.1: multi-card split records unit.transformed with distinct IDs, exact card conservation, and NO card.moved events", () => {
      const c1 = { id: "c1", suit: "S", rank: "8", value: 8 };
      const c2 = { id: "c2", suit: "H", rank: "9", value: 9 };
      const armedSoldier = {
        unitId: "multi-sol-log",
        componentId: "character.armedSoldier",
        state: "charge",
        cards: [c1, c2],
      };

      const k1 = { id: "k1", suit: "H", rank: "4", value: 4 };
      const k2 = { id: "k2", suit: "S", rank: "4", value: 4 };

      const state: any = {
        players: {
          p1: {
            hand: [k1, k2],
            field: [armedSoldier],
            grave: [],
            life: [],
            fog: [],
          },
          p2: { hand: [], field: [], grave: [], life: [], fog: [] },
        },
        stage: { requests: [], history: [] },
      };

      const logRecorder = new MatchLogRecorder({ matchId: "split-log-test" });
      const registry = new CommandRegistry();

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [k1, k2],
        targetComponent: armedSoldier,
        actions: rulePackage.actions,
        components: rulePackage.components,
        logRecorder,
      };

      const req = registry.createRequest(reverseAction, context);
      const step1 = registry.resolveTopRequest(context)!;
      registry.resumeRequest(req, step1.continuation!, ["charge"], step1.context!);

      const logEntries = logRecorder.getEvents();
      const transformEntry = logEntries.find((e: any) => e.type === "unit.transformed") as any;
      expect(transformEntry).toBeDefined();
      expect(transformEntry.sourceUnitId).toBe("multi-sol-log");
      expect(transformEntry.sourceCharacterType).toBe("soldier");
      expect(transformEntry.results).toHaveLength(2);

      // Result IDs all distinct and sourceUnitId not in results
      const resIds = transformEntry.results.map((r: any) => r.unitId);
      expect(new Set(resIds).size).toBe(2);
      expect(resIds).not.toContain("multi-sol-log");

      // Exact card conservation
      const loggedCardIds = transformEntry.results.flatMap((r: any) => r.cardIds);
      expect(loggedCardIds).toEqual(["c1", "c2"]);

      // Section 18: Field -> Field transform must NOT emit fake card.moved events for transformed cards!
      const targetCardMovedEntries = logEntries.filter(
        (e: any) => e.type === "card.moved" && (e.cardId === "c1" || e.cardId === "c2")
      );
      expect(targetCardMovedEntries).toHaveLength(0);
    });

    it("14.2: 1-to-1 transform emits 0 card.moved events for the transformed unit card", () => {
      const soldierCard = { id: "c-sol-single", suit: "S", rank: "7", value: 7 };
      const soldier = {
        unitId: "single-sol-log",
        componentId: "character.soldier",
        state: "charge",
        cards: [soldierCard],
      };

      const k1 = { id: "k11", suit: "H", rank: "4", value: 4 };
      const k2 = { id: "k12", suit: "S", rank: "4", value: 4 };

      const state: any = {
        players: {
          p1: {
            hand: [k1, k2],
            field: [soldier],
            grave: [],
            life: [],
            fog: [],
          },
          p2: { hand: [], field: [], grave: [], life: [], fog: [] },
        },
        stage: { requests: [], history: [] },
      };

      const logRecorder = new MatchLogRecorder({ matchId: "single-log-test" });
      const registry = new CommandRegistry();

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [k1, k2],
        targetComponent: soldier,
        actions: rulePackage.actions,
        components: rulePackage.components,
        logRecorder,
      };

      const req = registry.createRequest(reverseAction, context);
      const step1 = registry.resolveTopRequest(context)!;
      registry.resumeRequest(req, step1.continuation!, ["charge"], step1.context!);

      const logEntries = logRecorder.getEvents();
      const targetCardMoved = logEntries.filter(
        (e: any) => e.type === "card.moved" && e.cardId === "c-sol-single"
      );
      expect(targetCardMoved).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 15. Edge Cases: Target Lost & Counter
  // ---------------------------------------------------------------------------
  describe("15. Edge Cases: Target Lost & Counter", () => {
    it("15.1: Reverse fizzles with TARGET_INVALID_AT_RESOLUTION if target unit disappears before resolution", () => {
      const k1 = { id: "k1", suit: "H", rank: "8", value: 8 };
      const k2 = { id: "k2", suit: "S", rank: "8", value: 8 };
      const soldier = {
        unitId: "doomed-sol",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "sc1", suit: "C", rank: "5", value: 5 }],
      };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [k1, k2],
            field: [soldier],
            grave: [],
            life: [],
            fog: [],
          },
          p2: { hand: [], field: [], grave: [], life: [], fog: [] },
        },
        stage: { requests: [], history: [] },
        stateVersion: 1,
        turnCount: 1,
      };

      const logRecorder = new MatchLogRecorder({ matchId: "fizzle-test" });
      const registry = new CommandRegistry();
      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [k1, k2],
        targetComponent: soldier,
        actions: rulePackage.actions,
        components: rulePackage.components,
        logRecorder,
      };

      const req = registry.createRequest(reverseAction, context);

      // Now target is destroyed / leaves field before resolution
      state.players.p1.field = [];

      const resolveResult = registry.resolveTopRequest(context);
      expect(resolveResult).toBeDefined();
      expect(resolveResult!.type).toBe("COMPLETED");

      // Verify req in resolved log has effectSkipped: true and reason TARGET_INVALID_AT_RESOLUTION
      const resolvedEvent = logRecorder.getEvents().find((e: any) => e.type === "request.resolved") as any;
      expect(resolvedEvent).toBeDefined();
      expect(resolvedEvent.requestId).toBe(req.id);
      expect(resolvedEvent.effectSkipped).toBe(true);
      expect(resolvedEvent.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
    });

    it("15.2: Reverse is cancelled when Counter is resolved above it", () => {
      const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
      const k1 = { id: "k1", suit: "H", rank: "8", value: 8 };
      const k2 = { id: "k2", suit: "S", rank: "8", value: 8 };
      const counterKey = { id: "ck", suit: "C", rank: "A", value: 1 };
      const counterCost = { id: "cc", suit: "D", rank: "2", value: 2 };

      const soldier = {
        unitId: "countered-sol",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "sc1", suit: "C", rank: "5", value: 5 }],
      };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [k1, k2],
            field: [soldier],
            grave: [],
            life: [],
            fog: [],
          },
          p2: {
            hand: [counterKey, counterCost],
            field: [],
            grave: [],
            life: [],
            fog: [],
          },
        },
        stage: { requests: [], history: [] },
        stateVersion: 1,
        turnCount: 1,
      };

      const registry = new CommandRegistry();
      const p1Context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [k1, k2],
        targetComponent: soldier,
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      // 1. P1 requests Reverse (P1 has chance)
      const revReq = registry.createRequest(reverseAction, p1Context);
      expect(state.stage.requests).toHaveLength(1);

      // Chance passes to P2 to allow quick Counter response
      state.chancePlayer = "p2";

      // 2. P2 requests Counter targeting revReq
      const p2Context: CommandContext = {
        state,
        playerKey: "p2",
        keyCard: counterKey,
        targetRequest: revReq,
        actions: rulePackage.actions,
        components: rulePackage.components,
      };
      const counterReq = registry.createRequest(counterAction, p2Context);
      expect(state.stage.requests).toHaveLength(2);

      // 3. Resolve Counter (Stage TOP)
      const resCounter = registry.resolveTopRequest(p2Context);
      expect(resCounter?.type).toBe("COMPLETED");

      // Reverse request is now cancelled and removed from stage requests
      expect(revReq.status).toBe("cancelled");

      // Soldier remained completely unchanged (still soldier, still charge)
      expect(soldier.componentId).toBe("character.soldier");
      expect(soldier.state).toBe("charge");
    });
  });

  // ---------------------------------------------------------------------------
  // 16. GameSession Real E2E Flow (Section 19)
  // ---------------------------------------------------------------------------
  describe("16. GameSession Real E2E Flow (Section 19)", () => {
    it("16.1: Full GameSession lifecycle from Reverse request, pass progression, resolution interruption, state choice, to completion", () => {
      const k1 = { id: "k1", suit: "H", rank: "6", value: 6 };
      const k2 = { id: "k2", suit: "S", rank: "6", value: 6 };
      const targetSoldier = {
        unitId: "p2-target-sol",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        cards: [{ id: "c5", suit: "C", rank: "5", value: 5 }],
      };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [k1, k2],
            field: [],
            life: [{ id: "lp1", suit: "S", rank: "A" }],
            grave: [],
            fog: [],
          },
          p2: {
            hand: [],
            field: [targetSoldier],
            life: [{ id: "lp2", suit: "H", rank: "A" }],
            grave: [],
            fog: [],
          },
        },
        stage: { requests: [], history: [] },
        turnCount: 1,
        phase: "main",
      };

      const session = new GameSession(state, rulePackage);

      // Step 1: P1 decides action -> Reverse
      let step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p1");

      const revIdx = step.request.patterns.findIndex((p: any) => {
        if (p.actionSelectionRef === undefined) return false;
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.reverse";
      });
      expect(revIdx).toBeGreaterThanOrEqual(0);

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: revIdx,
      });

      // P1 PASS on Reverse
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p1");
      const passIdx1 = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx1,
      });

      // P2 PASS on Reverse -> Resolution begins!
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p2");
      const passIdx2 = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx2,
      });

      // Resolution halts with EFFECT_RESOLUTION (P1 chooses charge / drive)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("EFFECT_RESOLUTION");
      expect(step.request.playerId).toBe("p1");

      // Choose "drive"
      const chooseDriveIdx = step.request.patterns.findIndex((p: any) => {
        const sel = step.request.catalog.effectSelections[p.effectSelectionRef!];
        return Array.isArray(sel?.selectedValues) && sel.selectedValues.includes("drive");
      });
      expect(chooseDriveIdx).toBeGreaterThanOrEqual(0);

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: chooseDriveIdx,
      });

      // Reverse completed!
      // Verify target transformed into Bulwark with state "drive"
      expect(state.players.p2.field).toHaveLength(1);
      const transformedUnit = state.players.p2.field[0];
      expect(transformedUnit.componentId).toBe("character.bulwark");
      expect(transformedUnit.face).toBe("down");
      expect(transformedUnit.state).toBe("drive");

      // Keys finalized to grave
      expect(state.players.p1.hand).toHaveLength(0);
      expect(state.players.p1.grave).toHaveLength(2);

      // Stage is clean
      expect(state.stage.requests).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 17. MANDATORY E2E SCENARIO: Twist vs Armed Soldier Split (Section 20)
  // ---------------------------------------------------------------------------
  describe("17. Mandatory E2E: Twist vs Armed Soldier Split (Section 20)", () => {
    it("17.1: Opponent Twist targeting actual Armed Soldier fizzles when chained Reverse splits Armed Soldier into 2 Bulwarks", () => {
      const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
      expect(twistAction).toBeDefined();

      const twistKey = { id: "twist-key", suit: "D", rank: "7", value: 7 };
      const twistCost = { id: "twist-cost", suit: "C", rank: "2", value: 2 };
      const revKey1 = { id: "rev-k1", suit: "H", rank: "10", value: 10 };
      const revKey2 = { id: "rev-k2", suit: "S", rank: "10", value: 10 };

      const cardA = { id: "card-a", suit: "H", rank: "5", value: 5 };
      const cardB = { id: "card-b", suit: "S", rank: "6", value: 6 };

      // Use actual official componentId "character.armedSoldier"
      const armedSoldier = {
        unitId: "target-armed-soldier",
        componentId: "character.armedSoldier",
        state: "charge",
        face: "up",
        enteredFieldTurn: 1,
        cards: [cardA, cardB],
      };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [twistKey, twistCost],
            field: [],
            grave: [],
            life: [],
            fog: [],
          },
          p2: {
            hand: [revKey1, revKey2],
            field: [armedSoldier],
            grave: [],
            life: [],
            fog: [],
          },
        },
        stage: { requests: [], history: [] },
        stateVersion: 1,
        turnCount: 1,
      };

      const logRecorder = new MatchLogRecorder({ matchId: "e2e-twist-split" });
      const registry = new CommandRegistry();

      // Step 1: P1 requests Twist targeting P2's Armed Soldier (P1 has chance)
      const p1Context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: twistKey,
        targetComponent: armedSoldier,
        actions: rulePackage.actions,
        components: rulePackage.components,
        logRecorder,
      };
      const twistReq = registry.createRequest(twistAction, p1Context);
      expect(state.stage.requests).toHaveLength(1);
      expect(twistReq.id).toBeDefined();

      // Pass chance to P2 to allow quick Reverse chain
      state.chancePlayer = "p2";

      // Step 2: P2 chains Reverse targeting the same Armed Soldier
      const p2Context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [revKey1, revKey2],
        targetComponent: armedSoldier,
        actions: rulePackage.actions,
        components: rulePackage.components,
        logRecorder,
      };
      const revReq = registry.createRequest(reverseAction, p2Context);
      expect(state.stage.requests).toHaveLength(2);

      // Step 3: Stage LIFO resolution: Reverse resolves first
      expect(state.stage.requests[state.stage.requests.length - 1].id).toBe(revReq.id);

      const revStep1 = registry.resolveTopRequest(p2Context)!;
      expect(revStep1.type).toBe("WAITING_FOR_DECISION");
      expect(revStep1.continuation?.selectionId).toBe("reverseState");

      // P2 chooses "charge"
      const revStep2 = registry.resumeRequest(
        revReq,
        revStep1.continuation!,
        ["charge"],
        revStep1.context!
      );
      expect(revStep2.type).toBe("COMPLETED");

      // Verify: Armed Soldier has split into 2 Bulwarks!
      expect(state.players.p2.field).toHaveLength(2);
      expect(state.players.p2.field[0].unitId).toBe("target-armed-soldier-split-card-a");
      expect(state.players.p2.field[1].unitId).toBe("target-armed-soldier-split-card-b");
      expect(state.players.p2.field.find((u: any) => u.unitId === "target-armed-soldier")).toBeUndefined();

      // Step 4: Now Twist is at Stage TOP and resolves next
      expect(state.stage.requests).toHaveLength(1);
      expect(state.stage.requests[0].id).toBe(twistReq.id);

      const twistResolve = registry.resolveTopRequest(p1Context)!;
      expect(twistResolve.type).toBe("COMPLETED");

      // Step 5: Verify Twist fizzled due to target being invalid at resolution!
      const twistResolveEvent = logRecorder.getEvents().find(
        (e: any) => e.type === "request.resolved" && (e as any).requestId === twistReq.id
      ) as any;
      expect(twistResolveEvent).toBeDefined();
      expect(twistResolveEvent.effectSkipped).toBe(true);
      expect(twistResolveEvent.reason).toBe("TARGET_INVALID_AT_RESOLUTION");

      // Verify the 2 Bulwarks remained in "charge" state (not toggled to drive)
      expect(state.players.p2.field[0].state).toBe("charge");
      expect(state.players.p2.field[1].state).toBe("charge");
    });
  });

  // ---------------------------------------------------------------------------
  // 18. Hardcoding Guard & Boundary Verification (Section 21)
  // ---------------------------------------------------------------------------
  describe("18. Engine Hardcoding Guard", () => {
    it("18.1: CharacterTransformService contains ZERO occurrences of 'action.reverse'", () => {
      const filePath = path.resolve(__dirname, "../../engine/rules/CharacterTransformService.ts");
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).not.toContain("action.reverse");
      expect(content).not.toContain("action.");
    });

    it("18.2: keyCardGroupUtils contains ZERO occurrences of 'action.reverse'", () => {
      const filePath = path.resolve(__dirname, "../../engine/rules/keyCardGroupUtils.ts");
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).not.toContain("action.reverse");
      expect(content).not.toContain("action.");
    });
  });
});
