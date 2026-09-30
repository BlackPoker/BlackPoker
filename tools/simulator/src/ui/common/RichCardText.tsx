import React from "react";
import { formatOfficialSuitSymbol, isRedSuit } from "../../engine/rules/cardUtils";

export interface RichCardTextProps {
  readonly text?: string;
  readonly className?: string;
}

/**
 * テキスト内のカード表記 (♠10, ♥A, H8, S5, ♣K, ♦Q 等) を検出し、
 * 公式Webフォント (.bp-card-suit) と Rank (.bp-card-rank)、および公式赤色 (.bp-card-suit-red)
 * を適用したリッチ表示へ変換する共通UIコンポーネント。
 */
export const RichCardText: React.FC<RichCardTextProps> = ({ text, className = "" }) => {
  if (!text) return null;

  // カード記号・コードの正規表現:
  // 1. Unicode スート: ♠, ♥, ♦, ♣, ♡, ♢, ★ + (ランク: 10, 2-9, A, J, Q, K, JK, Joker)
  // 2. ASCII スートコード: 単語境界で S, H, D, C + (ランク: 10, 2-9, A, J, Q, K)
  // 3. 単体 Joker 表記: Joker, JK
  const cardRegex = /(?:([♠♥♦♣♡♢★])(10|[2-9ajqkAJQK]|JK|Joker|JOKER)?|\b([shdcSHDC])(10|[2-9ajqkAJQK])\b|\b(Joker|JK|joker|jk)\b)/g;

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = cardRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const isStandaloneJoker = Boolean(match[5]);
    const rawSuit = isStandaloneJoker ? "★" : (match[1] || match[3]);
    let rawRank = isStandaloneJoker ? "J" : (match[2] || match[4] || "");

    const isJoker = rawSuit === "★" || rawSuit?.toLowerCase() === "joker" || isStandaloneJoker;
    if (isJoker) {
      rawRank = "J";
    }

    const officialSuit = isJoker ? "★" : formatOfficialSuitSymbol(rawSuit);
    const isRed = !isJoker && isRedSuit(rawSuit);
    const redClass = isRed ? "text-[#a22041] bp-card-suit-red" : "";

    elements.push(
      <span key={match.index} className="inline-flex items-center gap-0.5 leading-none align-baseline">
        <span className={`bp-card-suit text-[16px] leading-none ${redClass}`}>{officialSuit}</span>
        {rawRank && <span className="bp-card-rank font-bold text-[13px] leading-none">{rawRank.toUpperCase()}</span>}
      </span>
    );

    lastIndex = cardRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return <span className={className}>{elements}</span>;
};
