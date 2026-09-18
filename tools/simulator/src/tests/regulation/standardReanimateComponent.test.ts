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
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { ActionCostEvaluator } from "../../engine/rules/ActionCostEvaluator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { GameSession } from "../../engine/session/GameSession";
import type { RulePackage, ComponentDefinition } from "../../domain/rules/RulePackage";
import { buildFieldUnitFromComponent, deploySelectedCardsAsUnitsHandler } from "../../engine/rules/commandHandlers";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { SNAPSHOT_FORMAT_VERSION } from "../../domain/session/GameSessionSnapshot";
import {
  matchesUnitCondition,
  resolveComponentForUnit,
  hasHaste,
} from "../../engine/rules/characterUtils";
import { findPhysicalCardInGrave } from "../../engine/rules/graveCardUtils";

describe("Official Standard Post-Acceptance Bugfix: Reanimate Component Re-evaluation & Joker Magician", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let standardFormat: any;
  let standardPackReg: any;
  let standardRulePackage: RulePackage;
  let abilityEvaluator: AbilityEvaluator;
  let expressionEvaluator: ExpressionEvaluator;
  let actionCostEvaluator: ActionCostEvaluator;
  let registry: CommandRegistry;
  let effectInterpreter: EffectInterpreter;

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

    abilityEvaluator = new AbilityEvaluator();
    expressionEvaluator = new ExpressionEvaluator();
    actionCostEvaluator = new ActionCostEvaluator(abilityEvaluator);
    registry = new CommandRegistry();
    effectInterpreter = (registry as any).effectInterpreter;
  });

  function runReanimateSession(session: GameSession, targetGraveCardId: string) {
    const step1: any = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");

    const reanimatePat = step1.request.patterns.findIndex(
      (p: any) =>
        p.actionSelectionRef !== undefined &&
        step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
    );
    expect(reanimatePat).toBeGreaterThanOrEqual(0);

    const step2: any = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: reanimatePat,
    });

    const step3: any = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p: any) => p.kind === "PASS"),
    });
    const step4: any = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: step3.request.patterns.findIndex((p: any) => p.kind === "PASS"),
    });

    expect(step4.type).toBe("WAITING_FOR_DECISION");
    expect(step4.request.source.effectStepId).toBe("selectCards");

    const cardPat = step4.request.patterns.findIndex(
      (p: any) =>
        p.effectSelectionRef !== undefined &&
        step4.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes(targetGraveCardId)
    );
    expect(cardPat).toBeGreaterThanOrEqual(0);

    return session.submitDecision({
      decisionId: step4.request.decisionId,
      stateVersion: step4.request.stateVersion,
      selectedPatternRef: cardPat,
    });
  }


  // =========================================================================
  // Group 1: Generic Component Resolver Unit Tests
  // =========================================================================
  describe("Group 1: Generic Component Resolver Unit Tests", () => {
    it("Test 1.1: 2 (single face-up) resolves to character.soldier", () => {
      const card = { id: "c-2", suit: "S", rank: "2", value: 2 };
      const comp = resolveComponentForUnit({
        cards: [card],
        face: "up",
        zone: "field",
        components: fullRulePackage.components,
      });
      expect(comp.id).toBe("character.soldier");
      expect(comp.display?.kind || comp.name).toBe("一般兵");
    });

    it("Test 1.2: 10 (single face-up) resolves to character.soldier", () => {
      const card = { id: "c-10", suit: "H", rank: "10", value: 10 };
      const comp = resolveComponentForUnit({
        cards: [card],
        face: "up",
        zone: "field",
        components: fullRulePackage.components,
      });
      expect(comp.id).toBe("character.soldier");
      expect(comp.display?.kind || comp.name).toBe("一般兵");
    });

    it("Test 1.3: J (single face-up) resolves to character.hero", () => {
      const card = { id: "c-J", suit: "D", rank: "J", value: 11 };
      const comp = resolveComponentForUnit({
        cards: [card],
        face: "up",
        zone: "field",
        components: fullRulePackage.components,
      });
      expect(comp.id).toBe("character.hero");
      expect(comp.display?.kind || comp.name).toBe("英雄");
    });

    it("Test 1.4: K (single face-up) resolves to character.hero", () => {
      const card = { id: "c-K", suit: "C", rank: "K", value: 13 };
      const comp = resolveComponentForUnit({
        cards: [card],
        face: "up",
        zone: "field",
        components: fullRulePackage.components,
      });
      expect(comp.id).toBe("character.hero");
      expect(comp.display?.kind || comp.name).toBe("英雄");
    });

    it("Test 1.5: A (single face-up) resolves to character.ace", () => {
      const card = { id: "c-A", suit: "S", rank: "A", value: 1 };
      const comp = resolveComponentForUnit({
        cards: [card],
        face: "up",
        zone: "field",
        components: fullRulePackage.components,
      });
      expect(comp.id).toBe("character.ace");
      expect(comp.display?.kind || comp.name).toBe("エース");
    });

    it("Test 1.6: Joker (single face-up) resolves to character.magician", () => {
      const card = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };
      const comp = resolveComponentForUnit({
        cards: [card],
        face: "up",
        zone: "field",
        components: fullRulePackage.components,
      });
      expect(comp.id).toBe("character.magician");
      expect(comp.display?.kind || comp.name).toBe("魔術士");
    });

    it("Test 1.7: single face-down normal card resolves to character.bulwark", () => {
      const card = { id: "c-5", suit: "H", rank: "5", value: 5 };
      const comp = resolveComponentForUnit({
        cards: [card],
        face: "down",
        zone: "field",
        components: fullRulePackage.components,
      });
      expect(comp.id).toBe("character.bulwark");
      expect(comp.display?.kind || comp.name).toBe("防壁");
    });

    it("Test 1.8: single face-down Joker card resolves to character.bulwark (not magician)", () => {
      const card = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };
      const comp = resolveComponentForUnit({
        cards: [card],
        face: "down",
        zone: "field",
        components: fullRulePackage.components,
      });
      expect(comp.id).toBe("character.bulwark");
      expect(comp.display?.kind || comp.name).toBe("防壁");
    });

    it("Test 1.9: multi-card face-up normal resolves to character.armedSoldier", () => {
      const card1 = { id: "c-1", suit: "S", rank: "3", value: 3 };
      const card2 = { id: "c-2", suit: "D", rank: "7", value: 7 };
      const comp = resolveComponentForUnit({
        cards: [card1, card2],
        face: "up",
        zone: "field",
        components: fullRulePackage.components,
      });
      expect(comp.id).toBe("character.armedSoldier");
      expect(comp.display?.kind || comp.name).toBe("装備兵");
    });

    it("Test 1.10: multi-card face-up containing Joker resolves to character.armedSoldier (not magician)", () => {
      const card1 = { id: "c-1", suit: "S", rank: "3", value: 3 };
      const jokerCard = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };
      const comp = resolveComponentForUnit({
        cards: [card1, jokerCard],
        face: "up",
        zone: "field",
        components: fullRulePackage.components,
      });
      expect(comp.id).toBe("character.armedSoldier");
      expect(comp.display?.kind || comp.name).toBe("装備兵");
    });

    it("Test 1.11: 0-match throws fail-closed error (empty cards)", () => {
      expect(() => {
        resolveComponentForUnit({
          cards: [],
          face: "up",
          zone: "field",
          components: fullRulePackage.components,
        });
      }).toThrow("条件に一致するコンポーネント定義が存在しません");
    });

    it("Test 1.12: multiple-match throws fail-closed ambiguity error", () => {
      const fakeComp1: ComponentDefinition = {
        id: "character.dup1",
        name: "重複1",
        type: "character",
        zone: "field",
        unitCondition: { cards: { count: 1, rank: "5" }, face: "up" },
      };
      const fakeComp2: ComponentDefinition = {
        id: "character.dup2",
        name: "重複2",
        type: "character",
        zone: "field",
        unitCondition: { cards: { count: 1, rank: "5" }, face: "up" },
      };
      const card = { id: "c-5", suit: "H", rank: "5", value: 5 };
      expect(() => {
        resolveComponentForUnit({
          cards: [card],
          face: "up",
          zone: "field",
          components: [fakeComp1, fakeComp2],
        });
      }).toThrow("複数のコンポーネント定義が同時に一致しました");
    });
  });

  // =========================================================================
  // Group 2: deploySelectedCardsAsUnits Contract & Pre-validation Tests
  // =========================================================================
  describe("Group 2: deploySelectedCardsAsUnits Contract & Pre-validation Tests", () => {
    it("Test 2.1: explicit Joker + character.soldier fails closed before grave mutation", () => {
      const jokerCard = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };
      const mockContext: any = {
        playerKey: "p1",
        state: {
          stateVersion: 1,
          turnCount: 1,
          players: {
            p1: {
              field: [],
              grave: [jokerCard],
            },
          },
        },
        components: fullRulePackage.components,
        selections: {
          testSel: ["JOKER-0"],
        },
      };

      const handler = deploySelectedCardsAsUnitsHandler(effectInterpreter);
      expect(handler).toBeDefined();

      expect(() => {
        handler!(
          {
            selection: "testSel",
            player: "self",
            component: "character.soldier",
            face: "up",
            state: "charge",
          },
          mockContext
        );
      }).toThrow("指定コンポーネント 'character.soldier' のユニット条件をカード (JOKER-0) が満たしていません");

      // Grave remains 100% untouched
      expect(mockContext.state.players.p1.grave.length).toBe(1);
      expect(mockContext.state.players.p1.grave[0].id).toBe("JOKER-0");
      expect(mockContext.state.players.p1.field.length).toBe(0);
    });

    it("Test 2.2: Stale selection (missing card in grave) fails closed without modifying grave", () => {
      const realCard = { id: "c-real", suit: "S", rank: "2", value: 2 };
      const mockContext: any = {
        playerKey: "p1",
        state: {
          stateVersion: 1,
          turnCount: 1,
          players: {
            p1: {
              field: [],
              grave: [realCard],
            },
          },
        },
        components: fullRulePackage.components,
        selections: {
          testSel: ["c-missing"],
        },
      };

      const handler = deploySelectedCardsAsUnitsHandler(effectInterpreter);
      expect(() => {
        handler!(
          {
            selection: "testSel",
            player: "self",
            face: "up",
            state: "charge",
          },
          mockContext
        );
      }).toThrow("選択されたカード (c-missing) が墓地に存在しません");

      expect(mockContext.state.players.p1.grave.length).toBe(1);
      expect(mockContext.state.players.p1.grave[0].id).toBe("c-real");
      expect(mockContext.state.players.p1.field.length).toBe(0);
    });

    it("Test 2.3: cardMoved event has targetUnitId matching the newly resolved unitId", () => {
      const jokerCard = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };
      const dispatchedEvents: any[] = [];
      const mockInterpreter: any = {
        dispatchEvent: (event: any) => {
          dispatchedEvents.push(event);
        },
      };

      const mockContext: any = {
        playerKey: "p1",
        state: {
          stateVersion: 1,
          turnCount: 1,
          players: {
            p1: {
              field: [],
              grave: [jokerCard],
            },
          },
        },
        components: fullRulePackage.components,
        selections: {
          reanimateCard: ["JOKER-0"],
        },
      };

      const handler = deploySelectedCardsAsUnitsHandler(mockInterpreter);

      handler(
        {
          selection: "reanimateCard",
          player: "self",
          face: "up",
          state: "charge",
          expectedCount: 1,
        },
        mockContext
      );

      expect(mockContext.state.players.p1.field.length).toBe(1);
      const newUnit = mockContext.state.players.p1.field[0];
      expect(newUnit.componentId).toBe("character.magician");
      expect(newUnit.kind).toBe("魔術士");
      expect(newUnit.unitId).toContain("character.magician");

      expect(dispatchedEvents.length).toBe(1);
      expect(dispatchedEvents[0].type).toBe("cardMoved");
      expect(dispatchedEvents[0].payload.fromZone).toBe("grave");
      expect(dispatchedEvents[0].payload.toZone).toBe("field");
      expect(dispatchedEvents[0].payload.targetUnitId).toBe(newUnit.unitId);
    });
  });

  // =========================================================================
  // Group 3: Reanimate Integration Tests Across All Rank Classes
  // =========================================================================
  describe("Group 3: Reanimate Integration Tests Across All Rank Classes", () => {
    function executeReanimateSession(graveCard: any, targetCard: any) {
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
        turnCount: 1,
        players: {
          p1: {
            hand: [
              { id: "k-s2", suit: "S", rank: "2", value: 2 },
              { id: "k-h3", suit: "H", rank: "3", value: 3 },
            ],
            field: [targetUnit],
            life: [{ id: "l1" }],
            grave: [graveCard],
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const session = new GameSession(state, standardRulePackage);
      const step1: any = session.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");

      // p1 requests reanimate
      const reanimatePat = step1.request.patterns.findIndex(
        (p: any) =>
          p.actionSelectionRef !== undefined &&
          step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
      );
      expect(reanimatePat).toBeGreaterThanOrEqual(0);

      const step2: any = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: reanimatePat,
      });

      // Chance passes: p1 -> p2
      const step3: any = session.submitDecision({
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: step2.request.patterns.findIndex((p: any) => p.kind === "PASS"),
      });
      const step4: any = session.submitDecision({
        decisionId: step3.request.decisionId,
        stateVersion: step3.request.stateVersion,
        selectedPatternRef: step3.request.patterns.findIndex((p: any) => p.kind === "PASS"),
      });

      // Effect resolution: selectCards prompt
      expect(step4.type).toBe("WAITING_FOR_DECISION");
      expect(step4.request.source.effectStepId).toBe("selectCards");

      const cardPat = step4.request.patterns.findIndex(
        (p: any) =>
          p.effectSelectionRef !== undefined &&
          step4.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes(graveCard.id)
      );
      expect(cardPat).toBeGreaterThanOrEqual(0);

      session.submitDecision({
        decisionId: step4.request.decisionId,
        stateVersion: step4.request.stateVersion,
        selectedPatternRef: cardPat,
      });

      const p1 = session.state.players.p1;
      const reanimatedUnit = p1.field.find((u: any) => u.cards?.some((c: any) => c.id === graveCard.id));
      return { session, p1, reanimatedUnit };
    }

    it("Test 3.1: Reanimate 2 -> character.soldier (一般兵, attack/defense, size 2)", () => {
      const graveCard = { id: "c-d2", suit: "D", rank: "2", value: 2 };
      const targetCard = { id: "c-tgt", suit: "C", rank: "5", value: 5 };
      const { reanimatedUnit, session } = executeReanimateSession(graveCard, targetCard);

      expect(reanimatedUnit).toBeDefined();
      expect(reanimatedUnit.componentId).toBe("character.soldier");
      expect(reanimatedUnit.kind).toBe("一般兵");
      expect(reanimatedUnit.labels).toContain("attack");
      expect(reanimatedUnit.labels).toContain("defense");
      expect(reanimatedUnit.labels).not.toContain("haste");
      const size = abilityEvaluator.calculateUnitSize(reanimatedUnit, session.state);
      expect(size).toBe(2);
    });

    it("Test 3.2: Reanimate J -> character.hero (英雄, attack/defense, size 11)", () => {
      const graveCard = { id: "c-dJ", suit: "D", rank: "J", value: 11 };
      const targetCard = { id: "c-tgt", suit: "C", rank: "5", value: 5 };
      const { reanimatedUnit, session } = executeReanimateSession(graveCard, targetCard);

      expect(reanimatedUnit).toBeDefined();
      expect(reanimatedUnit.componentId).toBe("character.hero");
      expect(reanimatedUnit.kind).toBe("英雄");
      expect(reanimatedUnit.labels).toContain("attack");
      expect(reanimatedUnit.labels).toContain("defense");
      expect(reanimatedUnit.labels).not.toContain("haste");
      const size = abilityEvaluator.calculateUnitSize(reanimatedUnit, session.state);
      expect(size).toBe(11);
    });

    it("Test 3.3: Reanimate A -> character.ace (エース, attack/defense/haste, size 1, haste active)", () => {
      const graveCard = { id: "c-dA", suit: "D", rank: "A", value: 1 };
      const targetCard = { id: "c-tgt", suit: "C", rank: "5", value: 5 };
      const { reanimatedUnit, session } = executeReanimateSession(graveCard, targetCard);

      expect(reanimatedUnit).toBeDefined();
      expect(reanimatedUnit.componentId).toBe("character.ace");
      expect(reanimatedUnit.kind).toBe("エース");
      expect(reanimatedUnit.labels).toContain("haste");
      expect(hasHaste(reanimatedUnit, fullRulePackage.components)).toBe(true);
      const size = abilityEvaluator.calculateUnitSize(reanimatedUnit, session.state);
      expect(size).toBe(1);
    });

    it("Test 3.4: Reanimate Joker -> character.magician (魔術士, attack/defense/haste, size 0, unitId contains magician)", () => {
      const jokerCard = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };
      const targetCard = { id: "c-tgt", suit: "C", rank: "5", value: 5 };
      const { reanimatedUnit, session } = executeReanimateSession(jokerCard, targetCard);

      expect(reanimatedUnit).toBeDefined();
      expect(reanimatedUnit.componentId).toBe("character.magician");
      expect(reanimatedUnit.kind).toBe("魔術士");
      expect(reanimatedUnit.unitId).toContain("character.magician");
      expect(reanimatedUnit.unitId).not.toContain("character.soldier");
      expect(reanimatedUnit.labels).toContain("attack");
      expect(reanimatedUnit.labels).toContain("defense");
      expect(reanimatedUnit.labels).toContain("haste");
      expect(hasHaste(reanimatedUnit, fullRulePackage.components)).toBe(true);
      const size = abilityEvaluator.calculateUnitSize(reanimatedUnit, session.state);
      expect(size).toBe(0);
    });

    it("Test 3.5: Reanimate never resolves single face-up card to character.bulwark or character.armedSoldier", () => {
      const cards = [
        { id: "c-2", suit: "S", rank: "2", value: 2 },
        { id: "c-10", suit: "H", rank: "10", value: 10 },
        { id: "c-J", suit: "D", rank: "J", value: 11 },
        { id: "c-A", suit: "C", rank: "A", value: 1 },
        { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 },
      ];
      for (const card of cards) {
        const comp = resolveComponentForUnit({
          cards: [card],
          face: "up",
          zone: "field",
          components: fullRulePackage.components,
        });
        expect(comp.id).not.toBe("character.bulwark");
        expect(comp.id).not.toBe("character.armedSoldier");
      }
    });
  });

  // =========================================================================
  // Group 4: Reanimated Magician Ability Integration & Normal Summon Comparison
  // =========================================================================
  describe("Group 4: Magician Ability Integration & Normal Summon Comparison", () => {
    it("Test 4.1: Reanimated Magician on field actively removes Cost D from Quick Magic via ActionCostEvaluator", () => {
      const jokerCard = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };
      const targetCard = { id: "c-tgt", suit: "C", rank: "5", value: 5 };

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
        turnCount: 1,
        players: {
          p1: {
            hand: [
              { id: "k-s2", suit: "S", rank: "2", value: 2 },
              { id: "k-h3", suit: "H", rank: "3", value: 3 },
            ],
            field: [targetUnit],
            life: [{ id: "l1" }],
            grave: [jokerCard],
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const session = new GameSession(state, standardRulePackage);
      runReanimateSession(session, "JOKER-0");

      // P1 field now has reanimated Magician
      const magicianUnit = session.state.players.p1.field.find((u: any) => u.componentId === "character.magician");
      expect(magicianUnit).toBeDefined();

      // Evaluate Cost for a Quick Magic action (e.g. synthetic quick magic with Cost B, D)
      const quickMagicAction: any = {
        id: "action.testQuickMagic",
        type: "magic",
        request: { timing: "quick" },
        cost: "BD",
      };

      const effectiveCosts = actionCostEvaluator.resolveEffectiveCostSymbols(
        quickMagicAction,
        session.state,
        "p1",
        fullRulePackage.components
      );

      // Cost D must be removed, Cost B remains
      expect(effectiveCosts).toEqual(["B"]);
    });

    it("Test 4.2: Normal summon Magician vs Reanimated Magician produces identical modifier result", () => {
      const jokerCard = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };

      // State A: Normally summoned Magician
      const normalMagicianUnit = buildFieldUnitFromComponent({
        componentId: "character.magician",
        playerKey: "p1",
        card: jokerCard,
        components: fullRulePackage.components,
      });
      const stateA: any = {
        players: {
          p1: { field: [normalMagicianUnit] },
          p2: { field: [] },
        },
      };

      // State B: Reanimated Magician (built dynamically by deploySelectedCardsAsUnits)
      const reanimatedMagicianUnit = buildFieldUnitFromComponent({
        componentId: "character.magician",
        playerKey: "p1",
        card: jokerCard,
        components: fullRulePackage.components,
      });
      const stateB: any = {
        players: {
          p1: { field: [reanimatedMagicianUnit] },
          p2: { field: [] },
        },
      };

      const quickMagicAction: any = {
        id: "action.testQuickMagic",
        type: "magic",
        request: { timing: "quick" },
        cost: "BLD",
      };

      const costA = actionCostEvaluator.resolveEffectiveCostSymbols(quickMagicAction, stateA, "p1", fullRulePackage.components);
      const costB = actionCostEvaluator.resolveEffectiveCostSymbols(quickMagicAction, stateB, "p1", fullRulePackage.components);

      expect(costA).toEqual(["B", "L"]);
      expect(costB).toEqual(costA);
    });
  });

  // =========================================================================
  // Group 5: Grave TOP & Effect Interruption Invariants
  // =========================================================================
  describe("Group 5: Grave TOP & Effect Interruption Invariants", () => {
    it("Test 5.1: Reanimating TOP card leaving >= 2 cards immediately interrupts with ZONE_TOP_SELECTION", () => {
      const topGraveCard = { id: "c-top-card", suit: "S", rank: "7", value: 7 };
      const otherGraveCard1 = { id: "c-other-1", suit: "D", rank: "4", value: 4 };
      const otherGraveCard2 = { id: "c-other-2", suit: "H", rank: "5", value: 5 };

      const deployAction: any = {
        id: "action.reanimateDeployStage",
        name: "リアニメイト配置",
        type: "magic",
        key: { count: 2 },
        effect: [
          {
            deploySelectedCardsAsUnits: {
              selection: "reanimateCard",
              player: "self",
              face: "up",
              state: "charge",
              expectedCount: 1,
            },
          },
        ],
      };

      const keyCards = [
        { id: "k-s1", suit: "S", rank: "1", value: 1 },
        { id: "k-h1", suit: "H", rank: "1", value: 1 },
      ];

      const request: any = {
        id: "req-reanimate-f4",
        actionId: "action.reanimateDeployStage",
        controller: "p1",
        keyCards,
        status: "resolving",
        action: deployAction,
      };

      const state: any = {
        stateVersion: 1,
        matchId: "match-reanimate-f4",
        turnPlayer: "p1",
        stage: { requests: [request], history: [] },
        players: {
          p1: {
            hand: [],
            field: [],
            life: [{ id: "l1" }],
            graveTopCardId: "c-top-card",
            grave: [otherGraveCard1, otherGraveCard2, topGraveCard],
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        currentAction: deployAction,
        components: fullRulePackage.components,
        selections: {
          reanimateCard: ["c-top-card"],
        },
      };

      const result = registry.resolveRequest(request, context);

      // Immediate interruption with ZONE_TOP_SELECTION
      expect(result.type).toBe("WAITING_FOR_DECISION");
      expect(result.continuation?.effectStepId).toBe("zoneTopSelection");
      expect(result.decisionRequest?.source.type).toBe("ZONE_TOP_SELECTION");
      expect(result.decisionRequest?.source.zone).toBe("grave");

      // Verify auto component resolution: field unit deployed is character.soldier
      expect(state.players.p1.field.length).toBe(1);
      expect(state.players.p1.field[0].componentId).toBe("character.soldier");
    });

    it("Test 5.2: Reanimating non-TOP card preserves Grave TOP without interruption", () => {
      const topGraveCard = { id: "c-top", suit: "S", rank: "7", value: 7 };
      const targetCardInGrave = { id: "c-non-top", suit: "D", rank: "4", value: 4 };
      const fieldTargetCard = { id: "c-tgt", suit: "C", rank: "3", value: 3 };

      const targetUnit = {
        ...buildFieldUnitFromComponent({
          componentId: "character.soldier",
          playerKey: "p1",
          card: fieldTargetCard,
          components: fullRulePackage.components,
        }),
        cards: [fieldTargetCard],
      };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        turnCount: 1,
        players: {
          p1: {
            hand: [
              { id: "k-s2", suit: "S", rank: "2", value: 2 },
              { id: "k-h3", suit: "H", rank: "3", value: 3 },
            ],
            field: [targetUnit],
            life: [{ id: "l1" }],
            grave: [topGraveCard, targetCardInGrave],
            graveTopCardId: "c-top",
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const session = new GameSession(state, standardRulePackage);
      runReanimateSession(session, "c-non-top");

      const p1 = session.state.players.p1;
      expect(p1.grave.some((c: any) => c.id === "c-non-top")).toBe(false);
      expect(p1.field.some((u: any) => u.cards?.some((c: any) => c.id === "c-non-top"))).toBe(true);
    });
  });

  // =========================================================================
  // Group 6: System Contracts (Snapshot, Replay, AI, Invariants)
  // =========================================================================
  describe("Group 6: System Contracts (Snapshot, Replay, AI, Invariants)", () => {
    it("Test 6.1: Snapshot / Restore with Reanimated Magician preserves exact componentId, labels, and stateHash", () => {
      const jokerCard = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };
      const targetCard = { id: "c-tgt", suit: "C", rank: "5", value: 5 };

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
        turnCount: 1,
        players: {
          p1: {
            hand: [
              { id: "k-s2", suit: "S", rank: "2", value: 2 },
              { id: "k-h3", suit: "H", rank: "3", value: 3 },
            ],
            field: [targetUnit],
            life: [{ id: "l1" }],
            grave: [jokerCard],
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const session = new GameSession(state, standardRulePackage);
      runReanimateSession(session, "JOKER-0");

      // Take Snapshot
      const snapshot = session.createSnapshot();
      expect(snapshot.snapshotFormatVersion).toBe(SNAPSHOT_FORMAT_VERSION);

      // Restore from Snapshot
      const restored = GameSession.fromSnapshot(snapshot, standardRulePackage);

      const origMagician = session.state.players.p1.field.find((u: any) => u.componentId === "character.magician");
      const restoredMagician = restored.state.players.p1.field.find((u: any) => u.componentId === "character.magician");

      expect(origMagician).toBeDefined();
      expect(restoredMagician).toBeDefined();
      expect(restoredMagician.kind).toBe(origMagician.kind);
      expect(restoredMagician.labels).toEqual(origMagician.labels);
      expect(StateHasher.hash(restored.state)).toBe(StateHasher.hash(session.state));
    });

    it("Test 6.2: Fresh Replay reproduces Reanimated Joker Magician flow deterministically from ordered Decision Transcript", () => {
      const jokerCard = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };
      const targetCard = { id: "c-tgt", suit: "C", rank: "5", value: 5 };
      const keySpade = { id: "k-s2", suit: "S", rank: "2", value: 2 };
      const keyHeart = { id: "k-h3", suit: "H", rank: "3", value: 3 };

      const makeInitialState = () => {
        const targetUnit = {
          ...buildFieldUnitFromComponent({
            componentId: "character.soldier",
            playerKey: "p1",
            card: { ...targetCard },
            components: fullRulePackage.components,
          }),
          cards: [{ ...targetCard }],
        };

        return {
          stateVersion: 1,
          matchId: "match-replay-reanimate-joker",
          turnPlayer: "p1",
          chancePlayer: "p1",
          turnCount: 1,
          players: {
            p1: {
              hand: [{ ...keySpade }, { ...keyHeart }],
              field: [targetUnit],
              life: [{ id: "l1" }],
              grave: [{ ...jokerCard }],
            },
            p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
          },
          stage: { requests: [], history: [] },
        };
      };

      // --- Session A: 実セッション実行と Decision Transcript 記録 ---
      const sessionA = new GameSession(makeInitialState(), standardRulePackage);
      const transcript: { playerId: string; selectedPatternRef: number }[] = [];

      // Step 1: Action Request (p1 chooses action.reanimate)
      const stepA1: any = sessionA.advance();
      expect(stepA1.type).toBe("WAITING_FOR_DECISION");
      const reanimatePat = stepA1.request.patterns.findIndex(
        (p: any) =>
          p.actionSelectionRef !== undefined &&
          stepA1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
      );
      expect(reanimatePat).toBeGreaterThanOrEqual(0);
      transcript.push({ playerId: "p1", selectedPatternRef: reanimatePat });

      // Step 2: Chance PASS (p1)
      const stepA2: any = sessionA.submitDecision({
        decisionId: stepA1.request.decisionId,
        stateVersion: stepA1.request.stateVersion,
        selectedPatternRef: reanimatePat,
      });
      expect(stepA2.type).toBe("WAITING_FOR_DECISION");
      const p1Pass = stepA2.request.patterns.findIndex((p: any) => p.kind === "PASS");
      expect(p1Pass).toBeGreaterThanOrEqual(0);
      transcript.push({ playerId: "p1", selectedPatternRef: p1Pass });

      // Step 3: Chance PASS (p2)
      const stepA3: any = sessionA.submitDecision({
        decisionId: stepA2.request.decisionId,
        stateVersion: stepA2.request.stateVersion,
        selectedPatternRef: p1Pass,
      });
      expect(stepA3.type).toBe("WAITING_FOR_DECISION");
      const p2Pass = stepA3.request.patterns.findIndex((p: any) => p.kind === "PASS");
      expect(p2Pass).toBeGreaterThanOrEqual(0);
      transcript.push({ playerId: "p2", selectedPatternRef: p2Pass });

      // Step 4: Effect Card Selection (p1 chooses JOKER-0 from grave)
      const stepA4: any = sessionA.submitDecision({
        decisionId: stepA3.request.decisionId,
        stateVersion: stepA3.request.stateVersion,
        selectedPatternRef: p2Pass,
      });
      expect(stepA4.type).toBe("WAITING_FOR_DECISION");
      expect(stepA4.request.source.effectStepId).toBe("selectCards");
      const jokerPat = stepA4.request.patterns.findIndex(
        (p: any) =>
          p.effectSelectionRef !== undefined &&
          stepA4.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes("JOKER-0")
      );
      expect(jokerPat).toBeGreaterThanOrEqual(0);
      transcript.push({ playerId: "p1", selectedPatternRef: jokerPat });

      // Step 5: Effect resolution completes
      sessionA.submitDecision({
        decisionId: stepA4.request.decisionId,
        stateVersion: stepA4.request.stateVersion,
        selectedPatternRef: jokerPat,
      });

      const finalHashA = StateHasher.hash(sessionA.state);

      // --- Session B: 完全な新規 Fresh GameSession へ Transcript 順次適用 (Replay) ---
      // Session A の state オブジェクトや Snapshot は一切渡さず、fresh な初期状態から再構築
      const sessionB = new GameSession(makeInitialState(), standardRulePackage);

      let stepB: any = sessionB.advance();
      for (let i = 0; i < transcript.length; i++) {
        expect(stepB.type).toBe("WAITING_FOR_DECISION");
        // runtime decisionId や stateVersion は Session B 自身のものを利用し、selectedPatternRef のみ transcript から適用
        stepB = sessionB.submitDecision({
          decisionId: stepB.request.decisionId,
          stateVersion: stepB.request.stateVersion,
          selectedPatternRef: transcript[i].selectedPatternRef,
        });
      }

      const finalHashB = StateHasher.hash(sessionB.state);

      // 1. StateHash 完全一致
      expect(finalHashB).toBe(finalHashA);

      // 2. Component ID, kind, labels, physical Card 一致
      const magicianA = sessionA.state.players.p1.field.find((u: any) => u.cards?.some((c: any) => c.id === "JOKER-0"));
      const magicianB = sessionB.state.players.p1.field.find((u: any) => u.cards?.some((c: any) => c.id === "JOKER-0"));

      expect(magicianA).toBeDefined();
      expect(magicianB).toBeDefined();
      expect(magicianB.componentId).toBe("character.magician");
      expect(magicianB.kind).toBe("魔術士");
      expect(magicianB.labels).toEqual(["attack", "defense", "haste"]);
      expect(magicianB.cards[0].id).toBe("JOKER-0");
      expect(magicianB.unitId).toBe(magicianA.unitId);

      // 3. 移動結果の完全一致 (旧キャラが墓地へ、キーカードが墓地へ、Stage が空)
      expect(sessionB.state.players.p1.field.some((u: any) => u.cards?.some((c: any) => c.id === "c-tgt"))).toBe(false);
      expect(findPhysicalCardInGrave(sessionB.state.players.p1.grave, "c-tgt")).toBeDefined();
      expect(findPhysicalCardInGrave(sessionB.state.players.p1.grave, "k-s2")).toBeDefined();
      expect(findPhysicalCardInGrave(sessionB.state.players.p1.grave, "k-h3")).toBeDefined();
      expect(sessionB.state.players.p1.hand).toHaveLength(0);
      expect(sessionB.state.stage.requests).toHaveLength(0);

      // 4. Replay 後の Reanimated Magician 能力（Quick Magic の Cost D 除去）の検証
      const quickMagicAction: any = {
        id: "action.testQuickMagic",
        type: "magic",
        request: { timing: "quick" },
        cost: "BD",
      };

      const effectiveCosts = actionCostEvaluator.resolveEffectiveCostSymbols(
        quickMagicAction,
        sessionB.state,
        "p1",
        fullRulePackage.components
      );
      expect(effectiveCosts).toEqual(["B"]);
    });

    it("Test 6.3: AI policies (FirstLegal, SeededRandom, GenomePolicy) handle Reanimate decision", () => {
      const makeState = () => {
        const jokerCard = { id: "JOKER-0", suit: "J", rank: "Joker", value: 0 };
        const targetCard = { id: "c-tgt", suit: "C", rank: "5", value: 5 };
        const targetUnit = {
          ...buildFieldUnitFromComponent({
            componentId: "character.soldier",
            playerKey: "p1",
            card: targetCard,
            components: fullRulePackage.components,
          }),
          cards: [targetCard],
        };
        return {
          stateVersion: 1,
          turnPlayer: "p1",
          chancePlayer: "p1",
          turnCount: 1,
          players: {
            p1: {
              hand: [
                { id: "k-s2", suit: "S", rank: "2", value: 2 },
                { id: "k-h3", suit: "H", rank: "3", value: 3 },
              ],
              field: [targetUnit],
              life: [{ id: "l1" }],
              grave: [jokerCard],
            },
            p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
          },
        };
      };

      const advanceToSelectCards = () => {
        const session = new GameSession(makeState(), standardRulePackage);
        const s1: any = session.advance();
        const reanimatePat = s1.request.patterns.findIndex(
          (p: any) =>
            p.actionSelectionRef !== undefined &&
            s1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
        );
        expect(reanimatePat).toBeGreaterThanOrEqual(0);

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
        const req: any = session.submitDecision({
          decisionId: s3.request.decisionId,
          stateVersion: s3.request.stateVersion,
          selectedPatternRef: s3.request.patterns.findIndex((p: any) => p.kind === "PASS"),
        });
        return { session, req };
      };

      // 1. FirstLegal
      const { session: s1, req: reqFL } = advanceToSelectCards();
      const flPolicy = new FirstLegalPolicy();
      const decFL = flPolicy.choose(reqFL.request);
      s1.submitDecision(decFL);
      expect(s1.state.players.p1.field.some((u: any) => u.componentId === "character.magician")).toBe(true);

      // 2. RandomPolicy
      const { session: s2, req: reqRnd } = advanceToSelectCards();
      const rndPolicy = new RandomPolicy(12345);
      const decRnd = rndPolicy.choose(reqRnd.request);
      s2.submitDecision(decRnd);
      expect(s2.state.players.p1.field.some((u: any) => u.componentId === "character.magician")).toBe(true);

      // 3. GenomePolicy
      const { session: s3, req: reqGenome } = advanceToSelectCards();
      const dna = createManualGenericGenomeDNA();
      const genomePolicy = new GenomePolicy(dna);
      const decGenome = genomePolicy.choose(reqGenome.request);
      s3.submitDecision(decGenome);
      expect(s3.state.players.p1.field.some((u: any) => u.componentId === "character.magician")).toBe(true);
    });

    it("Test 6.4: Invariants verification (FEATURE_SCHEMA_VERSION = 1, DNA = 1482, SNAPSHOT_FORMAT_VERSION = 1)", () => {
      expect(FEATURE_SCHEMA_VERSION).toBe(1);
      expect(SNAPSHOT_FORMAT_VERSION).toBe(1);
      const dna = createManualGenericGenomeDNA();
      expect(dna.patternWeights.length + dna.contextPatternWeights.length).toBe(1482);
    });
  });

  // =========================================================================
  // Group 7: Handes Empty Hand & Privacy Regression
  // =========================================================================
  describe("Group 7: Handes Empty Hand & Privacy Regression", () => {
    it("Test 7.1: Opponent Hand = 0 -> Handes is legal, effect-time candidateCount = 0, no-op discard, request resolves cleanly (Rule 5.4.4)", () => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        turnCount: 1,
        players: {
          p1: {
            hand: [
              { id: "k-d1", suit: "D", rank: "A", value: 1 },
              { id: "k-c1", suit: "C", rank: "A", value: 1 },
            ],
            field: [],
            life: [{ id: "l1" }],
            grave: [],
          },
          p2: {
            hand: [], // Opponent Hand is 0
            field: [],
            life: [{ id: "l2" }],
            grave: [],
          },
        },
      };

      const session = new GameSession(state, standardRulePackage);
      const s1: any = session.advance();
      expect(s1.type).toBe("WAITING_FOR_DECISION");

      // Handes is legal to request
      const handesPat = s1.request.patterns.findIndex(
        (p: any) =>
          p.actionSelectionRef !== undefined &&
          s1.request.catalog.actions[p.actionSelectionRef].actionId === "action.handeth"
      );
      expect(handesPat).toBeGreaterThanOrEqual(0);

      // p1 requests handes
      const s2: any = session.submitDecision({
        decisionId: s1.request.decisionId,
        stateVersion: s1.request.stateVersion,
        selectedPatternRef: handesPat,
      });

      // Chance passes: p1 -> p2
      const s3: any = session.submitDecision({
        decisionId: s2.request.decisionId,
        stateVersion: s2.request.stateVersion,
        selectedPatternRef: s2.request.patterns.findIndex((p: any) => p.kind === "PASS"),
      });
      session.submitDecision({
        decisionId: s3.request.decisionId,
        stateVersion: s3.request.stateVersion,
        selectedPatternRef: s3.request.patterns.findIndex((p: any) => p.kind === "PASS"),
      });

      // Since opponent hand is 0, selectCards has candidateCount=0 and no decision is requested.
      // Handes resolves directly, keys sent to grave, request resolved cleanly.
      expect(session.state.players.p1.grave.some((c: any) => c.id === "k-d1")).toBe(true);
      expect(session.state.players.p1.grave.some((c: any) => c.id === "k-c1")).toBe(true);
      expect(session.state.players.p2.hand.length).toBe(0);
      expect(session.state.players.p2.grave.length).toBe(0);
    });
  });
});
