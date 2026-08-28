import React from "react";

export interface FogDetailPopoverProps {
  playerKey: string;
  playerName: string;
  fogs: readonly any[];
  unitNumberMap?: Map<string, { badge: string; label: string }>;
  onClose: () => void;
}

function formatCardCodeDisplay(code?: string): string {
  if (!code) return "";
  return code
    .replace(/S/g, "♠")
    .replace(/H/g, "♡")
    .replace(/D/g, "♢")
    .replace(/C/g, "♣");
}

export const FogDetailPopover: React.FC<FogDetailPopoverProps> = ({
  playerKey,
  playerName,
  fogs,
  unitNumberMap,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans">
      <div className="w-full max-w-md bg-[#121216] border border-zinc-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-zinc-900 border-b border-zinc-800 text-white">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono font-bold bg-zinc-800 border border-zinc-700 px-1 py-0.2 rounded text-zinc-300">FOG</span>
            <h3 className="font-serif font-black text-xs tracking-wide">
              {playerName} の FOG 詳細 ({fogs.length}件)
            </h3>
          </div>

          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-xs transition"
          >
            ✕
          </button>
        </div>

        <div className="p-3 max-h-96 overflow-y-auto space-y-1.5 font-mono">
          {fogs.length === 0 ? (
            <div className="text-center py-6 text-xs text-zinc-500 italic">
              現在配置されている Fog はありません
            </div>
          ) : (
            fogs.map((f, idx) => {
              const amount = f.bindings?.amount || 0;
              const isUp = amount > 0;
              const cardCode = f.card?.code || (f.card?.suit && f.card?.rank ? `${f.card.suit}${f.card.rank}` : "");
              const formattedCard = formatCardCodeDisplay(cardCode);
              const targetUnitId = f.bindings?.target;
              const targetUnitInfo = targetUnitId ? unitNumberMap?.get(targetUnitId) : undefined;
              const targetLabel = targetUnitInfo ? targetUnitInfo.label : (targetUnitId ? `#${targetUnitId.slice(-4)}` : "未指定");
              const ownerName = f.ownerPlayerId === "p1" ? "Player A" : (f.ownerPlayerId === "p2" ? "Player B" : f.ownerPlayerId || playerName);

              return (
                <div
                  key={f.fogId || idx}
                  className="p-2 rounded-lg border border-zinc-800 bg-zinc-950/80 flex flex-col gap-1 text-zinc-200"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs flex items-center gap-1">
                      <span>{isUp ? "↑ アップ" : "↓ ダウン"}</span>
                      {formattedCard && (
                        <span className="bg-zinc-800 px-1 py-0.2 rounded text-[10px] border border-zinc-700 text-white font-bold">
                          {formattedCard}
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-700 text-white">
                      SIZE {amount >= 0 ? `+${amount}` : amount}
                    </span>
                  </div>

                  <div className="text-[10px] text-zinc-400 grid grid-cols-2 gap-2 pt-1 border-t border-zinc-900">
                    <div>
                      <span className="text-zinc-500 font-bold block text-[9px]">対象:</span>
                      <span className="font-semibold text-zinc-200">{targetLabel}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 font-bold block text-[9px]">作成者:</span>
                      <span className="font-semibold text-zinc-200">{ownerName}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-2 bg-zinc-950 border-t border-zinc-800 text-center">
          <button
            onClick={onClose}
            className="w-full py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-mono font-bold transition"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
