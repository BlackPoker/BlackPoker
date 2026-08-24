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
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 p-4 bg-slate-900/95 border-2 border-amber-500 rounded-2xl shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom duration-200">
        <div className="text-xl">🏆</div>
        <div>
          <div className="text-xs font-bold text-amber-400">対戦終了</div>
          <div className="text-sm font-extrabold text-white">{winnerName || winnerKey} WIN!</div>
        </div>
        <button
          onClick={handleCopyLogs}
          className="px-2.5 py-1.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition"
        >
          {copied ? "✓ コピー済" : "📋 ログコピー"}
        </button>
        <button
          onClick={() => setMinimized(false)}
          className="px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
        >
          結果を表示
        </button>
        <button
          onClick={onRestart}
          className="px-3 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition"
        >
          🔄 Replay
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      <div className="flex flex-col items-center max-w-md w-full p-6 bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border-4 border-amber-500 text-center animate-in zoom-in-90 duration-300">
        <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-3xl text-amber-500 mb-3 shadow-inner">
          🏆
        </div>

        <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-1">
          MATCH FINISHED
        </h2>
        <div className="text-xl font-extrabold text-amber-600 dark:text-amber-400 mb-2">
          {winnerName || winnerKey} WIN!
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-900/60 p-3 rounded-xl mb-4 w-full font-medium">
          {reason}
        </p>

        <div className="flex gap-2 w-full mb-3">
          <button
            onClick={handleCopyLogs}
            className="flex-1 py-2 px-3 text-xs font-bold bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl transition flex items-center justify-center gap-1 border border-slate-300 dark:border-slate-600"
          >
            {copied ? "✓ コピー完了" : "📋 対戦ログをコピー"}
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="py-2 px-3 text-xs font-bold bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl transition border border-slate-300 dark:border-slate-600"
          >
            👀 盤面・ログを見る
          </button>
        </div>

        <button
          onClick={onRestart}
          className="w-full py-3 px-6 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 active:scale-95 text-white font-black rounded-xl shadow-xl transition-all text-base"
        >
          もう一度対戦する (Replay)
        </button>
      </div>
    </div>
  );
};
