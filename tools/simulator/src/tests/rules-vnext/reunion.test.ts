import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { CommandRegistry, CommandContext, cancelStageRequest, finalizeRequestKeyCards } from "../../engine/rules/CommandRegistry";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { loadRegulationCatalog, getRegulation, getFormat, getFrame } from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { GameSession } from "../../engine/session/GameSession";
import { GraveTopCoordinator } from "../../engine/rules/GraveTopCoordinator";
import { enumeratePhysicalCardsInGrave } from "../../engine/rules/graveCardUtils";

function getGraveCardIds(grave: any[]): string[] {
  return (grave || []).flatMap((item: any) =>
    item.cards ? item.cards.map((c: any) => c.id) : [item.id]
  );
}

function countTotalCards(state: any): number {
  let count = 0;
  for (const p of Object.values<any>(state.players || {})) {
    if (Array.isArray(p.hand)) count += p.hand.length;
    if (Array.isArray(p.life)) count += p.life.length;
    if (Array.isArray(p.grave)) {
      count += enumeratePhysicalCardsInGrave(p.grave).length;
    }
    if (Array.isArray(p.field)) {
      for (const u of p.field) {
        if (Array.isArray(u.cards)) count += u.cards.length;
      }
    }
    if (Array.isArray(p.pack?.cards)) count += p.pack.cards.length;
    if (Array.isArray(p.rareCards)) count += p.rareCards.length;
  }
  return count;
}

