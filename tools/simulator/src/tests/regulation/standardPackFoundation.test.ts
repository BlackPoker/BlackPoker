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
  STANDARD_52_DECK_CARDS,
  STANDARD_53_DECK_CARDS,
  STANDARD_52_FIXTURE_NOTICE,
  STANDARD_53_FIXTURE_NOTICE,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getAvailableEnvironments } from "../../engine/playtest/PlaytestEnvironmentController";
import { SimulatorNotImplementedError } from "../../domain/regulation/RegulationDefinition";
import path from "path";

describe("Official Regulation Phase 3.0-A - Standard + Pack Foundation & Fixture", () => {
  let catalog: any;
  let fullRulePackage: any;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("Test A: standard.yaml exists and resolves via catalog", async () => {
    const format = await getFormat("standard");
    expect(format).toBeDefined();
    expect(format.id).toBe("standard");
    expect(format.name).toBe("スタンダード");
    expect(format.description).toContain("公式BlackPoker スタンダードフォーマット");
  });

  it("Test B: Standard actions match official canonical order exactly (25 actions)", async () => {
    const format = await getFormat("standard");
    const expectedActions = [
      // 基本 (7)
      "action.end",
      "action.charge",
      "action.draw",
      "action.attack",
      "action.block",
      "action.damageJudge",
      "action.nextGeneration",
      // 召喚 (6)
      "action.setBulwark",
      "action.summonSoldier",
      "action.summonHero",
      "action.summonAce",
      "action.summonMagician",
      "action.mountSoldier",
      // 基礎魔法 (4)
      "action.up",
      "action.down",
      "action.twist",
      "action.counter",
      // 中級魔法 (8)
      "action.destroyBulwark",
      "action.throwing",
      "action.deathLance",
      "action.addBulwark",
      "action.reanimate",
      "action.handeth",
      "action.search",
      "action.unsummons",
    ];

    expect(format.actions).toEqual(expectedActions);
    expect(format.actions.length).toBe(25);
  });

  it("Test C: Standard components reflect official specification (8 components)", async () => {
    const format = await getFormat("standard");
    const expectedComponents = [
      "character.soldier",
      "character.hero",
      "character.ace",
      "character.magician",
      "character.armedSoldier",
      "character.bulwark",
      "fog.up",
      "fog.down",
    ];

    expect(format.components).toEqual(expectedComponents);
    expect(format.components.length).toBe(8);
  });

  it("Test D & E: standard-pack regulation exists and reuses pack frame", async () => {
    const reg = await getRegulation("standard-pack");
    expect(reg).toBeDefined();
    expect(reg.id).toBe("standard-pack");
    expect(reg.name).toBe("スタンダード + パック");
    expect(reg.formatId).toBe("standard");
    expect(reg.frameId).toBe("pack");
    expect(reg.sourceRulesVersion).toBe("9.1.2");

    const frame = await getFrame("pack");
    expect(frame).toBeDefined();
    expect(frame.id).toBe("pack");
    expect(frame.recommendedFormatIds).toContain("standard");
  });

  it("Test F & G: standard-pack is ruleLegal=true, recommended=true, but simulatorImplemented=false in 3.0-A", async () => {
    const result = RegulationValidator.validateRegulation(catalog, "standard-pack");
    expect(result.ruleLegal).toBe(true);
    expect(result.recommended).toBe(true);
    expect(result.simulatorImplemented).toBe(false);

    // assertImplemented: true でエラー送出を確認
    expect(() =>
      RegulationValidator.validateRegulation(catalog, "standard-pack", { assertImplemented: true })
    ).toThrow(SimulatorNotImplementedError);

    // OfficialRegulationMatchFactory.createSession でエラー送出を確認
    await expect(
      OfficialRegulationMatchFactory.createSession("standard-pack", 42, { catalog, fullRulePackage })
    ).rejects.toThrow(SimulatorNotImplementedError);
  });

  it("Test H & I: standard-pack fixture resolves to 53 cards with exactly 1 Joker", async () => {
    const frame = await getFrame("pack");
    const profile = SimulatorDeckProfileResolver.resolveDeckProfile(frame, "standard-pack");

    expect(profile.id).toBe("standard53");
    expect(profile.cardCount).toBe(53);
    expect(profile.cards.length).toBe(53);
    expect(profile.notice).toBe(STANDARD_53_FIXTURE_NOTICE);

    // Joker は exactly 1 枚
    const jokers = profile.cards.filter((c) => c.rank === "Joker");
    expect(jokers.length).toBe(1);
    expect(jokers[0]).toEqual({
      suit: "J",
      rank: "Joker",
      value: 0,
    });

    // 残り52枚は通常カード (♠/♡/♢/♣ 各13枚)
    const nonJokers = profile.cards.filter((c) => c.rank !== "Joker");
    expect(nonJokers.length).toBe(52);
    for (const suit of ["S", "H", "D", "C"] as const) {
      const suitCards = nonJokers.filter((c) => c.suit === suit);
      expect(suitCards.length).toBe(13);
      const ranks = suitCards.map((c) => c.rank).sort();
      expect(ranks).toEqual(["10", "2", "3", "4", "5", "6", "7", "8", "9", "A", "J", "K", "Q"]);
    }
  });

  it("Test J: standard-pack fixture is deterministic and frozen", async () => {
    const frame = await getFrame("pack");
    const p1 = SimulatorDeckProfileResolver.resolveDeckProfile(frame, "standard-pack");
    const p2 = SimulatorDeckProfileResolver.resolveDeckProfile(frame, "standard-pack");

    expect(p1.cards).toBe(p2.cards);
    expect(Object.isFrozen(STANDARD_53_DECK_CARDS)).toBe(true);
  });

  it("Test K: light-pack fixture remains standard52 (52 cards, 0 Jokers)", async () => {
    const frame = await getFrame("pack");
    const profile = SimulatorDeckProfileResolver.resolveDeckProfile(frame, "light-pack");

    expect(profile.id).toBe("standard52");
    expect(profile.cardCount).toBe(52);
    expect(profile.cards.length).toBe(52);
    expect(profile.notice).toBe(STANDARD_52_FIXTURE_NOTICE);
    expect(profile.cards.some((c) => c.rank === "Joker")).toBe(false);
  });

  it("Test L: light-pack same-seed setup remains completely unchanged", async () => {
    const lightPackReg = await getRegulation("light-pack");
    const frame = await getFrame("pack");

    const setup1 = OfficialRegulationMatchSetup.setupMatch(lightPackReg, frame, fullRulePackage, 42);
    const setup2 = OfficialRegulationMatchSetup.setupMatch(lightPackReg, frame, fullRulePackage, 42);

    expect(setup1.type).toBe("READY");
    expect(setup2.type).toBe("READY");
    if (setup1.type === "READY" && setup2.type === "READY") {
      expect(setup1.state.players.p1.pack.cards.map((c: any) => c.id)).toEqual(
        setup2.state.players.p1.pack.cards.map((c: any) => c.id)
      );
      expect(setup1.state.players.p1.hand.map((c: any) => c.id)).toEqual(
        setup2.state.players.p1.hand.map((c: any) => c.id)
      );
      expect(setup1.state.players.p1.life.map((c: any) => c.id)).toEqual(
        setup2.state.players.p1.life.map((c: any) => c.id)
      );
      expect(setup1.state.turnPlayer).toBe(setup2.state.turnPlayer);
    }
  });

  it("Test M: entry16 regression check - light-entry16 unaffected", async () => {
    const entry16Reg = await getRegulation("light-entry16");
    const frame = await getFrame("entry16");

    const setup = OfficialRegulationMatchSetup.setupMatch(entry16Reg, frame, fullRulePackage, 42);
    expect(setup.type).toBe("READY");
    expect(frame.deck.type).toBe("fixed");
    const deck = frame.deck;
    if (setup.type === "READY" && deck.type === "fixed") {
      const fixedCards = deck.cards;
      if (setup.state.turnPlayer === "p1") {
        expect(setup.state.players.p1.hand.length).toBe(8);
        expect(setup.state.players.p2.hand.length).toBe(7);
      } else {
        expect(setup.state.players.p1.hand.length).toBe(7);
        expect(setup.state.players.p2.hand.length).toBe(8);
      }
      expect(
        () => OfficialRegulationMatchSetup.verifyCardConservation("p1", setup.state.players.p1, fixedCards)
      ).not.toThrow();
      expect(
        () => OfficialRegulationMatchSetup.verifyCardConservation("p2", setup.state.players.p2, fixedCards)
      ).not.toThrow();
    }
  });

  it("Test N: action.packOpen is not in standard.yaml, but provided via Frame composition", async () => {
    const standardFormat = await getFormat("standard");
    const standardPackReg = await getRegulation("standard-pack");
    const packFrame = await getFrame("pack");

    expect(standardFormat.actions.includes("action.packOpen")).toBe(false);

    const composedPkg = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg,
      packFrame
    );

    expect(composedPkg.actions.some((a) => a.id === "action.packOpen")).toBe(true);
  });

  it("Test O: Pro and Master only actions are strictly excluded from standard.yaml", async () => {
    const format = await getFormat("standard");
    const forbiddenActionSnippets = [
      "quickSummonsAce",
      "kill",
      "reunion",
      "truce",
      "changeTarget",
      "reverse",
      "swordRain",
    ];

    for (const actionId of format.actions) {
      for (const forbidden of forbiddenActionSnippets) {
        expect(actionId.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it("Test P: Notice resolution SSOT by regulationId", () => {
    expect(SimulatorDeckProfileResolver.getDeckProfileNotice("light-pack")).toBe(
      STANDARD_52_FIXTURE_NOTICE
    );
    expect(SimulatorDeckProfileResolver.getDeckProfileNotice("standard-pack")).toBe(
      STANDARD_53_FIXTURE_NOTICE
    );
    expect(SimulatorDeckProfileResolver.getDeckProfileNotice("light-entry16")).toBeUndefined();
    expect(SimulatorDeckProfileResolver.getDeckProfileNotice(undefined)).toBeUndefined();
  });

  it("Test Q: standard-pack does not appear in getAvailableEnvironments until simulatorImplemented=true", () => {
    const envs = getAvailableEnvironments(catalog);
    expect(envs.some((e) => e.regulationId === "standard-pack")).toBe(false);
    expect(envs.some((e) => e.regulationId === "light-pack")).toBe(true);
    expect(envs.some((e) => e.regulationId === "light-entry16")).toBe(true);
  });
});
