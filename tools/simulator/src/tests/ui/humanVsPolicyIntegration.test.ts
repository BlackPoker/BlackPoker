import { describe, it, expect } from "vitest";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import {
  startMatchAttempt,
  OFFICIAL_ENV_PREFIX,
} from "../../engine/playtest/PlaytestEnvironmentController";
import {
  createSeatControllers,
  PlaytestSeatControllers,
} from "../../engine/playtest/PlaytestSeatController";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import {
  advanceAutomatedDecisions,
} from "../../engine/playtest/HumanVsPolicyController";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import { ViewerAwareGameEventFormatter } from "../../engine/session/playtest/ViewerAwareGameEventFormatter";

describe("Human vs Policy Integration Tests (Phase 2.5)", () => {
  const fullRulePackage = loadRulePackageForBrowser();
  const catalog = loadRegulationCatalogForBrowser();
  const officialEnvId = `${OFFICIAL_ENV_PREFIX}light-entry16`;

  describe("1. Human p1 vs FirstLegal p2 (Official Light + Entry16)", () => {
    it("setup READY となり、AI が意思決定を実行して Human へ操作が返ること (stale stateVersion なし)", async () => {
      const outcome = startMatchAttempt({
        environmentId: officialEnvId,
        seedInput: "20260907",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const seatControllers = createSeatControllers("humanVsAi", "p1", "firstLegal");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, outcome.activeMatch.seed);

      expect(seatControllers.p1.kind).toBe("HUMAN");
      expect(seatControllers.p2.kind).toBe("POLICY");
      expect(policies.p2).toBeDefined();

      let step = outcome.initialStep;
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;

      // 初手が p1 (Human) であることを明示的にアサート
      expect(step.request.playerId).toBe("p1");
      const passPatternRef = step.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(passPatternRef).toBeGreaterThanOrEqual(0);

      const humanResponse = {
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passPatternRef,
      };
      step = outcome.session.submitDecision(humanResponse);

      // 次が p2 (AI) であることを明示的にアサートして自動進行
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;
      expect(step.request.playerId).toBe("p2");

      const aiResult = await advanceAutomatedDecisions(
        outcome.session,
        step,
        seatControllers,
        policies,
        { viewerPlayerId: "p1" }
      );

      expect(aiResult.status).toBe("STOPPED");
      if (aiResult.status === "STOPPED") {
        expect(aiResult.records.length).toBeGreaterThanOrEqual(1);
        for (const rec of aiResult.records) {
          expect(rec.playerId).toBe("p2");
          expect(rec.response.stateVersion).toBe(rec.request.stateVersion);
          expect(rec.response.decisionId).toBe(rec.request.decisionId);
        }
        // Human 手番またはゲーム終了で停止していること
        expect(["HUMAN_TURN", "FINISHED"]).toContain(aiResult.reason);
      }
    });
  });

  describe("2. Human p2 vs FirstLegal p1 (初期 AI 自動処理)", () => {
    it("AI席が初期Decision担当となる場合、開始直後の AI ターンが自動実行され Human 手番で待機すること", async () => {
      const outcome = startMatchAttempt({
        environmentId: officialEnvId,
        seedInput: "20260907",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const aiSeat = "p1";
      const humanSeat = "p2";
      const seatControllers = createSeatControllers("humanVsAi", humanSeat, "firstLegal");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, outcome.activeMatch.seed);

      expect(seatControllers.p1.kind).toBe("POLICY");
      expect(seatControllers.p2.kind).toBe("HUMAN");

      const initialStep = outcome.initialStep;
      expect(initialStep.type).toBe("WAITING_FOR_DECISION");
      if (initialStep.type !== "WAITING_FOR_DECISION") return;

      // AI席 (aiSeat = "p1") が初期 Decision 担当であることを明示的に検証 (空振り防止)
      expect(initialStep.request.playerId).toBe(aiSeat);

      // AI 先行の自動実行
      const aiResult = await advanceAutomatedDecisions(
        outcome.session,
        initialStep,
        seatControllers,
        policies,
        { viewerPlayerId: humanSeat }
      );

      expect(aiResult.status).toBe("STOPPED");
      if (aiResult.status === "STOPPED") {
        expect(aiResult.records.length).toBeGreaterThanOrEqual(1);
        // 停止時点で Human (p2) の手番になっていること
        expect(aiResult.reason).toBe("HUMAN_TURN");
        expect(aiResult.step.type).toBe("WAITING_FOR_DECISION");
        if (aiResult.step.type === "WAITING_FOR_DECISION") {
          expect(aiResult.step.request.playerId).toBe(humanSeat);
        }
      }
    });
  });

  describe("3. Human p1 vs SeededRandom p2 (決定論的再現性)", () => {
    it("同一 matchSeed の対戦で Human が同一操作を行った場合、AI の判断列が完全一致すること", async () => {
      async function runPrefix(seed: string) {
        const outcome = startMatchAttempt({
          environmentId: officialEnvId,
          seedInput: seed,
          catalog,
          fullRulePackage,
        });

        if (outcome.type !== "READY") throw new Error("Match setup failed");

        const seatControllers = createSeatControllers("humanVsAi", "p1", "seededRandom");
        const policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, outcome.activeMatch.seed);

        const humanPolicy = new FirstLegalPolicy();
        let step = outcome.initialStep;
        const aiChoices: number[] = [];
        let loopCount = 0;
        while (aiChoices.length < 3 && step.type === "WAITING_FOR_DECISION" && loopCount < 50) {
          loopCount++;
          if (step.request.playerId === "p1") {
            const resp = humanPolicy.choose(step.request);
            step = outcome.session.submitDecision(resp);
          } else {
            const aiResult = await advanceAutomatedDecisions(
              outcome.session,
              step,
              seatControllers,
              policies,
              { viewerPlayerId: "p1" }
            );
            expect(aiResult.status).toBe("STOPPED");
            if (aiResult.status === "STOPPED") {
              for (const rec of aiResult.records) {
                aiChoices.push(rec.response.selectedPatternRef);
              }
              step = aiResult.step;
            }
          }
        }
        return aiChoices;
      }

      const choicesRunA = await runPrefix("20260907");
      const choicesRunB = await runPrefix("20260907");

      expect(choicesRunA.length).toBeGreaterThanOrEqual(1);
      expect(choicesRunA).toEqual(choicesRunB);
    });
  });

  describe("4. 試合完走テスト (Headless Human vs FirstLegal AI)", () => {
    it("Official Light + Entry16 で 1 試合を通して FINISHED まで正常完走すること", async () => {
      const outcome = startMatchAttempt({
        environmentId: officialEnvId,
        seedInput: "20260907",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const seatControllers = createSeatControllers("humanVsAi", "p1", "firstLegal");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, outcome.activeMatch.seed);
      const humanPolicy = new FirstLegalPolicy();

      let step = outcome.initialStep;
      let decisionsCount = 0;
      const maxDecisions = 200;

      while (step.type === "WAITING_FOR_DECISION" && decisionsCount < maxDecisions) {
        if (step.request.playerId === "p1") {
          // 模擬 Human (FirstLegal)
          const resp = humanPolicy.choose(step.request);
          const prevState = JSON.parse(JSON.stringify(outcome.session.state));
          step = outcome.session.submitDecision(resp);
          const nextState = JSON.parse(JSON.stringify(outcome.session.state));
          ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState, "p1");
          decisionsCount++;
        } else {
          // AI (FirstLegal)
          const aiResult = await advanceAutomatedDecisions(
            outcome.session,
            step,
            seatControllers,
            policies,
            { viewerPlayerId: "p1" }
          );
          expect(aiResult.status).toBe("STOPPED");
          if (aiResult.status === "STOPPED") {
            decisionsCount += aiResult.records.length;
            step = aiResult.step;
          }
        }
      }

      expect(step.type).toBe("FINISHED");
      if (step.type === "FINISHED") {
        expect(step.result.winner).toBeDefined();
        expect(step.result.reason).toBeDefined();
      }
      expect(decisionsCount).toBeLessThan(maxDecisions);
    });
  });

  describe("5. Human vs Human 回帰テスト", () => {
    it("Human vs Human モードでは両者が HUMAN となり、Pass-and-Play で手動進行できること", () => {
      const outcome = startMatchAttempt({
        environmentId: officialEnvId,
        seedInput: "20260907",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const seatControllers = createSeatControllers("humanVsHuman");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers);

      expect(seatControllers.p1.kind).toBe("HUMAN");
      expect(seatControllers.p2.kind).toBe("HUMAN");
      expect(Object.keys(policies).length).toBe(0);

      let step = outcome.initialStep;
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;

      // 手動で 2 手提出
      const p1Resp = {
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: 0,
      };
      step = outcome.session.submitDecision(p1Resp);
      expect(step.type).toBe("WAITING_FOR_DECISION");
    });
  });
});
