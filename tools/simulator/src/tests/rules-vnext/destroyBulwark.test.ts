import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { formatActionSummary } from "../../engine/rules/formatActionSummary";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Destroy Bulwark Action Integration Test (New YAML)", () => {
  let rulePackage: RulePackage;
  let registry: CommandRegistry;
  let expressionEvaluator: ExpressionEvaluator;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    registry = new CommandRegistry();
    expressionEvaluator = new ExpressionEvaluator();
  });

  it("should load destroyBulwark action and bulwark component correctly", () => {
    const destroyAction = rulePackage.actions.find((a) => a.id === "action.destroyBulwark");
    const bulwarkComp = rulePackage.components.find((c) => c.id === "character.bulwark");

    expect(destroyAction).toBeDefined();
    expect(destroyAction?.name).toBe("防壁破壊");
    expect(bulwarkComp).toBeDefined();
    expect(bulwarkComp?.name).toBe("防壁");
  });

  it("should format action summary for Destroy Bulwark action correctly", () => {
    const destroyAction = rulePackage.actions.find((a) => a.id === "action.destroyBulwark")!;
    const summary = formatActionSummary(destroyAction);
    expect(summary).toBe("防壁破壊 @直接-通常-メイン | ★♡A-K + ♢A-K | 対象: 防壁1体");
  });

  // テストB: 一般兵は防壁破壊の対象条件を満たさない
  it("should evaluate target conditions correctly for bulwark and soldier", () => {
    const destroyAction = rulePackage.actions.find((a) => a.id === "action.destroyBulwark")!;
    const targetCond = destroyAction.targets![0].condition;

    const soldierUnit = {
      unitId: "soldier-1",
      componentId: "character.soldier",
    };

    const bulwarkUnit = {
      unitId: "bulwark-1",
      componentId: "character.bulwark",
    };

    // 一般兵は対象外 (false)
    expect(expressionEvaluator.evaluateTargetCondition(soldierUnit, targetCond)).toBe(false);
    // 防壁は対象内 (true)
    expect(expressionEvaluator.evaluateTargetCondition(bulwarkUnit, targetCond)).toBe(true);
  });

  // テストA: 防壁を対象にして防壁破壊を解決すると、防壁が墓地へ移動する
  it("should move bulwark to graveyard when destroyBulwark is resolved", () => {
    const destroyAction = rulePackage.actions.find((a) => a.id === "action.destroyBulwark")!;

    // モックシミュレーター状態
    const state = {
      players: {
        p1: {
          name: "Player A",
          hand: [],
          field: [
            {
              unitId: "bulwark-1",
              kind: "ユニット",
              componentId: "character.bulwark",
              face: "down",
              cards: [{ id: "c-diamond-A", suit: "D", rank: "A", value: 1 }],
              labels: ["防御"],
            }
          ],
          grave: [],
        }
      } as Record<string, any>
    };

    const targetUnit = state.players.p1.field[0];
    const effectCmd = destroyAction.effect?.find((e: any) => e.moveToGraveyard);
    expect(effectCmd).toBeDefined();

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: targetUnit,
      actions: rulePackage.actions,
    };

    // moveToGraveyard を実行
    registry.execute("moveToGraveyard", (effectCmd as any).moveToGraveyard, context);

    // 検証：フィールドから除外され、墓地へ移動していること
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.grave[0].unitId).toBe("bulwark-1");
  });

  // テストC: 防壁破壊で Legacy Card が墓地に移った場合、世代交代が誘発することを確認
  it("should trigger nextGeneration when bulwark with legacy card is destroyed", () => {
    // 世代交代アクションを有効にするため、モックに全アクション定義を登録します
    const destroyAction = rulePackage.actions.find((a) => a.id === "action.destroyBulwark")!;

    // プレイヤーAの状態：場に防壁があり、その構成カードが J (Legacy) である。
    // ライフには [ 2, 7, K, Joker ] が入っている。
    const state = {
      players: {
        p1: {
          name: "Player A",
          hand: [],
          field: [
            {
              unitId: "bulwark-1",
              kind: "ユニット",
              componentId: "character.bulwark",
              face: "down",
              cards: [{ id: "c-heart-J", suit: "H", rank: "J", value: 11 }], // J は Legacy Card
              labels: ["防御"],
            }
          ],
          grave: [],
          life: [
            { id: "c-club-2", suit: "C", rank: "2", value: 2 },
            { id: "c-club-7", suit: "C", rank: "7", value: 7 },
            { id: "c-heart-K", suit: "H", rank: "K", value: 13 }, // Legacy Card
            { id: "c-joker", suit: "X", rank: "Joker", value: 0 },
          ],
        }
      } as Record<string, any>
    };

    const targetUnit = state.players.p1.field[0];
    const effectCmd = destroyAction.effect?.find((e: any) => e.moveToGraveyard);

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: targetUnit,
      actions: rulePackage.actions, // アクション一覧を渡すことで EffectInterpreter が triggered アクションを発見可能
    };

    // moveToGraveyard を実行
    registry.execute("moveToGraveyard", (effectCmd as any).moveToGraveyard, context);

    // 検証：
    // J が墓地へ移ったため「世代交代」が誘発され、ライフがめくられる
    // ライフから 2, 7 がめくられ墓地（grave）へ送られる
    // K がめくられた段階で手札（hand）に加えられて終了する
    expect(state.players.p1.field.length).toBe(0);
    // 墓地（grave）には、破壊された防壁ユニット（カード J）と、めくられて墓地へ送られたカード 2枚（2, 7）が存在するはず
    expect(state.players.p1.grave.length).toBe(3);
    // 1番目は防壁、2番目と3番目はめくられたノーマルカード
    expect(state.players.p1.grave[0].unitId).toBe("bulwark-1");
    expect(state.players.p1.grave[1].cards[0].rank).toBe("2");
    expect(state.players.p1.grave[2].cards[0].rank).toBe("7");

    // 手札には Legacy Card である K が追加されているはず
    expect(state.players.p1.hand.length).toBe(1);
    expect(state.players.p1.hand[0].rank).toBe("K");

    // ライフには最後の Joker だけ残っているはず
    expect(state.players.p1.life.length).toBe(1);
    expect(state.players.p1.life[0].rank).toBe("Joker");
  });

  // テストC-2: 防壁破壊で Normal Card が墓地に移った場合は世代交代は誘発しない
  it("should NOT trigger nextGeneration when bulwark with normal card is destroyed", () => {
    const destroyAction = rulePackage.actions.find((a) => a.id === "action.destroyBulwark")!;

    // 構成カードが 6 (Normal Card) の防壁
    const state = {
      players: {
        p1: {
          name: "Player A",
          hand: [],
          field: [
            {
              unitId: "bulwark-1",
              kind: "ユニット",
              componentId: "character.bulwark",
              face: "down",
              cards: [{ id: "c-heart-6", suit: "H", rank: "6", value: 6 }], // 6 は Normal Card
              labels: ["防御"],
            }
          ],
          grave: [],
          life: [
            { id: "c-club-2", suit: "C", rank: "2", value: 2 },
            { id: "c-heart-K", suit: "H", rank: "K", value: 13 },
          ],
        }
      } as Record<string, any>
    };

    const targetUnit = state.players.p1.field[0];
    const effectCmd = destroyAction.effect?.find((e: any) => e.moveToGraveyard);

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: targetUnit,
      actions: rulePackage.actions,
    };

    // moveToGraveyard を実行
    registry.execute("moveToGraveyard", (effectCmd as any).moveToGraveyard, context);

    // 検証：
    // Normal Card なので「世代交代」は誘発しない
    // したがって墓地には防壁のみ、ライフや手札は初期状態のまま
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.grave[0].unitId).toBe("bulwark-1");

    expect(state.players.p1.hand.length).toBe(0);
    expect(state.players.p1.life.length).toBe(2);
  });
});
