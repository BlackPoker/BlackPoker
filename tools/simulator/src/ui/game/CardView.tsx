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
}

export const CardView: React.FC<CardViewProps> = ({
  card,
  faceDown = false,
  size = "md",
  className = "",
}) => {
  const sizeClasses = {
    sm: "w-8 h-[40px] text-xs",
    md: "w-10 h-[52px] text-sm",
    lg: "w-14 h-[72px] text-base",
  }[size];

  if (faceDown || !card) {
    return (
      <div
        className={`inline-flex flex-col items-center justify-center rounded border border-zinc-900 bg-zinc-900 text-zinc-300 shadow-sm font-mono font-bold select-none ${sizeClasses} ${className}`}
        title="裏向きカード"
      >
        <span className="text-[9px] tracking-tighter opacity-70 font-serif text-white">BP</span>
      </div>
    );
  }

  const isJoker = isJokerCard(card);
  const suitSymbol = isJoker ? "★" : formatSuitSymbol(card.suit);
  const displayRank = isJoker ? "JK" : card.rank || "";

  return (
    <div
      className={`inline-flex flex-col justify-between p-1 rounded border border-zinc-400 bg-white text-zinc-950 shadow-sm font-bold select-none transition-transform hover:-translate-y-0.5 ${sizeClasses} ${className}`}
      title={`${card.suit || ""}${card.rank || ""} (id: ${card.id || ""})`}
    >
      <div className="text-left leading-none text-zinc-950 text-[10px] font-mono font-black">
        {displayRank}
      </div>
      <div className="text-center leading-none text-zinc-950 text-sm my-auto">
        {suitSymbol}
      </div>
    </div>
  );
};



