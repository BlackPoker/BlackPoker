import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { formatActionSummary } from "../../engine/rules/formatActionSummary";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Set Bulwark Action Integration Test (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should load setBulwark action and bulwark component correctly", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark");
    const bulwarkComponent = rulePackage.components.find((c) => c.id === "character.bulwark");

    expect(setAction).toBeDefined();
    expect(setAction?.name).toBe("防壁設置");
    expect(bulwarkComponent).toBeDefined();
    expect(bulwarkComponent?.name).toBe("防壁");
  });

  it("should format action summary for Set Bulwark action correctly without lonely star", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const summary = formatActionSummary(setAction);
    expect(summary).toBe("防壁設置 @直接-即時-メイン | $L");
  });

  it("should summon bulwark unit face-down and consume hand card via CommandRegistry (Case A & B)", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    
    // モックシミュレーター状態
    const handCard = { id: "h5-uuid", code: "♡5", suit: "H", rank: "5", value: 5 };
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "life-1", suit: "S", rank: "2", value: 2 }], // 配列としてのライフ
          hand: [handCard], // 手札にカードを持つ
          field: [],
          fog: [],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();

    // summonUnit 命令の抽出
    const effectCmd = setAction.effect?.find((e: any) => e.summonUnit);
    expect(effectCmd).toBeDefined();

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: handCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // アクションの事前検証
    expect(() => registry.validateAction(setAction, context)).not.toThrow();

    // アクション全体の実行 (事前検証 -> コマンド実行)
    registry.executeAction(setAction, context);

    // 検証：手札からカードが消費されたこと
    expect(state.players.p1.hand.length).toBe(0);

    // 検証：コストLによりライフが消費されたこと
    expect(state.players.p1.life.length).toBe(0);

    // 検証：場に防壁が裏向き・チャージ状態で召喚されたこと
    expect(state.players.p1.field.length).toBe(1);
    const summonedBulwark = state.players.p1.field[0];
    expect(summonedBulwark.kind).toBe("防壁");
    expect(summonedBulwark.componentId).toBe("character.bulwark");
    expect(summonedBulwark.state).toBe("charge"); // チャージ状態
    expect(summonedBulwark.face).toBe("down"); // 裏向き
    expect(summonedBulwark.cards.length).toBe(1);
    expect(summonedBulwark.cards[0].id).toBe("h5-uuid");
  });

  it("should dynamically satisfy Fortress preventDamage condition after installing Bulwark (Case C)", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing")!;

    // モックシミュレーター状態: Player B (防御側) は最初場にキャラクターを持たないが、手札に防壁用カードと要塞を持つ
    const state = {
      players: {
        p1: {
          name: "Player A (攻撃側)",
          hand: [],
          field: [],
          grave: [],
          life: [],
        },
        p2: {
          name: "Player B (防御側)",
          hand: [{ id: "c-diamond-6", suit: "D", rank: "6", value: 6 }], // 手札に防壁設置用カード
          field: [], // 初期状態はキャラクターが場にいない！
          grave: [],
          trumps: [
            {
              unitId: "fortress-1",
              componentId: "trump.fortress",
              face: "up",
              cards: [{ id: "c-club-9", suit: "C", rank: "9", value: 9 }],
            }
          ],
          life: [
            { id: "c1", suit: "C", rank: "2", value: 2 },
            { id: "c2", suit: "C", rank: "3", value: 3 },
            { id: "c3", suit: "C", rank: "4", value: 4 },
          ],
        }
      } as Record<string, any>
    };

    const registry = new CommandRegistry();

    // 1. 防壁が無い状態での投擲ダメージ検証 (要塞が防がないためダメージが通る)
    const keyCardsSpade = [
      { id: "key-spade-5", suit: "S", rank: "5", value: 5 },
      { id: "key-club-2", suit: "C", rank: "2", value: 2 },
    ];

    const contextPre: CommandContext = {
      state,
      playerKey: "p1", // Aが発動
      targetPlayerKey: "p2", // Bが対象
      keyCards: keyCardsSpade,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 投擲実行
    registry.executeAction(throwingAction, contextPre);

    // 検証：キャラクターがいないため防ぎきれず、Bのライフが 2 減る (ライフ残り 2枚 -> 0枚)
    expect(state.players.p2.life.length).toBe(0);

    // 2. ライフを回復し、Player B が「防壁設置」を実行
    state.players.p2.life = [
      { id: "c1", suit: "C", rank: "2", value: 2 },
      { id: "c2", suit: "C", rank: "3", value: 3 },
      { id: "c3", suit: "C", rank: "4", value: 4 },
    ];
    const bulwarkKeyCard = state.players.p2.hand[0];

    const contextSetBulwark: CommandContext = {
      state,
      playerKey: "p2", // Bが防壁を設置
      keyCard: bulwarkKeyCard,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 防壁設置実行
    registry.executeAction(setAction, contextSetBulwark);

    // 検証：場に防壁（キャラクター）が誕生していること
    expect(state.players.p2.field.length).toBe(1);
    expect(state.players.p2.field[0].kind).toBe("防壁");

    // 3. 防壁がある状態で、再度相手が投擲を発動
    const contextPost: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      keyCards: keyCardsSpade,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 再度投擲実行
    registry.executeAction(throwingAction, contextPost);

    // 検証：防壁（キャラクター）が場に存在するため、要塞がダメージを無効化！ライフは2のまま維持される
    expect(state.players.p2.life.length).toBe(2);
  });
});
