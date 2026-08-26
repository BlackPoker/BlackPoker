import { describe, it, expect, beforeAll } from "vitest";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { TurnManager } from "../../engine/rules/TurnManager";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { CostPayment } from "../../domain/decision/DecisionCatalog";
import * as path from "path";

const makeCostPayment = (summary: string, discardedCardIds: string[] = []): CostPayment => ({
  summary,
  discardedCardIds,
  drivenBulwarkUnitIds: [],
  sacrificedUnitIds: [],
  lifeCount: 0,
});

describe("Fog System Full E2E & Hardening Tests (Phase 21B.6.1)", () => {
  let rulePackage: RulePackage;
  const abilityEvaluator = new AbilityEvaluator();

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext/examples");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("1, 4: Up action moves key card from hand to fog, and card does NOT coexist in hand and fog", () => {
    const keyCard = { id: "c-up", suit: "H", rank: "3", value: 3 };
    const costCard = { id: "c-cost", suit: "D", rank: "5", value: 5 };
    const targetSoldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-base", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [targetSoldier], hand: [keyCard, costCard], grave: [], fog: [], life: [] },
        p2: { name: "Player B", field: [], hand: [], grave: [], fog: [], life: [] },
      },
      stage: { requests: [], history: [] },
    };

    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const emittedEvents: any[] = [];
    registry.onEvent((ev) => emittedEvents.push(ev));

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
      targetComponent: targetSoldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // コスト支払い ($D)
    registry.createRequest(upAction, context, {
      selectedCostPayment: makeCostPayment("手札破棄: ♢5", ["c-cost"]),
    });

    // リクエスト作成時点でコストカードは手札から破棄
    expect(state.players.p1.hand.some((c: any) => c.id === "c-cost")).toBe(false);
    expect(state.players.p1.grave.some((u: any) => u.cards?.some((c: any) => c.id === "c-cost"))).toBe(true);

    // アップ解決
    registry.resolveTopRequest(context);

    // 1. キーカードが hand から fog へ移動
    expect(state.players.p1.hand.some((c: any) => c.id === "c-up")).toBe(false);
    expect(state.players.p1.fog.length).toBe(1);
    expect(state.players.p1.fog[0].card.id).toBe("c-up");
    expect(state.players.p1.fog[0].bindings.amount).toBe(3);

    // 4. 同一カードが hand と fog に同時存在しない
    expect(state.players.p1.hand.length).toBe(0);

    // 5. サイズが 6 + 3 = 9 に増加
    const currentSize = abilityEvaluator.calculateUnitSize(targetSoldier, state);
    expect(currentSize).toBe(9);

    // cardMoved イベントの検証
    const cardMovedEvents = emittedEvents.filter((e) => e.type === "cardMoved" && e.payload?.toZone === "fog");
    expect(cardMovedEvents.length).toBe(1);
    expect(cardMovedEvents[0].payload.card.id).toBe("c-up");
  });

  it("2, 4, 11, 12: Down action with Spade A moves key card from hand to fog, and rankValue=1 is subtracted", () => {
    const keyCard = { id: "c-down-a", suit: "S", rank: "A", value: 1 };
    const costCard = { id: "c-cost", suit: "D", rank: "6", value: 6 };
    const targetSoldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-base", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [targetSoldier], hand: [keyCard, costCard], grave: [], fog: [], life: [] },
        p2: { name: "Player B", field: [], hand: [], grave: [], fog: [], life: [] },
      },
      stage: { requests: [], history: [] },
    };

    const downAction = rulePackage.actions.find((a) => a.id === "action.down")!;
    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
      targetComponent: targetSoldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 11. Spade A での Down リクエスト作成が合法
    expect(() => {
      registry.createRequest(downAction, context, {
        selectedCostPayment: makeCostPayment("手札破棄: ♢6", ["c-cost"]),
      });
    }).not.toThrow();

    registry.resolveTopRequest(context);

    // 2. キーカードが hand から fog へ移動
    expect(state.players.p1.hand.some((c: any) => c.id === "c-down-a")).toBe(false);
    expect(state.players.p1.fog.length).toBe(1);
    expect(state.players.p1.fog[0].card.id).toBe("c-down-a");

    // 12. rankValue = 1 として -1 減算され、サイズは 6 - 1 = 5
    expect(state.players.p1.fog[0].bindings.amount).toBe(-1);
    const currentSize = abilityEvaluator.calculateUnitSize(targetSoldier, state);
    expect(currentSize).toBe(5);
  });

  it("3: Down action when size <= 0 moves soldier to grave and does NOT create fog", () => {
    const keyCard = { id: "c-down-5", suit: "S", rank: "5", value: 5 };
    const costCard = { id: "c-cost", suit: "D", rank: "6", value: 6 };
    const targetSoldier: any = {
      unitId: "soldier-small",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-base", suit: "C", rank: "3", value: 3 }],
      labels: ["攻撃", "防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [], hand: [keyCard, costCard], grave: [], fog: [], life: [] },
        p2: { name: "Player B", field: [targetSoldier], hand: [], grave: [], fog: [], life: [] },
      },
      stage: { requests: [], history: [] },
    };

    const downAction = rulePackage.actions.find((a) => a.id === "action.down")!;
    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard,
      targetComponent: targetSoldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(downAction, context, {
      selectedCostPayment: makeCostPayment("手札破棄: ♢6", ["c-cost"]),
    });

    registry.resolveTopRequest(context);

    // 3. 兵士が墓地へ送られ、Fog は作成されない
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.some((u: any) => u.unitId === "soldier-small")).toBe(true);
    expect(state.players.p1.fog.length).toBe(0);
  });

  it("5, 6, 7, 8: Opponent-owned Fog & multi-player Fog modifier aggregation in DamageJudge & Direct Damage", () => {
    const soldierAtk: any = {
      unitId: "soldier-atk",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-atk", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };

    const soldierBlk: any = {
      unitId: "soldier-blk",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-blk", suit: "C", rank: "7", value: 7 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "soldier-atk" },
    };

    // Player A (p1) の soldierAtk (base 6) に:
    // - Player A の Up (+3) -> 9
    // - Player B の Down (-1) -> 8
    // 合計 current size = 8
    const fogUpByP1 = {
      fogId: "fog-up-1",
      componentId: "fog.up",
      card: { id: "c-up", suit: "H", rank: "3", value: 3 },
      bindings: { target: "soldier-atk", amount: 3 },
    };

    const fogDownByP2 = {
      fogId: "fog-down-1",
      componentId: "fog.down",
      card: { id: "c-down", suit: "S", rank: "A", value: 1 },
      bindings: { target: "soldier-atk", amount: -1 },
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [soldierAtk], hand: [], grave: [], fog: [fogUpByP1], life: [] },
        p2: { name: "Player B", field: [soldierBlk], hand: [], grave: [], fog: [fogDownByP2], life: [
          { id: "p2-l1", suit: "H", rank: "2", value: 2 },
          { id: "p2-l2", suit: "H", rank: "3", value: 3 },
        ] },
      },
      stage: { requests: [], history: [] },
    };

    // 5, 6. 双方の Fog が合算され、サイズは 6 + 3 - 1 = 8
    expect(abilityEvaluator.calculateUnitSize(soldierAtk, state)).toBe(8);
    expect(abilityEvaluator.calculateUnitSize(soldierBlk, state)).toBe(7);

    // Observation にも currentSize = 8 が反映されること
    const obs = ObservationFactory.createObservation(state, "p1");
    const p1FieldObs = obs.players.find((p) => p.playerId === "p1")!.field;
    expect(p1FieldObs[0].currentSize).toBe(8);

    // 7. DamageJudge 解決 (8 vs 7 -> アタッカー 8 生存、ブロッカー 7 墓地へ)
    const djAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const djContext: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    registry.createRequest(djAction, djContext);
    registry.resolveTopRequest(djContext);

    expect(state.players.p1.field.some((u: any) => u.unitId === "soldier-atk")).toBe(true);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.some((u: any) => u.unitId === "soldier-blk")).toBe(true);
  });

  it("9, 10: End action cleans up all players' fogs to their respective graves and restores sizes", () => {
    const targetSoldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-base", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const fogP1 = {
      fogId: "f-p1",
      componentId: "fog.up",
      card: { id: "c-up", suit: "H", rank: "3", value: 3 },
      bindings: { target: "soldier-1", amount: 3 },
    };

    const fogP2 = {
      fogId: "f-p2",
      componentId: "fog.down",
      card: { id: "c-down", suit: "S", rank: "2", value: 2 },
      bindings: { target: "soldier-1", amount: -2 },
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [targetSoldier], hand: [], grave: [], fog: [fogP1], life: [{ id: "l1", suit: "C", rank: "2", value: 2 }] },
        p2: { name: "Player B", field: [], hand: [], grave: [], fog: [fogP2], life: [{ id: "l2", suit: "C", rank: "3", value: 3 }] },
      },
      stage: { requests: [], history: [] },
    };

    // End 前のサイズ: 6 + 3 - 2 = 7
    expect(abilityEvaluator.calculateUnitSize(targetSoldier, state)).toBe(7);

    const endAction = rulePackage.actions.find((a) => a.id === "action.end")!;
    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    registry.createRequest(endAction, context);
    registry.resolveTopRequest(context);

    // 9. 両プレイヤーの Fog が空になり、各オーナーの墓地へ移動
    expect(state.players.p1.fog.length).toBe(0);
    expect(state.players.p2.fog.length).toBe(0);
    expect(state.players.p1.grave.some((u: any) => u.cards?.some((c: any) => c.id === "c-up"))).toBe(true);
    expect(state.players.p2.grave.some((u: any) => u.cards?.some((c: any) => c.id === "c-down"))).toBe(true);

    // 10. cleanup 後はサイズが printed base (6) へ復帰
    expect(abilityEvaluator.calculateUnitSize(targetSoldier, state)).toBe(6);
  });
});
