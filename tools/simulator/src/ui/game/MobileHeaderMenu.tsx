import React from "react";
import { EnvironmentOption, extractRegulationId } from "../../engine/playtest/PlaytestEnvironmentController";
import {
  PlaytestMatchMode,
  PlaytestPolicyId,
  PLAYTEST_POLICY_OPTIONS,
} from "../../engine/playtest/PlaytestSeatController";

import { PlaytestSeedMode } from "../playtest/PlaytestSeed";
import { FontScalePercentage } from "../preferences/PlaytestUserPreferences";

export interface MobileHeaderMenuProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedEnvironmentId: string;
  readonly onSelectEnvironment: (envId: string) => void;
  readonly environmentOptions: readonly EnvironmentOption[];
  readonly activeMatchSeed?: number;
  readonly seedMode?: PlaytestSeedMode;
  readonly onSeedModeChange?: (mode: PlaytestSeedMode) => void;
  readonly pendingAutoSeed?: number;
  readonly showSeedInput: boolean;
  readonly seedInput?: string;
  readonly onSeedInputChange?: (val: string) => void;
  readonly matchMode: PlaytestMatchMode;
  readonly onSelectMatchMode: (mode: PlaytestMatchMode) => void;
  readonly policyId: PlaytestPolicyId;
  readonly onSelectPolicyId: (id: PlaytestPolicyId) => void;
  readonly isOfficialEnvironment: boolean;
  readonly enablePassAndPlay: boolean;
  readonly onTogglePassAndPlay: (val: boolean) => void;
  readonly onOpenLogModal: () => void;
  readonly onOpenDebugModal: () => void;
  readonly onResetGame: () => void;
  readonly onCopyShareUrl?: () => void;
  readonly shareNotice?: { readonly type: "success" | "error" | "warning" | "info"; readonly message: string } | null;
  readonly onDownloadDiagnostic?: () => void;
  readonly isDiagnosticAvailable?: boolean;
  readonly isScenarioMatch?: boolean;
  readonly showDebug?: boolean;
  readonly onToggleDebug?: (val: boolean) => void;
  readonly onOpenFeedback?: () => void;
  readonly feedbackCount?: number;
  readonly onOpenReplayVerify?: () => void;
  readonly onOpenReplayViewer?: () => void;
  readonly onOpenScenarioBuilder?: () => void;
  readonly fontScale?: FontScalePercentage;
  readonly onSelectFontScale?: (scale: FontScalePercentage) => void;
  readonly onResetFontScale?: () => void;
  readonly graveTopSelectionMode?: "manual" | "auto";
  readonly onSelectGraveTopSelectionMode?: (mode: "manual" | "auto") => void;
}

