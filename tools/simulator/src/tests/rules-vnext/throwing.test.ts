import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { formatActionSummary } from "../../engine/rules/formatActionSummary";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Throwing Action Integration Test (New YAML)", () => {
  let rulePackage: RulePackage;
  let registry: CommandRegistry;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    registry = new CommandRegistry();
  });

  it("should load throwing action correctly", () => {
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing");
    expect(throwingAction).toBeDefined();
    expect(throwingAction?.name).toBe("投擲");
  });

  it("should format action summary for Throwing action correctly", () => {
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing")!;
    const summary = formatActionSummary(throwingAction);
    expect(summary).toBe("投擲 @直接-通常-メイン | ★♠A-K + ♣A-K | 対象: 対戦相手1人");
  });

  // テストA: ♠5 + ♣2 の投擲で、対象プレイヤーのライフが5枚墓地へ移る
  it("should deal 5 damage when using key cards ♠5 + ♣2", () => {
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing")!;

    const state = {
      players: {
        p1: { name: "Player A", hand: [], field: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          hand: [],
          field: [],
          grave: [],
          life: [
            { id: "c1", suit: "C", rank: "2", value: 2 },
            { id: "c2", suit: "C", rank: "3", value: 3 },
            { id: "c3", suit: "C", rank: "4", value: 4 },
            { id: "c4", suit: "C", rank: "5", value: 5 },
            { id: "c5", suit: "C", rank: "6", value: 6 },
            { id: "c6", suit: "C", rank: "7", value: 7 },
          ],
        }
      } as Record<string, any>
    };

    const keyCards = [
      { id: "key-spade-5", suit: "S", rank: "5", value: 5 },
      { id: "key-club-2", suit: "C", rank: "2", value: 2 },
    ];

    const effectCmd = throwingAction.effect?.find((e: any) => e.dealDamage);
    expect(effectCmd).toBeDefined();

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      keyCards,
      actions: rulePackage.actions,
    };

    // dealDamage を実行
    registry.execute("dealDamage", (effectCmd as any).dealDamage, context);

    // 検証：p2 のライフが 6枚 から 1枚 に減少し、墓地に 5枚 追加されていること
    expect(state.players.p2.life.length).toBe(1);
    expect(state.players.p2.life[0].rank).toBe("7");

    expect(state.players.p2.grave.length).toBe(5);
    expect(state.players.p2.grave[0].cards[0].rank).toBe("2");
    expect(state.players.p2.grave[4].cards[0].rank).toBe("6");
  });

  // テストB: ♠J + ♣3 の投擲で、11点ダメージになる
  it("should deal 11 damage when using key cards ♠J + ♣3", () => {
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing")!;

    const state = {
      players: {
        p1: { name: "Player A", hand: [], field: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          hand: [],
          field: [],
          grave: [],
          life: Array.from({ length: 15 }, (_, i) => ({
            id: `c-${i}`,
            suit: "C",
            rank: `${i + 1}`,
            value: i + 1,
          })),
        }
      } as Record<string, any>
    };

    const keyCards = [
      { id: "key-spade-J", suit: "S", rank: "J", value: 11 },
      { id: "key-club-3", suit: "C", rank: "3", value: 3 },
    ];

    const effectCmd = throwingAction.effect?.find((e: any) => e.dealDamage);

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      keyCards,
      actions: rulePackage.actions,
    };

    registry.execute("dealDamage", (effectCmd as any).dealDamage, context);

    // 検証：15枚から11枚削られて、残り4枚
    expect(state.players.p2.life.length).toBe(4);
    expect(state.players.p2.grave.length).toBe(11);
  });

  // テストC: キーカードに♠がない場合、投擲リクエストが validation error になる
  it("should throw validation error when no spade card is present in key cards", () => {
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing")!;

    const state = {
      players: {
        p1: { name: "Player A", hand: [], field: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          hand: [],
          field: [],
          grave: [],
          life: [
            { id: "c1", suit: "C", rank: "2", value: 2 },
          ],
        }
      } as Record<string, any>
    };

    const keyCards = [
      { id: "key-heart-5", suit: "H", rank: "5", value: 5 }, // ♠ はない
      { id: "key-club-2", suit: "C", rank: "2", value: 2 },
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      keyCards,
      actions: rulePackage.actions,
    };

    // 検証：バリデーションエラーが発生すること
    expect(() => registry.executeAction(throwingAction, context)).toThrow(ValidationError);
  });

  // テストD: ダメージによる移動（fromZone: life）では「世代交代」は誘発しない
  it("should NOT trigger nextGeneration even if a legacy card is moved to grave via dealDamage", () => {
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing")!;

    // プレイヤーB：手札 0枚、ライフの上から1枚目が J (Legacy Card)。
    // もし世代交代が誘発するなら、ライフからめくって手札追加が行われるはずだが、
    // ダメージによる移動のため、世代交代は誘発してはならない。
    const state = {
      players: {
        p1: { name: "Player A", hand: [], field: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          hand: [],
          field: [],
          grave: [],
          life: [
            { id: "c-heart-J", suit: "H", rank: "J", value: 11 }, // Legacy Card
            { id: "c-club-2", suit: "C", rank: "2", value: 2 },
            { id: "c-club-7", suit: "C", rank: "7", value: 7 },
          ],
        }
      } as Record<string, any>
    };

    const keyCards = [
      { id: "key-spade-A", suit: "S", rank: "A", value: 1 }, // 1ダメージ
      { id: "key-club-2", suit: "C", rank: "2", value: 2 },
    ];

    const effectCmd = throwingAction.effect?.find((e: any) => e.dealDamage);

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      keyCards,
      actions: rulePackage.actions, // 世代交代アクションも含む
    };

    registry.execute("dealDamage", (effectCmd as any).dealDamage, context);

    // 検証：
    // ダメージ移動は fromZone: life なので、世代交代（fromZone: field が条件）は一切誘発しない。
    // したがって、p2 のライフは 1枚削られて 2枚 残り、手札は 0枚 のままであること。
    expect(state.players.p2.life.length).toBe(2);
    expect(state.players.p2.life[0].rank).toBe("2");

    expect(state.players.p2.grave.length).toBe(1);
    expect(state.players.p2.grave[0].cards[0].rank).toBe("J");

    expect(state.players.p2.hand.length).toBe(0);
  });
});
