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
import TestRenderer, { act } from "react-test-renderer";
import {
  ReplayViewerModal,
  initializeReplayViewerBundle,
  resolveReplayViewerTrailingNormalization,
  resolveActiveReconstructResult,
  resolveRestoredScrollTop,
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

describe("ReplayViewerPresentation Tests (Phase 4.0-B-R2-R1)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();
  const currentBuildSha = "local";
  const dummyOnClose = vi.fn();

  // サンプル対戦 Bundle を生成するヘルパー
  function createSampleBundle(seed: number = 42, decisionTargetCount: number = 1) {
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

    // Decision 実行
    let executed = 0;
    while (executed < decisionTargetCount) {
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type !== "WAITING_FOR_DECISION") break;
      const passIndex = step.request.patterns.findIndex((p) => p.kind === "PASS");
      const resp = {
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIndex >= 0 ? passIndex : 0,
      };
      executed++;
      transcript.push(
        createDecisionTranscriptEntry(executed, {
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

  it("3. renderToString 実行時に render 内部で Replay 再構築・検証が実行されないこと (No Render-Side Reconstruction on Bundle Load)", () => {
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

  it("4. initialBundle からの本物の React Lifecycle (mount -> bundle load -> plan更新 -> 再構築effect -> reconState更新 -> 盤面描画) と render時非実行の検証", () => {
    const bundle = createSampleBundle(42);
    let renderPhaseCalls = 0;
    let effectPhaseCalls = 0;

    const actualReconstructMatch = ReplayReconstructionService.reconstructMatch;
    const reconSpy = vi.spyOn(ReplayReconstructionService, "reconstructMatch").mockImplementation((...args) => {
      const stack = new Error().stack || "";
      // React の renderPhase 中であれば stack に renderWithHooks が含まれる
      if (stack.includes("renderWithHooks")) {
        renderPhaseCalls++;
      } else {
        effectPhaseCalls++;
      }
      return actualReconstructMatch(...args);
    });

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
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
      });

      // 1. render パスでの reconstructMatch 呼び出しは厳密に 0 回であること (useMemo / render body からの完全排除)
      expect(renderPhaseCalls).toBe(0);

      // 2. effect パスによってのみ呼び出されていること (1回以上)
      expect(effectPhaseCalls).toBeGreaterThanOrEqual(1);
      expect(reconSpy).toHaveBeenCalled();

      // 3. 最終的に本物の Lifecycle を経て盤面が正常に描画されていること
      const renderedJson = JSON.stringify(renderer.toJSON());
      expect(renderedJson).toContain("Replay Viewer");
      expect(renderedJson).toContain("現在の対戦");
      expect(renderedJson).toContain("初期盤面（判断実行前）");
      expect(renderedJson).toContain("Player A");
    } finally {
      reconSpy.mockRestore();
    }
  });

  it("5. Decision移動Lifecycle (Decision 0 -> Next -> Decision 1) における Stale State 防止と盤面更新の検証", () => {
    const bundle = createSampleBundle(42);
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
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
    });

    // 初期状態: Decision 0
    expect(JSON.stringify(renderer.toJSON())).toContain("初期盤面（判断実行前）");

    // Next ボタンを取得
    const nextBtn = renderer.root.find((el) => el.props["aria-label"] === "1つ次のDecisionへ");
    expect(nextBtn).toBeDefined();
    expect(nextBtn.props.disabled).toBe(false);

    // 次へ進める
    act(() => {
      nextBtn.props.onClick();
    });

    // Decision 1 に進んだ後の盤面が表示されていること
    const renderedJson = JSON.stringify(renderer.toJSON());
    expect(renderedJson).toContain("Seq #");
    expect(renderedJson).toContain("Player A");
    expect(renderedJson).toContain("選択パターン");
  });

  it("6. 同一 Component Instance での Bundle A -> Bundle B 切替における Stale 破棄・Source 更新・再構築検証", () => {
    const bundleA = createSampleBundle(100);
    const bundleB = createSampleBundle(200);

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(ReplayViewerModal, {
          isOpen: true,
          onClose: dummyOnClose,
          catalog,
          fullRulePackage,
          currentBuildSha,
          initialBundle: bundleA,
          initialSource: "live",
        })
      );
    });

    // Bundle A の状態確認 (Seed 100, Source: "live")
    expect(JSON.stringify(renderer.toJSON())).toContain("現在の対戦");
    expect(renderer.root.findByProps({ matchSeed: 100 })).toBeDefined();

    // 同一インスタンスのまま Bundle B (Seed 200, Source: "json") へ更新
    act(() => {
      renderer.update(
        React.createElement(ReplayViewerModal, {
          isOpen: true,
          onClose: dummyOnClose,
          catalog,
          fullRulePackage,
          currentBuildSha,
          initialBundle: bundleB,
          initialSource: "json",
        })
      );
    });

    // Bundle B の状態へ切り替わっていること
    const renderedJson = JSON.stringify(renderer.toJSON());
    expect(renderedJson).toContain("JSON");
    expect(renderedJson).not.toContain("現在の対戦");
    expect(renderer.root.findByProps({ matchSeed: 200 })).toBeDefined();
    expect(renderer.root.findAllByProps({ matchSeed: 100 }).length).toBe(0);
  });

  it("7. resolveActiveReconstructResult Pure Helper による決定論的解決と Stale State 防止契約", () => {
    const dummyPlanA: ReplayPlanV1 = {
      environmentId: "core-battle",
      sourceBuild: { sha: "test", ref: "test" },
      decisions: [{ seq: 1 } as any, { seq: 2 } as any],
      expected: { status: "WAITING_FOR_DECISION", rawState: {} },
    };
    const dummyPlanB: ReplayPlanV1 = {
      environmentId: "core-battle",
      sourceBuild: { sha: "test", ref: "test" },
      decisions: [{ seq: 1 } as any],
      expected: { status: "WAITING_FOR_DECISION", rawState: {} },
    };

    const mockResult = {
      status: "SUCCESS" as const,
      session: {} as any,
      stepIndex: 1,
      executedDecisions: 1,
      totalDecisions: 2,
      currentStep: { type: "WAITING_FOR_DECISION" } as any,
      currentGameState: {},
      replayedDecisions: [],
    };

    // 1. plan と index が完全一致する場合 -> result を返却
    const stateMatched = {
      plan: dummyPlanA,
      index: 1,
      result: mockResult,
    };
    expect(resolveActiveReconstructResult(stateMatched, dummyPlanA, 1)).toBe(mockResult);

    // 2. index が異なる場合 (ステップ遷移中: 例 index が 1 から 2 へ進んだ直後) -> null を返却して stale 表示を防止
    expect(resolveActiveReconstructResult(stateMatched, dummyPlanA, 2)).toBeNull();
    expect(resolveActiveReconstructResult(stateMatched, dummyPlanA, 0)).toBeNull();

    // 3. plan が異なる場合 (新規ファイル読み込み直後) -> null を返却
    expect(resolveActiveReconstructResult(stateMatched, dummyPlanB, 1)).toBeNull();

    // 4. 現在の plan が null の場合 -> null を返却
    expect(resolveActiveReconstructResult(stateMatched, null, 1)).toBeNull();

    // 5. reconState.result 自体が null の場合 -> null を返却
    const stateNullResult = {
      plan: dummyPlanA,
      index: 1,
      result: null,
    };
    expect(resolveActiveReconstructResult(stateNullResult, dummyPlanA, 1)).toBeNull();
  });

  it("8. 明示的 ReplayViewerSource に応じたバッジ表示契約 (live -> 現在の対戦, json -> JSON, なし -> 非表示)", () => {
    // 8-A: live source
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

    // 8-B: json source
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

    // 8-C: no source
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

  it("9. resolveReplayViewerTrailingNormalization ヘルパーの決定論的判定契約", () => {
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

  it("10. initializeReplayViewerBundle Pure Helper による決定論的状態生成と Stale State 防止契約", () => {
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

  it("11. resolveRestoredScrollTop Pure Helper によるスクロール位置維持と clamp 契約", () => {
    // 1. 0 以下の場合は 0 を返却
    expect(resolveRestoredScrollTop(0, 1000, 400)).toBe(0);
    expect(resolveRestoredScrollTop(-50, 1000, 400)).toBe(0);

    // 2. スクロール領域が画面内に収まる場合（scrollHeight <= clientHeight）は 0 を返却
    expect(resolveRestoredScrollTop(200, 400, 400)).toBe(0);
    expect(resolveRestoredScrollTop(200, 300, 400)).toBe(0);

    // 3. 最大スクロール可能範囲内の場合はそのままの scrollTop を返却
    // maxScroll = 1000 - 400 = 600
    expect(resolveRestoredScrollTop(350, 1000, 400)).toBe(350);

    // 4. 最大スクロール可能範囲を超えている場合は maxScroll に clamp して返却
    expect(resolveRestoredScrollTop(750, 1000, 400)).toBe(600);
  });

  it("12. モバイル表示安定化スタイリング契約 (h-[95dvh] sm:h-auto sm:max-h-[95vh] による高さ崩れとDark Flash防止)", () => {
    const html = renderToString(
      React.createElement(ReplayViewerModal, {
        isOpen: true,
        onClose: dummyOnClose,
        catalog,
        fullRulePackage,
        currentBuildSha,
      })
    );

    // ダイアログ外枠のスタイリング検証
    expect(html).toContain("h-[95dvh]");
    expect(html).toContain("sm:h-auto");
    expect(html).toContain("sm:max-h-[95vh]");
    expect(html).toContain("overflow-y-auto");
  });

  it("13. Step進行時 (0 -> 1 -> 2) における中間ローディング (「盤面を読み込み中...」) 非発生・アトミック更新の検証", () => {
    const bundle = createSampleBundle(42, 2);
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
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
    });

    // 初期状態: Decision 0
    let json = JSON.stringify(renderer.toJSON());
    expect(json).toContain("初期盤面（判断実行前）");
    expect(json).not.toContain("盤面を読み込み中...");

    const nextBtn = renderer.root.find((el) => el.props["aria-label"] === "1つ次のDecisionへ");

    // Decision 0 -> Decision 1 へ進める
    act(() => {
      nextBtn.props.onClick();
    });

    // アトミックに更新され、中間ローディング文言が一切表示されず、Seq # / Player A が描画されること
    json = JSON.stringify(renderer.toJSON());
    expect(json).not.toContain("盤面を読み込み中...");
    expect(json).toContain("Seq #");
    expect(json).toContain("Player A");
    expect(renderer.root.findByProps({ className: "text-sm text-zinc-950" }).children).toEqual(["1"]);

    // Decision 1 -> Decision 2 へ進める
    act(() => {
      nextBtn.props.onClick();
    });

    json = JSON.stringify(renderer.toJSON());
    expect(json).not.toContain("盤面を読み込み中...");
    expect(json).toContain("Seq #");
    expect(renderer.root.findByProps({ className: "text-sm text-zinc-950" }).children).toEqual(["2"]);
  });

  it("14. 各ナビゲーション操作 (Next / Prev / Slider / First) での再構築回数の決定論的検証 (ステップあたり厳密に1回、重複実行なし)", () => {
    const bundle = createSampleBundle(42, 2);
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
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
    });

    const reconSpy = vi.spyOn(ReplayReconstructionService, "reconstructMatch");
    reconSpy.mockClear();

    const nextBtn = renderer.root.find((el) => el.props["aria-label"] === "1つ次のDecisionへ");
    const prevBtn = renderer.root.find((el) => el.props["aria-label"] === "1つ前のDecisionへ");
    const firstBtn = renderer.root.find((el) => el.props["aria-label"] === "最初のDecisionへ");
    const slider = renderer.root.find((el) => el.props.type === "range");

    // 1. Next: 0 -> 1 (呼び出し厳密に1回)
    act(() => {
      nextBtn.props.onClick();
    });
    expect(reconSpy).toHaveBeenCalledTimes(1);

    // 2. Next: 1 -> 2 (呼び出し厳密に1回)
    reconSpy.mockClear();
    act(() => {
      nextBtn.props.onClick();
    });
    expect(reconSpy).toHaveBeenCalledTimes(1);

    // 3. Prev: 2 -> 1 (呼び出し厳密に1回)
    reconSpy.mockClear();
    act(() => {
      prevBtn.props.onClick();
    });
    expect(reconSpy).toHaveBeenCalledTimes(1);

    // 4. First: 1 -> 0 (呼び出し厳密に1回)
    reconSpy.mockClear();
    act(() => {
      firstBtn.props.onClick();
    });
    expect(reconSpy).toHaveBeenCalledTimes(1);

    // 5. Slider: 0 -> 2 (呼び出し厳密に1回)
    reconSpy.mockClear();
    act(() => {
      slider.props.onChange({ target: { value: 2 } });
    });
    expect(reconSpy).toHaveBeenCalledTimes(1);

    // 6. 同一インデックスへの再移動 (2 -> 2): スキップされ呼び出し 0 回
    reconSpy.mockClear();
    act(() => {
      slider.props.onChange({ target: { value: 2 } });
    });
    expect(reconSpy).toHaveBeenCalledTimes(0);

    reconSpy.mockRestore();
  });

  it("15. 自動再生 (Auto-play) タイマー進行時における中間ローディング非発生と自動停止の検証", () => {
    vi.useFakeTimers();
    try {
      const bundle = createSampleBundle(42, 2);
      let renderer!: TestRenderer.ReactTestRenderer;

      act(() => {
        renderer = TestRenderer.create(
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
      });

      const playBtn = renderer.root.find((el) => el.props["aria-label"] === "自動再生");
      expect(playBtn).toBeDefined();

      // 自動再生を開始
      act(() => {
        playBtn.props.onClick();
      });

      // 1200ms 進行 -> Decision 1
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      let json = JSON.stringify(renderer.toJSON());
      expect(json).not.toContain("盤面を読み込み中...");
      expect(json).toContain("Seq #");
      expect(renderer.root.findByProps({ className: "text-sm text-zinc-950" }).children).toEqual(["1"]);

      // さらに 1200ms 進行 -> Decision 2
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      json = JSON.stringify(renderer.toJSON());
      expect(json).not.toContain("盤面を読み込み中...");
      expect(json).toContain("Seq #");
      expect(renderer.root.findByProps({ className: "text-sm text-zinc-950" }).children).toEqual(["2"]);

      // さらに 1200ms 進行 -> 末尾に達したため自動停止
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      const stoppedPlayBtn = renderer.root.find((el) => el.props["aria-label"] === "自動再生");
      expect(stoppedPlayBtn).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
