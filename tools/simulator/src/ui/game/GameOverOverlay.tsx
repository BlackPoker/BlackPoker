import React, { useState } from "react";

export interface GameOverOverlayProps {
  winnerKey?: string;
  winnerName?: string;
  reason: string;
  logs?: any[];
  onRestart: () => void;
}

export const GameOverOverlay: React.FC<GameOverOverlayProps> = ({
  winnerKey,
  winnerName,
  reason,
  logs = [],
  onRestart,
}) => {
  const [minimized, setMinimized] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.timestamp}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 p-3 bg-white/95 border border-zinc-300 rounded shadow-xl backdrop-blur-md animate-in slide-in-from-bottom duration-200 font-mono">
        <div>
          <div className="text-[10px] text-zinc-500 font-bold uppercase">MATCH END</div>
          <div className="text-xs font-bold text-zinc-950 font-serif">{winnerName || winnerKey} WIN!</div>
        </div>
        <button
          onClick={handleCopyLogs}
          className="px-2 py-1 text-[10px] font-bold bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded border border-zinc-300 transition"
        >
          {copied ? "✓ COPIED" : "COPY"}
        </button>
        <button
          onClick={() => setMinimized(false)}
          className="px-2.5 py-1 text-[10px] font-bold bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded border border-zinc-300 transition"
        >
          結果表示
        </button>
        <button
          onClick={onRestart}
          className="px-2.5 py-1 text-[10px] font-bold bg-zinc-950 hover:bg-zinc-800 text-white rounded transition"
        >
          Replay
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans">
      <div className="flex flex-col items-center max-w-md w-full p-6 bg-white rounded border border-zinc-300 text-center shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="w-12 h-12 rounded-full bg-zinc-950 flex items-center justify-center text-xs font-mono font-black text-white mb-2 shadow-sm">
          WIN
        </div>

        <h2
          style={{ fontFamily: '"Times New Roman", Times, serif', fontWeight: 700 }}
          className="text-lg tracking-wider text-zinc-950 mb-0.5"
        >
          MATCH FINISHED
        </h2>
        <div
          style={{ fontFamily: '"Times New Roman", Times, serif', fontWeight: 700 }}
          className="text-xl text-zinc-950 mb-2 tracking-wide font-bold"
        >
          {winnerName || winnerKey} WIN
        </div>

        <p className="text-xs text-zinc-800 bg-zinc-50 border border-zinc-200 p-2.5 rounded mb-3 w-full font-mono">
          {reason}
        </p>

        <div className="flex gap-2 w-full mb-3 font-mono">
          <button
            onClick={handleCopyLogs}
            className="flex-1 py-1.5 px-3 text-xs font-bold bg-white hover:bg-zinc-100 text-zinc-900 rounded transition flex items-center justify-center gap-1 border border-zinc-300"
          >
            {copied ? "✓ コピー完了" : "対戦ログコピー"}
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="py-1.5 px-3 text-xs font-bold bg-white hover:bg-zinc-100 text-zinc-800 rounded transition border border-zinc-300"
          >
            盤面を見る
          </button>
        </div>

        <button
          onClick={onRestart}
          className="w-full py-2.5 px-6 bg-zinc-950 hover:bg-zinc-800 active:scale-95 text-white font-bold rounded shadow transition-all text-sm font-mono"
        >
          もう一度対戦する (Replay)
        </button>
      </div>
    </div>
  );
};


