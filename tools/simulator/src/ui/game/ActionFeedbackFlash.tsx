import React from "react";
import { ActionFeedbackItem } from "../../engine/session/playtest/ActionFeedbackComposer";

export interface ActionFeedbackFlashProps {
  readonly item: ActionFeedbackItem | null;
  readonly pendingCount?: number;
  readonly onSkip?: () => void;
}

/**
 * 画面上部にフロート表示される、直近のアクションフィードバック用 Flash コンポーネント。
 * 人間 vs AI 対戦時に「何が起きたか」「誰が何をしたか」を直感的かつ即座に伝えます。
 * カード領域をクリック・タップまたは Enter/Space で即座に次の Flash へスキップ可能です。
 */
export const ActionFeedbackFlash: React.FC<ActionFeedbackFlashProps> = ({ item, pendingCount = 0, onSkip }) => {
  if (!item) return null;

  // カテゴリ別の視認性スタイル
  let badgeBg = "bg-zinc-800 text-white";
  let borderClass = "border-zinc-700 ring-1 ring-zinc-700";
  let bgClass = "bg-zinc-900/95 text-zinc-100";

  switch (item.category) {
    case "cancel":
      badgeBg = "bg-rose-600 text-white";
      borderClass = "border-rose-500 ring-1 ring-rose-500";
      bgClass = "bg-rose-950/95 text-rose-50";
      break;
    case "damage":
      badgeBg = "bg-red-600 text-white";
      borderClass = "border-red-500 ring-1 ring-red-500";
      bgClass = "bg-red-950/95 text-red-50";
      break;
    case "draw":
      badgeBg = "bg-blue-600 text-white";
      borderClass = "border-blue-500 ring-1 ring-blue-500";
      bgClass = "bg-blue-950/95 text-blue-50";
      break;
    case "defeated":
      badgeBg = "bg-amber-600 text-white";
      borderClass = "border-amber-500 ring-1 ring-amber-500";
      bgClass = "bg-amber-950/95 text-amber-50";
      break;
    case "state":
      badgeBg = "bg-emerald-600 text-white";
      borderClass = "border-emerald-500 ring-1 ring-emerald-500";
      bgClass = "bg-emerald-950/95 text-emerald-50";
      break;
    case "turn":
      badgeBg = "bg-indigo-600 text-white";
      borderClass = "border-indigo-500 ring-1 ring-indigo-500";
      bgClass = "bg-indigo-950/95 text-indigo-50";
      break;
    default:
      badgeBg = "bg-zinc-800 text-white";
      borderClass = "border-zinc-700 ring-1 ring-zinc-700";
      bgClass = "bg-zinc-900/95 text-zinc-100";
      break;
  }

  return (
    <div
      className="fixed top-12 left-1/2 -translate-x-1/2 z-40 pointer-events-none px-2 py-1 max-w-[94vw] sm:max-w-lg transition-all duration-150"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onSkip}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSkip?.();
          }
        }}
        aria-label="クリックでスキップ"
        title="クリックでスキップ"
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg shadow-xl border ${borderClass} ${bgClass} backdrop-blur-md font-sans pointer-events-auto cursor-pointer select-none active:scale-95 transition-transform hover:brightness-110 text-left focus:outline-none focus:ring-2 focus:ring-white/40`}
      >
        {item.detailBadge && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-black shrink-0 ${badgeBg}`}>
            {item.detailBadge}
          </span>
        )}
        <div className="flex flex-col min-w-0">
          <div className="text-xs sm:text-sm font-bold tracking-wide truncate">
            {item.mainText}
          </div>
          {item.subText && (
            <div className="text-[10px] sm:text-xs opacity-80 font-mono truncate">
              {item.subText}
            </div>
          )}
        </div>
        {pendingCount > 0 && (
          <span className="ml-auto pl-2 text-[9px] font-mono opacity-60 shrink-0">
            +{pendingCount}
          </span>
        )}
      </button>
    </div>
  );
};
