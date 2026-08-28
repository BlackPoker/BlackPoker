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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 font-sans"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex flex-col items-center max-w-md w-full p-6 bg-[#141414] rounded border border-zinc-600 text-center animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-xs font-mono font-black text-white mb-3 shadow-inner">
          TURN
        </div>

        <h2 className="text-lg font-bold text-white mb-1.5 tracking-wide">
          {targetPlayerName} のチャンスです
        </h2>
        <p className="text-xs text-zinc-300 mb-5 leading-relaxed">
          画面を <span className="font-bold text-white font-mono">{targetPlayerName} ({targetPlayerKey.toUpperCase()})</span> に渡してください。<br />
          準備ができたら下のボタン（または <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">Enter</kbd>）を押してください。
        </p>


        <button
          ref={buttonRef}
          onClick={onReady}
          className="w-full py-2.5 px-6 bg-white hover:bg-zinc-100 active:scale-95 text-zinc-950 font-black rounded-lg shadow-lg transition-all text-sm focus:ring-2 focus:ring-white focus:outline-none"
        >
          準備完了 (操作画面を表示)
        </button>
      </div>
    </div>
  );
};