export const MobileHeaderMenu: React.FC<MobileHeaderMenuProps> = ({
  isOpen,
  onClose,
  selectedEnvironmentId,
  onSelectEnvironment,
  environmentOptions,
  activeMatchSeed,
  seedMode = "auto",
  onSeedModeChange,
  pendingAutoSeed,
  showSeedInput,
  seedInput = "42",
  onSeedInputChange,
  matchMode,
  onSelectMatchMode,
  policyId,
  onSelectPolicyId,
  isOfficialEnvironment,
  enablePassAndPlay,
  onTogglePassAndPlay,
  onOpenLogModal,
  onOpenDebugModal,
  onResetGame,
  onCopyShareUrl,
  shareNotice,
  onDownloadDiagnostic,
  isDiagnosticAvailable = true,
  isScenarioMatch = false,
  showDebug = false,
  onToggleDebug,
  onOpenFeedback,
  feedbackCount = 0,
  onOpenReplayVerify,
  onOpenReplayViewer,
  onOpenScenarioBuilder,
  fontScale = "100%",
  onSelectFontScale,
  onResetFontScale,
  graveTopSelectionMode = "manual",
  onSelectGraveTopSelectionMode,
}) => {
  // ESC キー押下時のメニュー終了 & フォーカス復帰
  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. IME composition check
      if (e.isComposing || (e as any).keyCode === 229) return;

      if (e.key === "Escape" || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        onClose();

        // メニューを開いたトリガーボタンへフォーカスを復帰
        if (typeof document !== "undefined") {
          setTimeout(() => {
            const triggerBtn = document.querySelector<HTMLElement>('[data-testid="header-settings-menu-button"]');
            triggerBtn?.focus?.();
          }, 0);
        }
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeyDown, true);
      return () => {
        window.removeEventListener("keydown", handleKeyDown, true);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const buildSha = (import.meta as any).env?.VITE_BUILD_SHA
    ? String((import.meta as any).env.VITE_BUILD_SHA).slice(0, 7)
    : "local";
  const buildRef = (import.meta as any).env?.VITE_BUILD_REF || "";

  return (
    <div
      data-testid="playtest-settings-menu-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
    >
      <div className="w-full max-w-sm sm:max-w-md bg-white rounded-xl border border-zinc-300 shadow-2xl p-4 flex flex-col gap-3 font-sans max-h-[90vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
          <h3 className="text-sm font-bold text-zinc-950 font-serif">
            設定・メニュー (Settings &amp; Menu)
          </h3>
          <button
            onClick={onClose}
            aria-label="メニューを閉じる"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-mono transition"
          >
            ✕
          </button>
        </div>

        {/* 対戦環境選択 (Catalog 由来の動的列挙) */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-mono font-bold text-zinc-500">
            対戦環境 (Environment):
          </label>
          <select
            value={selectedEnvironmentId}
            onChange={(e) => onSelectEnvironment(e.target.value)}
            className="w-full text-xs font-bold py-1.5 px-2 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 min-h-[44px]"
          >
            {environmentOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>

        {/* Active Match Seed 表示 (対戦中) */}
        {activeMatchSeed !== undefined && (
          <div className="flex items-center justify-between p-2.5 rounded bg-zinc-100 border border-zinc-200 font-mono">
            <span className="text-[11px] font-bold text-zinc-600">対戦SEED (Active Seed):</span>
            <span className="text-xs font-black text-zinc-950">{activeMatchSeed}</span>
          </div>
        )}

        {/* Seed 設定 (Official 環境で表示: 未対戦時・対戦中ともに次戦用Seedを設定可能) */}
        {showSeedInput && (
          <div className="flex flex-col gap-1.5 p-2.5 rounded bg-zinc-50 border border-zinc-200">
            <label
              className="text-[11px] font-mono font-bold text-zinc-600 cursor-help"
              title="初期山札シャッフルおよび初期配置を決定論的に再現するシードです（AI DNAとは異なります）。"
            >
              {activeMatchSeed !== undefined ? "次回対戦SEED (Next Match Seed):" : "対戦SEED (Match Seed):"}
            </label>
            <div className="flex flex-col gap-1.5 text-xs font-mono">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="mobileSeedMode"
                  value="auto"
                  checked={seedMode === "auto"}
                  onChange={() => onSeedModeChange?.("auto")}
                  className="text-zinc-950 focus:ring-zinc-950"
                />
                <span className="font-bold text-zinc-900">自動（推奨）</span>
                {seedMode === "auto" && pendingAutoSeed !== undefined && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-800 font-bold">
                    {`次回 Seed: ${pendingAutoSeed}`}
                  </span>
                )}
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="mobileSeedMode"
                  value="manual"
                  checked={seedMode === "manual"}
                  onChange={() => onSeedModeChange?.("manual")}
                  className="text-zinc-950 focus:ring-zinc-950"
                />
                <span className="font-bold text-zinc-900">固定</span>
              </label>
              {seedMode === "manual" && (
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={seedInput}
                  onChange={(e) => onSeedInputChange?.(e.target.value)}
                  className="w-full text-xs font-mono font-bold py-1.5 px-2 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 min-h-[44px] mt-1"
                  placeholder="42"
                />
              )}
            </div>
          </div>
        )}

        {/* 対戦モード選択 */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-mono font-bold text-zinc-500">
            対戦モード (Match Mode):
          </label>
          <select
            value={matchMode}
            onChange={(e) => onSelectMatchMode(e.target.value as PlaytestMatchMode)}
            className="w-full text-xs font-bold py-1.5 px-2 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 min-h-[44px]"
          >
            <option value="humanVsHuman">Human vs Human (パス＆プレイ)</option>
            <option value="humanVsAi">Human vs AI</option>
          </select>
        </div>

        {/* Human vs AI 設定 */}
        {matchMode === "humanVsAi" && (
          <>
            {/* 先攻/後攻 自動決定案内 */}
            <div className="p-2 bg-zinc-50 rounded border border-zinc-200 text-[10px] font-mono text-zinc-600 leading-tight">
              ※先攻・後攻は対戦開始時に各プレイヤーのライフのトップカード比較により自動決定されます。
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-mono font-bold text-zinc-500">
                AI Policy:
              </label>
              <select
                value={policyId}
                onChange={(e) => onSelectPolicyId(e.target.value as PlaytestPolicyId)}
                className="w-full text-xs font-bold py-1.5 px-2 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 min-h-[44px]"
              >
                {PLAYTEST_POLICY_OPTIONS.map((opt) => {
                  const currentRegId = extractRegulationId(selectedEnvironmentId);
                  const isSupported =
                    !opt.supportedRegulationIds ||
                    (currentRegId !== null && opt.supportedRegulationIds.includes(currentRegId));
                  const isDisabled =
                    (opt.requiresSeed && !isOfficialEnvironment) || !isSupported;

                  let suffix = "";
                  if (opt.requiresSeed && !isOfficialEnvironment) {
                    suffix = " (Official専用)";
                  } else if (!isSupported && opt.supportedRegulationIds) {
                    suffix = ` (${opt.supportedRegulationIds.join(", ")}専用)`;
                  }

                  return (
                    <option key={opt.id} value={opt.id} disabled={isDisabled}>
                      {opt.label}{suffix}
                    </option>
                  );
                })}
              </select>
            </div>
          </>
        )}

        {/* Pass-and-Play (Human vs Human のみ) */}
        {matchMode === "humanVsHuman" && (
          <label className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200 text-xs font-bold text-zinc-800 cursor-pointer min-h-[44px]">
            <span>Pass-and-Play (秘密情報保護)</span>
            <input
              type="checkbox"
              checked={enablePassAndPlay}
              onChange={(e) => onTogglePassAndPlay(e.target.checked)}
              className="w-5 h-5 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
            />
          </label>
        )}

        {/* 右ペイン Debug パネル常設トグル (Desktop用ハンドラ提供時) */}
        {onToggleDebug && (
          <label className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200 text-xs font-bold text-zinc-800 cursor-pointer min-h-[44px]">
            <span>Debug パネル表示 (Debug ON/OFF)</span>
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => onToggleDebug(e.target.checked)}
              className="w-5 h-5 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
            />
          </label>
        )}

        {/* 表示設定 (文字サイズスケーリング) */}
        {onSelectFontScale && (
          <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-950 flex items-center gap-1 font-mono">
                <span>🔤</span>
                <span>表示設定 (文字サイズ)</span>
              </span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-800 font-bold">
                  現在: {fontScale || "100%"}
                </span>
                {fontScale && fontScale !== "100%" && onResetFontScale && (
                  <button
                    type="button"
                    onClick={onResetFontScale}
                    className="text-[10px] text-zinc-600 hover:text-zinc-950 underline cursor-pointer ml-1"
                    title="標準サイズ (100%) に戻す"
                  >
                    標準に戻す
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5 mt-1 font-mono">
              {(["100%", "115%", "130%", "150%"] as const).map((scale) => {
                const isSelected = (fontScale || "100%") === scale;
                return (
                  <button
                    key={scale}
                    type="button"
                    onClick={() => onSelectFontScale(scale)}
                    data-testid={`font-scale-button-${scale}`}
                    className={`min-h-[36px] py-1 px-1.5 rounded text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 border cursor-pointer ${
                      isSelected
                        ? "bg-zinc-950 text-white border-zinc-950 shadow-sm ring-1 ring-zinc-950 font-black"
                        : "bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-100"
                    }`}
                  >
                    <span>{scale}</span>
                    <span className="text-[9px] opacity-75 font-normal">
                      {scale === "100%" ? "標準" : scale === "115%" ? "中" : scale === "130%" ? "大" : "特大"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="text-[9.5px] text-zinc-500 font-mono mt-0.5">
              ※ 選択すると即時反映され、次回以降も自動で保存・復元されます。
            </div>
          </div>
        )}

        {/* 墓地TOP選択設定 */}
        {onSelectGraveTopSelectionMode && (
          <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-950 flex items-center gap-1 font-mono">
                <span>🪦</span>
                <span>墓地TOPの選択方法</span>
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-800 font-bold">
                {graveTopSelectionMode === "auto" ? "自動選択" : "手動選択"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 mt-1 font-mono">
              <button
                type="button"
                onClick={() => onSelectGraveTopSelectionMode("manual")}
                data-testid="grave-top-mode-manual"
                className={`min-h-[36px] py-1 px-1.5 rounded text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 border cursor-pointer ${
                  (graveTopSelectionMode || "manual") === "manual"
                    ? "bg-zinc-950 text-white border-zinc-950 shadow-sm ring-1 ring-zinc-950 font-black"
                    : "bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-100"
                }`}
              >
                <span>手動選択</span>
                <span className="text-[9px] opacity-75 font-normal">
                  ダイアログで指定
                </span>
              </button>
              <button
                type="button"
                onClick={() => onSelectGraveTopSelectionMode("auto")}
                data-testid="grave-top-mode-auto"
                className={`min-h-[36px] py-1 px-1.5 rounded text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 border cursor-pointer ${
                  graveTopSelectionMode === "auto"
                    ? "bg-zinc-950 text-white border-zinc-950 shadow-sm ring-1 ring-zinc-950 font-black"
                    : "bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-100"
                }`}
              >
                <span>自動選択</span>
                <span className="text-[9px] opacity-75 font-normal">
                  決定論的に自動決定
                </span>
              </button>
            </div>
            <div className="text-[9.5px] text-zinc-500 font-mono mt-0.5">
              ※ 自動選択を有効にすると、墓地TOPの選択リクエスト発生時に自動で選択が行われます。
            </div>
          </div>
        )}

        {/* AI 違和感を記録ボタン (Human vs AI 対戦中) */}
        {onOpenFeedback && (
          <button
            onClick={() => {
              onClose();
              onOpenFeedback();
            }}
            title="AI行動の違和感を記録・共有します"
            className="w-full py-2.5 px-3 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-900 font-bold text-xs font-mono transition flex items-center justify-center gap-2 min-h-[44px]"
          >
            <span>🤔 違和感を記録</span>
            {feedbackCount > 0 && (
              <span className="bg-blue-600 text-white px-1.5 py-0.5 rounded-full text-[10px]">
                {feedbackCount}
              </span>
            )}
          </button>
        )}

        {/* 開始条件を共有ボタン */}
        {onCopyShareUrl && (
          <button
            onClick={() => {
              onCopyShareUrl();
            }}
            title="現在の盤面ではなく、この対戦を開始した設定・初期盤面を共有します"
            className="w-full py-2.5 px-3 rounded border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-900 font-bold text-xs font-mono transition flex items-center justify-center gap-2 min-h-[44px]"
          >
            <span>開始条件を共有</span>
          </button>
        )}

        {/* 診断データ保存ボタン */}
        {onDownloadDiagnostic && (
          <button
            onClick={() => {
              onClose();
              onDownloadDiagnostic();
            }}
            disabled={isDiagnosticAvailable === false}
            className="w-full py-2 px-3 rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-900 font-bold text-xs font-mono transition flex flex-col items-center justify-center gap-0.5 min-h-[44px]"
            title="対戦調査用JSONを保存します。手札・Life等の非公開情報を含みます。"
          >
            <div className="flex items-center gap-1.5">
              <span>💾</span>
              <span>診断データを保存</span>
            </div>
            <span className="text-[10px] text-zinc-500 font-normal">
              ※ 手札・Life等の非公開情報を含みます
            </span>
          </button>
        )}

        {/* Replay検証ボタン */}
        {onOpenReplayVerify && (
          <button
            onClick={() => {
              onClose();
              onOpenReplayVerify();
            }}
            disabled={Boolean(isScenarioMatch)}
            className="w-full py-2 px-3 rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-900 font-bold text-xs font-mono transition flex flex-col items-center justify-center gap-0.5 min-h-[44px]"
            title={
              isScenarioMatch
                ? "Scenarioから開始した対戦のReplay検証は現在未対応です"
                : "Diagnostic JSON を読み込み、決定論的再シミュレーションを検証します"
            }
          >
            <div className="flex items-center gap-1.5">
              <span>🔍</span>
              <span>Replay検証</span>
            </div>
            <span className="text-[10px] text-zinc-500 font-normal">
              ※ 保存済みJSONの再現性を検証
            </span>
          </button>
        )}

        {/* Scenario Builder ボタン */}
        {onOpenScenarioBuilder && (
          <button
            onClick={() => {
              onClose();
              onOpenScenarioBuilder();
            }}
            className="w-full py-2 px-3 rounded border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-900 font-bold text-xs font-mono transition flex flex-col items-center justify-center gap-0.5 min-h-[44px]"
            title="初期盤面設定を開いて初期盤面を作成・読み込みます"
          >
            <div className="flex items-center gap-1.5">
              <span>初期盤面設定</span>
            </div>
            <span className="text-[10px] text-zinc-500 font-normal">
              ※ 初期盤面の作成・読込・共有
            </span>
          </button>
        )}

        {/* Replay Viewer ボタン */}
        {onOpenReplayViewer && (
          <button
            onClick={() => {
              onClose();
              onOpenReplayViewer();
            }}
            disabled={Boolean(isScenarioMatch)}
            className="w-full py-2 px-3 rounded border border-zinc-300 bg-white hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-900 font-bold text-xs font-mono transition flex flex-col items-center justify-center gap-0.5 min-h-[44px]"
            title={
              isScenarioMatch
                ? "Scenarioから開始した対戦のReplayは現在未対応です"
                : activeMatchSeed !== undefined
                ? "現在の対戦をリプレイ"
                : "Diagnostic JSON を読み込み、盤面を1Decisionずつ再生・確認します"
            }
          >
            <div className="flex items-center gap-1.5">
              <span>▶</span>
              <span>Replay Viewer</span>
            </div>
            <span className="text-[10px] text-zinc-500 font-normal">
              {activeMatchSeed !== undefined ? "※ 現在の対戦を1手ずつ確認・再生" : "※ 盤面を1手ずつ確認・再生"}
            </span>
          </button>
        )}

        {/* 共有通知バナー (モバイルメニュー内) */}

        {shareNotice && (
          <div
            className={`p-2 rounded text-xs font-mono font-bold text-center ${
              shareNotice.type === "error"
                ? "bg-red-50 text-red-700 border border-red-200"
                : shareNotice.type === "warning"
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : shareNotice.type === "info"
                ? "bg-blue-50 text-blue-700 border border-blue-200"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
            }`}
          >
            {shareNotice.message}
          </div>
        )}

        {/* Game Log モーダル開くボタン */}
        <button
          onClick={() => {
            onClose();
            onOpenLogModal();
          }}
          className="w-full py-2.5 px-3 rounded border border-zinc-300 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-bold text-xs font-mono transition flex items-center justify-center gap-2 min-h-[44px]"
        >
          <span>対戦ログ (Game Log) を表示</span>
        </button>

        {/* Debug モーダル開くボタン */}
        <button
          onClick={() => {
            onClose();
            onOpenDebugModal();
          }}
          className="w-full py-2.5 px-3 rounded border border-zinc-300 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-bold text-xs font-mono transition flex items-center justify-center gap-2 min-h-[44px]"
        >
          <span>デバッグ情報 (Debug / Canonical Log)</span>
        </button>

        {/* Reset ボタン */}
        <button
          onClick={() => {
            onClose();
            onResetGame();
          }}
          className="w-full py-2.5 px-3 rounded bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs font-mono transition flex items-center justify-center gap-2 min-h-[44px]"
        >
          <span>新しい対戦を開始 (New Match)</span>
        </button>

        {/* Build 情報 */}
        <div className="pt-2 border-t border-zinc-200 text-[10px] text-zinc-400 font-mono text-center">
          Build: {buildSha} {buildRef ? `(${buildRef})` : ""}
        </div>
      </div>
    </div>
  );
};
