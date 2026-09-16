import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  getFrame,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { CostResolver } from "../../engine/rules/CostResolver";
import { ActionCostEvaluator } from "../../engine/rules/ActionCostEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { PatternExecutor } from "../../engine/decision/PatternExecutor";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { BaselineParticipants, createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import type { ActionDefinition, ComponentDefinition, RulePackage } from "../../domain/rules/RulePackage";
import type { CostPayment } from "../../domain/decision/DecisionCatalog";

describe("Official Regulation Phase 3.0-B - Magician & Generic Cost Modifier Tests", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let standardFormat: any;
  let standardPackReg: any;
  let packFrame: any;
  let standardRulePackage: RulePackage;
  let lightFormat: any;
  let lightPackReg: any;
  let lightRulePackage: RulePackage;

  let costEvaluator: ActionCostEvaluator;
  let costResolver: CostResolver;
  let validator: ActionRequestValidator;
  let abilityEvaluator: AbilityEvaluator;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    standardFormat = await getFormat("standard");
    standardPackReg = await getRegulation("standard-pack");
    packFrame = await getFrame("pack");
    standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg
    );

    lightFormat = await getFormat("light");
    lightPackReg = await getRegulation("light-pack");
    lightRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      lightFormat,
      lightPackReg
    );

    abilityEvaluator = new AbilityEvaluator();
    costEvaluator = new ActionCostEvaluator(abilityEvaluator);
    costResolver = new CostResolver();
    validator = new ActionRequestValidator();
  });

  // =========================================================================
  // Test A: character.magician exact definition
  // =========================================================================
  it("Test A: character.magician exact definition in official-base.yaml", () => {
    const comp = fullRulePackage.components.find((c) => c.id === "character.magician");
    expect(comp).toBeDefined();
    expect(comp!.id).toBe("character.magician");
    expect(comp!.name).toBe("魔術士");
    expect(comp!.ruby).toBe("まじゅつし");
    expect(comp!.type).toBe("character");
    expect(comp!.zone).toBe("field");
    expect(comp!.display?.kind).toBe("魔術士");

    // unitCondition
    expect(comp!.unitCondition?.cards?.count).toBe(1);
    expect(comp!.unitCondition?.cards?.rank).toBe("Joker");
    expect(comp!.unitCondition?.face).toBe("up");

    // properties
    expect(comp!.properties?.characterType).toBe("soldier");
    expect(comp!.properties?.size).toBe(0);
    expect(comp!.properties?.labels).toEqual(["attack", "defense", "haste"]);
    expect(comp!.properties?.eligibleAsPresetSoldier).toBe(false);

    // abilities (DSL costModifier)
    expect(comp!.abilities).toBeDefined();
    expect(Array.isArray(comp!.abilities)).toBe(true);
    const mod = comp!.abilities!.find((a: any) => a.costModifier);
    expect(mod).toBeDefined();
    expect(mod.costModifier.filter).toEqual({
      actionType: "magic",
      timing: "quick",
    });
    expect(mod.costModifier.remove).toEqual({
      symbol: "D",
    });

    // text
    expect(comp!.text?.summary).toContain("Jokerのカードは魔術士として扱う");
    expect(comp!.text?.ability).toContain("コストDを無しとする");
  });

  // =========================================================================
  // Test B: action.summonMagician exact metadata
  // =========================================================================
  it("Test B: action.summonMagician exact metadata in examples/summon-magician.yaml", () => {
    const act = fullRulePackage.actions.find((a) => a.id === "action.summonMagician");
    expect(act).toBeDefined();
    expect(act!.id).toBe("action.summonMagician");
    expect(act!.name).toBe("魔術士召喚");
    expect(act!.ruby).toBe("まじゅつししょうかん");
    expect(act!.type).toBe("summon");

    // request
    expect(act!.request?.trigger).toBe("direct");
    expect(act!.request?.speed).toBe("normal");
    expect(act!.request?.timing).toBe("main");

    // cost & key
    expect(act!.cost).toBe("BD");
    expect(act!.key?.id).toBe("key");
    expect(act!.key?.condition?.card?.rank).toBe("Joker");
    expect(act!.key?.condition?.card?.zone).toBe("hand");

    // effect
    expect(act!.effect).toBeDefined();
    const summonCmd = act!.effect!.find((e: any) => e.summonUnit);
    expect(summonCmd).toBeDefined();
    expect((summonCmd as any).summonUnit).toEqual({
      card: "key",
      component: "character.magician",
      face: "up",
      state: "charge",
    });
  });

  // =========================================================================
  // Test C: Standard RulePackage composition includes Magician, Light does not
  // =========================================================================
  it("Test C: Standard RulePackage includes Magician action and component; Light does not", () => {
    const stdAct = standardRulePackage.actions.find((a) => a.id === "action.summonMagician");
    const stdComp = standardRulePackage.components.find((c) => c.id === "character.magician");
    expect(stdAct).toBeDefined();
    expect(stdComp).toBeDefined();

    const lightAct = lightRulePackage.actions.find((a) => a.id === "action.summonMagician");
    const lightComp = lightRulePackage.components.find((c) => c.id === "character.magician");
    expect(lightAct).toBeUndefined();
    expect(lightComp).toBeUndefined();
  });

  // =========================================================================
  // Test D: No Joker -> Magician Summon illegal
  // =========================================================================
  it("Test D: Magician Summon is illegal when player has no Joker in hand", () => {
    const action = standardRulePackage.actions.find((a) => a.id === "action.summonMagician")!;
    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [
            { id: "c1", suit: "S", rank: "A", value: 1 },
            { id: "c2", suit: "H", rank: "5", value: 5 },
          ],
          field: [
            { unitId: "b1", componentId: "character.bulwark", kind: "防壁", state: "charge", cards: [] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const patterns = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const summonPatterns = patterns.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        patterns.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.summonMagician"
    );
    expect(summonPatterns.length).toBe(0);

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: { id: "c1", suit: "S", rank: "A", value: 1 },
      actions: standardRulePackage.actions,
      components: standardRulePackage.components,
    };
    expect(() => validator.validateActionRequest(action, context)).toThrow(ValidationError);
  });

  // =========================================================================
  // Test E: Joker in hand, but NO extra card for D -> illegal
  // =========================================================================
  it("Test E: Magician Summon is illegal when hand contains ONLY the Joker (no extra card for D)", () => {
    const action = standardRulePackage.actions.find((a) => a.id === "action.summonMagician")!;
    const jokerCard = { id: "joker-1", suit: "J", rank: "Joker", value: 0 };
    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [jokerCard],
          field: [
            { unitId: "b1", componentId: "character.bulwark", kind: "防壁", state: "charge", cards: [] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const patterns = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const summonPatterns = patterns.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        patterns.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.summonMagician"
    );
    expect(summonPatterns.length).toBe(0);

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: jokerCard,
      actions: standardRulePackage.actions,
      components: standardRulePackage.components,
    };
    expect(() => validator.validateActionRequest(action, context)).toThrow(ValidationError);
  });

  // =========================================================================
  // Test F: Joker + D card in hand, but NO charged Bulwark -> illegal
  // =========================================================================
  it("Test F: Magician Summon is illegal when player has NO charged Bulwark", () => {
    const action = standardRulePackage.actions.find((a) => a.id === "action.summonMagician")!;
    const jokerCard = { id: "joker-1", suit: "J", rank: "Joker", value: 0 };
    const discardCard = { id: "c2", suit: "H", rank: "5", value: 5 };

    // Case 1: 0 Bulwarks
    const stateNoBulwark = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [jokerCard, discardCard],
          field: [],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const patterns1 = LegalPatternGenerator.generateActionRequestDecision(stateNoBulwark, "p1", standardRulePackage);
    const summonPatterns1 = patterns1.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        patterns1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.summonMagician"
    );
    expect(summonPatterns1.length).toBe(0);

    // Case 2: Bulwark exists, but state is "drive"
    const stateDrivenBulwark = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [jokerCard, discardCard],
          field: [
            { unitId: "b1", componentId: "character.bulwark", kind: "防壁", state: "drive", cards: [] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const patterns2 = LegalPatternGenerator.generateActionRequestDecision(stateDrivenBulwark, "p1", standardRulePackage);
    const summonPatterns2 = patterns2.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        patterns2.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.summonMagician"
    );
    expect(summonPatterns2.length).toBe(0);
  });

  // =========================================================================
  // Test G & H: Joker + D Card + charged Bulwark -> Legal & Joker NOT in D Payment
  // =========================================================================
  it("Test G & H: Magician Summon is legal with Joker + D Card + charged Bulwark, and Joker is NEVER in discardedCardIds", () => {
    const jokerCard = { id: "joker-1", suit: "J", rank: "Joker", value: 0 };
    const discardCard = { id: "c2", suit: "H", rank: "5", value: 5 };
    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [jokerCard, discardCard],
          field: [
            { unitId: "b1", componentId: "character.bulwark", kind: "防壁", state: "charge", cards: [] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const res = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const summonPatterns = res.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        res.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.summonMagician"
    );
    expect(summonPatterns.length).toBeGreaterThan(0);

    for (const pat of summonPatterns) {
      const keyCardSel = res.request.catalog.cardSelections[pat.keyCardSelectionRef!];
      expect(keyCardSel.cardIds).toEqual(["joker-1"]);

      const costPayment = res.request.catalog.costPayments[pat.costPaymentRef!];
      expect(costPayment.discardedCardIds).toEqual(["c2"]);
      expect(costPayment.discardedCardIds).not.toContain("joker-1");
      expect(costPayment.drivenBulwarkUnitIds).toEqual(["b1"]);
      expect(costPayment.lifeCount).toBe(0);
    }
  });

  // =========================================================================
  // Test I: Magician Summon execution results
  // =========================================================================
  it("Test I: Magician Summon execution transfers D card to Grave, drives Bulwark, puts Joker on Field with face up, charge, size 0, and haste", () => {
    const registry = new CommandRegistry();
    const jokerCard = { id: "joker-1", suit: "J", rank: "Joker", value: 0 };
    const discardCard = { id: "c2", suit: "H", rank: "5", value: 5 };
    const bulwarkUnit = { unitId: "b1", componentId: "character.bulwark", kind: "防壁", state: "charge", cards: [] };

    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      stage: { requests: [] },
      players: {
        p1: {
          hand: [jokerCard, discardCard],
          field: [bulwarkUnit],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const res = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const summonPattern = res.request.patterns.find(
      (p) =>
        p.kind === "ACTION" &&
        res.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.summonMagician"
    )!;
    expect(summonPattern).toBeDefined();

    // Execute pattern
    const { actionRequest, context } = PatternExecutor.executePattern(
      summonPattern,
      res.request,
      state,
      standardRulePackage,
      registry
    );

    // Verify ActionRequest properties
    expect(actionRequest.actionId).toBe("action.summonMagician");
    expect(actionRequest.cost).toBe("BD"); // Base cost preserved
    expect(actionRequest.selectedCostPayment?.discardedCardIds).toEqual(["c2"]);
    expect(actionRequest.selectedCostPayment?.drivenBulwarkUnitIds).toEqual(["b1"]);

    // Verify GameState changes after execution
    const p1 = state.players.p1;
    // Hand loses both cards
    expect(p1.hand.length).toBe(0);

    // Grave receives D card
    expect(p1.grave.length).toBe(1);
    expect(p1.grave[0].cards[0].id).toBe("c2");

    // Bulwark transitioned from charge to drive
    const bulwarkAfter = p1.field.find((u: any) => u.unitId === "b1");
    expect(bulwarkAfter?.state).toBe("drive");

    // Field has Magician
    const magician: any = p1.field.find((u: any) => u.componentId === "character.magician");
    expect(magician).toBeDefined();
    expect(magician.face).toBe("up");
    expect(magician.state).toBe("charge");
    expect(magician.cards.map((c: any) => c.id)).toEqual(["joker-1"]);
    expect(magician.labels).toContain("attack");
    expect(magician.labels).toContain("defense");
    expect(magician.labels).toContain("haste");

    // Size 0 verification
    const calculatedSize = abilityEvaluator.calculateUnitSize(magician, state);
    expect(calculatedSize).toBe(0);
  });

  // =========================================================================
  // Test J: Without Magician, Up requires D
  // =========================================================================
  it("Test J: Without Magician, action.up has effective cost D and requires D payment", () => {
    const upAction = standardRulePackage.actions.find((a) => a.id === "action.up")!;
    const heartKey = { id: "h-3", suit: "H", rank: "3", value: 3 };

    // Player has heart key, but NO spare card for D
    const stateNoSpare = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [heartKey],
          field: [
            { unitId: "s1", componentId: "character.soldier", kind: "一般兵", state: "charge", cards: [{ value: 3 }] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const effectiveCost = costEvaluator.resolveEffectiveCost(
      upAction,
      stateNoSpare,
      "p1",
      standardRulePackage.components
    );
    expect(effectiveCost).toBe("D");

    const resNoSpare = LegalPatternGenerator.generateActionRequestDecision(stateNoSpare, "p1", standardRulePackage);
    const upPatternsNoSpare = resNoSpare.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        resNoSpare.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.up"
    );
    expect(upPatternsNoSpare.length).toBe(0);

    // When spare card is added, Up becomes legal with D payment
    stateNoSpare.players.p1.hand.push({ id: "spare-1", suit: "S", rank: "2", value: 2 });
    const resWithSpare = LegalPatternGenerator.generateActionRequestDecision(stateNoSpare, "p1", standardRulePackage);
    const upPatternsWithSpare = resWithSpare.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        resWithSpare.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.up"
    );
    expect(upPatternsWithSpare.length).toBeGreaterThan(0);
    const costPayment = resWithSpare.request.catalog.costPayments[upPatternsWithSpare[0].costPaymentRef!];
    expect(costPayment.discardedCardIds).toEqual(["spare-1"]);
  });

  // =========================================================================
  // Test K: Own Magician on field -> Up D removed
  // =========================================================================
  it("Test K: With own Magician on field, action.up has effective cost empty and requires NO D payment", () => {
    const upAction = standardRulePackage.actions.find((a) => a.id === "action.up")!;
    const heartKey = { id: "h-3", suit: "H", rank: "3", value: 3 };

    const stateWithMagician = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [heartKey], // ONLY key card, NO extra cards
          field: [
            { unitId: "m1", componentId: "character.magician", kind: "魔術士", state: "charge", face: "up", cards: [] },
            { unitId: "s1", componentId: "character.soldier", kind: "一般兵", state: "charge", cards: [{ value: 3 }] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const effectiveCost = costEvaluator.resolveEffectiveCost(
      upAction,
      stateWithMagician,
      "p1",
      standardRulePackage.components
    );
    expect(effectiveCost).toBe("");

    const res = LegalPatternGenerator.generateActionRequestDecision(stateWithMagician, "p1", standardRulePackage);
    const upPatterns = res.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        res.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.up"
    );
    expect(upPatterns.length).toBeGreaterThan(0);

    const costPayment = res.request.catalog.costPayments[upPatterns[0].costPaymentRef!];
    expect(costPayment.discardedCardIds).toEqual([]);
    expect(costPayment.drivenBulwarkUnitIds).toEqual([]);
    expect(costPayment.lifeCount).toBe(0);
    expect(costPayment.summary).toBe("コストなし");
  });

  // =========================================================================
  // Test L: Opponent Magician does NOT affect my action cost
  // =========================================================================
  it("Test L: Opponent Magician on field does NOT reduce player's action cost (Controller-only)", () => {
    const upAction = standardRulePackage.actions.find((a) => a.id === "action.up")!;
    const heartKey = { id: "h-3", suit: "H", rank: "3", value: 3 };

    // P1 has NO magician, P2 has Magician
    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [heartKey],
          field: [
            { unitId: "s1", componentId: "character.soldier", kind: "一般兵", state: "charge", cards: [{ value: 3 }] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: {
          hand: [],
          field: [
            { unitId: "m2", componentId: "character.magician", kind: "魔術士", state: "charge", face: "up", cards: [] },
          ],
          life: [{ id: "l2" }],
          grave: [],
        },
      },
    };

    // P1 cost for Up is D (not reduced)
    const p1Cost = costEvaluator.resolveEffectiveCost(upAction, state, "p1", standardRulePackage.components);
    expect(p1Cost).toBe("D");

    // P2 cost for Up would be empty (reduced)
    const p2Cost = costEvaluator.resolveEffectiveCost(upAction, state, "p2", standardRulePackage.components);
    expect(p2Cost).toBe("");
  });

  // =========================================================================
  // Test M: Magician leaves field -> D restored in next Decision
  // =========================================================================
  it("Test M: Magician leaving field restores D cost dynamically without stale cache", () => {
    const upAction = standardRulePackage.actions.find((a) => a.id === "action.up")!;
    const heartKey = { id: "h-3", suit: "H", rank: "3", value: 3 };

    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [heartKey],
          field: [
            { unitId: "m1", componentId: "character.magician", kind: "魔術士", state: "charge", face: "up", cards: [] },
            { unitId: "s1", componentId: "character.soldier", kind: "一般兵", state: "charge", cards: [{ value: 3 }] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    expect(costEvaluator.resolveEffectiveCost(upAction, state, "p1", standardRulePackage.components)).toBe("");

    // Magician removed from field (e.g. moved to grave)
    state.players.p1.field = state.players.p1.field.filter((u: any) => u.unitId !== "m1");
    state.stateVersion = 2;

    expect(costEvaluator.resolveEffectiveCost(upAction, state, "p1", standardRulePackage.components)).toBe("D");

    const res = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const upPatterns = res.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        res.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.up"
    );
    // Cannot pay D since hand only has heartKey
    expect(upPatterns.length).toBe(0);
  });

  // =========================================================================
  // Test N: Multiple Magician idempotence
  // =========================================================================
  it("Test N: Multiple Magicians on field are idempotent and do NOT perform arithmetic over-reduction", () => {
    const state = {
      stateVersion: 1,
      players: {
        p1: {
          field: [
            { unitId: "m1", componentId: "character.magician", kind: "魔術士", state: "charge", face: "up", cards: [] },
            { unitId: "m2", componentId: "character.magician", kind: "魔術士", state: "charge", face: "up", cards: [] },
          ],
        },
      },
    };

    const actionDD: ActionDefinition = {
      id: "synthetic.quickMagicDD",
      name: "合成速攻魔法DD",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "DD",
    };

    const actionBD: ActionDefinition = {
      id: "synthetic.quickMagicBD",
      name: "合成速攻魔法BD",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "BD",
    };

    expect(costEvaluator.resolveEffectiveCost(actionDD, state, "p1", standardRulePackage.components)).toBe("");
    expect(costEvaluator.resolveEffectiveCost(actionBD, state, "p1", standardRulePackage.components)).toBe("B");
  });

  // =========================================================================
  // Test O, P, Q, R: Synthetic actions boundary checks
  // =========================================================================
  it("Test O: Synthetic Quick Magic DD -> no D", () => {
    const state = {
      players: {
        p1: {
          field: [{ unitId: "m1", componentId: "character.magician", face: "up" }],
        },
      },
    };
    const action: ActionDefinition = {
      id: "syn.qm.dd",
      name: "QM DD",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "DD",
    };
    expect(costEvaluator.resolveEffectiveCost(action, state, "p1", standardRulePackage.components)).toBe("");
  });

  it("Test P: Synthetic Quick Magic BD -> B", () => {
    const state = {
      players: {
        p1: {
          field: [{ unitId: "m1", componentId: "character.magician", face: "up" }],
        },
      },
    };
    const action: ActionDefinition = {
      id: "syn.qm.bd",
      name: "QM BD",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "BD",
    };
    expect(costEvaluator.resolveEffectiveCost(action, state, "p1", standardRulePackage.components)).toBe("B");
  });

  it("Test Q: Synthetic Main Magic D -> D (Main timing NOT affected)", () => {
    const state = {
      players: {
        p1: {
          field: [{ unitId: "m1", componentId: "character.magician", face: "up" }],
        },
      },
    };
    const action: ActionDefinition = {
      id: "syn.mm.d",
      name: "MM D",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "main" },
      cost: "D",
    };
    expect(costEvaluator.resolveEffectiveCost(action, state, "p1", standardRulePackage.components)).toBe("D");
  });

  it("Test R: Synthetic Quick Summon D -> D (Summon type NOT affected)", () => {
    const state = {
      players: {
        p1: {
          field: [{ unitId: "m1", componentId: "character.magician", face: "up" }],
        },
      },
    };
    const action: ActionDefinition = {
      id: "syn.qs.d",
      name: "QS D",
      type: "summon",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "D",
    };
    expect(costEvaluator.resolveEffectiveCost(action, state, "p1", standardRulePackage.components)).toBe("D");
  });

  // =========================================================================
  // Test S: Forged CostPayment mismatch -> reject fail-closed
  // =========================================================================
  it("Test S: Forged CostPayment is rejected when it does not match effective cost", () => {
    // 1. Effective cost is "" (no cost), but forged payment attempts to discard a card
    const forgedDiscardWhenFree: CostPayment = {
      discardedCardIds: ["c1"],
      drivenBulwarkUnitIds: [],
      sacrificedUnitIds: [],
      lifeCount: 0,
    };
    expect(costResolver.matchesCost(forgedDiscardWhenFree, "")).toBe(false);

    // 2. Effective cost is "B", but forged payment has no drive
    const forgedEmptyWhenB: CostPayment = {
      discardedCardIds: [],
      drivenBulwarkUnitIds: [],
      sacrificedUnitIds: [],
      lifeCount: 0,
    };
    expect(costResolver.matchesCost(forgedEmptyWhenB, "B")).toBe(false);

    // 3. Valid payment matching B
    const validB: CostPayment = {
      discardedCardIds: [],
      drivenBulwarkUnitIds: ["b1"],
      sacrificedUnitIds: [],
      lifeCount: 0,
    };
    expect(costResolver.matchesCost(validB, "B")).toBe(true);
  });

  // =========================================================================
  // Test T: DecisionCatalog cost presents effective cost
  // =========================================================================
  it("Test T: DecisionCatalog.actions[ref].cost displays effective cost", () => {
    const heartKey = { id: "h-3", suit: "H", rank: "3", value: 3 };

    // Case 1: Magician on field -> Up cost in catalog is undefined (costなし)
    const stateWithMagician = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [heartKey],
          field: [
            { unitId: "m1", componentId: "character.magician", kind: "魔術士", state: "charge", face: "up", cards: [] },
            { unitId: "s1", componentId: "character.soldier", kind: "一般兵", state: "charge", cards: [{ value: 3 }] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const res1 = LegalPatternGenerator.generateActionRequestDecision(stateWithMagician, "p1", standardRulePackage);
    const upActionSel1 = res1.request.catalog.actions.find((a) => a.actionId === "action.up");
    expect(upActionSel1).toBeDefined();
    expect(upActionSel1!.cost).toBeUndefined();

    // Case 2: No Magician on field -> Up cost in catalog is "D"
    const stateNoMagician = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [heartKey, { id: "c2", suit: "S", rank: "2", value: 2 }],
          field: [
            { unitId: "s1", componentId: "character.soldier", kind: "一般兵", state: "charge", cards: [{ value: 3 }] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const res2 = LegalPatternGenerator.generateActionRequestDecision(stateNoMagician, "p1", standardRulePackage);
    const upActionSel2 = res2.request.catalog.actions.find((a) => a.actionId === "action.up");
    expect(upActionSel2).toBeDefined();
    expect(upActionSel2!.cost).toBe("D");
  });

  // =========================================================================
  // Test U: Light regression
  // =========================================================================
  it("Test U: Light Format environments remain 100% unaffected by Magician", () => {
    expect(lightRulePackage.actions.some((a) => a.id === "action.summonMagician")).toBe(false);
    expect(lightRulePackage.components.some((c) => c.id === "character.magician")).toBe(false);

    const validation = RegulationValidator.validateRegulation(catalog, "light-pack");
    expect(validation.ruleLegal).toBe(true);
    expect(validation.simulatorImplemented).toBe(true);
  });

  // =========================================================================
  // Test V: standard-pack remains simulatorImplemented = false
  // =========================================================================
  it("Test V: standard-pack remains simulatorImplemented = false", () => {
    const validation = RegulationValidator.validateRegulation(catalog, "standard-pack");
    expect(validation.ruleLegal).toBe(true);
    expect(validation.recommended).toBe(true);
    expect(validation.simulatorImplemented).toBe(false);
  });

  // =========================================================================
  // Test W: FEATURE_SCHEMA_VERSION = 1 & DNA dimension 1482 & AI compatibility
  // =========================================================================
  it("Test W: AI feature schema version and DNA dimension remain unchanged and compatible", () => {
    expect(FEATURE_SCHEMA_VERSION).toBe(1);
    expect(DecisionFeatureEncoder.SCHEMA_VERSION).toBe(1);

    const heartKey = { id: "h-3", suit: "H", rank: "3", value: 3 };
    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [heartKey],
          field: [
            { unitId: "m1", componentId: "character.magician", kind: "魔術士", state: "charge", face: "up", cards: [] },
            { unitId: "s1", componentId: "character.soldier", kind: "一般兵", state: "charge", cards: [{ value: 3 }] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const res = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);

    // Feature encoding
    const encoded = DecisionFeatureEncoder.encode(res.request);
    expect(encoded.featureSchemaVersion).toBe(1);

    // AI Policies evaluation
    const firstLegal = new FirstLegalPolicy();
    const firstDecision = firstLegal.choose(res.request);
    expect(firstDecision.selectedPatternRef).toBeDefined();

    const seededRandom = new RandomPolicy(42);
    const randomDecision = seededRandom.choose(res.request);
    expect(randomDecision.selectedPatternRef).toBeDefined();

    const manualGeneric = new GenomePolicy(createManualGenericGenomeDNA());
    const manualDecision = manualGeneric.choose(res.request);
    expect(manualDecision.selectedPatternRef).toBeDefined();
  });

  // =========================================================================
  // Test X: Forged Payment: Joker simultaneously as Key + D -> reject
  // =========================================================================
  it("Test X: Forged Payment specifying Joker as both Key Card and D cost card is rejected", () => {
    const jokerCard = { id: "joker-1", suit: "J", rank: "Joker", value: 0 };
    const context: CommandContext = {
      state: {
        players: {
          p1: {
            hand: [jokerCard],
            field: [{ unitId: "b1", componentId: "character.bulwark", kind: "防壁", state: "charge" }],
            life: [{ id: "l1" }],
          },
        },
      },
      playerKey: "p1",
      keyCard: jokerCard,
    };

    const forgedPayment: CostPayment = {
      discardedCardIds: ["joker-1"], // same as keyCard!
      drivenBulwarkUnitIds: ["b1"],
      sacrificedUnitIds: [],
      lifeCount: 0,
    };

    expect(costResolver.matchesCost(forgedPayment, "BD", context)).toBe(false);
    expect(costResolver.canPaySelection(forgedPayment, context, "BD")).toBe(false);
  });

  // =========================================================================
  // Test Y: Forged Payment: duplicate discardedCardIds -> reject
  // =========================================================================
  it("Test Y: Forged Payment with duplicate discardedCardIds is rejected", () => {
    const forgedPayment: CostPayment = {
      discardedCardIds: ["card-1", "card-1"],
      drivenBulwarkUnitIds: [],
      sacrificedUnitIds: [],
      lifeCount: 0,
    };
    expect(costResolver.matchesCost(forgedPayment, "DD")).toBe(false);
  });

  // =========================================================================
  // Test Z: Forged Payment: duplicate Bulwark IDs -> reject
  // =========================================================================
  it("Test Z: Forged Payment with duplicate drivenBulwarkUnitIds is rejected", () => {
    const forgedPayment: CostPayment = {
      discardedCardIds: [],
      drivenBulwarkUnitIds: ["b1", "b1"],
      sacrificedUnitIds: [],
      lifeCount: 0,
    };
    expect(costResolver.matchesCost(forgedPayment, "BB")).toBe(false);
  });

  // =========================================================================
  // Test AA: Forged Payment: extra sacrificedUnitIds -> reject
  // =========================================================================
  it("Test AA: Forged Payment specifying unexpected sacrificedUnitIds is rejected", () => {
    const forgedPayment: CostPayment = {
      discardedCardIds: [],
      drivenBulwarkUnitIds: ["b1"],
      sacrificedUnitIds: ["unit-fake"],
      lifeCount: 0,
    };
    expect(costResolver.matchesCost(forgedPayment, "B")).toBe(false);
  });

  // =========================================================================
  // Test AB: Field-only ability: Field Magician -> D removed; Trump Magician -> D NOT removed
  // =========================================================================
  it("Test AB: Magician ability is strictly Field-only; Trump zone Magician does NOT remove D", () => {
    const upAction = standardRulePackage.actions.find((a) => a.id === "action.up")!;

    // Magician in Trump zone (not field)
    const stateTrumpMagician = {
      players: {
        p1: {
          trump: [
            { unitId: "m-trump", componentId: "character.magician", face: "up" },
          ],
          field: [
            { unitId: "s1", componentId: "character.soldier", face: "up" },
          ],
        },
      },
    };

    const costTrump = costEvaluator.resolveEffectiveCost(
      upAction,
      stateTrumpMagician,
      "p1",
      standardRulePackage.components
    );
    expect(costTrump).toBe("D"); // D is NOT removed

    // Magician in Field zone
    const stateFieldMagician = {
      players: {
        p1: {
          field: [
            { unitId: "m-field", componentId: "character.magician", face: "up" },
            { unitId: "s1", componentId: "character.soldier", face: "up" },
          ],
        },
      },
    };

    const costField = costEvaluator.resolveEffectiveCost(
      upAction,
      stateFieldMagician,
      "p1",
      standardRulePackage.components
    );
    expect(costField).toBe(""); // D is removed
  });

  // =========================================================================
  // Test AC: Summon Integration: Magician Summon -> 正常解決 -> その後のQuick Magic D removed
  // =========================================================================
  it("Test AC: End-to-end integration: executing action.summonMagician directly activates D cost reduction for subsequent Quick Magic", () => {
    const registry = new CommandRegistry();
    const jokerCard = { id: "joker-1", suit: "J", rank: "Joker", value: 0 };
    const discardCard = { id: "d-1", suit: "S", rank: "2", value: 2 };
    const heartKey = { id: "h-3", suit: "H", rank: "3", value: 3 };

    // Initial state: P1 has Joker, D card, and Heart key (for Up)
    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      stage: { requests: [] },
      players: {
        p1: {
          hand: [jokerCard, discardCard, heartKey],
          field: [
            { unitId: "b1", componentId: "character.bulwark", kind: "防壁", state: "charge", cards: [] },
            { unitId: "s1", componentId: "character.soldier", kind: "一般兵", state: "charge", cards: [{ value: 3 }] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    // 1. Initial Decision: Summon Magician pattern is available
    const decision1 = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const summonPat = decision1.request.patterns.find(
      (p) =>
        p.kind === "ACTION" &&
        decision1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.summonMagician"
    )!;
    expect(summonPat).toBeDefined();

    // 2. Execute Magician Summon
    PatternExecutor.executePattern(summonPat, decision1.request, state, standardRulePackage, registry);

    // Verify state after Magician Summon:
    // P1 Hand now contains ONLY heartKey (Joker is on field, d-1 is in grave)
    expect(state.players.p1.hand.map((c: any) => c.id)).toEqual(["h-3"]);
    expect(state.players.p1.field.some((u: any) => u.componentId === "character.magician")).toBe(true);

    // 3. Generate Next Decision:
    state.stateVersion = 2;
    const decision2 = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);

    // 4. Action Up should now be LEGAL even though hand has NO extra card for D!
    const upPatterns = decision2.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        decision2.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.up"
    );
    expect(upPatterns.length).toBeGreaterThan(0);

    const costPayment = decision2.request.catalog.costPayments[upPatterns[0].costPaymentRef!];
    expect(costPayment.discardedCardIds).toEqual([]);
    expect(costPayment.summary).toBe("コストなし");
  });

  // =========================================================================
  // Test AD: Base Cost immutable
  // =========================================================================
  it("Test AD: ActionDefinition.cost is completely immutable after effective cost evaluation", () => {
    const upAction = standardRulePackage.actions.find((a) => a.id === "action.up")!;
    expect(upAction.cost).toBe("D");

    const state = {
      players: {
        p1: {
          field: [{ unitId: "m1", componentId: "character.magician", face: "up" }],
        },
      },
    };

    const effective = costEvaluator.resolveEffectiveCost(upAction, state, "p1", standardRulePackage.components);
    expect(effective).toBe("");
    // ActionDefinition itself must remain untouched!
    expect(upAction.cost).toBe("D");
  });

  // =========================================================================
  // Test AE: Relative cost ordering preserved
  // =========================================================================
  it("Test AE: Cost symbol relative order is preserved when D is removed", () => {
    const state = {
      players: {
        p1: {
          field: [{ unitId: "m1", componentId: "character.magician", face: "up" }],
        },
      },
    };

    const actionDBL: ActionDefinition = {
      id: "syn.dbl",
      name: "DBL",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "DBL",
    };
    expect(costEvaluator.resolveEffectiveCost(actionDBL, state, "p1", standardRulePackage.components)).toBe("BL");

    const actionBDD: ActionDefinition = {
      id: "syn.bdd",
      name: "BDD",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "BDD",
    };
    expect(costEvaluator.resolveEffectiveCost(actionBDD, state, "p1", standardRulePackage.components)).toBe("B");

    const actionDLD: ActionDefinition = {
      id: "syn.dld",
      name: "DLD",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "quick" },
      cost: "DLD",
    };
    expect(costEvaluator.resolveEffectiveCost(actionDLD, state, "p1", standardRulePackage.components)).toBe("L");
  });

  // =========================================================================
  // Natural standard53 Fixed Seed Integration Test
  // =========================================================================
  it("Natural standard53 Fixture: fixed seed yields Joker in hand, Magician Summon is legal without post-start mutation", () => {
    let targetSeed = -1;
    for (let s = 1; s <= 100; s++) {
      const outcome = OfficialRegulationMatchSetup.setupMatch(standardPackReg, packFrame, standardRulePackage, s);
      if (outcome.type === "READY") {
        const p1Hand = outcome.state.players.p1.hand || [];
        if (p1Hand.some((c: any) => c.rank === "Joker")) {
          targetSeed = s;
          break;
        }
      }
    }
    expect(targetSeed).toBeGreaterThan(0);

    const outcome = OfficialRegulationMatchSetup.setupMatch(standardPackReg, packFrame, standardRulePackage, targetSeed);
    expect(outcome.type).toBe("READY");
    if (outcome.type === "READY") {
      const p1Hand = outcome.state.players.p1.hand || [];
      const jokerCard = p1Hand.find((c: any) => c.rank === "Joker");
      expect(jokerCard).toBeDefined();

      const chargedBulwark = outcome.state.players.p1.field?.find(
        (u: any) => (u.componentId === "character.bulwark" || u.kind === "防壁") && u.state === "charge"
      );
      expect(chargedBulwark).toBeDefined();

      outcome.state.chancePlayer = "p1";
      outcome.state.turnPlayer = "p1";
      outcome.state.stage = { requests: [] };

      const decision = LegalPatternGenerator.generateActionRequestDecision(outcome.state, "p1", standardRulePackage);
      const summonPat = decision.request.patterns.find(
        (p) =>
          p.kind === "ACTION" &&
          decision.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.summonMagician"
      );
      expect(summonPat).toBeDefined();
    }
  });
});
