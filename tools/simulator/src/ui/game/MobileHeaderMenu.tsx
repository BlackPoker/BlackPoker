import React from "react";

export interface MobileHeaderMenuProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedRegulation: string;
  readonly onSelectRegulation: (reg: string) => void;
  readonly seedInput?: string;
  readonly onSeedInputChange?: (val: string) => void;
  readonly enablePassAndPlay: boolean;
  readonly onTogglePassAndPlay: (val: boolean) => void;
  readonly onOpenLogModal: () => void;
  readonly onOpenDebugModal: () => void;
  readonly onResetGame: () => void;
}

export const MobileHeaderMenu: React.FC<MobileHeaderMenuProps> = ({
  isOpen,
  onClose,
  selectedRegulation,
  onSelectRegulation,
  seedInput = "42",
  onSeedInputChange,
  enablePassAndPlay,
  onTogglePassAndPlay,
  onOpenLogModal,
  onOpenDebugModal,
  onResetGame,
}) => {
  if (!isOpen) return null;

  const buildSha = (import.meta as any).env?.VITE_BUILD_SHA
    ? String((import.meta as any).env.VITE_BUILD_SHA).slice(0, 7)
    : "local";
  const buildRef = (import.meta as any).env?.VITE_BUILD_REF || "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 lg:hidden animate-fade-in">
      <div className="w-full max-w-sm bg-white rounded-xl border border-zinc-300 shadow-2xl p-4 flex flex-col gap-3 font-sans">
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

        {/* レギュレーション選択 */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-mono font-bold text-zinc-500">
            対戦環境 (Environment):
          </label>
          <select
            value={selectedRegulation}
            onChange={(e) => onSelectRegulation(e.target.value)}
            className="w-full text-xs font-bold py-1.5 px-2 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 min-h-[44px]"
          >
            <option value="core-battle">Core Battle (既存初期盤面)</option>
            <option value="official-light-entry16">ライト + エントリー16 (公式)</option>
            <option value="master-extra" disabled>
              Master + Extra (Coming Soon)
            </option>
          </select>
        </div>

        {/* Seed 入力 */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-mono font-bold text-zinc-500">
            Seed (乱数シード):
          </label>
          <input
            type="number"
            value={seedInput}
            onChange={(e) => onSeedInputChange?.(e.target.value)}
            className="w-full text-xs font-mono font-bold py-1.5 px-2 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 min-h-[44px]"
            placeholder="42"
          />
        </div>

        {/* Pass-and-Play */}
        <label className="flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-200 text-xs font-bold text-zinc-800 cursor-pointer min-h-[44px]">
          <span>Pass-and-Play (秘密情報保護)</span>
          <input
            type="checkbox"
            checked={enablePassAndPlay}
            onChange={(e) => onTogglePassAndPlay(e.target.checked)}
            className="w-5 h-5 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
          />
        </label>

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
