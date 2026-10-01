import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { loadRulePackageFromDirectory, clearRulePackageCache } from "../../engine/rules/RuleLoader";
import {
  loadRegulationCatalog,
  getRegulation,
  getFrame,
  getFormat,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { STANDARD_54_DECK_CARDS } from "../../engine/regulation/SimulatorDeckProfileResolver";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { GameSession } from "../../engine/session/GameSession";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { ActionActivationConditionEvaluator } from "../../engine/rules/ActionActivationConditionEvaluator";
import { RulePackage } from "../../domain/rules/RulePackage";
import { KnownCardView } from "../../domain/decision/PlayerObservation";
import { CostPayment } from "../../domain/decision/DecisionCatalog";
import { CommandRegistry, CommandContext, cancelStageRequest } from "../../engine/rules/CommandRegistry";

function makeCostPayment(overrides: Partial<CostPayment> = {}): CostPayment {
  return {
    discardedCardIds: [],
    drivenBulwarkUnitIds: [],
    sacrificedUnitIds: [],
    lifeCount: 0,
    ...overrides,
  };
}

describe("BP-SIM-REG-4.0-C: Rare Summon Official Semantics & Integration", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let rarePackRulePackage: RulePackage;
  let standardPackRulePackage: RulePackage;

  beforeAll(async () => {
    clearRegulationCache();
    clearRulePackageCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    const standardFormat = await getFormat("standard");
    const rarePackFrame = await getFrame("rarePack");
    const standardRarePackReg = await getRegulation("standard-rarePack");
    rarePackRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardRarePackReg,
      rarePackFrame
    );

    const packFrame = await getFrame("pack");
    const standardPackReg = await getRegulation("standard-pack");
    standardPackRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg,
      packFrame
    );
  });

  // A. Rule definition contract
  it("A: action.rareSummon is loaded with correct official specification", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.rareSummon");
    expect(action).toBeDefined();
    expect(action!.name).toBe("レア召喚");
    expect(action!.type).toBe("summon");

    expect(action!.request.trigger).toBe("direct");
    expect(action!.request.speed).toBe("normal");
    expect(action!.request.timing).toBe("quick");

    expect(action!.cost).toBe("S");
    expect(action!.key).toBeDefined();
    expect(action!.key!.id).toBe("key");
    expect(action!.key!.condition?.card?.zone).toBe("rare");
    expect(action!.key!.visibilityOnRequest).toBe("public");

    expect(action!.activationCondition).toBeDefined();
    expect(action!.activationCondition!.zoneCount).toEqual({
      player: "controller",
      zone: "life",
      atMost: 9,
    });

    expect(action!.effect).toEqual([
      {
        summonUnit: {
          card: "key",
          face: "up",
          state: "charge",
        },
      },
    ]);
  });

  // B. Regulation package contract
  it("B: rarePack frame includes action.rareSummon, whereas pack frame does NOT", () => {
    const rarePackActionIds = rarePackRulePackage.actions.map((a) => a.id);
    expect(rarePackActionIds).toContain("action.rareSummon");

    const standardPackActionIds = standardPackRulePackage.actions.map((a) => a.id);
    expect(standardPackActionIds).not.toContain("action.rareSummon");
  });

  // C. Activation boundary contract: life = 10
  it("C: Activation boundary: life = 10 is illegal for generator, validator, and evaluator", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const state = outcome.state;
    const turnPlayer = state.turnPlayer;
    const validator = new ActionRequestValidator();
    const rareSummonDef = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

    // Set life to 10
    const excessLife10 = state.players[turnPlayer].life.splice(10);
    state.players[turnPlayer].grave.push(...excessLife10);
    expect(state.players[turnPlayer].life.length).toBe(10);

    const decision10 = LegalPatternGenerator.generateActionRequestDecision(state, turnPlayer, rarePackRulePackage);
    const pattern10 = decision10.request.patterns.find(
      (p) => p.kind === "ACTION" && decision10.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareSummon"
    );
    expect(pattern10).toBeUndefined();

    const rareCard = state.players[turnPlayer].rareCards[0];
    expect(() => {
      validator.validateActionRequest(rareSummonDef, {
        state,
        playerKey: turnPlayer,
        keyCard: rareCard,
        components: rarePackRulePackage.components,
      });
    }).toThrow(ValidationError);

    const evalRes10 = ActionActivationConditionEvaluator.evaluate(rareSummonDef.activationCondition, {
      state,
      playerKey: turnPlayer,
    });
    expect(evalRes10.isLegal).toBe(false);
  });

  // D. Activation boundary contract: life = 9
  it("D: Activation boundary: life = 9 is legal for generator, validator, and evaluator", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const state = outcome.state;
    const turnPlayer = state.turnPlayer;
    const validator = new ActionRequestValidator();
    const rareSummonDef = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

    // Set life to 9
    const excessLife9 = state.players[turnPlayer].life.splice(9);
    state.players[turnPlayer].grave.push(...excessLife9);
    expect(state.players[turnPlayer].life.length).toBe(9);

    const decision9 = LegalPatternGenerator.generateActionRequestDecision(state, turnPlayer, rarePackRulePackage);
    const pattern9 = decision9.request.patterns.find(
      (p) => p.kind === "ACTION" && decision9.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareSummon"
    );
    expect(pattern9).toBeDefined();

    const rareCard = state.players[turnPlayer].rareCards[0];
    expect(() => {
      validator.validateActionRequest(rareSummonDef, {
        state,
        playerKey: turnPlayer,
        keyCard: rareCard,
        components: rarePackRulePackage.components,
      });
    }).not.toThrow();

    const evalRes9 = ActionActivationConditionEvaluator.evaluate(rareSummonDef.activationCondition, {
      state,
      playerKey: turnPlayer,
    });
    expect(evalRes9.isLegal).toBe(true);
  });

  // E. Rare card empty failure
  it("E: Rare Card empty failure: cannot activate when rareCards zone is empty", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const state = outcome.state;
    const turnPlayer = state.turnPlayer;
    const validator = new ActionRequestValidator();
    const rareSummonDef = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

    // Life = 9
    const excessLife = state.players[turnPlayer].life.splice(9);
    state.players[turnPlayer].grave.push(...excessLife);

    // Empty rareCards
    state.players[turnPlayer].rareCards = [];

    const decision = LegalPatternGenerator.generateActionRequestDecision(state, turnPlayer, rarePackRulePackage);
    const pattern = decision.request.patterns.find(
      (p) => p.kind === "ACTION" && decision.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareSummon"
    );
    expect(pattern).toBeUndefined();

    expect(() => {
      validator.validateActionRequest(rareSummonDef, {
        state,
        playerKey: turnPlayer,
        keyCard: { id: "dummy-card", suit: "S", rank: "2", value: 2 },
        components: rarePackRulePackage.components,
      });
    }).toThrow(ValidationError);
  });

  // F. Cost S failure when no character on field
  it("F: Cost S failure: cannot activate when field has no sacrifice character", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const state = outcome.state;
    const turnPlayer = state.turnPlayer;
    const validator = new ActionRequestValidator();
    const rareSummonDef = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

    // Life = 9
    const excessLife = state.players[turnPlayer].life.splice(9);
    state.players[turnPlayer].grave.push(...excessLife);

    // Empty field
    state.players[turnPlayer].field = [];

    const decision = LegalPatternGenerator.generateActionRequestDecision(state, turnPlayer, rarePackRulePackage);
    const pattern = decision.request.patterns.find(
      (p) => p.kind === "ACTION" && decision.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareSummon"
    );
    expect(pattern).toBeUndefined();

    const rareCard = state.players[turnPlayer].rareCards[0];
    expect(() => {
      validator.validateActionRequest(rareSummonDef, {
        state,
        playerKey: turnPlayer,
        keyCard: rareCard,
        components: rarePackRulePackage.components,
      });
    }).toThrow(ValidationError);
  });

  // G. Cost S enumeration with multiple characters
  it("G: Cost S enumeration: generates distinct patterns for each character sacrifice option", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const state = outcome.state;
    const turnPlayer = state.turnPlayer;

    // Life = 9
    const excessLife = state.players[turnPlayer].life.splice(9);
    state.players[turnPlayer].grave.push(...excessLife);

    // Initial field already has 2 preset characters (bulwark and soldier)
    expect(state.players[turnPlayer].field.length).toBe(2);
    const expectedUnitIds = state.players[turnPlayer].field.map((u: any) => u.unitId);

    const decision = LegalPatternGenerator.generateActionRequestDecision(state, turnPlayer, rarePackRulePackage);
    const rareSummonPatterns = decision.request.patterns.filter(
      (p) => p.kind === "ACTION" && decision.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareSummon"
    );
    expect(rareSummonPatterns.length).toBe(2);

    const costPayments = rareSummonPatterns.map(
      (p) => decision.request.catalog.costPayments[p.costPaymentRef!]
    );
    const sacUnitIds = costPayments.map((cp) => cp.sacrificedUnitIds?.[0]);
    expect(sacUnitIds.sort()).toEqual(expectedUnitIds.sort());
  });

  // H, I, J, P: Stage lifecycle, Full Public on Stage, Resolution to field, 54-card conservation
  it("H, I, J, P: Rare Summon stage request is normal speed, full public to both players, resolves to field with 54-card conservation", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = new GameSession(outcome.state, rarePackRulePackage);
    const turnPlayer = session.state.turnPlayer;
    const opponentPlayer = turnPlayer === "p1" ? "p2" : "p1";

    // Set life to 9
    const excessLife = session.state.players[turnPlayer].life.splice(9);
    session.state.players[turnPlayer].grave.push(...excessLife);

    // Verify 54 card conservation before Rare Summon
    expect(() => {
      OfficialRegulationMatchSetup.verifyCardConservation(
        turnPlayer,
        session.state.players[turnPlayer],
        STANDARD_54_DECK_CARDS,
        session.state
      );
    }).not.toThrow();

    const rareCard = session.state.players[turnPlayer].rareCards[0];
    expect(rareCard).toBeDefined();

    const initialFieldCount = session.state.players[turnPlayer].field.length; // 2 preset units

    // Advance session to prompt decision
    let step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;

    const decisionRequest = step.request;
    const patternIndex = decisionRequest.patterns.findIndex(
      (p) => p.kind === "ACTION" && decisionRequest.catalog.actions[p.actionSelectionRef!].actionId === "action.rareSummon"
    );
    expect(patternIndex).toBeGreaterThanOrEqual(0);

    // Submit Rare Summon decision
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: patternIndex,
    });

    // H. Normal speed stage semantics: request is placed on Stage, NOT resolved immediately
    expect(session.state.stage.requests.length).toBe(1);
    const stageReq = session.state.stage.requests[0];
    expect(stageReq.actionId).toBe("action.rareSummon");
    expect(stageReq.action?.request?.speed).toBe("normal");
    expect(stageReq.action?.request?.timing).toBe("quick");
    expect(stageReq.keyCards?.length).toBe(1);
    expect(stageReq.keyCards?.[0].id).toBe(rareCard.id);

    // Cost S paid upon request creation: 1 character sacrificed to grave
    expect(session.state.players[turnPlayer].field.length).toBe(initialFieldCount - 1);

    // Rare card removed from player.rareCards
    expect(session.state.players[turnPlayer].rareCards.length).toBe(0);

    // P. Card conservation DURING stage request (4th param state accounts for stage.requests keyCards)
    expect(() => {
      OfficialRegulationMatchSetup.verifyCardConservation(
        turnPlayer,
        session.state.players[turnPlayer],
        STANDARD_54_DECK_CARDS,
        session.state
      );
    }).not.toThrow();

    // I. Visibility on Request (Full Public): BOTH controller and opponent see KnownCardView
    const obsTurnPlayer = ObservationFactory.createObservation(session.state, turnPlayer);
    const obsOpponent = ObservationFactory.createObservation(session.state, opponentPlayer);

    expect(obsTurnPlayer.stageRequests.length).toBe(1);
    expect(obsOpponent.stageRequests.length).toBe(1);

    const tpKeyCard = obsTurnPlayer.stageRequests[0].keyCards?.[0] as KnownCardView;
    const oppKeyCard = obsOpponent.stageRequests[0].keyCards?.[0] as KnownCardView;

    expect(tpKeyCard).toBeDefined();
    expect(tpKeyCard.visibility).toBe("KNOWN");
    expect(tpKeyCard.suit).toBe(rareCard.suit);
    expect(tpKeyCard.rank).toBe(rareCard.rank);

    expect(oppKeyCard).toBeDefined();
    expect(oppKeyCard.visibility).toBe("KNOWN");
    expect(oppKeyCard.suit).toBe(rareCard.suit);
    expect(oppKeyCard.rank).toBe(rareCard.rank);

    // Pass priority until Stage request resolves
    while (step.type === "WAITING_FOR_DECISION" && (session.state.stage?.requests?.length || 0) > 0) {
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passIdx === -1) break;
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    // J. Resolution to field
    expect(session.state.stage.requests.length).toBe(0);
    expect(session.state.players[turnPlayer].field.length).toBe(initialFieldCount);
    const summonedUnit = session.state.players[turnPlayer].field.find(
      (u: any) => u.cards?.[0]?.id === rareCard.id
    );
    expect(summonedUnit).toBeDefined();
    expect(summonedUnit.face).toBe("up");
    expect(summonedUnit.state).toBe("charge");
    expect(summonedUnit.cards[0].id).toBe(rareCard.id);

    // P. Card conservation AFTER resolution
    expect(() => {
      OfficialRegulationMatchSetup.verifyCardConservation(
        turnPlayer,
        session.state.players[turnPlayer],
        STANDARD_54_DECK_CARDS,
        session.state
      );
    }).not.toThrow();
  });

  // K, L, M, N: Dynamic Soldier Mapping for 7, Q, A, Joker
  describe("Dynamic Soldier Component Auto-Resolution", () => {
    const setupRegistryAndContext = (rareCard: any) => {
      const registry = new CommandRegistry();
      const sacUnit = {
        unitId: "u-sac",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-sac-1", suit: "S", rank: "2", value: 2 }],
      };
      const state = {
        turnPlayer: "p1",
        stateVersion: 1,
        turnCount: 1,
        players: {
          p1: {
            name: "Player A",
            life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
            hand: [],
            field: [sacUnit],
            grave: [],
            fog: [],
            rareCards: [rareCard],
          },
          p2: {
            name: "Player B",
            life: [],
            hand: [],
            field: [],
            grave: [],
            fog: [],
            rareCards: [],
          },
        },
        stage: { requests: [], history: [] },
      } as any;

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: rareCard,
        keyCards: [rareCard],
        actions: rarePackRulePackage.actions,
        components: rarePackRulePackage.components,
      };

      return { registry, state, context, sacUnit };
    };

    it("K: Dynamic mapping - Rank 7 resolves to character.soldier (一般兵)", () => {
      const rareCard7 = { id: "p1-c-S7", suit: "S", rank: "7", value: 7 };
      const { registry, state, context, sacUnit } = setupRegistryAndContext(rareCard7);
      const rareSummonAction = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

      const req = registry.createRequest(rareSummonAction, context, {
        selectedCostPayment: makeCostPayment({
          sacrificedUnitIds: [sacUnit.unitId],
          summary: "$S",
        }),
      });

      registry.resolveRequest(req, context);

      expect(state.players.p1.field.length).toBe(1);
      const unit = state.players.p1.field[0];
      expect(unit.componentId).toBe("character.soldier");
      expect(unit.kind).toBe("一般兵");
      expect(unit.face).toBe("up");
      expect(unit.state).toBe("charge");
      expect(unit.cards[0].id).toBe(rareCard7.id);
    });

    it("L: Dynamic mapping - Rank Q resolves to character.hero (英雄)", () => {
      const rareCardQ = { id: "p1-c-HQ", suit: "H", rank: "Q", value: 12 };
      const { registry, state, context, sacUnit } = setupRegistryAndContext(rareCardQ);
      const rareSummonAction = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

      const req = registry.createRequest(rareSummonAction, context, {
        selectedCostPayment: makeCostPayment({
          sacrificedUnitIds: [sacUnit.unitId],
          summary: "$S",
        }),
      });

      registry.resolveRequest(req, context);

      expect(state.players.p1.field.length).toBe(1);
      const unit = state.players.p1.field[0];
      expect(unit.componentId).toBe("character.hero");
      expect(unit.kind).toBe("英雄");
      expect(unit.face).toBe("up");
      expect(unit.state).toBe("charge");
      expect(unit.cards[0].id).toBe(rareCardQ.id);
    });

    it("M: Dynamic mapping - Rank A resolves to character.ace (エース)", () => {
      const rareCardA = { id: "p1-c-DA", suit: "D", rank: "A", value: 1 };
      const { registry, state, context, sacUnit } = setupRegistryAndContext(rareCardA);
      const rareSummonAction = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

      const req = registry.createRequest(rareSummonAction, context, {
        selectedCostPayment: makeCostPayment({
          sacrificedUnitIds: [sacUnit.unitId],
          summary: "$S",
        }),
      });

      registry.resolveRequest(req, context);

      expect(state.players.p1.field.length).toBe(1);
      const unit = state.players.p1.field[0];
      expect(unit.componentId).toBe("character.ace");
      expect(unit.kind).toBe("エース");
      expect(unit.face).toBe("up");
      expect(unit.state).toBe("charge");
      expect(unit.cards[0].id).toBe(rareCardA.id);
    });

    it("N: Dynamic mapping - Rank Joker resolves to character.magician (魔術士)", () => {
      const rareCardJoker = { id: "p1-c-J★", suit: "J", rank: "Joker", value: 0 };
      const { registry, state, context, sacUnit } = setupRegistryAndContext(rareCardJoker);
      const rareSummonAction = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

      const req = registry.createRequest(rareSummonAction, context, {
        selectedCostPayment: makeCostPayment({
          sacrificedUnitIds: [sacUnit.unitId],
          summary: "$S",
        }),
      });

      registry.resolveRequest(req, context);

      expect(state.players.p1.field.length).toBe(1);
      const unit = state.players.p1.field[0];
      expect(unit.componentId).toBe("character.magician");
      expect(unit.kind).toBe("魔術士");
      expect(unit.face).toBe("up");
      expect(unit.state).toBe("charge");
      expect(unit.cards[0].id).toBe(rareCardJoker.id);
    });
  });

  // O. Canonical Movement & Event Lifecycle
  it("O: Canonical Card Movement & Event Lifecycle: rare -> request, request -> field, and request -> grave on cancellation", () => {
    const registry = new CommandRegistry();
    const interpreter = registry.getEffectInterpreter();
    const events: any[] = [];
    const origEmit = registry.emitEvent.bind(registry);
    registry.emitEvent = (evt: any, ctx?: any) => {
      events.push(evt);
      origEmit(evt, ctx);
    };

    const rareCard = { id: "p1-c-S7", suit: "S", rank: "7", value: 7 };
    const sacUnit = {
      unitId: "u-sac-o",
      componentId: "character.soldier",
      kind: "一般兵",
      state: "charge",
      cards: [{ id: "c-sac-o", suit: "S", rank: "2", value: 2 }],
    };
    const state = {
      turnPlayer: "p1",
      stateVersion: 1,
      turnCount: 1,
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [],
          field: [sacUnit],
          grave: [],
          fog: [],
          rareCards: [rareCard],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [],
          grave: [],
          fog: [],
          rareCards: [],
        },
      },
      stage: { requests: [], history: [] },
    } as any;

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: rareCard,
      keyCards: [rareCard],
      actions: rarePackRulePackage.actions,
      components: rarePackRulePackage.components,
    };
    const rareSummonAction = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;

    // 1. createRequest: emits cardMoved (rare -> request) and cardRevealed (target: all)
    const req = registry.createRequest(rareSummonAction, context, {
      selectedCostPayment: makeCostPayment({
        sacrificedUnitIds: [sacUnit.unitId],
        summary: "$S",
      }),
    });

    const moveRareToReq = events.find(
      (e) => e.type === "cardMoved" && e.payload?.card?.id === rareCard.id && e.payload?.fromZone === "rare" && e.payload?.toZone === "request"
    );
    expect(moveRareToReq).toBeDefined();

    const revealEvent = events.find(
      (e) => e.type === "cardRevealed" && e.payload?.card?.id === rareCard.id && e.payload?.target === "all"
    );
    expect(revealEvent).toBeDefined();

    // 2. Normal resolution: emits cardMoved (request -> field)
    registry.resolveRequest(req, context);

    const moveReqToField = events.find(
      (e) => e.type === "cardMoved" && e.payload?.card?.id === rareCard.id && e.payload?.fromZone === "request" && e.payload?.toZone === "field"
    );
    expect(moveReqToField).toBeDefined();

    // 3. Cancellation test: create new request and cancelStageRequest -> emits cardMoved (request -> grave)
    const rareCardCancel = { id: "p1-c-S8", suit: "S", rank: "8", value: 8 };
    const sacUnit2 = {
      unitId: "u-sac-2",
      componentId: "character.soldier",
      kind: "一般兵",
      state: "charge",
      cards: [{ id: "c-sac-2", suit: "S", rank: "2", value: 2 }],
    };
    state.players.p1.field.push(sacUnit2);
    state.players.p1.rareCards = [rareCardCancel];
    context.keyCard = rareCardCancel;
    context.keyCards = [rareCardCancel];

    const cancelReq = registry.createRequest(rareSummonAction, context, {
      selectedCostPayment: makeCostPayment({
        sacrificedUnitIds: [sacUnit2.unitId],
        summary: "$S",
      }),
    });

    cancelStageRequest(cancelReq.id, context, interpreter);

    const moveReqToGrave = events.find(
      (e) => e.type === "cardMoved" && e.payload?.card?.id === rareCardCancel.id && e.payload?.fromZone === "request" && e.payload?.toZone === "grave"
    );
    expect(moveReqToGrave).toBeDefined();
    expect(state.players.p1.grave.some((c: any) => c.id === rareCardCancel.id || c.cards?.[0]?.id === rareCardCancel.id)).toBe(true);
  });

  it("Q: Quick timing on non-empty stage & Rare visibility transition (Sections 7 & 8)", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 77777);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = new GameSession(outcome.state, rarePackRulePackage);

    // Set p1 life <= 9
    session.state.players.p1.life = session.state.players.p1.life.slice(0, 5); // 5 life <= 9
    const p1RareCard = session.state.players.p1.rareCards[0];
    expect(p1RareCard).toBeDefined();

    // 1. Before Rare Summon: Opponent (p2) Observation:
    // Rare count = 1, Rare content = hidden / unavailable
    const obsBeforeP2 = ObservationFactory.createObservation(session.state, "p2");
    const p1ViewBefore = obsBeforeP2.players.find((p) => p.playerId === "p1")!;
    expect(p1ViewBefore.rareCards?.count).toBe(1);
    expect(p1ViewBefore.rareCards?.canViewCards).toBe(false);
    expect(p1ViewBefore.rareCards?.cards).toEqual([]);

    // 2. Non-empty Stage setup: Stage already has an existing request
    const existingReq = {
      id: "req-existing-1",
      sequence: 1,
      actionId: "action.twist",
      controller: "p2",
      status: "pending",
      keyCards: [{ id: "c-twist-key", suit: "D", rank: "4", value: 4 }],
    } as any;
    session.state.stage = {
      requests: [existingReq],
      history: [],
    };

    // p1 has Chance
    session.state.chancePlayer = "p1";
    session.state.turnPlayer = "p2";

    // 3. Section 7: Rare Summon controller has chance on non-empty stage ->
    // LegalPatternGenerator MUST include action.rareSummon (quick timing allows non-empty stage)
    const { request: decReq } = LegalPatternGenerator.generateActionRequestDecision(
      session.state,
      "p1",
      rarePackRulePackage
    );

    const rareSummonPatterns = decReq.patterns.filter(
      (p) => p.kind === "ACTION" && decReq.catalog.actions[p.actionSelectionRef!]?.actionId === "action.rareSummon"
    );
    expect(rareSummonPatterns.length).toBeGreaterThan(0);

    // In contrast, main action (e.g. summonSoldier or setBulwark) must NOT appear on non-empty stage
    const mainActionPatterns = decReq.patterns.filter((p) => {
      if (p.kind !== "ACTION") return false;
      const act = decReq.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.summonSoldier" || act?.actionId === "action.setBulwark";
    });
    expect(mainActionPatterns.length).toBe(0);

    // 4. Submit Rare Summon request
    const sacUnit = session.state.players.p1.field[0]; // preset unit on field
    expect(sacUnit).toBeDefined();

    const rareSummonAction = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;
    const context: CommandContext = {
      state: session.state,
      playerKey: "p1",
      keyCard: p1RareCard,
      keyCards: [p1RareCard],
      actions: rarePackRulePackage.actions,
      components: rarePackRulePackage.components,
    };

    const rareSummonReq = session.registry.createRequest(rareSummonAction, context, {
      selectedCostPayment: makeCostPayment({
        sacrificedUnitIds: [sacUnit.unitId],
        summary: "$S",
      }),
    });

    // Rare Summon pushed onto stage: existing request, Rare Summon
    // Rare Summon is TOP of stack
    expect(session.state.stage.requests.length).toBe(2);
    expect(session.state.stage.requests[0].id).toBe("req-existing-1");
    expect(session.state.stage.requests[1].id).toBe(rareSummonReq.id);

    // 5. Section 8: Transition assertion after Rare Summon Request is formed:
    // Opponent Observation: Rare count = 0
    // Stage Request key card: Opponent also gets KNOWN card with id, suit, rank, value
    const obsAfterP2 = ObservationFactory.createObservation(session.state, "p2");
    const p1ViewAfter = obsAfterP2.players.find((p) => p.playerId === "p1")!;
    expect(p1ViewAfter.rareCards?.count).toBe(0);

    const stagedReqP2 = obsAfterP2.stageRequests.find((r) => r.requestId === rareSummonReq.id);
    expect(stagedReqP2).toBeDefined();
    expect(stagedReqP2!.keyCards).toBeDefined();
    expect(stagedReqP2!.keyCards!.length).toBe(1);

    const knownKeyCard = stagedReqP2!.keyCards![0] as KnownCardView;
    expect(knownKeyCard.visibility).toBe("KNOWN");
    expect(knownKeyCard.cardInstanceId).toBe(p1RareCard.id);
    expect(knownKeyCard.suit).toBe(p1RareCard.suit);
    expect(knownKeyCard.rank).toBe(p1RareCard.rank);
    expect(knownKeyCard.value).toBe(p1RareCard.value);
  });
});
