import React from "react";

export interface GameOverOverlayProps {
  winnerKey?: string;
  winnerName?: string;
  reason: string;
  onRestart: () => void;
}

export const GameOverOverlay: React.FC<GameOverOverlayProps> = ({
  winnerKey,
  winnerName,
  reason,
  onRestart,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/85 backdrop-blur-md p-4">
      <div className="flex flex-col items-center max-w-md w-full p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border-4 border-amber-500 text-center animate-in zoom-in-90 duration-300">
        <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-4xl text-amber-500 mb-4 shadow-inner">
          🏆
        </div>

        <h2 className="text-3xl font-black text-slate-900 dark:text-slate-100 mb-1">
          MATCH FINISHED
        </h2>
        <div className="text-xl font-extrabold text-amber-600 dark:text-amber-400 mb-3">
          {winnerName || winnerKey} WIN!
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-900/60 p-3 rounded-xl mb-6 w-full font-medium">
          {reason}
        </p>

        <button
          onClick={onRestart}
          className="w-full py-3.5 px-6 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 active:scale-95 text-white font-black rounded-2xl shadow-xl transition-all text-lg"
        >
          もう一度対戦する (Replay)
        </button>
      </div>
    </div>
  );
};
