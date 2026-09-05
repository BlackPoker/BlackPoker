import { describe, it, expect } from "vitest";
import { CostResolver } from "../../engine/rules/CostResolver";
import { CommandContext } from "../../engine/rules/CommandRegistry";
import { CostPayment } from "../../domain/decision/DecisionCatalog";

describe("CostResolver D Cost Determinism (Gate 0)", () => {
  const mockEffectInterpreter = {
    dispatchEvent: () => {},
  };

  function createTestState() {
    return {
      stateVersion: 5,
      players: {
        p1: {
          hand: [
            { id: "c-h1", suit: "H", rank: "A", value: 1 },
            { id: "c-s2", suit: "S", rank: "2", value: 2 },
          ],
          grave: [],
        },
      },
    };
  }

  it("同一入力で支払った場合、墓地へ生成されるunitId/card identity/grave orderが完全一致すること", () => {
    const resolver = new CostResolver();
    const costPayment: CostPayment = {
      lifeCount: 0,
      discardedCardIds: ["c-h1", "c-s2"],
      drivenBulwarkUnitIds: [],
      sacrificedUnitIds: [],
    };

    // 試行 1
    const state1 = createTestState();
    const context1: CommandContext = {
      state: state1,
      playerKey: "p1",
    };
    resolver.paySelection(costPayment, context1, mockEffectInterpreter);

    // 試行 2
    const state2 = createTestState();
    const context2: CommandContext = {
      state: state2,
      playerKey: "p1",
    };
    resolver.paySelection(costPayment, context2, mockEffectInterpreter);

    // 検証
    expect(state1.players.p1.grave).toHaveLength(2);
    expect(state2.players.p1.grave).toHaveLength(2);

    expect(state1.players.p1.grave[0].unitId).toBe("unit-cost-p1-c-h1-5-0");
    expect(state1.players.p1.grave[1].unitId).toBe("unit-cost-p1-c-s2-5-1");

    expect(state1.players.p1.grave).toEqual(state2.players.p1.grave);
    expect(state1.players.p1.grave[0].unitId).not.toContain("NaN");
    expect(state1.players.p1.grave[0].unitId).not.toContain("undefined");
  });

  it("Date.nowやMath.randomを含まない論理ID形式であること", () => {
    const resolver = new CostResolver();
    const costPayment: CostPayment = {
      lifeCount: 0,
      discardedCardIds: ["c-h1"],
      drivenBulwarkUnitIds: [],
      sacrificedUnitIds: [],
    };

    const state = createTestState();
    const context: CommandContext = {
      state,
      playerKey: "p1",
    };
    resolver.paySelection(costPayment, context, mockEffectInterpreter);

    const unitId = state.players.p1.grave[0].unitId;
    expect(unitId).toMatch(/^unit-cost-p1-c-h1-5-0$/);
  });
});
