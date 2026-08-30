import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Counter Action integration Tests (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should create Up action request on stage as pending (A)", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [handCard, costCard],
          field: [
            {
              unitId: "soldier-1",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            }
          ],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(upAction, context);

    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0]).toBe(req);
    expect(req.status).toBe("pending");
    expect(state.players.p1.hand.length).toBe(0); // コストDとキーカードはリクエスト時に消費済み
  });


  it("should stack Counter action request on stage with reference (B)", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };
    const counterKey = { id: "counter-key", code: "♣8", suit: "C", rank: "8", value: 8 };
    const counterCostCard = { id: "counter-cost", code: "♣2", suit: "C", rank: "2", value: 2 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [handCard, costCard],
          field: [
            {
              unitId: "soldier-1",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            }
          ],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [counterKey, counterCostCard],
          field: [],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context1: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req1 = registry.createRequest(upAction, context1);

    const context2: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: req1,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req2 = registry.createRequest(counterAction, context2);

    expect(counterAction.request?.speed).toBe("normal");

    expect(state.stage.requests.length).toBe(2);
    expect(state.stage.requests[0]).toBe(req1);
    expect(state.stage.requests[1]).toBe(req2);
    expect(req2.targets).toBeDefined();
    expect(req2.targets![0].type).toBe("request");
    expect((req2.targets![0] as any).requestId).toBe(req1.id);
  });

  it("should change target request status to cancelled upon resolving counter (C)", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };
    const counterKey = { id: "counter-key", code: "♣8", suit: "C", rank: "8", value: 8 };
    const counterCostCard = { id: "counter-cost", code: "♣2", suit: "C", rank: "2", value: 2 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [handCard, costCard],
          field: [
            {
              unitId: "soldier-1",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            }
          ],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [counterKey, counterCostCard],
          field: [],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context1: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req1 = registry.createRequest(upAction, context1);

    const context2: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: req1,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req2 = registry.createRequest(counterAction, context2);

    // カウンターの解決
    registry.resolveTopRequest(context2);

    expect(req2.status).toBe("resolved");
    expect(req1.status).toBe("cancelled"); // 対象のアップが cancelled になる！
    expect(state.stage.requests.length).toBe(0); // req1 も req2 も Stage から即座に取り除かれていること
    expect(state.stage.history.length).toBe(2);
    expect(state.stage.history[0]).toBe(req1); // キャンセルされた req1 が先に history に入る
    expect(state.stage.history[1]).toBe(req2); // 解決された req2 が history に入る
  });

  it("should skip effect and cost of cancelled request (D, E)", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };
    const counterKey = { id: "counter-key", code: "♣8", suit: "C", rank: "8", value: 8 };
    const counterCostCard = { id: "counter-cost", code: "♣2", suit: "C", rank: "2", value: 2 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [handCard, costCard],
          field: [
            {
              unitId: "soldier-1",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            }
          ],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [counterKey, counterCostCard],
          field: [],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context1: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req1 = registry.createRequest(upAction, context1);

    const context2: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: req1,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req2 = registry.createRequest(counterAction, context2);


    // 1. カウンターを解決する
    registry.resolveTopRequest(context2);

    expect(req2.status).toBe("resolved");
    expect(req1.status).toBe("cancelled");
    expect(state.stage.requests.length).toBe(0); // req1 も req2 も Stage から即座に取り除かれていること
    expect(state.players.p2.hand.length).toBe(0); // カウンターの D コストは支払われる (E)
    expect(state.players.p1.hand.length).toBe(0); // リクエスト時にDコストとキーカードが消費される
    expect(state.players.p1.fog.length).toBe(0); // アップの効果であるフォグは生成されていないこと！ (D)
    expect(state.players.p1.grave.length).toBe(2); // アップのDコスト + キーカードが墓地へ

    // 2. Stage は空なので resolveTopRequest を呼んでも undefined となり安全
    const nextResolve = registry.resolveTopRequest(context1);
    expect(nextResolve).toBeUndefined();


  });

  it("should fail when targeting a non-existent request (F)", () => {
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const counterKey = { id: "counter-key", code: "♣8", suit: "C", rank: "8", value: 8 };
    const counterCostCard = { id: "counter-cost", code: "♣2", suit: "C", rank: "2", value: 2 };
    
    const state: any = {
      players: {
        p2: {
          name: "Player B",
          life: [],
          hand: [counterKey, counterCostCard],
          field: [],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: { id: "req-999", actionId: "action.up", status: "pending", keyCards: [{ id: "c", rank: "4" }] } as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 存在しないリクエストを対象にすると ValidationError になること
    expect(() => registry.createRequest(counterAction, context)).toThrow(
      "ターゲットリクエスト req-999 はステージ上に存在しません。"
    );
  });

  it("should fail when targeting a cancelled request (G)", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };
    const counterKey = { id: "counter-key", code: "♣8", suit: "C", rank: "8", value: 8 };
    const counterCostCard = { id: "counter-cost", code: "♣2", suit: "C", rank: "2", value: 2 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [handCard, costCard],
          field: [
            {
              unitId: "soldier-1",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            }
          ],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [counterKey, counterCostCard, { id: "extra-key", suit: "C", rank: "9", value: 9 }, { id: "extra-cost", suit: "D", rank: "3", value: 3 }],
          field: [],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context1: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req1 = registry.createRequest(upAction, context1);

    const context2: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: req1,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req2 = registry.createRequest(counterAction, context2);

    // カウンターを解決して req1 を cancelled にする
    registry.resolveTopRequest(context2);
    expect(req1.status).toBe("cancelled");

    // 既に cancelled になったリクエストを対象に別のカウンターを作ろうとすると ValidationError になること
    const context3: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: { id: "extra-key", suit: "C", rank: "9", value: 9 },
      targetRequest: req1, // すでに cancelled 状態
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    expect(() => registry.createRequest(counterAction, context3)).toThrow(
      "ターゲットリクエストのステータスが不適合です。期待: pending, 実際: cancelled"
    );
  });

  it("should fail when targeting a resolved request", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };
    const counterKey = { id: "counter-key", code: "♣8", suit: "C", rank: "8", value: 8 };
    const counterCostCard = { id: "counter-cost", code: "♣2", suit: "C", rank: "2", value: 2 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [handCard, costCard],
          field: [
            {
              unitId: "soldier-1",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            }
          ],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [counterKey, counterCostCard],
          field: [],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context1: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req1 = registry.createRequest(upAction, context1);

    // 1. 先にアップを解決する（正常解決されて resolved になる）
    registry.resolveTopRequest(context1);
    expect(req1.status).toBe("resolved");

    // 2. 既に resolved になったリクエストを対象にカウンターを作ろうとすると ValidationError になること
    const context2: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: req1, // すでに resolved 状態
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    expect(() => registry.createRequest(counterAction, context2)).toThrow(
      "ターゲットリクエストのステータスが不適合です。期待: pending, 実際: resolved"
    );
  });

  it("should fail when targeting counter request itself", () => {
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const counterKey = { id: "counter-key", code: "♣8", suit: "C", rank: "8", value: 8 };
    const counterCostCard = { id: "counter-cost", code: "♣2", suit: "C", rank: "2", value: 2 };
    
    const state: any = {
      players: {
        p2: {
          name: "Player B",
          life: [],
          hand: [counterKey, counterCostCard],
          field: [],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();

    // 解決コンテキストに自分自身 (currentRequest) と対象 (targetRequest = 自分自身) をバインドして検証
    const selfContext: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: { id: "req-1", actionId: "action.counter", status: "pending", keyCards: [counterKey] } as any,
      currentRequest: { id: "req-1", actionId: "action.counter", status: "pending", keyCards: [counterKey] } as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 自分自身を対象に解決しようとすると ValidationError になること
    expect(() => registry.validateAction(counterAction, selfContext)).toThrow(
      "自分自身のリクエストを対象にすることはできません。"
    );
  });


  it("should track resolved and cancelled requests in Stage.history and verify state", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };
    const counterKey = { id: "counter-key", code: "♣8", suit: "C", rank: "8", value: 8 };
    const counterCostCard = { id: "counter-cost", code: "♣2", suit: "C", rank: "2", value: 2 };

    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [handCard, costCard],
          field: [
            {
              unitId: "soldier-1",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            }
          ],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [counterKey, counterCostCard],
          field: [],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context1: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req1 = registry.createRequest(upAction, context1);

    const context2: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: req1,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req2 = registry.createRequest(counterAction, context2);


    // 1. カウンターを解決する (resolved)
    registry.resolveTopRequest(context2);

    expect(req2.status).toBe("resolved");
    expect(req1.status).toBe("cancelled");
    expect(state.stage.requests.length).toBe(0); // Stage は即時クリア
    expect(state.stage.history).toBeDefined();
    expect(state.stage.history.length).toBe(2);
    expect(state.stage.history[0]).toBe(req1); // キャンセルされたアップが先に history に記録
    expect(state.stage.history[1]).toBe(req2); // カウンター自身が history に記録

    // 2. キャンセルされたリクエストのコストとキーカードは墓地へ送られ、効果は未実行であることを検証
    expect(state.players.p1.hand.length).toBe(0); // リクエスト時に消費済み
    expect(state.players.p1.fog.length).toBe(0); // 効果（フォグ生成）は未実行
    expect(state.players.p1.grave.length).toBe(2); // アップのDコスト(1枚) + キーカード(1枚)
    expect(state.players.p2.grave.length).toBe(2); // カウンターのDコスト(1枚) + キーカード(1枚)

  });
});

