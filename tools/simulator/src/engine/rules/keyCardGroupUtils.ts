import { normalizeSuit, isJokerCard } from "./cardUtils";

/**
 * カードの公式表記に基づき、Canonical なカード数値を厳格に取得します (Fail-Closed)。
 * 
 * 認識される公式カード数値:
 * - Joker = 0
 * - A = 1
 * - 2..10 = 2..10
 * - J = 11
 * - Q = 12
 * - K = 13
 * 
 * 不正・未知のランクやスートの場合は undefined を返し、
 * 0 に暗黙フォールバックして Joker と誤判定されることを防ぎます。
 */
export function getCanonicalCardNumber(card: any): number | undefined {
  if (!card || typeof card !== "object") return undefined;

  // Joker 判定
  if (isJokerCard(card)) {
    return 0;
  }

  // スートが指定されている場合の検証（Joker でない場合は標準スートであることを要求）
  if (card.suit !== undefined && card.suit !== null) {
    const normSuit = normalizeSuit(card.suit);
    const allowedSuits = new Set(["spade", "heart", "diamond", "club"]);
    if (!allowedSuits.has(normSuit)) {
      return undefined;
    }
  }

  if (card.rank === undefined || card.rank === null) {
    return undefined;
  }

  const r = String(card.rank).toUpperCase().trim();
  switch (r) {
    case "A":
    case "1":
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
    case "11":
      return 11;
    case "Q":
    case "12":
      return 12;
    case "K":
    case "13":
      return 13;
    case "0":
    case "JOKER":
      return 0;
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
