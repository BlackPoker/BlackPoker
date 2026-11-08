import { describe, it, expect, beforeAll } from "vitest";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import {
  GenericTacticalEvaluator,
  CoreAlignedExpressionEvaluator,
} from "../../engine/rules/GenericTacticalEvaluator";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { RequestView } from "../../domain/decision/PlayerObservation";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

/**
 * テスト用の初期ライフ配列を生成
 */
function createLifeCards(playerPrefix: string, count: number) {
  return Array.from({ length: count }, (_, idx) => ({
    id: `card-${playerPrefix}-life-${idx + 1}`,
    suit: "H",
    rank: String(((idx % 10) + 1) === 1 ? "A" : (idx % 10) + 1),
    value: (idx % 10) + 1,
  }));
}

/**
 * Core の墓地配列から実際に移動した物理カード枚数を集計
 */
function countGraveCards(grave: any[]): number {
  return grave.reduce((sum, entry) => {
    if (Array.isArray(entry?.cards)) {
      return sum + entry.cards.length;
    }
    return sum + 1;
  }, 0);
}

describe("GenericTacticalEvaluator vs Core Independent Execution Comparison (Work 5-1 R4)", () => {
  let rulePackage: RulePackage;
  let evaluator: GenericTacticalEvaluator;
  let coreExpressionEvaluator: ExpressionEvaluator;
  let abilityEvaluator: AbilityEvaluator;
  let commandRegistry: CommandRegistry;
  let deathLanceAction: ActionDefinition;
  let throwingAction: ActionDefinition;
  let counterAction: ActionDefinition;

  beforeAll(() => {
    rulePackage = loadRulePackageForBrowser();
    evaluator = new GenericTacticalEvaluator(rulePackage);
    coreExpressionEvaluator = new ExpressionEvaluator();
    abilityEvaluator = new AbilityEvaluator();
    commandRegistry = new CommandRegistry();

    const dl = rulePackage.actions.find((a) => a.id === "action.deathLance");
    const th = rulePackage.actions.find((a) => a.id === "action.throwing");
    const ct = rulePackage.actions.find((a) => a.id === "action.counter");
    if (!dl || !th || !ct) {
      throw new Error("Required official actions not found in RulePackage");
    }
    deathLanceAction = dl;
    throwingAction = th;
    counterAction = ct;
  });

  describe("1. ガード成立・不成立と1枚/複数枚の兵士移動・ダメージのCore実行結果比較", () => {
    it("1-1. [ガード成立 + 1枚兵士移動 + ダメージ] Coreで死の槍を解決した実ライフ変動と戦術評価器の結果が完全一致する", () => {
      const initialLifeCount = 15;
      const soldierCard = { id: "c-s10", suit: "S", rank: "10", value: 10 };
      const targetSoldier = {
        unitId: "u-soldier-10",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        cards: [soldierCard],
        labels: ["攻撃", "防御"],
        currentSize: 10,
      };
      const keyCardsCore = [
        { id: "c-d1", suit: "D", rank: "A", value: 1 },
        { id: "c-s13", suit: "S", rank: "K", value: 13 },
      ];

      // --- Step A: Core で実際にリクエスト効果を解決 ---
      const coreState: any = {
        stateVersion: 1,
        turnCount: 2,
        players: {
          p1: { name: "P1", life: createLifeCards("p1", 15), hand: [], field: [], fog: [], trumps: [], grave: [] },
          p2: {
            name: "P2",
            life: createLifeCards("p2", initialLifeCount),
            hand: [],
            field: [{ ...targetSoldier, cards: [...targetSoldier.cards] }],
            fog: [],
            trumps: [],
            grave: [],
          },
        },
        stage: { requests: [], history: [] },
      };

      const coreContext: CommandContext = {
        state: coreState,
        playerKey: "p1",
        targetComponent: coreState.players.p2.field[0],
        keyCards: keyCardsCore,
        actions: rulePackage.actions,
        components: rulePackage.components,
        currentAction: deathLanceAction,
        currentRequest: {
          id: "req-dl-hit",
          actionId: "action.deathLance",
          controller: "p1",
          keyCards: keyCardsCore,
          status: "resolving",
          sequence: 1,
        },
      };

      const execRes = commandRegistry
        .getEffectInterpreter()
        .executeEffectsWithInterruption(deathLanceAction.effect!, coreContext);
      // 複数枚ダメージ時はダメージ解決完了後に Grave TOP 選択中断 (zoneTop) が返る
      expect(
        ("completed" in execRes && execRes.completed) ||
          ("interrupted" in execRes && execRes.selectionType === "zoneTop")
      ).toBe(true);

      // Core 実行結果から独立して実測値を算出
      const coreIsGuardedOut = coreState.players.p2.field.length > 0 && coreState.players.p2.grave.length === 0;
      const coreDirectDamage = countGraveCards(coreState.players.p2.grave);
      const coreFinalLife = coreState.players.p2.life.length;
      const coreNetDamage = initialLifeCount - coreFinalLife;
      const coreLifeGain = coreDirectDamage - coreNetDamage;

      // --- Step B: 戦術評価器で公開観測情報を評価 ---
      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, name: "P1", isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2" as const,
            name: "P2",
            isViewer: true,
            lifeCount: initialLifeCount,
            lifeDisplay: String(initialLifeCount),
            handCount: 0,
            handCards: [],
            field: [
              {
                unitId: "u-soldier-10",
                kind: "soldier" as const,
                state: "charge" as const,
                face: "up" as const,
                cards: [{ visibility: "KNOWN" as const, cardInstanceId: "c-s10", suit: "spade", rank: "10", value: 10, faceUp: true }],
                labels: [],
                currentSize: 10,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      };

      const reqView: RequestView = {
        requestId: "req-dl-hit" as any,
        actionId: "action.deathLance",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "unit", targetUnitId: "u-soldier-10" },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-d1", suit: "diamond", rank: "A", value: 1, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-s13", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };

      const tacticalOutcome = evaluator.evaluateRequestOutcome(reqView, "p2", obs);

      // --- Step C: Core 実測値と戦術評価器の結果を突き合わせ ---
      expect(tacticalOutcome.certainty).toBe("CERTAIN");
      expect(tacticalOutcome.isGuardedOut).toBe(coreIsGuardedOut);
      expect(tacticalOutcome.lifeGainToSelf.expected).toBe(coreLifeGain);
      expect(tacticalOutcome.directDamageToSelf.expected).toBe(coreDirectDamage);
      expect(tacticalOutcome.netDamageToSelf.expected).toBe(coreNetDamage);
    });

    it("1-2. [ガード不成立] Coreで死の槍が不発になった実結果と戦術評価器の不発判定が完全一致する", () => {
      const initialLifeCount = 15;
      const targetSoldier = {
        unitId: "u-soldier-5",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        cards: [{ id: "c-s5", suit: "S", rank: "5", value: 5 }],
        labels: ["攻撃", "防御"],
        currentSize: 5,
      };
      const keyCardsCore = [
        { id: "c-d2", suit: "D", rank: "2", value: 2 }, // 5 % 2 !== 0
        { id: "c-s13", suit: "S", rank: "K", value: 13 },
      ];

      // --- Step A: Core で実際にリクエスト効果を解決 ---
      const coreState: any = {
        stateVersion: 1,
        turnCount: 2,
        players: {
          p1: { name: "P1", life: createLifeCards("p1", 15), hand: [], field: [], fog: [], trumps: [], grave: [] },
          p2: {
            name: "P2",
            life: createLifeCards("p2", initialLifeCount),
            hand: [],
            field: [{ ...targetSoldier, cards: [...targetSoldier.cards] }],
            fog: [],
            trumps: [],
            grave: [],
          },
        },
        stage: { requests: [], history: [] },
      };

      const coreContext: CommandContext = {
        state: coreState,
        playerKey: "p1",
        targetComponent: coreState.players.p2.field[0],
        keyCards: keyCardsCore,
        actions: rulePackage.actions,
        components: rulePackage.components,
        currentAction: deathLanceAction,
        currentRequest: {
          id: "req-dl-miss",
          actionId: "action.deathLance",
          controller: "p1",
          keyCards: keyCardsCore,
          status: "resolving",
          sequence: 1,
        },
      };

      const execRes = commandRegistry
        .getEffectInterpreter()
        .executeEffectsWithInterruption(deathLanceAction.effect!, coreContext);
      // 複数枚ダメージ時はダメージ解決完了後に Grave TOP 選択中断 (zoneTop) が返る
      expect(
        ("completed" in execRes && execRes.completed) ||
          ("interrupted" in execRes && execRes.selectionType === "zoneTop")
      ).toBe(true);

      // Core 実行結果の実測値: 兵士はフィールドに残り、墓地0枚、ライフ変動0
      const coreIsGuardedOut = coreState.players.p2.field.length === 1 && coreState.players.p2.grave.length === 0;
      const coreDirectDamage = countGraveCards(coreState.players.p2.grave);
      const coreNetDamage = initialLifeCount - coreState.players.p2.life.length;
      const coreLifeGain = coreDirectDamage - coreNetDamage;

      // --- Step B: 戦術評価器で評価 ---
      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, name: "P1", isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2" as const,
            name: "P2",
            isViewer: true,
            lifeCount: initialLifeCount,
            lifeDisplay: String(initialLifeCount),
            handCount: 0,
            handCards: [],
            field: [
              {
                unitId: "u-soldier-5",
                kind: "soldier" as const,
                state: "charge" as const,
                face: "up" as const,
                cards: [{ visibility: "KNOWN" as const, cardInstanceId: "c-s5", suit: "spade", rank: "5", value: 5, faceUp: true }],
                labels: [],
                currentSize: 5,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      };

      const reqView: RequestView = {
        requestId: "req-dl-miss" as any,
        actionId: "action.deathLance",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "unit", targetUnitId: "u-soldier-5" },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-d2", suit: "diamond", rank: "2", value: 2, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-s13", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };

      const tacticalOutcome = evaluator.evaluateRequestOutcome(reqView, "p2", obs);

      // --- Step C: Core 実測値と戦術評価器の結果を突き合わせ ---
      expect(tacticalOutcome.certainty).toBe("CERTAIN");
      expect(tacticalOutcome.isGuardedOut).toBe(coreIsGuardedOut);
      expect(tacticalOutcome.guardStatus).toBe("CERTAIN_UNSATISFIED");
      expect(tacticalOutcome.lifeGainToSelf.expected).toBe(coreLifeGain);
      expect(tacticalOutcome.directDamageToSelf.expected).toBe(coreDirectDamage);
      expect(tacticalOutcome.netDamageToSelf.expected).toBe(coreNetDamage);
    });

    it("1-3. [複数枚の兵士移動 + ダメージ] 2枚構成の装備兵に対する死の槍のCore解決結果と戦術評価器が完全一致する", () => {
      const initialLifeCount = 15;
      const baseCard = { id: "c-base-6", suit: "S", rank: "6", value: 6 };
      const mountCard = { id: "c-mount-4", suit: "H", rank: "4", value: 4 };
      const armedSoldier = {
        unitId: "u-armed-10",
        kind: "装備兵",
        componentId: "character.armedSoldier",
        state: "charge",
        face: "up",
        cards: [baseCard, mountCard],
        labels: ["攻撃", "防御"],
        currentSize: 10,
      };
      const keyCardsCore = [
        { id: "c-d2", suit: "D", rank: "2", value: 2 }, // 10 % 2 === 0
        { id: "c-s9", suit: "S", rank: "9", value: 9 }, // 9ダメージ
      ];

      // --- Step A: Core で実際にリクエスト効果を解決 ---
      const coreState: any = {
        stateVersion: 1,
        turnCount: 3,
        players: {
          p1: { name: "P1", life: createLifeCards("p1", 15), hand: [], field: [], fog: [], trumps: [], grave: [] },
          p2: {
            name: "P2",
            life: createLifeCards("p2", initialLifeCount),
            hand: [],
            field: [{ ...armedSoldier, cards: [...armedSoldier.cards] }],
            fog: [],
            trumps: [],
            grave: [],
          },
        },
        stage: { requests: [], history: [] },
      };

      const coreContext: CommandContext = {
        state: coreState,
        playerKey: "p1",
        targetComponent: coreState.players.p2.field[0],
        keyCards: keyCardsCore,
        selections: {
          deathLanceOrder: [baseCard.id, mountCard.id],
        },
        actions: rulePackage.actions,
        components: rulePackage.components,
        currentAction: deathLanceAction,
        currentRequest: {
          id: "req-dl-armed",
          actionId: "action.deathLance",
          controller: "p1",
          keyCards: keyCardsCore,
          status: "resolving",
          sequence: 1,
        },
      };

      const execRes = commandRegistry
        .getEffectInterpreter()
        .executeEffectsWithInterruption(deathLanceAction.effect!, coreContext);
      // 複数枚ダメージ時はダメージ解決完了後に Grave TOP 選択中断 (zoneTop) が返る
      expect(
        ("completed" in execRes && execRes.completed) ||
          ("interrupted" in execRes && execRes.selectionType === "zoneTop")
      ).toBe(true);

      // Core 実行結果の実測値: 2枚がライフTOPへ移動(+2)し、9枚がダメージとして墓地へ移動(-9) -> 正味7ライフ減少
      const coreIsGuardedOut = coreState.players.p2.field.length > 0;
      const coreDirectDamage = countGraveCards(coreState.players.p2.grave);
      const coreFinalLife = coreState.players.p2.life.length;
      const coreNetDamage = initialLifeCount - coreFinalLife;
      const coreLifeGain = coreDirectDamage - coreNetDamage;

      // --- Step B: 戦術評価器で評価 ---
      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, name: "P1", isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2" as const,
            name: "P2",
            isViewer: true,
            lifeCount: initialLifeCount,
            lifeDisplay: String(initialLifeCount),
            handCount: 0,
            handCards: [],
            field: [
              {
                unitId: "u-armed-10",
                kind: "soldier" as const,
                state: "charge" as const,
                face: "up" as const,
                cards: [
                  { visibility: "KNOWN" as const, cardInstanceId: "c-base-6", suit: "spade", rank: "6", value: 6, faceUp: true },
                  { visibility: "KNOWN" as const, cardInstanceId: "c-mount-4", suit: "heart", rank: "4", value: 4, faceUp: true },
                ],
                labels: [],
                currentSize: 10,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      };

      const reqView: RequestView = {
        requestId: "req-dl-armed" as any,
        actionId: "action.deathLance",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "unit", targetUnitId: "u-armed-10" },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-d2", suit: "diamond", rank: "2", value: 2, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-s9", suit: "spade", rank: "9", value: 9, faceUp: true },
        ],
      };

      const tacticalOutcome = evaluator.evaluateRequestOutcome(reqView, "p2", obs);

      // --- Step C: Core 実測値と戦術評価器の結果を突き合わせ ---
      expect(tacticalOutcome.certainty).toBe("CERTAIN");
      expect(tacticalOutcome.isGuardedOut).toBe(coreIsGuardedOut);
      expect(tacticalOutcome.lifeGainToSelf.expected).toBe(coreLifeGain);
      expect(tacticalOutcome.directDamageToSelf.expected).toBe(coreDirectDamage);
      expect(tacticalOutcome.netDamageToSelf.expected).toBe(coreNetDamage);
    });

    it("1-4. [直接ダメージ] 投擲 (action.throwing) のCore解決結果と戦術評価器の結果が完全一致する", () => {
      const initialLifeCount = 15;
      const keyCardsCore = [
        { id: "c-s8", suit: "S", rank: "8", value: 8 },
        { id: "c-c4", suit: "C", rank: "4", value: 4 },
      ];

      // --- Step A: Core で実際に投擲効果を解決 ---
      const coreState: any = {
        stateVersion: 1,
        turnCount: 2,
        players: {
          p1: { name: "P1", life: createLifeCards("p1", 15), hand: [], field: [], fog: [], trumps: [], grave: [] },
          p2: { name: "P2", life: createLifeCards("p2", initialLifeCount), hand: [], field: [], fog: [], trumps: [], grave: [] },
        },
        stage: { requests: [], history: [] },
      };

      const coreContext: CommandContext = {
        state: coreState,
        playerKey: "p1",
        targetPlayerKey: "p2",
        keyCards: keyCardsCore,
        actions: rulePackage.actions,
        components: rulePackage.components,
        currentAction: throwingAction,
        currentRequest: {
          id: "req-throw-8",
          actionId: "action.throwing",
          controller: "p1",
          keyCards: keyCardsCore,
          status: "resolving",
          sequence: 1,
        },
      };

      const execRes = commandRegistry
        .getEffectInterpreter()
        .executeEffectsWithInterruption(throwingAction.effect!, coreContext);
      expect(
        ("completed" in execRes && execRes.completed) ||
          ("interrupted" in execRes && execRes.selectionType === "zoneTop")
      ).toBe(true);

      const coreDirectDamage = countGraveCards(coreState.players.p2.grave);
      const coreNetDamage = initialLifeCount - coreState.players.p2.life.length;

      // --- Step B: 戦術評価器で評価 ---
      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, name: "P1", isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          { playerId: "p2" as const, name: "P2", isViewer: true, lifeCount: initialLifeCount, lifeDisplay: String(initialLifeCount), handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: true },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      };

      const reqView: RequestView = {
        requestId: "req-throw-8" as any,
        actionId: "action.throwing",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "player", targetPlayerKey: "p2" },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-s8", suit: "spade", rank: "8", value: 8, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-c4", suit: "club", rank: "4", value: 4, faceUp: true },
        ],
      };

      const tacticalOutcome = evaluator.evaluateRequestOutcome(reqView, "p2", obs);

      // --- Step C: Core 実測値と戦術評価器の結果を突き合わせ ---
      expect(tacticalOutcome.certainty).toBe("CERTAIN");
      expect(tacticalOutcome.directDamageToSelf.expected).toBe(coreDirectDamage);
      expect(tacticalOutcome.netDamageToSelf.expected).toBe(coreNetDamage);
    });
  });

  describe("2. Counter 成立・不成立の Core 実行結果と戦術評価器の比較", () => {
    it("2-1. [Counter 成立 (キーカード2枚対象)] Coreでのキャンセル成立と戦術評価器の CERTAIN_CANCEL が一致する", () => {
      // --- Step A: Core で Counter を解決 ---
      const stageTargetReq: any = {
        id: "req-target-dl",
        actionId: "action.deathLance",
        controller: "p1",
        status: "pending",
        sequence: 1,
        keyCards: [
          { id: "c-d1", suit: "D", rank: "A", value: 1 },
          { id: "c-s13", suit: "S", rank: "K", value: 13 },
        ],
      };

      const coreState: any = {
        stateVersion: 2,
        players: {
          p1: { name: "P1", life: [], hand: [], field: [], fog: [], trumps: [], grave: [] },
          p2: { name: "P2", life: [], hand: [], field: [], fog: [], trumps: [], grave: [] },
        },
        stage: {
          requests: [stageTargetReq],
          history: [],
        },
      };

      const counterKeyCard = { id: "c-c2", suit: "C", rank: "2", value: 2 };
      const coreContext: CommandContext = {
        state: coreState,
        playerKey: "p2",
        keyCard: counterKeyCard,
        keyCards: [counterKeyCard],
        targetRequest: stageTargetReq,
        actions: rulePackage.actions,
        components: rulePackage.components,
        currentAction: counterAction,
        currentRequest: {
          id: "req-counter-1",
          actionId: "action.counter",
          controller: "p2",
          keyCards: [counterKeyCard],
          status: "resolving",
          sequence: 2,
        },
      };

      const execRes = commandRegistry
        .getEffectInterpreter()
        .executeEffectsWithInterruption(counterAction.effect!, coreContext);
      expect("completed" in execRes && execRes.completed).toBe(true);

      // Core 実行結果: stageTargetReq がキャンセルされたか
      const coreCancelled =
        stageTargetReq.status === "cancelled" &&
        !coreState.stage.requests.some((r: any) => r.id === "req-target-dl");

      // --- Step B: 戦術評価器で Counter を評価 ---
      const oppReqView: RequestView = {
        requestId: "req-target-dl" as any,
        actionId: "action.deathLance",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "unit", targetUnitId: "u-1" },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-d1", suit: "diamond", rank: "A", value: 1, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-s13", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };

      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, name: "P1", isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2" as const,
            name: "P2",
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 1,
            handCards: [{ visibility: "KNOWN" as const, cardInstanceId: "c-c2", suit: "club", rank: "2", value: 2, faceUp: true }],
            field: [{ unitId: "u-1", kind: "soldier" as const, state: "charge" as const, face: "up" as const, cards: [], labels: [], currentSize: 10 }],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
        stageRequestRefs: ["req-target-dl" as any],
        stageRequests: [oppReqView],
        recentEvents: [],
      };

      const reqOutcome = evaluator.evaluateRequestOutcome(oppReqView, "p2", obs);
      const decReq: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "m1",
        decisionId: "d1",
        stateVersion: 2,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        observation: obs,
        catalog: {
          actions: [{ actionId: "action.counter", actionName: "Counter", speed: "quick", timing: "quick" } as any],
          cardSelections: [{ cardIds: ["c-c2"], displayCodes: ["C2"] }],
          unitSelections: [],
          costPayments: [],
          targetSelections: [{ targetType: "request", targetRequestId: "req-target-dl" } as any],
          effectSelections: [],
          orderSelections: [],
        },
        patterns: [
          { patternId: "pat-pass", kind: "PASS" },
          { patternId: "pat-counter", kind: "ACTION", actionSelectionRef: 0, targetSelectionRef: 0, keyCardSelectionRef: 0 },
        ],
      };

      const counterOutcome = evaluator.evaluateCounterOutcome(decReq.patterns[1], oppReqView, decReq, reqOutcome);

      // --- Step C: Core 実測値と戦術評価器の結果を突き合わせ ---
      expect(coreCancelled).toBe(true);
      expect(counterOutcome.cancelStatus === "CERTAIN_CANCEL").toBe(coreCancelled);
      expect(counterOutcome.preventedDamageToSelf.expected).toBe(reqOutcome.netDamageToSelf.expected);
    });

    it("2-2. [Counter 成立・不成立 (キーカード1枚対象: key.rankValue >= first.rankValue と < first.rankValue)] Coreの解決結果と完全一致する", () => {
      // 対象リクエスト: キーカード1枚 (♠8)
      const createSingleKeyStageReq = () => ({
        id: "req-target-single",
        actionId: "action.throwing",
        controller: "p1",
        status: "pending",
        sequence: 1,
        keyCards: [{ id: "c-s8", suit: "S", rank: "8", value: 8 }],
      });

      // ケース A: ♣9 (9 >= 8) で Counter -> Core でキャンセル成立
      const reqA = createSingleKeyStageReq();
      const stateA: any = {
        stateVersion: 2,
        players: {
          p1: { name: "P1", life: [], hand: [], field: [], fog: [], trumps: [], grave: [] },
          p2: { name: "P2", life: [], hand: [], field: [], fog: [], trumps: [], grave: [] },
        },
        stage: { requests: [reqA], history: [] },
      };
      const keyCard9 = { id: "c-c9", suit: "C", rank: "9", value: 9 };
      commandRegistry.getEffectInterpreter().executeEffectsWithInterruption(counterAction.effect!, {
        state: stateA,
        playerKey: "p2",
        keyCard: keyCard9,
        keyCards: [keyCard9],
        targetRequest: reqA as any,
        actions: rulePackage.actions,
        components: rulePackage.components,
        currentAction: counterAction,
      });
      const coreCancelledA = reqA.status === "cancelled" && stateA.stage.requests.length === 0;

      // ケース B: ♣4 (4 < 8) で Counter -> Core でキャンセル不成立 (stageに残存)
      const reqB = createSingleKeyStageReq();
      const stateB: any = {
        stateVersion: 2,
        players: {
          p1: { name: "P1", life: [], hand: [], field: [], fog: [], trumps: [], grave: [] },
          p2: { name: "P2", life: [], hand: [], field: [], fog: [], trumps: [], grave: [] },
        },
        stage: { requests: [reqB], history: [] },
      };
      const keyCard4 = { id: "c-c4", suit: "C", rank: "4", value: 4 };
      commandRegistry.getEffectInterpreter().executeEffectsWithInterruption(counterAction.effect!, {
        state: stateB,
        playerKey: "p2",
        keyCard: keyCard4,
        keyCards: [keyCard4],
        targetRequest: reqB as any,
        actions: rulePackage.actions,
        components: rulePackage.components,
        currentAction: counterAction,
      });
      const coreCancelledB = reqB.status === "cancelled" && stateB.stage.requests.length === 0;

      // --- 戦術評価器でケース A (♣9) とケース B (♣4) を評価 ---
      const oppReqView: RequestView = {
        requestId: "req-target-single" as any,
        actionId: "action.throwing",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "player", targetPlayerKey: "p2" },
        keyCards: [{ visibility: "KNOWN", cardInstanceId: "c-s8", suit: "spade", rank: "8", value: 8, faceUp: true }],
      };

      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, name: "P1", isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2" as const,
            name: "P2",
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 2,
            handCards: [
              { visibility: "KNOWN" as const, cardInstanceId: "c-c9", suit: "club", rank: "9", value: 9, faceUp: true },
              { visibility: "KNOWN" as const, cardInstanceId: "c-c4", suit: "club", rank: "4", value: 4, faceUp: true },
            ],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
        stageRequestRefs: ["req-target-single" as any],
        stageRequests: [oppReqView],
        recentEvents: [],
      };

      const reqOutcome = evaluator.evaluateRequestOutcome(oppReqView, "p2", obs);
      const decReq: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "m2",
        decisionId: "d2",
        stateVersion: 2,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        observation: obs,
        catalog: {
          actions: [{ actionId: "action.counter", actionName: "Counter", speed: "quick", timing: "quick" } as any],
          cardSelections: [
            { cardIds: ["c-c9"], displayCodes: ["C9"] },
            { cardIds: ["c-c4"], displayCodes: ["C4"] },
          ],
          unitSelections: [],
          costPayments: [],
          targetSelections: [{ targetType: "request", targetRequestId: "req-target-single" } as any],
          effectSelections: [],
          orderSelections: [],
        },
        patterns: [
          { patternId: "pat-counter-9", kind: "ACTION", actionSelectionRef: 0, targetSelectionRef: 0, keyCardSelectionRef: 0 },
          { patternId: "pat-counter-4", kind: "ACTION", actionSelectionRef: 0, targetSelectionRef: 0, keyCardSelectionRef: 1 },
        ],
      };

      const tacticalOutcomeA = evaluator.evaluateCounterOutcome(decReq.patterns[0], oppReqView, decReq, reqOutcome);
      const tacticalOutcomeB = evaluator.evaluateCounterOutcome(decReq.patterns[1], oppReqView, decReq, reqOutcome);

      // Core と戦術評価器の完全一致検証
      expect(coreCancelledA).toBe(true);
      expect(tacticalOutcomeA.cancelStatus === "CERTAIN_CANCEL").toBe(coreCancelledA);
      expect(tacticalOutcomeA.preventedDamageToSelf.expected).toBe(8);

      expect(coreCancelledB).toBe(false);
      expect(tacticalOutcomeB.cancelStatus === "CERTAIN_CANCEL").toBe(coreCancelledB);
      expect(tacticalOutcomeB.cancelStatus).toBe("CANNOT_CANCEL");
      expect(tacticalOutcomeB.preventedDamageToSelf.expected).toBe(0);
    });
  });

  describe("3. 非公開情報 (HIDDEN) と未知変数 (UNKNOWN) の区別検証", () => {
    it("3-1. 非公開キーカードは ESTIMATED/UNCERTAIN となり、未知変数は UNKNOWN となる", () => {
      const condHidden = "target.size != 0 && target.size % keyCards.diamond.rankValue == 0";
      const hiddenCtx: any = {
        viewerPlayerId: "p2",
        targetUnit: { unitId: "u1", currentSize: 5 },
        keyCards: [
          { visibility: "HIDDEN", cardInstanceId: "c-hidden-d", faceUp: false },
          { visibility: "KNOWN", cardInstanceId: "c-s13", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };
      expect(CoreAlignedExpressionEvaluator.evaluateCondition(condHidden, hiddenCtx)).toBe("UNCERTAIN");

      const condUnknown = "target.size != 0 && unknownVar.value == 0";
      expect(CoreAlignedExpressionEvaluator.evaluateCondition(condUnknown, hiddenCtx)).toBe("UNKNOWN");
    });
  });
});
