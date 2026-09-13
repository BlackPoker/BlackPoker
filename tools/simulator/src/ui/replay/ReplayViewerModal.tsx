import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { RegulationCatalog } from "../../domain/regulation/RegulationDefinition";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { reconstructMatch, ReconstructMatchResult } from "../../engine/replay/ReplayReconstructionService";
import type { ReplayPlanV1 } from "../../engine/replay/ReplayTypes";
import { PlayerObservationPresenter } from "../game/PlayerObservationPresenter";
import { PlayerBoard } from "../game/PlayerBoard";
import { GameStatusBar } from "../game/GameStatusBar";
import { StagePanel } from "../game/StagePanel";
import { BattleRelationPresenter } from "../game/BattleRelationPresenter";
import {
  parseDiagnosticJson,
  verifyDiagnosticReplayBundleV1,
  ReplayVerificationOutcome,
} from "../playtest/ReplayVerificationService";
import { createReplayPlanFromDiagnosticBundleV1 } from "../playtest/DiagnosticReplayAdapter";

export interface ReplayViewerModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly catalog: RegulationCatalog;
  readonly fullRulePackage: RulePackage;
  readonly currentBuildSha: string;
  readonly initialBundle?: unknown;
}

export const ReplayViewerModal: React.FC<ReplayViewerModalProps> = ({
  isOpen,
  onClose,
  catalog,
  fullRulePackage,
  currentBuildSha,
  initialBundle,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [rawBundle, setRawBundle] = useState<unknown | null>(initialBundle ?? null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ReplayPlanV1 | null>(null);
  const [verificationOutcome, setVerificationOutcome] = useState<ReplayVerificationOutcome | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [viewerPerspective, setViewerPerspective] = useState<"p1" | "p2">("p1");

  // 初期バンドルの読み込み処理
  const loadBundle = (bundle: unknown) => {
    setParseError(null);
    setRawBundle(bundle);

    // 1. Adapter による Plan 生成
    const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, { currentBuildSha });
    if (planResult.type === "INCOMPATIBLE") {
      setPlan(null);
      setVerificationOutcome({
        type: "INCOMPATIBLE",
        code: planResult.code,
        message: planResult.message,
        currentBuildSha,
      });
      return;
    }

    setPlan(planResult.plan);
    setCurrentIndex(0);
    setIsPlaying(false);

    // 2. Full Verification
    const outcome = verifyDiagnosticReplayBundleV1(bundle, {
      currentBuildSha,
      catalog,
      fullRulePackage,
    });
    setVerificationOutcome(outcome);
  };

  useEffect(() => {
    if (isOpen && initialBundle) {
      loadBundle(initialBundle);
    }
  }, [isOpen, initialBundle]);

  // モーダルクローズ時やEscapeキー
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // ファイル変更ハンドラ
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const parseResult = parseDiagnosticJson(text);
      if (parseResult.type === "SUCCESS") {
        loadBundle(parseResult.value);
      } else {
        setParseError(parseResult.message);
        setPlan(null);
        setRawBundle(null);
        setVerificationOutcome(null);
      }
    } catch {
      setParseError("ファイルの読み込み中にエラーが発生しました。");
      setPlan(null);
      setRawBundle(null);
      setVerificationOutcome(null);
    }
  };

  const totalDecisions = plan?.decisions?.length ?? 0;

  // DIVERGED 時でも発散前のステップまでは閲覧可能とする
  const maxViewableIndex = useMemo(() => {
    if (!plan) return 0;
    if (verificationOutcome?.type === "DIVERGED" && verificationOutcome.decisionSeq !== undefined) {
      // decisionSeq は 1-indexed。エラーが起きた Decision より手前まで閲覧可能
      return Math.max(0, verificationOutcome.decisionSeq - 1);
    }
    return totalDecisions;
  }, [plan, verificationOutcome, totalDecisions]);

  // 自動再生タイマー
  useEffect(() => {
    if (!isPlaying || !plan) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev < maxViewableIndex) {
          return prev + 1;
        } else {
          setIsPlaying(false);
          return prev;
        }
      });
    }, 1200);
    return () => clearInterval(interval);
  }, [isPlaying, plan, maxViewableIndex]);

  // 現在の index に対する再構築
  const reconResult: ReconstructMatchResult | null = useMemo(() => {
    if (!plan) return null;
    return reconstructMatch({
      environmentId: plan.environmentId,
      seed: plan.seed,
      transcript: plan.decisions,
      decisionCount: currentIndex,
      catalog,
      fullRulePackage,
      expectedRulePackage: plan.sourceRulePackage,
    });
  }, [plan, currentIndex, catalog, fullRulePackage]);

  // 直前の Decision 情報およびカタログ正式参照からの Action / Effect 表示 (index > 0 のとき)
  const lastExecutedDecision = useMemo(() => {
    if (!plan || currentIndex === 0) return null;
    const entry = plan.decisions[currentIndex - 1] ?? null;
    if (!entry) return null;

    let actionLabel: string | undefined = undefined;
    if (reconResult?.status === "SUCCESS" && reconResult.replayedDecisions) {
      const executed = reconResult.replayedDecisions[currentIndex - 1];
      if (executed) {
        const pattern = executed.request.patterns?.[executed.entry.response.selectedPatternRef];
        if (pattern) {
          if (pattern.kind === "PASS") {
            actionLabel = "パス";
          } else if (pattern.kind === "ACTION") {
            if (
              pattern.actionSelectionRef !== undefined &&
              executed.request.catalog?.actions?.[pattern.actionSelectionRef]
            ) {
              actionLabel = executed.request.catalog.actions[pattern.actionSelectionRef].actionName;
            } else {
              actionLabel = "アクション";
            }
          } else if (pattern.kind === "EFFECT_SELECTION") {
            if (
              pattern.effectSelectionRef !== undefined &&
              executed.request.catalog?.effectSelections?.[pattern.effectSelectionRef]?.summary
            ) {
              actionLabel = executed.request.catalog.effectSelections[pattern.effectSelectionRef].summary;
            } else {
              actionLabel = "効果解決";
            }
          } else {
            actionLabel = pattern.kind;
          }
        }
      }
    }

    return {
      ...entry,
      actionLabel,
    };
  }, [plan, currentIndex, reconResult]);

  // ナビゲーション操作
  const handleFirst = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
  };
  const handlePrev = () => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  };
  const handleNext = () => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.min(maxViewableIndex, prev + 1));
  };
  const handleLast = () => {
    setIsPlaying(false);
    setCurrentIndex(maxViewableIndex);
  };

  if (!isOpen) return null;

  // 盤面の Presentation 生成 (Observation 境界を厳格に保持)
  let topViewModel = null;
  let bottomViewModel = null;
  let allPlayersFog: readonly any[] = [];
  let battleRelationMap: Map<string, any> = new Map();

  if (reconResult?.status === "SUCCESS" && reconResult.currentGameState) {
    const obs = ObservationFactory.createObservation(reconResult.currentGameState, viewerPerspective);
    const topPlayerKey = viewerPerspective === "p1" ? "p2" : "p1";
    const bottomPlayerKey = viewerPerspective;

    allPlayersFog = (obs.players || []).flatMap((p) => p.fog || []);
    battleRelationMap = BattleRelationPresenter.buildPresentationMap(reconResult.currentGameState, obs);

    topViewModel = PlayerObservationPresenter.buildPlayerViewModel(
      topPlayerKey,
      obs,
      reconResult.currentGameState,
      viewerPerspective
    );
    bottomViewModel = PlayerObservationPresenter.buildPlayerViewModel(
      bottomPlayerKey,
      obs,
      reconResult.currentGameState,
      viewerPerspective
    );
  }

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Replay Viewer"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-zinc-950/70 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-4xl max-h-[95vh] flex flex-col bg-white rounded-xl shadow-2xl border border-zinc-200 overflow-hidden font-sans">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 text-white border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
              REPLAY 1.0
            </span>
            <h2 className="text-sm sm:text-base font-bold tracking-tight">
              Replay Viewer
            </h2>
            {verificationOutcome && (
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                  verificationOutcome.type === "VERIFIED"
                    ? "bg-emerald-950/80 text-emerald-300 border-emerald-700"
                    : verificationOutcome.type === "DIVERGED"
                    ? "bg-red-950/80 text-red-300 border-red-700"
                    : "bg-amber-950/80 text-amber-300 border-amber-700"
                }`}
              >
                {verificationOutcome.type}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* ファイル読み込みボタン */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1 text-xs font-mono font-bold rounded bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 border border-zinc-700 transition"
            >
              JSON読込
            </button>
            <button
              onClick={onClose}
              aria-label="閉じる"
              className="w-7 h-7 rounded flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition text-sm"
            >
              ✕
            </button>
          </div>
        </div>

        {/* コントロールバー */}
        {plan && (
          <div className="bg-zinc-50 border-b border-zinc-200 p-2 sm:p-3 shrink-0 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* ナビゲーションボタン群 */}
              <div className="flex items-center gap-1 sm:gap-1.5">
                <button
                  onClick={handleFirst}
                  disabled={currentIndex === 0}
                  title="最初へ"
                  aria-label="最初のDecisionへ"
                  className="w-9 h-8 sm:w-10 sm:h-9 rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-white text-zinc-800 font-bold text-xs flex items-center justify-center transition shadow-sm"
                >
                  |◀
                </button>
                <button
                  onClick={handlePrev}
                  disabled={currentIndex === 0}
                  title="1つ前へ"
                  aria-label="1つ前のDecisionへ"
                  className="w-9 h-8 sm:w-10 sm:h-9 rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-white text-zinc-800 font-bold text-xs flex items-center justify-center transition shadow-sm"
                >
                  ◀
                </button>
                <button
                  onClick={() => setIsPlaying((p) => !p)}
                  disabled={currentIndex >= maxViewableIndex}
                  title={isPlaying ? "一時停止" : "自動再生"}
                  aria-label={isPlaying ? "一時停止" : "自動再生"}
                  className={`px-3 h-8 sm:h-9 rounded font-mono font-bold text-xs flex items-center justify-center gap-1 transition shadow-sm border ${
                    isPlaying
                      ? "bg-amber-600 border-amber-700 text-white hover:bg-amber-700"
                      : "bg-zinc-900 border-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-zinc-900"
                  }`}
                >
                  <span>{isPlaying ? "⏸ 停止" : "▶ 再生"}</span>
                </button>
                <button
                  onClick={handleNext}
                  disabled={currentIndex >= maxViewableIndex}
                  title="1つ次へ"
                  aria-label="1つ次のDecisionへ"
                  className="w-9 h-8 sm:w-10 sm:h-9 rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-white text-zinc-800 font-bold text-xs flex items-center justify-center transition shadow-sm"
                >
                  ▶
                </button>
                <button
                  onClick={handleLast}
                  disabled={currentIndex >= maxViewableIndex}
                  title="最後へ"
                  aria-label="最後のDecisionへ"
                  className="w-9 h-8 sm:w-10 sm:h-9 rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-white text-zinc-800 font-bold text-xs flex items-center justify-center transition shadow-sm"
                >
                  ▶|
                </button>
              </div>

              {/* 現在位置インジケータ */}
              <div className="flex items-center gap-3">
                <div className="text-xs font-mono font-bold text-zinc-800">
                  Decision <span className="text-sm text-zinc-950">{currentIndex}</span> / {totalDecisions}
                  {currentIndex === 0 && <span className="text-zinc-500 font-normal ml-1">(初期状態)</span>}
                </div>

                {/* 視点切替 (Observation 境界を維持) */}
                <div className="flex items-center rounded border border-zinc-300 bg-zinc-200/60 p-0.5 text-xs font-mono">
                  <button
                    onClick={() => setViewerPerspective("p1")}
                    className={`px-2 py-0.5 rounded transition ${
                      viewerPerspective === "p1"
                        ? "bg-white font-bold text-zinc-950 shadow-sm"
                        : "text-zinc-600 hover:text-zinc-950"
                    }`}
                  >
                    Player A 視点
                  </button>
                  <button
                    onClick={() => setViewerPerspective("p2")}
                    className={`px-2 py-0.5 rounded transition ${
                      viewerPerspective === "p2"
                        ? "bg-white font-bold text-zinc-950 shadow-sm"
                        : "text-zinc-600 hover:text-zinc-950"
                    }`}
                  >
                    Player B 視点
                  </button>
                </div>
              </div>
            </div>

            {/* シークバー (スライダー) */}
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={maxViewableIndex}
                value={currentIndex}
                onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentIndex(Number(e.target.value));
                }}
                className="w-full accent-zinc-950 cursor-pointer"
              />
            </div>

            {/* Decision 情報カード */}
            {lastExecutedDecision ? (
              <div className="p-2 rounded bg-zinc-100/90 border border-zinc-200 text-xs font-mono flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-zinc-900 bg-white px-1.5 py-0.5 rounded border border-zinc-300">
                    Seq #{lastExecutedDecision.seq}
                  </span>
                  <span className="font-bold text-zinc-800">
                    {lastExecutedDecision.playerId === "p1" ? "Player A" : "Player B"}
                  </span>
                  <span className="text-zinc-500">
                    ({lastExecutedDecision.actor})
                  </span>
                  {lastExecutedDecision.actionLabel && (
                    <span className="font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                      {lastExecutedDecision.actionLabel}
                    </span>
                  )}
                  <span className="text-zinc-700">
                    選択パターン: #{lastExecutedDecision.response.selectedPatternRef}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500">
                  StateVer: {lastExecutedDecision.response.stateVersion}
                </div>
              </div>
            ) : (
              <div className="p-1.5 rounded bg-zinc-100/60 border border-zinc-200 text-xs font-mono text-zinc-500">
                初期盤面（判断実行前）
              </div>
            )}
          </div>
        )}

        {/* メインコンテンツ領域 */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4 flex flex-col gap-3">
          {parseError && (
            <div className="p-3 rounded border border-red-200 bg-red-50 text-red-800 text-xs font-mono">
              ✕ {parseError}
            </div>
          )}

          {!plan && !parseError && (
            <div className="p-8 text-center flex flex-col items-center justify-center gap-3">
              <div className="text-zinc-400 text-3xl font-mono">📋</div>
              <div className="text-sm font-bold text-zinc-800">Replay ファイルが選択されていません</div>
              <div className="text-xs text-zinc-500 max-w-sm">
                右上の「JSON読込」ボタンから Diagnostic Bundle (.json) を選択して対戦履歴を再生してください。
              </div>
            </div>
          )}

          {plan && reconResult?.status === "DIVERGED" && (
            <div className="p-3 rounded border border-red-200 bg-red-50 text-xs text-red-900 font-mono">
              <div className="font-bold mb-1">✕ Replay Diverged at Decision #{reconResult.decisionSeq ?? currentIndex}</div>
              <div>{reconResult.message}</div>
              {reconResult.difference && (
                <div className="text-[11px] mt-1 text-red-700">
                  Path: {reconResult.difference.path}
                </div>
              )}
            </div>
          )}

          {plan && reconResult?.status === "SUCCESS" && topViewModel && bottomViewModel && (
            <div className="flex flex-col gap-2">
              {/* ゲーム進行ステータスバー */}
              <GameStatusBar
                environmentName={plan.environmentId}
                matchSeed={plan.seed}
                stateVersion={reconResult.currentGameState.stateVersion ?? reconResult.currentGameState.version}
                turnPlayer={reconResult.currentGameState.turnPlayer}
                chancePlayer={reconResult.currentGameState.chancePlayer}
                turnCount={reconResult.currentGameState.turnCount || 1}
                players={reconResult.currentGameState.players || {}}
                latestEventMessage={undefined}
              />

              {/* 対向プレイヤー (Top) */}
              <PlayerBoard
                playerKey={viewerPerspective === "p1" ? "p2" : "p1"}
                viewModel={topViewModel}
                position="top"
                allPlayersFog={allPlayersFog}
                battleRelationMap={battleRelationMap}
              />

              {/* 中央 STAGE パネル */}
              <StagePanel
                requests={reconResult.currentGameState?.stage?.requests || []}
                highlightedRequestId={null}
                battleRelationMap={battleRelationMap}
                viewerPlayerId={viewerPerspective}
              />

              {/* 手前プレイヤー (Bottom) */}
              <PlayerBoard
                playerKey={viewerPerspective}
                viewModel={bottomViewModel}
                position="bottom"
                allPlayersFog={allPlayersFog}
                battleRelationMap={battleRelationMap}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return modalContent;
  }
  return createPortal(modalContent, document.body);
};
