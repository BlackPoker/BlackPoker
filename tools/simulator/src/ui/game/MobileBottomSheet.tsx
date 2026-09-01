import React, { useEffect } from "react";

export interface MobileBottomSheetProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly children: React.ReactNode;
}

export const MobileBottomSheet: React.FC<MobileBottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  children,
}) => {
  // Esc キーで閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm lg:hidden animate-fade-in">
      {/* 背景クリックで閉じる領域 */}
      <div className="flex-1" onClick={onClose} />

      {/* Bottom Sheet 本体 */}
      <div className="w-full bg-white rounded-t-xl border-t border-zinc-300 shadow-2xl flex flex-col max-h-[85vh] animate-slide-up">
        {/* ヘッダー / ドラッグバー */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-1 bg-zinc-300 rounded-full mx-auto absolute left-1/2 -translate-x-1/2 top-1.5" />
            <h3 className="text-sm font-bold text-zinc-950 font-serif tracking-wide">
              {title || "行動の選択"}
            </h3>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-700 text-sm font-mono transition min-w-[44px] min-h-[44px]"
            title="閉じる"
          >
            ✕
          </button>
        </div>

        {/* コンテンツ領域 */}
        <div className="p-3 overflow-y-auto flex-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
};
