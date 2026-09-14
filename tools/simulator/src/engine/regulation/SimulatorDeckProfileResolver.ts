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
      // Pack Frame / light-pack レギュレーション用の標準52枚 Fixture
      if (frame.id === "pack" || regulationId === "light-pack") {
        if (STANDARD_52_DECK_CARDS.length < frame.deck.minCards) {
          throw new Error(
            `標準52枚Fixtureのカード数 (${STANDARD_52_DECK_CARDS.length}) がフレーム最小要件 (${frame.deck.minCards}) を満たしていません`
          );
        }
        return {
          id: "standard52",
          name: "標準52枚デッキFixture",
          description: "♠/♡/♢/♣ A〜K 各1枚 (52枚)",
          cardCount: STANDARD_52_DECK_CARDS.length,
          cards: STANDARD_52_DECK_CARDS,
          notice: STANDARD_52_FIXTURE_NOTICE,
        };
      }

      throw new SimulatorNotImplementedError(regulationId || "custom", frame.id);
    }

    throw new Error(`未知のデッキ種別です: ${(frame.deck as any).type}`);
  }

  /**
   * レギュレーションIDまたはフレームIDから、UI表示用の DeckProfile 案内文（Notice）を取得します。
   */
  public static getDeckProfileNotice(
    regulationId?: string,
    frameId?: string
  ): string | undefined {
    if (regulationId === "light-pack" || frameId === "pack") {
      return STANDARD_52_FIXTURE_NOTICE;
    }
    return undefined;
  }
}
