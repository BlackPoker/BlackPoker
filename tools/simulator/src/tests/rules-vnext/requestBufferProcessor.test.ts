import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { RulePackage, RequestBuffer } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Request Buffer Processor Integration Tests (Phase 14.5)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should move action.block from requestBuffer to stage with correct definitionOwner and controller (A)", () => {
    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      battle: { role: "attacker", targetPlayerKey: "p2" }
    };

    const state = {
      players: {
        p1: { name: "Player A", field: [soldier], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [], hand: [], grave: [], life: [] }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1. アタック解決イベントをディスパッチして block を誘発させる
    const event = {
      type: "actionResolved",
      payload: {
        actionId: "action.attack",
        playerKey: "p1"
      }
    };
    registry.dispatchEvent(event, context);

    const requestBuffer = state.requestBuffer as RequestBuffer;
    expect(requestBuffer).toBeDefined();
    expect(requestBuffer.requests.length).toBe(1);
    expect(requestBuffer.requests[0].actionId).toBe("action.block");
    // definitionOwner と controller の検証
    expect(requestBuffer.requests[0].definitionOwner).toBe("p1");
    expect(requestBuffer.requests[0].controller).toBe("p2");

    // 2. ステージへの移送を実行
    const actionReq = registry.moveNextBufferedRequestToStage(context);

    // 検証：
    expect(actionReq).toBeDefined();
    expect(actionReq!.actionId).toBe("action.block");
    expect(actionReq!.triggered).toBe(true);
    expect(actionReq!.source).toBe("requestBuffer");
    expect(actionReq!.definitionOwner).toBe("p1"); // 引き継ぎ確認
    expect(actionReq!.controller).toBe("p2");      // 引き継ぎ確認
    expect(actionReq!.status).toBe("pending");

    // バッファからは削除されている
    expect(requestBuffer.requests.length).toBe(0);
    // ステージに積まれている
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].id).toBe(actionReq!.id);
  });

  it("should move action.damageJudge from requestBuffer to stage (B)", () => {
    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      battle: { role: "attacker", targetPlayerKey: "p2" }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "drive",
      cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }],
      battle: { role: "blocker", blocksUnitId: "soldier-1" }
    };

    const state = {
      players: {
        p1: { name: "Player A", field: [soldier], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [bulwark], hand: [], grave: [], life: [] }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p2", // ブロックアクション解決した側
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1. ブロック解決イベントをディスパッチして damageJudge を誘発させる
    const event = {
      type: "actionResolved",
      payload: {
        actionId: "action.block",
        playerKey: "p2"
      }
    };
    registry.dispatchEvent(event, context);

    const requestBuffer = state.requestBuffer as RequestBuffer;
    expect(requestBuffer.requests.length).toBe(1);
    expect(requestBuffer.requests[0].actionId).toBe("action.damageJudge");
    expect(requestBuffer.requests[0].definitionOwner).toBe("p1");
    expect(requestBuffer.requests[0].controller).toBe("p1");

    // 2. ステージへの移送を実行
    const actionReq = registry.moveNextBufferedRequestToStage(context);

    // 検証：
    expect(actionReq).toBeDefined();
    expect(actionReq!.actionId).toBe("action.damageJudge");
    expect(actionReq!.definitionOwner).toBe("p1");
    expect(actionReq!.controller).toBe("p1");
    expect(state.stage.requests.length).toBe(1);
  });

  it("should return undefined safely when requestBuffer is empty (C)", () => {
    const state = {
      players: {
        p1: { name: "Player A", field: [], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [], hand: [], grave: [], life: [] }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const actionReq = registry.moveNextBufferedRequestToStage(context);
    expect(actionReq).toBeUndefined();
  });

  it("should record movedToStage status in requestBuffer.history (D)", () => {
    const state = {
      players: {
        p1: { name: "Player A", field: [], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [], hand: [], grave: [], life: [] }
      },
      stage: { requests: [] },
      requestBuffer: {
        requests: [
          {
            id: "req-trg-1",
            actionId: "action.block",
            controller: "p2",
            definitionOwner: "p1",
            keyCards: [],
            status: "pending",
            sequence: 1,
            action: rulePackage.actions.find((a) => a.id === "action.block")!
          }
        ],
        history: []
      }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const actionReq = registry.moveNextBufferedRequestToStage(context);
    expect(actionReq).toBeDefined();

    const requestBuffer = state.requestBuffer as RequestBuffer;
    expect(requestBuffer.history.length).toBe(1);
    expect(requestBuffer.history[0].status).toBe("movedToStage");
    expect(requestBuffer.history[0].actionId).toBe("action.block");
  });

  it("should NOT resolve automatically when moved to stage (E)", () => {
    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      battle: { role: "attacker", targetPlayerKey: "p2" }
    };

    // p2 のライフにカードを用意
    const state = {
      players: {
        p1: { name: "Player A", field: [soldier], hand: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          field: [],
          hand: [],
          grave: [],
          life: [{ id: "l1", suit: "H", rank: "7", value: 7 }]
        }
      },
      stage: { requests: [] },
      requestBuffer: {
        requests: [
          {
            id: "req-trg-1",
            actionId: "action.damageJudge",
            controller: "p1",
            definitionOwner: "p1",
            keyCards: [],
            status: "pending",
            sequence: 1,
            action: rulePackage.actions.find((a) => a.id === "action.damageJudge")!
          }
        ],
        history: []
      }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // ステージへ移動する
    const actionReq = registry.moveNextBufferedRequestToStage(context);
    expect(actionReq).toBeDefined();
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].status).toBe("pending");

    // 自動解決は行われないため、ライフダメージ等の解決効果は未実行
    expect(state.players.p2.life.length).toBe(1);
    expect(state.players.p2.grave.length).toBe(0);
  });

  it("should maintain nextGeneration prevention of double execution (F)", () => {
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
              cards: [{ id: "c-J", suit: "S", rank: "J", value: 11 }],
              labels: ["攻撃", "防御"],
            }
          ],
          fog: [],
          grave: [],
        }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    const targetUnit = state.players.p1.field[0];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: targetUnit,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 既存の即時解決を呼び出す
    registry.execute("moveToGraveyard", { target: "target" }, context);

    // 1回だけ解決され手札は [K]
    expect(state.players.p1.hand.length).toBe(1);
    expect(state.players.p1.hand[0].rank).toBe("K");
    // ライフには [Joker] が残る
    expect(state.players.p1.life.length).toBe(1);
    expect(state.players.p1.life[0].rank).toBe("Joker");

    // バッファには積まれているが未消費
    const requestBuffer = state.requestBuffer as RequestBuffer;
    expect(requestBuffer.requests.length).toBe(1);
    expect(requestBuffer.requests[0].actionId).toBe("action.nextGeneration");
  });

  it("should maintain cancelled request prevention of mis-triggers (G)", () => {
    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const state = {
      players: {
        p1: { name: "Player A", field: [soldier], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [], hand: [], grave: [], life: [] }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: soldier,
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(attackAction, context);
    req.status = "cancelled";

    registry.resolveTopRequest(context);
    expect(req.status).toBe("cancelled");

    // キャンセルされたため block は誘発せずバッファは空
    const requestBuffer = state.requestBuffer as RequestBuffer | undefined;
    expect(requestBuffer?.requests.length || 0).toBe(0);
  });

  it("should solve damageJudge and deal direct damage when blocker is absent (H)", () => {
    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      battle: { role: "attacker", targetPlayerKey: "p2" } // ブロッカーなし！
    };

    // p2 のライフにカードを用意
    const state = {
      players: {
        p1: { name: "Player A", field: [soldier], hand: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          field: [],
          hand: [],
          grave: [],
          life: [
            { id: "l1", suit: "H", rank: "7", value: 7 },
            { id: "l2", suit: "D", rank: "8", value: 8 },
          ]
        }
      },
      stage: { requests: [] },
      requestBuffer: {
        requests: [
          {
            id: "req-trg-1",
            actionId: "action.damageJudge",
            controller: "p1",
            definitionOwner: "p1",
            keyCards: [],
            status: "pending",
            sequence: 1,
            action: rulePackage.actions.find((a) => a.id === "action.damageJudge")!
          }
        ],
        history: []
      }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1. バッファからステージへ移動
    const actionReq = registry.moveNextBufferedRequestToStage(context);
    expect(actionReq).toBeDefined();

    // 2. ステージ上の damageJudge を手動で解決
    registry.resolveTopRequest(context);

    // 検証：
    // - ブロッカー不在で正常解決されること
    expect(actionReq!.status).toBe("resolved");
    // - 防御側（p2）にアタッカーのサイズ（6）分のダメージが入ること
    // ライフは2枚だったので、2枚すべて墓地へ移動する
    expect(state.players.p2.life.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(2);
    // - アタッカーの battle 状態がクリアされること
    expect(state.players.p1.field[0].battle).toBeUndefined();
  });
});
