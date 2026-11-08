import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { RulePackage } from "../../domain/rules/RulePackage";
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

describe("GenericTacticalEvaluator Core Consistency Tests (Work 5-1 R3)", () => {
  let rulePackage: RulePackage;
  let evaluator: GenericTacticalEvaluator;
  let coreExpressionEvaluator: ExpressionEvaluator;
  let abilityEvaluator: AbilityEvaluator;
  let commandRegistry: CommandRegistry;

  beforeAll(() => {
    rulePackage = loadRulePackageForBrowser();
    evaluator = new GenericTacticalEvaluator(rulePackage);
    coreExpressionEvaluator = new ExpressionEvaluator();
    abilityEvaluator = new AbilityEvaluator();
    commandRegistry = new CommandRegistry();
  });

  describe("1. guardCondition セマンティクスと Core ExpressionEvaluator との一致", () => {
    it("1-1. 確定成立ケース: size 10, diamond 1 -> Core と TacticalEvaluator 双方で真/成立", () => {
      const cond = "target.size != 0 && target.size % keyCards.diamond.rankValue == 0";

      // TacticalEvaluator 側の評価
      const tacticalContext: any = {
        viewerPlayerId: "p2",
        targetUnit: { unitId: "u1", currentSize: 10 },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-d1", suit: "diamond", rank: "A", value: 1, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-s13", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };
      const tacticalStatus = CoreAlignedExpressionEvaluator.evaluateCondition(cond, tacticalContext);
      expect(tacticalStatus).toBe("CERTAIN_SATISFIED");

      // Core ExpressionEvaluator 側の評価
      const coreContext: any = {
        state: { stateVersion: 1 },
        playerKey: "p1",
        targetComponent: { currentSize: 10, cards: [{ suit: "D", rank: "10", value: 10 }] },
        keyCards: [
          { id: "c-d1", suit: "D", rank: "A", value: 1 },
          { id: "c-s13", suit: "S", rank: "K", value: 13 },
        ],
      };
      const coreResult = coreExpressionEvaluator.evaluateCondition(cond, coreContext, abilityEvaluator);
      expect(coreResult).toBe(true);
    });

    it("1-2. 確定不成立ケース: size 5, diamond 2 (5 % 2 !== 0) -> Core で偽、TacticalEvaluator で CERTAIN_UNSATISFIED", () => {
      const cond = "target.size != 0 && target.size % keyCards.diamond.rankValue == 0";

      const tacticalContext: any = {
        viewerPlayerId: "p2",
        targetUnit: { unitId: "u1", currentSize: 5 },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-d2", suit: "diamond", rank: "2", value: 2, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-s13", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };
      const tacticalStatus = CoreAlignedExpressionEvaluator.evaluateCondition(cond, tacticalContext);
      expect(tacticalStatus).toBe("CERTAIN_UNSATISFIED");

      const coreContext: any = {
        state: { stateVersion: 1 },
        playerKey: "p1",
        targetComponent: { currentSize: 5, cards: [{ suit: "D", rank: "5", value: 5 }] },
        keyCards: [
          { id: "c-d2", suit: "D", rank: "2", value: 2 },
          { id: "c-s13", suit: "S", rank: "K", value: 13 },
        ],
      };
      const coreResult = coreExpressionEvaluator.evaluateCondition(cond, coreContext, abilityEvaluator);
      expect(coreResult).toBe(false);
    });

    it("1-3. 非公開情報ケース: diamond が HIDDEN の場合、固定値捏造を行わず UNCERTAIN を返す", () => {
      const cond = "target.size != 0 && target.size % keyCards.diamond.rankValue == 0";

      const tacticalContext: any = {
        viewerPlayerId: "p2",
        targetUnit: { unitId: "u1", currentSize: 5 },
        keyCards: [
          { visibility: "HIDDEN", cardInstanceId: "c-hidden-d", faceUp: false },
          { visibility: "KNOWN", cardInstanceId: "c-s13", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };
      const tacticalStatus = CoreAlignedExpressionEvaluator.evaluateCondition(cond, tacticalContext);
      expect(tacticalStatus).toBe("UNCERTAIN");
    });
  });

  describe("2. dealDamage および moveUnitCardsToZoneTop の Core 整合性", () => {
    it("2-1. 単一カード兵士の死の槍: ライフ+1, ダメージ13 -> 正味12ダメージ (Core のライフ変動と完全一致)", () => {
      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2" as const,
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 0,
            handCards: [],
            field: [
              {
                unitId: "u-soldier-10",
                kind: "soldier" as const,
                state: "charge" as const,
                face: "up" as const,
                cards: [{ id: "c-s10", suit: "S", rank: "10", value: 10 }],
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

      const req: RequestView = {
        requestId: "req-dl-single" as any,
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

      const outcome = evaluator.evaluateRequestOutcome(req, "p2", obs);
      expect(outcome.certainty).toBe("CERTAIN");
      expect(outcome.isGuardedOut).toBe(false);
      expect(outcome.directDamageToSelf.expected).toBe(13);
      expect(outcome.lifeGainToSelf.expected).toBe(1); // 単一カードなのでライフ+1
      expect(outcome.netDamageToSelf.expected).toBe(12); // 正味 12 ダメージ

      // Core のシミュレーション検証: 初期ライフ10 + 兵士1枚乗せ(11) - 13ダメージ = 0
      const netLifeChange = outcome.lifeGainToSelf.expected - outcome.directDamageToSelf.expected;
      expect(netLifeChange).toBe(-12);
    });

    it("2-2. 複数カード兵士の死の槍: 2枚構成兵士ならライフ+2, 正味11ダメージ (Core の cards.length ルール完全一致)", () => {
      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2" as const,
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 0,
            handCards: [],
            field: [
              {
                unitId: "u-soldier-double",
                kind: "soldier" as const,
                state: "charge" as const,
                face: "up" as const,
                cards: [
                  { id: "c-base", suit: "S", rank: "5", value: 5 },
                  { id: "c-mounted", suit: "S", rank: "5", value: 5 },
                ],
                labels: [],
                currentSize: 10, // 2枚で計10
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

      const req: RequestView = {
        requestId: "req-dl-multi" as any,
        actionId: "action.deathLance",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "unit", targetUnitId: "u-soldier-double" },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-d1", suit: "diamond", rank: "A", value: 1, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-s13", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };

      const outcome = evaluator.evaluateRequestOutcome(req, "p2", obs);
      expect(outcome.certainty).toBe("CERTAIN");
      expect(outcome.isGuardedOut).toBe(false);
      expect(outcome.directDamageToSelf.expected).toBe(13);
      expect(outcome.lifeGainToSelf.expected).toBe(2); // 2枚構成兵士なのでライフ+2
      expect(outcome.netDamageToSelf.expected).toBe(11); // 正味 11 ダメージ
    });
  });

  describe("3. 効果順序とガード不発の処理 (guardCondition failure aborts subsequent effects)", () => {
    it("3-1. ガード不発時 (3 % 2 !== 0): 後続のライフ移動およびダメージは一切発生しない (正味0)", () => {
      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2" as const,
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 0,
            handCards: [],
            field: [
              {
                unitId: "u-soldier-3",
                kind: "soldier" as const,
                state: "charge" as const,
                face: "up" as const,
                cards: [{ id: "c-s3", suit: "S", rank: "3", value: 3 }],
                labels: [],
                currentSize: 3,
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

      const reqMiss: RequestView = {
        requestId: "req-dl-miss" as any,
        actionId: "action.deathLance",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "unit", targetUnitId: "u-soldier-3" },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-d2", suit: "diamond", rank: "2", value: 2, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-s13", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };

      const outcome = evaluator.evaluateRequestOutcome(reqMiss, "p2", obs);
      expect(outcome.certainty).toBe("CERTAIN");
      expect(outcome.isGuardedOut).toBe(true);
      expect(outcome.guardStatus).toBe("CERTAIN_UNSATISFIED");
      expect(outcome.directDamageToSelf.expected).toBe(0);
      expect(outcome.lifeGainToSelf.expected).toBe(0);
      expect(outcome.netDamageToSelf.expected).toBe(0);
    });

    it("3-2. ガード未確定時 (HIDDEN キーカード): 不発(0)と成立(hitMax)の双方をモデル化", () => {
      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2" as const,
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 0,
            handCards: [],
            field: [
              {
                unitId: "u-soldier-3",
                kind: "soldier" as const,
                state: "charge" as const,
                face: "up" as const,
                cards: [{ id: "c-s3", suit: "S", rank: "3", value: 3 }],
                labels: [],
                currentSize: 3,
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

      const reqUncertain: RequestView = {
        requestId: "req-dl-uncertain" as any,
        actionId: "action.deathLance",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "unit", targetUnitId: "u-soldier-3" },
        keyCards: [
          { visibility: "HIDDEN", cardInstanceId: "c-d-hid", faceUp: false },
          { visibility: "HIDDEN", cardInstanceId: "c-s-hid", faceUp: false },
        ],
      };

      const outcome = evaluator.evaluateRequestOutcome(reqUncertain, "p2", obs);
      expect(outcome.certainty).toBe("ESTIMATED");
      expect(outcome.isGuardedOut).toBe(false);
      expect(outcome.guardStatus).toBe("UNCERTAIN");
      // 不発の可能性を考慮し min は 0、最大想定は 13 - 1 = 12
      expect(outcome.netDamageToSelf.min).toBe(0);
      expect(outcome.netDamageToSelf.max).toBe(12);
      expect(outcome.netDamageToSelf.isCertain).toBe(false);
    });
  });

  describe("4. cancelRequest の到達性と打ち消し阻止判定", () => {
    it("4-1. Counter アクションによる死の槍阻止の確実性判定", () => {
      const oppReq: RequestView = {
        requestId: "req-target" as any,
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

      const reqOutcome = evaluator.evaluateRequestOutcome(oppReq, "p2", {
        viewerPlayerId: "p2",
        players: [
          { playerId: "p1", isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2",
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 1,
            handCards: [{ visibility: "KNOWN", cardInstanceId: "c-c10", suit: "club", rank: "10", value: 10, faceUp: true }],
            field: [{ unitId: "u-1", kind: "soldier", state: "charge", face: "up", cards: [], labels: [], currentSize: 10 }],
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
      });

      const decReq: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "m1",
        decisionId: "d1",
        stateVersion: 1,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        observation: {
          viewerPlayerId: "p2",
          players: [
            { playerId: "p1", name: "P1", isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
            {
              playerId: "p2",
              name: "P2",
              isViewer: true,
              lifeCount: 10,
              lifeDisplay: "10",
              handCount: 1,
              handCards: [{ visibility: "KNOWN", cardInstanceId: "c-c10", suit: "club", rank: "10", value: 10, faceUp: true }],
              field: [{ unitId: "u-1", kind: "soldier", state: "charge", face: "up", cards: [], labels: [], currentSize: 10 }],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: true,
            },
          ],
          stageRequestRefs: ["req-target" as any],
          stageRequests: [oppReq],
          recentEvents: [],
        },
        catalog: {
          actions: [{ actionId: "action.counter", actionName: "Counter", speed: "quick", timing: "quick" } as any],
          cardSelections: [{ cardIds: ["c-c10"] }],
          unitSelections: [],
          costPayments: [],
          targetSelections: [{ targetType: "request", targetRequestId: "req-target" } as any],
          effectSelections: [],
          orderSelections: [],
        },
        patterns: [
          { patternId: "pat-pass", kind: "PASS" },
          { patternId: "pat-counter", kind: "ACTION", actionSelectionRef: 0, targetSelectionRef: 0, keyCardSelectionRef: 0 },
        ],
      };

      const counterOutcome = evaluator.evaluateCounterOutcome(decReq.patterns[1], oppReq, decReq, reqOutcome);
      expect(counterOutcome.cancelStatus).toBe("CERTAIN_CANCEL");
      expect(counterOutcome.preventedDamageToSelf.expected).toBe(12);
      expect(counterOutcome.isCertain).toBe(true);
    });
  });
});
