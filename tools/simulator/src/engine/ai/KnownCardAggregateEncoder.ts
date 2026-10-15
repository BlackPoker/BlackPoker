/**
 * KnownCardAggregateEncoder.ts
 *
 * BlackPoker Simulator - AI Feature Schema v2
 *
 * 合法的に観測可能なカード群 (KnownCardView) から、順序非依存かつ決定論的な固定長統計量を抽出する Pure Helper。
 * 秘密情報 (HIDDEN) カードは集約対象から自動的に除外されます。
 * 特定のゲームルールやアクション ID には依存しません。
 */

import { CardView, KnownCardView } from "../../domain/decision/PlayerObservation";

export interface KnownCardAggregate {
  /** 観測可能な既知カード総数 */
  readonly count: number;

  // スーツ別枚数
  readonly spadeCount: number;
  readonly heartCount: number;
  readonly diamondCount: number;
  readonly clubCount: number;
  readonly jokerCount: number;

  // ランク別枚数
  readonly numericCount: number; // 2〜10
  readonly aceCount: number;
  readonly jackCount: number;
  readonly queenCount: number;
  readonly kingCount: number;

  // 数値統計
  readonly valueSum: number;
  readonly valueMax: number;
  readonly valueMin: number;

  // ペア・重複数
  readonly pairRankCount: number; // 2枚以上存在するランクの種類の数
  readonly maxRankMultiplicity: number; // 単一ランクにおける最大重複枚数
}

export const EMPTY_KNOWN_CARD_AGGREGATE: KnownCardAggregate = {
  count: 0,
  spadeCount: 0,
  heartCount: 0,
  diamondCount: 0,
  clubCount: 0,
  jokerCount: 0,
  numericCount: 0,
  aceCount: 0,
  jackCount: 0,
  queenCount: 0,
  kingCount: 0,
  valueSum: 0,
  valueMax: 0,
  valueMin: 0,
  pairRankCount: 0,
  maxRankMultiplicity: 0,
};

export class KnownCardAggregateEncoder {
  /**
   * 与えられたカード配列から、既知カードのみを固定長統計量へ集約します。
   * 入力配列の順序には一切依存せず、同一のカード集合に対して完全に同一の出力を返します。
   */
  public static encode(cards: readonly (CardView | KnownCardView)[] | undefined | null): KnownCardAggregate {
    if (!cards || cards.length === 0) {
      return EMPTY_KNOWN_CARD_AGGREGATE;
    }

    let count = 0;
    let spadeCount = 0;
    let heartCount = 0;
    let diamondCount = 0;
    let clubCount = 0;
    let jokerCount = 0;
    let numericCount = 0;
    let aceCount = 0;
    let jackCount = 0;
    let queenCount = 0;
    let kingCount = 0;
    let valueSum = 0;
    let valueMax = 0;
    let valueMin = Infinity;

    const rankCounts = new Map<string, number>();

    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (!c || c.visibility !== "KNOWN") {
        continue;
      }

      count++;

      const suit = (c.suit || "").toUpperCase();
      const rawRank = String(c.rank || "").trim();
      const upperRank = rawRank.toUpperCase();

      const isJoker = suit === "J" || suit === "JOKER" || upperRank === "JOKER";

      if (isJoker) {
        jokerCount++;
      } else {
        if (suit === "S" || suit === "SPADE") spadeCount++;
        else if (suit === "H" || suit === "HEART") heartCount++;
        else if (suit === "D" || suit === "DIAMOND") diamondCount++;
        else if (suit === "C" || suit === "CLUB") clubCount++;

        if (upperRank === "A" || upperRank === "1") {
          aceCount++;
        } else if (upperRank === "J" || upperRank === "11") {
          jackCount++;
        } else if (upperRank === "Q" || upperRank === "12") {
          queenCount++;
        } else if (upperRank === "K" || upperRank === "13") {
          kingCount++;
        } else {
          const num = Number(rawRank);
          if (Number.isFinite(num) && num >= 2 && num <= 10) {
            numericCount++;
          }
        }
      }

      // ランク重複カウント (Joker も 1 ランクとして集約)
      const canonicalRank = suit === "J" || upperRank === "JOKER" ? "JOKER" : upperRank;
      const prevCount = rankCounts.get(canonicalRank) || 0;
      rankCounts.set(canonicalRank, prevCount + 1);

      // 数値統計 (Schema v5: Joker は rank 0 として集約)
      const rawVal = typeof c.value === "number" && Number.isFinite(c.value) ? c.value : 0;
      const val = isJoker ? 0 : rawVal;
      valueSum += val;
      if (val > valueMax) valueMax = val;
      if (val < valueMin) valueMin = val;
    }

    if (count === 0) {
      return EMPTY_KNOWN_CARD_AGGREGATE;
    }

    // ペア・重複数
    let pairRankCount = 0;
    let maxRankMultiplicity = 0;

    for (const cnt of rankCounts.values()) {
      if (cnt >= 2) {
        pairRankCount++;
      }
      if (cnt > maxRankMultiplicity) {
        maxRankMultiplicity = cnt;
      }
    }

    return {
      count,
      spadeCount,
      heartCount,
      diamondCount,
      clubCount,
      jokerCount,
      numericCount,
      aceCount,
      jackCount,
      queenCount,
      kingCount,
      valueSum,
      valueMax,
      valueMin: valueMin === Infinity ? 0 : valueMin,
      pairRankCount,
      maxRankMultiplicity,
    };
  }
}
