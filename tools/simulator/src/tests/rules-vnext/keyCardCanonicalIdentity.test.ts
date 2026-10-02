import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import {
  resolveCanonicalKeyCardsInSource,
  validateKeyCardsInSource,
  removeKeyCardsFromSource,
  resolveKeyCardSourceZone,
} from "../../engine/rules/keyCardUtils";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { loadRegulationCatalog, getRegulation, getFormat, getFrame } from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { CostPayment } from "../../domain/decision/DecisionCatalog";

function makeCostPayment(overrides: Partial<CostPayment> = {}): CostPayment {
  return {
    discardedCardIds: [],
    drivenBulwarkUnitIds: [],
    sacrificedUnitIds: [],
    lifeCount: 0,
    ...overrides,
  };
}

describe("BP-SIM-REG-4.0-H: Key Card Canonical Physical Identity Hardening", () => {
  let fullRulePackage: RulePackage;
  let rarePackRulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
    await loadRegulationCatalog();
    const standardFormat = await getFormat("standard");
    const rarePackFrame = await getFrame("rarePack");
    const standardRarePackReg = await getRegulation("standard-rarePack");
    rarePackRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardRarePackReg,
      rarePackFrame
    );
  });

  // =========================================================================
  // 1. Generic Canonical Resolver Tests (Sections 7, 8, 9, 21)
  // =========================================================================
  describe("Generic Canonical Resolver (resolveCanonicalKeyCardsInSource)", () => {
    it("returns canonical Card objects holding reference equality to State objects for hand source", () => {
      const canonicalCard = { id: "c-1", suit: "S", rank: "7", value: 7 };
      const player = { hand: [canonicalCard], rareCards: [] };
      const submitted = [{ id: "c-1", suit: "H", rank: "9", value: 9, extraSpoofedField: true }];

      const resolved = resolveCanonicalKeyCardsInSource(player, "hand", submitted);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBe(canonicalCard); // exact reference equality
      expect(resolved[0].suit).toBe("S");
      expect(resolved[0].rank).toBe("7");
      expect((resolved[0] as any).extraSpoofedField).toBeUndefined();
    });

    it("returns canonical Card objects holding reference equality to State objects for rare source", () => {
      const canonicalRareCard = { id: "rare-1", suit: "J", rank: "Joker", value: 0 };
      const player = { hand: [], rareCards: [canonicalRareCard] };
      const submitted = [{ id: "rare-1", suit: "D", rank: "2", value: 2 }];

      const resolved = resolveCanonicalKeyCardsInSource(player, "rare", submitted);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBe(canonicalRareCard);
      expect(resolved[0].suit).toBe("J");
      expect(resolved[0].rank).toBe("Joker");
    });

    it("fails closed when submitted card has missing or invalid physical ID", () => {
      const player = { hand: [{ id: "c-1", suit: "S", rank: "7", value: 7 }] };
      expect(() => resolveCanonicalKeyCardsInSource(player, "hand", [null as any])).toThrow(ValidationError);
      expect(() => resolveCanonicalKeyCardsInSource(player, "hand", [{} as any])).toThrow(ValidationError);
      expect(() => resolveCanonicalKeyCardsInSource(player, "hand", [{ id: "" } as any])).toThrow(ValidationError);
      expect(() => resolveCanonicalKeyCardsInSource(player, "hand", [{ id: "   " } as any])).toThrow(ValidationError);
    });

    it("fails closed when submitted card IDs contain duplicates in single request", () => {
      const card = { id: "c-1", suit: "S", rank: "7", value: 7 };
      const player = { hand: [card] };
      expect(() =>
        resolveCanonicalKeyCardsInSource(player, "hand", [
          { id: "c-1", suit: "S", rank: "7" },
          { id: "c-1", suit: "S", rank: "7" },
        ])
      ).toThrow(/重複が存在します/);
    });

    it("fails closed when physical ID is absent from source zone (0 matches)", () => {
      const player = { hand: [{ id: "c-1", suit: "S", rank: "7", value: 7 }] };
      expect(() =>
        resolveCanonicalKeyCardsInSource(player, "hand", [{ id: "c-missing" }])
      ).toThrow(/指定元ゾーン 'hand' に存在しません/);
    });

    it("fails closed when source zone contains ambiguous duplicate physical IDs (> 1 match)", () => {
      const card1 = { id: "c-dup", suit: "S", rank: "7", value: 7 };
      const card2 = { id: "c-dup", suit: "H", rank: "8", value: 8 };
      const player = { hand: [card1, card2] };
      expect(() =>
        resolveCanonicalKeyCardsInSource(player, "hand", [{ id: "c-dup" }])
      ).toThrow(/複数存在します/);
    });
  });

  // =========================================================================
  // 2. ActionRequestValidator Canonical Evaluation (Sections 10, 11, 12, 24)
  // =========================================================================
  describe("ActionRequestValidator Canonical Evaluation", () => {
    const validator = new ActionRequestValidator();

    it("Section 11: Critical Spoof Regression - caller cannot forge S7 into Ace via submitted attributes", () => {
      const summonAceAction = fullRulePackage.actions.find((a) => a.id === "action.summonAce")!;
      expect(summonAceAction).toBeDefined();

      // State hand contains S7
      const canonicalS7 = { id: "physical-A", suit: "S", rank: "7", value: 7 };
      const state = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [canonicalS7],
            life: [{ id: "l-1", suit: "C", rank: "2", value: 2 }],
            field: [],
            grave: [],
          },
        },
      } as any;

      // Caller submits the same ID but with forged suit S, rank A, value 1
      const forgedAceCallerPayload = { id: "physical-A", suit: "S", rank: "A", value: 1 };
      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: forgedAceCallerPayload,
        actions: fullRulePackage.actions,
        components: fullRulePackage.components,
      };

      // Validator MUST FAIL because canonical State Card is S7
      expect(() => validator.validateActionRequest(summonAceAction, context)).toThrow(ValidationError);
      expect(() => validator.validateActionRequest(summonAceAction, context)).toThrow(
        /キーカードが要求される条件を満たしていません/
      );

      // Section 24: context.keyCard is NOT mutated by validation
      expect(context.keyCard).toBe(forgedAceCallerPayload);
      expect(context.keyCard.rank).toBe("A");
    });

    it("Section 12: Reverse Spoof Regression - canonical State Ace is honored even if caller payload is H7", () => {
      const summonAceAction = fullRulePackage.actions.find((a) => a.id === "action.summonAce")!;
      expect(summonAceAction).toBeDefined();

      // State hand contains SA
      const canonicalSA = { id: "physical-A", suit: "S", rank: "A", value: 1 };
      const state = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [canonicalSA],
            life: [{ id: "l-1", suit: "C", rank: "2", value: 2 }],
            field: [],
            grave: [],
          },
        },
      } as any;

      // Caller submits H7 representation with the same physical ID
      const nonAceCallerPayload = { id: "physical-A", suit: "H", rank: "7", value: 7 };
      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: nonAceCallerPayload,
        actions: fullRulePackage.actions,
        components: fullRulePackage.components,
      };

      // Validator MUST PASS because canonical State Card is Ace
      expect(() => validator.validateActionRequest(summonAceAction, context)).not.toThrow();

      // Section 24: caller context is NOT mutated
      expect(context.keyCard).toBe(nonAceCallerPayload);
      expect(context.keyCard.rank).toBe("7");
    });
  });

  // =========================================================================
  // 3. CommandRegistry: No-Mutation Failure Contract & Canonical Storage (Sections 13, 14, 15, 16)
  // =========================================================================
  describe("CommandRegistry: Resolution Before Mutation & Canonical Storage", () => {
    it("Section 15: missing physical ID fails closed before any cost payment, seq increment, or state mutation", () => {
      const summonAceAction = fullRulePackage.actions.find((a) => a.id === "action.summonAce")!;
      const registry = new CommandRegistry();
      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      const recordedLogs: any[] = [];
      const logRecorder = {
        record: (entry: any) => recordedLogs.push(entry),
      };

      const lifeCard = { id: "l-cost-1", suit: "C", rank: "2", value: 2 };
      const state = {
        stateVersion: 10,
        nextRequestSeq: 5,
        turnUsage: { p1: { "action.summonAce": 0 } },
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [{ id: "c-real", suit: "S", rank: "A", value: 1 }],
            life: [lifeCard],
            field: [],
            grave: [],
            rareCards: [],
          },
        },
      } as any;

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: { id: "ghost-id", suit: "S", rank: "A", value: 1 },
        actions: fullRulePackage.actions,
        components: fullRulePackage.components,
        logRecorder: logRecorder as any,
      };

      const options = {
        selectedCostPayment: makeCostPayment({ lifeCount: 1 }),
      };

      expect(() => registry.createRequest(summonAceAction, context, options)).toThrow(ValidationError);

      // Assert complete absence of mutation (No-Mutation Failure Contract)
      expect(state.players.p1.hand).toHaveLength(1);
      expect(state.players.p1.hand[0].id).toBe("c-real");
      expect(state.players.p1.life).toHaveLength(1);
      expect(state.players.p1.life[0].id).toBe("l-cost-1"); // cost unconsumed!
      expect(state.players.p1.field).toEqual([]);
      expect(state.players.p1.grave).toEqual([]);
      expect(state.players.p1.rareCards).toEqual([]);
      expect(state.stage.requests).toEqual([]);
      expect(state.stage.history).toEqual([]);
      expect(state.turnUsage.p1["action.summonAce"]).toBe(0);
      expect(state.nextRequestSeq).toBe(5);
      expect(state.stateVersion).toBe(10);
      expect(emittedEvents).toEqual([]);
      expect(recordedLogs).toEqual([]);
    });

    it("Section 15: ambiguous duplicate source ID fails closed before any cost payment, seq increment, or state mutation", () => {
      const summonAceAction = fullRulePackage.actions.find((a) => a.id === "action.summonAce")!;
      const registry = new CommandRegistry();
      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      const recordedLogs: any[] = [];
      const logRecorder = {
        record: (entry: any) => recordedLogs.push(entry),
      };

      const lifeCard = { id: "l-cost-1", suit: "C", rank: "2", value: 2 };
      const dup1 = { id: "dup-id", suit: "S", rank: "A", value: 1 };
      const dup2 = { id: "dup-id", suit: "H", rank: "A", value: 1 };

      const state = {
        stateVersion: 10,
        nextRequestSeq: 5,
        turnUsage: { p1: { "action.summonAce": 0 } },
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [dup1, dup2],
            life: [lifeCard],
            field: [],
            grave: [],
            rareCards: [],
          },
        },
      } as any;

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: { id: "dup-id", suit: "S", rank: "A", value: 1 },
        actions: fullRulePackage.actions,
        components: fullRulePackage.components,
        logRecorder: logRecorder as any,
      };

      const options = {
        selectedCostPayment: makeCostPayment({ lifeCount: 1 }),
      };

      expect(() => registry.createRequest(summonAceAction, context, options)).toThrow(/複数存在します/);

      // Assert complete absence of mutation
      expect(state.players.p1.hand).toHaveLength(2);
      expect(state.players.p1.life).toHaveLength(1);
      expect(state.players.p1.life[0].id).toBe("l-cost-1"); // cost unconsumed!
      expect(state.stage.requests).toEqual([]);
      expect(state.stage.history).toEqual([]);
      expect(state.turnUsage.p1["action.summonAce"]).toBe(0);
      expect(state.nextRequestSeq).toBe(5);
      expect(state.stateVersion).toBe(10);
      expect(emittedEvents).toEqual([]);
      expect(recordedLogs).toEqual([]);
    });

    it("Section 16: Request holds the canonical State Card object with reference equality, not caller payload", () => {
      const summonAceAction = fullRulePackage.actions.find((a) => a.id === "action.summonAce")!;
      const registry = new CommandRegistry();

      const canonicalCardInState = { id: "physical-A", suit: "S", rank: "A", value: 1 };
      const state = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [canonicalCardInState],
            life: [{ id: "l-cost-1", suit: "C", rank: "2", value: 2 }],
            field: [],
            grave: [],
            rareCards: [],
          },
        },
      } as any;

      const callerForgedPayload = {
        id: "physical-A",
        suit: "H",
        rank: "A",
        value: 1,
        forgedExtraPayload: "malicious",
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: callerForgedPayload,
        actions: fullRulePackage.actions,
        components: fullRulePackage.components,
      };

      const options = {
        selectedCostPayment: makeCostPayment({ lifeCount: 1 }),
      };

      const req = registry.createRequest(summonAceAction, context, options);

      // Section 16 strong assertion: request.keyCards[0] === canonicalCardInState
      expect(req.keyCards).toHaveLength(1);
      expect(req.keyCards[0]).toBe(canonicalCardInState);
      expect(req.keyCards[0].suit).toBe("S"); // State suit
      expect((req.keyCards[0] as any).forgedExtraPayload).toBeUndefined(); // No forged fields
    });
  });

  // =========================================================================
  // 4. Trap Counter Security & Positive Canonical Regressions (Sections 17, 18, 19)
  // =========================================================================
  describe("Trap Counter Security & Positive Canonical Regressions", () => {
    it("Section 18: Security Regression - Trap Counter CANNOT cancel target using caller-forged H9 when State card is S7", () => {
      const trapCounterAction = rarePackRulePackage.actions.find((a) => a.id === "action.trapCounter")!;
      expect(trapCounterAction).toBeDefined();

      const registry = new CommandRegistry();
      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      // Target pending request on Stage: opponent's attack or action with key card H9
      const targetReq = {
        id: "req-target-1",
        actionId: "action.testAttack",
        controller: "p2",
        status: "pending",
        keyCards: [{ id: "target-c", suit: "H", rank: "9", value: 9 }],
      };

      // Player 1 Rare Card zone contains canonical S7
      const canonicalS7 = { id: "rare-key-1", suit: "S", rank: "7", value: 7 };

      const state = {
        stateVersion: 1,
        nextRequestSeq: 10,
        turnUsage: {},
        stage: { requests: [targetReq], history: [] },
        players: {
          p1: {
            hand: [],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            field: [],
            grave: [],
            rareCards: [canonicalS7],
          },
          p2: {
            hand: [],
            life: [{ id: "l2", suit: "D", rank: "3", value: 3 }],
            field: [],
            grave: [],
            rareCards: [],
          },
        },
      } as any;

      // Caller passes spoofed object with same ID "rare-key-1", but forged to H9 to fraudulently match target
      const spoofedH9Caller = { id: "rare-key-1", suit: "H", rank: "9", value: 9 };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: spoofedH9Caller,
        targetRequest: targetReq as any,
        actions: rarePackRulePackage.actions,
        components: rarePackRulePackage.components,
      };

      // Create Trap Counter request (immediate)
      const trapReq = registry.createRequest(trapCounterAction, context, { placement: "none" });

      // Request must hold canonical S7, NOT caller-spoofed H9
      expect(trapReq.keyCards[0]).toBe(canonicalS7);
      expect(trapReq.keyCards[0].suit).toBe("S");
      expect(trapReq.keyCards[0].rank).toBe("7");

      // Execute Trap Counter request via resolveRequest
      registry.resolveRequest(trapReq, context);

      // Section 18 Expected:
      // samePrintedCard(S7, H9) is FALSE!
      // Therefore target MUST NOT be cancelled!
      expect(targetReq.status).toBe("pending");
      expect(state.stage.requests).toContainEqual(targetReq);
    });

    it("Section 19: Positive Regression - Trap Counter DOES cancel target when canonical State card is S7 even if caller passes spoofed H9", () => {
      const trapCounterAction = rarePackRulePackage.actions.find((a) => a.id === "action.trapCounter")!;
      expect(trapCounterAction).toBeDefined();

      const registry = new CommandRegistry();

      // Target pending request on Stage has S7
      const targetReq = {
        id: "req-target-1",
        actionId: "action.testAttack",
        controller: "p2",
        status: "pending",
        keyCards: [{ id: "target-c", suit: "S", rank: "7", value: 7 }],
      };

      // Player 1 Rare Card zone contains canonical S7
      const canonicalS7 = { id: "rare-key-1", suit: "S", rank: "7", value: 7 };

      const state = {
        stateVersion: 1,
        nextRequestSeq: 10,
        turnUsage: {},
        stage: { requests: [targetReq], history: [] },
        players: {
          p1: {
            hand: [],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            field: [],
            grave: [],
            rareCards: [canonicalS7],
          },
          p2: {
            hand: [],
            life: [{ id: "l2", suit: "D", rank: "3", value: 3 }],
            field: [],
            grave: [],
            rareCards: [],
          },
        },
      } as any;

      // Caller erroneously passes H9 object for "rare-key-1"
      const callerPayloadH9 = { id: "rare-key-1", suit: "H", rank: "9", value: 9 };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: callerPayloadH9,
        targetRequest: targetReq as any,
        actions: rarePackRulePackage.actions,
        components: rarePackRulePackage.components,
      };

      const trapReq = registry.createRequest(trapCounterAction, context, { placement: "none" });
      registry.resolveRequest(trapReq, context);

      // Section 19 Expected:
      // samePrintedCard(canonical S7, target S7) is TRUE!
      // Therefore target IS cancelled!
      expect(targetReq.status).toBe("cancelled");
      expect(state.stage.requests.some((r: any) => r.id === targetReq.id)).toBe(false);
    });

    it("Section 17: Canonical Log Contract - Match Log and cardMoved events record canonical State Card", () => {
      const trapCounterAction = rarePackRulePackage.actions.find((a) => a.id === "action.trapCounter")!;
      const registry = new CommandRegistry();
      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      const recordedLogs: any[] = [];
      const logRecorder = {
        record: (entry: any) => recordedLogs.push(entry),
      };

      const targetReq = {
        id: "req-target-1",
        actionId: "action.testAttack",
        controller: "p2",
        status: "pending",
        keyCards: [{ id: "target-c", suit: "S", rank: "7", value: 7 }],
      };

      const canonicalS7 = { id: "rare-key-1", suit: "S", rank: "7", value: 7 };
      const state = {
        stateVersion: 1,
        nextRequestSeq: 10,
        turnUsage: {},
        stage: { requests: [targetReq], history: [] },
        players: {
          p1: {
            hand: [],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            field: [],
            grave: [],
            rareCards: [canonicalS7],
          },
          p2: {
            hand: [],
            life: [{ id: "l2", suit: "D", rank: "3", value: 3 }],
            field: [],
            grave: [],
            rareCards: [],
          },
        },
      } as any;

      const callerPayloadH9 = { id: "rare-key-1", suit: "H", rank: "9", value: 9 };
      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: callerPayloadH9,
        targetRequest: targetReq as any,
        actions: rarePackRulePackage.actions,
        components: rarePackRulePackage.components,
        logRecorder: logRecorder as any,
      };

      registry.createRequest(trapCounterAction, context, { placement: "none" });

      // Verify cardMoved event payload uses canonical S7
      const cardMovedEvt = emittedEvents.find(
        (e) => e.type === "cardMoved" && e.payload?.toZone === "request"
      );
      expect(cardMovedEvt).toBeDefined();
      expect(cardMovedEvt.payload.card).toBe(canonicalS7);
      expect(cardMovedEvt.payload.card.suit).toBe("S");
      expect(cardMovedEvt.payload.card.rank).toBe("7");

      // Verify request.created log uses canonical keyCardIds
      const requestCreatedLog = recordedLogs.find((l) => l.type === "request.created");
      expect(requestCreatedLog).toBeDefined();
      expect(requestCreatedLog.keyCardIds).toEqual(["rare-key-1"]);
    });
  });

  // =========================================================================
  // 5. Rare Summon Canonical Regression (Section 20)
  // =========================================================================
  describe("Rare Summon Canonical Regression", () => {
    it("Section 20: Rare Summon creates unit derived strictly from canonical State card, ignoring forged caller card", () => {
      const rareSummonAction = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;
      expect(rareSummonAction).toBeDefined();

      const registry = new CommandRegistry();
      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      // Canonical Rare Card in State is S8
      const canonicalS8 = { id: "rare-c8", suit: "S", rank: "8", value: 8 };

      // Sacrifice soldier unit for cost S
      const sacUnit = {
        unitId: "u-sac-1",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-sac", suit: "D", rank: "2", value: 2 }],
      };

      const state = {
        stateVersion: 1,
        nextRequestSeq: 10,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            field: [sacUnit],
            grave: [],
            rareCards: [canonicalS8],
          },
        },
      } as any;

      // Caller submits forged card representation (e.g. Diamond 2) with the same physical ID
      const callerForgedD2 = { id: "rare-c8", suit: "D", rank: "2", value: 2 };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: callerForgedD2,
        actions: rarePackRulePackage.actions,
        components: rarePackRulePackage.components,
      };

      const options = {
        selectedCostPayment: makeCostPayment({ sacrificedUnitIds: ["u-sac-1"] }),
      };

      // 1. Create request
      const req = registry.createRequest(rareSummonAction, context, options);

      // Request holds canonical S8
      expect(req.keyCards[0]).toBe(canonicalS8);

      // cardMoved rare -> request used canonical S8
      const moveEvt = emittedEvents.find((e) => e.type === "cardMoved" && e.payload?.toZone === "request");
      expect(moveEvt).toBeDefined();
      expect(moveEvt.payload.card).toBe(canonicalS8);

      // 2. Execute resolution (request -> field)
      registry.resolveRequest(req, context);

      // Resulting unit on field MUST have the canonical card S8, NOT forged D2!
      const summonedUnit = state.players.p1.field.find((u: any) => u.cards.some((c: any) => c.id === "rare-c8"));
      expect(summonedUnit).toBeDefined();
      expect(summonedUnit.cards[0]).toBe(canonicalS8);
      expect(summonedUnit.cards[0].suit).toBe("S");
      expect(summonedUnit.cards[0].rank).toBe("8");
    });
  });
});
