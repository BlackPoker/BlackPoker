import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TriggerProcessingCoordinator } from "../../engine/rules/TriggerProcessingCoordinator";
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
    const state: any = {
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
      }
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

    // 1. dispatchEvent 直後は未実行でバッファに積まれていること
    expect(state.requestBuffer?.requests?.length).toBe(1);
    expect(state.players.p1.hand.length).toBe(0);

    // 2. TriggerProcessingCoordinator で即時誘発アクションを解決
    const coordinator = new TriggerProcessingCoordinator();
    coordinator.processPendingTriggers(state, rulePackage, registry);

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
    const state: any = {
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
      }
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
    const state: any = {
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
      }
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

    // 1. dispatchEvent 直後は未実行でバッファに2件積まれていること
    expect(state.requestBuffer?.requests?.length).toBe(2);
    expect(state.players.p1.hand.length).toBe(0);

    // 2. TriggerProcessingCoordinator で即時誘発アクションを解決
    const coordinator = new TriggerProcessingCoordinator();
    coordinator.processPendingTriggers(state, rulePackage, registry);

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
    const state: any = {
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
      }
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

    // 1. dispatchEvent 直後は未実行でバッファに積まれていること
    expect(state.requestBuffer?.requests?.length).toBe(1);
    expect(state.players.p1.life.length).toBe(3);

    // 2. TriggerProcessingCoordinator で即時誘発アクションを解決
    const coordinator = new TriggerProcessingCoordinator();
    coordinator.processPendingTriggers(state, rulePackage, registry);

    // 検証：
    // ライフは空になり、すべて墓地へと移動していること。手札は空であること。
    expect(state.players.p1.life.length).toBe(0);
    expect(state.players.p1.hand.length).toBe(0);

    const graveCards = state.players.p1.grave.flatMap((u: any) => u.cards);
    expect(graveCards.some((c: any) => c.rank === "2")).toBe(true);
    expect(graveCards.some((c: any) => c.rank === "7")).toBe(true);
    expect(graveCards.some((c: any) => c.rank === "5")).toBe(true);
  });

  it("should trigger nextGeneration for defender (p2) when defender legacy blocker dies in damageJudge (Test E)", () => {
    const state: any = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "l1", suit: "H", rank: "5", value: 5 }],
          hand: [],
          field: [
            {
              unitId: "att-soldier-8",
              componentId: "character.soldier",
              state: "drive",
              cards: [{ id: "c-att-8", suit: "S", rank: "8", value: 8 }],
              labels: ["攻撃"],
              battle: { role: "attacker", targetPlayerKey: "p2" },
            },
          ],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l2-1", suit: "D", rank: "3", value: 3 },
            { id: "l2-2", suit: "C", rank: "4", value: 4 },
            { id: "l2-legacy", suit: "H", rank: "K", value: 13 },
          ],
          hand: [],
          field: [
            {
              unitId: "blk-soldier-J",
              componentId: "character.soldier",
              state: "drive",
              cards: [{ id: "c-blk-J", suit: "D", rank: "J", value: 11 }], // Legacy card J
              labels: ["防御"],
              battle: { role: "blocker", blocksUnitId: "att-soldier-8" },
            },
          ],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    };

    const registry = new CommandRegistry();
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // damageJudge の実行 (p1 アタッカー size 8 vs p2 ブロッカー size 11 -> p2 勝利、p1 死亡)
    // ここでは p1 が勝つケースをテストするため、p1 size 12 vs p2 size 11 にする
    state.players.p1.field[0].cards[0] = { id: "c-att-K", suit: "S", rank: "K", value: 13 }; // size 13 > 11
    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // p2 の J 兵士が死亡して墓地へ移動
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);

    // 防御側 (p2) の世代交代が誘発していること
    expect(state.requestBuffer.requests.length).toBe(1);
    const nextGenReq = state.requestBuffer.requests[0];
    expect(nextGenReq.actionId).toBe("action.nextGeneration");
    expect(nextGenReq.controller).toBe("p2");
    expect(nextGenReq.definitionOwner).toBe("p2");
  });

  it("should resolve nextGeneration for defender (p2) exclusively without affecting attacker (p1) (Test F)", () => {
    const state: any = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "l1-1", suit: "H", rank: "5", value: 5 },
            { id: "l1-2", suit: "S", rank: "6", value: 6 },
          ],
          hand: [],
          field: [
            {
              unitId: "att-soldier-K",
              componentId: "character.soldier",
              state: "drive",
              cards: [{ id: "c-att-K", suit: "S", rank: "K", value: 13 }],
              labels: ["攻撃"],
              battle: { role: "attacker", targetPlayerKey: "p2" },
            },
          ],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l2-1", suit: "D", rank: "2", value: 2 },
            { id: "l2-2", suit: "C", rank: "7", value: 7 },
            { id: "l2-legacy", suit: "H", rank: "Joker", value: 20 },
          ],
          hand: [],
          field: [
            {
              unitId: "blk-soldier-Q",
              componentId: "character.soldier",
              state: "drive",
              cards: [{ id: "c-blk-Q", suit: "D", rank: "Q", value: 12 }], // Legacy card Q (size 12 < 13)
              labels: ["防御"],
              battle: { role: "blocker", blocksUnitId: "att-soldier-K" },
            },
          ],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    };

    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // p2 の世代交代が誘発
    expect(state.requestBuffer.requests.length).toBe(1);

    // 即時解決
    coordinator.processPendingTriggers(state, rulePackage, registry);

    // p2 側のライフ・手札検証:
    // [2, 7] が墓地へ、[Joker] が手札へ
    expect(state.players.p2.hand.length).toBe(1);
    expect(state.players.p2.hand[0].rank).toBe("Joker");
    expect(state.players.p2.life.length).toBe(0);

    // p1 側は影響を受けないこと
    expect(state.players.p1.life.length).toBe(2);
    expect(state.players.p1.hand.length).toBe(0);
  });
});
