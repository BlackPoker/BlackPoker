/**
 * カード・スート・ランク・数字の比較および正規化ユーティリティ
 */

/**
 * スートが一致するかどうかを検証
 */
export function matchesSuit(cardSuit: string, expectedSuit: string): boolean {
  if (!expectedSuit) return true;
  const cs = cardSuit.toLowerCase();
  const es = expectedSuit.toLowerCase();
  if (cs === es) return true;
  if (es === "spade" && cs === "s") return true;
  if (es === "club" && cs === "c") return true;
  if (es === "heart" && cs === "h") return true;
  if (es === "diamond" && cs === "d") return true;
  if (es === "joker" && cs === "x") return true;
  return false;
}

/**
 * ランクを数値にマッピング (A=1, J=11, Q=12, K=13, Joker=0/20)
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
 * ランクの文字列表現を正規化
 */
export function normalizeRank(rank: string | number | undefined): string {
  if (rank === undefined || rank === null) return "";
  return String(rank).trim().toUpperCase();
}

/**
 * カードが Joker かどうかを判定
 */
export function isJokerCard(card: any): boolean {
  if (!card) return false;
  const rank = normalizeRank(card.rank);
  const suit = normalizeRank(card.suit);
  return rank === "JOKER" || suit === "JOKER" || suit === "X";
}

/**
 * ランクが一致するかどうかを検証 (範囲指定 "A..K" などのパースに対応)
 */
export function matchesRank(cardRank: string, cardValue: number, expectedRank: any): boolean {
  if (!expectedRank) return true;

  if (Array.isArray(expectedRank)) {
    return expectedRank.some((r) => String(r).toLowerCase() === cardRank.toLowerCase());
  }

  if (typeof expectedRank === "string") {
    if (expectedRank.includes("..")) {
      const [start, end] = expectedRank.split("..");
      const startVal = rankToValue(start);
      const endVal = rankToValue(end);
      return cardValue >= startVal && cardValue <= endVal;
    } else {
      return cardRank.toLowerCase() === expectedRank.toLowerCase();
    }
  }

  return false;
}

/**
 * アタッカーのカード群のいずれかが、防壁カードの「記載された数字（printed rank/value）」と一致するかを判定
 * アップ/ダウン等のサイズ補正は無視し、カード記載の rank / value を照合する
 */
export function matchesCardNumber(attackerCards: readonly any[], bulwarkCard: any): boolean {
  if (!bulwarkCard || !attackerCards || attackerCards.length === 0) return false;

  const bulwarkRank = normalizeRank(bulwarkCard.rank);
  const bulwarkVal = bulwarkCard.value !== undefined ? bulwarkCard.value : rankToValue(bulwarkRank);

  for (const attackerCard of attackerCards) {
    if (!attackerCard) continue;
    const attRank = normalizeRank(attackerCard.rank);
    const attVal = attackerCard.value !== undefined ? attackerCard.value : rankToValue(attRank);

    // 1. ランク文字列の一致 (例: "8" === "8", "A" === "A")
    if (attRank !== "" && bulwarkRank !== "" && attRank === bulwarkRank) {
      return true;
    }

    // 2. 数値の一致 (例: value 8 === value 8)
    if (attVal > 0 && bulwarkVal > 0 && attVal === bulwarkVal) {
      return true;
    }
  }

  return false;
}
