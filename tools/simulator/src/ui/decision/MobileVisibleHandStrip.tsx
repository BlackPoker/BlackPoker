import React from "react";
import { CardView } from "../game/CardView";

export interface MobileVisibleHandStripProps {
  readonly handCards?: readonly any[];
  readonly className?: string;
}

/**
 * Mobile 行動選択 Bottom Sheet 用の持続表示手札ストリップ。
 * Viewer から見て可視なカードのみを横スクロール可能な1列で描画します。
 */
export const MobileVisibleHandStrip: React.FC<MobileVisibleHandStripProps> = ({
  handCards,
  className = "",
}) => {
  if (!handCards || handCards.length === 0) {
    return null;
  }

  // 可視カードの抽出 (HIDDEN または faceUp: false は除外)
  const visibleCards = handCards.filter(
    (card) => card && card.visibility !== "HIDDEN" && card.faceUp !== false
  );

  if (visibleCards.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="mobile-sheet-hand-strip"
      className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-pan-x py-1 px-1 min-w-0 ${className}`}
    >
      <span className="text-[10px] font-mono font-bold text-zinc-500 shrink-0 select-none mr-0.5">
        {`HAND (${visibleCards.length})`}
      </span>
      <div className="flex items-center gap-1 flex-nowrap shrink-0">
        {visibleCards.map((card, idx) => (
          <div
            key={card.id || card.cardInstanceId || idx}
            className="shrink-0 flex-none"
            data-testid={`mobile-hand-card-${card.id || idx}`}
          >
            <CardView
              card={card}
              size="sm"
              compact={true}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
