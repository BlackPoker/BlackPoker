import React from "react";

export interface PassAndPlayOverlayProps {
  targetPlayerName: string;
  targetPlayerKey: string;
  onReady: () => void;
}

export const PassAndPlayOverlay: React.FC<PassAndPlayOverlayProps> = ({
  targetPlayerName,
  targetPlayerKey,
  onReady,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
      <div className="flex flex-col items-center max-w-md w-full p-6 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border-2 border-indigo-500 text-center animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-3xl text-amber-600 mb-4">
          ★
        </div>

        <h2 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 mb-2">
          {targetPlayerName} のチャンスです
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
          画面を <span className="font-bold text-indigo-600 dark:text-indigo-400">{targetPlayerName} ({targetPlayerKey})</span> に渡してください。
          準備ができたら下のボタンを押して操作を開始してください。
        </p>

        <button
          onClick={onReady}
          className="w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold rounded-xl shadow-lg transition-all text-base"
        >
          準備OK (操作画面を表示)
        </button>
      </div>
    </div>
  );
};
