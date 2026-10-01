import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { parseCost, VALID_COST_SYMBOLS } from "../../engine/rules/CostParser";
import { CostPaymentEnumerator } from "../../engine/decision/CostPaymentEnumerator";
import { CostResolver } from "../../engine/rules/CostResolver";
import { CommandContext } from "../../engine/rules/CommandRegistry";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
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

describe("Cost S (Sacrifice) Unit Tests", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  describe("1. CostParser & VALID_COST_SYMBOLS", () => {
    it("includes 'S' in VALID_COST_SYMBOLS", () => {
      expect(VALID_COST_SYMBOLS).toContain("S");
    });

    it("parses cost 'S' correctly into symbol item", () => {
      const parsed = parseCost("S");
      expect(parsed).toEqual(["S"]);
    });

    it("parses combined costs containing 'S' (e.g. 'SL')", () => {
      const parsed = parseCost("SL");
      expect(parsed).toEqual(["S", "L"]);
    });
  });

  describe("2. CostPaymentEnumerator for Cost S", () => {
    const createBasePlayer = (field: any[] = []) => ({
      name: "Player A",
      life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
      hand: [{ id: "h1", suit: "H", rank: "3", value: 3 }],
      field,
      grave: [],
      fog: [],
    });

    it("returns 0 payments when controller has 0 field units", () => {
      const p1 = createBasePlayer([]);
      const payments = CostPaymentEnumerator.enumeratePayments("S", p1, new Set(), rulePackage.components);
      expect(payments).toEqual([]);
    });

    it("returns 1 payment with unitId when controller has 1 character", () => {
      const soldier = {
        unitId: "u-soldier-1",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
        labels: ["攻撃", "防御"],
      };
      const p1 = createBasePlayer([soldier]);
      const payments = CostPaymentEnumerator.enumeratePayments("S", p1, new Set(), rulePackage.components);
      expect(payments.length).toBe(1);
      expect(payments[0].sacrificedUnitIds).toEqual(["u-soldier-1"]);
      expect(payments[0].summary).toBe("$S (一般兵 墓地)");
    });

    it("returns payments for multiple characters (soldier and bulwark)", () => {
      const soldier = {
        unitId: "u-soldier-1",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
      };
      const bulwark = {
        unitId: "u-bulwark-1",
        componentId: "character.bulwark",
        kind: "防壁",
        state: "drive",
        cards: [{ id: "c2", suit: "D", rank: "6", value: 6 }],
      };
      const p1 = createBasePlayer([soldier, bulwark]);
      const payments = CostPaymentEnumerator.enumeratePayments("S", p1, new Set(), rulePackage.components);
      expect(payments.length).toBe(2);
      const unitIds = payments.map((p) => p.sacrificedUnitIds?.[0]);
      expect(unitIds).toContain("u-soldier-1");
      expect(unitIds).toContain("u-bulwark-1");
    });

    it("both charge and drive units are eligible for Cost S", () => {
      const chargeUnit = {
        unitId: "u-charge",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
      };
      const driveUnit = {
        unitId: "u-drive",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "drive",
        cards: [{ id: "c2", suit: "S", rank: "6", value: 6 }],
      };
      const p1 = createBasePlayer([chargeUnit, driveUnit]);
      const payments = CostPaymentEnumerator.enumeratePayments("S", p1, new Set(), rulePackage.components);
      expect(payments.length).toBe(2);
    });

    it("ignores opponent's units because payments are enumerated strictly from controller player object", () => {
      const oppUnit = {
        unitId: "u-opp",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-opp", suit: "S", rank: "5", value: 5 }],
      };
      const p1 = createBasePlayer([]);
      const p2 = createBasePlayer([oppUnit]);
      const paymentsP1 = CostPaymentEnumerator.enumeratePayments("S", p1, new Set(), rulePackage.components);
      expect(paymentsP1.length).toBe(0);

      const paymentsP2 = CostPaymentEnumerator.enumeratePayments("S", p2, new Set(), rulePackage.components);
      expect(paymentsP2.length).toBe(1);
    });

    it("does not produce duplicate payments for the same unit ID", () => {
      const soldier = {
        unitId: "u-dup",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
      };
      const p1 = createBasePlayer([soldier]);
      const payments = CostPaymentEnumerator.enumeratePayments("S", p1, new Set(), rulePackage.components);
      const uniqueUnitIds = new Set(payments.map((p) => p.sacrificedUnitIds?.[0]));
      expect(uniqueUnitIds.size).toBe(payments.length);
    });
  });

  describe("3. CostResolver for Cost S", () => {
    it("matchesCost returns true when payment contains 1 sacrificedUnitId", () => {
      const resolver = new CostResolver();
      const payment = makeCostPayment({ sacrificedUnitIds: ["u-1"], summary: "$S" });
      expect(resolver.matchesCost(payment, "S")).toBe(true);
      expect(resolver.matchesCost(payment, "B")).toBe(false);
      expect(resolver.matchesCost(payment, "L")).toBe(false);
    });

    it("canPaySelection validates existence of sacrificed unit on controller field", () => {
      const resolver = new CostResolver();
      const soldier = {
        unitId: "u-1",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
      };
      const state = {
        players: {
          p1: { field: [soldier], grave: [] },
          p2: { field: [], grave: [] },
        },
      } as any;
      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(resolver.canPaySelection(makeCostPayment({ sacrificedUnitIds: ["u-1"] }), context, "S")).toBe(true);
      expect(resolver.canPaySelection(makeCostPayment({ sacrificedUnitIds: ["u-nonexistent"] }), context, "S")).toBe(false);
    });

    it("paySelection removes sacrificed unit from field and places cards in grave, emitting cardMoved", () => {
      const resolver = new CostResolver();

      const unitCard = { id: "c-sac", suit: "S", rank: "7", value: 7 };
      const soldier = {
        unitId: "u-sac",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [unitCard],
      };
      const state = {
        players: {
          p1: { field: [soldier], grave: [] },
          p2: { field: [], grave: [] },
        },
      } as any;
      const events: any[] = [];
      const mockInterpreter = {
        dispatchEvent: (evt: any) => events.push(evt),
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      resolver.paySelection(makeCostPayment({ sacrificedUnitIds: ["u-sac"] }), context, mockInterpreter);

      expect(state.players.p1.field.length).toBe(0);
      expect(state.players.p1.grave.length).toBe(1);
      expect(state.players.p1.grave[0].cards[0].id).toBe("c-sac");

      const moveEvent = events.find((e) => e.type === "cardMoved" && e.payload?.toZone === "grave");
      expect(moveEvent).toBeDefined();
      expect(moveEvent.payload.fromZone).toBe("field");
      expect(moveEvent.payload.cause).toEqual({ type: "cost", symbol: "S" });
    });

    it("canPay returns true if field has characters and false if empty", () => {
      const resolver = new CostResolver();
      const soldier = {
        unitId: "u-1",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
      };
      const contextWithUnit: CommandContext = {
        state: { players: { p1: { field: [soldier], grave: [] } } } as any,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };
      const contextEmpty: CommandContext = {
        state: { players: { p1: { field: [], grave: [] } } } as any,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      expect(resolver.canPay("S", contextWithUnit)).toBe(true);
      expect(resolver.canPay("S", contextEmpty)).toBe(false);
    });

    it("pay('S') automatically sacrifices a character to grave", () => {
      const resolver = new CostResolver();

      const soldier = {
        unitId: "u-auto",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-auto", suit: "S", rank: "5", value: 5 }],
      };
      const state = {
        players: {
          p1: { field: [soldier], grave: [] },
        },
      } as any;
      const events: any[] = [];
      const mockInterpreter = {
        dispatchEvent: (evt: any) => events.push(evt),
      };
      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      resolver.pay("S", context, mockInterpreter);
      expect(state.players.p1.field.length).toBe(0);
      expect(state.players.p1.grave.length).toBe(1);
    });

    it("9.A: Rejects duplicate sacrificedUnitIds in matchesCost and canPaySelection", () => {
      const resolver = new CostResolver();
      const soldier = {
        unitId: "u-dup-1",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-dup-1", suit: "S", rank: "5", value: 5 }],
      };
      const state = {
        players: {
          p1: { field: [soldier], grave: [] },
        },
      } as any;
      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      const dupPayment = makeCostPayment({
        sacrificedUnitIds: ["u-dup-1", "u-dup-1"],
        summary: "$S (dup)",
      });

      // matchesCost rejects duplicates
      expect(resolver.matchesCost(dupPayment, "S")).toBe(false);
      // canPaySelection rejects duplicates
      expect(resolver.canPaySelection(dupPayment, context, "S")).toBe(false);
    });

    it("9.B: Non-character (ComponentDefinition.type !== 'character') is rejected as Cost S candidate and in canPaySelection", () => {
      const resolver = new CostResolver();
      const customComponents = [
        ...rulePackage.components,
        {
          id: "field.arena",
          name: "競技場",
          type: "field" as const,
          zone: "field",
          properties: {},
        },
      ];

      const nonCharUnit = {
        unitId: "u-arena",
        componentId: "field.arena",
        kind: "競技場",
        cards: [{ id: "c-arena", suit: "H", rank: "10", value: 10 }],
      };

      const player = {
        field: [nonCharUnit],
        hand: [],
        grave: [],
      };

      // CostPaymentEnumerator does not enumerate non-character as Cost S candidate
      const payments = CostPaymentEnumerator.enumeratePayments("S", player, new Set(), customComponents);
      expect(payments.length).toBe(0);

      // canPaySelection rejects non-character
      const state = {
        players: {
          p1: player,
        },
      } as any;
      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: customComponents,
      };

      const payment = makeCostPayment({
        sacrificedUnitIds: ["u-arena"],
        summary: "$S (arena)",
      });
      expect(resolver.canPaySelection(payment, context, "S")).toBe(false);
    });

    it("9.C: Multi-card character Cost S conservation (wrapper preserved, all physical cards moved to grave with individual events)", () => {
      const resolver = new CostResolver();
      const card1 = { id: "c-multi-1", suit: "S", rank: "5", value: 5 };
      const card2 = { id: "c-multi-2", suit: "S", rank: "9", value: 9 };
      const multiUnit = {
        unitId: "u-multi",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [card1, card2],
      };

      const state = {
        players: {
          p1: { field: [multiUnit], grave: [] },
        },
      } as any;
      const events: any[] = [];
      const mockInterpreter = {
        dispatchEvent: (evt: any) => events.push(evt),
      };
      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      const payment = makeCostPayment({
        sacrificedUnitIds: ["u-multi"],
        summary: "$S (multi)",
      });

      expect(resolver.canPaySelection(payment, context, "S")).toBe(true);

      resolver.paySelection(payment, context, mockInterpreter);

      // Field count should be 0
      expect(state.players.p1.field.length).toBe(0);

      // Grave has exactly 1 unit wrapper (not split!)
      expect(state.players.p1.grave.length).toBe(1);
      const graveUnit = state.players.p1.grave[0];
      expect(graveUnit.unitId).toBe("u-multi");
      expect(graveUnit.cards.length).toBe(2);
      expect(graveUnit.cards.map((c: any) => c.id)).toEqual(["c-multi-1", "c-multi-2"]);

      // Individual cardMoved events emitted for each card in the unit
      const cardMovedEvents = events.filter((e) => e.type === "cardMoved" && e.payload?.toZone === "grave");
      expect(cardMovedEvents.length).toBe(2);
      expect(cardMovedEvents[0].payload.card.id).toBe("c-multi-1");
      expect(cardMovedEvents[0].payload.fromZone).toBe("field");
      expect(cardMovedEvents[0].payload.cause).toEqual({ type: "cost", symbol: "S" });
      expect(cardMovedEvents[1].payload.card.id).toBe("c-multi-2");
      expect(cardMovedEvents[1].payload.fromZone).toBe("field");
      expect(cardMovedEvents[1].payload.cause).toEqual({ type: "cost", symbol: "S" });
    });
  });
});
