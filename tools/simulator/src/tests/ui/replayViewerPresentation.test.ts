/**
 * replayViewerPresentation.test.ts
 *
 * BlackPoker Simulator - Phase 4.0-B
 * ReplayViewerModal のプレゼンテーション層、初期表示契約、アクセシビリティ、
 * stale state 防止、エラー表示をテスト。
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import {
  ReplayViewerModal,
  initializeReplayViewerBundle,
  resolveReplayViewerTrailingNormalization,
  ReplayViewerSource,
} from "../../ui/replay/ReplayViewerModal";
import * as ReplayVerificationService from "../../ui/playtest/ReplayVerificationService";
import * as ReplayReconstructionService from "../../engine/replay/ReplayReconstructionService";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController";
import {
  buildPlaytestDiagnosticBundleV1,
  assemblePlaytestDiagnosticBundleParams,
  captureDiagnosticRawState,
  ActivePlaytestSettings,
} from "../../ui/playtest/PlaytestDiagnosticBundle";
import {
  createDecisionTranscriptEntry,
  PlaytestDecisionTranscriptEntryV1,
} from "../../ui/playtest/PlaytestDecisionTranscript";
import { ReplayPlanV1 } from "../../engine/replay/ReplayTypes";

describe("ReplayViewerPresentation Tests (Phase 4.0-B-R1)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();
  const currentBuildSha = "local";
  const dummyOnClose = vi.fn();

  // サンプル対戦 Bundle を生成するヘルパー
  function createSampleBundle(seed: number = 42) {
    const outcome = startMatchAttempt({
      environmentId: "official:standard-pack",
      seedInput: String(seed),
      catalog,
      fullRulePackage,
    });
    if (outcome.type !== "READY") {
      throw new Error(`Failed to start match: ${outcome.setupNotice.message}`);
    }

    const session = outcome.session;
    let step = outcome.initialStep;
    const transcript: PlaytestDecisionTranscriptEntryV1[] = [];

    // 1 Decision 実行
    while (step.type === "PROGRESSED") {
      step = session.advance();
    }
    if (step.type === "WAITING_FOR_DECISION") {
      const passIndex = step.request.patterns.findIndex((p) => p.kind === "PASS");
      const resp = {
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIndex >= 0 ? passIndex : 0,
      };
      transcript.push(
        createDecisionTranscriptEntry(1, {
          actor: "human",
          playerId: step.request.playerId as "p1" | "p2",
          decisionId: resp.decisionId,
          stateVersion: resp.stateVersion,
          response: resp,
        })
      );
      step = session.submitDecision(resp);
    }

    const activeSettings: ActivePlaytestSettings = {
      matchMode: "humanVsHuman",
      humanSeat: "p1",
      policyId: "firstLegal",
    };

    return buildPlaytestDiagnosticBundleV1(
      assemblePlaytestDiagnosticBundleParams({
        build: { sha: "local", ref: "local" },
        generatedAt: new Date().toISOString(),
        activeMatch: outcome.activeMatch,
        activePlaytestSettings: activeSettings,
        activeSeatControllers: { p1: { kind: "HUMAN" }, p2: { kind: "HUMAN" } },
        rawState: captureDiagnosticRawState(session.state),
        logs: [],
        traces: [],
        canonicalMatchLog: session.getMatchLog(),
        currentStep: step,
        decisionTranscript: transcript,
      })
    );
  }

  it("1. isOpen が false の場合は何も描画しないこと", () => {
    const html = renderToString(
      React.createElement(ReplayViewerModal, {
        isOpen: false,
        onClose: dummyOnClose,
        catalog,
        fullRulePackage,
        currentBuildSha,
      })
    );
    expect(html).toBe("");
  });

  it("2. isOpen が true かつ initialBundle がない場合、Empty State（JSON読込待ち）が描画されソースバッジがないこと", () => {
    const html = renderToString(
      React.createElement(ReplayViewerModal, {
        isOpen: true,
        onClose: dummyOnClose,
        catalog,
        fullRulePackage,
        currentBuildSha,
      })
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Replay Viewer"');
    expect(html).toContain("Replay Viewer");
    expect(html).toContain("JSON読込");
    expect(html).toContain('aria-label="閉じる"');
    expect(html).toContain("Replay ファイルが選択されていません");
    expect(html).toContain("右上の「JSON読込」ボタンから Diagnostic Bundle (.json) を選択して対戦履歴を再生してください。");

    // コントロールバーやスライダーは描画されないこと
    expect(html).not.toContain("|◀");
    expect(html).not.toContain("▶ 再生");
    expect(html).not.toContain('type="range"');

    // ソースバッジが存在しないこと
    expect(html).not.toContain("現在の対戦");
  });

  it("3. renderToString 実行時に render 内部で Replay 再構築・検証が実行されないこと (No Render-Side Reconstruction)", () => {
    const bundle = createSampleBundle(42);

    const verifySpy = vi.spyOn(ReplayVerificationService, "verifyDiagnosticReplayBundleV1");
    const reconSpy = vi.spyOn(ReplayReconstructionService, "reconstructMatch");

    try {
      const html = renderToString(
        React.createElement(ReplayViewerModal, {
          isOpen: true,
          onClose: dummyOnClose,
          catalog,
          fullRulePackage,
          currentBuildSha,
          initialBundle: bundle,
          initialSource: "live",
        })
      );

      // useState lazy initializer や render body 内での重い再構築・検証は一切呼ばれていないこと
      expect(verifySpy).toHaveBeenCalledTimes(0);
      expect(reconSpy).toHaveBeenCalledTimes(0);

      // レンダリング自体はクラッシュせず正常に行われること
      expect(html).toContain("Replay Viewer");
      expect(html).toContain("現在の対戦");
    } finally {
      verifySpy.mockRestore();
      reconSpy.mockRestore();
    }
  });

  it("4. 明示的 ReplayViewerSource に応じたバッジ表示契約 (live -> 現在の対戦, json -> JSON, なし -> 非表示)", () => {
    // 4-A: live source
    const htmlLive = renderToString(
      React.createElement(ReplayViewerModal, {
        isOpen: true,
        onClose: dummyOnClose,
        catalog,
        fullRulePackage,
        currentBuildSha,
        initialSource: "live",
      })
    );
    expect(htmlLive).toContain("現在の対戦");

    // 4-B: json source
    const htmlJson = renderToString(
      React.createElement(ReplayViewerModal, {
        isOpen: true,
        onClose: dummyOnClose,
        catalog,
        fullRulePackage,
        currentBuildSha,
        initialSource: "json",
      })
    );
    expect(htmlJson).toContain("JSON");
    expect(htmlJson).not.toContain("現在の対戦");

    // 4-C: no source
    const htmlNone = renderToString(
      React.createElement(ReplayViewerModal, {
        isOpen: true,
        onClose: dummyOnClose,
        catalog,
        fullRulePackage,
        currentBuildSha,
      })
    );
    expect(htmlNone).not.toContain("現在の対戦");
  });

  it("5. resolveReplayViewerTrailingNormalization ヘルパーの決定論的判定契約", () => {
    const dummyDecisions: any[] = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];
    const basePlan: ReplayPlanV1 = {
      environmentId: "core-battle",
      sourceBuild: { sha: "test", ref: "test" },
      decisions: dummyDecisions,
      expected: { status: "WAITING_FOR_DECISION", rawState: {} },
    };

    // 1. expected === WAITING_FOR_DECISION, 末尾 -> EXTERNAL_DECISION_BOUNDARY
    expect(resolveReplayViewerTrailingNormalization(basePlan, 3)).toBe("EXTERNAL_DECISION_BOUNDARY");

    // 2. expected === FINISHED, 末尾 -> EXTERNAL_DECISION_BOUNDARY
    const finishedPlan: ReplayPlanV1 = {
      ...basePlan,
      expected: { status: "FINISHED", rawState: {} },
    };
    expect(resolveReplayViewerTrailingNormalization(finishedPlan, 3)).toBe("EXTERNAL_DECISION_BOUNDARY");

    // 3. expected === PROGRESSED, 末尾手前 -> EXTERNAL_DECISION_BOUNDARY
    const progressedPlan: ReplayPlanV1 = {
      ...basePlan,
      expected: { status: "PROGRESSED", rawState: {} },
    };
    expect(resolveReplayViewerTrailingNormalization(progressedPlan, 2)).toBe("EXTERNAL_DECISION_BOUNDARY");
    expect(resolveReplayViewerTrailingNormalization(progressedPlan, 0)).toBe("EXTERNAL_DECISION_BOUNDARY");

    // 4. expected === PROGRESSED, 末尾 (currentIndex === totalDecisions) -> EXACT_AFTER_TRANSCRIPT
    expect(resolveReplayViewerTrailingNormalization(progressedPlan, 3)).toBe("EXACT_AFTER_TRANSCRIPT");
  });

  it("6. initializeReplayViewerBundle Pure Helper による決定論的状態生成と Stale State 防止契約", () => {
    const bundleA = createSampleBundle(100);
    const bundleB = createSampleBundle(200);

    // 1. Bundle A の初期化
    const stateA = initializeReplayViewerBundle(bundleA, {
      currentBuildSha,
      catalog,
      fullRulePackage,
    });
    expect(stateA.plan).not.toBeNull();
    expect(stateA.plan?.seed).toBe(100);
    expect(stateA.verificationOutcome.type).toBe("VERIFIED");

    // 2. 空/不正 Bundle の初期化 -> 旧 Plan を残さず plan=null かつ INCOMPATIBLE を返却
    const stateInvalid = initializeReplayViewerBundle(null, {
      currentBuildSha,
      catalog,
      fullRulePackage,
    });
    expect(stateInvalid.plan).toBeNull();
    expect(stateInvalid.verificationOutcome.type).toBe("INCOMPATIBLE");

    // 3. Bundle B の初期化 -> 新しい Seed 200 の Plan が構築されること
    const stateB = initializeReplayViewerBundle(bundleB, {
      currentBuildSha,
      catalog,
      fullRulePackage,
    });
    expect(stateB.plan).not.toBeNull();
    expect(stateB.plan?.seed).toBe(200);
    expect(stateB.verificationOutcome.type).toBe("VERIFIED");
  });
});