describe("BP-SIM-REG-5.0-D-PRO-REUNION: Pro Action Reunion Implementation & Specification Contract", () => {
  let fullRulePackage: RulePackage;
  let proRulePackage: RulePackage;
  let standardRulePackage: RulePackage;
  const getReunionAction = () => fullRulePackage.actions.find((a) => a.id === "action.reunion")!;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
    await loadRegulationCatalog();

    const standardFormat = await getFormat("standard");
    const proFormat = await getFormat("pro");
    const packFrame = await getFrame("pack");
    const standardPackReg = await getRegulation("standard-pack");
    const proRarePackReg = await getRegulation("pro-rarePack");

    standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg,
      packFrame
    );

    proRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      proFormat,
      proRarePackReg,
      packFrame
    );
  });

  // =========================================================================
  // 1. Definition Contract & Format Contract (Sections 3, 4, 37, 39)
  // =========================================================================
  describe("1. Definition Contract & Format Contract (Sections 3, 4, 37, 39)", () => {
    it("1.1: Reunion action definition matches official specification exactly", () => {
      const reunionAction = getReunionAction();
      expect(reunionAction).toBeDefined();
      expect(reunionAction.id).toBe("action.reunion");
      expect(reunionAction.name).toBe("再会");
      expect(reunionAction.ruby).toBe("さいかい");
      expect(reunionAction.type).toBe("magic");

      // Request
      expect(reunionAction.request).toBeDefined();
      expect(reunionAction.request?.trigger).toBe("direct");
      expect(reunionAction.request?.speed).toBe("normal");
      expect(reunionAction.request?.timing).toBe("quick");

      // Key condition: 2 cards, Heart A..10, Hand
      expect(reunionAction.key).toBeDefined();
      expect(reunionAction.key?.count).toBe(2);
      expect(reunionAction.key?.condition?.card?.suit).toBe("heart");
      expect(reunionAction.key?.condition?.card?.rank).toBe("A..10");
      expect(reunionAction.key?.condition?.card?.zone).toBe("hand");

      // Targets: MUST NOT HAVE targets (grave card chosen during resolution)
      expect(reunionAction.targets).toBeUndefined();

      // Cost: none (undefined)
      expect(reunionAction.cost).toBeUndefined();

      // ActivationCondition: none (undefined)
      expect(reunionAction.activationCondition).toBeUndefined();

      // Text & Effect steps
      expect(reunionAction.text?.effect).toBe("自分の墓地からカードを1枚選び対戦相手に見せ手札に加える。");
      expect(reunionAction.effect).toHaveLength(3);
      const effects = reunionAction.effect as any[];
      expect(effects[0].selectCards).toEqual({
        id: "reunionCard",
        player: "self",
        zone: "grave",
        count: 1,
      });
      expect(effects[1].revealCard).toEqual({
        card: "selection.reunionCard",
        target: "opponent",
        sourceZone: "grave",
      });
      expect(effects[2].moveCard).toEqual({
        card: "selection.reunionCard",
        from: "grave",
        to: "hand",
        player: "self",
      });
    });

    it("1.2: Format inclusion/exclusion contract", async () => {
      const lightFormat = await getFormat("light");
      const standardFormat = await getFormat("standard");
      const proFormat = await getFormat("pro");

      expect(lightFormat.actions).not.toContain("action.reunion");
      expect(standardFormat.actions).not.toContain("action.reunion");
      expect(proFormat.actions).toContain("action.reunion");
      expect(proFormat.actions).toHaveLength(31);

      expect(standardRulePackage.actions.find((a) => a.id === "action.reunion")).toBeUndefined();
      expect(proRulePackage.actions.find((a) => a.id === "action.reunion")).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Key Card Legality & ActionRequestValidator Contracts (Sections 6, 33)
  // =========================================================================
  describe("2. Key Card Legality & ActionRequestValidator Contracts (Sections 6, 33)", () => {
    const validator = new ActionRequestValidator();
    let reunionAction: any;
    beforeEach(() => {
      reunionAction = getReunionAction();
    });

    it("2.1: PASS with valid Heart combinations (A+2, 5+10, 10+A)", () => {
      const state: any = {
        players: {
          p1: {
            hand: [
              { id: "h-a", suit: "H", rank: "A", value: 1 },
              { id: "h-2", suit: "H", rank: "2", value: 2 },
              { id: "h-5", suit: "H", rank: "5", value: 5 },
              { id: "h-10", suit: "H", rank: "10", value: 10 },
            ],
            field: [],
            life: [],
            grave: [],
          },
        },
      };

      const ctxA: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [state.players.p1.hand[0], state.players.p1.hand[1]],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };
      expect(() => validator.validateActionRequest(reunionAction, ctxA)).not.toThrow();

      const ctxB: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [state.players.p1.hand[2], state.players.p1.hand[3]],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };
      expect(() => validator.validateActionRequest(reunionAction, ctxB)).not.toThrow();
    });

    it("2.2: FAIL with rank > 10 (Heart 10 + Heart J)", () => {
      const h10 = { id: "h-10", suit: "H", rank: "10", value: 10 };
      const hj = { id: "h-j", suit: "H", rank: "J", value: 11 };
      const state: any = { players: { p1: { hand: [h10, hj] } } };
      const ctx: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [h10, hj],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };
      expect(() => validator.validateActionRequest(reunionAction, ctx)).toThrow(ValidationError);
      expect(() => validator.validateActionRequest(reunionAction, ctx)).toThrow(
        /キーカードが要求される条件を満たしていません/
      );
    });

    it("2.3: FAIL with rank > 10 (Heart Q + Heart 2, Heart K + Heart A)", () => {
      const hq = { id: "h-q", suit: "H", rank: "Q", value: 12 };
      const h2 = { id: "h-2", suit: "H", rank: "2", value: 2 };
      const hk = { id: "h-k", suit: "H", rank: "K", value: 13 };
      const ha = { id: "h-a", suit: "H", rank: "A", value: 1 };
      const state: any = { players: { p1: { hand: [hq, h2, hk, ha] } } };

      const ctx1: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [hq, h2],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };
      expect(() => validator.validateActionRequest(reunionAction, ctx1)).toThrow(ValidationError);

      const ctx2: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [hk, ha],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };
      expect(() => validator.validateActionRequest(reunionAction, ctx2)).toThrow(ValidationError);
    });

    it("2.4: FAIL with wrong suit (Spade 5 + Heart 5)", () => {
      const s5 = { id: "s-5", suit: "S", rank: "5", value: 5 };
      const h5 = { id: "h-5", suit: "H", rank: "5", value: 5 };
      const state: any = { players: { p1: { hand: [s5, h5] } } };
      const ctx: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s5, h5],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };
      expect(() => validator.validateActionRequest(reunionAction, ctx)).toThrow(ValidationError);
    });

    it("2.5: FAIL with incorrect card count (1 card or 3 cards)", () => {
      const h1 = { id: "h-1", suit: "H", rank: "A", value: 1 };
      const h2 = { id: "h-2", suit: "H", rank: "2", value: 2 };
      const h3 = { id: "h-3", suit: "H", rank: "3", value: 3 };
      const state: any = { players: { p1: { hand: [h1, h2, h3] } } };

      const ctx1: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [h1],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };
      expect(() => validator.validateActionRequest(reunionAction, ctx1)).toThrow(ValidationError);

      const ctx3: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [h1, h2, h3],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };
      expect(() => validator.validateActionRequest(reunionAction, ctx3)).toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 3. LegalPatternGenerator & Quick/Chance Timing (Sections 5, 36)
  // =========================================================================
  describe("3. LegalPatternGenerator & Timing Contracts (Sections 5, 36)", () => {
    it("3.1: Generates Reunion pattern when player has Chance and 2 valid Hearts", () => {
      const h3 = { id: "p1-h3", suit: "H", rank: "3", value: 3 };
      const h7 = { id: "p1-h7", suit: "H", rank: "7", value: 7 };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        turnUsage: { p1: {} },
        players: {
          p1: {
            hand: [h3, h7],
            field: [],
            life: [],
            grave: [{ id: "g1", suit: "C", rank: "4", value: 4 }],
          },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(
        state,
        "p1",
        proRulePackage
      );

      const reunionPatterns = decision.patterns.filter((p) => {
        const actionDef = decision.catalog.actions[p.actionSelectionRef!];
        return actionDef?.actionId === "action.reunion";
      });

      expect(reunionPatterns.length).toBeGreaterThanOrEqual(1);
      const firstPattern = reunionPatterns[0];
      const keyCardSel = decision.catalog.cardSelections[firstPattern.keyCardSelectionRef!];
      expect(keyCardSel.cardIds).toEqual(expect.arrayContaining(["p1-h3", "p1-h7"]));
      expect(firstPattern.targetSelectionRef).toBeDefined();
      const targetSel = decision.catalog.targetSelections[firstPattern.targetSelectionRef!];
      expect(targetSel.targetType).toBe("none");
    });

    it("3.2: Generates Reunion pattern on opponent turn when controller has Chance (Quick timing)", () => {
      const h3 = { id: "p2-h3", suit: "H", rank: "3", value: 3 };
      const h8 = { id: "p2-h8", suit: "H", rank: "8", value: 8 };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p2", // p2 has Chance during p1 turn
        stage: { requests: [{ id: "req-1", status: "pending" }], history: [] },
        turnUsage: { p2: {} },
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: {
            hand: [h3, h8],
            field: [],
            life: [],
            grave: [{ id: "g1", suit: "S", rank: "5", value: 5 }],
          },
        },
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(
        state,
        "p2",
        proRulePackage
      );

      const reunionPatterns = decision.patterns.filter((p) => {
        const actionDef = decision.catalog.actions[p.actionSelectionRef!];
        return actionDef?.actionId === "action.reunion";
      });

      expect(reunionPatterns.length).toBeGreaterThanOrEqual(1);
    });

    it("3.3: No Reunion pattern when controller does NOT have Chance", () => {
      const h3 = { id: "p1-h3", suit: "H", rank: "3", value: 3 };
      const h7 = { id: "p1-h7", suit: "H", rank: "7", value: 7 };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p2", // p1 does not have Chance
        stage: { requests: [], history: [] },
        turnUsage: { p1: {} },
        players: {
          p1: { hand: [h3, h7], field: [], life: [], grave: [] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(
        state,
        "p1",
        proRulePackage
      );

      const reunionPatterns = decision.patterns.filter((p) => {
        const actionDef = decision.catalog.actions[p.actionSelectionRef!];
        return actionDef?.actionId === "action.reunion";
      });

      expect(reunionPatterns).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. Request Creation & Stage Lifecycle (Sections 5, 21)
  // =========================================================================
  describe("4. Request Creation & Stage Lifecycle (Sections 5, 21)", () => {
    it("4.1: Request creation moves Key Cards from Hand to Request, status is pending, no selection bound yet", () => {
      const reunionAction = getReunionAction();
      const registry = new CommandRegistry();

      const h3 = { id: "p1-h3", suit: "H", rank: "3", value: 3 };
      const h7 = { id: "p1-h7", suit: "H", rank: "7", value: 7 };
      const gCard = { id: "c-grave-1", suit: "C", rank: "4", value: 4 };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: { hand: [h3, h7], field: [], life: [], grave: [gCard] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [h3, h7],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const req = registry.createRequest(reunionAction, context);
      expect(req.status).toBe("pending");
      expect(state.stage.requests).toHaveLength(1);
      expect(state.stage.requests[0]).toBe(req);

      // Key cards removed from Hand and attached to Request
      expect(state.players.p1.hand).toHaveLength(0);
      expect(req.keyCards).toHaveLength(2);
      expect(req.keyCards[0]).toBe(h3);
      expect(req.keyCards[1]).toBe(h7);

      // Grave card still in Grave, NOT bound at creation time
      expect(state.players.p1.grave).toHaveLength(1);
      expect((req as any).selections).toBeUndefined();
    });
  });

  // =========================================================================
  // 5. Resolution & Own Grave Card Selection (Sections 7, 8, 9, 17, 18, 21, 23, 24)
  // =========================================================================
  describe("5. Resolution & Raw Grave Card (Sections 7, 8, 9, 17, 18, 21, 23, 24)", () => {
    it("5.1: Selects 1 card from own Grave only, reveals to opponent, moves to Hand, and finalizes Key Cards", () => {
      const reunionAction = getReunionAction();
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      const recordedLogs: any[] = [];
      const logRecorder = { record: (entry: any) => recordedLogs.push(entry) };

      const h3 = { id: "p1-h3", suit: "H", rank: "3", value: 3 };
      const h7 = { id: "p1-h7", suit: "H", rank: "7", value: 7 };

      const p1GraveCard = { id: "p1-c7", suit: "C", rank: "7", value: 7 };
      const p2GraveCard = { id: "p2-s9", suit: "S", rank: "9", value: 9 };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: { hand: [h3, h7], field: [], life: [], grave: [p1GraveCard], graveTopCardId: "p1-c7" },
          p2: { hand: [], field: [], life: [], grave: [p2GraveCard], graveTopCardId: "p2-s9" },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [h3, h7],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
        logRecorder: logRecorder as any,
      };

      const req = registry.createRequest(reunionAction, context);

      // Phase 1: Begin resolution -> interrupts at selectCards
      const step1: any = interp.executeEffectsWithInterruption(reunionAction.effect!, context);
      expect(step1.interrupted).toBe(true);
      if (!step1.interrupted) return;

      expect(step1.effectStepId).toBe("selectCards");
      expect(step1.selectionId).toBe("reunionCard");
      expect(step1.selectionType).toBe("card");
      expect(step1.decisionPlayerKey).toBe("p1");

      // Candidate cards MUST contain p1's Grave card, and MUST NOT contain p2's Grave card
      const candidateIds = step1.candidates.map((c: any) => c.id);
      expect(candidateIds).toContain("p1-c7");
      expect(candidateIds).not.toContain("p2-s9");

      // Phase 2: Provide selection and resume resolution
      if (!context.selections) context.selections = {};
      context.selections["reunionCard"] = ["p1-c7"];

      const step2: any = interp.executeEffectsWithInterruption(
        reunionAction.effect!,
        context,
        step1.resumeNextIndex || step1.effectIndex + 1
      );
      expect(step2.completed).toBe(true);

      // Finalize request key cards and stage
      finalizeRequestKeyCards(req, context, interp);
      state.stage.requests = state.stage.requests.filter((r: any) => r.id !== req.id);
      state.stage.history.push(req);
      req.status = "resolved";

      // Outcomes:
      // p1 Hand now has p1-c7
      expect(state.players.p1.hand.map((c: any) => c.id)).toContain("p1-c7");
      // p1 Grave no longer has p1-c7
      expect(getGraveCardIds(state.players.p1.grave)).not.toContain("p1-c7");
      // p2 Hand does not have p1-c7
      expect(state.players.p2.hand.map((c: any) => c.id)).not.toContain("p1-c7");
      // p2 Grave untouched
      expect(getGraveCardIds(state.players.p2.grave)).toContain("p2-s9");

      // Key cards finalized in p1 Grave
      const p1GraveIds = getGraveCardIds(state.players.p1.grave);
      expect(p1GraveIds).toContain("p1-h3");
      expect(p1GraveIds).toContain("p1-h7");

      // Events verification: cardRevealed must be emitted
      const revealEvt = emittedEvents.find((e) => e.type === "cardRevealed");
      expect(revealEvt).toBeDefined();
      expect(revealEvt.payload.card.id).toBe("p1-c7");
      expect(revealEvt.payload.target).toBe("opponent");
      expect(revealEvt.payload.sourceZone).toBe("grave");

      // cardMoved must be emitted for grave -> hand
      const moveEvt = emittedEvents.find(
        (e) => e.type === "cardMoved" && e.payload?.fromZone === "grave" && e.payload?.toZone === "hand"
      );
      expect(moveEvt).toBeDefined();
      expect(moveEvt.payload.card.id).toBe("p1-c7");

      // Log ordering: card.revealed before card.moved
      const revealLogIdx = recordedLogs.findIndex((l) => l.type === "card.revealed");
      const moveLogIdx = recordedLogs.findIndex(
        (l) => l.type === "card.moved" && l.from?.zone === "grave" && l.to?.zone === "hand"
      );
      expect(revealLogIdx).toBeGreaterThanOrEqual(0);
      expect(moveLogIdx).toBeGreaterThanOrEqual(0);
      expect(revealLogIdx).toBeLessThan(moveLogIdx);
    });

    it("5.2 & 22.1: GameSession end-to-end resolution - request Reunion -> pass chance -> WAITING_FOR_DECISION (card) -> select Grave card -> resolve -> Hand and Grave updated", () => {
      const h3 = { id: "p1-h3", suit: "H", rank: "3", value: 3 };
      const h7 = { id: "p1-h7", suit: "H", rank: "7", value: 7 };
      const gCard = { id: "p1-g-sol", suit: "C", rank: "8", value: 8 };

      const state: any = {
        stateVersion: 1,
        matchId: "match-reunion-gs",
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        turnUsage: { p1: {} },
        players: {
          p1: {
            hand: [h3, h7],
            field: [],
            life: [{ id: "p1-l1", suit: "D", rank: "2", value: 2 }],
            grave: [gCard],
            graveTopCardId: "p1-g-sol",
          },
          p2: {
            hand: [],
            field: [],
            life: [{ id: "p2-l1", suit: "S", rank: "3", value: 3 }],
            grave: [],
          },
        },
      };

      const session = new GameSession(state, proRulePackage);

      // 1. Advance to player decision
      const d1: any = session.advance();
      expect(d1.type).toBe("WAITING_FOR_DECISION");

      // Find Reunion pattern
      const reunionPatternIdx = d1.request.patterns.findIndex((p: any) => {
        const actionDef = d1.request.catalog.actions[p.actionSelectionRef!];
        return actionDef?.actionId === "action.reunion";
      });
      expect(reunionPatternIdx).toBeGreaterThanOrEqual(0);

      // 2. Submit Reunion action request
      const d2: any = session.submitDecision({
        decisionId: d1.request.decisionId,
        stateVersion: d1.request.stateVersion,
        selectedPatternRef: reunionPatternIdx,
      });

      // Player p1 queued Reunion to stage, still holds chance and passes
      expect(d2.type).toBe("WAITING_FOR_DECISION");
      expect(d2.request.playerId).toBe("p1");

      const passP1 = d2.request.patterns.findIndex((p: any) => p.kind === "PASS");
      expect(passP1).toBeGreaterThanOrEqual(0);

      // 3. P1 passes chance to opponent p2
      const d3: any = session.submitDecision({
        decisionId: d2.request.decisionId,
        stateVersion: d2.request.stateVersion,
        selectedPatternRef: passP1,
      });

      expect(d3.type).toBe("WAITING_FOR_DECISION");
      expect(d3.request.playerId).toBe("p2");

      const passP2 = d3.request.patterns.findIndex((p: any) => p.kind === "PASS");
      expect(passP2).toBeGreaterThanOrEqual(0);

      // 4. Opponent passes chance -> Stage begins resolving Reunion -> EFFECT_RESOLUTION interrupts
      const d4: any = session.submitDecision({
        decisionId: d3.request.decisionId,
        stateVersion: d3.request.stateVersion,
        selectedPatternRef: passP2,
      });

      expect(d4.type).toBe("WAITING_FOR_DECISION");
      expect(d4.request.source.type).toBe("EFFECT_RESOLUTION");
      expect(d4.request.playerId).toBe("p1");

      // Select the grave card (pattern 0)
      const d5: any = session.submitDecision({
        decisionId: d4.request.decisionId,
        stateVersion: d4.request.stateVersion,
        selectedPatternRef: 0,
      });

      // 5. Reunion finishes resolving -> p1 Hand has gCard
      expect(session.state.players.p1.hand.map((c: any) => c.id)).toContain("p1-g-sol");
      expect(getGraveCardIds(session.state.players.p1.grave)).not.toContain("p1-g-sol");
      // Key cards finalized in Grave
      expect(getGraveCardIds(session.state.players.p1.grave)).toContain("p1-h3");
      expect(getGraveCardIds(session.state.players.p1.grave)).toContain("p1-h7");
    });
  });

  // =========================================================================
  // 6. Single-Card & Multi-Card Wrapper Extraction (Sections 10, 11, 13, 25, 26)
  // =========================================================================
  describe("6. Grave Unit Wrapper Extraction Contracts (Sections 10, 11, 13, 25, 26)", () => {
    it("25.1: Single-card wrapper in Grave - selected card moves to Hand, empty wrapper is removed without ghost wrapper", () => {
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const targetCard = { id: "c-sol-1", suit: "S", rank: "4", value: 4 };
      const singleWrapper = {
        unitId: "u-soldier-1",
        componentId: "character.soldier",
        cards: [targetCard],
        kind: "一般兵",
      };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: { hand: [], field: [], life: [], grave: [singleWrapper], graveTopCardId: "c-sol-1" },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        selections: { reunionCard: ["c-sol-1"] },
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const reunionAction = getReunionAction();
      interp.executeEffectsWithInterruption(reunionAction.effect!, context);

      // Target card moved to Hand
      expect(state.players.p1.hand.map((c: any) => c.id)).toContain("c-sol-1");

      // Empty wrapper is completely removed from Grave (length 0, no ghost wrapper)
      expect(state.players.p1.grave).toHaveLength(0);
      expect(state.players.p1.graveTopCardId).toBeUndefined();
    });

    it("26.1: Multi-card wrapper in Grave - selected card moves to Hand, wrapper remains with remaining cards and intact metadata", () => {
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const cA = { id: "c-arm-a", suit: "H", rank: "3", value: 3 };
      const cB = { id: "c-arm-b", suit: "H", rank: "6", value: 6 };
      const cC = { id: "c-arm-c", suit: "D", rank: "8", value: 8 };

      const multiWrapper = {
        unitId: "u-armed-1",
        componentId: "character.armedSoldier",
        kind: "重装兵",
        state: "charge",
        cards: [cA, cB, cC],
      };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: { hand: [], field: [], life: [], grave: [multiWrapper], graveTopCardId: "c-arm-a" },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        selections: { reunionCard: ["c-arm-b"] },
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const reunionAction = getReunionAction();
      interp.executeEffectsWithInterruption(reunionAction.effect!, context);

      // Selected cB is in Hand
      expect(state.players.p1.hand.map((c: any) => c.id)).toContain("c-arm-b");

      // Wrapper remains in Grave with exactly [cA, cC]
      expect(state.players.p1.grave).toHaveLength(1);
      const remainingWrapper = state.players.p1.grave[0];
      expect(remainingWrapper.unitId).toBe("u-armed-1");
      expect(remainingWrapper.kind).toBe("重装兵");
      expect(remainingWrapper.cards.map((c: any) => c.id)).toEqual(["c-arm-a", "c-arm-c"]);
    });
  });

  // =========================================================================
  // 7. Grave TOP Invariants (Sections 14, 27, 28, 29)
  // =========================================================================
  describe("7. Grave TOP Invariants (Sections 14, 27, 28, 29)", () => {
    it("27.1: Non-TOP removal - graveTopCardId remains unchanged and no decision requested", () => {
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const cA = { id: "c-a", suit: "C", rank: "2", value: 2 };
      const cB = { id: "c-b", suit: "C", rank: "3", value: 3 };
      const cC = { id: "c-c", suit: "C", rank: "4", value: 4 };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: { hand: [], field: [], life: [], grave: [cA, cB, cC], graveTopCardId: "c-c" },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        selections: { reunionCard: ["c-a"] },
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const reunionAction = getReunionAction();
      interp.executeEffectsWithInterruption(reunionAction.effect!, context);

      expect(state.players.p1.hand.map((c: any) => c.id)).toContain("c-a");
      // TOP is still cC
      expect(state.players.p1.graveTopCardId).toBe("c-c");
      expect(state.pendingGraveTopSelections).toBeUndefined();
    });

    it("28.1: TOP removal with 1 remaining card - remaining card automatically becomes TOP without decision", () => {
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const cA = { id: "c-a", suit: "C", rank: "2", value: 2 };
      const cB = { id: "c-b", suit: "C", rank: "3", value: 3 };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: { hand: [], field: [], life: [], grave: [cA, cB], graveTopCardId: "c-b" },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        selections: { reunionCard: ["c-b"] },
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const reunionAction = getReunionAction();
      interp.executeEffectsWithInterruption(reunionAction.effect!, context);

      expect(state.players.p1.hand.map((c: any) => c.id)).toContain("c-b");
      // cA automatically promoted to TOP
      expect(state.players.p1.graveTopCardId).toBe("c-a");
      expect(state.pendingGraveTopSelections).toBeUndefined();
    });

    it("29.1: TOP removal with 2+ remaining cards - triggers Grave TOP selection decision", () => {
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const cA = { id: "c-a", suit: "C", rank: "2", value: 2 };
      const cB = { id: "c-b", suit: "C", rank: "3", value: 3 };
      const cC = { id: "c-c", suit: "C", rank: "4", value: 4 };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: { hand: [], field: [], life: [], grave: [cA, cB, cC], graveTopCardId: "c-c" },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        selections: { reunionCard: ["c-c"] },
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const reunionAction = getReunionAction();
      const res: any = interp.executeEffectsWithInterruption(reunionAction.effect!, context);

      // Card moved to Hand
      expect(state.players.p1.hand.map((c: any) => c.id)).toContain("c-c");

      // Grave TOP cleared and pending selection registered
      expect(state.players.p1.graveTopCardId).toBeUndefined();
      expect(state.pendingGraveTopSelections).toHaveLength(1);
      const pending = state.pendingGraveTopSelections[0];
      expect(pending.playerId).toBe("p1");
      expect(pending.candidateCardIds).toEqual(["c-a", "c-b"]);
      expect(pending.reason).toBe("TOP_REMOVED");

      // Effect execution interrupted for Grave TOP
      expect(res.interrupted).toBe(true);
      if (res.interrupted) {
        expect(res.selectionType).toBe("zoneTop");
      }
    });
  });

  // =========================================================================
  // 8. Empty Grave & Cancellation Contracts (Sections 20, 34, 35)
  // =========================================================================
  describe("8. Empty Grave & Cancellation Contracts (Sections 20, 34, 35)", () => {
    it("35.1: Empty Grave resolution - legal request, selectCards returns 0 candidates, no reveal, no move, Key Cards finalize to Grave", () => {
      const reunionAction = getReunionAction();
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      const h3 = { id: "p1-h3", suit: "H", rank: "3", value: 3 };
      const h7 = { id: "p1-h7", suit: "H", rank: "7", value: 7 };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: { hand: [h3, h7], field: [], life: [], grave: [] }, // empty grave
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [h3, h7],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const req = registry.createRequest(reunionAction, context);
      expect(req.status).toBe("pending");

      // Execution with empty grave does NOT interrupt (candidates = 0 -> empty selection)
      const res: any = interp.executeEffectsWithInterruption(reunionAction.effect!, context);
      expect(res.completed).toBe(true);

      registry.resolveRequest(req, context);

      // No cardRevealed event emitted
      expect(emittedEvents.some((e) => e.type === "cardRevealed")).toBe(false);

      // No grave -> hand movement
      expect(emittedEvents.some((e) => e.type === "cardMoved" && e.payload?.toZone === "hand")).toBe(false);

      // Key cards finalized in p1 Grave
      const p1GraveIds = getGraveCardIds(state.players.p1.grave);
      expect(p1GraveIds).toEqual(expect.arrayContaining(["p1-h3", "p1-h7"]));
      expect(req.status).toBe("resolved");
    });

    it("34.1: Cancelled Reunion - leaves Grave untouched, Key Cards finalize to Grave, no reveal/movement", () => {
      const reunionAction = getReunionAction();
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      const h3 = { id: "p1-h3", suit: "H", rank: "3", value: 3 };
      const h7 = { id: "p1-h7", suit: "H", rank: "7", value: 7 };
      const gCard = { id: "c-g-1", suit: "S", rank: "A", value: 1 };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: { hand: [h3, h7], field: [], life: [], grave: [gCard], graveTopCardId: "c-g-1" },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [h3, h7],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const req = registry.createRequest(reunionAction, context);
      expect(state.stage.requests).toHaveLength(1);

      // Cancel before resolution
      const cancelled = cancelStageRequest(req.id, context, interp);
      expect(cancelled.status).toBe("cancelled");
      expect(state.stage.requests).toHaveLength(0);

      // gCard untouched in Grave
      expect(getGraveCardIds(state.players.p1.grave)).toContain("c-g-1");
      expect(state.players.p1.hand).toHaveLength(0);

      // Reunion Key Cards moved to Grave
      const p1GraveIds = getGraveCardIds(state.players.p1.grave);
      expect(p1GraveIds).toContain("p1-h3");
      expect(p1GraveIds).toContain("p1-h7");

      expect(emittedEvents.some((e) => e.type === "cardRevealed")).toBe(false);
    });
  });

  // =========================================================================
  // 9. Fail-Closed Invariants: Duplicate ID & Stale Selection (Sections 30, 31)
  // =========================================================================
  describe("9. Fail-Closed Invariants (Sections 30, 31)", () => {
    it("30.1: Duplicate physical card ID in Grave fails closed", () => {
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      // Duplicate card IDs in Grave
      const dup1 = { id: "dup-card", suit: "S", rank: "5", value: 5 };
      const dup2 = { id: "dup-card", suit: "H", rank: "8", value: 8 };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: { hand: [], field: [], life: [], grave: [dup1, dup2] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const reunionAction = getReunionAction();

      // selectCards enumeration fails closed when duplicate card.id is found in grave
      expect(() => {
        interp.executeEffectsWithInterruption(reunionAction.effect!, context);
      }).toThrow(/重複したcard.id/);
    });

    it("31.1: Stale selection (card no longer in Grave upon resume) fails closed without reveal or hand mutation", () => {
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const state: any = {
        stateVersion: 1,
        players: {
          p1: { hand: [], field: [], life: [], grave: [{ id: "other-card", suit: "D", rank: "2", value: 2 }] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      // Stale selection refers to non-existent card "vanished-card"
      const context: CommandContext = {
        state,
        playerKey: "p1",
        selections: { reunionCard: ["vanished-card"] },
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const reunionAction = getReunionAction();

      // revealCard step will throw fail-closed because card is not in grave
      expect(() => {
        interp.executeEffectsWithInterruption(reunionAction.effect!, context);
      }).toThrow(/移動元ゾーン 'grave' に対象カードが見つかりません/);

      // Hand remains empty
      expect(state.players.p1.hand).toHaveLength(0);
    });
  });

  // =========================================================================
  // 10. Canonical Physical Identity & Card Conservation (Sections 32, 22)
  // =========================================================================
  describe("10. Canonical Physical Identity & Card Conservation (Sections 32, 22)", () => {
    it("32.1: State Grave card is authoritative even if selection object specifies wrong properties", () => {
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      const recordedLogs: any[] = [];
      const logRecorder = { record: (entry: any) => recordedLogs.push(entry) };

      // State Grave card: id=g1, ♣7
      const canonicalCard = { id: "g1", suit: "C", rank: "7", value: 7 };

      const state: any = {
        stateVersion: 1,
        players: {
          p1: { hand: [], field: [], life: [], grave: [canonicalCard], graveTopCardId: "g1" },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      // Caller attempts to pass spoofed card with same ID but wrong properties (Heart 9)
      const forgedCard = { id: "g1", suit: "H", rank: "9", value: 9 };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        selections: { reunionCard: [forgedCard] },
        actions: proRulePackage.actions,
        components: proRulePackage.components,
        logRecorder: logRecorder as any,
      };

      const reunionAction = getReunionAction();
      interp.executeEffectsWithInterruption(reunionAction.effect!, context);

      // Hand receives the canonical Card object (♣7, value 7)
      expect(state.players.p1.hand).toHaveLength(1);
      const handCard = state.players.p1.hand[0];
      expect(handCard.id).toBe("g1");
      expect(handCard.suit).toBe("C");
      expect(handCard.rank).toBe("7");
      expect(handCard.value).toBe(7);

      // cardRevealed event emitted with canonical ♣7
      const revealEvt = emittedEvents.find((e) => e.type === "cardRevealed");
      expect(revealEvt.payload.card.suit).toBe("C");
      expect(revealEvt.payload.card.rank).toBe("7");

      // Canonical match log card.revealed recorded with canonical ♣7
      const revealLog = recordedLogs.find((l) => l.type === "card.revealed");
      expect(revealLog.suit).toBe("C");
      expect(revealLog.rank).toBe("7");
    });

    it("32.2: Total card conservation across Reunion lifecycle", () => {
      const reunionAction = getReunionAction();
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const h3 = { id: "p1-h3", suit: "H", rank: "3", value: 3 };
      const h7 = { id: "p1-h7", suit: "H", rank: "7", value: 7 };
      const g1 = { id: "p1-g1", suit: "D", rank: "5", value: 5 };
      const g2 = { id: "p1-g2", suit: "S", rank: "K", value: 13 };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [h3, h7],
            field: [],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            grave: [g1, g2],
            graveTopCardId: "p1-g2",
          },
          p2: {
            hand: [{ id: "p2-h1", suit: "S", rank: "3", value: 3 }],
            field: [],
            life: [{ id: "p2-l1", suit: "D", rank: "4", value: 4 }],
            grave: [],
          },
        },
      };

      const initialTotal = countTotalCards(state);
      expect(initialTotal).toBe(7);

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [h3, h7],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const req = registry.createRequest(reunionAction, context);
      context.selections = { reunionCard: ["p1-g1"] };

      registry.resolveRequest(req, context);

      const finalTotal = countTotalCards(state);
      expect(finalTotal).toBe(initialTotal);
    });
  });
});
