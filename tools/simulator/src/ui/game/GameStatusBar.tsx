import React from "react";

export interface GameStatusBarProps {
  turnPlayer: string;
  chancePlayer: string;
  turnCount: number;
  players: any;
  latestEventMessage?: string;
}

export const GameStatusBar: React.FC<GameStatusBarProps> = ({
  turnPlayer,
  chancePlayer,
  turnCount,
  players = {},
  latestEventMessage,
}) => {
  const turnPlayerName = players[turnPlayer]?.name || (turnPlayer === "p1" ? "Player A" : "Player B");
  const chancePlayerName = players[chancePlayer]?.name || (chancePlayer === "p1" ? "Player A" : "Player B");

  return (
    <div className="flex flex-col gap-2 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
      {/* 主要ステータスバッジ群 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* ターン数バッジ */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 shadow-sm">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">TURN</span>
            <span className="text-sm font-black text-slate-900 dark:text-slate-100 font-mono">
              {turnCount || 1}
            </span>
          </div>

          {/* ターンプレイヤーバッジ */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 shadow-sm">
            <span className="text-xs text-indigo-700 dark:text-indigo-300 font-bold">手番:</span>
            <span className="text-sm font-black text-indigo-900 dark:text-indigo-200">
              {turnPlayerName}
            </span>
            <span className="text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-bold">
              ({turnPlayer})
            </span>
          </div>

          {/* チャンスプレイヤーバッジ (最重要・強調) */}
          <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md ring-2 ring-amber-400/60 animate-in fade-in">
            <span className="text-sm">★</span>
            <span className="text-xs font-black uppercase tracking-wider">チャンス:</span>
            <span className="text-sm font-black">
              {chancePlayerName} ({chancePlayer})
            </span>
          </div>
        </div>

        <div className="text-xs font-bold text-slate-500 dark:text-slate-400 italic">
          アクション選択または PASS を行ってください
        </div>
      </div>

      {/* 最新イベントメッセージ */}
      {latestEventMessage && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-300 font-medium">
          <span className="text-sm">📢</span>
          <span className="font-sans break-all">{latestEventMessage}</span>
        </div>
      )}
    </div>
  );
};
