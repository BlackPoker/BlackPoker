import { describe, it, expect } from "vitest";
import { buildPlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";
import { createReplayPlanFromDiagnosticBundleV1 } from "../../ui/playtest/DiagnosticReplayAdapter";
import { runDeterministicReplay } from "../../engine/replay/DeterministicReplayRunner";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController";
import { createSeatControllers } from "../../engine/playtest/PlaytestSeatController";
import type { PlaytestDecisionTranscriptEntryV1 } from "../../ui/playtest/PlaytestDecisionTranscript";

describe("Replay Round Trip E2E Tests", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();
  const currentBuild = { sha: "abc1234def", ref: "refs/heads/main" };

  it("Mid-game Diagnostic Bundle → Adapter → DeterministicReplayRunner → VERIFIED", () => {
    // 1. セッション開始
    const outcome = startMatchAttempt({
      environmentId: "core-battle",
      seedInput: "",
      catalog,
      fullRulePackage,
    });
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = outcome.session;
    let step = outcome.initialStep;
    const transcript: PlaytestDecisionTranscriptEntryV1[] = [];

    // 2. 3回の判断を実行し Transcript を記録
    for (let i = 0; i < 3; i++) {
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type !== "WAITING_FOR_DECISION") break;

      const req = step.request;
      transcript.push({
        seq: transcript.length + 1,
        actor: "human",
        playerId: req.playerId as "p1" | "p2",
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        response: {
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 0,
        },
      });

      step = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: 0,
      });
    }

    while (step.type === "PROGRESSED") {
      step = session.advance();
    }

    // 3. buildPlaytestDiagnosticBundleV1 により Diagnostic Bundle を生成
    const bundle = buildPlaytestDiagnosticBundleV1({
      build: currentBuild,
      generatedAt: "2026-09-12T01:00:00.000Z",
      activeMatch: outcome.activeMatch,
      activePlaytestSettings: {
        matchMode: "humanVsHuman",
        humanSeat: "p1",
      },
      seatControllers: createSeatControllers("humanVsHuman"),
      currentStep: step,
      rawState: JSON.parse(JSON.stringify(session.state)),
      decisionTranscript: transcript,
    });

    expect(bundle.kind).toBe("blackpoker-playtest-diagnostic");
    expect(bundle.schemaVersion).toBe(1);

    // 4. createReplayPlanFromDiagnosticBundleV1 により ReplayPlan を生成
    const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, {
      currentBuildSha: currentBuild.sha,
    });

    expect(planResult.type).toBe("READY");
    if (planResult.type !== "READY") return;

    // 5. runDeterministicReplay により決定論的再シミュレーションを実行
    const replayResult = runDeterministicReplay(planResult.plan, {
      catalog,
      fullRulePackage,
    });

    // 6. 検証
    expect(replayResult.status).toBe("VERIFIED");
    if (replayResult.status === "VERIFIED") {
      expect(replayResult.executedDecisions).toBe(3);
      expect(replayResult.totalDecisions).toBe(3);
      expect(replayResult.finalStepType).toBe("WAITING_FOR_DECISION");
    }
  });

  it("Finished Match Diagnostic Bundle → Adapter → DeterministicReplayRunner → VERIFIED", () => {
    // 1. Official Light + Entry16 で完走する対戦を実行
    const outcome = startMatchAttempt({
      environmentId: "official:light-entry16",
      seedInput: "20260907",
      catalog,
      fullRulePackage,
    });
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = outcome.session;
    let step = outcome.initialStep;
    const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
    const maxDecisions = 200;

    while (transcript.length < maxDecisions) {
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type === "FINISHED") break;
      if (step.type !== "WAITING_FOR_DECISION") break;

      const req = step.request;
      transcript.push({
        seq: transcript.length + 1,
        actor: transcript.length % 2 === 0 ? "human" : "policy",
        playerId: req.playerId as "p1" | "p2",
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        response: {
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 0,
        },
      });

      step = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: 0,
      });
    }

    while (step.type === "PROGRESSED") {
      step = session.advance();
    }

    expect(step.type).toBe("FINISHED");
    if (step.type !== "FINISHED") return;

    // 2. FINISHED 時点で Diagnostic Bundle を生成
    const bundle = buildPlaytestDiagnosticBundleV1({
      build: currentBuild,
      generatedAt: "2026-09-12T02:00:00.000Z",
      activeMatch: outcome.activeMatch,
      activePlaytestSettings: {
        matchMode: "humanVsAi",
        humanSeat: "p1",
        policyId: "firstLegal",
      },
      seatControllers: createSeatControllers("humanVsAi", "p1", "firstLegal"),
      currentStep: step,
      rawState: JSON.parse(JSON.stringify(session.state)),
      decisionTranscript: transcript,
    });

    // 3. Adapter で ReplayPlan を生成
    const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, {
      currentBuildSha: currentBuild.sha,
    });

    expect(planResult.type).toBe("READY");
    if (planResult.type !== "READY") return;

    // 4. Replay を実行
    const replayResult = runDeterministicReplay(planResult.plan, {
      catalog,
      fullRulePackage,
    });

    // 5. 完全一致検証
    expect(replayResult.status).toBe("VERIFIED");
    if (replayResult.status === "VERIFIED") {
      expect(replayResult.executedDecisions).toBe(transcript.length);
      expect(replayResult.totalDecisions).toBe(transcript.length);
      expect(replayResult.finalStepType).toBe("FINISHED");
    }
  });
});
