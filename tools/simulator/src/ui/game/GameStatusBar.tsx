import React from "react";

export interface GameStatusBarProps {
  turnPlayer: string;
  chancePlayer: string;
  focusPlayer?: string;
  turnCount: number;
  players: any;
  latestEventMessage?: string;
  environmentName?: string;
  matchSeed?: number;
  stateVersion?: number;
}

export const GameStatusBar: React.FC<GameStatusBarProps> = ({
  turnPlayer,
  chancePlayer,
  focusPlayer,
  turnCount,
  players = {},
  latestEventMessage,
  environmentName,
  matchSeed,
  stateVersion,
}) => {
  const turnPlayerName = players[turnPlayer]?.name || (turnPlayer === "p1" ? "Player A" : "Player B");
  const chancePlayerName =
    chancePlayer === "system"
      ? "Rule System"
      : players[chancePlayer]?.name || (chancePlayer === "p1" ? "Player A" : "Player B");
  const focusPlayerName = focusPlayer
    ? players[focusPlayer]?.name || (focusPlayer === "p1" ? "Player A" : focusPlayer === "p2" ? "Player B" : focusPlayer)
    : undefined;

  return (
    <div
      data-testid="game-status-bar"
      className="flex flex-col gap-1 p-1.5 bg-white rounded border border-zinc-200 shadow-sm"
    >
      {/* 主要ステータスバッジ群 */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1 font-mono">
          {/* 環境バッジ */}
          {environmentName && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-300 shadow-sm">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">環境:</span>
              <span className="text-xs font-bold text-zinc-950 font-mono">
                {environmentName}
              </span>
            </div>
          )}

          {/* Seed バッジ */}
          {matchSeed !== undefined && (
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-300 shadow-sm cursor-help"
              title="初期山札シャッフルおよび初期配置を決定論的に再現するシードです（AI DNAとは異なります）。"
            >
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">対戦SEED:</span>
              <span className="text-xs font-bold text-zinc-950 font-mono">
                {matchSeed}
              </span>
            </div>
          )}
          {/* ターン数バッジ */}
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-100 border border-zinc-300 shadow-sm">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">TURN</span>
            <span className="text-xs font-black text-zinc-950 font-mono">
              {turnCount || 1}
            </span>
          </div>

          {/* ターンプレイヤーバッジ */}
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-100 border border-zinc-300 shadow-sm">
            <span className="text-[10px] text-zinc-500 font-bold">手番:</span>
            <span className="text-xs font-bold text-zinc-900">
              {turnPlayerName}
            </span>
            <span className="text-[9px] font-mono text-zinc-500 font-bold">
              ({turnPlayer.toUpperCase()})
            </span>
          </div>

          {/* チャンスプレイヤーバッジ (最重要・反転黒地白文字で強調) */}
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-zinc-950 text-white shadow-sm font-bold">
            <span className="text-[10px] font-black uppercase tracking-wider">CHANCE:</span>
            <span className="text-xs font-black">
              {chancePlayerName} ({chancePlayer.toUpperCase()})
            </span>
          </div>

          {/* フォーカスプレイヤーバッジ (白背景・太めの黒枠・黒文字でCHANCE/手番と明確に区別) */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white border-2 border-zinc-950 text-zinc-950 shadow-sm font-bold">
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-700">FOCUS:</span>
            <span className="text-xs font-black">
              {focusPlayer ? `${focusPlayerName} (${focusPlayer.toUpperCase()})` : "未設定"}
            </span>
          </div>
        </div>
      </div>

      {/* 最新イベントメッセージ + バージョン表示 */}
      <div className="flex items-center justify-between gap-1.5 px-2 py-0.5 rounded bg-zinc-50 border border-zinc-200 text-[11px] text-zinc-800 font-mono">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-bold text-zinc-600 border border-zinc-300 px-1 py-0.2 rounded bg-zinc-100 shrink-0">EVENT</span>
          <span className="font-sans truncate text-zinc-900">{latestEventMessage || "待機中"}</span>
        </div>
        <div className="text-[10px] text-zinc-500 font-mono italic shrink-0 hidden sm:block">
          {stateVersion !== undefined ? `v${stateVersion} | ` : ""}Action Request or PASS
        </div>
      </div>
    </div>
  );

};

