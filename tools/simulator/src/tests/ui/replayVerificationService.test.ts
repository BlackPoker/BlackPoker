import { describe, it, expect } from "vitest";
import {
  parseDiagnosticJson,
  mapReplayResultToVerificationOutcome,
  verifyDiagnosticReplayBundleV1,
} from "../../ui/playtest/ReplayVerificationService";
import { buildPlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";
import { createSeatControllers } from "../../engine/playtest/PlaytestSeatController";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController";
import { findFirstDifference } from "../../engine/replay/DeterministicReplayRunner";
import type { PlaytestDecisionTranscriptEntryV1 } from "../../ui/playtest/PlaytestDecisionTranscript";
import type {
  DeterministicReplayResultV1,
  ReplayPlanV1,
} from "../../engine/replay/ReplayTypes";

describe("ReplayVerificationService Tests", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();
  const currentBuild = { sha: "abc1234def", ref: "refs/heads/main" };

  // ヘルパー: 有効なセッションと Diagnostic Bundle を生成
  function createSampleSessionAndBundle(options: {
    numDecisions?: number;
    buildSha?: string;
  }) {
    const buildSha = options.buildSha ?? currentBuild.sha;
    const outcome = startMatchAttempt({
      environmentId: "core-battle",
      seedInput: "",
      catalog,
      fullRulePackage,
    });
    if (outcome.type !== "READY") {
      throw new Error(`Failed to start match: ${outcome.setupNotice.message}`);
    }

    const session = outcome.session;
    let step = outcome.initialStep;
    const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
    const numDecisions = options.numDecisions ?? 2;

    for (let i = 0; i < numDecisions; i++) {
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

    const bundle = buildPlaytestDiagnosticBundleV1({
      build: { sha: buildSha, ref: "refs/heads/main" },
      generatedAt: "2026-09-12T02:00:00.000Z",
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

    return { session, bundle, initialActiveMatch: outcome.activeMatch };
  }

  it("Test A: 正常Bundle → VERIFIED & Summary整合性", () => {
    const { bundle } = createSampleSessionAndBundle({ numDecisions: 2 });
    const outcome = verifyDiagnosticReplayBundleV1(bundle, {
      currentBuildSha: currentBuild.sha,
      catalog,
      fullRulePackage,
    });

    expect(outcome.type).toBe("VERIFIED");
    if (outcome.type === "VERIFIED") {
      expect(outcome.summary.environmentId).toBe("core-battle");
      expect(outcome.summary.sourceBuildSha).toBe(currentBuild.sha);
      expect(outcome.summary.decisionCount).toBe(2);
      expect(outcome.summary.finalStatus).toBe("WAITING_FOR_DECISION");
    }
  });

  it("Test B: Build mismatch → INCOMPATIBLE (BUILD_MISMATCH) & metadata", () => {
    const { bundle } = createSampleSessionAndBundle({
      numDecisions: 1,
      buildSha: "other-build-sha-9999",
    });

    const outcome = verifyDiagnosticReplayBundleV1(bundle, {
      currentBuildSha: currentBuild.sha,
      catalog,
      fullRulePackage,
    });

    expect(outcome.type).toBe("INCOMPATIBLE");
    if (outcome.type === "INCOMPATIBLE") {
      expect(outcome.code).toBe("BUILD_MISMATCH");
      expect(outcome.sourceBuildSha).toBe("other-build-sha-9999");
      expect(outcome.currentBuildSha).toBe(currentBuild.sha);
      expect(outcome.message).toContain("Build SHA mismatch");
    }
  });

  it("Test C: 不正な kind → INCOMPATIBLE (INVALID_KIND)", () => {
    const { bundle } = createSampleSessionAndBundle({ numDecisions: 1 });
    const invalidKindBundle = {
      ...bundle,
      kind: "invalid-kind-string",
    };

    const outcome = verifyDiagnosticReplayBundleV1(invalidKindBundle, {
      currentBuildSha: currentBuild.sha,
      catalog,
      fullRulePackage,
    });

    expect(outcome.type).toBe("INCOMPATIBLE");
    if (outcome.type === "INCOMPATIBLE") {
      expect(outcome.code).toBe("INVALID_KIND");
    }
  });

  it("Test D: 状態不一致 → DIVERGED (STATE_MISMATCH) & differencePath 存在確認（非公開値は非保持）", () => {
    const { bundle } = createSampleSessionAndBundle({ numDecisions: 2 });
    const tamperedBundle = JSON.parse(JSON.stringify(bundle));
    if (tamperedBundle.snapshot.rawState.players?.p1?.hand?.[0]) {
      tamperedBundle.snapshot.rawState.players.p1.hand[0].rank = 999;
    } else {
      tamperedBundle.snapshot.rawState.stateVersion = 999;
    }

    const outcome = verifyDiagnosticReplayBundleV1(tamperedBundle, {
      currentBuildSha: currentBuild.sha,
      catalog,
      fullRulePackage,
    });

    expect(outcome.type).toBe("DIVERGED");
    if (outcome.type === "DIVERGED") {
      expect(outcome.code).toBe("STATE_MISMATCH");
      expect(outcome.differencePath).toBeDefined();
      expect(outcome.differencePath).toMatch(/^\$\./);
      // 秘密情報（expected, actual, rawState）がトップレベルに漏洩していないこと
      expect((outcome as any).rawState).toBeUndefined();
      expect((outcome as any).expected).toBeUndefined();
      expect((outcome as any).actual).toBeUndefined();
    }
  });

  it("Test E: TECHNICAL_ERROR の安全な変換 (Synthetic result による検証)", () => {
    const dummyPlan: ReplayPlanV1 = {
      environmentId: "core-battle",
      sourceBuild: { sha: currentBuild.sha },
      decisions: [],
      expected: { status: "WAITING_FOR_DECISION", rawState: {} },
    };

    const syntheticResult: DeterministicReplayResultV1 = {
      status: "TECHNICAL_ERROR",
      error: "Critical engine assertion failed",
      stack: "Error: at line 123 in private/core/secret.ts\nSECRET_INTERNAL_INFO",
    };

    const outcome = mapReplayResultToVerificationOutcome(syntheticResult, {
      plan: dummyPlan,
      currentBuildSha: currentBuild.sha,
    });

    expect(outcome.type).toBe("TECHNICAL_ERROR");
    if (outcome.type === "TECHNICAL_ERROR") {
      expect(outcome.message).toBe("Critical engine assertion failed");
      // stack や秘密情報が除外されていること
      expect((outcome as any).stack).toBeUndefined();
      expect((outcome as any).rawState).toBeUndefined();
      expect((outcome as any).expected).toBeUndefined();
      expect((outcome as any).actual).toBeUndefined();
    }
  });

  it("Test F: Secret-safe View Model 検証 (全 Outcome で非公開値が除外されていることの網羅検証)", () => {
    const dummyPlan: ReplayPlanV1 = {
      environmentId: "core-battle",
      seed: 42,
      sourceBuild: { sha: currentBuild.sha },
      sourceRulePackage: { id: "pkg-1", version: "1.0.0" },
      decisions: [],
      expected: { status: "WAITING_FOR_DECISION", rawState: { secretHand: [1, 2, 3] } },
    };

    // 1. VERIFIED outcome
    const verifiedOutcome = mapReplayResultToVerificationOutcome(
      {
        status: "VERIFIED",
        executedDecisions: 5,
        totalDecisions: 5,
        finalStepType: "WAITING_FOR_DECISION",
      },
      { plan: dummyPlan, currentBuildSha: currentBuild.sha }
    );
    expect(Object.keys(verifiedOutcome)).toEqual(["type", "summary"]);
    expect(Object.keys((verifiedOutcome as any).summary)).not.toContain("rawState");

    // 2. DIVERGED outcome
    const divergedOutcome = mapReplayResultToVerificationOutcome(
      {
        status: "DIVERGED",
        code: "STATE_MISMATCH",
        message: "State mismatch detected",
        stepIndex: 10,
        decisionSeq: 3,
        difference: {
          path: "$.players.p1.hand[0].rank",
          expected: "SECRET_EXPECTED",
          actual: "SECRET_ACTUAL",
        },
      },
      { plan: dummyPlan, currentBuildSha: currentBuild.sha }
    );
    expect(divergedOutcome.type).toBe("DIVERGED");
    const divergedKeys = Object.keys(divergedOutcome);
    expect(divergedKeys).not.toContain("rawState");
    expect(divergedKeys).not.toContain("expected");
    expect(divergedKeys).not.toContain("actual");
    expect(divergedKeys).not.toContain("difference");
    if (divergedOutcome.type === "DIVERGED") {
      expect(divergedOutcome.differencePath).toBe("$.players.p1.hand[0].rank");
    }

    // 3. INCOMPATIBLE outcome
    const incompatibleOutcome = mapReplayResultToVerificationOutcome(
      {
        status: "INCOMPATIBLE",
        code: "BUILD_MISMATCH",
        message: "Mismatch",
      },
      { plan: dummyPlan, currentBuildSha: currentBuild.sha }
    );
    expect(incompatibleOutcome.type).toBe("INCOMPATIBLE");
    const incompatibleKeys = Object.keys(incompatibleOutcome);
    expect(incompatibleKeys).not.toContain("rawState");
    expect(incompatibleKeys).not.toContain("expected");
    expect(incompatibleKeys).not.toContain("actual");

    // 4. TECHNICAL_ERROR outcome
    const technicalOutcome = mapReplayResultToVerificationOutcome(
      {
        status: "TECHNICAL_ERROR",
        error: "Fatal crash",
        stack: "SECRET_STACK",
      },
      { plan: dummyPlan, currentBuildSha: currentBuild.sha }
    );
    expect(technicalOutcome.type).toBe("TECHNICAL_ERROR");
    const technicalKeys = Object.keys(technicalOutcome);
    expect(technicalKeys).not.toContain("rawState");
    expect(technicalKeys).not.toContain("stack");
  });

  describe("Test G: JSON Parse テスト", () => {
    it("G-1: 正常な JSON 文字列が SUCCESS となること", () => {
      const res = parseDiagnosticJson('{"kind":"test","version":1}');
      expect(res.type).toBe("SUCCESS");
      if (res.type === "SUCCESS") {
        expect(res.value).toEqual({ kind: "test", version: 1 });
      }
    });

    it("G-2: 構文不正な JSON 文字列がサニタイズされた固定メッセージの INVALID_JSON となること", () => {
      const res = parseDiagnosticJson('{"broken": invalid json syntax here}');
      expect(res.type).toBe("INVALID_JSON");
      if (res.type === "INVALID_JSON") {
        // SyntaxError や JSON 断片を含まない固定メッセージ
        expect(res.message).toBe(
          "JSONとして読み込めませんでした。ファイル形式を確認してください。"
        );
      }
    });

    it("G-3: null JSON ('null') は parse 自体は SUCCESS となり value が null で、verify service で INCOMPATIBLE / INVALID_KIND となること", () => {
      const res = parseDiagnosticJson("null");
      expect(res.type).toBe("SUCCESS");
      if (res.type === "SUCCESS") {
        expect(res.value).toBeNull();
      }

      // null を verifyDiagnosticReplayBundleV1 に渡すと INCOMPATIBLE (INVALID_KIND) で安全に処理される
      const outcome = verifyDiagnosticReplayBundleV1(res.type === "SUCCESS" ? res.value : null, {
        currentBuildSha: currentBuild.sha,
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("INCOMPATIBLE");
      if (outcome.type === "INCOMPATIBLE") {
        expect(outcome.code).toBe("INVALID_KIND");
      }
    });

    it("G-4: boolean JSON ('false') は parse SUCCESS となり verify service で INVALID_KIND となること", () => {
      const res = parseDiagnosticJson("false");
      expect(res.type).toBe("SUCCESS");
      if (res.type === "SUCCESS") {
        expect(res.value).toBe(false);
      }

      const outcome = verifyDiagnosticReplayBundleV1(res.type === "SUCCESS" ? res.value : false, {
        currentBuildSha: currentBuild.sha,
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("INCOMPATIBLE");
      if (outcome.type === "INCOMPATIBLE") {
        expect(outcome.code).toBe("INVALID_KIND");
      }
    });

    it("G-5: number JSON ('0') は parse SUCCESS となり verify service で INVALID_KIND となること", () => {
      const res = parseDiagnosticJson("0");
      expect(res.type).toBe("SUCCESS");
      if (res.type === "SUCCESS") {
        expect(res.value).toBe(0);
      }

      const outcome = verifyDiagnosticReplayBundleV1(res.type === "SUCCESS" ? res.value : 0, {
        currentBuildSha: currentBuild.sha,
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("INCOMPATIBLE");
      if (outcome.type === "INCOMPATIBLE") {
        expect(outcome.code).toBe("INVALID_KIND");
      }
    });

    it("G-6: empty string JSON ('\"\"') は parse SUCCESS となり verify service で INVALID_KIND となること", () => {
      const res = parseDiagnosticJson('""');
      expect(res.type).toBe("SUCCESS");
      if (res.type === "SUCCESS") {
        expect(res.value).toBe("");
      }

      const outcome = verifyDiagnosticReplayBundleV1(res.type === "SUCCESS" ? res.value : "", {
        currentBuildSha: currentBuild.sha,
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("INCOMPATIBLE");
      if (outcome.type === "INCOMPATIBLE") {
        expect(outcome.code).toBe("INVALID_KIND");
      }
    });
  });

  it("Test H: Same-build Round Trip (Session進行 → Bundle生成 → JSON.stringify → JSON.parse → Service → VERIFIED)", () => {
    const { bundle } = createSampleSessionAndBundle({ numDecisions: 3 });

    // ファイル保存・読み込みと同等の JSON 文字列化 & パース
    const jsonString = JSON.stringify(bundle);
    const parseResult = parseDiagnosticJson(jsonString);

    expect(parseResult.type).toBe("SUCCESS");
    if (parseResult.type !== "SUCCESS") return;

    const outcome = verifyDiagnosticReplayBundleV1(parseResult.value, {
      currentBuildSha: currentBuild.sha,
      catalog,
      fullRulePackage,
    });

    expect(outcome.type).toBe("VERIFIED");
    if (outcome.type === "VERIFIED") {
      expect(outcome.summary.decisionCount).toBe(3);
      expect(outcome.summary.finalStatus).toBe("WAITING_FOR_DECISION");
    }
  });

  it("Test I: Active Match 非干渉検証 (別セッション進行中に Replay 検証を実行しても元セッション状態が完全不変)", () => {
    // 進行中のセッション A を作成
    const sessionAOutcome = startMatchAttempt({
      environmentId: "core-battle",
      seedInput: "",
      catalog,
      fullRulePackage,
    });
    expect(sessionAOutcome.type).toBe("READY");
    if (sessionAOutcome.type !== "READY") return;

    const sessionA = sessionAOutcome.session;
    sessionA.advance();
    // セッション A の状態スナップショットを取得
    const stateA_before = JSON.parse(JSON.stringify(sessionA.state));

    // 全く別の対戦 B の Diagnostic Bundle を作成
    const { bundle: bundleB } = createSampleSessionAndBundle({ numDecisions: 4 });

    // セッション A が進行中の状態で、Bundle B を Replay 検証
    const outcomeB = verifyDiagnosticReplayBundleV1(bundleB, {
      currentBuildSha: currentBuild.sha,
      catalog,
      fullRulePackage,
    });
    expect(outcomeB.type).toBe("VERIFIED");

    // Replay 検証後、セッション A の状態を再取得して深層比較
    const stateA_after = JSON.parse(JSON.stringify(sessionA.state));
    const diff = findFirstDifference(stateA_before, stateA_after);

    // 1bit の差異もなく完全一致していること
    expect(diff).toBeNull();
  });
});
