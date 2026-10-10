import { describe, it, expect } from "vitest";
import {
  ScenarioHandSelectionService,
  enumerateCandidates,
  validateSelections,
  resolveAutoSelections,
} from "../../engine/regulation/ScenarioHandSelectionService";
import {
  STANDARD_54_DECK_CARDS,
  SimulatorDeckProfile,
} from "../../engine/regulation/SimulatorDeckProfileResolver";

describe("ScenarioHandSelectionService Unit Tests [BP-SIM-PRO-STRATEGY-PHASE-2]", () => {
  const standardProfile: SimulatorDeckProfile = {
    id: "standard54",
    name: "Standard 54-Card Deck",
    cardCount: 54,
    cards: STANDARD_54_DECK_CARDS,
    defaultRareCardSelections: [{ suit: "J", rank: "Joker", occurrence: 0 }],
  };

  describe("enumerateCandidates", () => {
    it("enumerates all 54 cards for standard54 profile preserving occurrence and unique id", () => {
      const candidates = enumerateCandidates(standardProfile);
      expect(candidates).toHaveLength(54);

      // Unique candidate IDs
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
    });
  });

  describe("validateSelections", () => {
    it("accepts valid selection matching scenarioHandCount = 3", () => {
      const result = validateSelections(standardProfile, 3, [
        { suit: "S", rank: "A", occurrence: 0 },
        { suit: "H", rank: "K", occurrence: 0 },
        { suit: "D", rank: "Q", occurrence: 0 },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails when count is not 3 (0, 1, 2, 4)", () => {
      const res0 = validateSelections(standardProfile, 3, []);
      expect(res0.valid).toBe(false);
      expect(res0.errors.some((e) => e.includes("一致しません"))).toBe(true);

      const res2 = validateSelections(standardProfile, 3, [
        { suit: "S", rank: "A", occurrence: 0 },
        { suit: "H", rank: "K", occurrence: 0 },
      ]);
      expect(res2.valid).toBe(false);

      const res4 = validateSelections(standardProfile, 3, [
        { suit: "S", rank: "A", occurrence: 0 },
        { suit: "H", rank: "K", occurrence: 0 },
        { suit: "D", rank: "Q", occurrence: 0 },
        { suit: "C", rank: "J", occurrence: 0 },
      ]);
      expect(res4.valid).toBe(false);
    });

    it("fails on duplicate selection within scenario hand", () => {
      const result = validateSelections(standardProfile, 3, [
        { suit: "S", rank: "A", occurrence: 0 },
        { suit: "S", rank: "A", occurrence: 0 },
        { suit: "H", rank: "K", occurrence: 0 },
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("重複"))).toBe(true);
    });

    it("fails when non-existent card is specified", () => {
      const result = validateSelections(standardProfile, 3, [
        { suit: "S", rank: "A", occurrence: 0 },
        { suit: "H", rank: "K", occurrence: 0 },
        { suit: "X" as any, rank: "99" as any, occurrence: 0 },
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("存在しない"))).toBe(true);
    });
  });

  describe("resolveAutoSelections", () => {
    it("returns exactly scenarioHandCount = 3 valid cards", () => {
      const sels = resolveAutoSelections({
        deckProfile: standardProfile,
        scenarioHandCount: 3,
        matchSeed: 42,
        playerKey: "p2",
      });

      expect(sels).toHaveLength(3);
      const val = validateSelections(standardProfile, 3, sels);
      expect(val.valid).toBe(true);
    });

    it("is completely deterministic: same seed produces identical selections", () => {
      const sels1 = resolveAutoSelections({
        deckProfile: standardProfile,
        scenarioHandCount: 3,
        matchSeed: 12345,
        playerKey: "p2",
      });
      const sels2 = resolveAutoSelections({
        deckProfile: standardProfile,
        scenarioHandCount: 3,
        matchSeed: 12345,
        playerKey: "p2",
      });

      expect(sels1).toEqual(sels2);
    });

    it("different seed produces different selections", () => {
      const sels1 = resolveAutoSelections({
        deckProfile: standardProfile,
        scenarioHandCount: 3,
        matchSeed: 100,
        playerKey: "p2",
      });
      const sels2 = resolveAutoSelections({
        deckProfile: standardProfile,
        scenarioHandCount: 3,
        matchSeed: 200,
        playerKey: "p2",
      });

      expect(sels1).not.toEqual(sels2);
    });

    it("strictly excludes excludedSelections (AI Rare Card) without occurrence collision", () => {
      const excludedRare = [{ suit: "J" as const, rank: "Joker", occurrence: 0 }];

      // Repeat with multiple seeds to verify exclusion never fails
      for (const seed of [1, 42, 100, 999, 12345]) {
        const sels = resolveAutoSelections({
          deckProfile: standardProfile,
          scenarioHandCount: 3,
          excludedSelections: excludedRare,
          matchSeed: seed,
          playerKey: "p2",
        });

        // Joker #0 must NEVER be chosen
        const hasJoker0 = sels.some(
          (c) => c.suit === "J" && c.rank === "Joker" && (c.occurrence ?? 0) === 0
        );
        expect(hasJoker0).toBe(false);
      }
    });

    it("allows Joker #1 even when Joker #0 is excluded", () => {
      const excludedRare = [{ suit: "J" as const, rank: "Joker", occurrence: 0 }];

      // Search a seed that picks Joker #1
      let foundJoker1 = false;
      for (let seed = 0; seed < 100; seed++) {
        const sels = resolveAutoSelections({
          deckProfile: standardProfile,
          scenarioHandCount: 3,
          excludedSelections: excludedRare,
          matchSeed: seed,
          playerKey: "p2",
        });
        if (sels.some((c) => c.suit === "J" && c.rank === "Joker" && c.occurrence === 1)) {
          foundJoker1 = true;
          break;
        }
      }
      expect(foundJoker1).toBe(true);
    });
  });
});
