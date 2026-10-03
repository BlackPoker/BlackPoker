import { describe, it, expect } from "vitest";
import {
  RareCardSelectionService,
  enumerateCandidates,
  validateSelections,
  extractRareCards,
  formatRareCardLabel,
} from "../../engine/regulation/RareCardSelectionService";
import {
  STANDARD_54_DECK_CARDS,
  SimulatorDeckProfile,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import { InGameCard } from "../../engine/regulation/OfficialRegulationMatchSetup";

describe("RareCardSelectionService Unit Tests [BP-SIM-REG-5.0-J-RARE-SELECTION]", () => {
  const standardProfile: SimulatorDeckProfile = {
    id: "standard54",
    name: "Standard 54-Card Deck",
    cardCount: 54,
    cards: STANDARD_54_DECK_CARDS,
    defaultRareCardSelections: [{ suit: "J", rank: "Joker", occurrence: 0 }],
  };

  describe("formatRareCardLabel", () => {
    it("formats standard suit and rank correctly", () => {
      expect(formatRareCardLabel("S", "A", 0)).toBe("♠A");
      expect(formatRareCardLabel("H", "10", 0)).toBe("♥10");
      expect(formatRareCardLabel("D", "K", 0)).toBe("♦K");
      expect(formatRareCardLabel("C", "7", 0)).toBe("♣7");
    });

    it("formats duplicate cards with occurrence suffix", () => {
      expect(formatRareCardLabel("S", "A", 1)).toBe("♠A (#2)");
      expect(formatRareCardLabel("H", "10", 2)).toBe("♥10 (#3)");
    });

    it("formats Jokers with proper label and occurrence distinction", () => {
      expect(formatRareCardLabel("J", "Joker", 0)).toBe("Joker");
      expect(formatRareCardLabel("J", "Joker", 1)).toBe("Joker (#2)");
    });
  });

  describe("enumerateCandidates", () => {
    it("enumerates all 54 cards for standard54 profile preserving occurrence and unique id", () => {
      const candidates = enumerateCandidates(standardProfile);
      expect(candidates).toHaveLength(54);

      // Verify unique candidate IDs
      const idSet = new Set(candidates.map((c) => c.id));
      expect(idSet.size).toBe(54);

      // Verify Jokers
      const jokers = candidates.filter((c) => c.suit === "J" || c.rank === "Joker");
      expect(jokers).toHaveLength(2);
      expect(jokers[0]).toMatchObject({
        suit: "J",
        rank: "Joker",
        occurrence: 0,
        displayLabel: "Joker",
      });
      expect(jokers[1]).toMatchObject({
        suit: "J",
        rank: "Joker",
        occurrence: 1,
        displayLabel: "Joker (#2)",
      });

      // Verify values
      const spadeAce = candidates.find((c) => c.suit === "S" && c.rank === "A");
      expect(spadeAce?.value).toBe(1);
      const heartKing = candidates.find((c) => c.suit === "H" && c.rank === "K");
      expect(heartKing?.value).toBe(13);
    });
  });

  describe("validateSelections", () => {
    it("accepts valid selection matching rareCardCount", () => {
      const result = validateSelections(standardProfile, 1, [
        { suit: "J", rank: "Joker", occurrence: 0 },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      const spadeResult = validateSelections(standardProfile, 1, [
        { suit: "S", rank: "A", occurrence: 0 },
      ]);
      expect(spadeResult.valid).toBe(true);
      expect(spadeResult.errors).toHaveLength(0);
    });

    it("accepts rareCardCount = 0 when no selections provided", () => {
      const result = validateSelections(standardProfile, 0, []);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      const resultUndef = validateSelections(standardProfile, 0, undefined);
      expect(resultUndef.valid).toBe(true);
      expect(resultUndef.errors).toHaveLength(0);
    });

    it("rejects selections if rareCardCount is 0 but selections are provided", () => {
      const result = validateSelections(standardProfile, 0, [
        { suit: "J", rank: "Joker", occurrence: 0 },
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "レアカードが不要な環境ですが、選択が指定されています。"
      );
    });

    it("rejects missing or undefined selections when rareCardCount > 0", () => {
      const result = validateSelections(standardProfile, 1, undefined);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("レアカードが選択されていません。");
    });

    it("rejects count mismatch", () => {
      const emptyResult = validateSelections(standardProfile, 1, []);
      expect(emptyResult.valid).toBe(false);
      expect(emptyResult.errors).toContain(
        "レアカードの指定件数 (0) が必要件数 (1) と一致しません。"
      );

      const excessResult = validateSelections(standardProfile, 1, [
        { suit: "J", rank: "Joker", occurrence: 0 },
        { suit: "S", rank: "A", occurrence: 0 },
      ]);
      expect(excessResult.valid).toBe(false);
      expect(excessResult.errors).toContain(
        "レアカードの指定件数 (2) が必要件数 (1) と一致しません。"
      );
    });

    it("rejects invalid suit or rank", () => {
      const invalidSuit = validateSelections(standardProfile, 1, [
        { suit: "X" as any, rank: "A", occurrence: 0 },
      ]);
      expect(invalidSuit.valid).toBe(false);
      expect(invalidSuit.errors.some((e) => e.includes("スートが不正"))).toBe(true);

      const invalidRank = validateSelections(standardProfile, 1, [
        { suit: "S", rank: "", occurrence: 0 },
      ]);
      expect(invalidRank.valid).toBe(false);
      expect(invalidRank.errors.some((e) => e.includes("ランクが不正"))).toBe(true);
    });

    it("rejects invalid or out-of-bounds occurrence", () => {
      const invalidOcc = validateSelections(standardProfile, 1, [
        { suit: "S", rank: "A", occurrence: -1 },
      ]);
      expect(invalidOcc.valid).toBe(false);

      // Spade Ace only occurs once in standard54 (occurrence: 0)
      const outOfBoundsOcc = validateSelections(standardProfile, 1, [
        { suit: "S", rank: "A", occurrence: 1 },
      ]);
      expect(outOfBoundsOcc.valid).toBe(false);
      expect(outOfBoundsOcc.errors.some((e) => e.includes("デッキ内に存在しません"))).toBe(
        true
      );
    });

    it("rejects duplicate card selections", () => {
      const dupResult = validateSelections(standardProfile, 2, [
        { suit: "J", rank: "Joker", occurrence: 0 },
        { suit: "J", rank: "Joker", occurrence: 0 },
      ]);
      expect(dupResult.valid).toBe(false);
      expect(dupResult.errors.some((e) => e.includes("重複して選択"))).toBe(true);
    });
  });

  describe("extractRareCards", () => {
    function createMockRawDeck(): InGameCard[] {
      return standardProfile.cards.map((c, i) => ({
        id: `card_${i + 1}`,
        suit: c.suit,
        rank: c.rank,
        value: c.value ?? 0,
      }));
    }

    it("extracts specified rare card and conserves remaining deck count (54 -> 1 + 53)", () => {
      const rawDeck = createMockRawDeck();
      expect(rawDeck).toHaveLength(54);

      const { rareCards, remainingDeck } = extractRareCards(rawDeck, [
        { suit: "J", rank: "Joker", occurrence: 0 },
      ]);

      expect(rareCards).toHaveLength(1);
      expect(rareCards[0].suit).toBe("J");
      expect(rareCards[0].rank).toBe("Joker");
      expect(remainingDeck).toHaveLength(53);

      // Remaining deck must still have 1 Joker (the second occurrence)
      const remainingJokers = remainingDeck.filter(
        (c) => c.suit === "J" || c.rank === "Joker"
      );
      expect(remainingJokers).toHaveLength(1);

      // Total conservation
      const allIds = new Set([rareCards[0].id, ...remainingDeck.map((c) => c.id)]);
      expect(allIds.size).toBe(54);
    });

    it("correctly extracts second occurrence card (Joker #2)", () => {
      const rawDeck = createMockRawDeck();
      const jokersInRaw = rawDeck.filter((c) => c.suit === "J" || c.rank === "Joker");
      expect(jokersInRaw).toHaveLength(2);

      const { rareCards, remainingDeck } = extractRareCards(rawDeck, [
        { suit: "J", rank: "Joker", occurrence: 1 },
      ]);

      expect(rareCards).toHaveLength(1);
      expect(rareCards[0].id).toBe(jokersInRaw[1].id);
      expect(remainingDeck).toHaveLength(53);
      expect(remainingDeck.find((c) => c.id === jokersInRaw[0].id)).toBeDefined();
    });

    it("returns empty rareCards and unchanged remainingDeck when selections are empty", () => {
      const rawDeck = createMockRawDeck();
      const { rareCards, remainingDeck } = extractRareCards(rawDeck, []);
      expect(rareCards).toHaveLength(0);
      expect(remainingDeck).toHaveLength(54);
      expect(remainingDeck).toEqual(rawDeck);
    });

    it("throws error when requested card is not found in deck", () => {
      const rawDeck = createMockRawDeck();
      expect(() =>
        extractRareCards(rawDeck, [{ suit: "S", rank: "A", occurrence: 5 }])
      ).toThrow("見つかりません");
    });
  });
});
