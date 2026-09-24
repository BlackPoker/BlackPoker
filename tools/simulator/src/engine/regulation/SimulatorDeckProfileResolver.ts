import { CardDefinition, FrameDefinition, SimulatorNotImplementedError } from "../../domain/regulation/RegulationDefinition";

export interface SimulatorDeckProfile {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly cardCount: number;
  readonly cards: readonly CardDefinition[];
  readonly notice?: string;
}

const SUITS = ["S", "H", "D", "C"] as const;
const RANKS: readonly { rank: string; value: number }[] = [
  { rank: "A", value: 1 },
  { rank: "2", value: 2 },
  { rank: "3", value: 3 },
  { rank: "4", value: 4 },
  { rank: "5", value: 5 },
  { rank: "6", value: 6 },
  { rank: "7", value: 7 },
  { rank: "8", value: 8 },
  { rank: "9", value: 9 },
  { rank: "10", value: 10 },
  { rank: "J", value: 11 },
  { rank: "Q", value: 12 },
  { rank: "K", value: 13 },
];

/**
 * 決定論的な標準52枚デッキFixtureカードリスト (♠/♡/♢/♣ × A〜K、Jokerなし)
 * 公式ルール第9.1.2版 Pack Frame のデッキ40枚以上要件を満たす合法な一例。
 */
export const STANDARD_52_DECK_CARDS: readonly CardDefinition[] = Object.freeze(
  SUITS.flatMap((suit) =>
    RANKS.map((r) => ({
      suit,
      rank: r.rank,
      value: r.value,
    }))
  )
);

export const STANDARD_52_FIXTURE_NOTICE = "現在のSimulatorでは標準52枚デッキFixtureを使用します";

/**
 * 決定論的な標準53枚デッキFixtureカードリスト (♠/♡/♢/♣ × A〜K 計52枚 + Joker 1枚)
 * 公式ルール第9.1.2版 Pack Frame のデッキ40枚以上要件を満たし、Standard Format の
 * Search および 魔術士召喚 を実プレイ可能とする Simulator 用の決定論的プレイアブル Fixture。
 */
export const STANDARD_53_DECK_CARDS: readonly CardDefinition[] = Object.freeze([
  ...STANDARD_52_DECK_CARDS,
  {
    suit: "J",
    rank: "Joker",
    value: 0,
  },
]);

export const STANDARD_53_FIXTURE_NOTICE = "現在のSimulatorでは53枚デッキFixture（標準52枚 + Joker 1枚）を使用します";

/**
 * 決定論的な標準54枚デッキFixtureカードリスト (♠/♡/♢/♣ × A〜K 計52枚 + Joker 2枚)
 * 公式ルール第9.1.2版 Pack Frame のデッキ40枚以上要件を満たし、
 * Light + Pack および Standard + Pack で Joker 2枚を実プレイ可能とする Simulator 用の決定論的プレイアブル Fixture。
 */
export const STANDARD_54_DECK_CARDS: readonly CardDefinition[] = Object.freeze([
  ...STANDARD_52_DECK_CARDS,
  {
    suit: "J",
    rank: "Joker",
    value: 0,
  },
  {
    suit: "J",
    rank: "Joker",
    value: 0,
  },
]);

export const STANDARD_54_FIXTURE_NOTICE = "現在のSimulatorでは54枚デッキFixture（標準52枚 + Joker 2枚）を使用します";

/**
 * Simulator 内での対戦デッキプロファイルを解決する単一の情報源 (SSOT)。
 * Frame 定義（公式ルール制約）から Simulator 用の具体的 Fixture を決定論的に解決します。
 */
export class SimulatorDeckProfileResolver {
  /**
   * フレーム定義およびレギュレーションIDから、Simulator 用 DeckProfile を解決します。
   */
  public static resolveDeckProfile(
    frame: FrameDefinition,
    regulationId?: string
  ): SimulatorDeckProfile {
    if (frame.deck.type === "fixed") {
      return {
        id: "fixed",
        cardCount: frame.deck.cardCount,
        cards: frame.deck.cards,
      };
    }

    if (!(frame.deck as any).type && Array.isArray((frame.deck as any).cards)) {
      const cards = (frame.deck as any).cards;
      return {
        id: "fixed",
        cardCount: (frame.deck as any).cardCount ?? cards.length,
        cards,
      };
    }

    if (frame.deck.type === "constructed") {
      if (regulationId === "light-pack") {
        if (STANDARD_54_DECK_CARDS.length < frame.deck.minCards) {
          throw new Error(
            `標準54枚Fixtureのカード数 (${STANDARD_54_DECK_CARDS.length}) がフレーム最小要件 (${frame.deck.minCards}) を満たしていません`
          );
        }
        return {
          id: "standard54",
          name: "標準54枚デッキFixture",
          description: "♠/♡/♢/♣ A〜K 各1枚 + Joker 2枚 (54枚)",
          cardCount: STANDARD_54_DECK_CARDS.length,
          cards: STANDARD_54_DECK_CARDS,
          notice: STANDARD_54_FIXTURE_NOTICE,
        };
      }

      if (regulationId === "standard-pack") {
        if (STANDARD_54_DECK_CARDS.length < frame.deck.minCards) {
          throw new Error(
            `標準54枚Fixtureのカード数 (${STANDARD_54_DECK_CARDS.length}) がフレーム最小要件 (${frame.deck.minCards}) を満たしていません`
          );
        }
        return {
          id: "standard54",
          name: "標準54枚デッキFixture",
          description: "♠/♡/♢/♣ A〜K 各1枚 + Joker 2枚 (54枚)",
          cardCount: STANDARD_54_DECK_CARDS.length,
          cards: STANDARD_54_DECK_CARDS,
          notice: STANDARD_54_FIXTURE_NOTICE,
        };
      }

      throw new SimulatorNotImplementedError(regulationId || "custom", frame.id);
    }

    throw new Error(`未知のデッキ種別です: ${(frame.deck as any).type}`);
  }

  /**
   * レギュレーションIDから、UI表示用の DeckProfile 案内文（Notice）を取得します。
   */
  public static getDeckProfileNotice(
    regulationId?: string,
    _frameId?: string
  ): string | undefined {
    if (regulationId === "light-pack" || regulationId === "standard-pack") {
      return STANDARD_54_FIXTURE_NOTICE;
    }
    return undefined;
  }
}
