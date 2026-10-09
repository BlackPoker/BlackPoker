import React from "react";
import { formatOfficialSuitSymbol, isJokerCard, isRedSuit } from "../../engine/rules/cardUtils";

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
  inPlayerBoard?: boolean;
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
  inPlayerBoard = false,
}) => {
  // compact prop が明示指定されている場合はそれに従い、未指定の場合は responsive (lg breakpoint)
  const isExplicitCompact = compact === true;
  const isExplicitDesktop = compact === false;

  const sizeClasses = {
    sm: isExplicitDesktop
      ? "w-8 h-[40px] text-xs"
      : isExplicitCompact
      ? "w-7 h-6 text-xs"
      : "w-7 lg:w-8 h-6 lg:h-[40px] text-xs",
    md: isExplicitDesktop
      ? "w-10 h-[52px] text-xs lg:text-sm"
      : isExplicitCompact
      ? "w-9 h-7 text-xs"
      : "w-9 lg:w-10 h-7 lg:h-[52px] text-xs lg:text-sm",
    lg: isExplicitDesktop
      ? "w-14 h-[72px] text-sm lg:text-base"
      : isExplicitCompact
      ? "w-11 h-9 text-sm"
      : "w-11 lg:w-14 h-9 lg:h-[72px] text-sm lg:text-base",
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
  const suitSymbol = isJoker ? "★" : formatOfficialSuitSymbol(card.suit);
  const displayRank = isJoker ? "J" : card.rank || "";
  const isRed = !isJoker && isRedSuit(card.suit);
  const redSuitClass = isRed ? "text-[#a22041] bp-card-suit-red" : "";

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center justify-center ${
        isExplicitDesktop
          ? "flex-col justify-between p-1"
          : isExplicitCompact
          ? "p-0.5"
          : "lg:flex-col lg:justify-between p-0.5 lg:p-1"
      } rounded border ${
        selected
          ? "border-zinc-950 bg-zinc-950 text-white ring-2 ring-zinc-950 shadow"
          : "border-zinc-400 bg-white text-zinc-950 shadow-sm hover:border-zinc-700"
      } ${selectable || onClick ? "cursor-pointer active:scale-95" : ""} font-bold select-none transition-all ${sizeClasses} ${className}`}
      title={`${card.suit || ""}${card.rank || ""} (id: ${card.id || ""})`}
      aria-label={`${suitSymbol}${displayRank}`}
      role={onClick ? "button" : undefined}
    >
      {/* Mobile/Compact: 1行中心表示 (♠10) */}
      <div
        className={`${
          isExplicitDesktop
            ? "hidden"
            : isExplicitCompact
            ? "flex"
            : "flex lg:hidden"
        } items-center justify-center gap-0.5 leading-none ${inPlayerBoard ? "bp-card-board" : ""}`}
      >
        <span className={`bp-card-suit ${inPlayerBoard ? "text-[20px]" : "text-[18px]"} ${redSuitClass}`}>{suitSymbol}</span>
        <span className={`bp-card-rank font-bold ${inPlayerBoard ? "text-[14px]" : "text-[13px]"}`}>{displayRank}</span>
      </div>

      {/* Desktop: 従来のトランプ風表示 (左上rank, 中央suit) */}
      <div
        className={`${
          isExplicitCompact
            ? "hidden"
            : isExplicitDesktop
            ? "block"
            : "hidden lg:block"
        } text-left leading-none text-[13px] font-bold bp-card-rank`}
      >
        {displayRank}
      </div>
      <div
        className={`${
          isExplicitCompact
            ? "hidden"
            : isExplicitDesktop
            ? "block"
            : "hidden lg:block"
        } text-center leading-none text-[22px] bp-card-suit my-auto ${redSuitClass}`}
      >
        {suitSymbol}
      </div>
    </div>
  );
};
