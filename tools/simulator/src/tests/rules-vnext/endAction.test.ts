import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import * as path from "path";

describe("End Action (action.end) and Fog Cleanup validation tests (Phase 13.1)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should allow turnPlayer and chancePlayer to request action.end when stage is empty (A)", () => {
    const endAction = rulePackage.actions.find((a) => a.id === "action.end")!;
    const state: any = {
      players: {
        p1: { name: "Player A", life: [], hand: [], field: [], fog: [] },
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    expect(() => registry.validateAction(endAction, context)).not.toThrow();
  });

  it("should throw ValidationError when requesting action.end if conditions are not met (H)", () => {
    const endAction = rulePackage.actions.find((a) => a.id === "action.end")!;
    const state: any = {
      players: {
        p1: { name: "Player A", life: [], hand: [], field: [], fog: [] },
        p2: { name: "Player B", life: [], hand: [], field: [], fog: [] },
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    // Case 1: Requester is not turnPlayer
    const contextP2: CommandContext = {
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.validateAction(endAction, contextP2)).toThrow(ValidationError);

    // Case 2: Requester is turnPlayer but not chancePlayer
    TurnManager.passChance(state);
    const contextNotChance: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.validateAction(endAction, contextNotChance)).toThrow(ValidationError);
  });

  it("should move all players' fogs to their respective graves, emit fogRemoved/cardMoved events, and not trigger nextGeneration even with Legacy Card (A, B, C, D, E, F, G)", () => {
    const endAction = rulePackage.actions.find((a) => a.id === "action.end")!;
    
    // Player A (p1) 用一般兵
    const soldierA = {
      unitId: "soldier-a",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    // Player B (p2) 用一般兵
    const soldierB = {
      unitId: "soldier-b",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c2", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
    };

    // Player A のアップフォグの構成カードは Legacy Card である Heart K とします。
    // もし誘発してしまえば、ライフ (Heart 2, Heart 7) からめくられるはずですが、誘発しないことを保証します。
    const upCard = { id: "up-card", suit: "H", rank: "K", value: 13 }; // Legacy Card
    const upFog = {
      fogId: "fog-up-1",
      componentId: "fog.up",
      card: upCard,
      bindings: { target: "soldier-a", amount: 7 }
    };

    // Player B のダウンフォグ (Spade 2 - normal card)
    const downCard = { id: "down-card", suit: "S", rank: "2", value: 2 };
    const downFog = {
      fogId: "fog-down-1",
      componentId: "fog.down",
      card: downCard,
      bindings: { target: "soldier-b", amount: -2 }
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "H", rank: "2", value: 2 },
            { id: "life-2", suit: "H", rank: "7", value: 7 },
            { id: "life-3", suit: "S", rank: "K", value: 13 }, // 誘発時のめくり用
          ],
          hand: [],
          field: [soldierA],
          trumps: [],
          fog: [upFog],
          grave: []
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [soldierB],
          trumps: [],
          fog: [downFog],
          grave: []
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // イベント検知用のスパイ配列
    const eventsDispatched: any[] = [];
    const interpreter = registry["effectInterpreter"];
    const originalDispatchEvent = interpreter.dispatchEvent;
    interpreter.dispatchEvent = function (event: any, ctx: any) {
      eventsDispatched.push(event);
      originalDispatchEvent.call(this, event, ctx);
    };

    // 適用前サイズチェック
    expect(registry.calculateUnitSize(soldierA, state.players.p1)).toBe(13); // 6 + 7
    expect(registry.calculateUnitSize(soldierB, state.players.p2)).toBe(3);  // 5 - 2

    // エンドアクションの解決
    registry.executeAction(endAction, context);

    // A: Player A の fog.up が Player A の grave へ移動すること
    const graveA = state.players.p1.grave;
    expect(graveA.length).toBe(1);
    expect(graveA[0].componentId).toBe("fog.up");
    expect(graveA[0].cards).toContain(upCard);

    // B: Player B の fog.down が Player B の grave へ移動すること
    const graveB = state.players.p2.grave;
    expect(graveB.length).toBe(1);
    expect(graveB[0].componentId).toBe("fog.down");
    expect(graveB[0].cards).toContain(downCard);

    // C: 両プレイヤーの fog 領域が空になること
    expect(state.players.p1.fog.length).toBe(0);
    expect(state.players.p2.fog.length).toBe(0);

    // D: サイズ修正が消えて元のサイズに戻ること
    expect(registry.calculateUnitSize(soldierA, state.players.p1)).toBe(6);
    expect(registry.calculateUnitSize(soldierB, state.players.p2)).toBe(5);

    // E: フォグ以外の一般兵などは除去されない
    expect(state.players.p1.field).toContain(soldierA);
    expect(state.players.p2.field).toContain(soldierB);

    // F: fogRemoved イベントに適切な属性が含まれる
    const fogRemovedEvents = eventsDispatched.filter((e) => e.type === "fogRemoved");
    expect(fogRemovedEvents.length).toBe(2);

    const eventA = fogRemovedEvents.find((e) => e.payload.playerKey === "p1");
    expect(eventA).toBeDefined();
    expect(eventA.payload.componentId).toBe("fog.up");
    expect(eventA.payload.card).toBe(upCard);
    expect(eventA.payload.fromZone).toBe("fog");
    expect(eventA.payload.toZone).toBe("grave");

    const eventB = fogRemovedEvents.find((e) => e.payload.playerKey === "p2");
    expect(eventB).toBeDefined();
    expect(eventB.payload.componentId).toBe("fog.down");
    expect(eventB.payload.card).toBe(downCard);
    expect(eventB.payload.fromZone).toBe("fog");
    expect(eventB.payload.toZone).toBe("grave");

    // G: cardMoved イベントも fromZone: "fog" から正常に発行されること
    const cardMovedEvents = eventsDispatched.filter((e) => e.type === "cardMoved" && e.payload.fromZone === "fog");
    expect(cardMovedEvents.length).toBe(2);

    // 補足検証: Legacy Card (Heart K) が墓地に落ちたが、移動元が field でなく fog なので、
    // 「世代交代」は誘発せず、ライフ枚数は3枚のままであること
    expect(state.players.p1.life.length).toBe(3);
    expect(state.players.p1.hand.length).toBe(0); // 誘発でめくれて手札に追加されたカードはない

    // ターン・チャンス・カウントの正常交代
    expect(state.turnPlayer).toBe("p2");
    expect(state.chancePlayer).toBe("p2");
    expect(state.turnCount).toBe(2);
  });
});
