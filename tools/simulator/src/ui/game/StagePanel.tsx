import React from "react";

export interface StagePanelProps {
  requests: any[];
}

function formatCardCodeDisplay(code?: string): string {
  if (!code) return "";
  return code
    .replace(/S/g, "♠")
    .replace(/H/g, "♡")
    .replace(/D/g, "♢")
    .replace(/C/g, "♣");
}

export const StagePanel: React.FC<StagePanelProps> = ({ requests = [] }) => {
  return (
    <div className="flex flex-col p-2.5 rounded-xl border border-zinc-800 bg-[#0d0d11] shadow-sm">
      <div className="flex items-center justify-between border-b pb-1.5 mb-1.5 border-zinc-800">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono font-black text-white tracking-wider">
            STAGE (LIFO)
          </span>
          <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
            {requests.length} 件
          </span>
        </div>
        <span className="text-[10px] text-zinc-500 font-mono">
          ※ 上 (TOP) から順に解決
        </span>
      </div>

      {requests.length === 0 ? (
        <div className="flex items-center justify-center py-2.5 text-xs text-zinc-500 font-mono">
          ステージは空です (全員PASSで次の処理へ)
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {/* LIFO: 末尾 (TOP) から先頭 (BOTTOM) へ逆順に表示 */}
          {requests
            .slice()
            .reverse()
            .map((req, revIdx) => {
              const isTop = revIdx === 0;
              const actionName = req.action?.name || req.actionId;
              const controllerName = req.controller === "p1" ? "Player A" : "Player B";

              // Key カードの整形
              const keyCodes = Array.isArray(req.keyCards) && req.keyCards.length > 0
                ? req.keyCards.map((c: any) => formatCardCodeDisplay(c.code || `${c.suit}${c.rank}`)).join(", ")
                : undefined;

              // コスト表示の判定
              const costSummary = req.paidCostSummary || req.selectedCostPayment?.summary;
              const costLabel = costSummary
                ? `Cost: ${costSummary}（支払い済み）`
                : (req.cost ? `Cost: ${req.cost}（支払い済み）` : "Cost: なし");

              // ターゲット情報の整形
              const targetLabels: string[] = [];
              if (req.targets && Array.isArray(req.targets)) {
                for (const t of req.targets) {
                  if (t.type === "unit") {
                    const shortId = t.unitId ? `#${t.unitId.slice(-4)}` : "";
                    targetLabels.push(`${t.kind || "ユニット"} ${shortId}`);
                  } else if (t.type === "player") {
                    targetLabels.push(t.name || t.targetPlayerKey || "プレイヤー");
                  }
                }
              }
              const targetStr = targetLabels.length > 0 ? targetLabels.join(", ") : undefined;

              const statusText = (req.status || "pending").toUpperCase();

              return (
                <div
                  key={req.id || revIdx}
                  className={`flex flex-col p-2 rounded-lg border transition-all ${
                    isTop
                      ? "bg-zinc-900 border-zinc-400 shadow-md ring-1 ring-white/20 text-white"
                      : "bg-zinc-950/80 border-zinc-800 text-zinc-300 opacity-80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[9px] font-mono font-black px-1.5 py-0.5 rounded ${
                          isTop
                            ? "bg-white text-zinc-950 shadow-sm"
                            : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                        }`}
                      >
                        {isTop ? "TOP (次に解決)" : `STAGE #${requests.length - revIdx}`}

                      </span>
                      <span className="text-xs font-black text-white font-serif tracking-wide">
                        {actionName}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        (ID: {req.id})
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 font-mono text-[10px]">
                      <span className="text-zinc-400">
                        {controllerName}
                      </span>
                      <span
                        className={`font-bold px-1 py-0.2 rounded border ${
                          req.status === "resolving"
                            ? "bg-white text-zinc-950 border-white font-black animate-pulse"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700"
                        }`}
                      >
                        {statusText}
                      </span>
                    </div>
                  </div>

                  {/* 詳細メタデータ行 (Key, Cost, Target) */}
                  <div className="mt-1 pt-1 border-t border-zinc-800/80 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-zinc-400 font-mono">
                    {keyCodes && (
                      <span className="flex items-center gap-1">
                        <span className="text-zinc-300 font-bold">Key:</span>
                        <span className="font-bold text-white bg-zinc-800 px-1 py-0.2 rounded border border-zinc-700">
                          {keyCodes}
                        </span>
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <span className="font-bold text-zinc-300">{costLabel}</span>
                    </span>
                    {targetStr && (
                      <span className="flex items-center gap-1">
                        <span className="text-zinc-400 font-bold">Target:</span>
                        <span className="text-zinc-200">{targetStr}</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};

