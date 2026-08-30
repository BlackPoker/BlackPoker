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

  it("10: Counter LegalPattern generation & Lifecycle (♣5 Counter vs key 4 Request -> cancel success)", () => {
    const state = createBaseState();
    const targetTwistKey = { id: "d4-uuid", suit: "D", rank: "4", value: 4 };
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
    state.turnPlayer = "p1";
    state.chancePlayer = "p1";

    const session = new GameSession(state, rulePackage);

    // cardMoved イベントの追跡
    const cardMovedEvents: any[] = [];
    session.registry.onEvent((event: any) => {
      if (event.type === "cardMoved") {
        cardMovedEvents.push(event.payload);
      }
    });



    // 1. p1 が Twist をリクエスト
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") return;

    const twistPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );
    expect(twistPatternIdx).toBeGreaterThanOrEqual(0);

    const afterTwistReq = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistPatternIdx,
    });

    expect(state.stage.requests.length).toBe(1);
    expect(state.players.p1.hand.length).toBe(0); // Twist キーとコストが手札から消費

    // p1 が PASS -> チャンスが p2 へ
    expect(afterTwistReq.type).toBe("WAITING_FOR_DECISION");
    if (afterTwistReq.type !== "WAITING_FOR_DECISION") return;
    const p1PassIdx = afterTwistReq.request.patterns.findIndex((p) => p.kind === "PASS");
    const afterP1Pass = session.submitDecision({
      decisionId: afterTwistReq.request.decisionId,
      stateVersion: afterTwistReq.request.stateVersion,
      selectedPatternRef: p1PassIdx,
    });

    expect(state.chancePlayer).toBe("p2");
    expect(afterP1Pass.type).toBe("WAITING_FOR_DECISION");
    if (afterP1Pass.type !== "WAITING_FOR_DECISION") return;

    // 2. p2 の DecisionRequest で counter.yaml のキー (♣A〜10) から LegalPattern が生成されていることを確認
    const counterPatternIdx = afterP1Pass.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && afterP1Pass.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.counter"
    );
    expect(counterPatternIdx).toBeGreaterThanOrEqual(0);

    // p2 が Counter を提出 (キー: ♣5, コスト: counter-cost)
    const afterCounterReq = session.submitDecision({
      decisionId: afterP1Pass.request.decisionId,
      stateVersion: afterP1Pass.request.stateVersion,
      selectedPatternRef: counterPatternIdx,
    });

    expect(state.stage.requests.length).toBe(2);
    expect(state.players.p2.hand.length).toBe(0); // Counter キーとコストが手札から消費

    // 3. p2 PASS -> p1 PASS -> Counter 解決
    expect(afterCounterReq.type).toBe("WAITING_FOR_DECISION");
    if (afterCounterReq.type !== "WAITING_FOR_DECISION") return;
    const p2PassIdx = afterCounterReq.request.patterns.findIndex((p) => p.kind === "PASS");
    const afterP2Pass = session.submitDecision({
      decisionId: afterCounterReq.request.decisionId,
      stateVersion: afterCounterReq.request.stateVersion,
      selectedPatternRef: p2PassIdx,
    });


    expect(afterP2Pass.type).toBe("WAITING_FOR_DECISION");
    if (afterP2Pass.type !== "WAITING_FOR_DECISION") return;
    const p1FinalPassIdx = afterP2Pass.request.patterns.findIndex((p) => p.kind === "PASS");
    const afterCounterResolve = session.submitDecision({
      decisionId: afterP2Pass.request.decisionId,
      stateVersion: afterP2Pass.request.stateVersion,
      selectedPatternRef: p1FinalPassIdx,
    });

    // 4. Counter 解決直後の状態検証
    // Counter は解決完了して history へ移動
    const counterReq = state.stage.history.find((r: any) => r.actionId === "action.counter");
    expect(counterReq).toBeDefined();
    expect(counterReq.status).toBe("resolved");

    // Twist は cancel されて stage.requests 上に cancelled 状態で残る
    const stagedTwistReq = state.stage.requests.find((r: any) => r.actionId === "action.twist");
    expect(stagedTwistReq).toBeDefined();
    expect(stagedTwistReq.status).toBe("cancelled");

    // キーカードの墓地移動確認 (Twistキー, Counterキーともに墓地へ)
    expect(state.players.p1.grave.some((c: any) => c.id === "d4-uuid")).toBe(true);
    expect(state.players.p2.grave.some((c: any) => c.id === "c5-uuid")).toBe(true);

    // cardMoved (request -> grave) イベントが各1回だけ発行されていることを検証
    const twistKeyMoves = cardMovedEvents.filter(
      (e) => e.card?.id === "d4-uuid" && e.fromZone === "request" && e.toZone === "grave"
    );
    const counterKeyMoves = cardMovedEvents.filter(
      (e) => e.card?.id === "c5-uuid" && e.fromZone === "request" && e.toZone === "grave"
    );
    expect(twistKeyMoves.length).toBe(1);
    expect(counterKeyMoves.length).toBe(1);

    // 5. キャンセルされた Twist を Stage から解決 (再度 p1 PASS -> p2 PASS)
    expect(afterCounterResolve.type).toBe("WAITING_FOR_DECISION");
    if (afterCounterResolve.type !== "WAITING_FOR_DECISION") return;
    const p1Pass2Idx = afterCounterResolve.request.patterns.findIndex((p) => p.kind === "PASS");
    const afterP1Pass2 = session.submitDecision({
      decisionId: afterCounterResolve.request.decisionId,
      stateVersion: afterCounterResolve.request.stateVersion,
      selectedPatternRef: p1Pass2Idx,
    });

    expect(afterP1Pass2.type).toBe("WAITING_FOR_DECISION");
    if (afterP1Pass2.type !== "WAITING_FOR_DECISION") return;
    const p2Pass2Idx = afterP1Pass2.request.patterns.findIndex((p) => p.kind === "PASS");
    session.submitDecision({
      decisionId: afterP1Pass2.request.decisionId,
      stateVersion: afterP1Pass2.request.stateVersion,
      selectedPatternRef: p2Pass2Idx,
    });

    // Twist も history へ移動し、二重移動・二重イベントが発生しないことを検証
    const finalTwistReq = state.stage.history.find((r: any) => r.actionId === "action.twist");
    expect(finalTwistReq).toBeDefined();
    expect(finalTwistReq.status).toBe("cancelled");
    expect(state.stage.requests.length).toBe(0);

    const finalTwistKeyMoves = cardMovedEvents.filter(
      (e) => e.card?.id === "d4-uuid" && e.fromZone === "request" && e.toZone === "grave"
    );
    expect(finalTwistKeyMoves.length).toBe(1); // 二重発行なし
    expect(state.players.p1.grave.filter((c: any) => c.id === "d4-uuid").length).toBe(1); // 二重追加なし

  });

  it("11: Counter vs higher rank key (♣5 Counter vs key 6 Request -> cancel fails)", () => {
    const state = createBaseState();
    const targetTwistKey = { id: "d6-uuid", suit: "D", rank: "6", value: 6 }; // key 6
    const twistCostCard = { id: "twist-cost", suit: "S", rank: "3", value: 3 };
    const counterKey = { id: "c5-uuid", suit: "C", rank: "5", value: 5 }; // key 5 (5 < 6)
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
    state.chancePlayer = "p1";

    const registry = new CommandRegistry();
    const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;

    // 1. p1 が Twist リクエスト (key 6)
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

    // 2. p2 が Counter リクエスト (key 5)
    state.chancePlayer = "p2";
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

    // 3. Counter 解決 (Stage top: counterReq)
    registry.resolveTopRequest({
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    });

    // 5 < 6 なので Twist はキャンセルされず pending を維持する
    expect(twistReq.status).toBe("pending");
    expect(state.players.p1.grave.some((c: any) => c.id === "d6-uuid")).toBe(false);

    // Counter 自身のキーは解決完了により grave へ移動
    expect(state.players.p2.grave.some((c: any) => c.id === "c5-uuid")).toBe(true);

    // 4. Twist 解決 (未キャンセルなので正常に解決される)
    registry.resolveTopRequest({
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    });
    expect(twistReq.status).toBe("resolved");
    expect(dummyBulwark.state).toBe("drive");
    expect(state.players.p1.grave.some((c: any) => c.id === "d6-uuid")).toBe(true);
  });

  it("12: Counter vs 2-key request (♣5 Counter vs 2-key Request -> cancel success)", () => {
    const state = createBaseState();
    const keyCard1 = { id: "k1-uuid", suit: "S", rank: "9", value: 9 };
    const keyCard2 = { id: "k2-uuid", suit: "D", rank: "8", value: 8 };
    const counterKey = { id: "c5-uuid", suit: "C", rank: "5", value: 5 }; // key 5 (key 2枚なら数字無関係で無効化)
    const counterCostCard = { id: "counter-cost", suit: "S", rank: "4", value: 4 };

    state.players.p2.hand = [counterKey, counterCostCard];
    state.stage.requests = [
      {
        id: "two-key-req",
        actionId: "action.revolution",
        controller: "p1",
        status: "pending",
        keyCards: [keyCard1, keyCard2],
      },
    ];

    state.chancePlayer = "p2";
    const registry = new CommandRegistry();
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;

    const counterContext: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: state.stage.requests[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const counterReq = registry.createRequest(counterAction, counterContext, {
      selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["counter-cost"], summary: "$D" }),
    });

    // Counter 解決
    registry.resolveTopRequest({
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    });

    // 2-key request が無条件で cancelled になること
    const targetReq = state.stage.requests.find((r: any) => r.id === "two-key-req");
    expect(targetReq.status).toBe("cancelled");
    expect(state.players.p1.grave.some((c: any) => c.id === "k1-uuid")).toBe(true);
    expect(state.players.p1.grave.some((c: any) => c.id === "k2-uuid")).toBe(true);
    expect(state.players.p2.grave.some((c: any) => c.id === "c5-uuid")).toBe(true);
  });
});

