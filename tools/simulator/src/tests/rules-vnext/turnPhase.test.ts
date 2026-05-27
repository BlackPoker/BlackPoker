import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import * as path from "path";

describe("Turn/Chance (Turn and Chance) model and Timing validation tests", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should initialize turnState upon startTurn (A)", () => {
    const state: any = { players: {} };
    TurnManager.startTurn(state, "p1");

    expect(state.turnPlayer).toBe("p1");
    expect(state.nonTurnPlayer).toBe("p2");
    expect(state.chancePlayer).toBe("p1");
    expect(state.turnCount).toBe(1);
    expect(state.actionCount).toBe(0);
  });

  it("should toggle chancePlayer on passChance (B)", () => {
    const state: any = { players: {} };
    TurnManager.startTurn(state, "p1");
    expect(state.chancePlayer).toBe("p1");

    TurnManager.passChance(state);
    expect(state.chancePlayer).toBe("p2");

    TurnManager.passChance(state);
    expect(state.chancePlayer).toBe("p1");
  });

  it("should toggle turn and increment turnCount on endTurn (C)", () => {
    const state: any = { players: {} };
    
    TurnManager.startTurn(state, "p1"); // turnCount = 1
    TurnManager.endTurn(state); // -> p2 startTurn (turnCount = 2)

    expect(state.turnPlayer).toBe("p2");
    expect(state.nonTurnPlayer).toBe("p1");
    expect(state.chancePlayer).toBe("p2");
    expect(state.turnCount).toBe(2);
  });

  it("should allow timing:main actions when requester is turnPlayer, chancePlayer and stage is empty (D)", () => {
    const setBulwarkAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [handCard],
          field: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    expect(() => registry.validateAction(setBulwarkAction, context)).not.toThrow();
  });

  it("should throw ValidationError for timing:main if conditions (turnPlayer, chancePlayer, empty stage) are not met (E)", () => {
    const setBulwarkAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [handCard],
          field: [],
        },
        p2: {
          name: "Player B",
          life: [{ id: "l2", suit: "S", rank: "2", value: 2 }],
          hand: [],
          field: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    // Case 1: requester is not turnPlayer
    const contextNotTurnPlayer: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: handCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.validateAction(setBulwarkAction, contextNotTurnPlayer)).toThrow(ValidationError);

    // Case 2: requester is turnPlayer but not chancePlayer
    TurnManager.passChance(state); // chancePlayer becomes p2
    const contextNotChancePlayer: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.validateAction(setBulwarkAction, contextNotChancePlayer)).toThrow(ValidationError);

    // Case 3: requester is turnPlayer and chancePlayer, but stage is not empty
    state.chancePlayer = "p1"; // restore chancePlayer
    state.stage.requests.push({ id: "req-1", actionId: "action.some" } as any);
    const contextStageNotEmpty: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.validateAction(setBulwarkAction, contextStageNotEmpty)).toThrow(ValidationError);
  });

  it("should allow timing:quick actions if requester is chancePlayer regardless of stage empty (F)", () => {
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
    const handCard = { id: "hand-card", code: "♢7", suit: "D", rank: "7", value: 7 };
    const costCard = { id: "cost-card", code: "♣2", suit: "C", rank: "2", value: 2 };
    
    const soldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [handCard, costCard],
          field: [soldier],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [{ id: "l2", suit: "S", rank: "2", value: 2 }],
          hand: [],
          field: [],
        }
      },
      stage: {
        requests: [{ id: "req-1", actionId: "action.throw" }]
      }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    // Case 1: requester (p1) is chancePlayer, stage is not empty -> Allowed
    const contextP1: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: soldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.validateAction(twistAction, contextP1)).not.toThrow();

    // Case 2: requester (p2) is not chancePlayer -> ValidationError
    const contextP2: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: handCard,
      targetComponent: soldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.validateAction(twistAction, contextP2)).toThrow(ValidationError);
  });

  it("should skip timing check when turnPlayer or chancePlayer is undefined in GameState (G)", () => {
    const setBulwarkAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [handCard],
          field: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    expect(() => registry.validateAction(setBulwarkAction, context)).not.toThrow();
  });
});
