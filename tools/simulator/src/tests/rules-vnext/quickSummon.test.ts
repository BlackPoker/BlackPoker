import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { loadRulePackageFromDirectory, clearRulePackageCache } from "../../engine/rules/RuleLoader";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  getFrame,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { ActionActivationConditionEvaluator } from "../../engine/rules/ActionActivationConditionEvaluator";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { CommandRegistry, CommandContext, cancelStageRequest } from "../../engine/rules/CommandRegistry";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { CostResolver } from "../../engine/rules/CostResolver";
import { GameSession } from "../../engine/session/GameSession";
import { CostPayment } from "../../domain/decision/DecisionCatalog";
import type { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";

function makeCostPayment(overrides: Partial<CostPayment> = {}): CostPayment {
  return {
    discardedCardIds: [],
    drivenBulwarkUnitIds: [],
    sacrificedUnitIds: [],
    lifeCount: 0,
    ...overrides,
  };
}

function countTotalCards(state: any): number {
  let count = 0;
  for (const pKey of Object.keys(state.players || {})) {
    const p = state.players[pKey];
    count += (p.deck?.cards?.length ?? p.deck?.length ?? 0);
    count += (p.hand?.length ?? 0);
    count += (p.life?.length ?? 0);
    if (Array.isArray(p.grave)) {
      for (const g of p.grave) {
        count += (g.cards?.length ?? 1);
      }
    }
    count += (p.rareCards?.length ?? p.rare?.length ?? 0);
    if (Array.isArray(p.field)) {
      for (const u of p.field) {
        count += (u.cards?.length ?? 0);
      }
    }
    if (Array.isArray(p.fog)) {
      for (const f of p.fog) {
        if (f.card) count += 1;
      }
    }
  }
  if (Array.isArray(state.stage?.requests)) {
    for (const r of state.stage.requests) {
      count += (r.keyCards?.length ?? 0);
    }
  }
  return count;
}

describe("BP-SIM-REG-5.0-B: Quick Summon (action.quickSummonsAce) & Generic turnRelation Evaluator", () => {
  let fullRulePackage: RulePackage;
  let proRulePackage: RulePackage;
  let standardRulePackage: RulePackage;
  let quickSummonDef: ActionDefinition;

  beforeAll(async () => {
    clearRegulationCache();
    clearRulePackageCache();
    await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    const proFormat = await getFormat("pro");
    const proRarePackReg = await getRegulation("pro-rarePack");
    const rarePackFrame = await getFrame("rarePack");
    proRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      proFormat,
      proRarePackReg,
      rarePackFrame
    );

    const standardFormat = await getFormat("standard");
    const standardPackReg = await getRegulation("standard-pack");
    const packFrame = await getFrame("pack");
    standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg,
      packFrame
    );

    const found = fullRulePackage.actions.find((a) => a.id === "action.quickSummonsAce");
    expect(found).toBeDefined();
    quickSummonDef = found!;
  });

  // =========================================================================
  // 1. Generic turnRelation Condition Evaluator Tests
  // =========================================================================
  describe("1. Generic turnRelation Evaluation (ActionActivationConditionEvaluator)", () => {
    const baseState = {
      turnPlayer: "p1",
      nonTurnPlayer: "p2",
      players: {
        p1: { hand: [], field: [], grave: [], life: [] },
        p2: { hand: [], field: [], grave: [], life: [] },
      },
    };

    it("1.1: Evaluates relation: nonTurnPlayer - succeeds for non-turn player, fails for turn player", () => {
      const cond = {
        turnRelation: {
          player: "controller" as const,
          relation: "nonTurnPlayer" as const,
        },
      };

      const resP2 = ActionActivationConditionEvaluator.evaluate(cond, {
        state: baseState,
        playerKey: "p2",
      });
      expect(resP2.isLegal).toBe(true);

      const resP1 = ActionActivationConditionEvaluator.evaluate(cond, {
        state: baseState,
        playerKey: "p1",
      });
      expect(resP1.isLegal).toBe(false);
      expect(resP1.reason).toContain("非ターンプレイヤーではありません");
    });

    it("1.2: Evaluates relation: turnPlayer - succeeds for turn player, fails for non-turn player", () => {
      const cond = {
        turnRelation: {
          player: "controller" as const,
          relation: "turnPlayer" as const,
        },
      };

      const resP1 = ActionActivationConditionEvaluator.evaluate(cond, {
        state: baseState,
        playerKey: "p1",
      });
      expect(resP1.isLegal).toBe(true);

      const resP2 = ActionActivationConditionEvaluator.evaluate(cond, {
        state: baseState,
        playerKey: "p2",
      });
      expect(resP2.isLegal).toBe(false);
      expect(resP2.reason).toContain("ターンプレイヤー");
    });

    it("1.3: Defaults player to controller when player property is omitted", () => {
      const cond = {
        turnRelation: {
          relation: "nonTurnPlayer" as const,
        },
      };

      const resP2 = ActionActivationConditionEvaluator.evaluate(cond, {
        state: baseState,
        playerKey: "p2",
      });
      expect(resP2.isLegal).toBe(true);

      const resP1 = ActionActivationConditionEvaluator.evaluate(cond, {
        state: baseState,
        playerKey: "p1",
      });
      expect(resP1.isLegal).toBe(false);
    });

    it("1.4: Supports player: self equivalently to controller", () => {
      const cond = {
        turnRelation: {
          player: "self" as const,
          relation: "nonTurnPlayer" as const,
        },
      };

      const resP2 = ActionActivationConditionEvaluator.evaluate(cond, {
        state: baseState,
        playerKey: "p2",
      });
      expect(resP2.isLegal).toBe(true);
    });

    it("1.5: Fail-closed on unsupported player spec", () => {
      const cond = {
        turnRelation: {
          player: "opponent" as any,
          relation: "nonTurnPlayer" as const,
        },
      };

      const res = ActionActivationConditionEvaluator.evaluate(cond, {
        state: baseState,
        playerKey: "p2",
      });
      expect(res.isLegal).toBe(false);
      expect(res.reason).toContain("未対応のプレイヤースペック");
    });

    it("1.6: Fail-closed on unsupported relation spec", () => {
      const cond = {
        turnRelation: {
          player: "controller" as const,
          relation: "invalidRelation" as any,
        },
      };

      const res = ActionActivationConditionEvaluator.evaluate(cond, {
        state: baseState,
        playerKey: "p2",
      });
      expect(res.isLegal).toBe(false);
      expect(res.reason).toContain("未対応または未定義の relation");
    });

    it("1.7: Fail-closed on missing turnPlayer in state", () => {
      const malformedState = {
        turnPlayer: undefined,
        players: { p1: {}, p2: {} },
      };
      const cond = {
        turnRelation: {
          relation: "nonTurnPlayer" as const,
        },
      };

      const res = ActionActivationConditionEvaluator.evaluate(cond, {
        state: malformedState,
        playerKey: "p2",
      });
      expect(res.isLegal).toBe(false);
      expect(res.reason).toContain("ターンプレイヤーが未定義または無効");
    });

    it("1.8: Fail-closed on inconsistent state where nonTurnPlayer === turnPlayer", () => {
      const inconsistentState = {
        turnPlayer: "p1",
        nonTurnPlayer: "p1",
        players: { p1: {}, p2: {} },
      };
      const cond = {
        turnRelation: {
          relation: "nonTurnPlayer" as const,
        },
      };

      const res = ActionActivationConditionEvaluator.evaluate(cond, {
        state: inconsistentState,
        playerKey: "p2",
      });
      expect(res.isLegal).toBe(false);
      expect(res.reason).toContain("状態不整合");
    });

    it("1.9: Fail-closed on unknown condition operator", () => {
      const cond = {
        invalidOperator: { foo: "bar" },
      } as any;

      const res = ActionActivationConditionEvaluator.evaluate(cond, {
        state: baseState,
        playerKey: "p2",
      });
      expect(res.isLegal).toBe(false);
      expect(res.reason).toContain("未対応の起動条件オペレータ");
    });

    it("1.10: Evaluates composition of turnRelation and zoneCount fail-closed", () => {
      const cond = {
        turnRelation: {
          relation: "nonTurnPlayer" as const,
        },
        zoneCount: {
          player: "controller" as const,
          zone: "hand",
          atLeast: 3,
        },
      };

      // p2 is nonTurnPlayer (turnRelation passes), but hand has 2 cards (< 3, zoneCount fails)
      const testState = {
        turnPlayer: "p1",
        nonTurnPlayer: "p2",
        players: {
          p1: { hand: [] },
          p2: { hand: [{ id: "c1" }, { id: "c2" }] },
        },
      };

      const res = ActionActivationConditionEvaluator.evaluate(cond, {
        state: testState,
        playerKey: "p2",
      });
      expect(res.isLegal).toBe(false);
      expect(res.reason).toContain("下限 (3) 未満");
    });
  });

  // =========================================================================
  // 2. Action Definition & Regulation Catalog Contract
  // =========================================================================
  describe("2. Quick Summon Definition & Regulation Catalog Contract", () => {
    it("2.1: Matches official BlackPoker v9.1.2 definition specifications", () => {
      expect(quickSummonDef.id).toBe("action.quickSummonsAce");
      expect(quickSummonDef.name).toBe("クイック召喚");
      expect(quickSummonDef.ruby).toBe("くいっくしょうかん");
      expect(quickSummonDef.type).toBe("summon");

      expect(quickSummonDef.request.trigger).toBe("direct");
      expect(quickSummonDef.request.speed).toBe("normal");
      expect(quickSummonDef.request.timing).toBe("quick");

      expect(quickSummonDef.cost).toBe("D");
      expect(quickSummonDef.key).toBeDefined();
      expect(quickSummonDef.key?.count).toBe(1);
      expect(quickSummonDef.key?.condition?.card?.rank).toBe("A");
      expect(quickSummonDef.key?.condition?.card?.zone).toBe("hand");

      expect(quickSummonDef.activationCondition?.turnRelation).toEqual({
        player: "controller",
        relation: "nonTurnPlayer",
      });
    });

    it("2.2: Included in Pro format RulePackage, excluded from Standard format", () => {
      const inPro = proRulePackage.actions.some((a) => a.id === "action.quickSummonsAce");
      expect(inPro).toBe(true);

      const inStandard = standardRulePackage.actions.some((a) => a.id === "action.quickSummonsAce");
      expect(inStandard).toBe(false);
    });

    it("2.3: pro:rarePack regulation exists with simulatorImplemented: false", async () => {
      const catalog = await loadRegulationCatalog();
      const proRarePack = await getRegulation("pro-rarePack");
      expect(proRarePack).toBeDefined();
      expect(proRarePack.formatId).toBe("pro");
      expect(proRarePack.frameId).toBe("rarePack");

      const validation = RegulationValidator.validateRegulation(catalog, "pro-rarePack");
      expect(validation.simulatorImplemented).toBe(false);
    });
  });

  // =========================================================================
  // 3. Candidate Generation & Activation Boundaries
  // =========================================================================
  describe("3. Legal Pattern Generation & Activation Boundaries", () => {
    const validator = new ActionRequestValidator();

    it("3.1: Turn player with chance CANNOT activate Quick Summon (activationCondition filters out)", () => {
      const state = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [
              { id: "c-ace", suit: "S", rank: "A", value: 1 },
              { id: "c-cost", suit: "H", rank: "7", value: 7 },
            ],
            field: [],
            life: [{ id: "l1" }],
            grave: [],
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p1", proRulePackage);
      const qsPattern = decision.request.patterns.find(
        (p) => p.kind === "ACTION" && decision.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.quickSummonsAce"
      );
      expect(qsPattern).toBeUndefined();

      expect(() => {
        validator.validateActionRequest(quickSummonDef, {
          state,
          playerKey: "p1",
          keyCard: state.players.p1.hand[0],
          components: proRulePackage.components,
        });
      }).toThrow(ValidationError);
    });

    it("3.2: Non-turn player WITHOUT chance CANNOT activate Quick Summon", () => {
      const state = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1", // p1 has chance, p2 does not!
        stage: { requests: [] },
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: {
            hand: [
              { id: "c-ace", suit: "S", rank: "A", value: 1 },
              { id: "c-cost", suit: "H", rank: "7", value: 7 },
            ],
            field: [],
            life: [{ id: "l2" }],
            grave: [],
          },
        },
      };

      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p2", proRulePackage);
      const qsPattern = decision.request.patterns.find(
        (p) => p.kind === "ACTION" && decision.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.quickSummonsAce"
      );
      expect(qsPattern).toBeUndefined();
    });

    it("3.3: Non-turn player with chance and Key A + Cost D CAN activate Quick Summon", () => {
      const aceCard = { id: "c-ace", suit: "S", rank: "A", value: 1 };
      const discardCard = { id: "c-cost", suit: "H", rank: "7", value: 7 };
      const state = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p2", // p2 has chance!
        nonTurnPlayer: "p2",
        stage: { requests: [] },
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: {
            hand: [aceCard, discardCard],
            field: [],
            life: [{ id: "l2" }],
            grave: [],
          },
        },
      };

      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p2", proRulePackage);
      const qsPattern = decision.request.patterns.find(
        (p) => p.kind === "ACTION" && decision.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.quickSummonsAce"
      );
      expect(qsPattern).toBeDefined();

      const costRef = qsPattern!.costPaymentRef!;
      const keyRef = qsPattern!.keyCardSelectionRef!;
      expect(decision.request.catalog.costPayments[costRef].discardedCardIds).toEqual(["c-cost"]);
      expect(decision.request.catalog.cardSelections[keyRef].cardIds).toEqual(["c-ace"]);

      expect(() => {
        validator.validateActionRequest(quickSummonDef, {
          state,
          playerKey: "p2",
          keyCard: aceCard,
          components: proRulePackage.components,
        });
      }).not.toThrow();

      const costResolver = new CostResolver();
      const validContext: CommandContext = {
        state,
        playerKey: "p2",
        keyCard: aceCard,
        components: proRulePackage.components,
      };
      expect(
        costResolver.matchesCost(makeCostPayment({ discardedCardIds: [discardCard.id] }), "D", validContext)
      ).toBe(true);
    });

    it("3.4: Key A cannot pay Cost D - if hand has only 1 Ace, no legal pattern is generated", () => {
      const aceCard = { id: "c-ace", suit: "S", rank: "A", value: 1 };
      const state = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p2",
        nonTurnPlayer: "p2",
        stage: { requests: [] },
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: {
            hand: [aceCard], // Only 1 card in hand! Cannot pay Cost D!
            field: [],
            life: [{ id: "l2" }],
            grave: [],
          },
        },
      };

      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p2", proRulePackage);
      const qsPattern = decision.request.patterns.find(
        (p) => p.kind === "ACTION" && decision.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.quickSummonsAce"
      );
      expect(qsPattern).toBeUndefined();

      // CostResolver rejects reusing keyCard for Cost D
      const costResolver = new CostResolver();
      const invalidContext: CommandContext = {
        state,
        playerKey: "p2",
        keyCard: aceCard,
        components: proRulePackage.components,
      };
      expect(
        costResolver.matchesCost(makeCostPayment({ discardedCardIds: [aceCard.id] }), "D", invalidContext)
      ).toBe(false);
    });
  });

  // =========================================================================
  // 4. Effect Resolution: selectOption (Ace vs Bulwark) & Card Conservation
  // =========================================================================
  describe("4. Effect Resolution & Card Conservation", () => {
    it("4.1: Selecting 'ace' summons Ace unit face up in charge state with card from request", () => {
      const aceCard = { id: "c-ace-1", suit: "S", rank: "A", value: 1 };
      const costCard = { id: "c-cost-1", suit: "D", rank: "5", value: 5 };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p2",
        nonTurnPlayer: "p2",
        stage: {
          requests: [
            {
              id: "req-qs-1",
              actionId: "action.quickSummonsAce",
              controller: "p2",
              speed: "normal",
              timing: "quick",
              keyCards: [aceCard],
              status: "pending",
            },
          ],
        },
        players: {
          p1: {
            hand: [{ id: "p1-c1", suit: "H", rank: "2", value: 2 }],
            field: [],
            grave: [],
            life: [{ id: "p1-l1", suit: "H", rank: "3", value: 3 }],
          },
          p2: {
            hand: [],
            field: [],
            grave: [costCard],
            life: [{ id: "p2-l1", suit: "C", rank: "4", value: 4 }],
          },
        },
      };

      const totalCardsBefore = countTotalCards(state);
      expect(totalCardsBefore).toBe(5);

      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      // Start resolution of req-qs-1
      const context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [aceCard],
        keyCard: aceCard,
        currentAction: quickSummonDef,
        currentRequest: state.stage.requests[0],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      // Step 1: selectOption interruption
      const res1: any = interp.executeEffectsWithInterruption(quickSummonDef.effect!, context, 0);
      expect(res1.interrupted).toBe(true);
      if (!res1.interrupted) return;
      expect(res1.selectionType).toBe("option");
      expect(res1.selectionId).toBe("summonMode");
      expect(res1.candidates).toEqual([
        { value: "ace", label: "エースとして場に出す" },
        { value: "bulwark", label: "防壁として場に出す" },
      ]);
      expect(res1.decisionPlayerKey).toBe("p2");

      // Step 2: Supply selection 'ace' and resume
      context.selections = { summonMode: ["ace"] };
      const resumePath = res1.resumeNextIndex !== undefined ? [res1.resumeNextIndex] : [1];
      const res2: any = interp.executeEffectsWithInterruption(quickSummonDef.effect!, context, resumePath);
      expect(res2.interrupted).toBeUndefined();

      // Verify field unit
      const p2Field = state.players.p2.field;
      expect(p2Field).toHaveLength(1);
      const aceUnit = p2Field[0];
      expect(aceUnit.componentId).toBe("character.ace");
      expect(aceUnit.face).toBe("up");
      expect(aceUnit.state).toBe("charge");
      expect(aceUnit.cards).toHaveLength(1);
      expect(aceUnit.cards[0].id).toBe(aceCard.id);

      // Card conservation
      state.stage.requests = []; // stage popped after resolution
      const totalCardsAfter = countTotalCards(state);
      expect(totalCardsAfter).toBe(totalCardsBefore);
    });

    it("4.2: Selecting 'bulwark' summons Bulwark unit face down in charge state with card from request", () => {
      const aceCard = { id: "c-ace-2", suit: "H", rank: "A", value: 1 };
      const costCard = { id: "c-cost-2", suit: "C", rank: "9", value: 9 };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p2",
        nonTurnPlayer: "p2",
        stage: {
          requests: [
            {
              id: "req-qs-2",
              actionId: "action.quickSummonsAce",
              controller: "p2",
              speed: "normal",
              timing: "quick",
              keyCards: [aceCard],
              status: "pending",
            },
          ],
        },
        players: {
          p1: { hand: [{ id: "p1-c1" }], field: [], grave: [], life: [{ id: "p1-l1" }] },
          p2: { hand: [], field: [], grave: [costCard], life: [{ id: "p2-l1" }] },
        },
      };

      const totalCardsBefore = countTotalCards(state);

      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [aceCard],
        keyCard: aceCard,
        currentAction: quickSummonDef,
        currentRequest: state.stage.requests[0],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      // Step 1: selectOption interruption
      const res1: any = interp.executeEffectsWithInterruption(quickSummonDef.effect!, context, 0);
      expect(res1.interrupted).toBe(true);
      if (!res1.interrupted) return;

      // Step 2: Supply selection 'bulwark' and resume
      context.selections = { summonMode: ["bulwark"] };
      const resumePath = res1.resumeNextIndex !== undefined ? [res1.resumeNextIndex] : [1];
      const res2: any = interp.executeEffectsWithInterruption(quickSummonDef.effect!, context, resumePath);
      expect(res2.interrupted).toBeUndefined();

      // Verify field unit
      const p2Field = state.players.p2.field;
      expect(p2Field).toHaveLength(1);
      const bulwarkUnit = p2Field[0];
      expect(bulwarkUnit.componentId).toBe("character.bulwark");
      expect(bulwarkUnit.face).toBe("down");
      expect(bulwarkUnit.state).toBe("charge");
      expect(bulwarkUnit.cards).toHaveLength(1);
      expect(bulwarkUnit.cards[0].id).toBe(aceCard.id);

      // Card conservation
      state.stage.requests = [];
      const totalCardsAfter = countTotalCards(state);
      expect(totalCardsAfter).toBe(totalCardsBefore);
    });
  });

  // =========================================================================
  // 5. Cancelled Request (Countered)
  // =========================================================================
  describe("5. Cancelled Request (Countered)", () => {
    it("5.1: When Quick Summon request is cancelled, key card moves to grave and no unit is summoned", () => {
      const aceCard = { id: "c-ace-c", suit: "S", rank: "A", value: 1 };
      const costCard = { id: "c-cost-c", suit: "H", rank: "8", value: 8 };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p2",
        stage: {
          requests: [
            {
              id: "req-qs-cancel",
              actionId: "action.quickSummonsAce",
              controller: "p2",
              speed: "normal",
              timing: "quick",
              keyCards: [aceCard],
              status: "pending",
            },
          ],
        },
        players: {
          p1: { hand: [{ id: "p1-c" }], field: [], grave: [], life: [{ id: "p1-l" }] },
          p2: { hand: [], field: [], grave: [costCard], life: [{ id: "p2-l" }] },
        },
      };

      const totalCardsBefore = countTotalCards(state);

      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const context: CommandContext = {
        state,
        playerKey: "p2",
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const cancelled = cancelStageRequest("req-qs-cancel", context, interp);
      expect(cancelled.status).toBe("cancelled");
      expect(state.stage.requests).toHaveLength(0);

      // Key card moved to p2 grave
      const graveIds = state.players.p2.grave.map((c: any) => c.id);
      expect(graveIds).toContain(aceCard.id);

      // Field has NO units
      expect(state.players.p2.field).toHaveLength(0);

      // Conservation holds
      const totalCardsAfter = countTotalCards(state);
      expect(totalCardsAfter).toBe(totalCardsBefore);
    });
  });

  // =========================================================================
  // 6. GameSession End-to-End Tests
  // =========================================================================
  describe("6. GameSession End-to-End Integration", () => {
    it("6.1: Full GameSession flow for Quick Summon -> Ace mode", () => {
      const aceCard = { id: "p2-ace", suit: "S", rank: "A", value: 1 };
      const costCard = { id: "p2-cost", suit: "D", rank: "6", value: 6 };
      const extraCard = { id: "p2-extra", suit: "H", rank: "10", value: 10 };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p2",
        nonTurnPlayer: "p2",
        turnCount: 2,
        stage: { requests: [] },
        players: {
          p1: {
            hand: [{ id: "p1-h1", suit: "C", rank: "3", value: 3 }],
            field: [],
            life: [{ id: "p1-l1", suit: "S", rank: "5", value: 5 }],
            grave: [],
          },
          p2: {
            hand: [aceCard, costCard, extraCard],
            field: [],
            life: [{ id: "p2-l1", suit: "D", rank: "4", value: 4 }],
            grave: [],
          },
        },
      };

      const totalCardsBefore = countTotalCards(state);
      const session = new GameSession(state, proRulePackage);

      // Step 1: Advance -> p2 decision request
      const d1: any = session.advance();
      expect(d1.type).toBe("WAITING_FOR_DECISION");
      expect(d1.request.playerId).toBe("p2");

      const qsPatternIdx = d1.request.patterns.findIndex(
        (p: any) => p.kind === "ACTION" && d1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.quickSummonsAce"
      );
      expect(qsPatternIdx).toBeGreaterThanOrEqual(0);

      // Step 2: Submit Quick Summon action
      const d2: any = session.submitDecision({
        decisionId: d1.request.decisionId,
        stateVersion: d1.request.stateVersion,
        selectedPatternRef: qsPatternIdx,
      });

      // Request is placed on Stage (speed: normal)
      expect(session.state.stage.requests).toHaveLength(1);
      const stageReq = session.state.stage.requests[0];
      expect(stageReq.actionId).toBe("action.quickSummonsAce");
      expect(stageReq.controller).toBe("p2");

      const selectedPattern = d1.request.patterns[qsPatternIdx];
      const costPaymentRef = selectedPattern.costPaymentRef!;
      const discardedCardId = d1.request.catalog.costPayments[costPaymentRef].discardedCardIds[0];
      const remainingCardId = [costCard.id, extraCard.id].find((id) => id !== discardedCardId);

      // Key card is moved to stage request, Cost card is moved to grave
      expect(session.state.players.p2.hand).toHaveLength(1);
      expect(session.state.players.p2.hand[0].id).toBe(remainingCardId);
      expect(session.state.players.p2.grave).toHaveLength(1);
      const graveCardId = session.state.players.p2.grave[0]?.cards?.[0]?.id ?? session.state.players.p2.grave[0]?.id;
      expect(graveCardId).toBe(discardedCardId);

      // Step 3: Priority passes to resolve stage
      // Both players PASS to trigger stage resolution
      const passP1 = d2.request.patterns.findIndex((p: any) => p.kind === "PASS");
      const d3: any = session.submitDecision({
        decisionId: d2.request.decisionId,
        stateVersion: d2.request.stateVersion,
        selectedPatternRef: passP1,
      });

      const passP2 = d3.request.patterns.findIndex((p: any) => p.kind === "PASS");
      const d4: any = session.submitDecision({
        decisionId: d3.request.decisionId,
        stateVersion: d3.request.stateVersion,
        selectedPatternRef: passP2,
      });

      // Stage resolves -> Halts with EFFECT_RESOLUTION for summonMode
      expect(d4.type).toBe("WAITING_FOR_DECISION");
      expect(d4.request.source.type).toBe("EFFECT_RESOLUTION");
      expect(d4.request.playerId).toBe("p2");

      // Find 'ace' option pattern
      const acePatternIdx = d4.request.patterns.findIndex((p: any) => {
        if (p.effectSelectionRef === undefined) return false;
        const effSel = d4.request.catalog.effectSelections[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "ace";
      });
      expect(acePatternIdx).toBeGreaterThanOrEqual(0);

      // Step 4: Submit 'ace' option
      const d5: any = session.submitDecision({
        decisionId: d4.request.decisionId,
        stateVersion: d4.request.stateVersion,
        selectedPatternRef: acePatternIdx,
      });

      // Verification: Ace summoned to p2 field
      expect(session.state.players.p2.field).toHaveLength(1);
      const aceUnit = session.state.players.p2.field[0];
      expect(aceUnit.componentId).toBe("character.ace");
      expect(aceUnit.face).toBe("up");
      expect(aceUnit.state).toBe("charge");
      expect(aceUnit.cards[0].id).toBe(aceCard.id);

      // Stage request resolved and empty
      expect(session.state.stage.requests).toHaveLength(0);

      // Chance returns to turn player (p1)
      expect(session.state.chancePlayer).toBe("p1");

      // 54-card conservation
      const totalCardsAfter = countTotalCards(session.state);
      expect(totalCardsAfter).toBe(totalCardsBefore);
    });

    it("6.2: Full GameSession flow for Quick Summon -> Bulwark mode", () => {
      const aceCard = { id: "p2-ace-bw", suit: "S", rank: "A", value: 1 };
      const costCard = { id: "p2-cost-bw", suit: "D", rank: "6", value: 6 };
      const extraCard = { id: "p2-extra-bw", suit: "H", rank: "10", value: 10 };

      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p2",
        nonTurnPlayer: "p2",
        turnCount: 2,
        stage: { requests: [] },
        players: {
          p1: {
            hand: [{ id: "p1-h1", suit: "C", rank: "3", value: 3 }],
            field: [],
            life: [{ id: "p1-l1", suit: "S", rank: "5", value: 5 }],
            grave: [],
          },
          p2: {
            hand: [aceCard, costCard, extraCard],
            field: [],
            life: [{ id: "p2-l1", suit: "D", rank: "4", value: 4 }],
            grave: [],
          },
        },
      };

      const totalCardsBefore = countTotalCards(state);
      const session = new GameSession(state, proRulePackage);

      // Advance -> p2 decision
      const d1: any = session.advance();
      const qsPatternIdx = d1.request.patterns.findIndex(
        (p: any) => p.kind === "ACTION" && d1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.quickSummonsAce"
      );

      // Submit Quick Summon
      const d2: any = session.submitDecision({
        decisionId: d1.request.decisionId,
        stateVersion: d1.request.stateVersion,
        selectedPatternRef: qsPatternIdx,
      });

      // Pass priority
      const passP1 = d2.request.patterns.findIndex((p: any) => p.kind === "PASS");
      const d3: any = session.submitDecision({
        decisionId: d2.request.decisionId,
        stateVersion: d2.request.stateVersion,
        selectedPatternRef: passP1,
      });

      const passP2 = d3.request.patterns.findIndex((p: any) => p.kind === "PASS");
      const d4: any = session.submitDecision({
        decisionId: d3.request.decisionId,
        stateVersion: d3.request.stateVersion,
        selectedPatternRef: passP2,
      });

      // Stage resolves -> Halts with EFFECT_RESOLUTION for summonMode
      expect(d4.request.source.type).toBe("EFFECT_RESOLUTION");

      // Find 'bulwark' option pattern
      const bulwarkPatternIdx = d4.request.patterns.findIndex((p: any) => {
        if (p.effectSelectionRef === undefined) return false;
        const effSel = d4.request.catalog.effectSelections[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "bulwark";
      });
      expect(bulwarkPatternIdx).toBeGreaterThanOrEqual(0);

      // Submit 'bulwark' option
      session.submitDecision({
        decisionId: d4.request.decisionId,
        stateVersion: d4.request.stateVersion,
        selectedPatternRef: bulwarkPatternIdx,
      });

      // Verification: Bulwark summoned to p2 field
      expect(session.state.players.p2.field).toHaveLength(1);
      const bulwarkUnit = session.state.players.p2.field[0];
      expect(bulwarkUnit.componentId).toBe("character.bulwark");
      expect(bulwarkUnit.face).toBe("down");
      expect(bulwarkUnit.state).toBe("charge");
      expect(bulwarkUnit.cards[0].id).toBe(aceCard.id);

      // Conservation
      const totalCardsAfter = countTotalCards(session.state);
      expect(totalCardsAfter).toBe(totalCardsBefore);
    });
  });
});
