import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import {
  resolveKeyCardSourceZone,
  validateKeyCardsInSource,
  removeKeyCardsFromSource,
} from "../../engine/rules/keyCardUtils";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { CostPayment } from "../../domain/decision/DecisionCatalog";
import { loadRegulationCatalog, getRegulation, getFormat, getFrame } from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";

function makeCostPayment(overrides: Partial<CostPayment> = {}): CostPayment {
  return {
    discardedCardIds: [],
    drivenBulwarkUnitIds: [],
    sacrificedUnitIds: [],
    lifeCount: 0,
    ...overrides,
  };
}

describe("BP-SIM-REG-4.0-C-R1: Key Card Source Validation & Canonical Movement", () => {
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

  describe("Section 4: Required Key Source Regression Tests", () => {
    const validator = new ActionRequestValidator();

    it("4.A: Hand source with valid physical key card -> Validator PASS", () => {
      const summonAction = fullRulePackage.actions.find((a) => a.id === "action.summonSoldier")!;
      expect(resolveKeyCardSourceZone(summonAction)).toBe("hand");

      const keyCard = { id: "c-h5", suit: "H", rank: "5", value: 5 };
      const bulwarkUnit = {
        unitId: "bw-1",
        componentId: "character.bulwark",
        kind: "防壁",
        state: "charge",
        cards: [{ id: "c-bw", suit: "S", rank: "2", value: 2 }],
        labels: ["防御"],
      };

      const state = {
        matchId: "test-key-source",
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [keyCard],
            field: [bulwarkUnit],
            life: [{ id: "l-1", suit: "C", rank: "2", value: 2 }],
            grave: [],
          },
        },
      } as any;

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard,
        actions: fullRulePackage.actions,
        components: fullRulePackage.components,
      };

      expect(() => validator.validateActionRequest(summonAction, context)).not.toThrow();
    });

    it("4.B: Hand source with key card ID NOT present in hand -> Validator FAIL", () => {
      const summonAction = fullRulePackage.actions.find((a) => a.id === "action.summonSoldier")!;
      expect(resolveKeyCardSourceZone(summonAction)).toBe("hand");

      const missingKeyCard = { id: "c-missing-in-hand", suit: "H", rank: "5", value: 5 };
      const otherCard = { id: "c-other", suit: "S", rank: "8", value: 8 };

      const state = {
        matchId: "test-key-source",
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [otherCard], // missingKeyCard is not in hand!
            field: [
              {
                unitId: "bw-1",
                componentId: "character.bulwark",
                kind: "防壁",
                state: "charge",
                cards: [{ id: "c-bw", suit: "S", rank: "2", value: 2 }],
                labels: ["防御"],
              },
            ],
            life: [{ id: "l-1", suit: "C", rank: "2", value: 2 }],
            grave: [],
          },
        },
      } as any;

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: missingKeyCard,
        actions: fullRulePackage.actions,
        components: fullRulePackage.components,
      };

      expect(() => validator.validateActionRequest(summonAction, context)).toThrow(ValidationError);
      expect(() => validator.validateActionRequest(summonAction, context)).toThrow(/指定元ゾーン 'hand' に存在しません/);
    });

    it("4.C: Rare source with valid physical key card -> Validator PASS", () => {
      const rareSummonAction = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;
      expect(resolveKeyCardSourceZone(rareSummonAction)).toBe("rare");

      const rareKeyCard = { id: "c-rare-valid", suit: "D", rank: "7", value: 7 };
      const sacUnit = {
        unitId: "u-sac",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-sac", suit: "H", rank: "3", value: 3 }],
      };

      const state = {
        matchId: "test-rare-source",
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [],
            rareCards: [rareKeyCard],
            field: [sacUnit],
            life: [{ id: "l-1", suit: "C", rank: "2", value: 2 }], // 1 life <= 9
            grave: [],
          },
        },
      } as any;

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: rareKeyCard,
        actions: rarePackRulePackage.actions,
        components: rarePackRulePackage.components,
      };

      expect(() => validator.validateActionRequest(rareSummonAction, context)).not.toThrow();
    });

    it("4.D: Rare source with card NOT present in Rare zone -> Validator FAIL", () => {
      const rareSummonAction = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;
      expect(resolveKeyCardSourceZone(rareSummonAction)).toBe("rare");

      const missingRareCard = { id: "c-rare-nonexistent", suit: "D", rank: "7", value: 7 };
      const actualRareCard = { id: "c-rare-other", suit: "S", rank: "Q", value: 12 };
      const sacUnit = {
        unitId: "u-sac",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-sac", suit: "H", rank: "3", value: 3 }],
      };

      const state = {
        matchId: "test-rare-source",
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [],
            rareCards: [actualRareCard], // missingRareCard not in rareCards
            field: [sacUnit],
            life: [{ id: "l-1", suit: "C", rank: "2", value: 2 }],
            grave: [],
          },
        },
      } as any;

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: missingRareCard,
        actions: rarePackRulePackage.actions,
        components: rarePackRulePackage.components,
      };

      expect(() => validator.validateActionRequest(rareSummonAction, context)).toThrow(ValidationError);
      expect(() => validator.validateActionRequest(rareSummonAction, context)).toThrow(/指定元ゾーン 'rare' に存在しません/);
    });

    it("4.E: removeKeyCardsFromSource fail-closed with un-mutated source zone when mixed with missing card (all-or-nothing)", () => {
      const cardA = { id: "c-a", suit: "S", rank: "5", value: 5 };
      const cardB = { id: "c-b", suit: "S", rank: "6", value: 6 };
      const cardNonExistent = { id: "c-ghost", suit: "S", rank: "7", value: 7 };

      const player = {
        hand: [cardA, cardB],
        rareCards: [cardA, cardB],
      };

      // 1. hand source: mix existing cardA and non-existent card
      expect(() => {
        removeKeyCardsFromSource(player, "hand", [cardA, cardNonExistent]);
      }).toThrow(/除去対象カード 'c-ghost' が元ゾーン 'hand' に存在しません/);

      // Verify hand is completely unmodified (all-or-nothing)
      expect(player.hand.length).toBe(2);
      expect(player.hand[0].id).toBe("c-a");
      expect(player.hand[1].id).toBe("c-b");

      // 2. rare source: mix existing cardA and non-existent card
      expect(() => {
        removeKeyCardsFromSource(player, "rare", [cardA, cardNonExistent]);
      }).toThrow(/除去対象カード 'c-ghost' が元ゾーン 'rare' に存在しません/);

      // Verify rareCards is completely unmodified (all-or-nothing)
      expect(player.rareCards.length).toBe(2);
      expect(player.rareCards[0].id).toBe("c-a");
      expect(player.rareCards[1].id).toBe("c-b");

      // 3. duplicate card ID in removal list -> fail-closed without mutating
      expect(() => {
        removeKeyCardsFromSource(player, "hand", [cardA, cardA]);
      }).toThrow(/重複が存在します/);
      expect(player.hand.length).toBe(2);
    });
  });

  describe("Section 6: Canonical Movement Tests for summonUnit", () => {
    it("6.1: Rare Summon request resolution emits cardMoved with fromZone 'request' -> 'field'", () => {
      const rareSummonAction = rarePackRulePackage.actions.find((a) => a.id === "action.rareSummon")!;
      const rareCard = { id: "c-rare-res", suit: "S", rank: "8", value: 8 };
      const sacUnit = {
        unitId: "u-sac-res",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-sac-res", suit: "D", rank: "2", value: 2 }],
      };

      const events: any[] = [];
      const registry = new CommandRegistry();
      registry.onEvent((evt: any) => events.push(evt));

      const state = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        turnUsage: { p1: {} },
        players: {
          p1: {
            hand: [],
            rareCards: [rareCard],
            field: [sacUnit],
            life: [{ id: "l-1", suit: "H", rank: "2", value: 2 }],
            grave: [],
          },
        },
      } as any;

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: rareCard,
        actions: rarePackRulePackage.actions,
        components: rarePackRulePackage.components,
      };

      const req = registry.createRequest(rareSummonAction, context, {
        selectedCostPayment: makeCostPayment({
          sacrificedUnitIds: [sacUnit.unitId],
          summary: "$S",
        }),
      });

      // Clear events emitted during createRequest (e.g. rare -> request)
      events.length = 0;

      // Resolve Rare Summon request
      registry.resolveRequest(req, context);

      const moveEvent = events.find(
        (e) => e.type === "cardMoved" && e.payload?.card?.id === rareCard.id && e.payload?.toZone === "field"
      );
      expect(moveEvent).toBeDefined();
      expect(moveEvent.payload.fromZone).toBe("request");
    });

    it("6.2: Normal Request-based summon resolution emits cardMoved with fromZone 'request' -> 'field'", () => {
      const summonAction = fullRulePackage.actions.find((a) => a.id === "action.summonSoldier")!;
      const soldierKey = { id: "c-sol-req", suit: "S", rank: "5", value: 5 };
      const bulwarkUnit = {
        unitId: "bw-req",
        componentId: "character.bulwark",
        kind: "防壁",
        state: "charge",
        cards: [{ id: "c-bw-req", suit: "H", rank: "2", value: 2 }],
        labels: ["防御"],
      };

      const events: any[] = [];
      const registry = new CommandRegistry();
      registry.onEvent((evt: any) => events.push(evt));

      const state = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        turnUsage: { p1: {} },
        players: {
          p1: {
            hand: [soldierKey],
            field: [bulwarkUnit],
            life: [{ id: "l-cost", suit: "D", rank: "3", value: 3 }],
            grave: [],
          },
        },
      } as any;

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard: soldierKey,
        actions: fullRulePackage.actions,
        components: fullRulePackage.components,
      };

      const req = registry.createRequest(summonAction, context, {
        selectedCostPayment: makeCostPayment({
          lifeCount: 1,
          drivenBulwarkUnitIds: ["bw-req"],
          summary: "$BL",
        }),
      });

      events.length = 0;

      // Resolve normal summon request
      registry.resolveRequest(req, context);

      const moveEvent = events.find(
        (e) => e.type === "cardMoved" && e.payload?.card?.id === soldierKey.id && e.payload?.toZone === "field"
      );
      expect(moveEvent).toBeDefined();
      expect(moveEvent.payload.fromZone).toBe("request");
    });

    it("6.3: Generic summon with no currentRequest and physical card in hand emits cardMoved 'hand' -> 'field'", () => {
      const handCard = { id: "c-direct-hand", suit: "H", rank: "7", value: 7 };
      const events: any[] = [];
      const registry = new CommandRegistry();
      registry.onEvent((evt: any) => events.push(evt));

      const state = {
        stateVersion: 1,
        players: {
          p1: {
            hand: [handCard],
            field: [],
            grave: [],
          },
        },
      } as any;

      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: fullRulePackage.actions,
        components: fullRulePackage.components,
      };

      // Directly invoke summonUnit via registry.execute without currentRequest
      registry.execute("summonUnit", { card: handCard }, context);

      expect(state.players.p1.field.length).toBe(1);
      expect(state.players.p1.hand.length).toBe(0);

      const moveEvent = events.find(
        (e) => e.type === "cardMoved" && e.payload?.card?.id === handCard.id && e.payload?.toZone === "field"
      );
      expect(moveEvent).toBeDefined();
      expect(moveEvent.payload.fromZone).toBe("hand");
    });

    it("6.4: context.keyCards present WITHOUT currentRequest.keyCards does NOT falsely record 'request' -> 'field'", () => {
      const keyCard = { id: "c-no-req-key", suit: "S", rank: "3", value: 3 };
      const events: any[] = [];
      const registry = new CommandRegistry();
      registry.onEvent((evt: any) => events.push(evt));

      const state = {
        stateVersion: 1,
        players: {
          p1: {
            hand: [keyCard],
            field: [],
            grave: [],
          },
        },
      } as any;

      // context.keyCards is set, but currentRequest is absent!
      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCard,
        keyCards: [keyCard],
        actions: fullRulePackage.actions,
        components: fullRulePackage.components,
        // currentRequest is intentionally undefined!
      };

      registry.execute("summonUnit", { card: keyCard }, context);

      const moveEvent = events.find(
        (e) => e.type === "cardMoved" && e.payload?.card?.id === keyCard.id && e.payload?.toZone === "field"
      );
      expect(moveEvent).toBeDefined();
      // MUST NOT falsely record 'request' -> 'field'
      expect(moveEvent.payload.fromZone).toBe("hand");
    });
  });
});
