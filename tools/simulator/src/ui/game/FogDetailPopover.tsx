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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border-2 border-indigo-500 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-4 py-3 bg-indigo-950 border-b border-indigo-800 text-indigo-100">
          <div className="flex items-center gap-2">
            <span className="text-base">🌫</span>
            <h3 className="font-extrabold text-sm">
              {playerName} の FOG 詳細 ({fogs.length}件)
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-indigo-900/80 hover:bg-indigo-800 text-indigo-300 font-black text-sm transition"
          >
            ✕
          </button>
        </div>

        <div className="p-4 max-h-96 overflow-y-auto space-y-2.5">
          {fogs.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-400">
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
                  className={`p-3 rounded-xl border flex flex-col gap-1.5 ${
                    isUp
                      ? "bg-rose-950/30 border-rose-500/50 text-rose-100"
                      : "bg-cyan-950/30 border-cyan-500/50 text-cyan-100"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-sm flex items-center gap-1">
                      <span>{isUp ? "↑ アップ" : "↓ ダウン"}</span>
                      {formattedCard && (
                        <span className="font-mono bg-slate-950/80 px-1.5 py-0.5 rounded text-xs border border-slate-700">
                          {formattedCard}
                        </span>
                      )}
                    </span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-950/70 border border-slate-700 font-mono">
                      SIZE {amount >= 0 ? `+${amount}` : amount}
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
                    <div>
                      <span className="text-slate-400 font-bold block text-[10px]">対象:</span>
                      <span className="font-semibold text-slate-200">{targetLabel}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-bold block text-[10px]">作成者:</span>
                      <span className="font-semibold text-slate-200">{ownerName}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 bg-slate-950/80 border-t border-slate-800 text-center">
          <button
            onClick={onClose}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition shadow"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
