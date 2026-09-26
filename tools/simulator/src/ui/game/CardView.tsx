import React from "react";
import { formatSuitSymbol, isJokerCard } from "../../engine/rules/cardUtils";

export interface CardViewProps {
  card?: {
    id?: string;
    suit?: string;
    rank?: string;
    value?: number;
    code?: string;
  };
  faceDown?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  compact?: boolean;
  onClick?: () => void;
  selected?: boolean;
  selectable?: boolean;
}

export const CardView: React.FC<CardViewProps> = ({
  card,
  faceDown = false,
  size = "md",
  className = "",
  compact,
  onClick,
  selected = false,
  selectable = false,
}) => {
  const sizeClasses = {
    sm: "w-7 sm:w-8 h-6 sm:h-[40px] text-xs",
    md: "w-9 sm:w-10 h-7 sm:h-[52px] text-xs sm:text-sm",
    lg: "w-11 sm:w-14 h-9 sm:h-[72px] text-sm sm:text-base",
  }[size];

  if (faceDown || !card) {
    return (
      <div
        onClick={onClick}
        className={`inline-flex flex-col items-center justify-center rounded border border-zinc-900 bg-zinc-900 text-zinc-300 shadow-sm font-mono font-bold select-none ${sizeClasses} ${className}`}
        title="裏向きカード"
        aria-label="裏向きカード"
      >
        <span className="text-[9px] tracking-tighter opacity-70 font-serif text-white">BP</span>
      </div>
    );
  }

  const isJoker = isJokerCard(card);
  const suitSymbol = isJoker ? "★" : formatSuitSymbol(card.suit);
  const displayRank = isJoker ? "JK" : card.rank || "";

  // compact prop が明示指定されている場合はそれに従い、未指定の場合は responsive (sm breakpoint)
  const isExplicitCompact = compact === true;
  const isExplicitDesktop = compact === false;

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center justify-center sm:flex-col sm:justify-between p-0.5 sm:p-1 rounded border ${
        selected
          ? "border-zinc-950 bg-zinc-950 text-white ring-2 ring-zinc-950 shadow"
          : "border-zinc-400 bg-white text-zinc-950 shadow-sm hover:border-zinc-700"
      } ${selectable || onClick ? "cursor-pointer active:scale-95" : ""} font-bold select-none transition-all ${sizeClasses} ${className}`}
      title={`${card.suit || ""}${card.rank || ""} (id: ${card.id || ""})`}
      aria-label={`${suitSymbol}${displayRank}`}
      role={onClick ? "button" : undefined}
    >
      {/* Mobile compact: 1行中心表示 (♠10) */}
      <div
        className={`${
          isExplicitDesktop
            ? "hidden"
            : isExplicitCompact
            ? "flex"
            : "flex sm:hidden"
        } items-center justify-center gap-0.5 leading-none bp-card-glyph font-bold text-[13px]`}
      >
        <span>{suitSymbol}</span>
        <span className="font-bold">{displayRank}</span>
      </div>

      {/* Desktop: 従来のトランプ風表示 (左上rank, 中央suit) */}
      <div
        className={`${
          isExplicitCompact
            ? "hidden"
            : isExplicitDesktop
            ? "block"
            : "hidden sm:block"
        } text-left leading-none text-[13px] font-bold bp-card-glyph`}
      >
        {displayRank}
      </div>
      <div
        className={`${
          isExplicitCompact
            ? "hidden"
            : isExplicitDesktop
            ? "block"
            : "hidden sm:block"
        } text-center leading-none text-[17px] bp-card-glyph my-auto`}
      >
        {suitSymbol}
      </div>
    </div>
  );
};



