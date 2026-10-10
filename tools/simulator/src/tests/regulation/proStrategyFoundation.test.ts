import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  getFrame,
  getRegulation,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import {
  OfficialRegulationMatchSetup,
  InGameCard,
} from "../../engine/regulation/OfficialRegulationMatchSetup";
import {
  PhysicalCardReservation,
  validateScenarioHandSelections,
  validateMutualExclusion,
  extractReservations,
} from "../../engine/regulation/PhysicalCardReservation";
import {
  STANDARD_54_DECK_CARDS,
  SimulatorDeckProfile,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CardOccurrenceSelection } from "../../engine/regulation/SimulatorDeckProfileResolver";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { getAvailableEnvironments } from "../../engine/playtest/PlaytestEnvironmentController";

describe("BP-SIM-PRO-STRATEGY-PHASE-1: Pro + Strategy Foundation & Physical Reservation", () => {
  let fullRulePackage: any;

  const standardProfile: SimulatorDeckProfile = {
    id: "standard54",
    name: "Standard 54-Card Deck",
    cardCount: 54,
    cards: STANDARD_54_DECK_CARDS,
    defaultRareCardSelections: [{ suit: "J", rank: "Joker", occurrence: 0 }],
  };

  function createMockRawDeck(): InGameCard[] {
    return standardProfile.cards.map((c, i) => ({
      id: `mock_card_${i + 1}`,
      suit: c.suit,
      rank: c.rank,
      value: c.value ?? 0,
    }));
  }

  beforeAll(async () => {
    clearRegulationCache();
    await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  // 1. Strategy Frame Definition Contract
  describe("1. Strategy Frame Definition Contract", () => {
    it("strategy.yaml exists and defines exact frame properties", async () => {
      const frame = await getFrame("strategy");
      expect(frame).toBeDefined();
      expect(frame.id).toBe("strategy");
      expect(frame.name).toBe("ストラテジー");
      expect(frame.description).toContain("公式BlackPoker ストラテジーフレーム");
      expect(frame.recommendedFormatIds).toEqual(["pro", "mast"]);
      expect(frame.deck.type).toBe("constructed");
      if (frame.deck.type === "constructed") {
        expect(frame.deck.minCards).toBe(40);
      }
      expect(frame.setup.initialHandCount).toBe(7);
      expect(frame.setup.scenarioHandCount).toBe(3);
      expect(frame.setup.rareCardCount).toBe(1);
      expect(frame.setup.packCount).toBe(14);
      expect(frame.setup.preset.bulwarkCount).toBe(1);
      expect(frame.setup.preset.soldierCount).toBe(1);
      expect(frame.actions).toContain("action.packOpen");
    });
  });

  // 2. Pro + Strategy Regulation Definition Contract
  describe("2. Pro + Strategy Regulation Definition Contract", () => {
    it("pro-strategy.yaml exists and defines exact regulation properties", async () => {
      const reg = await getRegulation("pro-strategy");
      expect(reg).toBeDefined();
      expect(reg.id).toBe("pro-strategy");
      expect(reg.name).toBe("プロ + ストラテジー");
      expect(reg.formatId).toBe("pro");
      expect(reg.frameId).toBe("strategy");
      expect(reg.sourceRulesVersion).toBe("9.1.2");
    });
  });

  // 3. Physical Card Reservation Unit Tests
  describe("3. Physical Card Reservation Unit Tests", () => {
    const validScenario: CardOccurrenceSelection[] = [
      { suit: "S", rank: "A" },
      { suit: "H", rank: "K" },
      { suit: "D", rank: "Q" },
    ];
    const validRare: CardOccurrenceSelection[] = [
      { suit: "J", rank: "Joker", occurrence: 0 },
    ];

    it("validateScenarioHandSelections succeeds for exactly 3 distinct valid cards", () => {
      const res = validateScenarioHandSelections(standardProfile, 3, validScenario);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("validateScenarioHandSelections fails when count is not 3 (0, 1, 2, 4)", () => {
      const res0 = validateScenarioHandSelections(standardProfile, 3, []);
      expect(res0.valid).toBe(false);
      expect(res0.errors.some((e) => e.includes("一致しません"))).toBe(true);

      const res1 = validateScenarioHandSelections(standardProfile, 3, [{ suit: "S", rank: "A" }]);
      expect(res1.valid).toBe(false);
      expect(res1.errors.some((e) => e.includes("一致しません"))).toBe(true);

      const res2 = validateScenarioHandSelections(standardProfile, 3, validScenario.slice(0, 2));
      expect(res2.valid).toBe(false);
      expect(res2.errors.some((e) => e.includes("一致しません"))).toBe(true);

      const res4 = validateScenarioHandSelections(standardProfile, 3, [
        ...validScenario,
        { suit: "C", rank: "J" },
      ]);
      expect(res4.valid).toBe(false);
      expect(res4.errors.some((e) => e.includes("一致しません"))).toBe(true);

      const resUndef = validateScenarioHandSelections(standardProfile, 3, undefined);
      expect(resUndef.valid).toBe(false);
      expect(resUndef.errors.some((e) => e.includes("選択されていません"))).toBe(true);
    });

    it("validateScenarioHandSelections fails if card does not exist in deck", () => {
      const invalidDeckCard: CardOccurrenceSelection[] = [
        { suit: "S", rank: "A" },
        { suit: "H", rank: "K" },
        { suit: "X" as any, rank: "99" as any },
      ];
      const res = validateScenarioHandSelections(standardProfile, 3, invalidDeckCard);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("存在しないカード"))).toBe(true);
    });

    it("validateScenarioHandSelections fails on duplicate selection within Scenario Hand", () => {
      const duplicateScenario: CardOccurrenceSelection[] = [
        { suit: "S", rank: "A" },
        { suit: "S", rank: "A" },
        { suit: "H", rank: "K" },
      ];
      const res = validateScenarioHandSelections(standardProfile, 3, duplicateScenario);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("重複して選択"))).toBe(true);
    });

    it("validateMutualExclusion succeeds when Scenario Hand and Rare Card are completely disjoint", () => {
      const res = validateMutualExclusion(validScenario, validRare);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("validateMutualExclusion fails when Scenario Hand and Rare Card overlap", () => {
      const overlapScenario: CardOccurrenceSelection[] = [
        { suit: "S", rank: "A" },
        { suit: "H", rank: "K" },
        { suit: "J", rank: "Joker", occurrence: 0 },
      ];
      const res = validateMutualExclusion(overlapScenario, validRare);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("重複して選択"))).toBe(true);
    });

    it("validateMutualExclusion correctly distinguishes Joker #0 and Joker #1 as distinct physical occurrences", () => {
      const joker0Scenario: CardOccurrenceSelection[] = [
        { suit: "S", rank: "A" },
        { suit: "H", rank: "K" },
        { suit: "J", rank: "Joker", occurrence: 0 },
      ];
      const joker1Rare: CardOccurrenceSelection[] = [
        { suit: "J", rank: "Joker", occurrence: 1 },
      ];
      // Joker #0 in Scenario Hand and Joker #1 in Rare Card are distinct physical cards -> legal!
      const resValid = validateMutualExclusion(joker0Scenario, joker1Rare);
      expect(resValid.valid).toBe(true);
      expect(resValid.errors).toHaveLength(0);

      // But both specifying Joker #0 must fail
      const joker0Rare: CardOccurrenceSelection[] = [
        { suit: "J", rank: "Joker", occurrence: 0 },
      ];
      const resInvalid = validateMutualExclusion(joker0Scenario, joker0Rare);
      expect(resInvalid.valid).toBe(false);
      expect(resInvalid.errors.some((e) => e.includes("重複して選択"))).toBe(true);
    });

    it("extractReservations correctly extracts 4 cards and leaves 50 cards in remainingDeck", () => {
      const rawDeck = createMockRawDeck();
      expect(rawDeck.length).toBe(54);

      const outcome = extractReservations(rawDeck, {
        scenarioHand: validScenario,
        rareCards: validRare,
      });

      expect(outcome.reservedScenarioHandCards.length).toBe(3);
      expect(outcome.reservedRareCards.length).toBe(1);
      expect(outcome.remainingDeck.length).toBe(50);

      // Verify reservations match specs
      expect(outcome.reservedScenarioHandCards[0].suit).toBe("S");
      expect(outcome.reservedScenarioHandCards[0].rank).toBe("A");
      expect(outcome.reservedScenarioHandCards[1].suit).toBe("H");
      expect(outcome.reservedScenarioHandCards[1].rank).toBe("K");
      expect(outcome.reservedScenarioHandCards[2].suit).toBe("D");
      expect(outcome.reservedScenarioHandCards[2].rank).toBe("Q");
      expect(outcome.reservedRareCards[0].suit).toBe("J");
      expect(outcome.reservedRareCards[0].rank).toBe("Joker");

      // Verify no reservation card is present in remainingDeck
      const reservedIds = new Set([
        ...outcome.reservedScenarioHandCards.map((c) => c.id),
        ...outcome.reservedRareCards.map((c) => c.id),
      ]);
      for (const card of outcome.remainingDeck) {
        expect(reservedIds.has(card.id)).toBe(false);
      }
    });
  });

  // 4. OfficialRegulationMatchSetup Strategy Integration Tests
  describe("4. OfficialRegulationMatchSetup Strategy Integration Tests", () => {
    const validScenarioP1: CardOccurrenceSelection[] = [
      { suit: "S", rank: "A" },
      { suit: "H", rank: "K" },
      { suit: "D", rank: "Q" },
    ];
    const validScenarioP2: CardOccurrenceSelection[] = [
      { suit: "C", rank: "A" },
      { suit: "C", rank: "K" },
      { suit: "C", rank: "Q" },
    ];
    const validRareP1: CardOccurrenceSelection[] = [
      { suit: "J", rank: "Joker", occurrence: 0 },
    ];
    const validRareP2: CardOccurrenceSelection[] = [
      { suit: "J", rank: "Joker", occurrence: 0 },
    ];

    it("setupMatch fails closed when scenarioHandSelections is not provided for Strategy Frame", async () => {
      const reg = await getRegulation("pro-strategy");
      const frame = await getFrame("strategy");

      expect(() => {
        OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 42);
      }).toThrow(/Player A のシナリオ手札選択エラー: シナリオ手札が選択されていません/);

      expect(() => {
        OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 42, {
          scenarioHandSelections: {
            p1: validScenarioP1,
            // p2 is missing
          } as any,
        });
      }).toThrow(/Player B のシナリオ手札選択エラー: シナリオ手札が選択されていません/);
    });

    it("setupMatch fails when scenarioHand count is invalid or overlaps with rare", async () => {
      const reg = await getRegulation("pro-strategy");
      const frame = await getFrame("strategy");

      // Count mismatch (2 instead of 3)
      expect(() => {
        OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 42, {
          scenarioHandSelections: {
            p1: validScenarioP1.slice(0, 2),
            p2: validScenarioP2,
          },
        });
      }).toThrow(/シナリオ手札の枚数が一致しません/);

      // Overlap with Rare Card
      expect(() => {
        OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 42, {
          rareCardSelections: {
            p1: validRareP1,
            p2: validRareP2,
          },
          scenarioHandSelections: {
            p1: [
              { suit: "S", rank: "A" },
              { suit: "H", rank: "K" },
              { suit: "J", rank: "Joker", occurrence: 0 }, // overlaps with Rare!
            ],
            p2: validScenarioP2,
          },
        });
      }).toThrow(/物理カード重複エラー/);
    });

    it("setupDraftZones produces exact Strategy-specific intermediate counts (Hand: 7, Rare: 1, Pack: 14, Life: 32)", async () => {
      const reg = await getRegulation("pro-strategy");
      const frame = await getFrame("strategy");

      const draftState = OfficialRegulationMatchSetup.setupDraftZones(
        reg,
        frame,
        42,
        {
          rareCardSelections: { p1: validRareP1, p2: validRareP2 },
          scenarioHandSelections: { p1: validScenarioP1, p2: validScenarioP2 },
        }
      );

      for (const seat of ["p1", "p2"] as const) {
        const player = draftState.players[seat];

        // Rare card: exactly 1
        expect(player.rareCards.length).toBe(1);
        expect(player.rareCards[0].suit).toBe("J");
        expect(player.rareCards[0].rank).toBe("Joker");

        // Pack: exactly 14
        expect(player.pack.count).toBe(14);
        expect(player.pack.cards.length).toBe(14);

        // Hand: exactly 7 (Scenario 3 + Random 4)
        expect(player.hand.length).toBe(7);

        // Life: exactly 32 (54 - 4 reservations = 50 remaining, 50 - 14 pack = 36 life before hand, 36 - 4 random hand = 32 life)
        expect(player.life.length).toBe(32);

        // Total intermediate count: 1 + 14 + 7 + 32 = 54
        const totalCards = player.rareCards.length + player.pack.cards.length + player.hand.length + player.life.length;
        expect(totalCards).toBe(54);

        // Check that Scenario Hand cards are in Hand
        const scenarioCards = seat === "p1" ? validScenarioP1 : validScenarioP2;
        for (const spec of scenarioCards) {
          const inHand = player.hand.some((c: any) => c.suit === spec.suit && c.rank === spec.rank);
          expect(inHand).toBe(true);
        }

        // Check that Rare Card and Scenario Hand cards are NOT in Pack or Life
        const reservedIds = new Set([
          player.rareCards[0].id,
          ...player.hand.slice(player.hand.length - 3).map((c: any) => c.id), // scenario cards were appended
        ]);
        for (const card of player.pack.cards) {
          expect(reservedIds.has(card.id)).toBe(false);
        }
        for (const card of player.life) {
          expect(reservedIds.has(card.id)).toBe(false);
        }
      }
    });

    it("setupMatch completes to READY state and preserves exact 54 cards across all zones", async () => {
      const reg = await getRegulation("pro-strategy");
      const frame = await getFrame("strategy");

      const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 42, {
        rareCardSelections: { p1: validRareP1, p2: validRareP2 },
        scenarioHandSelections: { p1: validScenarioP1, p2: validScenarioP2 },
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type === "READY") {
        const { p1, p2 } = outcome.state.players;

        // Card conservation check succeeds without throwing
        expect(() => {
          OfficialRegulationMatchSetup.verifyCardConservation("p1", p1, STANDARD_54_DECK_CARDS);
          OfficialRegulationMatchSetup.verifyCardConservation("p2", p2, STANDARD_54_DECK_CARDS);
        }).not.toThrow();

        // Check that Rare cards are present
        expect(p1.rareCards.length).toBe(1);
        expect(p2.rareCards.length).toBe(1);

        // Pack is 14 cards
        expect(p1.pack?.count).toBe(14);
        expect(p2.pack?.count).toBe(14);

        // P1/P2 hand contains Scenario Hand cards
        for (const spec of validScenarioP1) {
          const inP1Hand = p1.hand.some((c) => c.suit === spec.suit && c.rank === spec.rank);
          expect(inP1Hand).toBe(true);
        }
        for (const spec of validScenarioP2) {
          const inP2Hand = p2.hand.some((c) => c.suit === spec.suit && c.rank === spec.rank);
          expect(inP2Hand).toBe(true);
        }
      }
    });

    it("Determinism: same seed and selections produce identical state; different seed shuffles differently", async () => {
      const reg = await getRegulation("pro-strategy");
      const frame = await getFrame("strategy");
      const options = {
        rareCardSelections: { p1: validRareP1, p2: validRareP2 },
        scenarioHandSelections: { p1: validScenarioP1, p2: validScenarioP2 },
      };

      const outcome1 = OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 12345, options);
      const outcome2 = OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 12345, options);

      expect(outcome1.type).toBe("READY");
      expect(outcome2.type).toBe("READY");
      if (outcome1.type === "READY" && outcome2.type === "READY") {
        expect(outcome1.firstPlayer).toBe(outcome2.firstPlayer);
        expect(outcome1.state.players.p1.rareCards).toEqual(outcome2.state.players.p1.rareCards);
        expect(outcome1.state.players.p1.pack?.cards).toEqual(outcome2.state.players.p1.pack?.cards);
        expect(outcome1.state.players.p1.hand).toEqual(outcome2.state.players.p1.hand);
        expect(outcome1.state.players.p1.life).toEqual(outcome2.state.players.p1.life);
      }

      // Different seed: reservations are identical, but shuffled zones differ
      const outcomeDiff = OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 54321, options);
      expect(outcomeDiff.type).toBe("READY");
      if (outcome1.type === "READY" && outcomeDiff.type === "READY") {
        expect(outcome1.state.players.p1.rareCards).toEqual(outcomeDiff.state.players.p1.rareCards);
        const pack1Ids = outcome1.state.players.p1.pack?.cards.map((c: any) => c.id);
        const packDiffIds = outcomeDiff.state.players.p1.pack?.cards.map((c: any) => c.id);
        expect(pack1Ids).not.toEqual(packDiffIds);
      }
    });

    it("Regression: Pro + RarePack and Standard + RarePack still work without scenarioHandSelections", async () => {
      const proRareReg = await getRegulation("pro-rarePack");
      const rarePackFrame = await getFrame("rarePack");

      const outcomeProRare = OfficialRegulationMatchSetup.setupMatch(
        proRareReg,
        rarePackFrame,
        fullRulePackage,
        42
      );
      expect(outcomeProRare.type).toBe("READY");
      if (outcomeProRare.type === "READY") {
        expect(outcomeProRare.state.players.p1.rareCards.length).toBe(1);
        expect(outcomeProRare.state.players.p1.pack?.count).toBe(14);
        expect(() => {
          OfficialRegulationMatchSetup.verifyCardConservation("p1", outcomeProRare.state.players.p1, STANDARD_54_DECK_CARDS);
          OfficialRegulationMatchSetup.verifyCardConservation("p2", outcomeProRare.state.players.p2, STANDARD_54_DECK_CARDS);
        }).not.toThrow();
      }

      // DraftZones on rarePack
      const draftStateRare = OfficialRegulationMatchSetup.setupDraftZones(
        proRareReg,
        rarePackFrame,
        42
      );
      const p1Rare = draftStateRare.players.p1;
      expect(p1Rare.rareCards.length).toBe(1);
      expect(p1Rare.pack.count).toBe(14);
      expect(p1Rare.hand.length).toBe(7); // all 7 random
      expect(p1Rare.life.length).toBe(32); // 39 - 7 = 32
      const totalRareDraft = p1Rare.rareCards.length + p1Rare.pack.cards.length + p1Rare.hand.length + p1Rare.life.length;
      expect(totalRareDraft).toBe(54);
    });

    it("Scope boundary: pro-strategy is NOT yet exposed in Environment Selector (simulatorImplemented=false)", async () => {
      const catalog = await loadRegulationCatalog();
      const validation = RegulationValidator.validateRegulation(catalog, "pro-strategy");
      expect(validation.ruleLegal).toBe(true);
      expect(validation.recommended).toBe(true);
      expect(validation.simulatorImplemented).toBe(false);

      const envs = getAvailableEnvironments(catalog);
      const exposed = envs.filter((e) => e.regulationId === "pro-strategy" || e.id === "official:pro-strategy");
      expect(exposed).toHaveLength(0);
    });
  });
});
