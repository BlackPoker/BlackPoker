import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import { parseCost } from "../../engine/rules/CostParser";
import * as path from "path";

describe("Cost Payment Integration Tests (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should successfully validate and pay L cost for Set Bulwark action", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡5", suit: "H", rank: "5", value: 5 };
    
    const state = {
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

    // 1. 事前検証が正常に通ること
    expect(() => registry.validateAction(setAction, context)).not.toThrow();

    // 2. 実行による Lコスト消費（ライフ1枚 -> 墓地）の検証
    registry.executeAction(setAction, context);

    expect(state.players.p1.life.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.grave[0].kind).toBe("コスト");
    expect(state.players.p1.grave[0].cards[0].id).toBe("life-1");
  });

  it("should throw ValidationError when L cost cannot be paid (empty life)", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const handCard = { id: "hand-card", code: "♡5", suit: "H", rank: "5", value: 5 };
    
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [], // ライフが空！
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

    // ライフ不足のためバリデーションエラーになること
    expect(() => registry.executeAction(setAction, context)).toThrow(ValidationError);
    expect(() => registry.executeAction(setAction, context)).toThrow("コスト [L] を支払うことができません。");
  });

  it("should successfully validate and pay D cost for Up action", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const keyCard = { id: "key-card", suit: "H", rank: "7", value: 7 };
    const costCard = { id: "cost-card", suit: "S", rank: "2", value: 2 };
    
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [keyCard, costCard], // キーカード＋余剰カード（コストD用）
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
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1. 検証
    expect(() => registry.validateAction(upAction, context)).not.toThrow();

    // 2. 実行
    registry.executeAction(upAction, context);

    // 手札から cost-card が消費され、墓地へ送られていること
    // キーカードはフォグ領域へ
    expect(state.players.p1.hand.length).toBe(1); // キーカードは executeAction の中では自動消費されない（createFog自体がキーカードを消費しない仕様、手札に残る仕様になっているため。手札には keyCard のみが残るはず）
    expect(state.players.p1.hand[0].id).toBe("key-card");
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.grave[0].cards[0].id).toBe("cost-card");
  });

  it("should throw ValidationError when D cost cannot be paid (no extra card in hand)", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const keyCard = { id: "key-card", suit: "H", rank: "7", value: 7 };
    
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [keyCard], // キーカードのみで、余剰コストカードが無い！
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
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
      targetComponent: state.players.p1.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    expect(() => registry.executeAction(upAction, context)).toThrow(ValidationError);
  });

  it("should successfully validate and pay BL cost for Summon Soldier action (Bulwark drive + Life to grave)", () => {
    const summonAction = rulePackage.actions.find((a) => a.id === "action.summonSoldier")!;
    const keyCard = { id: "key-card", suit: "H", rank: "7", value: 7 };
    
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-card", suit: "C", rank: "2", value: 2 },
          ],
          hand: [keyCard],
          field: [
            {
              unitId: "bulwark-1",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "charge", // チャージ状態
              cards: [{ id: "bulwark-card", suit: "H", rank: "K", value: 13 }],
              labels: ["防御"],
            }
          ],
          grave: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1. 検証
    expect(() => registry.validateAction(summonAction, context)).not.toThrow();

    // 2. 実行
    registry.executeAction(summonAction, context);

    // 防壁がドライブ状態になり、ライフが墓地（grave）へ送られていること
    expect(state.players.p1.field[0].state).toBe("drive");
    expect(state.players.p1.life.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.grave[0].cards[0].id).toBe("life-card");
  });

  it("should throw ValidationError when BL cost cannot be paid (missing charge bulwark)", () => {
    const summonAction = rulePackage.actions.find((a) => a.id === "action.summonSoldier")!;
    const keyCard = { id: "key-card", suit: "H", rank: "7", value: 7 };
    
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-card", suit: "C", rank: "2", value: 2 },
          ],
          hand: [keyCard],
          field: [
            {
              unitId: "bulwark-1",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "drive", // すでにドライブ状態！
              cards: [{ id: "bulwark-card", suit: "H", rank: "K", value: 13 }],
              labels: ["防御"],
            }
          ],
          grave: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // チャージ防壁が無いので ValidationError になること
    expect(() => registry.executeAction(summonAction, context)).toThrow(ValidationError);
  });

  it("should successfully parse cost strings into normalized CostSymbol[]", () => {
    expect(parseCost("D")).toEqual(["D"]);
    expect(parseCost("L")).toEqual(["L"]);
    expect(parseCost("B")).toEqual(["B"]);
    expect(parseCost("BL")).toEqual(["B", "L"]);
    expect(parseCost("BBL")).toEqual(["B", "B", "L"]);
    expect(() => parseCost("X")).toThrow("未知のコストシンボルです: X");
  });

  it("should successfully validate and pay BBL cost (2 Bulwarks driven + 1 Life to grave)", () => {
    const bblAction = {
      id: "action.mockBBL",
      name: "モックBBLアクション",
      type: "direct",
      cost: "BBL",
      effect: []
    };
    
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-card", suit: "C", rank: "2", value: 2 },
          ],
          hand: [],
          field: [
            {
              unitId: "bulwark-1",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "charge",
              cards: [{ id: "bulwark-card-1", suit: "H", rank: "K", value: 13 }],
              labels: ["防御"],
            },
            {
              unitId: "bulwark-2",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "charge",
              cards: [{ id: "bulwark-card-2", suit: "D", rank: "K", value: 13 }],
              labels: ["防御"],
            }
          ],
          grave: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1. バリデーションがパスすること
    expect(() => registry.validateAction(bblAction as any, context)).not.toThrow();

    // 2. 実行
    registry.executeAction(bblAction as any, context);

    // 防壁2体がドライブ状態になり、ライフが墓地（grave）へ送られていること
    expect(state.players.p1.field[0].state).toBe("drive");
    expect(state.players.p1.field[1].state).toBe("drive");
    expect(state.players.p1.life.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.grave[0].cards[0].id).toBe("life-card");
  });

  it("should throw ValidationError when BBL cost cannot be paid (only 1 charge bulwark)", () => {
    const bblAction = {
      id: "action.mockBBL",
      name: "モックBBLアクション",
      type: "direct",
      cost: "BBL",
      effect: []
    };
    
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-card", suit: "C", rank: "2", value: 2 },
          ],
          hand: [],
          field: [
            {
              unitId: "bulwark-1",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "charge",
              cards: [{ id: "bulwark-card-1", suit: "H", rank: "K", value: 13 }],
              labels: ["防御"],
            },
            {
              unitId: "bulwark-2",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "drive", // すでにドライブ状態！
              cards: [{ id: "bulwark-card-2", suit: "D", rank: "K", value: 13 }],
              labels: ["防御"],
            }
          ],
          grave: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    expect(() => registry.executeAction(bblAction as any, context)).toThrow(ValidationError);
  });
});
