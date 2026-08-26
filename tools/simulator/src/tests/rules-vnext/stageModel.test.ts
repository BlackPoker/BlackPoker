import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Stage and ActionRequest Model Integration Tests (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should create ActionRequest on stage with pending status and paid cost upon request", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const handCard = { id: "hand-card", code: "♡5", suit: "H", rank: "5", value: 5 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };
    
    const targetUnit = {
      unitId: "unit-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [],
      labels: ["攻撃", "防御"],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
          ],
          hand: [handCard, costCard],
          field: [targetUnit],
          grave: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: targetUnit,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1. リクエストの作成
    const req = registry.createRequest(upAction, context);

    // 検証：リクエストがステージに積まれ、かつコストDはリクエスト時に消費済み (Rule 5.3)
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0]).toBe(req);
    expect(req.status).toBe("pending");
    expect(req.cost).toBe("D");
    expect(state.players.p1.hand.length).toBe(1); // costCard が消費された
    expect(state.players.p1.grave.length).toBe(1); // 墓地に送られた
  });

  it("should generate sequential IDs and sequence numbers for reproducibility", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const handCard1 = { id: "hand-card-1", code: "♡5", suit: "H", rank: "5", value: 5 };
    const handCard2 = { id: "hand-card-2", code: "♡6", suit: "H", rank: "6", value: 6 };
    const costCard1 = { id: "cost-1", code: "♠2", suit: "S", rank: "2", value: 2 };
    const costCard2 = { id: "cost-2", code: "♣3", suit: "C", rank: "3", value: 3 };

    const targetUnit = {
      unitId: "unit-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [],
      labels: ["攻撃", "防御"],
    };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
          ],
          hand: [handCard1, handCard2, costCard1, costCard2],
          field: [targetUnit],
          grave: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context1: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard1,
      targetComponent: targetUnit,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const context2: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard2,
      targetComponent: targetUnit,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req1 = registry.createRequest(upAction, context1);
    const req2 = registry.createRequest(upAction, context2);

    // 検証：連番IDとシーケンスが再現性高く生成されていること
    expect(req1.id).toBe("req-1");
    expect(req1.sequence).toBe(1);
    expect(req2.id).toBe("req-2");
    expect(req2.sequence).toBe(2);
    expect(state.nextRequestSeq).toBe(2);
  });

  it("should apply effects upon resolveTopRequest without double paying cost", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const handCard = { id: "hand-card", code: "♡5", suit: "H", rank: "5", value: 5 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };

    const targetUnit = {
      unitId: "unit-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [],
      labels: ["攻撃", "防御"],
    };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
          ],
          hand: [handCard, costCard],
          field: [targetUnit],
          grave: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: targetUnit,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(upAction, context);
    expect(req.status).toBe("pending");
    expect(state.players.p1.hand.length).toBe(1); // コスト消費済み

    // 解決の実行
    registry.resolveTopRequest(context);

    // 検証：リクエスト状態が resolved になり、フォグが生成され、キーカードが手札からフォグ領域へ移動
    expect(req.status).toBe("resolved");
    expect(state.stage.requests.length).toBe(0); // ステージから削除されていること
    expect(state.players.p1.hand.length).toBe(0); // keyCard は手札から fog 領域へ移動
    expect(state.players.p1.fog.length).toBe(1); // フォグ生成
  });

  it("should resolve multiple requests in LIFO (stack) order", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const handCard1 = { id: "hand-card-1", code: "♡5", suit: "H", rank: "5", value: 5 };
    const handCard2 = { id: "hand-card-2", code: "♡6", suit: "H", rank: "6", value: 6 };
    const costCard1 = { id: "cost-1", code: "♠2", suit: "S", rank: "2", value: 2 };
    const costCard2 = { id: "cost-2", code: "♣3", suit: "C", rank: "3", value: 3 };

    const targetUnit = {
      unitId: "unit-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [],
      labels: ["攻撃", "防御"],
    };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
          ],
          hand: [handCard1, handCard2, costCard1, costCard2],
          field: [targetUnit],
          grave: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context1: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard1,
      targetComponent: targetUnit,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const context2: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard2,
      targetComponent: targetUnit,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // リクエストを2つ積む (req1 -> req2)
    const req1 = registry.createRequest(upAction, context1);
    const req2 = registry.createRequest(upAction, context2);

    expect(state.stage.requests.length).toBe(2);

    // 解決を実行 (LIFO なので、後から積まれた req2 が先に解決されるはず)
    registry.resolveTopRequest(context2);

    expect(req2.status).toBe("resolved");
    expect(req1.status).toBe("pending"); // req1 はまだ未解決！
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0]).toBe(req1);

    // さらにもう一度解決を実行 (残った req1 が解決されるはず)
    registry.resolveTopRequest(context1);

    expect(req1.status).toBe("resolved");
    expect(state.stage.requests.length).toBe(0);
  });

  it("should fail to createRequest if cost cannot be paid (Rule 5.3)", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const handCard = { id: "hand-card", code: "♡5", suit: "H", rank: "5", value: 5 };

    const targetUnit = {
      unitId: "unit-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [],
      labels: ["攻撃", "防御"],
    };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [handCard], // コストD用の手札カードがない（手札1枚のみでkeyCardとして指定）
          field: [targetUnit],
          grave: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: targetUnit,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // コスト D を支払えないため createRequest 時点でエラーとなり、リクエストは作成されない
    expect(() => registry.createRequest(upAction, context)).toThrow(
      "コスト [D] を支払うことができません。"
    );
  });

  it("should transparently resolve via executeAction (backward compatibility façade)", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const handCard = { id: "hand-card", code: "♡5", suit: "H", rank: "5", value: 5 };
    const costCard = { id: "cost-card", code: "♠2", suit: "S", rank: "2", value: 2 };

    const targetUnit = {
      unitId: "unit-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [],
      labels: ["攻撃", "防御"],
    };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [handCard, costCard],
          field: [targetUnit],
          grave: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      targetComponent: targetUnit,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 後方互換 executeAction の呼び出し
    registry.executeAction(upAction, context);

    // 連続して解決されていることの検証
    expect(state.players.p1.fog.length).toBe(1); // フォグ生成
  });
});
