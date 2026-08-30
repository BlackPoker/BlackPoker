import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { isCardInGameZones } from "../../engine/rules/cardUtils";
import { CostPayment } from "../../domain/decision/DecisionCatalog";


function createCostPayment(partial: Partial<CostPayment> & { summary?: string }): CostPayment {
  return {
    discardedCardIds: [],
    drivenBulwarkUnitIds: [],
    sacrificedUnitIds: [],
    lifeCount: 0,
    ...partial,
  };
}


describe("Key Card Lifecycle Comprehensive Tests (Phase 21B.8.2)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const createBaseState = () => {
    return {
      matchId: "test-key-lifecycle",
      stateVersion: 1,
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "l1-1", suit: "S", rank: "2", value: 2 },
            { id: "l1-2", suit: "S", rank: "3", value: 3 },
          ],
          hand: [],
          field: [],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l2-1", suit: "H", rank: "2", value: 2 },
            { id: "l2-2", suit: "H", rank: "3", value: 3 },
          ],
          hand: [],
          field: [],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    } as any;
  };

  it("1-5: Twist key lifecycle (hand -> request -> grave, no reuse, no double presence)", () => {
    const state = createBaseState();
    const twistKey = { id: "d6-uuid", suit: "D", rank: "6", value: 6 };
    const costCard = { id: "cost-c3", suit: "C", rank: "3", value: 3 }; // $D コスト用
    const dummyBulwark = {
      unitId: "bw-1",
      componentId: "character.bulwark",
      kind: "防壁",
      state: "charge",
      cards: [{ id: "c-bw", suit: "H", rank: "2", value: 2 }],
      labels: ["defense"],
    };

    state.players.p1.hand = [twistKey, costCard];
    state.players.p2.field = [dummyBulwark];

    const registry = new CommandRegistry();
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
    expect(twistAction).toBeDefined();

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: twistKey,
      targetComponent: dummyBulwark,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1: リクエスト作成時、keyCard は手札から消える (コスト card も消費される)
    const req = registry.createRequest(twistAction, context, {
      selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["cost-c3"], summary: "$D (c3 破棄)" }),
    });

    expect(state.players.p1.hand.find((c: any) => c.id === "d6-uuid")).toBeUndefined();
    expect(state.players.p1.hand.length).toBe(0);

    // 2: Stage 上の Request.keyCards に保持されている
    expect(req.keyCards).toBeDefined();
    expect(req.keyCards!.some((c) => c.id === "d6-uuid")).toBe(true);

    // 3: 解決前は grave にはない (cost-c3 はコストとして grave にあるが d6-uuid はまだない)
    expect(state.players.p1.grave.find((c: any) => c.id === "d6-uuid")).toBeUndefined();
    expect(state.players.p1.grave.some((g: any) => g.cards?.[0]?.id === "cost-c3")).toBe(true);

    // 4: 解決後は grave へ移る
    registry.resolveRequest(req, context);
    expect(state.players.p1.grave.some((c: any) => c.id === "d6-uuid")).toBe(true);
    expect(dummyBulwark.state).toBe("drive"); // ツイスト効果解決

    // 5: 手札にもう存在しないため、同じカードで2回目のツイストはリクエスト不可
    const context2: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: twistKey,
      targetComponent: dummyBulwark,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() =>
      registry.createRequest(twistAction, context2, {
        selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["cost-c3"], summary: "$D" }),
      })
    ).toThrow(); // コストも手札もないため失敗


    // 12: カードの二重存在がないこと
    expect(isCardInGameZones("d6-uuid", state)).toBe(true);
    expect(state.players.p1.hand.filter((c: any) => c.id === "d6-uuid").length).toBe(0);
    expect(state.players.p1.grave.filter((c: any) => c.id === "d6-uuid").length).toBe(1);
  });

  it("6: SummonSoldier key lifecycle (hand -> request -> field, NOT in grave)", () => {
    const state = createBaseState();
    const soldierKey = { id: "s5-uuid", suit: "S", rank: "5", value: 5 };
    const dummyBulwark = {
      unitId: "bw-cost",
      componentId: "character.bulwark",
      kind: "防壁",
      state: "charge",
      cards: [{ id: "c-bw-cost", suit: "H", rank: "4", value: 4 }],
      labels: ["defense"],
    };

    state.players.p1.hand = [soldierKey];
    state.players.p1.field = [dummyBulwark]; // $B 用
    state.players.p1.life = [{ id: "life-cost", suit: "S", rank: "2", value: 2 }]; // $L 用

    const registry = new CommandRegistry();
    const summonAction = rulePackage.actions.find((a) => a.id === "action.summonSoldier")!;
    expect(summonAction).toBeDefined();

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: soldierKey,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // リクエスト作成: hand から消える
    const req = registry.createRequest(summonAction, context, {
      selectedCostPayment: createCostPayment({
        lifeCount: 1,
        drivenBulwarkUnitIds: ["bw-cost"],
        summary: "$BL (防壁ドライブ+ライフ1)",
      }),
    });


    expect(state.players.p1.hand.length).toBe(0);
    expect(dummyBulwark.state).toBe("drive"); // 防壁ドライブ
    expect(state.players.p1.life.length).toBe(0); // ライフ消費

    // 解決: field に入り、grave には行かない
    registry.resolveRequest(req, context);
    expect(state.players.p1.field.some((u: any) => u.cards?.[0]?.id === "s5-uuid")).toBe(true);
    expect(state.players.p1.grave.find((c: any) => c.id === "s5-uuid")).toBeUndefined();
  });

  it("7: Up fog key lifecycle (hand -> request -> fog, NOT in grave)", () => {
    const state = createBaseState();
    const upKey = { id: "h3-uuid", suit: "H", rank: "3", value: 3 };
    const costCard = { id: "cost-c4", suit: "C", rank: "4", value: 4 };
    const targetSoldier = {
      unitId: "u-soldier",
      componentId: "character.soldier",
      kind: "一般兵",
      state: "charge",
      cards: [{ id: "c-sol", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
    };

    state.players.p1.hand = [upKey, costCard];
    state.players.p1.field = [targetSoldier];

    const registry = new CommandRegistry();
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    expect(upAction).toBeDefined();

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: upKey,
      targetComponent: targetSoldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // リクエスト作成: hand から消える
    const req = registry.createRequest(upAction, context, {
      selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["cost-c4"], summary: "$D" }),
    });
    expect(state.players.p1.hand.length).toBe(0);

    // 解決: fog に入り、grave には行かない
    registry.resolveRequest(req, context);
    expect(state.players.p1.fog.length).toBe(1);
    expect(state.players.p1.fog[0].card.id).toBe("h3-uuid");
    expect(state.players.p1.grave.find((c: any) => c.id === "h3-uuid")).toBeUndefined();
  });

  it("8: Down fog key lifecycle (size remaining >= 1: key -> fog)", () => {
    const state = createBaseState();
    const downKey = { id: "s2-uuid", suit: "S", rank: "2", value: 2 }; // spade
    const costCard = { id: "cost-c5", suit: "C", rank: "5", value: 5 };
    const targetSoldier = {
      unitId: "u-sol-8",
      componentId: "character.soldier",
      kind: "一般兵",
      state: "charge",
      cards: [{ id: "c-sol-8", suit: "S", rank: "8", value: 8 }], // size 8 - 2 = 6 >= 1
      labels: ["攻撃", "防御"],
    };

    state.players.p1.hand = [downKey, costCard];
    state.players.p2.field = [targetSoldier];
    state.chancePlayer = "p1"; // quick アクションのため chancePlayer 必要

    const registry = new CommandRegistry();
    const downAction = rulePackage.actions.find((a) => a.id === "action.down")!;
    expect(downAction).toBeDefined();

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: downKey,
      targetComponent: targetSoldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(downAction, context, {
      selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["cost-c5"], summary: "$D" }),
    });
    expect(state.players.p1.hand.length).toBe(0);

    registry.resolveRequest(req, context);
    expect(state.players.p1.fog.length).toBe(1);
    expect(state.players.p1.fog[0].card.id).toBe("s2-uuid");
    expect(state.players.p1.grave.find((c: any) => c.id === "s2-uuid")).toBeUndefined();
  });

  it("9: Down key lifecycle (size <= 0: soldier -> grave, key -> grave without fog)", () => {
    const state = createBaseState();
    const downKey = { id: "s10-uuid", suit: "S", rank: "10", value: 10 }; // spade 10
    const costCard = { id: "cost-c6", suit: "C", rank: "6", value: 6 };
    const targetSoldier = {
      unitId: "u-sol-3",
      componentId: "character.soldier",
      kind: "一般兵",
      state: "charge",
      cards: [{ id: "c-sol-3", suit: "S", rank: "3", value: 3 }], // size 3 - 10 <= 0 -> 兵士墓地
      labels: ["攻撃", "防御"],
    };

    state.players.p1.hand = [downKey, costCard];
    state.players.p2.field = [targetSoldier];
    state.chancePlayer = "p1";

    const registry = new CommandRegistry();
    const downAction = rulePackage.actions.find((a) => a.id === "action.down")!;

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: downKey,
      targetComponent: targetSoldier,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(downAction, context, {
      selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["cost-c6"], summary: "$D" }),
    });
    expect(state.players.p1.hand.length).toBe(0);

    registry.resolveRequest(req, context);
    // 兵士は墓地へ移動
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.some((u: any) => u.cards?.[0]?.id === "c-sol-3")).toBe(true);
    // Fog は生成されず、Down のキーカード (s10-uuid) は p1 の grave へ
    expect(state.players.p1.fog.length).toBe(0);
    expect(state.players.p1.grave.some((c: any) => c.id === "s10-uuid")).toBe(true);
  });

  it("10-11: Counter cancels target request, moving both target key and counter key to grave", () => {
    const state = createBaseState();
    const targetTwistKey = { id: "d8-uuid", suit: "D", rank: "8", value: 8 };
    const twistCostCard = { id: "twist-cost", suit: "S", rank: "3", value: 3 };
    const counterKey = { id: "c5-uuid", suit: "C", rank: "5", value: 5 };
    const counterCostCard = { id: "counter-cost", suit: "S", rank: "4", value: 4 };

    const dummyBulwark = {
      unitId: "bw-p1",
      componentId: "character.bulwark",
      kind: "防壁",
      state: "charge",
      cards: [{ id: "c-bw", suit: "H", rank: "2", value: 2 }],
      labels: ["防御"],
    };

    state.players.p1.hand = [targetTwistKey, twistCostCard];
    state.players.p2.hand = [counterKey, counterCostCard];
    state.players.p1.field = [dummyBulwark];
    state.chancePlayer = "p1"; // 1. p1 が Twist リクエスト

    const registry = new CommandRegistry();
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;

    // 1. Player A が Twist をリクエスト
    const twistContext: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: targetTwistKey,
      targetComponent: dummyBulwark,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const twistReq = registry.createRequest(twistAction, twistContext, {
      selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["twist-cost"], summary: "$D" }),
    });
    expect(state.stage.requests.length).toBe(1);
    expect(state.players.p1.hand.length).toBe(0);

    // 2. Player A が PASS し、Player B にチャンスが移る
    state.chancePlayer = "p2";

    // Player B が Twist に対して Counter をリクエスト
    const counterContext: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: twistReq,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    const counterReq = registry.createRequest(counterAction, counterContext, {
      selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["counter-cost"], summary: "$D" }),
    });

    expect(state.stage.requests.length).toBe(2);
    expect(state.players.p2.hand.length).toBe(0);

    // 3. Counter 解決 (Stage top: counterReq)
    const topReq = registry.resolveTopRequest({
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    });
    expect(topReq?.request.id).toBe(counterReq.id);

    // 10: Counter の効果により対象の twistReq は cancelled となり、twistKey は p1 の grave へ
    expect(twistReq.status).toBe("cancelled");
    expect(state.players.p1.grave.some((c: any) => c.id === "d8-uuid")).toBe(true);

    // 11: Counter 自身の key も解決完了により p2 の grave へ
    expect(state.players.p2.grave.some((c: any) => c.id === "c5-uuid")).toBe(true);

    // 4. キャンセルされた twistReq が Stage から解決される際も安全にスキップされ、二重墓地送り等にならない
    const nextTop = registry.resolveTopRequest({
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    });
    expect(nextTop?.request.id).toBe(twistReq.id);
    expect(state.players.p1.grave.filter((c: any) => c.id === "d8-uuid").length).toBe(1);
  });


});
