import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  getFrame,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import {
  loadRegulationCatalogForBrowser,
  clearBrowserRegulationCache,
} from "../../engine/regulation/BrowserRegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { getAvailableEnvironments } from "../../engine/playtest/PlaytestEnvironmentController";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { SimulatorNotImplementedError } from "../../domain/regulation/RegulationDefinition";

describe("Pro Format Foundation & pro-rarePack Regulation Tests [BP-SIM-REG-5.0-A-PRO-FORMAT-FOUNDATION]", () => {
  let catalog: any;
  let fullRulePackage: any;

  const EXPECTED_PRO_ACTIONS: readonly string[] = [
    // 基本 (Basic 7)
    "action.end",
    "action.charge",
    "action.draw",
    "action.attack",
    "action.block",
    "action.damageJudge",
    "action.nextGeneration",
    // 召喚 (Summon 7)
    "action.setBulwark",
    "action.summonSoldier",
    "action.summonHero",
    "action.summonAce",
    "action.quickSummonsAce",
    "action.summonMagician",
    "action.mountSoldier",
    // 基礎魔法 (Basic Magic 4)
    "action.up",
    "action.down",
    "action.twist",
    "action.counter",
    // 中級魔法 (Intermediate Magic 13)
    "action.destroyBulwark",
    "action.throwing",
    "action.deathLance",
    "action.addBulwark",
    "action.reanimate",
    "action.handeth",
    "action.kill",
    "action.reunion",
    "action.truce",
    "action.changeTarget",
    "action.search",
    "action.reverse",
    "action.unsummons",
  ];

  const PRO_SPECIFIC_ADDITIONS: readonly string[] = [
    "action.quickSummonsAce",
    "action.kill",
    "action.reunion",
    "action.truce",
    "action.changeTarget",
    "action.reverse",
  ];

  beforeAll(async () => {
    clearRegulationCache();
    clearBrowserRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  // Section 14: Foundation Test & Section 15: Exact Action Order Contract
  describe("Pro Format Definition Contract", () => {
    it("A, B: getFormat('pro') loads pro format with correct id, name, and description", async () => {
      const pro = await getFormat("pro");
      expect(pro).toBeDefined();
      expect(pro.id).toBe("pro");
      expect(pro.name).toBe("プロ");
      expect(pro.description).toContain("公式BlackPoker プロフォーマット");
    });

    it("C, F, Section 15: pro.yaml actions has exactly 31 actions in exact official order without duplicates", async () => {
      const pro = await getFormat("pro");
      expect(pro.actions).toHaveLength(31);
      expect(pro.actions).toEqual(EXPECTED_PRO_ACTIONS);

      const uniqueActionIds = new Set(pro.actions);
      expect(uniqueActionIds.size).toBe(31);
    });

    it("D, E: contains all Standard 25 actions and exactly 6 Pro additions", async () => {
      const standard = await getFormat("standard");
      const pro = await getFormat("pro");

      expect(standard.actions).toHaveLength(25);

      // Standard 25 actions are all included in Pro
      for (const stdAction of standard.actions) {
        expect(pro.actions).toContain(stdAction);
      }

      // Difference between Pro and Standard is exactly the 6 Pro additions
      const diff = pro.actions.filter((a) => !standard.actions.includes(a));
      expect(diff).toHaveLength(6);
      expect(diff.sort()).toEqual([...PRO_SPECIFIC_ADDITIONS].sort());
    });

    it("H: components has exactly 8 items, identical to Standard components", async () => {
      const standard = await getFormat("standard");
      const pro = await getFormat("pro");

      expect(pro.components).toHaveLength(8);
      expect(pro.components).toEqual(standard.components);
    });
  });

  // Section 16: pro-rarePack Regulation Test
  describe("pro-rarePack Regulation Contract", () => {
    it("loads pro-rarePack regulation with correct properties", async () => {
      const reg = await getRegulation("pro-rarePack");
      expect(reg).toBeDefined();
      expect(reg.id).toBe("pro-rarePack");
      expect(reg.name).toBe("プロ + レアパック");
      expect(reg.formatId).toBe("pro");
      expect(reg.frameId).toBe("rarePack");
      expect(reg.sourceRulesVersion).toBe("9.1.2");
    });

    it("Section 10 & 16: RegulationValidator validates pro-rarePack as legal, recommended, but NOT simulatorImplemented", () => {
      const validation = RegulationValidator.validateRegulation(catalog, "pro-rarePack");
      expect(validation.ruleLegal).toBe(true);
      expect(validation.recommended).toBe(true);
      expect(validation.simulatorImplemented).toBe(false);

      expect(() =>
        RegulationValidator.validateRegulation(catalog, "pro-rarePack", { assertImplemented: true })
      ).toThrow(SimulatorNotImplementedError);
    });
  });

  // Section 17: Available Environment Contract
  describe("Available Environment Contract", () => {
    it("getAvailableEnvironments does NOT list official:pro-rarePack or official:standard-rarePack", () => {
      const envs = getAvailableEnvironments(catalog);
      const proRarePack = envs.find(
        (e) => e.regulationId === "pro-rarePack" || e.id === "official:pro-rarePack"
      );
      expect(proRarePack).toBeUndefined();

      const standardRarePack = envs.find(
        (e) => e.regulationId === "standard-rarePack" || e.id === "official:standard-rarePack"
      );
      expect(standardRarePack).toBeUndefined();
    });
  });

  // Section 18: Official Factory Fail-Closed
  describe("Official Factory Fail-Closed", () => {
    it("OfficialRegulationMatchFactory.createSession('pro-rarePack') throws SimulatorNotImplementedError", async () => {
      await expect(
        OfficialRegulationMatchFactory.createSession("pro-rarePack", 42, {
          catalog,
          fullRulePackage,
        })
      ).rejects.toThrow(SimulatorNotImplementedError);
    });
  });

  // Section 19: Browser Catalog Contract
  describe("Browser Catalog Contract", () => {
    it("BrowserRegulationLoader loads pro format and pro-rarePack regulation with simulatorImplemented=false", () => {
      const browserCatalog = loadRegulationCatalogForBrowser();
      expect(browserCatalog).toBeDefined();

      const proFormat = browserCatalog.formats.get("pro");
      expect(proFormat).toBeDefined();
      expect(proFormat?.id).toBe("pro");
      expect(proFormat?.actions).toHaveLength(31);

      const proRarePackReg = browserCatalog.regulations.get("pro-rarePack");
      expect(proRarePackReg).toBeDefined();
      expect(proRarePackReg?.id).toBe("pro-rarePack");

      const validation = RegulationValidator.validateRegulation(browserCatalog, "pro-rarePack");
      expect(validation.ruleLegal).toBe(true);
      expect(validation.recommended).toBe(true);
      expect(validation.simulatorImplemented).toBe(false);

      const envs = getAvailableEnvironments(browserCatalog);
      const proEnv = envs.find(
        (e) => e.regulationId === "pro-rarePack" || e.id === "official:pro-rarePack"
      );
      expect(proEnv).toBeUndefined();
    });
  });
});
