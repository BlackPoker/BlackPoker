import React from "react";

const suitSymbols: Record<string, { symbol: string; color: string }> = {
  S: { symbol: "♠", color: "text-slate-900 dark:text-slate-100" },
  H: { symbol: "♡", color: "text-red-600 dark:text-red-400" },
  D: { symbol: "♢", color: "text-red-600 dark:text-red-400" },
  C: { symbol: "♣", color: "text-slate-900 dark:text-slate-100" },
  J: { symbol: "★", color: "text-purple-600 dark:text-purple-400" },
};

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
    sm: "w-8 h-11 text-xs",
    md: "w-12 h-16 text-sm",
    lg: "w-16 h-22 text-base",
  }[size];

  if (faceDown || !card) {
    return (
      <div
        className={`inline-flex flex-col items-center justify-center rounded-md border-2 border-indigo-300 bg-indigo-800 text-indigo-200 shadow font-mono select-none ${sizeClasses} ${className}`}
        title="裏向きカード"
      >
        <span className="text-base">🂠</span>
      </div>
    );
  }

  const isJoker = card.suit === "J" || card.rank === "0" || card.code?.toUpperCase().includes("JOKER");
  const suitInfo = suitSymbols[card.suit || ""] || { symbol: card.suit || "", color: "text-slate-800" };
  const displayRank = isJoker ? "Joker" : card.rank || "";

  return (
    <div
      className={`inline-flex flex-col justify-between p-1 rounded-md border-2 border-slate-300 bg-white dark:bg-slate-800 shadow font-bold select-none transition-transform hover:-translate-y-0.5 ${sizeClasses} ${className}`}
      title={`${card.suit}${card.rank} (id: ${card.id})`}
    >
      <div className={`text-left leading-none ${suitInfo.color} text-[10px]`}>
        {displayRank}
      </div>
      <div className={`text-center leading-none ${suitInfo.color} text-base my-auto`}>
        {isJoker ? "★" : suitInfo.symbol}
      </div>
    </div>
  );
};
