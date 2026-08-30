import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { PLAYTEST_SUPPORTED_ACTION_IDS, getCoreBattlePlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { GameSession } from "../../engine/session/GameSession";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { CostPayment } from "../../domain/decision/DecisionCatalog";
import { isCardInGameZones } from "../../engine/rules/cardUtils";

function createCostPayment(partial: Partial<CostPayment> & { summary?: string }): CostPayment {
  return {
    discardedCardIds: [],
    drivenBulwarkUnitIds: [],
    sacrificedUnitIds: [],
    lifeCount: 0,
    ...partial,
  };
}

function isCardInPlayerGrave(player: any, cardId: string): boolean {
  if (!Array.isArray(player?.grave)) return false;
  return player.grave.some(
    (g: any) => g?.id === cardId || (Array.isArray(g?.cards) && g.cards.some((c: any) => c?.id === cardId))
  );
}

describe("Phase 21B.8.2.1: Counter Playtest Visibility and Target Condition Tests", () => {
  let fullRulePackage: RulePackage;
  let playtestRulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
    playtestRulePackage = getCoreBattlePlaytestRulePackage(fullRulePackage);
  });

  function createBaseState(): any {
    return {
      protocolVersion: "2026-08-vnext",
      matchId: "match-counter-test",
      turn: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      passCount: 0,

      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "l1", suit: "S", rank: "A", value: 1 },
            { id: "l2", suit: "S", rank: "2", value: 2 },
          ],
          hand: [],
          field: [
            {
              unitId: "bw-p1",
              componentId: "character.bulwark",
              kind: "防壁",
              state: "charge",
              cards: [{ id: "c-bw", suit: "H", rank: "2", value: 2 }],
              labels: ["防御"],
            },
          ],
          grave: [],
          fog: [],
          mana: 0,
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l3", suit: "H", rank: "A", value: 1 },
            { id: "l4", suit: "H", rank: "2", value: 2 },
          ],
          hand: [],
          field: [],
          grave: [],
          fog: [],
          mana: 0,
        },
      },
      stage: {
        requests: [],
        history: [],
      },
      triggerBuffer: [],
    };
  }

  // --------------------------------------------------------------------------
  // A. RulePackageSelector で action.counter が Playtest RulePackage に含まれる
  // --------------------------------------------------------------------------
  it("A: RulePackageSelector includes action.counter in Playtest RulePackage", () => {
    expect(PLAYTEST_SUPPORTED_ACTION_IDS.has("action.counter")).toBe(true);

    const counterAction = playtestRulePackage.actions.find((a) => a.id === "action.counter");
    expect(counterAction).toBeDefined();
    expect(counterAction?.name).toBe("カウンター");
  });

  // --------------------------------------------------------------------------
  // B. Twist 等のキーカード1枚 Request が Stage にある状態で、
  //    ♣A〜10 + D 支払い可能なら Counter が候補に出る
  // --------------------------------------------------------------------------
  it("B: Counter pattern is generated in DecisionRequest when 1-key request is on Stage and conditions are met", () => {
    const state = createBaseState();
    const twistKey = { id: "d4-twist-key", suit: "D", rank: "4", value: 4 };
    const twistCost = { id: "twist-cost", suit: "S", rank: "3", value: 3 };
    const counterKey = { id: "c5-counter-key", suit: "C", rank: "5", value: 5 }; // ♣5
    const counterCost = { id: "counter-cost", suit: "S", rank: "4", value: 4 };

    state.players.p1.hand = [twistKey, twistCost];
    state.players.p2.hand = [counterKey, counterCost];
    state.turnPlayer = "p1";
    state.chancePlayer = "p1";

    const session = new GameSession(state, playtestRulePackage);

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

    // p1 が PASS -> チャンスが p2 へ
    expect(afterTwistReq.type).toBe("WAITING_FOR_DECISION");
    if (afterTwistReq.type !== "WAITING_FOR_DECISION") return;
    const p1PassIdx = afterTwistReq.request.patterns.findIndex((p) => p.kind === "PASS");
    const afterP1Pass = session.submitDecision({
      decisionId: afterTwistReq.request.decisionId,
      stateVersion: afterTwistReq.request.stateVersion,
      selectedPatternRef: p1PassIdx,
    });

    // 2. p2 の DecisionRequest に action.counter の LegalPattern が存在すること
    expect(state.chancePlayer).toBe("p2");
    expect(afterP1Pass.type).toBe("WAITING_FOR_DECISION");
    if (afterP1Pass.type !== "WAITING_FOR_DECISION") return;
    expect(afterP1Pass.request.playerId).toBe("p2");

    const counterPatternIdx = afterP1Pass.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && afterP1Pass.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.counter"
    );
    expect(counterPatternIdx).toBeGreaterThanOrEqual(0);

    const counterPattern = afterP1Pass.request.patterns[counterPatternIdx];
    const targetRef = afterP1Pass.request.catalog.targetSelections[counterPattern.targetSelectionRef!];
    expect(targetRef).toBeDefined();
    expect(targetRef.targetRequestId).toBe(state.stage.requests[0].id);
  });

  // --------------------------------------------------------------------------
  // C. 対象キーカード1枚: Counterの数字 >= 対象数字 → 無効化可能
  // --------------------------------------------------------------------------
  it("C: 1-key request: Counter rank >= target rank succeeds and cancels request", () => {
    const state = createBaseState();
    const targetKey = { id: "key-target-4", suit: "D", rank: "4", value: 4 };
    const counterKey = { id: "key-counter-8", suit: "C", rank: "8", value: 8 }; // 8 >= 4
    const counterCost = { id: "cost-c", suit: "S", rank: "2", value: 2 };

    const targetReq = {
      id: "req-twist",
      sequence: 1,
      actionId: "action.twist",
      controller: "p1",
      status: "pending",
      keyCards: [targetKey],
      targets: [{ type: "unit", unitId: "bw-p1" }],
    } as any;

    state.stage.requests = [targetReq];
    state.players.p2.hand = [counterKey, counterCost];
    state.chancePlayer = "p2";

    const registry = new CommandRegistry();
    const counterAction = playtestRulePackage.actions.find((a) => a.id === "action.counter")!;

    const counterContext: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: targetReq,
      actions: playtestRulePackage.actions,
      components: playtestRulePackage.components,
    };
    registry.createRequest(counterAction, counterContext, {
      selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["cost-c"], summary: "$D" }),
    });

    // Counter 解決
    registry.resolveTopRequest({
      state,
      playerKey: "p2",
      actions: playtestRulePackage.actions,
      components: playtestRulePackage.components,
    });

    // Twist は Stage から即時除去され cancelled で history へ
    expect(state.stage.requests.length).toBe(0);
    expect(state.stage.history.some((r: any) => r.id === "req-twist" && r.status === "cancelled")).toBe(true);
    expect(isCardInPlayerGrave(state.players.p1, "key-target-4")).toBe(true);
    expect(isCardInPlayerGrave(state.players.p2, "key-counter-8")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // D. 対象キーカード1枚: Counterの数字 < 対象数字 → 無効化されない
  // --------------------------------------------------------------------------
  it("D: 1-key request: Counter rank < target rank fails and keeps target request pending", () => {
    const state = createBaseState();
    const targetKey = { id: "key-target-7", suit: "D", rank: "7", value: 7 };
    const counterKey = { id: "key-counter-5", suit: "C", rank: "5", value: 5 }; // 5 < 7
    const counterCost = { id: "cost-c", suit: "S", rank: "2", value: 2 };

    const targetReq = {
      id: "req-twist",
      sequence: 1,
      actionId: "action.twist",
      controller: "p1",
      status: "pending",
      keyCards: [targetKey],
      targets: [{ type: "unit", unitId: "bw-p1" }],
    } as any;

    state.stage.requests = [targetReq];
    state.players.p2.hand = [counterKey, counterCost];
    state.chancePlayer = "p2";

    const registry = new CommandRegistry();
    const counterAction = playtestRulePackage.actions.find((a) => a.id === "action.counter")!;

    const counterContext: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: targetReq,
      actions: playtestRulePackage.actions,
      components: playtestRulePackage.components,
    };
    registry.createRequest(counterAction, counterContext, {
      selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["cost-c"], summary: "$D" }),
    });

    // Counter 解決
    registry.resolveTopRequest({
      state,
      playerKey: "p2",
      actions: playtestRulePackage.actions,
      components: playtestRulePackage.components,
    });

    // 5 < 7 なので targetReq は cancelled にならず Stage に残る
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].id).toBe("req-twist");
    expect(targetReq.status).toBe("pending");
    expect(isCardInPlayerGrave(state.players.p1, "key-target-7")).toBe(false);

    // Counter 自身のキーは墓地へ移動
    expect(isCardInPlayerGrave(state.players.p2, "key-counter-5")).toBe(true);

    // 後から targetReq は正常に解決可能
    registry.resolveTopRequest({
      state,
      playerKey: "p1",
      actions: playtestRulePackage.actions,
      components: playtestRulePackage.components,
    });
    expect(state.stage.requests.length).toBe(0);
    expect(targetReq.status).toBe("resolved");
    expect(isCardInPlayerGrave(state.players.p1, "key-target-7")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // E. 対象キーカード2枚 → 無条件でCounter可能
  // --------------------------------------------------------------------------
  it("E: 2-key request: Counter unconditionally cancels regardless of rank", () => {
    const state = createBaseState();
    const k1 = { id: "k1", suit: "S", rank: "K", value: 13 };
    const k2 = { id: "k2", suit: "D", rank: "Q", value: 12 };
    const counterKey = { id: "c-low-key", suit: "C", rank: "2", value: 2 }; // ♣2 で K+Q を無効化
    const counterCost = { id: "cost-c", suit: "S", rank: "3", value: 3 };

    const targetReq = {
      id: "req-rev",
      sequence: 1,
      actionId: "action.revolution",
      controller: "p1",
      status: "pending",
      keyCards: [k1, k2],
    } as any;

    state.stage.requests = [targetReq];
    state.players.p2.hand = [counterKey, counterCost];
    state.chancePlayer = "p2";

    const registry = new CommandRegistry();
    const counterAction = playtestRulePackage.actions.find((a) => a.id === "action.counter")!;

    const counterContext: CommandContext = {
      state,
      playerKey: "p2",
      keyCard: counterKey,
      targetRequest: targetReq,
      actions: playtestRulePackage.actions,
      components: playtestRulePackage.components,
    };
    registry.createRequest(counterAction, counterContext, {
      selectedCostPayment: createCostPayment({ lifeCount: 0, discardedCardIds: ["cost-c"], summary: "$D" }),
    });

    registry.resolveTopRequest({
      state,
      playerKey: "p2",
      actions: playtestRulePackage.actions,
      components: playtestRulePackage.components,
    });

    expect(state.stage.requests.length).toBe(0);
    expect(state.stage.history.some((r: any) => r.id === "req-rev" && r.status === "cancelled")).toBe(true);
    expect(isCardInPlayerGrave(state.players.p1, "k1")).toBe(true);
    expect(isCardInPlayerGrave(state.players.p1, "k2")).toBe(true);
    expect(isCardInPlayerGrave(state.players.p2, "c-low-key")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // F. 対象キーカード0枚 → CounterのTarget候補に出ない
  // G. Attack / End / Block / DamageJudge 等の 0-key Request だけが Stage にある場合、
  //    Counterの合法Patternが生成されない
  // --------------------------------------------------------------------------
  it("F & G: 0-key requests (Attack, End, Block, DamageJudge, Draw) are not target candidates and yield no Counter pattern", () => {
    const state = createBaseState();
    const counterKey = { id: "c5-key", suit: "C", rank: "5", value: 5 };
    const counterCost = { id: "cost-card", suit: "S", rank: "2", value: 2 };

    state.players.p2.hand = [counterKey, counterCost];
    state.chancePlayer = "p2";

    const zeroKeyRequests = [
      { id: "req-atk", sequence: 1, actionId: "action.attack", controller: "p1", status: "pending", keyCards: [] },
      { id: "req-end", sequence: 2, actionId: "action.end", controller: "p1", status: "pending" }, // keyCards未定義
      { id: "req-blk", sequence: 3, actionId: "action.block", controller: "p1", status: "pending", keyCards: [] },
      { id: "req-dmg", sequence: 4, actionId: "action.damageJudge", controller: "p1", status: "pending", keyCards: [] },
      { id: "req-drw", sequence: 5, actionId: "action.draw", controller: "p1", status: "pending", keyCards: [] },
    ] as any[];

    state.stage.requests = zeroKeyRequests;

    const counterAction = playtestRulePackage.actions.find((a) => a.id === "action.counter")!;

    // F: TargetSelectionEnumerator で 0-key Request が対象候補に出ないこと
    const candidates = TargetSelectionEnumerator.enumerateTargets(
      counterAction,
      state,
      "p2",
      playtestRulePackage.components
    );
    expect(candidates.length).toBe(0);

    // G: LegalPatternGenerator で action.counter の LegalPattern が生成されないこと
    const { request } = LegalPatternGenerator.generateActionRequestDecision(state, "p2", playtestRulePackage);
    const hasCounterPattern = request.patterns.some((p) => {
      if (p.kind !== "ACTION") return false;
      return p.actionSelectionRef !== undefined && request.catalog.actions[p.actionSelectionRef]?.actionId === "action.counter";
    });
    expect(hasCounterPattern).toBe(false);
  });

  // --------------------------------------------------------------------------
  // H & I: Lifecycle of Counter key, Target key, and Cost D
  // --------------------------------------------------------------------------
  it("H & I: Lifecycle of Counter key (hand->request->grave), Target key (request->grave), and Cost D (hand->grave)", () => {
    const state = createBaseState();
    const twistKey = { id: "d4-twist-key", suit: "D", rank: "4", value: 4 };
    const twistCost = { id: "twist-cost", suit: "S", rank: "3", value: 3 };
    const counterKey = { id: "c5-counter-key", suit: "C", rank: "5", value: 5 };
    const counterCost = { id: "counter-cost-d", suit: "S", rank: "4", value: 4 };

    state.players.p1.hand = [twistKey, twistCost];
    state.players.p2.hand = [counterKey, counterCost];
    state.turnPlayer = "p1";
    state.chancePlayer = "p1";

    const session = new GameSession(state, playtestRulePackage);

    const cardMovedEvents: any[] = [];
    session.registry.onEvent((event: any) => {
      if (event.type === "cardMoved") {
        cardMovedEvents.push(event.payload);
      }
    });

    // 1. p1 が Twist リクエスト
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") return;
    const twistPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );
    const afterTwistReq = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistPatternIdx,
    });

    // p1 PASS
    if (afterTwistReq.type !== "WAITING_FOR_DECISION") return;
    const p1PassIdx = afterTwistReq.request.patterns.findIndex((p) => p.kind === "PASS");
    const afterP1Pass = session.submitDecision({
      decisionId: afterTwistReq.request.decisionId,
      stateVersion: afterTwistReq.request.stateVersion,
      selectedPatternRef: p1PassIdx,
    });

    // 2. p2 が Counter リクエスト
    if (afterP1Pass.type !== "WAITING_FOR_DECISION") return;
    const counterPatternIdx = afterP1Pass.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && afterP1Pass.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.counter"
    );
    const afterCounterReq = session.submitDecision({
      decisionId: afterP1Pass.request.decisionId,
      stateVersion: afterP1Pass.request.stateVersion,
      selectedPatternRef: counterPatternIdx,
    });

    // 3. p2 PASS -> p1 PASS -> Counter 解決
    if (afterCounterReq.type !== "WAITING_FOR_DECISION") return;
    const p2PassIdx = afterCounterReq.request.patterns.findIndex((p) => p.kind === "PASS");
    const afterP2Pass = session.submitDecision({
      decisionId: afterCounterReq.request.decisionId,
      stateVersion: afterCounterReq.request.stateVersion,
      selectedPatternRef: p2PassIdx,
    });

    if (afterP2Pass.type !== "WAITING_FOR_DECISION") return;
    const p1FinalPassIdx = afterP2Pass.request.patterns.findIndex((p) => p.kind === "PASS");
    session.submitDecision({
      decisionId: afterP2Pass.request.decisionId,
      stateVersion: afterP2Pass.request.stateVersion,
      selectedPatternRef: p1FinalPassIdx,
    });

    // H: Counter key, Target key の二重存在なし・墓地移動確認
    expect(isCardInPlayerGrave(state.players.p1, "d4-twist-key")).toBe(true);
    expect(isCardInPlayerGrave(state.players.p2, "c5-counter-key")).toBe(true);

    // I: Counter の Cost D が墓地へ移動していること
    expect(isCardInPlayerGrave(state.players.p2, "counter-cost-d")).toBe(true);

    // イベントの発行回数検証（各カード 1 回ずつの移動）
    const targetKeyMoved = cardMovedEvents.filter(
      (e) => e.card?.id === "d4-twist-key" && e.fromZone === "request" && e.toZone === "grave"
    );
    const counterKeyMoved = cardMovedEvents.filter(
      (e) => e.card?.id === "c5-counter-key" && e.fromZone === "request" && e.toZone === "grave"
    );
    expect(targetKeyMoved.length).toBe(1);
    expect(counterKeyMoved.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 非表示条件の網羅（手札不足、キーなし、非チャンス）
  // --------------------------------------------------------------------------
  it("Negative: Counter does not appear when conditions are not met", () => {
    // 1. Stage が空の場合
    const stateEmpty = createBaseState();
    stateEmpty.players.p2.hand = [
      { id: "c5", suit: "C", rank: "5", value: 5 },
      { id: "cost", suit: "S", rank: "2", value: 2 },
    ];
    stateEmpty.chancePlayer = "p2";
    const resEmpty = LegalPatternGenerator.generateActionRequestDecision(stateEmpty, "p2", playtestRulePackage);
    expect(resEmpty.request.patterns.some((p: any) => p.actionSelectionRef !== undefined && resEmpty.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.counter")).toBe(false);

    // 2. ♣A〜10 のキーカードを持っていない場合（♥5 しかない）
    const stateNoKey = createBaseState();
    stateNoKey.stage.requests = [
      { id: "req1", sequence: 1, actionId: "action.twist", controller: "p1", status: "pending", keyCards: [{ id: "k1", rank: "4" }] } as any,
    ];
    stateNoKey.players.p2.hand = [
      { id: "h5", suit: "H", rank: "5", value: 5 },
      { id: "cost", suit: "S", rank: "2", value: 2 },
    ];
    stateNoKey.chancePlayer = "p2";
    const resNoKey = LegalPatternGenerator.generateActionRequestDecision(stateNoKey, "p2", playtestRulePackage);
    expect(resNoKey.request.patterns.some((p: any) => p.actionSelectionRef !== undefined && resNoKey.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.counter")).toBe(false);

    // 3. コスト D を支払えない場合（手札が ♣5 の 1 枚のみで余りカードなし）
    const stateNoCost = createBaseState();
    stateNoCost.stage.requests = [
      { id: "req1", sequence: 1, actionId: "action.twist", controller: "p1", status: "pending", keyCards: [{ id: "k1", rank: "4" }] } as any,
    ];
    stateNoCost.players.p2.hand = [
      { id: "c5", suit: "C", rank: "5", value: 5 },
    ];
    stateNoCost.chancePlayer = "p2";
    const resNoCost = LegalPatternGenerator.generateActionRequestDecision(stateNoCost, "p2", playtestRulePackage);
    expect(resNoCost.request.patterns.some((p: any) => p.actionSelectionRef !== undefined && resNoCost.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.counter")).toBe(false);
  });
});
