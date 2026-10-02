import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionRequest, ActionDefinition } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { MatchLogRecorder } from "../../engine/log/MatchLogRecorder";
import { formatActionSummary } from "../../engine/rules/formatActionSummary";
import { CharacterTransformService } from "../../engine/rules/CharacterTransformService";
import { getCanonicalCardNumber, matchesKeyGroupConstraints } from "../../engine/rules/keyCardGroupUtils";

describe("action.reverse (リバース) & Generic Character Transform Tests [BP-SIM-REG-5.0-G-PRO-REVERSE]", () => {
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
  // 2. Key Card sameRank Constraint Validation (Section 64.2 - 64.10)
  // ---------------------------------------------------------------------------
  describe("2. Key Card sameRank Constraint Validation", () => {
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

    it("2.5: Joker and Joker (0 and 0) is VALID", () => {
      const jk1 = { id: "jk1", suit: "JOKER", rank: "JOKER", value: 0 };
      const jk2 = { id: "jk2", suit: "JOKER", rank: "JOKER", value: 0 };
      const state: any = createValidatorState([jk1, jk2]);

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [jk1, jk2],
        targetComponent: state.players.p1.field[0],
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(() => validator.validateActionRequest(reverseAction, context)).not.toThrow();

      const groupRes = matchesKeyGroupConstraints([jk1, jk2], reverseAction.key!);
      expect(groupRes.isValid).toBe(true);
    });

    it("2.6: Joker and non-Joker FAILS validation (0 != rank)", () => {
      const jk1 = { id: "jk1", suit: "JOKER", rank: "JOKER", value: 0 };
      const c1 = { id: "c1", suit: "H", rank: "7", value: 7 };
      const state: any = createValidatorState([jk1, c1]);

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [jk1, c1],
        targetComponent: state.players.p1.field[0],
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(() => validator.validateActionRequest(reverseAction, context)).toThrow(/同じ数字/);

      const groupRes = matchesKeyGroupConstraints([jk1, c1], reverseAction.key!);
      expect(groupRes.isValid).toBe(false);
      expect(groupRes.reason).toContain("同じ数字");
    });

    it("2.7: Malformed card without valid rank FAILS validation (fail-closed)", () => {
      const badCard1 = { id: "b1", suit: "H" }; // no rank
      const badCard2 = { id: "b2", suit: "S" };
      const state: any = createValidatorState([badCard1, badCard2]);

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [badCard1 as any, badCard2 as any],
        targetComponent: state.players.p1.field[0],
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(() => validator.validateActionRequest(reverseAction, context)).toThrow();
    });

    it("2.8: Key card not in hand (e.g. in grave) FAILS validation", () => {
      const c1 = { id: "c1", suit: "H", rank: "7", value: 7 };
      const c2 = { id: "c2", suit: "S", rank: "7", value: 7 };
      const state: any = createValidatorState([c1]);
      state.players.p1.grave = [c2]; // c2 is in grave, not hand

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [c1, c2],
        targetComponent: state.players.p1.field[0],
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(() => validator.validateActionRequest(reverseAction, context)).toThrow(/存在しません/);
    });

    it("2.9: getCanonicalCardNumber helper behaves consistently and fail-closed", () => {
      expect(getCanonicalCardNumber({ rank: "A" })).toBe(1);
      expect(getCanonicalCardNumber({ rank: "2" })).toBe(2);
      expect(getCanonicalCardNumber({ rank: "10" })).toBe(10);
      expect(getCanonicalCardNumber({ rank: "J" })).toBe(11);
      expect(getCanonicalCardNumber({ rank: "Q" })).toBe(12);
      expect(getCanonicalCardNumber({ rank: "K" })).toBe(13);
      expect(getCanonicalCardNumber({ rank: "JOKER" })).toBe(0);
      expect(getCanonicalCardNumber({ suit: "JOKER" })).toBe(0);
      expect(getCanonicalCardNumber({ rank: "INVALID" })).toBeUndefined();
      expect(getCanonicalCardNumber(null)).toBeUndefined();
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

    it("3.3: generates reverse pattern for Joker pair", () => {
      const jk1 = { id: "jk1", suit: "JOKER", rank: "JOKER", value: 0 };
      const jk2 = { id: "jk2", suit: "JOKER", rank: "JOKER", value: 0 };

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
    it("4.1: targets both own and opponent character units (soldiers and bulwarks), but not non-characters", () => {
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
  // 5. Option Selection & Unit State Transitions (Section 64.20 - 64.26)
  // ---------------------------------------------------------------------------
  describe("5. Option Selection & Unit State Transitions (setUnitState)", () => {
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

    it("5.2: resumeRequest with 'drive' on a charge unit sets state to drive and emits unitStateChanged", () => {
      const { state, k1, k2, unit } = createResolutionState("charge");
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

      // Resume with selection 'drive'
      const resumeResult = registry.resumeRequest(
        req,
        step1.continuation!,
        ["drive"],
        step1.context!
      );

      expect(resumeResult.type).toBe("COMPLETED");

      // Unit state is now drive
      expect(unit.state).toBe("drive");

      // unitStateChanged event emitted
      const stateEvt = dispatchedEvents.find((e) => e.type === "unitStateChanged");
      expect(stateEvt).toBeDefined();
      expect(stateEvt.payload.fromState).toBe("charge");
      expect(stateEvt.payload.toState).toBe("drive");
    });

    it("5.3: resumeRequest with 'charge' on a charge unit is NO-OP and emits NO unitStateChanged", () => {
      const { state, k1, k2, unit } = createResolutionState("charge");
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

      // Resume with selection 'charge' (same as current)
      const resumeResult = registry.resumeRequest(
        req,
        step1.continuation!,
        ["charge"],
        step1.context!
      );

      expect(resumeResult.type).toBe("COMPLETED");
      expect(unit.state).toBe("charge");

      // NO unitStateChanged event
      const stateEvt = dispatchedEvents.find((e) => e.type === "unitStateChanged");
      expect(stateEvt).toBeUndefined();
    });

    it("5.4: resumeRequest on opponent unit works seamlessly across fields", () => {
      const { state, k1, k2, unit } = createResolutionState("drive", "p2");
      const registry = new CommandRegistry();

      const context: CommandContext = {
        state,
        playerKey: "p1", // P1 plays Reverse targeting P2's unit
        keyCards: [k1, k2],
        targetComponent: unit,
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      const req = registry.createRequest(reverseAction, context);
      const step1 = registry.resolveTopRequest(context)!;

      const resumeResult = registry.resumeRequest(
        req,
        step1.continuation!,
        ["charge"],
        step1.context!
      );

      expect(resumeResult.type).toBe("COMPLETED");
      expect(state.players.p2.field[0].state).toBe("charge");
      expect(state.players.p2.field[0].componentId).toBe("character.bulwark");
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Character Transformation: Soldier -> Bulwark (Section 64.27 - 64.33)
  // ---------------------------------------------------------------------------
  describe("6. Character Transformation: Soldier -> Bulwark", () => {
    it("6.1: 1-card Soldier transforms into Bulwark preserving unitId, state, and enteredFieldTurn", () => {
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
      expect(res.face).toBe("down"); // face down
      expect(res.state).toBe("charge");

      // In state
      expect(state.players.p1.field).toHaveLength(1);
      const fieldBulwark = state.players.p1.field[0];
      expect(fieldBulwark.unitId).toBe("soldier-1");
      expect(fieldBulwark.componentId).toBe("character.bulwark");
      expect(fieldBulwark.face).toBe("down");
      expect(fieldBulwark.enteredFieldTurn).toBe(2);
    });

    it("6.2: Single-card Hero (rank J) transforms into Bulwark face down", () => {
      const hero = {
        unitId: "hero-1",
        componentId: "character.hero",
        state: "drive",
        face: "up",
        cards: [{ id: "cj", suit: "H", rank: "J", value: 11 }],
      };

      const state: any = { players: { p1: { field: [hero] } } };
      const result = CharacterTransformService.transformCharacter({
        targetUnit: hero,
        state,
        components: rulePackage.components,
      });

      expect(result.results[0].componentId).toBe("character.bulwark");
      expect(result.results[0].face).toBe("down");
    });

    it("6.3: Single-card Ace (rank A) transforms into Bulwark face down", () => {
      const ace = {
        unitId: "ace-1",
        componentId: "character.ace",
        state: "charge",
        face: "up",
        cards: [{ id: "ca", suit: "S", rank: "A", value: 1 }],
      };

      const state: any = { players: { p1: { field: [ace] } } };
      const result = CharacterTransformService.transformCharacter({
        targetUnit: ace,
        state,
        components: rulePackage.components,
      });

      expect(result.results[0].componentId).toBe("character.bulwark");
      expect(result.results[0].face).toBe("down");
    });

    it("6.4: Single-card Magician (Joker) transforms into Bulwark face down", () => {
      const magician = {
        unitId: "mag-1",
        componentId: "character.magician",
        state: "charge",
        face: "up",
        cards: [{ id: "cjk", suit: "JOKER", rank: "JOKER", value: 0 }],
      };

      const state: any = { players: { p1: { field: [magician] } } };
      const result = CharacterTransformService.transformCharacter({
        targetUnit: magician,
        state,
        components: rulePackage.components,
      });

      expect(result.results[0].componentId).toBe("character.bulwark");
      expect(result.results[0].face).toBe("down");
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Character Transformation: Bulwark -> Soldier (Section 64.34 - 64.40)
  // ---------------------------------------------------------------------------
  describe("7. Character Transformation: Bulwark -> Soldier", () => {
    it("7.1: Bulwark with rank 2..10 card transforms into character.soldier face up", () => {
      const bulwark = {
        unitId: "bul-7",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        enteredFieldTurn: 1,
        cards: [{ id: "c7", suit: "H", rank: "7", value: 7 }],
      };

      const state: any = { players: { p1: { field: [bulwark] } } };
      const result = CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      expect(result.results).toHaveLength(1);
      const res = result.results[0];
      expect(res.unitId).toBe("bul-7");
      expect(res.componentId).toBe("character.soldier");
      expect(res.face).toBe("up");
      expect(res.state).toBe("charge");
    });

    it("7.2: Bulwark with rank J card transforms into character.hero face up", () => {
      const bulwark = {
        unitId: "bul-j",
        componentId: "character.bulwark",
        state: "drive",
        face: "down",
        cards: [{ id: "cj", suit: "S", rank: "J", value: 11 }],
      };

      const state: any = { players: { p1: { field: [bulwark] } } };
      const result = CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      expect(result.results[0].componentId).toBe("character.hero");
      expect(result.results[0].face).toBe("up");
      expect(result.results[0].state).toBe("drive");
    });

    it("7.3: Bulwark with rank A card transforms into character.ace face up", () => {
      const bulwark = {
        unitId: "bul-a",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [{ id: "ca", suit: "C", rank: "A", value: 1 }],
      };

      const state: any = { players: { p1: { field: [bulwark] } } };
      const result = CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      expect(result.results[0].componentId).toBe("character.ace");
      expect(result.results[0].face).toBe("up");
    });

    it("7.4: Bulwark with rank Q card transforms into character.hero face up", () => {
      const bulwark = {
        unitId: "bul-q",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [{ id: "cq", suit: "D", rank: "Q", value: 12 }],
      };

      const state: any = { players: { p1: { field: [bulwark] } } };
      const result = CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      expect(result.results[0].componentId).toBe("character.hero");
      expect(result.results[0].face).toBe("up");
    });

    it("7.4b: Bulwark with Joker card transforms into character.magician face up", () => {
      const bulwark = {
        unitId: "bul-jk",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [{ id: "cjk", suit: "JOKER", rank: "JOKER", value: 0 }],
      };

      const state: any = { players: { p1: { field: [bulwark] } } };
      const result = CharacterTransformService.transformCharacter({
        targetUnit: bulwark,
        state,
        components: rulePackage.components,
      });

      expect(result.results[0].componentId).toBe("character.magician");
      expect(result.results[0].face).toBe("up");
    });

    it("7.5: Bulwark with multi-cards throws error (Bulwark must have exactly 1 card)", () => {
      const illegalBulwark = {
        unitId: "bul-multi",
        componentId: "character.bulwark",
        state: "charge",
        cards: [
          { id: "c1", suit: "H", rank: "7", value: 7 },
          { id: "c2", suit: "S", rank: "7", value: 7 },
        ],
      };

      const state: any = { players: { p1: { field: [illegalBulwark] } } };
      expect(() => {
        CharacterTransformService.transformCharacter({
          targetUnit: illegalBulwark,
          state,
          components: rulePackage.components,
        });
      }).toThrow(/防壁の構成カード枚数が不正です/);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Multi-Card Soldier (Armed Soldier) Split (Section 64.41 - 64.47)
  // ---------------------------------------------------------------------------
  describe("8. Multi-Card Soldier Split into Multiple Bulwarks", () => {
    it("8.1: 2-card Armed Soldier splits into 2 Bulwarks with deterministic IDs, card order, and removes original unitId", () => {
      const cardA = { id: "card-base", suit: "H", rank: "5", value: 5 };
      const cardB = { id: "card-mount", suit: "S", rank: "6", value: 6 };

      const armedSoldier = {
        unitId: "armed-sol-1",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        enteredFieldTurn: 2,
        cards: [cardA, cardB],
      };

      const state: any = {
        players: {
          p1: {
            field: [armedSoldier],
          },
        },
      };

      const result = CharacterTransformService.transformCharacter({
        targetUnit: armedSoldier,
        state,
        components: rulePackage.components,
      });

      expect(result.results).toHaveLength(2);

      // Deterministic IDs: ${sourceUnit.unitId}-split-${card.id}
      expect(result.results[0].unitId).toBe("armed-sol-1-split-card-base");
      expect(result.results[0].cardIds).toEqual(["card-base"]);
      expect(result.results[0].componentId).toBe("character.bulwark");
      expect(result.results[0].face).toBe("down");

      expect(result.results[1].unitId).toBe("armed-sol-1-split-card-mount");
      expect(result.results[1].cardIds).toEqual(["card-mount"]);
      expect(result.results[1].componentId).toBe("character.bulwark");
      expect(result.results[1].face).toBe("down");

      // Verify state.players.p1.field
      const p1Field = state.players.p1.field;
      expect(p1Field).toHaveLength(2);

      // Original unitId completely vanished
      expect(p1Field.find((u: any) => u.unitId === "armed-sol-1")).toBeUndefined();

      // Card order preserved
      expect(p1Field[0].unitId).toBe("armed-sol-1-split-card-base");
      expect(p1Field[0].cards).toEqual([{ ...cardA, face: "down" }]);
      expect(p1Field[0].state).toBe("charge");
      expect(p1Field[0].enteredFieldTurn).toBe(2);

      expect(p1Field[1].unitId).toBe("armed-sol-1-split-card-mount");
      expect(p1Field[1].cards).toEqual([{ ...cardB, face: "down" }]);
      expect(p1Field[1].state).toBe("charge");
      expect(p1Field[1].enteredFieldTurn).toBe(2);
    });

    it("8.2: 3-card Armed Soldier splits into 3 Bulwarks preserving card order and conservation", () => {
      const c1 = { id: "c1", suit: "H", rank: "3", value: 3 };
      const c2 = { id: "c2", suit: "S", rank: "4", value: 4 };
      const c3 = { id: "c3", suit: "D", rank: "5", value: 5 };

      const tripleSoldier = {
        unitId: "triple-sol",
        componentId: "character.soldier",
        state: "drive",
        face: "up",
        enteredFieldTurn: 1,
        cards: [c1, c2, c3],
      };

      const state: any = {
        players: {
          p1: { field: [tripleSoldier] },
        },
      };

      const result = CharacterTransformService.transformCharacter({
        targetUnit: tripleSoldier,
        state,
        components: rulePackage.components,
      });

      expect(result.results).toHaveLength(3);
      expect(result.results[0].unitId).toBe("triple-sol-split-c1");
      expect(result.results[1].unitId).toBe("triple-sol-split-c2");
      expect(result.results[2].unitId).toBe("triple-sol-split-c3");

      const field = state.players.p1.field;
      expect(field).toHaveLength(3);
      expect(field[0].cards[0].id).toBe("c1");
      expect(field[1].cards[0].id).toBe("c2");
      expect(field[2].cards[0].id).toBe("c3");
      expect(field.every((u: any) => u.state === "drive")).toBe(true);
      expect(field.every((u: any) => u.face === "down")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Received Effects & Battle Role Cleanup (Section 64.48 - 64.52)
  // ---------------------------------------------------------------------------
  describe("9. Received Effects & Battle Role Cleanup", () => {
    it("9.1: detaches Fog bindings targeting unit without moving Fog card", () => {
      const soldier = {
        unitId: "soldier-fogged",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "sc1", suit: "S", rank: "5", value: 5 }],
      };

      const fogCard = {
        id: "fog-card-1",
        componentId: "fog.up",
        bindings: {
          target: "soldier-fogged",
        },
      };

      const state: any = {
        players: {
          p1: {
            field: [soldier],
            fog: [fogCard],
          },
        },
      };

      CharacterTransformService.transformCharacter({
        targetUnit: soldier,
        state,
        components: rulePackage.components,
        options: { clearReceivedEffects: true },
      });

      // Fog card remains in fog zone
      expect(state.players.p1.fog).toHaveLength(1);
      expect(state.players.p1.fog[0].id).toBe("fog-card-1");

      // Binding to soldier-fogged is deleted
      expect(state.players.p1.fog[0].bindings?.target).toBeUndefined();
    });

    it("9.2: clears battle role when clearBattleRole is true", () => {
      const attackingSoldier = {
        unitId: "attacker-sol",
        componentId: "character.soldier",
        state: "drive",
        battle: {
          role: "attacker",
          targetPlayerKey: "p2",
        },
        cards: [{ id: "ac1", suit: "H", rank: "9", value: 9 }],
      };

      const state: any = {
        players: {
          p1: { field: [attackingSoldier] },
        },
      };

      CharacterTransformService.transformCharacter({
        targetUnit: attackingSoldier,
        state,
        components: rulePackage.components,
        options: { clearBattleRole: true },
      });

      expect(attackingSoldier.battle).toBeUndefined();
    });

    it("9.3: Magician loses magician intrinsic component abilities when transformed into Bulwark", () => {
      const magician = {
        unitId: "mag-sol",
        componentId: "character.magician",
        state: "charge",
        cards: [{ id: "mc1", suit: "JOKER", rank: "JOKER", value: 0 }],
      };

      const state: any = { players: { p1: { field: [magician] } } };
      CharacterTransformService.transformCharacter({
        targetUnit: magician,
        state,
        components: rulePackage.components,
      });

      // The unit in field is character.bulwark, not character.magician
      expect(state.players.p1.field[0].componentId).toBe("character.bulwark");
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Canonical Log & Events (Section 64.53)
  // ---------------------------------------------------------------------------
  describe("10. Canonical Log & Events", () => {
    it("10.1: records unit.transformed in Canonical Match Log", () => {
      const k1 = { id: "k1", suit: "H", rank: "8", value: 8 };
      const k2 = { id: "k2", suit: "S", rank: "8", value: 8 };
      const soldier = {
        unitId: "log-sol",
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

      const logRecorder = new MatchLogRecorder({ matchId: "rev-log-test" });
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
      const transformEntry = logEntries.find((e: any) => e.type === "unit.transformed") as any;
      expect(transformEntry).toBeDefined();
      expect(transformEntry.sourceUnitId).toBe("log-sol");
      expect(transformEntry.sourceCharacterType).toBe("soldier");
      expect(transformEntry.results).toHaveLength(1);
      expect(transformEntry.results[0].unitId).toBe("log-sol");
      expect(transformEntry.results[0].characterType).toBe("bulwark");
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Edge Cases: Fizzle & Counter (Section 64.54 - 64.56)
  // ---------------------------------------------------------------------------
  describe("11. Edge Cases: Target Lost & Counter", () => {
    it("11.1: Reverse fizzles with TARGET_INVALID_AT_RESOLUTION if target unit disappears before resolution", () => {
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

    it("11.2: Reverse is cancelled when Counter is resolved above it", () => {
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
  // 12. MANDATORY E2E SCENARIO: Twist vs Armed Soldier Split (Section 64.57)
  // ---------------------------------------------------------------------------
  describe("12. Mandatory E2E: Twist vs Armed Soldier Split", () => {
    it("12.1: Opponent Twist targeting Armed Soldier fizzles when chained Reverse splits Armed Soldier into 2 Bulwarks", () => {
      const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
      expect(twistAction).toBeDefined();

      const twistKey = { id: "twist-key", suit: "D", rank: "7", value: 7 };
      const twistCost = { id: "twist-cost", suit: "C", rank: "2", value: 2 };
      const revKey1 = { id: "rev-k1", suit: "H", rank: "10", value: 10 };
      const revKey2 = { id: "rev-k2", suit: "S", rank: "10", value: 10 };

      const cardA = { id: "card-a", suit: "H", rank: "5", value: 5 };
      const cardB = { id: "card-b", suit: "S", rank: "6", value: 6 };

      const armedSoldier = {
        unitId: "target-armed-soldier",
        componentId: "character.soldier",
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
      // Stage TOP is Reverse
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
  // 13. Hardcoding Guard & Boundary Verification (Section 64.58)
  // ---------------------------------------------------------------------------
  describe("13. Engine Hardcoding Guard", () => {
    it("13.1: CharacterTransformService contains ZERO occurrences of 'action.reverse'", () => {
      const filePath = path.resolve(__dirname, "../../engine/rules/CharacterTransformService.ts");
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).not.toContain("action.reverse");
      expect(content).not.toContain("action.");
    });

    it("13.2: keyCardGroupUtils contains ZERO occurrences of 'action.reverse'", () => {
      const filePath = path.resolve(__dirname, "../../engine/rules/keyCardGroupUtils.ts");
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).not.toContain("action.reverse");
      expect(content).not.toContain("action.");
    });
  });
});
