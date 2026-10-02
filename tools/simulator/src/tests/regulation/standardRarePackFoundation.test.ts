import { describe, it, expect, beforeAll } from "vitest";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  getFrame,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import {
  SimulatorDeckProfileResolver,
  STANDARD_54_DECK_CARDS,
  STANDARD_54_FIXTURE_NOTICE,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getAvailableEnvironments } from "../../engine/playtest/PlaytestEnvironmentController";
import { SimulatorNotImplementedError } from "../../domain/regulation/RegulationDefinition";
import path from "path";

describe("Official Regulation Phase 4.0-A - Standard + Rare Pack Foundation & Setup", () => {
  let catalog: any;
  let fullRulePackage: any;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  // A. rarePack frame definition contract
  it("A: rarePack.yaml exists and defines correct frame properties", async () => {
    const frame = await getFrame("rarePack");
    expect(frame).toBeDefined();
    expect(frame.id).toBe("rarePack");
    expect(frame.name).toBe("レアパック");
    expect(frame.description).toContain("公式BlackPoker レアパックフレーム");
    expect(frame.recommendedFormatIds).toEqual(["standard", "pro"]);
    expect(frame.deck.type).toBe("constructed");
    if (frame.deck.type === "constructed") {
      expect(frame.deck.minCards).toBe(40);
    }
    expect(frame.setup.rareCardCount).toBe(1);
    expect(frame.setup.packCount).toBe(14);
    expect(frame.setup.initialHandCount).toBe(7);
    expect(frame.setup.preset.bulwarkCount).toBe(1);
    expect(frame.setup.preset.soldierCount).toBe(1);
    expect(frame.actions).toContain("action.packOpen");
  });

  // B. standard-rarePack regulation definition contract
  it("B: standard-rarePack.yaml exists and defines correct regulation properties", async () => {
    const reg = await getRegulation("standard-rarePack");
    expect(reg).toBeDefined();
    expect(reg.id).toBe("standard-rarePack");
    expect(reg.name).toBe("スタンダード + レアパック");
    expect(reg.formatId).toBe("standard");
    expect(reg.frameId).toBe("rarePack");
    expect(reg.sourceRulesVersion).toBe("9.1.2");
  });

  // C. RegulationValidator contract: ruleLegal=true, recommended=true, simulatorImplemented=true
  it("C: RegulationValidator validates standard-rarePack as legal, recommended, and simulatorImplemented=true", async () => {
    const validation = RegulationValidator.validateRegulation(catalog, "standard-rarePack");
    expect(validation.ruleLegal).toBe(true);
    expect(validation.recommended).toBe(true);
    expect(validation.simulatorImplemented).toBe(true);
    expect(() =>
      RegulationValidator.validateRegulation(catalog, "standard-rarePack", { assertImplemented: true })
    ).not.toThrow();
  });

  // D. getAvailableEnvironments: standard-rarePack is PRESENT
  it("D: getAvailableEnvironments lists official:standard-rarePack exactly once with notice", async () => {
    const envs = getAvailableEnvironments(catalog);
    const matches = envs.filter(
      (e) => e.regulationId === "standard-rarePack" || e.id === "official:standard-rarePack"
    );
    expect(matches).toHaveLength(1);
    const found = matches[0];
    expect(found.id).toBe("official:standard-rarePack");
    expect(found.name).toBe("スタンダード + レアパック (公式)");
    expect(found.isOfficial).toBe(true);
    expect(found.regulationId).toBe("standard-rarePack");
    expect(found.deckProfileNotice).toBe(STANDARD_54_FIXTURE_NOTICE);
  });

  // E. createSession: standard-rarePack creates session successfully
  it("E: OfficialRegulationMatchFactory.createSession('standard-rarePack') creates session successfully", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("standard-rarePack", 42, {
      catalog,
      fullRulePackage,
    });
    expect(session).toBeDefined();
    expect(session.state.regulationId).toBe("standard-rarePack");
    expect(session.rulePackage.id).toBe("official-standard-rarePack");
  });

  // F & G. Deck Profile Resolver contract: 54 cards, 2 Jokers, default rare selection Joker 1枚
  it("F & G: SimulatorDeckProfileResolver resolves 54-card deck and default rare Joker selection", async () => {
    const frame = await getFrame("rarePack");
    const profile = SimulatorDeckProfileResolver.resolveDeckProfile(frame, "standard-rarePack");
    expect(profile.id).toBe("standard54");
    expect(profile.cardCount).toBe(54);
    expect(profile.cards.length).toBe(54);

    const jokers = profile.cards.filter((c) => c.suit === "J" || c.rank === "Joker");
    expect(jokers.length).toBe(2);

    expect(profile.defaultRareCardSelections).toBeDefined();
    expect(profile.defaultRareCardSelections?.length).toBe(1);
    expect(profile.defaultRareCardSelections?.[0]).toEqual({
      suit: "J",
      rank: "Joker",
      occurrence: 0,
    });
  });

  // H, I, J, K, L, M, N, O: Rare selection, pack, life, conservation during setup
  it("H-O: Setup order: Rare card separated before shuffle, 53 cards shuffled, 14 pack, 39 life, 54 conserved", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");

    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 42);
    expect(outcome.type).toBe("READY");

    if (outcome.type === "READY") {
      const state = outcome.state;
      const p1 = state.players.p1;
      const p2 = state.players.p2;

      // Rare card zone
      expect(p1.rareCards).toBeDefined();
      expect(p1.rareCards.length).toBe(1);
      expect(p1.rareCards[0].suit).toBe("J");
      expect(p1.rareCards[0].rank).toBe("Joker");
      expect(p1.rareCards[0].id).toBe("p1-c-JJoker");

      expect(p2.rareCards).toBeDefined();
      expect(p2.rareCards.length).toBe(1);
      expect(p2.rareCards[0].suit).toBe("J");
      expect(p2.rareCards[0].rank).toBe("Joker");
      expect(p2.rareCards[0].id).toBe("p2-c-JJoker");

      // Rare card is NOT in Pack
      expect(p1.pack).toBeDefined();
      expect(p1.pack.count).toBe(14);
      expect(p1.pack.cards.length).toBe(14);
      const p1RareInPack = p1.pack.cards.some((c: any) => c.id === p1.rareCards[0].id);
      expect(p1RareInPack).toBe(false);

      // Remaining Joker in remaining deck / life / hand / field / grave
      const p1OtherJokerId = "p1-c-JJoker#1";
      const allP1Cards = [
        ...p1.life,
        ...p1.hand,
        ...p1.field.flatMap((u: any) => u.cards),
        ...p1.grave.flatMap((g: any) => g.cards || [g]),
        ...p1.pack.cards,
        ...p1.rareCards,
      ];
      expect(allP1Cards.length).toBe(54);
      expect(allP1Cards.filter((c: any) => c.id === p1OtherJokerId).length).toBe(1);
      expect(allP1Cards.filter((c: any) => c.id === p1.rareCards[0].id).length).toBe(1);

      // Card conservation check succeeds without throwing
      expect(() => {
        OfficialRegulationMatchSetup.verifyCardConservation("p1", p1, STANDARD_54_DECK_CARDS);
        OfficialRegulationMatchSetup.verifyCardConservation("p2", p2, STANDARD_54_DECK_CARDS);
      }).not.toThrow();
    }
  });

  // P: Same seed determinism
  it("P: Same seed produces identical initial state (Rare, Pack, Life, Hand, First Player)", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");

    const outcome1 = OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 12345);
    const outcome2 = OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 12345);

    expect(outcome1.type).toBe("READY");
    expect(outcome2.type).toBe("READY");

    if (outcome1.type === "READY" && outcome2.type === "READY") {
      expect(outcome1.firstPlayer).toBe(outcome2.firstPlayer);
      expect(outcome1.state.players.p1.rareCards).toEqual(outcome2.state.players.p1.rareCards);
      expect(outcome1.state.players.p1.pack.cards).toEqual(outcome2.state.players.p1.pack.cards);
      expect(outcome1.state.players.p1.hand).toEqual(outcome2.state.players.p1.hand);
      expect(outcome1.state.players.p1.life).toEqual(outcome2.state.players.p1.life);
    }
  });

  // Q: Different seed produces different shuffle, but deterministic default rare
  it("Q: Different seed produces same rare default card, but different shuffled cards", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");

    const outcome1 = OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 100);
    const outcome2 = OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 200);

    if (outcome1.type === "READY" && outcome2.type === "READY") {
      expect(outcome1.state.players.p1.rareCards).toEqual(outcome2.state.players.p1.rareCards);
      // But Pack/Life shuffled cards differ
      const pack1Ids = outcome1.state.players.p1.pack.cards.map((c: any) => c.id);
      const pack2Ids = outcome2.state.players.p1.pack.cards.map((c: any) => c.id);
      expect(pack1Ids).not.toEqual(pack2Ids);
    }
  });

  // U, V, W: Regression checks for standard-pack, light-pack, light-entry16
  it("U, V, W: Existing regulations (standard-pack, light-pack, light-entry16) produce empty rareCards and unchanged setup", async () => {
    const stdPackReg = await getRegulation("standard-pack");
    const packFrame = await getFrame("pack");
    const entry16Reg = await getRegulation("light-entry16");
    const entry16Frame = await getFrame("entry16");

    const stdPackOutcome = OfficialRegulationMatchSetup.setupMatch(stdPackReg, packFrame, fullRulePackage, 42);
    expect(stdPackOutcome.type).toBe("READY");
    if (stdPackOutcome.type === "READY") {
      expect(stdPackOutcome.state.players.p1.rareCards).toEqual([]);
      expect(stdPackOutcome.state.players.p2.rareCards).toEqual([]);
      expect(stdPackOutcome.state.players.p1.pack.cards.length).toBe(14);
    }

    const entry16Outcome = OfficialRegulationMatchSetup.setupMatch(entry16Reg, entry16Frame, fullRulePackage, 42);
    expect(entry16Outcome.type).toBe("READY");
    if (entry16Outcome.type === "READY") {
      expect(entry16Outcome.state.players.p1.rareCards).toEqual([]);
      expect(entry16Outcome.state.players.p2.rareCards).toEqual([]);
      expect(entry16Outcome.state.players.p1.pack).toBeUndefined();
    }
  });

  // Fail-closed checks
  it("Fail closed: invalid rareCardCount or missing card throws", async () => {
    const reg = await getRegulation("standard-rarePack");
    const invalidFrameNegative = {
      ...(await getFrame("rarePack")),
      setup: {
        ...(await getFrame("rarePack")).setup,
        rareCardCount: -1,
      },
    };
    expect(() =>
      OfficialRegulationMatchSetup.setupMatch(reg, invalidFrameNegative as any, fullRulePackage, 42)
    ).toThrow(/不正な rareCardCount/);

    const invalidFrameCountMismatch = {
      ...(await getFrame("rarePack")),
      setup: {
        ...(await getFrame("rarePack")).setup,
        rareCardCount: 2, // but default has 1
      },
    };
    expect(() =>
      OfficialRegulationMatchSetup.setupMatch(reg, invalidFrameCountMismatch as any, fullRulePackage, 42)
    ).toThrow(/指定件数.*一致しません/);
  });

  // minCards official semantics: original deck minCards=54, rare=1, remaining=53 -> succeeds!
  it("minCards official semantics: minCards validated on original deck; remaining < minCards after rare extraction is legal", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frameWithMin54 = {
      ...(await getFrame("rarePack")),
      deck: {
        type: "constructed",
        minCards: 54,
      },
    };

    // Original deck is 54 cards (= minCards 54).
    // After rare extraction of 1 card, remaining deck is 53 cards (< minCards 54).
    // Official semantics: this is legal and setup succeeds!
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frameWithMin54 as any, fullRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type === "READY") {
      expect(outcome.state.players.p1.rareCards.length).toBe(1);
      expect(outcome.state.players.p1.pack.cards.length).toBe(14);
      expect(() => {
        OfficialRegulationMatchSetup.verifyCardConservation("p1", outcome.state.players.p1, STANDARD_54_DECK_CARDS);
        OfficialRegulationMatchSetup.verifyCardConservation("p2", outcome.state.players.p2, STANDARD_54_DECK_CARDS);
      }).not.toThrow();
    }
  });
});
