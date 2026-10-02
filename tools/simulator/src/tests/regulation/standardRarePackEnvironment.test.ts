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

describe("Standard + Rare Pack Semantic Gate Tests [BP-SIM-REG-4.0-F-RARE-KEY-SOURCE-SEMANTIC-GATE]", () => {
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
    it("Implemented combinations: light:entry16, light:pack, standard:pack are true", () => {
      const implemented = [
        { formatId: "light", frameId: "entry16" },
        { formatId: "light", frameId: "pack" },
        { formatId: "standard", frameId: "pack" },
      ];

      for (const { formatId, frameId } of implemented) {
        const val = RegulationValidator.validateCombination(catalog, formatId, frameId);
        expect(val.simulatorImplemented).toBe(true);
        expect(() =>
          RegulationValidator.validateCombination(catalog, formatId, frameId, { assertImplemented: true })
        ).not.toThrow();
      }
    });

    it("Non-implemented combinations remain false (standard:rarePack, pro:rarePack, light:rarePack, master:rarePack)", () => {
      const catalogWithMaster = {
        ...catalog,
        formats: new Map([
          ...catalog.formats.entries(),
          ["master", { id: "master", name: "マスター", actions: [], components: [] }],
        ]),
      };

      const notImplemented = [
        { formatId: "standard", frameId: "rarePack" },
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

    it("standard:rarePack is ruleLegal and recommended, but simulatorImplemented is false (semantic-gated)", () => {
      const val = RegulationValidator.validateCombination(catalog, "standard", "rarePack");
      expect(val.ruleLegal).toBe(true);
      expect(val.recommended).toBe(true);
      expect(val.simulatorImplemented).toBe(false);
      expect(() =>
        RegulationValidator.validateCombination(catalog, "standard", "rarePack", { assertImplemented: true })
      ).toThrow(SimulatorNotImplementedError);
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
    it("loadRegulationCatalogForBrowser loads standard-rarePack (present) but validates simulatorImplemented=false and ABSENT from getAvailableEnvironments", () => {
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
      expect(validation.simulatorImplemented).toBe(false);

      const envs = getAvailableEnvironments(browserCatalog);
      const match = envs.find((e) => e.id === "official:standard-rarePack");
      expect(match).toBeUndefined();
    });
  });

  // Section 13: Semantic Gated Environment Contract & Factory Fail-Closed
  describe("Semantic Gated Environment Contract & Factory Fail-Closed", () => {
    it("startMatchAttempt with official:standard-rarePack must NOT produce READY", () => {
      const outcome = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).not.toBe("READY");
      expect(outcome.activeMatch).toBeNull();
      expect(outcome.type).toBe("TECHNICAL_ERROR");
      expect((outcome as any).setupNotice?.errorName).toBe("SimulatorNotImplementedError");
    });

    it("OfficialRegulationMatchFactory.createSession('standard-rarePack') throws SimulatorNotImplementedError", async () => {
      await expect(
        OfficialRegulationMatchFactory.createSession("standard-rarePack", 42, {
          catalog,
          fullRulePackage,
        })
      ).rejects.toThrow(SimulatorNotImplementedError);
    });
  });
});
