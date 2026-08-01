import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Next Generation Triggered Action Integration Test (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should load nextGeneration action correctly", () => {
    const nextGenAction = rulePackage.actions.find((a) => a.id === "action.nextGeneration");
    expect(nextGenAction).toBeDefined();
    expect(nextGenAction?.name).toBe("世代交代");
    expect(nextGenAction?.type).toBe("triggered");
    expect(nextGenAction?.triggerCondition?.event).toBe("cardMoved");
  });

  it("should trigger nextGeneration when a legacy card (J) goes to grave (Test A)", () => {
    // モックシミュレーター状態
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-2", suit: "H", rank: "2", value: 2 },
            { id: "life-7", suit: "D", rank: "7", value: 7 },
            { id: "life-K", suit: "S", rank: "K", value: 13 },
            { id: "life-Joker", suit: "Joker", rank: "Joker", value: 20 },
          ],
          hand: [],
          field: [
            {
              unitId: "soldier-legacy-J",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c-J", suit: "S", rank: "J", value: 11 }], // Legacy card J
              labels: ["攻撃", "防御"],
            }
          ],
          fog: [],
          grave: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const targetUnit = state.players.p1.field[0];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: targetUnit,
      actions: rulePackage.actions, // 全アクション定義を渡す
    };

    // 場の J を墓地に移動する（これにより誘発イベントが発生）
    registry.execute("moveToGraveyard", { target: "target" }, context);

    // 検証：
    // 1. 場の J を含むユニットが墓地へ移動していること
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.some((u: any) => u.unitId === "soldier-legacy-J")).toBe(true);

    // 2. 世代交代が誘発して、ライフの [2, 7] が墓地へ、[K] が手札に入り、[Joker] がライフに残っていること
    expect(state.players.p1.hand.length).toBe(1);
    expect(state.players.p1.hand[0].rank).toBe("K");

    // 墓地にあるべきもの：
    // soldier-legacy-J ユニット ＋ ライフから墓地に落ちた 2枚のカードユニット (計3つのユニット)
    expect(state.players.p1.grave.length).toBe(3);
    const graveCards = state.players.p1.grave.flatMap((u: any) => u.cards);
    expect(graveCards.some((c: any) => c.rank === "2")).toBe(true);
    expect(graveCards.some((c: any) => c.rank === "7")).toBe(true);

    // ライフに残っているもの：
    expect(state.players.p1.life.length).toBe(1);
    expect(state.players.p1.life[0].rank).toBe("Joker");
  });

  it("should NOT trigger nextGeneration when a normal card (5) goes to grave (Test B)", () => {
    // モックシミュレーター状態
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-2", suit: "H", rank: "2", value: 2 },
            { id: "life-K", suit: "S", rank: "K", value: 13 },
          ],
          hand: [],
          field: [
            {
              unitId: "soldier-normal-5",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c-5", suit: "S", rank: "5", value: 5 }], // Normal card 5
              labels: ["攻撃", "防御"],
            }
          ],
          fog: [],
          grave: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const targetUnit = state.players.p1.field[0];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: targetUnit,
      actions: rulePackage.actions,
    };

    // 場の 5 を墓地に移動する
    registry.execute("moveToGraveyard", { target: "target" }, context);

    // 検証：
    // 1. ユニットは墓地へ行くが、世代交代は発生しないこと
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    
    // 2. ライフや手札に一切変化がないこと
    expect(state.players.p1.life.length).toBe(2);
    expect(state.players.p1.hand.length).toBe(0);
  });

  it("should trigger nextGeneration multiple times for each legacy card simultaneously (Test C)", () => {
    // モックシミュレーター状態
    // 1つのユニットに J と Q が含まれている場合
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-2", suit: "H", rank: "2", value: 2 },
            { id: "life-K", suit: "S", rank: "K", value: 13 },     // 1回目の誘発で手札へ
            { id: "life-7", suit: "D", rank: "7", value: 7 },
            { id: "life-Joker", suit: "Joker", rank: "Joker", value: 20 }, // 2回目の誘発で手札へ
          ],
          hand: [],
          field: [
            {
              unitId: "soldier-double-legacy",
              kind: "ユニット",
              componentId: "character.soldier",
              state: "charge",
              cards: [
                { id: "c-J", suit: "S", rank: "J", value: 11 },
                { id: "c-Q", suit: "D", rank: "Q", value: 12 },
              ],
              labels: ["攻撃", "防御"],
            }
          ],
          fog: [],
          grave: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const targetUnit = state.players.p1.field[0];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: targetUnit,
      actions: rulePackage.actions,
    };

    // 移動実行（J と Q の2枚分、2回誘発が走る）
    registry.execute("moveToGraveyard", { target: "target" }, context);

    // 検証：
    // J と Q で2回誘発が走るため：
    // - 1回目：[2] が墓地へ、[K] が手札へ。
    // - 2回目：[7] が墓地へ、[Joker] が手札へ。
    // 結果：手札には [K, Joker] の2枚、ライフは空。
    expect(state.players.p1.hand.length).toBe(2);
    expect(state.players.p1.hand.map((c: any) => c.rank)).toContain("K");
    expect(state.players.p1.hand.map((c: any) => c.rank)).toContain("Joker");

    expect(state.players.p1.life.length).toBe(0);
  });

  it("should empty life into grave when legacy card is not found in life (Test D)", () => {
    // モックシミュレーター状態
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-2", suit: "H", rank: "2", value: 2 },
            { id: "life-7", suit: "D", rank: "7", value: 7 },
            { id: "life-5", suit: "C", rank: "5", value: 5 }, // Joker,A,J,Q,K が1枚も存在しない
          ],
          hand: [],
          field: [
            {
              unitId: "soldier-legacy-A",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c-A", suit: "H", rank: "A", value: 1 }],
              labels: ["攻撃", "防御"],
            }
          ],
          fog: [],
          grave: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const targetUnit = state.players.p1.field[0];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: targetUnit,
      actions: rulePackage.actions,
    };

    // A が墓地に移動（誘発）
    registry.execute("moveToGraveyard", { target: "target" }, context);

    // 検証：
    // ライフは空になり、すべて墓地へと移動していること。手札は空であること。
    expect(state.players.p1.life.length).toBe(0);
    expect(state.players.p1.hand.length).toBe(0);

    const graveCards = state.players.p1.grave.flatMap((u: any) => u.cards);
    expect(graveCards.some((c: any) => c.rank === "2")).toBe(true);
    expect(graveCards.some((c: any) => c.rank === "7")).toBe(true);
    expect(graveCards.some((c: any) => c.rank === "5")).toBe(true);
  });
});
