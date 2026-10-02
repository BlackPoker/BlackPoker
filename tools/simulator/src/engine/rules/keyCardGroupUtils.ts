import {
  normalizeSuit,
  isCanonicalPrintedCard,
  isCanonicalJokerCard,
} from "./cardUtils";

/**
 * カードの公式表記に基づき、Canonical なカード数値を厳格に取得します (Fail-Closed)。
 *
 * SSOT: cardUtils.ts (isCanonicalPrintedCard, isCanonicalJokerCard)
 *
 * 認識される公式カード数値:
 * - Canonical Joker = 0
 * - A = 1
 * - 2..10 = 2..10
 * - J = 11
 * - Q = 12
 * - K = 13
 * 
 * 不正・非Canonicalなランクやスート（"1", "11", "12", "13", {suit:"H", rank:"0"} 等）は
 * undefined を返し、Joker や通常カードとして誤認識されることを防ぎます。
 */
export function getCanonicalCardNumber(card: any): number | undefined {
  if (!isCanonicalPrintedCard(card)) {
    return undefined;
  }

  if (isCanonicalJokerCard(card)) {
    return 0;
  }

  const r = String(card.rank).toUpperCase().trim();
  switch (r) {
    case "A":
      return 1;
    case "2":
      return 2;
    case "3":
      return 3;
    case "4":
      return 4;
    case "5":
      return 5;
    case "6":
      return 6;
    case "7":
      return 7;
    case "8":
      return 8;
    case "9":
      return 9;
    case "10":
      return 10;
    case "J":
      return 11;
    case "Q":
      return 12;
    case "K":
      return 13;
    default:
      return undefined;
  }
}

export interface KeyGroupConstraintResult {
  readonly isValid: boolean;
  readonly reason?: string;
}

/**
 * 複数キーカードにおけるグループ制約 (sameSuit, sameRank 等) を一元的に検証します (SSOT)。
 * 
 * - 物理カードID重複チェック: 同一のカードIDが複数回使用されている場合は fail-closed
 * - sameSuit: 全カードが標準4スートの同一スートであること (Joker 除外)
 * - sameRank: 全カードが認識可能な公式カード数値を持ち、すべて同一数値であること
 */
export function matchesKeyGroupConstraints(
  cards: readonly any[],
  keyDef?: {
    readonly sameSuit?: boolean;
    readonly sameRank?: boolean;
    readonly [key: string]: any;
  }
): KeyGroupConstraintResult {
  if (!keyDef || !cards || cards.length <= 1) {
    return { isValid: true };
  }

  // 0. 物理カードIDの一意性チェック (重複使用の禁止)
  const seenIds = new Set<string>();
  for (const c of cards) {
    if (c && typeof c.id === "string" && c.id.trim() !== "") {
      if (seenIds.has(c.id)) {
        return { isValid: false, reason: "同一のキーカードが重複して指定されています。" };
      }
      seenIds.add(c.id);
    }
  }

  // 1. sameSuit の検証
  if (keyDef.sameSuit) {
    const allowedSuits = new Set(["spade", "heart", "diamond", "club"]);
    const firstSuit = normalizeSuit(cards[0]?.suit);
    if (!allowedSuits.has(firstSuit)) {
      return { isValid: false, reason: "キーカードのスートが不正です。" };
    }
    const allSameSuit = cards.every((c) => normalizeSuit(c?.suit) === firstSuit);
    if (!allSameSuit) {
      return { isValid: false, reason: "キーカードのスートが一致していません。" };
    }
  }

  // 2. sameRank の検証 (同じ数字)
  if (keyDef.sameRank) {
    const numbers: number[] = [];
    for (const c of cards) {
      const num = getCanonicalCardNumber(c);
      if (num === undefined) {
        return { isValid: false, reason: "キーカードのランクが不正です。" };
      }
      numbers.push(num);
    }

    const firstNum = numbers[0];
    const allSameRank = numbers.every((n) => n === firstNum);
    if (!allSameRank) {
      return { isValid: false, reason: "同じ数字のキーカードではありません。" };
    }
  }

  return { isValid: true };
}
