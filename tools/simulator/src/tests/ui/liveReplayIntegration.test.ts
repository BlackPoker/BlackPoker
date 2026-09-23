/**
 * liveReplayIntegration.test.ts
 *
 * BlackPoker Simulator - Phase 4.0-B
 * 進行中対戦および終了済み対戦から生成された In-Memory Diagnostic Bundle を
 * Replay Viewer 基盤へ直接接続した際の決定論的再現性・非破壊性・検証をテスト。
 */

import { describe, it, expect } from "vitest";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController";
import { createSeatControllers } from "../../engine/playtest/PlaytestSeatController";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";
import {
  createDecisionTranscriptEntry,
  createAutomatedDecisionTranscriptEntries,
  PlaytestDecisionTranscriptEntryV1,
} from "../../ui/playtest/PlaytestDecisionTranscript";
import {
  buildPlaytestDiagnosticBundleV1,
  assemblePlaytestDiagnosticBundleParams,
  captureDiagnosticRawState,
  ActivePlaytestSettings,
} from "../../ui/playtest/PlaytestDiagnosticBundle";
import { createReplayPlanFromDiagnosticBundleV1 } from "../../ui/playtest/DiagnosticReplayAdapter";
import { verifyDiagnosticReplayBundleV1 } from "../../ui/playtest/ReplayVerificationService";
import { reconstructMatch } from "../../engine/replay/ReplayReconstructionService";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { advanceAutomatedDecisions } from "../../engine/playtest/HumanVsPolicyController";

