import React from "react";
import { EnvironmentOption } from "../../engine/playtest/PlaytestEnvironmentController";
import {
  PlaytestMatchMode,
  PlaytestPolicyId,
  PLAYTEST_POLICY_OPTIONS,
} from "../../engine/playtest/PlaytestSeatController";

export interface MobileHeaderMenuProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedEnvironmentId: string;
  readonly onSelectEnvironment: (envId: string) => void;
  readonly environmentOptions: readonly EnvironmentOption[];
  readonly showSeedInput: boolean;
  readonly seedInput?: string;
  readonly onSeedInputChange?: (val: string) => void;
  readonly matchMode: PlaytestMatchMode;
  readonly onSelectMatchMode: (mode: PlaytestMatchMode) => void;
  readonly humanSeat: "p1" | "p2";
  readonly onSelectHumanSeat: (seat: "p1" | "p2") => void;
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
}

export const MobileHeaderMenu: React.FC<MobileHeaderMenuProps> = ({
  isOpen,
  onClose,
  selectedEnvironmentId,
  onSelectEnvironment,
  environmentOptions,
  showSeedInput,
  seedInput = "42",
  onSeedInputChange,
  matchMode,
  onSelectMatchMode,
  humanSeat,
  onSelectHumanSeat,
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
}) => {
  if (!isOpen) return null;

  const buildSha = (import.meta as any).env?.VITE_BUILD_SHA
    ? String((import.meta as any).env.VITE_BUILD_SHA).slice(0, 7)
    : "local";
  const buildRef = (import.meta as any).env?.VITE_BUILD_REF || "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 lg:hidden animate-fade-in">
      <div className="w-full max-w-sm bg-white rounded-xl border border-zinc-300 shadow-2xl p-4 flex flex-col gap-3 font-sans max-h-[90vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
          <h3 className="text-sm font-bold text-zinc-950 font-serif">
            メニュー (Menu)
          </h3>
          <button
            onClick={onClose}
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

        {/* Seed 入力 (Official 環境のみ条件付き表示) */}
        {showSeedInput && (
          <div className="flex flex-col gap-1">
            <label
              className="text-[11px] font-mono font-bold text-zinc-500 cursor-help"
              title="初期状態再現用の乱数シードです。同じ環境・Seedで同一の初期配置・山札順を再現できます。"
            >
              再現SEED (乱数シード・非負整数):
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={seedInput}
              onChange={(e) => onSeedInputChange?.(e.target.value)}
              className="w-full text-xs font-mono font-bold py-1.5 px-2 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 min-h-[44px]"
              placeholder="42"
              title="初期状態再現用の乱数シードです。同じ環境・Seedで同一の初期配置・山札順を再現できます。"
            />
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
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-mono font-bold text-zinc-500">
                プレイヤー席 (Human Seat):
              </label>
              <select
                value={humanSeat}
                onChange={(e) => onSelectHumanSeat(e.target.value as "p1" | "p2")}
                className="w-full text-xs font-bold py-1.5 px-2 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 min-h-[44px]"
              >
                <option value="p1">Player A (p1)</option>
                <option value="p2">Player B (p2)</option>
              </select>
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
                {PLAYTEST_POLICY_OPTIONS.map((opt) => (
                  <option
                    key={opt.id}
                    value={opt.id}
                    disabled={opt.requiresSeed && !isOfficialEnvironment}
                  >
                    {opt.label}{opt.requiresSeed && !isOfficialEnvironment ? " (Official専用)" : ""}
                  </option>
                ))}
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

        {/* 共有URLをコピーボタン */}
        {onCopyShareUrl && (
          <button
            onClick={() => {
              onCopyShareUrl();
            }}
            className="w-full py-2.5 px-3 rounded border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-900 font-bold text-xs font-mono transition flex items-center justify-center gap-2 min-h-[44px]"
          >
            <span>共有URLをコピー</span>
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
