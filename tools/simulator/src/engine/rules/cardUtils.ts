/**
 * カードのスート記号・表示形式を統一するユーティリティ。
 */

export function normalizeSuit(suit?: string): string {
  if (!suit) return "";
  const s = suit.toLowerCase();
  if (s === "h" || s === "heart" || s === "hearts" || s === "♡" || s === "♥") return "heart";
  if (s === "d" || s === "diamond" || s === "diamonds" || s === "♢" || s === "♦") return "diamond";
  if (s === "s" || s === "spade" || s === "spades" || s === "♠") return "spade";
  if (s === "c" || s === "club" || s === "clubs" || s === "♣") return "club";
  if (s === "j" || s === "joker" || s === "★") return "joker";
  return s;
}

export function formatSuitSymbol(suit?: string): string {
  const norm = normalizeSuit(suit);
  switch (norm) {
    case "spade":
      return "♠";
    case "heart":
      return "♡";
    case "diamond":
      return "♢";
    case "club":
      return "♣";
    case "joker":
      return "★";
    default:
      return suit || "";
  }
}

export function isJokerCard(card?: any): boolean {
  if (!card) return false;
  return (
    card.suit === "J" ||
    card.rank === "0" ||
    normalizeSuit(card.suit) === "joker" ||
    card.code?.toUpperCase().includes("JOKER") ||
    false
  );
}

export function formatCardDisplay(card?: {
  id?: string;
  suit?: string;
  rank?: string;
  value?: number;
  code?: string;
  visibility?: string;
}): string {
  if (!card) return "";
  if (card.visibility === "HIDDEN" || (!card.suit && !card.rank)) return "🂠";
  if (isJokerCard(card)) return "Joker";

  const symbol = formatSuitSymbol(card.suit);
  const rank = card.rank !== undefined ? String(card.rank) : "";
  return `${symbol}${rank}`;
}

export function formatCardList(cards?: any[]): string {
  if (!Array.isArray(cards) || cards.length === 0) return "";
  return cards.map(formatCardDisplay).join(", ");
}

/**
 * ランク文字列を数値 (1〜13) に変換
 */
export function rankToValue(rank: string | number): number {
  if (typeof rank === "number") return rank;
  const r = rank.toUpperCase();
  if (r === "A") return 1;
  if (r === "J") return 11;
  if (r === "Q") return 12;
  if (r === "K") return 13;
  if (r === "JOKER") return 0;
  const num = parseInt(r, 10);
  if (!isNaN(num)) return num;
  return 0;
}

/**
 * スートの一致判定 (単一文字列または配列)
 */
export function matchesSuit(cardSuit?: string, expectedSuit?: string | readonly string[]): boolean {
  if (!expectedSuit) return true;
  const normCard = normalizeSuit(cardSuit);
  if (Array.isArray(expectedSuit)) {
    return expectedSuit.some((s) => normalizeSuit(s) === normCard);
  }
  return normCard === normalizeSuit(typeof expectedSuit === "string" ? expectedSuit : undefined);
}



/**
 * ランクの一致判定 (単一文字列、配列、範囲 "A..K" 等)
 */
export function matchesRank(cardRank: string, cardValue: number, expectedRank: any): boolean {
  if (!expectedRank) return true;

  if (Array.isArray(expectedRank)) {
    return expectedRank.some((r) => String(r).toLowerCase() === String(cardRank).toLowerCase());
  }

  if (typeof expectedRank === "string") {
    if (expectedRank.includes("..")) {
      const [start, end] = expectedRank.split("..");
      const startVal = rankToValue(start);
      const endVal = rankToValue(end);
      const val = cardValue || rankToValue(cardRank);
      return val >= startVal && val <= endVal;
    } else {
      return expectedRank.toLowerCase() === cardRank.toLowerCase();
    }
  }

  return true;
}

/**
 * 兵士の構成カードのいずれかの rank と 防壁カードの rank が一致するかどうか
 */
export function matchesPrintedRank(attackerCards: any[], bulwarkCard?: any): boolean {
  if (!bulwarkCard || !Array.isArray(attackerCards)) return false;
  const bulwarkRank = String(bulwarkCard.rank).toUpperCase();
  return attackerCards.some((c: any) => String(c.rank).toUpperCase() === bulwarkRank);
}
