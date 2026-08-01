import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import * as path from "path";

describe("Stage and ActionRequest Model Integration Tests (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should create ActionRequest on stage with pending status and without cost payment", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡5", suit: "H", rank: "5", value: 5 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
          ],
          hand: [handCard],
          field: [],
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
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1. リクエストの作成
    const req = registry.createRequest(setAction, context);

    // 検証：リクエストがステージに積まれ、かつコストがまだ支払われていない（ライフが減っていない、墓地が空）
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0]).toBe(req);
    expect(req.status).toBe("pending");
    expect(req.cost).toBe("L");
    expect(state.players.p1.life.length).toBe(1); // ライフは減っていない！
    expect(state.players.p1.grave.length).toBe(0); // 墓地にも移動していない！
  });

  it("should generate sequential IDs and sequence numbers for reproducibility", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard1 = { id: "hand-card-1", code: "♡5", suit: "H", rank: "5", value: 5 };
    const handCard2 = { id: "hand-card-2", code: "♢6", suit: "D", rank: "6", value: 6 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
            { id: "life-2", suit: "S", rank: "3", value: 3 },
          ],
          hand: [handCard1, handCard2],
          field: [],
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
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const context2: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard2,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req1 = registry.createRequest(setAction, context1);
    const req2 = registry.createRequest(setAction, context2);

    // 検証：連番IDとシーケンスが再現性高く生成されていること
    expect(req1.id).toBe("req-1");
    expect(req1.sequence).toBe(1);
    expect(req2.id).toBe("req-2");
    expect(req2.sequence).toBe(2);
    expect(state.nextRequestSeq).toBe(2);
  });

  it("should pay cost and apply effects upon resolveTopRequest", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡5", suit: "H", rank: "5", value: 5 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
          ],
          hand: [handCard],
          field: [],
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
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(setAction, context);
    expect(req.status).toBe("pending");

    // 解決の実行
    registry.resolveTopRequest(context);

    // 検証：コストLが支払われてライフが減り、墓地へ移動し、防壁が召喚され、リクエスト状態が resolved になること
    expect(req.status).toBe("resolved");
    expect(state.stage.requests.length).toBe(0); // ステージから削除されていること
    expect(state.players.p1.life.length).toBe(0); // コスト消費
    expect(state.players.p1.field.length).toBe(1); // 防壁召喚
  });

  it("should resolve multiple requests in LIFO (stack) order", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard1 = { id: "hand-card-1", code: "♡5", suit: "H", rank: "5", value: 5 };
    const handCard2 = { id: "hand-card-2", code: "♢6", suit: "D", rank: "6", value: 6 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
            { id: "life-2", suit: "S", rank: "3", value: 3 },
          ],
          hand: [handCard1, handCard2],
          field: [],
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
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const context2: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard2,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // リクエストを2つ積む (req1 -> req2)
    const req1 = registry.createRequest(setAction, context1);
    const req2 = registry.createRequest(setAction, context2);

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

  it("should fail and update status to cancelled if canPay fails at resolution time (double-check)", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡5", suit: "H", rank: "5", value: 5 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
          ],
          hand: [handCard],
          field: [],
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
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1. 作成（この時はライフがあるので canPay は成功する）
    const req = registry.createRequest(setAction, context);
    expect(req.status).toBe("pending");

    // 2. 解決前に、割り込み効果などでライフが消失した状態をモック
    state.players.p1.life = [];

    // 3. 解決の実行（2重チェック canPay でエラーとなり、cancelled になること）
    expect(() => registry.resolveTopRequest(context)).toThrow(
      "解決時にコスト [L] を支払うリソースが不足しているため、解決できません。"
    );
    expect(req.status).toBe("cancelled");
  });

  it("should transparently resolve via executeAction (backward compatibility façade)", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡5", suit: "H", rank: "5", value: 5 };
    
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
          ],
          hand: [handCard],
          field: [],
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
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 後方互換 executeAction の呼び出し
    registry.executeAction(setAction, context);

    // 連続して解決されていることの検証
    expect(state.players.p1.life.length).toBe(0); // コスト消費
    expect(state.players.p1.field.length).toBe(1); // 防壁召喚
  });
});
