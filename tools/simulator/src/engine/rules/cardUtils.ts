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
 * アタッカーを構成するカード群のいずれかと、防壁カードの「記載ランク（printed rank）」が一致するかを判定
 * アップ/ダウン/フォグ/能力等のサイズ補正は無視し、カード記載の rank (A, 2〜10, J, Q, K) を照合する
 * (Joker は本関数とは別に isJokerCard() で無条件成功として処理する)
 */
export function matchesPrintedRank(attackerCards: readonly any[], bulwarkCard: any): boolean {
  if (!bulwarkCard || !attackerCards || attackerCards.length === 0) return false;

  const bulwarkRank = normalizeRank(bulwarkCard.rank);
  const bulwarkVal = bulwarkCard.value !== undefined ? bulwarkCard.value : (bulwarkRank ? rankToValue(bulwarkRank) : undefined);

  for (const attackerCard of attackerCards) {
    if (!attackerCard) continue;
    const attRank = normalizeRank(attackerCard.rank);
    const attVal = attackerCard.value !== undefined ? attackerCard.value : (attRank ? rankToValue(attRank) : undefined);

    // 1. ランク文字列（記載ランク）の一致を優先 (例: "8" === "8", "A" === "A", "J" === "J", "Q" === "Q", "K" === "K")
    if (attRank !== "" && bulwarkRank !== "" && attRank === bulwarkRank) {
      return true;
    }

    // 2. rank 欠落時用の value fallback (例: mockデータで rank がなく value のみの場合)
    if (attRank === "" || bulwarkRank === "") {
      if (attVal !== undefined && bulwarkVal !== undefined && attVal > 0 && bulwarkVal > 0 && attVal === bulwarkVal) {
        return true;
      }
    }
  }

  return false;
}

/** 後方互換用エイリアス */
export const matchesCardNumber = matchesPrintedRank;

