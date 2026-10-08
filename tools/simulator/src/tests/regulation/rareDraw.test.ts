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
import { moveCardHandler } from "../../engine/rules/commandHandlers";

describe("BP-SIM-REG-4.0-B: Rare Draw Official Semantics & Integration", () => {
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
  it("A: action.rareDraw is loaded with correct official specification", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.rareDraw");
    expect(action).toBeDefined();
    expect(action!.name).toBe("レアドロー");
    expect(action!.type).toBe("rareCardOperation");

    expect(action!.request.trigger).toBe("direct");
    expect(action!.request.speed).toBe("immediate");
    expect(action!.request.timing).toBe("quick");

    expect(action!.cost).toBeUndefined();
    expect(action!.key).toBeUndefined();
    expect(action!.targets).toBeUndefined();

    expect(action!.activationCondition).toBeDefined();
    expect(action!.activationCondition!.all).toEqual([
      {
        zoneCount: {
          player: "controller",
          zone: "life",
          atMost: 9,
        },
      },
      {
        zoneCount: {
          player: "controller",
          zone: "rare",
          atLeast: 1,
        },
      },
    ]);
  });

  // B. Regulation package contract
  it("B: rarePack frame includes action.rareDraw, whereas pack frame does NOT", () => {
    const rarePackActionIds = rarePackRulePackage.actions.map((a) => a.id);
    expect(rarePackActionIds).toContain("action.packOpen");
    expect(rarePackActionIds).toContain("action.rareDraw");

    const standardPackActionIds = standardPackRulePackage.actions.map((a) => a.id);
    expect(standardPackActionIds).toContain("action.packOpen");
    expect(standardPackActionIds).not.toContain("action.rareDraw");
  });

  // C. Activation boundary contract (3点セット: life>9: illegal, life<=9+rare>=1: legal, life<=9+rare==0: illegal)
  it("C: Activation boundary: life = 10 is illegal, life = 9 + rare >= 1 is legal, life = 9 + rare = 0 is illegal [BP-SIM-BUG-RAREDRAW-EMPTY-ZONE-LOOP-R1]", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const state = outcome.state;
    const turnPlayer = state.turnPlayer;
    const validator = new ActionRequestValidator();
    const rareDrawDef = rarePackRulePackage.actions.find((a) => a.id === "action.rareDraw")!;

    // 1. Life = 10, rare = 1: Not legal (life boundary)
    const excessLife10 = state.players[turnPlayer].life.splice(10);
    state.players[turnPlayer].grave.push(...excessLife10);
    expect(state.players[turnPlayer].life.length).toBe(10);
    expect(state.players[turnPlayer].rareCards.length).toBeGreaterThanOrEqual(1);

    const decision10 = LegalPatternGenerator.generateActionRequestDecision(state, turnPlayer, rarePackRulePackage);
    const pattern10 = decision10.request.patterns.find(
      (p) => p.kind === "ACTION" && decision10.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareDraw"
    );
    expect(pattern10).toBeUndefined();

    expect(() => {
      validator.validateActionRequest(rareDrawDef, { state, playerKey: turnPlayer });
    }).toThrow(ValidationError);

    // Evaluator directly reports illegal
    const evalRes10 = ActionActivationConditionEvaluator.evaluate(rareDrawDef.activationCondition, {
      state,
      playerKey: turnPlayer,
    });
    expect(evalRes10.isLegal).toBe(false);

    // 2. Life = 9, rare = 1: Legal (positive case)
    const excessLife9 = state.players[turnPlayer].life.splice(9);
    state.players[turnPlayer].grave.push(...excessLife9);
    expect(state.players[turnPlayer].life.length).toBe(9);
    expect(state.players[turnPlayer].rareCards.length).toBe(1);

    const decision9 = LegalPatternGenerator.generateActionRequestDecision(state, turnPlayer, rarePackRulePackage);
    const pattern9 = decision9.request.patterns.find(
      (p) => p.kind === "ACTION" && decision9.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareDraw"
    );
    expect(pattern9).toBeDefined();

    expect(() => {
      validator.validateActionRequest(rareDrawDef, { state, playerKey: turnPlayer });
    }).not.toThrow();

    const evalRes9 = ActionActivationConditionEvaluator.evaluate(rareDrawDef.activationCondition, {
      state,
      playerKey: turnPlayer,
    });
    expect(evalRes9.isLegal).toBe(true);

    // 3. Life = 9, rare = 0: Not legal (reproduction of Incident: empty rare zone)
    const savedRares = state.players[turnPlayer].rareCards.splice(0);
    expect(state.players[turnPlayer].rareCards.length).toBe(0);

    const decisionEmptyRare = LegalPatternGenerator.generateActionRequestDecision(state, turnPlayer, rarePackRulePackage);
    const patternEmptyRare = decisionEmptyRare.request.patterns.find(
      (p) => p.kind === "ACTION" && decisionEmptyRare.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareDraw"
    );
    expect(patternEmptyRare).toBeUndefined();

    expect(() => {
      validator.validateActionRequest(rareDrawDef, { state, playerKey: turnPlayer });
    }).toThrow(ValidationError);

    const evalResEmptyRare = ActionActivationConditionEvaluator.evaluate(rareDrawDef.activationCondition, {
      state,
      playerKey: turnPlayer,
    });
    expect(evalResEmptyRare.isLegal).toBe(false);
    expect(evalResEmptyRare.reason).toContain("下限 (1) 未満");

    // リストア
    state.players[turnPlayer].rareCards.push(...savedRares);
  });

  // D, E, G, H, I: Resolution, physical card conservation, no reveal, canonical match log, immediate semantics
  it("D, E, G, H, I: Rare Draw resolution moves card to hand, preserves physical card and 54 conservation, emits no reveal", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = new GameSession(outcome.state, rarePackRulePackage);
    const turnPlayer = session.state.turnPlayer;
    const opponentPlayer = turnPlayer === "p1" ? "p2" : "p1";

    // Set life to 9 to satisfy activation condition by moving excess life to grave
    const excessLife = session.state.players[turnPlayer].life.splice(9);
    session.state.players[turnPlayer].grave.push(...excessLife);

    // Verify 54 card conservation before Rare Draw
    expect(() => {
      OfficialRegulationMatchSetup.verifyCardConservation(
        turnPlayer,
        session.state.players[turnPlayer],
        STANDARD_54_DECK_CARDS
      );
    }).not.toThrow();

    // Verify initial conditions
    expect(session.state.players[turnPlayer].rareCards.length).toBe(1);
    const initialRareCard = session.state.players[turnPlayer].rareCards[0];
    const initialHandCount = session.state.players[turnPlayer].hand.length;

    // Advance session to prompt decision
    const step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;

    const patternIndex = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareDraw"
    );
    expect(patternIndex).toBeGreaterThanOrEqual(0);

    // Submit Rare Draw decision
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: patternIndex,
    });

    // I. Immediate semantics: resolution finishes immediately without lingering on stage or prompting another decision
    expect(session.state.stage.requests.length).toBe(0);

    // D. Resolution: Rare zone is empty, hand count N+1, card identity preserved
    expect(session.state.players[turnPlayer].rareCards.length).toBe(0);
    expect(session.state.players[turnPlayer].hand.length).toBe(initialHandCount + 1);

    const movedCard = session.state.players[turnPlayer].hand.find((c: any) => c.id === initialRareCard.id);
    expect(movedCard).toBeDefined();
    expect(movedCard).toBe(initialRareCard); // exact physical object reference

    // D2. Post-resolution: Once rareCards is 0, subsequent LegalPatternGenerator MUST NOT offer action.rareDraw [BP-SIM-BUG-RAREDRAW-EMPTY-ZONE-LOOP-R1]
    const postResolutionDecision = LegalPatternGenerator.generateActionRequestDecision(
      session.state,
      turnPlayer,
      rarePackRulePackage
    );
    const postRareDrawPattern = postResolutionDecision.request.patterns.find(
      (p) =>
        p.kind === "ACTION" &&
        postResolutionDecision.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareDraw"
    );
    expect(postRareDrawPattern).toBeUndefined();

    // E. Real 54-card conservation across all zones
    expect(() => {
      OfficialRegulationMatchSetup.verifyCardConservation(
        turnPlayer,
        session.state.players[turnPlayer],
        STANDARD_54_DECK_CARDS
      );
    }).not.toThrow();

    const playerState = session.state.players[turnPlayer];
    const allCards = [
      ...playerState.hand,
      ...playerState.life,
      ...playerState.pack.cards,
      ...(playerState.grave || []),
      ...playerState.field.flatMap((u: any) => (Array.isArray(u.cards) ? u.cards : u.card ? [u.card] : [])),
      ...(playerState.rareCards || []),
    ];
    expect(allCards.length).toBe(54);
    const cardIds = new Set(allCards.map((c: any) => c.id));
    expect(cardIds.size).toBe(54);

    // G. No reveal: No card.revealed event in match log
    const matchLog = session.getMatchLog();
    const revealEvents = matchLog.events.filter((e) => e.type === "card.revealed");
    expect(revealEvents.length).toBe(0);

    // H. Canonical Match Log: card.moved from rare to hand
    const moveEvents = matchLog.events.filter((e) => e.type === "card.moved") as any[];
    const rareMoveEvent = moveEvents.find(
      (e: any) =>
        e.cardId === initialRareCard.id ||
        (e.from?.kind === "zone" && e.from?.zone === "rare")
    );
    expect(rareMoveEvent).toBeDefined();
    if (rareMoveEvent) {
      expect(rareMoveEvent.cardId).toBe(initialRareCard.id);
      expect(rareMoveEvent.from).toEqual({
        kind: "zone",
        playerId: turnPlayer,
        zone: "rare",
      });
      expect(rareMoveEvent.to).toEqual({
        kind: "zone",
        playerId: turnPlayer,
        zone: "hand",
      });
    }

    // F. Hidden information: Opponent observation
    const oppObservation = ObservationFactory.createObservation(session.state, opponentPlayer);
    const tpViewFromOpp = oppObservation.players.find((p) => p.playerId === turnPlayer)!;
    expect(tpViewFromOpp.handCount).toBe(initialHandCount + 1);

    // All hand cards seen by opponent are HIDDEN
    for (const hc of tpViewFromOpp.handCards) {
      expect(hc.visibility).toBe("HIDDEN");
      expect((hc as any).id).toBeUndefined();
      expect((hc as any).suit).toBeUndefined();
      expect((hc as any).rank).toBeUndefined();
      expect((hc as any).value).toBeUndefined();
    }

    // Owner observation: sees all hand cards as KNOWN
    const ownerObservation = ObservationFactory.createObservation(session.state, turnPlayer);
    const tpViewFromOwner = ownerObservation.players.find((p) => p.playerId === turnPlayer)!;
    const movedInOwnerView = tpViewFromOwner.handCards.find(
      (c): c is KnownCardView => c.visibility === "KNOWN" && c.cardInstanceId === initialRareCard.id
    );
    expect(movedInOwnerView).toBeDefined();
    if (movedInOwnerView) {
      expect(movedInOwnerView.visibility).toBe("KNOWN");
      expect(movedInOwnerView.suit).toBe("J");
      expect(movedInOwnerView.rank).toBe("Joker");
    }
  });

  // J. Empty rare zone: Illegal for legal pattern generator, clean fizzle if resolved
  it("J: Empty rare zone: Rare Draw is illegal in LegalPatternGenerator; resolution when rare zone is empty cleanly fizzles without throwing [BP-SIM-BUG-RAREDRAW-EMPTY-ZONE-LOOP-R1]", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = new GameSession(outcome.state, rarePackRulePackage);
    const turnPlayer = session.state.turnPlayer;

    // Set life to 9 and empty rareCards
    const excessLife = session.state.players[turnPlayer].life.splice(9);
    session.state.players[turnPlayer].grave.push(...excessLife);
    session.state.players[turnPlayer].rareCards = [];

    const handBefore = session.state.players[turnPlayer].hand.length;

    // Advance session to prompt decision
    const step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;

    // 1. Rare Zone が空の時は Legal Pattern として提示されないこと
    const patternIndex = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.rareDraw"
    );
    expect(patternIndex).toBe(-1);

    // 2. Resolution 時に稀なレース等で空の Rare Zone から解決された場合もクラッシュせず状態を保つこと
    const handler = moveCardHandler();
    expect(() => {
      handler({ from: "rare", to: "hand" }, {
        state: session.state,
        playerKey: turnPlayer,
        selections: {},
      });
    }).not.toThrow();

    // Hand count remains unchanged, rareCards remains empty
    expect(session.state.players[turnPlayer].hand.length).toBe(handBefore);
    expect(session.state.players[turnPlayer].rareCards.length).toBe(0);
  });

  // K. moveCard omitted-card generic semantics regression
  describe("moveCard omitted-card generic semantics", () => {
    const handler = moveCardHandler();

    it("0 cards in source zone: clean no-op resolution", () => {
      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            rareCards: [],
            hand: [],
          },
        },
      };
      const context: any = { playerKey: "p1", state };
      expect(() => {
        handler({ from: "rare", to: "hand" }, context);
      }).not.toThrow();
      expect(state.players.p1.rareCards.length).toBe(0);
      expect(state.players.p1.hand.length).toBe(0);
    });

    it("1 card in source zone: auto-selects and moves single card", () => {
      const card = { id: "card-single", suit: "J", rank: "Joker" };
      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            rareCards: [card],
            hand: [],
          },
        },
      };
      const context: any = { playerKey: "p1", state };
      handler({ from: "rare", to: "hand" }, context);
      expect(state.players.p1.rareCards.length).toBe(0);
      expect(state.players.p1.hand.length).toBe(1);
      expect(state.players.p1.hand[0]).toBe(card);
    });

    it("2+ cards in source zone without card/target: fail-closed throws error", () => {
      const card1 = { id: "card-1", suit: "S", rank: "A" };
      const card2 = { id: "card-2", suit: "H", rank: "K" };
      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            rareCards: [card1, card2],
            hand: [],
          },
        },
      };
      const context: any = { playerKey: "p1", state };
      expect(() => {
        handler({ from: "rare", to: "hand" }, context);
      }).toThrow(/明示的なカード指定.*なしに移動できません/);
      expect(state.players.p1.rareCards.length).toBe(2);
      expect(state.players.p1.hand.length).toBe(0);
    });

    it("2+ cards in source zone with explicit card: moves specified card correctly", () => {
      const card1 = { id: "card-1", suit: "S", rank: "A" };
      const card2 = { id: "card-2", suit: "H", rank: "K" };
      const state: any = {
        stateVersion: 1,
        players: {
          p1: {
            rareCards: [card1, card2],
            hand: [],
          },
        },
      };
      const context: any = { playerKey: "p1", state };
      handler({ from: "rare", to: "hand", card: "card-2" }, context);
      expect(state.players.p1.rareCards.length).toBe(1);
      expect(state.players.p1.rareCards[0]).toBe(card1);
      expect(state.players.p1.hand.length).toBe(1);
      expect(state.players.p1.hand[0]).toBe(card2);
    });
  });
});
