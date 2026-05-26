import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import * as path from "path";

describe("Turn/Phase transitions and Timing validation tests", () => {
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
    expect(state.phase).toBe("draw");
    expect(state.turnCount).toBe(1);
  });

  it("should move phases in correct order (B)", () => {
    const state: any = { players: {} };
    TurnManager.startTurn(state, "p1");

    expect(state.phase).toBe("draw");

    // draw -> main (OK)
    TurnManager.movePhase(state, "main");
    expect(state.phase).toBe("main");

    // main -> end (OK)
    TurnManager.movePhase(state, "end");
    expect(state.phase).toBe("end");

    // end -> draw (NG: movePhaseで直接drawへ戻るのは不正)
    expect(() => TurnManager.movePhase(state, "draw")).toThrow(
      "不正なフェーズ遷移です。現在: end, 遷移先: draw"
    );
  });

  it("should toggle turn and increment turnCount on endTurn (C)", () => {
    const state: any = { players: {} };
    
    TurnManager.startTurn(state, "p1"); // turnCount = 1
    TurnManager.movePhase(state, "main");
    TurnManager.movePhase(state, "end");

    TurnManager.endTurn(state); // -> p2 startTurn (turnCount = 2)

    expect(state.turnPlayer).toBe("p2");
    expect(state.nonTurnPlayer).toBe("p1");
    expect(state.phase).toBe("draw");
    expect(state.turnCount).toBe(2);
  });

  it("should allow timing:main actions during main phase (D)", () => {
    const setBulwarkAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }], // コストL用
          hand: [handCard],
          field: [],
        }
      }
    };

    const registry = new CommandRegistry();
    
    // ヘルパーで main から直接開始 (turnCount = 1)
    TurnManager.initializeToMain(state, "p1");
    expect(state.turnCount).toBe(1);
    expect(state.phase).toBe("main");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // mainフェーズなので、timing:mainの防壁設置アクションがリクエスト可能であること
    expect(() => registry.validateAction(setBulwarkAction, context)).not.toThrow();
  });

  it("should throw ValidationError if timing:main action is requested in draw/end phase (E)", () => {
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
    TurnManager.startTurn(state, "p1"); // phase = draw

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // drawフェーズなので、timing:mainの防壁設置は ValidationError になること
    expect(() => registry.validateAction(setBulwarkAction, context)).toThrow(
      ValidationError
    );
    expect(() => registry.validateAction(setBulwarkAction, context)).toThrow(
      "メインタイミングのアクションはメインフェーズでのみ使用可能です。現在: draw"
    );

    // endフェーズへ移動
    TurnManager.movePhase(state, "main");
    TurnManager.movePhase(state, "end");

    // endフェーズでも ValidationError になること
    expect(() => registry.validateAction(setBulwarkAction, context)).toThrow(
      ValidationError
    );
    expect(() => registry.validateAction(setBulwarkAction, context)).toThrow(
      "メインタイミングのアクションはメインフェーズでのみ使用可能です。現在: end"
    );
  });

  it("should skip timing check when phase is undefined in GameState (F)", () => {
    const setBulwarkAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    
    const state: any = {
      // phase が定義されていない状態
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

    // phaseが未定義なので、タイミングチェックがスキップされ正常に機能すること
    expect(() => registry.validateAction(setBulwarkAction, context)).not.toThrow();
  });
});
