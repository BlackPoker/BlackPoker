import { describe, it, expect } from "vitest";
import {
  advanceAutomatedDecisions,
  validateDecisionResponse,
} from "../../engine/playtest/HumanVsPolicyController";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { GameSession, GameSessionStep } from "../../engine/session/GameSession";
import { FirstLegalPolicy, DecisionPolicy } from "../../engine/simulation/DecisionPolicy";
import { createSeatControllers } from "../../engine/playtest/PlaytestSeatController";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";

describe("HumanVsPolicyController Tests", () => {
  const dummyRequest: DecisionRequest = {
    protocolVersion: "1.0.0",
    matchId: "test-match",
    catalog: {} as any,
    decisionId: "dec-100",
    stateVersion: 5,
    playerId: "p2",
    source: { type: "ACTION_REQUEST", playerId: "p2" },
    observation: {} as any,
    patterns: [
      { patternRef: 0, patternId: "pat-0", kind: "ACTION" } as any,
      { patternRef: 1, patternId: "pat-1", kind: "PASS" } as any,
    ],
  };

  describe("1. validateDecisionResponse (fail-fast バリデーション)", () => {
    it("妥当なレスポンスが正常に検証をパスすること", () => {
      const validResponse: DecisionResponse = {
        decisionId: "dec-100",
        stateVersion: 5,
        selectedPatternRef: 1,
      };
      expect(() => validateDecisionResponse(dummyRequest, validResponse)).not.toThrow();
    });

    it("レスポンスがオブジェクトでない場合 fail-fast すること", () => {
      expect(() => validateDecisionResponse(dummyRequest, null as any)).toThrow(
        /オブジェクトではありません/
      );
    });

    it("decisionId が不一致の場合 fail-fast すること", () => {
      const invalidResponse: DecisionResponse = {
        decisionId: "dec-999",
        stateVersion: 5,
        selectedPatternRef: 0,
      };
      expect(() => validateDecisionResponse(dummyRequest, invalidResponse)).toThrow(
        /不一致または古い decisionId/
      );
    });

    it("stateVersion が不一致の場合 fail-fast すること", () => {
      const invalidResponse: DecisionResponse = {
        decisionId: "dec-100",
        stateVersion: 4,
        selectedPatternRef: 0,
      };
      expect(() => validateDecisionResponse(dummyRequest, invalidResponse)).toThrow(
        /不一致または古い stateVersion/
      );
    });

    it("selectedPatternRef が非整数の場合 fail-fast すること", () => {
      const invalidResponse: DecisionResponse = {
        decisionId: "dec-100",
        stateVersion: 5,
        selectedPatternRef: 1.5,
      };
      expect(() => validateDecisionResponse(dummyRequest, invalidResponse)).toThrow(
        /非整数の selectedPatternRef/
      );
    });

    it("selectedPatternRef が負数の場合 fail-fast すること", () => {
      const invalidResponse: DecisionResponse = {
        decisionId: "dec-100",
        stateVersion: 5,
        selectedPatternRef: -1,
      };
      expect(() => validateDecisionResponse(dummyRequest, invalidResponse)).toThrow(
        /範囲外の selectedPatternRef/
      );
    });

    it("selectedPatternRef がパターン数以上の場合 fail-fast すること", () => {
      const invalidResponse: DecisionResponse = {
        decisionId: "dec-100",
        stateVersion: 5,
        selectedPatternRef: 2,
      };
      expect(() => validateDecisionResponse(dummyRequest, invalidResponse)).toThrow(
        /範囲外の selectedPatternRef/
      );
    });
  });

  describe("2. advanceAutomatedDecisions 自動進行挙動", () => {
    function setupRealSession() {
      const fullPackage = loadRulePackageForBrowser();
      const playtestPackage = getPlaytestRulePackage(fullPackage);
      const rawState = createCoreBattlePresetState();
      const setupResult = MatchSetupCoordinator.setupMatch(rawState);
      const session = new GameSession(setupResult.state, playtestPackage);
      const initialStep = session.advance();
      return { session, initialStep };
    }

    it("初期ステップが人間の手番 (HUMAN_TURN) の場合、1手も自動実行せず STOPPED を返すこと", async () => {
      const { session, initialStep } = setupRealSession();
      // p1 が手番プレイヤーであるとする
      const activePlayer = (initialStep as any).request.playerId;
      // activePlayer を Human に設定
      const seatControllers = createSeatControllers("humanVsAi", activePlayer, "firstLegal");
      const policies = {
        [activePlayer === "p1" ? "p2" : "p1"]: new FirstLegalPolicy(),
      };

      const result = await advanceAutomatedDecisions(
        session,
        initialStep,
        seatControllers,
        policies
      );

      expect(result.status).toBe("STOPPED");
      if (result.status === "STOPPED") {
        expect(result.reason).toBe("HUMAN_TURN");
        expect(result.step).toBe(initialStep);
        expect(result.records.length).toBe(0);
      }
    });

    it("初期ステップが AI の場合、AI が自動判断を行い人間の手番まで進行すること", async () => {
      const { session, initialStep } = setupRealSession();
      const aiPlayer = (initialStep as any).request.playerId;
      const humanPlayer = aiPlayer === "p1" ? "p2" : "p1";

      const seatControllers = createSeatControllers("humanVsAi", humanPlayer, "firstLegal");
      const policies = {
        [aiPlayer]: new FirstLegalPolicy(),
      };

      const result = await advanceAutomatedDecisions(
        session,
        initialStep,
        seatControllers,
        policies
      );

      expect(result.status).toBe("STOPPED");
      if (result.status === "STOPPED") {
        // 人間の手番またはゲーム終了で停止
        expect(["HUMAN_TURN", "FINISHED"]).toContain(result.reason);
        expect(result.records.length).toBeGreaterThanOrEqual(1);
        expect(result.records[0].playerId).toBe(aiPlayer);
      }
    });

    it("Policy が例外をスローした場合、TECHNICAL_ERROR を返し GameSessionStep を汚染しないこと", async () => {
      const { session, initialStep } = setupRealSession();
      const aiPlayer = (initialStep as any).request.playerId;
      const humanPlayer = aiPlayer === "p1" ? "p2" : "p1";

      const seatControllers = createSeatControllers("humanVsAi", humanPlayer, "firstLegal");
      const throwingPolicy: DecisionPolicy = {
        descriptor: { kind: "throwing", policyVersion: 1 },
        choose: () => {
          throw new Error("Simulated policy internal crash");
        },
      };
      const policies = { [aiPlayer]: throwingPolicy };

      const result = await advanceAutomatedDecisions(
        session,
        initialStep,
        seatControllers,
        policies
      );

      expect(result.status).toBe("TECHNICAL_ERROR");
      if (result.status === "TECHNICAL_ERROR") {
        expect(result.error.message).toContain("Simulated policy internal crash");
        expect(result.lastStep).toBe(initialStep);
      }
    });

    it("Policy が不正レスポンス（範囲外 index）を返した場合、TECHNICAL_ERROR を返すこと", async () => {
      const { session, initialStep } = setupRealSession();
      const aiPlayer = (initialStep as any).request.playerId;
      const humanPlayer = aiPlayer === "p1" ? "p2" : "p1";

      const seatControllers = createSeatControllers("humanVsAi", humanPlayer, "firstLegal");
      const invalidPolicy: DecisionPolicy = {
        descriptor: { kind: "invalid", policyVersion: 1 },
        choose: (req) => ({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 9999, // 範囲外
        }),
      };
      const policies = { [aiPlayer]: invalidPolicy };

      const result = await advanceAutomatedDecisions(
        session,
        initialStep,
        seatControllers,
        policies
      );

      expect(result.status).toBe("TECHNICAL_ERROR");
      if (result.status === "TECHNICAL_ERROR") {
        expect(result.error.message).toContain("範囲外の selectedPatternRef");
      }
    });

    it("安全上限ガード (maxAutomatedDecisions) に到達した場合、TECHNICAL_ERROR で安全停止すること", async () => {
      const { session, initialStep } = setupRealSession();
      const aiPlayer = (initialStep as any).request.playerId;
      const humanPlayer = aiPlayer === "p1" ? "p2" : "p1";

      const seatControllers = createSeatControllers("humanVsAi", humanPlayer, "firstLegal");
      const policies = { [aiPlayer]: new FirstLegalPolicy() };

      // 上限を 0 に設定して即座に上限超過をテスト
      const result = await advanceAutomatedDecisions(
        session,
        initialStep,
        seatControllers,
        policies,
        { maxAutomatedDecisions: 0 }
      );

      expect(result.status).toBe("TECHNICAL_ERROR");
      if (result.status === "TECHNICAL_ERROR") {
        expect(result.error.message).toContain("安全上限");
      }
    });
  });
});
