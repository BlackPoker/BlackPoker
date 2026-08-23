import React from "react";

export interface StagePanelProps {
  requests: any[];
}

export const StagePanel: React.FC<StagePanelProps> = ({ requests = [] }) => {
  return (
    <div className="flex flex-col p-3 rounded-xl border-2 border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/20 dark:border-indigo-900 shadow-sm">
      <div className="flex items-center justify-between border-b pb-2 mb-2 border-indigo-200 dark:border-indigo-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-extrabold text-indigo-900 dark:text-indigo-200">
            STAGE (LIFO)
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200 font-bold">
            {requests.length} 件
          </span>
        </div>
        <span className="text-[11px] text-indigo-600 dark:text-indigo-400">
          ※ 上 (TOP) から順に解決されます
        </span>
      </div>

      {requests.length === 0 ? (
        <div className="flex items-center justify-center py-4 text-xs text-indigo-400 dark:text-indigo-500 font-medium">
          ステージは空です (全員PASSで次の処理へ)
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* LIFO: 末尾 (TOP) から先頭 (BOTTOM) へ逆順に表示 */}
          {requests
            .slice()
            .reverse()
            .map((req, revIdx) => {
              const isTop = revIdx === 0;
              const actionName = req.action?.name || req.actionId;
              const controllerName = req.controller === "p1" ? "Player A" : "Player B";

              return (
                <div
                  key={req.id || revIdx}
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                    isTop
                      ? "bg-white border-indigo-500 shadow-md dark:bg-slate-800 dark:border-indigo-400 ring-2 ring-indigo-400/30"
                      : "bg-white/70 border-slate-300 dark:bg-slate-800/60 dark:border-slate-700 opacity-85"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${
                        isTop
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {isTop ? "TOP (次に解決)" : `STACK #${requests.length - revIdx}`}
                    </span>
                    <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
                      {actionName}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      (ID: {req.id})
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      発動者: {controllerName} ({req.controller})
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                        req.status === "resolving"
                          ? "bg-amber-500 text-white animate-pulse"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {req.status || "pending"}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};