describe("Live Match Direct Replay Integration Tests (Phase 4.0-B)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();
  const build = { sha: "local", ref: "local" };
  const currentBuildSha = "local";

  it("1. 進行中対戦 (Ongoing Match) からの直接 Replay: VERIFIED かつ StateHash 完全一致・非破壊性", async () => {
    const environmentId = "official:standard-pack";
    const testSeed = 20260923;

    // 1. Official Standard + Pack で対戦開始 (Human vs AI)
    const outcome = startMatchAttempt({
      environmentId,
      seedInput: String(testSeed),
      catalog,
      fullRulePackage,
    });
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = outcome.session;
    const activeMatch = outcome.activeMatch;
    let step = outcome.initialStep;

    const activeSettings: ActivePlaytestSettings = {
      matchMode: "humanVsAi",
      humanSeat: "p1",
      policyId: "firstLegal",
    };
    const seatControllers = createSeatControllers(
      activeSettings.matchMode,
      activeSettings.humanSeat,
      activeSettings.policyId
    );
    const policies = PlaytestPolicyFactory.createPoliciesForMatch(
      seatControllers,
      activeMatch.seed
    );

    const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
    let seq = 1;

    // 2. 数 Decision を進行 (Human の PASS またはアクション -> AI 自動進行)
    for (let turn = 0; turn < 4; turn++) {
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type !== "WAITING_FOR_DECISION") break;

      if (step.request.playerId === "p1") {
        // Human 側は PASS を選択
        const passRef = step.request.patterns.findIndex((p) => p.kind === "PASS");
        expect(passRef).toBeGreaterThanOrEqual(0);
        const resp = {
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        };
        step = session.submitDecision(resp);
        transcript.push(
          createDecisionTranscriptEntry(seq++, {
            actor: "human",
            playerId: "p1",
            decisionId: resp.decisionId,
            stateVersion: resp.stateVersion,
            response: resp,
          })
        );
      } else {
        // AI 側は advanceAutomatedDecisions
        const aiResult = await advanceAutomatedDecisions(
          session,
          step,
          seatControllers,
          policies,
          { viewerPlayerId: "p1" }
        );
        expect(aiResult.status).toBe("STOPPED");
        if (aiResult.status !== "STOPPED") {
          throw new Error("AI decision did not stop normally");
        }
        const { entries, nextSeq } = createAutomatedDecisionTranscriptEntries(seq, aiResult.records);
        transcript.push(...entries);
        seq = nextSeq;
        step = aiResult.step;
      }
    }

    expect(transcript.length).toBeGreaterThan(0);

    // 進行中の状態ハッシュと生状態を記録
    const liveSourceStateHash = StateHasher.hash(session.state);
    const transcriptLengthBefore = transcript.length;
    const rawState = captureDiagnosticRawState(session.state);

    // 3. Current Diagnostic Bundle を生成 (CoreBattlePlaytest と同一ロジック)
    const bundle = buildPlaytestDiagnosticBundleV1(
      assemblePlaytestDiagnosticBundleParams({
        build,
        generatedAt: new Date().toISOString(),
        activeMatch,
        activePlaytestSettings: activeSettings,
        activeSeatControllers: seatControllers,
        rawState,
        logs: [],
        traces: [],
        canonicalMatchLog: session.getMatchLog(),
        currentStep: step,
        decisionTranscript: transcript,
      })
    );

    // 4. DiagnosticReplayAdapter による Plan 生成確認
    const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, { currentBuildSha });
    expect(planResult.type).toBe("READY");
    if (planResult.type !== "READY") return;
    const plan = planResult.plan;

    expect(plan.environmentId).toBe(environmentId);
    expect(plan.seed).toBe(testSeed);
    expect(plan.decisions.length).toBe(transcript.length);

    // 5. Replay Verification が VERIFIED であること
    const verification = verifyDiagnosticReplayBundleV1(bundle, {
      currentBuildSha,
      catalog,
      fullRulePackage,
    });
    expect(verification.type).toBe("VERIFIED");

    // 6. Decision 0 (初期状態) への再構築が成功すること
    const reconInitial = reconstructMatch({
      environmentId: plan.environmentId,
      seed: plan.seed,
      transcript: plan.decisions,
      decisionCount: 0,
      catalog,
      fullRulePackage,
      expectedRulePackage: plan.sourceRulePackage,
    });
    expect(reconInitial.status).toBe("SUCCESS");
    if (reconInitial.status === "SUCCESS") {
      expect(reconInitial.executedDecisions).toBe(0);
      expect(reconInitial.totalDecisions).toBe(transcript.length);
    }

    // 7. Decision N (最終現在地点) への再構築が成功すること
    const reconLast = reconstructMatch({
      environmentId: plan.environmentId,
      seed: plan.seed,
      transcript: plan.decisions,
      decisionCount: plan.decisions.length,
      catalog,
      fullRulePackage,
      expectedRulePackage: plan.sourceRulePackage,
    });
    expect(reconLast.status).toBe("SUCCESS");
    if (reconLast.status === "SUCCESS") {
      expect(reconLast.executedDecisions).toBe(plan.decisions.length);

      // 8. Source Session StateHash と Reconstructed Last StateHash の完全一致
      const replayLastStateHash = StateHasher.hash(reconLast.currentGameState);
      expect(replayLastStateHash).toBe(liveSourceStateHash);

      // 進行中判断待機ステップの一致
      if (step.type === "WAITING_FOR_DECISION") {
        expect(reconLast.currentStep?.type).toBe("WAITING_FOR_DECISION");
      }
    }

    // 9. 非破壊性の保証: Replay 再構築・シークを行っても元の session.state と transcript は不変
    expect(StateHasher.hash(session.state)).toBe(liveSourceStateHash);
    expect(transcript.length).toBe(transcriptLengthBefore);
  });

  it("2. 終了済み対戦 (Finished Match) からの直接 Replay: 勝者・終了理由・最終StateHash一致", async () => {
    const environmentId = "official:light-entry16";
    const testSeed = 20260907;

    const outcome = startMatchAttempt({
      environmentId,
      seedInput: String(testSeed),
      catalog,
      fullRulePackage,
    });
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = outcome.session;
    const activeMatch = outcome.activeMatch;
    let step = outcome.initialStep;

    const activeSettings: ActivePlaytestSettings = {
      matchMode: "humanVsAi",
      humanSeat: "p1",
      policyId: "firstLegal",
    };
    const seatControllers = createSeatControllers(
      activeSettings.matchMode,
      activeSettings.humanSeat,
      activeSettings.policyId
    );
    const policies = PlaytestPolicyFactory.createPoliciesForMatch(
      seatControllers,
      activeMatch.seed
    );

    const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
    let seq = 1;

    // 対戦終了まで自動進行
    let guard = 0;
    while (step.type !== "FINISHED" && guard++ < 300) {
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type === "FINISHED") break;

      if (step.type === "WAITING_FOR_DECISION") {
        const currentPol = policies[step.request.playerId];
        const chosen = currentPol
          ? currentPol.choose(step.request)
          : {
              decisionId: step.request.decisionId,
              stateVersion: step.request.stateVersion,
              selectedPatternRef: 0,
            };

        transcript.push(
          createDecisionTranscriptEntry(seq++, {
            actor: step.request.playerId === "p1" ? "human" : "policy",
            playerId: step.request.playerId as "p1" | "p2",
            decisionId: chosen.decisionId,
            stateVersion: chosen.stateVersion,
            response: chosen,
          })
        );
        step = session.submitDecision(chosen);
      }
    }

    while (step.type === "PROGRESSED") {
      step = session.advance();
    }

    expect(step.type).toBe("FINISHED");
    if (step.type !== "FINISHED") return;

    const finishedSourceHash = StateHasher.hash(session.state);
    const expectedWinner = step.result.winner;
    const expectedReason = step.result.reason;

    const bundle = buildPlaytestDiagnosticBundleV1(
      assemblePlaytestDiagnosticBundleParams({
        build,
        generatedAt: new Date().toISOString(),
        activeMatch,
        activePlaytestSettings: activeSettings,
        activeSeatControllers: seatControllers,
        rawState: captureDiagnosticRawState(session.state),
        logs: [],
        traces: [],
        canonicalMatchLog: session.getMatchLog(),
        currentStep: step,
        decisionTranscript: transcript,
      })
    );

    // Replay Verification
    const verification = verifyDiagnosticReplayBundleV1(bundle, {
      currentBuildSha,
      catalog,
      fullRulePackage,
    });
    expect(verification.type).toBe("VERIFIED");

    // Replay 末尾 (FINISHED) の再構築
    const reconLast = reconstructMatch({
      environmentId,
      seed: testSeed,
      transcript,
      decisionCount: transcript.length,
      catalog,
      fullRulePackage,
    });
    expect(reconLast.status).toBe("SUCCESS");
    if (reconLast.status === "SUCCESS") {
      expect(reconLast.currentStep?.type).toBe("FINISHED");
      if (reconLast.currentStep?.type === "FINISHED") {
        expect(reconLast.currentStep.result.winner).toBe(expectedWinner);
        expect(reconLast.currentStep.result.reason).toBe(expectedReason);
      }
      expect(StateHasher.hash(reconLast.currentGameState)).toBe(finishedSourceHash);
    }
  });

  it("3. Replay における Observation Privacy 境界の保証 (相手側の非公開情報の隠蔽)", () => {
    const environmentId = "official:standard-pack";
    const testSeed = 987654321;

    const outcome = startMatchAttempt({
      environmentId,
      seedInput: String(testSeed),
      catalog,
      fullRulePackage,
    });
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    // 初期状態で p1 視点 Observation を生成
    const obsP1 = ObservationFactory.createObservation(outcome.session.state, "p1");
    const p1DataFromP1 = obsP1.players?.find((p: any) => p.playerId === "p1");
    const p2DataFromP1 = obsP1.players?.find((p: any) => p.playerId === "p2");

    expect(p1DataFromP1).toBeDefined();
    expect(p2DataFromP1).toBeDefined();

    if (p1DataFromP1 && p2DataFromP1) {
      expect(Array.isArray(p1DataFromP1.handCards)).toBe(true);
      expect(Array.isArray(p2DataFromP1.handCards)).toBe(true);
      for (const card of p2DataFromP1.handCards) {
        expect(card.visibility).toBe("HIDDEN");
        expect((card as any).suit).toBeUndefined();
        expect((card as any).rank).toBeUndefined();
      }
      for (const card of p1DataFromP1.handCards) {
        expect(card.visibility).toBe("KNOWN");
        expect((card as any).suit).toBeDefined();
      }
    }

    // p2 視点 Observation を生成
    const obsP2 = ObservationFactory.createObservation(outcome.session.state, "p2");
    const p1DataFromP2 = obsP2.players?.find((p: any) => p.playerId === "p1");
    const p2DataFromP2 = obsP2.players?.find((p: any) => p.playerId === "p2");

    expect(p1DataFromP2).toBeDefined();
    expect(p2DataFromP2).toBeDefined();

    if (p1DataFromP2 && p2DataFromP2) {
      for (const card of p1DataFromP2.handCards) {
        expect(card.visibility).toBe("HIDDEN");
        expect((card as any).suit).toBeUndefined();
        expect((card as any).rank).toBeUndefined();
      }
      for (const card of p2DataFromP2.handCards) {
        expect(card.visibility).toBe("KNOWN");
        expect((card as any).suit).toBeDefined();
      }
    }
  });
});
