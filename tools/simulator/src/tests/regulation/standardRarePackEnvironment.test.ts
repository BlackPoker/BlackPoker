import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  getFrame,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { loadRegulationCatalogForBrowser, clearBrowserRegulationCache } from "../../engine/regulation/BrowserRegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import {
  STANDARD_54_DECK_CARDS,
  STANDARD_54_FIXTURE_NOTICE,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import {
  getAvailableEnvironments,
  startMatchAttempt,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { SimulatorNotImplementedError } from "../../domain/regulation/RegulationDefinition";

describe("Standard + Rare Pack Environment Tests [BP-SIM-REG-4.0-E-STANDARD-RAREPACK-ENVIRONMENT]", () => {
  let catalog: any;
  let fullRulePackage: any;

  beforeAll(async () => {
    clearRegulationCache();
    clearBrowserRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  // Section 10: Regulation Gate Regression
  describe("Regulation Gate Regression", () => {
    it("Implemented combinations: light:entry16, light:pack, standard:pack, standard:rarePack are true", () => {
      const implemented = [
        { formatId: "light", frameId: "entry16" },
        { formatId: "light", frameId: "pack" },
        { formatId: "standard", frameId: "pack" },
        { formatId: "standard", frameId: "rarePack" },
      ];

      for (const { formatId, frameId } of implemented) {
        const val = RegulationValidator.validateCombination(catalog, formatId, frameId);
        expect(val.simulatorImplemented).toBe(true);
        expect(() =>
          RegulationValidator.validateCombination(catalog, formatId, frameId, { assertImplemented: true })
        ).not.toThrow();
      }
    });

    it("Non-implemented combinations remain false (pro:rarePack, light:rarePack, master:rarePack)", () => {
      const catalogWithMaster = {
        ...catalog,
        formats: new Map([
          ...catalog.formats.entries(),
          ["master", { id: "master", name: "マスター", actions: [], components: [] }],
        ]),
      };

      const notImplemented = [
        { formatId: "pro", frameId: "rarePack" },
        { formatId: "light", frameId: "rarePack" },
        { formatId: "master", frameId: "rarePack" },
      ];

      for (const { formatId, frameId } of notImplemented) {
        const val = RegulationValidator.validateCombination(catalogWithMaster as any, formatId, frameId);
        expect(val.simulatorImplemented).toBe(false);
        expect(() =>
          RegulationValidator.validateCombination(catalogWithMaster as any, formatId, frameId, { assertImplemented: true })
        ).toThrow(SimulatorNotImplementedError);
      }
    });

    it("pro:rarePack is ruleLegal and recommended, but simulatorImplemented is false", () => {
      const val = RegulationValidator.validateCombination(catalog, "pro", "rarePack");
      expect(val.ruleLegal).toBe(true);
      expect(val.recommended).toBe(true);
      expect(val.simulatorImplemented).toBe(false);
    });
  });

  // Section 11: Exact RulePackage Composition
  describe("Exact RulePackage Composition", () => {
    it("composes exact standard (25) + rarePack frame (4) = 29 actions without duplicates", async () => {
      const standardFormat = catalog.formats.get("standard")!;
      const rarePackFrame = catalog.frames.get("rarePack")!;
      const standardRarePackReg = catalog.regulations.get("standard-rarePack")!;

      expect(standardFormat).toBeDefined();
      expect(rarePackFrame).toBeDefined();
      expect(standardRarePackReg).toBeDefined();

      // Standard format has 25 actions
      expect(standardFormat.actions).toHaveLength(25);

      // Rare Pack frame has 4 frame actions
      expect(rarePackFrame.actions).toHaveLength(4);
      expect(rarePackFrame.actions).toContain("action.packOpen");
      expect(rarePackFrame.actions).toContain("action.rareDraw");
      expect(rarePackFrame.actions).toContain("action.rareSummon");
      expect(rarePackFrame.actions).toContain("action.trapCounter");

      // Frame actions are not contaminated into standard.yaml
      for (const fa of rarePackFrame.actions) {
        expect(standardFormat.actions).not.toContain(fa);
      }

      // Derived RulePackage
      const derivedPackage = RegulationRulePackageSelector.selectRulePackage(
        fullRulePackage,
        standardFormat,
        standardRarePackReg,
        rarePackFrame
      );

      expect(derivedPackage.id).toBe("official-standard-rarePack");
      expect(derivedPackage.actions).toHaveLength(29);

      // Verify no duplicate action IDs
      const actionIds = derivedPackage.actions.map((a) => a.id);
      const uniqueActionIds = new Set(actionIds);
      expect(uniqueActionIds.size).toBe(29);

      // All 4 Rare Pack actions are present
      expect(actionIds).toContain("action.packOpen");
      expect(actionIds).toContain("action.rareDraw");
      expect(actionIds).toContain("action.rareSummon");
      expect(actionIds).toContain("action.trapCounter");

      // No Pro-only or Master-only actions
      const proOnlyActions = ["action.proSpecificAction"];
      for (const poa of proOnlyActions) {
        expect(actionIds).not.toContain(poa);
      }
    });
  });

  // Section 12: Browser Catalog / UI Environment Gate
  describe("Browser Catalog / UI Environment Gate", () => {
    it("loadRegulationCatalogForBrowser loads standard-rarePack and validates simulatorImplemented=true", () => {
      const browserCatalog = loadRegulationCatalogForBrowser();
      expect(browserCatalog).toBeDefined();

      const reg = browserCatalog.regulations.get("standard-rarePack");
      expect(reg).toBeDefined();
      expect(reg?.id).toBe("standard-rarePack");
      expect(reg?.formatId).toBe("standard");
      expect(reg?.frameId).toBe("rarePack");

      const validation = RegulationValidator.validateRegulation(browserCatalog, "standard-rarePack");
      expect(validation.ruleLegal).toBe(true);
      expect(validation.recommended).toBe(true);
      expect(validation.simulatorImplemented).toBe(true);

      const envs = getAvailableEnvironments(browserCatalog);
      const match = envs.find((e) => e.id === "official:standard-rarePack");
      expect(match).toBeDefined();
      expect(match?.name).toBe("スタンダード + レアパック (公式)");
      expect(match?.isOfficial).toBe(true);
      expect(match?.regulationId).toBe("standard-rarePack");
      expect(match?.deckProfileNotice).toBe(STANDARD_54_FIXTURE_NOTICE);
    });
  });

  // Section 13, 14, 15: Playtest Environment E2E & Initial State / Decision Smoke
  describe("Playtest Environment E2E & Initial State Smoke", () => {
    it("startMatchAttempt creates READY match with standard-rarePack, 54-card conservation, and initial legal actions", () => {
      const outcome = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");

      if (outcome.type === "READY") {
        expect(outcome.activeMatch).toBeDefined();
        expect(outcome.activeMatch.environmentId).toBe("official:standard-rarePack");
        expect(outcome.activeMatch.environmentName).toBe("スタンダード + レアパック (公式)");
        expect(outcome.activeMatch.regulationId).toBe("standard-rarePack");
        expect(outcome.activeMatch.seed).toBe(42);
        expect(outcome.activeMatch.rulePackage.id).toBe("official-standard-rarePack");
        expect(outcome.setupNotice).toBeNull();
        expect(outcome.presetValidationErrors).toEqual([]);

        const state = outcome.session.state;
        const p1 = state.players.p1;
        const p2 = state.players.p2;

        // Section 14: Rare Card & Pack setup
        expect(p1.rareCards).toHaveLength(1);
        expect(p2.rareCards).toHaveLength(1);
        expect(p1.rareCards[0].suit).toBe("J");
        expect(p1.rareCards[0].rank).toBe("Joker");
        expect(p1.rareCards[0].id).toBe("p1-c-JJoker");

        expect(p1.pack.cards).toHaveLength(14);
        expect(p2.pack.cards).toHaveLength(14);

        // 54-card conservation check
        expect(() => {
          OfficialRegulationMatchSetup.verifyCardConservation("p1", p1, STANDARD_54_DECK_CARDS);
          OfficialRegulationMatchSetup.verifyCardConservation("p2", p2, STANDARD_54_DECK_CARDS);
        }).not.toThrow();

        // Section 15: Initial Decision Smoke Test
        expect(outcome.initialStep).toBeDefined();
        expect(outcome.initialStep.type).toBe("WAITING_FOR_DECISION");

        if (outcome.initialStep.type === "WAITING_FOR_DECISION") {
          const req = outcome.initialStep.request;
          const legalActionIds = (req.patterns || [])
            .map((p: any) =>
              p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef]?.actionId : undefined
            )
            .filter((id: any): id is string => typeof id === "string");

          // action.packOpen is available for chance holder
          expect(legalActionIds).toContain("action.packOpen");

          // action.rareDraw and action.rareSummon require Life <= 9, so NOT available at game start
          expect(legalActionIds).not.toContain("action.rareDraw");
          expect(legalActionIds).not.toContain("action.rareSummon");

          // action.trapCounter requires a pending request on Stage, so NOT available at game start
          expect(legalActionIds).not.toContain("action.trapCounter");
        }
      }
    });

    it("OfficialRegulationMatchFactory.createSession creates fresh session successfully", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("standard-rarePack", 42, {
        catalog,
        fullRulePackage,
      });

      expect(session).toBeDefined();
      expect(session.state.regulationId).toBe("standard-rarePack");
      expect(session.rulePackage.id).toBe("official-standard-rarePack");
      expect(session.state.players.p1.rareCards).toHaveLength(1);
      expect(session.state.players.p1.pack.cards).toHaveLength(14);
    });
  });
});
