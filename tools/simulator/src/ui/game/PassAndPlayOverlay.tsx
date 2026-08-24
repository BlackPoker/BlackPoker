import React, { useEffect, useRef } from "react";

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
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // ボタンにフォーカス
    buttonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      // 背面へのキーイベント伝播を完全に遮断
      e.stopPropagation();

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onReady();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [onReady]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/85 backdrop-blur-md p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex flex-col items-center max-w-md w-full p-6 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border-2 border-indigo-500 text-center animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-3xl text-amber-600 mb-4 shadow-inner">
          ★
        </div>

        <h2 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 mb-2">
          {targetPlayerName} のチャンスです
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
          画面を <span className="font-bold text-indigo-600 dark:text-indigo-400">{targetPlayerName} ({targetPlayerKey})</span> に渡してください。
          準備ができたら下のボタン（または <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs font-mono">Enter</kbd>）を押して操作を開始してください。
        </p>

        <button
          ref={buttonRef}
          onClick={onReady}
          className="w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold rounded-xl shadow-lg transition-all text-base focus:ring-4 focus:ring-indigo-400 focus:outline-none"
        >
          準備OK (操作画面を表示)
        </button>
      </div>
    </div>
  );
};
