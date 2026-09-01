import React, { useEffect } from "react";

export type SheetMode = "collapsed" | "half" | "expanded";

export interface MobileBottomSheetProps {
  readonly mode: SheetMode;
  readonly onModeChange: (mode: SheetMode) => void;
  readonly onClose: () => void;
  readonly title?: string;
  readonly children: React.ReactNode;
}

export const MobileBottomSheet: React.FC<MobileBottomSheetProps> = ({
  mode,
  onModeChange,
  onClose,
  title,
  children,
}) => {
  const isVisible = mode !== "collapsed";

  // Esc キーで閉じる（最小化）
  useEffect(() => {
    if (!isVisible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, onClose]);

  // 高さと scrim のクラス設定
  const heightClass = mode === "expanded" ? "max-h-[88vh] h-[85vh]" : "max-h-[58vh] h-[55vh]";
  const scrimClass = mode === "expanded" ? "bg-black/40 backdrop-blur-sm" : "bg-black/15";

  return (
    <>
      {/* 1. 背景スクリム（表示時のみ） */}
      {isVisible && (
        <div
          className={`fixed inset-0 z-40 lg:hidden transition-opacity duration-200 ${scrimClass}`}
          onClick={() => onModeChange("collapsed")}
        />
      )}

      {/* 2. Bottom Sheet 本体（collapsed 時でもマウントを維持し、translate-y で退避） */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden flex flex-col justify-end transition-transform duration-300 ease-out ${
          isVisible ? "translate-y-0" : "translate-y-full pointer-events-none"
        }`}
      >
        <div
          className={`w-full bg-white rounded-t-xl border-t-2 border-zinc-300 shadow-2xl flex flex-col ${heightClass}`}
        >
          {/* ヘッダーツールバー */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 shrink-0 bg-zinc-50 rounded-t-xl">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-zinc-950 animate-pulse" />
              <h3 className="text-xs font-bold text-zinc-950 font-serif tracking-wide truncate max-w-[160px] sm:max-w-xs">
                {title || "行動の選択"}
              </h3>
            </div>

            {/* ヘッダー操作ボタン群 */}
            <div className="flex items-center gap-1">
              {/* 「盤面を見る」ボタン (最小化) */}
              <button
                onClick={() => onModeChange("collapsed")}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-white hover:bg-zinc-200 active:bg-zinc-300 text-zinc-900 border border-zinc-300 text-[11px] font-mono font-bold transition shadow-sm min-h-[36px]"
                title="盤面を確認する (選択状態を維持して最小化)"
              >
                <span>盤面を見る</span>
              </button>

              {/* 拡大 / 縮小 ボタン */}
              {mode === "half" ? (
                <button
                  onClick={() => onModeChange("expanded")}
                  className="w-8 h-8 flex items-center justify-center rounded bg-white hover:bg-zinc-200 text-zinc-800 border border-zinc-300 text-xs font-mono transition min-h-[36px] min-w-[36px]"
                  title="拡大表示"
                >
                  ⤢
                </button>
              ) : (
                <button
                  onClick={() => onModeChange("half")}
                  className="w-8 h-8 flex items-center justify-center rounded bg-white hover:bg-zinc-200 text-zinc-800 border border-zinc-300 text-xs font-mono transition min-h-[36px] min-w-[36px]"
                  title="標準サイズに戻す"
                >
                  ⤡
                </button>
              )}

              {/* ✕ 閉じる（最小化）ボタン */}
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 text-zinc-700 text-xs font-mono transition min-h-[36px] min-w-[36px]"
                title="閉じる"
              >
                ✕
              </button>
            </div>
          </div>

          {/* コンテンツ領域（DecisionPanel） */}
          <div className="p-2.5 overflow-y-auto flex-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </div>
      </div>
    </>
  );
};
