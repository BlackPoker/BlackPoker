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
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 p-3 bg-zinc-900/95 border border-zinc-500 rounded-xl shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom duration-200 font-mono">
        <div>
          <div className="text-[10px] text-zinc-400 font-bold uppercase">MATCH END</div>
          <div className="text-xs font-black text-white font-serif">{winnerName || winnerKey} WIN!</div>
        </div>
        <button
          onClick={handleCopyLogs}
          className="px-2 py-1 text-[10px] font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded border border-zinc-700 transition"
        >
          {copied ? "✓ COPIED" : "COPY"}
        </button>
        <button
          onClick={() => setMinimized(false)}
          className="px-2.5 py-1 text-[10px] font-bold bg-zinc-800 hover:bg-zinc-700 text-white rounded border border-zinc-600 transition"
        >
          結果表示
        </button>
        <button
          onClick={onRestart}
          className="px-2.5 py-1 text-[10px] font-black bg-white hover:bg-zinc-100 text-zinc-950 rounded transition"
        >
          Replay
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans">
      <div className="flex flex-col items-center max-w-md w-full p-6 bg-[#121216] rounded-2xl shadow-2xl border border-zinc-600 text-center animate-in zoom-in-90 duration-200">
        <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-xs font-mono font-black text-white mb-2 shadow-inner">
          WIN
        </div>

        <h2 className="text-lg font-serif font-black tracking-widest text-white mb-0.5">
          MATCH FINISHED
        </h2>
        <div className="text-xl font-serif font-black text-white mb-2 tracking-wide">
          {winnerName || winnerKey} WIN!
        </div>

        <p className="text-xs text-zinc-300 bg-zinc-950/80 border border-zinc-800 p-2.5 rounded-lg mb-3 w-full font-mono">
          {reason}
        </p>

        <div className="flex gap-2 w-full mb-3 font-mono">
          <button
            onClick={handleCopyLogs}
            className="flex-1 py-1.5 px-3 text-xs font-bold bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded-lg transition flex items-center justify-center gap-1 border border-zinc-700"
          >
            {copied ? "✓ コピー完了" : "対戦ログコピー"}
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="py-1.5 px-3 text-xs font-bold bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg transition border border-zinc-700"
          >
            盤面を見る
          </button>
        </div>


        <button
          onClick={onRestart}
          className="w-full py-2.5 px-6 bg-white hover:bg-zinc-100 active:scale-95 text-zinc-950 font-black rounded-lg shadow-xl transition-all text-sm ring-1 ring-zinc-300"
        >
          もう一度対戦する (Replay)
        </button>
      </div>
    </div>
  );
};

