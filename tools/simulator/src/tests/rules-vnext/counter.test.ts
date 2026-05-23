import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
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
    expect(state.players.p1.hand.length).toBe(2); // コストDは未払い
  });

  it("should stack Counter action request on stage with reference (B)", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };
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
          hand: [counterCostCard],
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
      targetRequest: req1,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req2 = registry.createRequest(counterAction, context2);

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
          hand: [counterCostCard],
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
      targetRequest: req1,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req2 = registry.createRequest(counterAction, context2);

    // カウンターの解決
    registry.resolveTopRequest(context2);

    expect(req2.status).toBe("resolved");
    expect(req1.status).toBe("cancelled"); // 対象のアップが cancelled になる！
  });

  it("should skip effect and cost of cancelled request (D, E)", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const handCard = { id: "hand-card", code: "♡7", suit: "H", rank: "7", value: 7 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };
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
          hand: [counterCostCard],
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
      targetRequest: req1,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req2 = registry.createRequest(counterAction, context2);

    // 1. カウンターを解決する
    registry.resolveTopRequest(context2);

    expect(req2.status).toBe("resolved");
    expect(state.players.p2.hand.length).toBe(0); // カウンターの D コストは支払われる (E)

    // 2. キャンセルされたアップを解決しようとする
    registry.resolveTopRequest(context1);

    expect(req1.status).toBe("cancelled"); // 変わらず cancelled のまま
    expect(state.players.p1.hand.length).toBe(2); // アップの D コスト（costCard）は支払われず、手札に残る！ (D)
    expect(state.players.p1.fog.length).toBe(0); // アップの効果であるフォグも生成されない！ (D)
  });

  it("should fail when targeting a non-existent request (F)", () => {
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    const counterCostCard = { id: "counter-cost", code: "♣2", suit: "C", rank: "2", value: 2 };
    
    const state: any = {
      players: {
        p2: {
          name: "Player B",
          life: [],
          hand: [counterCostCard],
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
      targetRequest: { id: "req-999", actionId: "action.up", status: "pending" } as any, // 存在しないモック
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
          hand: [counterCostCard, { id: "extra-hand", suit: "D", rank: "3", value: 3 }],
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
          hand: [counterCostCard],
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
    const counterCostCard = { id: "counter-cost", code: "♣2", suit: "C", rank: "2", value: 2 };
    
    const state: any = {
      players: {
        p2: {
          name: "Player B",
          life: [],
          hand: [counterCostCard],
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
      targetRequest: { id: "req-1", actionId: "action.counter", status: "pending" } as any, // 自分自身とみなす
      currentRequest: { id: "req-1", actionId: "action.counter", status: "pending" } as any, // 自分自身
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
          hand: [counterCostCard],
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
      targetRequest: req1,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const req2 = registry.createRequest(counterAction, context2);

    // 1. カウンターを解決する (resolved)
    registry.resolveTopRequest(context2);

    expect(req2.status).toBe("resolved");
    expect(state.stage.history).toBeDefined();
    expect(state.stage.history.length).toBe(1);
    expect(state.stage.history[0]).toBe(req2); // カウンター自身が history に残る

    // 2. キャンセルされたアップを解決しようとする (cancelled としてスキップ)
    registry.resolveTopRequest(context1);

    expect(req1.status).toBe("cancelled");
    expect(state.stage.history.length).toBe(2);
    expect(state.stage.history[1]).toBe(req1); // キャンセルされたアップも history に残る

    // 3. キャンセルされたリクエストのコストと効果が本当に実行されていないことをアサート
    expect(state.players.p1.hand.length).toBe(2); // 手札コスト未消費
    expect(state.players.p1.fog.length).toBe(0); // 効果（フォグ生成）未発生
    expect(state.players.p1.grave.length).toBe(0); // 墓地送りなし
  });
});
