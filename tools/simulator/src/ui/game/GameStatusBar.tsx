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
    <div className="flex flex-col gap-1.5 p-2 bg-[#0e0e12] rounded-xl border border-zinc-800 shadow-sm">
      {/* 主要ステータスバッジ群 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 font-mono">
          {/* ターン数バッジ */}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-700 shadow-sm">
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">TURN</span>
            <span className="text-xs font-black text-white font-mono">
              {turnCount || 1}
            </span>
          </div>

          {/* ターンプレイヤーバッジ */}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-600 shadow-sm">
            <span className="text-[10px] text-zinc-400 font-bold">手番:</span>
            <span className="text-xs font-bold text-zinc-200">
              {turnPlayerName}
            </span>
            <span className="text-[9px] font-mono text-zinc-500 font-bold">
              ({turnPlayer.toUpperCase()})
            </span>
          </div>

          {/* チャンスプレイヤーバッジ (最重要・反転白地黒文字で強調) */}
          <div className="flex items-center gap-1 px-3 py-1 rounded bg-white text-zinc-950 shadow-md ring-1 ring-zinc-300 font-bold animate-in fade-in">
            <span className="text-xs">★</span>
            <span className="text-[10px] font-black uppercase tracking-wider">CHANCE:</span>
            <span className="text-xs font-black">
              {chancePlayerName} ({chancePlayer.toUpperCase()})
            </span>
          </div>
        </div>

        <div className="text-[11px] text-zinc-400 font-mono italic">
          Action Request or PASS
        </div>
      </div>

      {/* 最新イベントメッセージ */}
      {latestEventMessage && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-300 font-mono">
          <span className="text-[10px] font-bold text-zinc-400 border border-zinc-700 px-1 py-0.2 rounded bg-zinc-950">EVENT</span>
          <span className="font-sans break-all text-zinc-200">{latestEventMessage}</span>
        </div>
      )}

    </div>
  );
};

