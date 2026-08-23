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
      {/* チャンス表示バナー (最重要) */}
      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 rounded-lg shadow text-white">
        <div className="flex items-center gap-2">
          <span className="text-xl">★</span>
          <span className="text-lg font-extrabold tracking-wide">
            {chancePlayerName} のチャンスです
          </span>
          <span className="text-xs font-mono opacity-80">({chancePlayer})</span>
        </div>
        <div className="text-xs font-bold bg-white/20 px-2.5 py-1 rounded-full">
          アクション選択または PASS を行ってください
        </div>
      </div>

      {/* 進行基本情報 (手番 / ターン) */}
      <div className="flex items-center justify-between text-xs px-2 text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-4">
          <div>
            <span className="font-bold text-slate-500">ターン数:</span>{" "}
            <span className="font-extrabold text-slate-800 dark:text-slate-200 font-mono">
              Turn {turnCount || 1}
            </span>
          </div>
          <div>
            <span className="font-bold text-slate-500">現在の手番 (Turn Player):</span>{" "}
            <span className="font-bold text-indigo-600 dark:text-indigo-400">
              {turnPlayerName} ({turnPlayer})
            </span>
          </div>
        </div>

        {latestEventMessage && (
          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-medium">
            <span>📢</span>
            <span>{latestEventMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};
