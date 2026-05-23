import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import * as path from "path";

describe("Twist Action Integration Tests (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should toggle charge soldier to drive state, verify cost D payment, unitStateChanged event and actSpeed/timing (A, C, D, G)", () => {
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
    
    // G. アクションの speed と timing をアサート
    expect(twistAction.request.speed).toBe("normal");
    expect(twistAction.request.timing).toBe("quick");

    const twistKeyCard = { id: "twist-key", code: "♢5", suit: "D", rank: "5", value: 5 }; // ♢A〜10
    const twistCostCard = { id: "twist-cost", code: "♣2", suit: "C", rank: "2", value: 2 }; // コストD

    const soldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [twistKeyCard, twistCostCard],
          field: [soldier],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    
    // イベント監視用のスパイフック
    const dispatchedEvents: any[] = [];
    const interpreter = registry["effectInterpreter"];
    const originalDispatchEvent = interpreter.dispatchEvent;
    interpreter.dispatchEvent = function (event: any, ctx: any) {
      dispatchedEvents.push(event);
      originalDispatchEvent.call(this, event, ctx);
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: twistKeyCard,
      targetComponent: soldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // リクエストの作成
    const req = registry.createRequest(twistAction, context);
    expect(state.stage.requests.length).toBe(1);
    expect(req.status).toBe("pending");

    // リクエストの解決 (C. コストD支払いの検証)
    registry.resolveTopRequest(context);
    expect(req.status).toBe("resolved");

    // コストD用カードが消費されたかチェック
    expect(state.players.p1.hand.length).toBe(1);
    expect(state.players.p1.hand[0]).toBe(twistKeyCard); // キーカードは残る
    expect(state.players.p1.grave.length).toBe(1); // コストカードが墓地へ

    // A. 状態が charge -> drive にトグルされたことをアサート
    expect(soldier.state).toBe("drive");

    // D. unitStateChanged イベントが正常に発行されたことをアサート
    expect(dispatchedEvents.length).toBeGreaterThan(0);
    const stateEvent = dispatchedEvents.find((e) => e.type === "unitStateChanged");
    expect(stateEvent).toBeDefined();
    expect(stateEvent.payload.unitId).toBe("soldier-1");
    expect(stateEvent.payload.fromState).toBe("charge");
    expect(stateEvent.payload.toState).toBe("drive");
  });

  it("should toggle drive soldier to charge state (B)", () => {
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
    const twistKeyCard = { id: "twist-key", code: "♢5", suit: "D", rank: "5", value: 5 };
    const twistCostCard = { id: "twist-cost", code: "♣2", suit: "C", rank: "2", value: 2 };

    const soldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive", // ドライブ状態！
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [twistKeyCard, twistCostCard],
          field: [soldier],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: twistKeyCard,
      targetComponent: soldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(twistAction, context);
    registry.resolveTopRequest(context);

    // B. ドライブ -> チャージ に切り替わったことをアサート
    expect(soldier.state).toBe("charge");
  });

  it("should fail when targeting a non-character component (E)", () => {
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
    const twistKeyCard = { id: "twist-key", code: "♢5", suit: "D", rank: "5", value: 5 };
    const twistCostCard = { id: "twist-cost", code: "♣2", suit: "C", rank: "2", value: 2 };

    // 非キャラクターである「フォグ」をターゲットにする
    const nonCharTarget = {
      fogId: "fog-1",
      componentId: "fog.up",
      state: "charge",
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [twistKeyCard, twistCostCard],
          field: [],
          grave: [],
          fog: [nonCharTarget],
        }
      }
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: twistKeyCard,
      targetComponent: nonCharTarget as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // E. 非キャラクター指定時に ValidationError になることをアサート
    expect(() => registry.createRequest(twistAction, context)).toThrow(
      "ターゲットがキャラクターではありません。"
    );
  });

  it("should fail when targeting unit with state other than charge or drive (F)", () => {
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
    const twistKeyCard = { id: "twist-key", code: "♢5", suit: "D", rank: "5", value: 5 };
    const twistCostCard = { id: "twist-cost", code: "♣2", suit: "C", rank: "2", value: 2 };

    const brokenSoldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "broken", // charge/drive 以外の無効な状態
      cards: [],
      labels: [],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [twistKeyCard, twistCostCard],
          field: [brokenSoldier],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: twistKeyCard,
      targetComponent: brokenSoldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // F. charge/drive 以外の状態で ValidationError / Error になることをアサート
    expect(() => registry.createRequest(twistAction, context)).toThrow(
      "ターゲットユニットの状態が不適合です。期待: charge または drive, 実際: broken"
    );
  });

  it("should allow targeting character.bulwark component as a character (H)", () => {
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
    const twistKeyCard = { id: "twist-key", code: "♢5", suit: "D", rank: "5", value: 5 };
    const twistCostCard = { id: "twist-cost", code: "♣2", suit: "C", rank: "2", value: 2 };

    const bulwark = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      cards: [],
      labels: [],
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [twistKeyCard, twistCostCard],
          field: [bulwark],
          grave: [],
          fog: [],
        }
      }
    };

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: twistKeyCard,
      targetComponent: bulwark,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // H. 防壁もキャラクター（character.bulwark）に含まれ、正常にツイスト対象にできること
    const req = registry.createRequest(twistAction, context);
    expect(req).toBeDefined();

    registry.resolveTopRequest(context);
    expect(bulwark.state).toBe("drive");
  });
});
