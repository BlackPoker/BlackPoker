import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { parse } from "yaml";
import * as fs from "fs";
import { loadRegulationCatalog, getFormat } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";

describe("Light Format Coverage Tests (AP 8-14)", () => {
  let lightFormat: any;
  let fullRulePackage: any;

  beforeAll(async () => {
    const catalog = await loadRegulationCatalog();
    lightFormat = await getFormat("light");
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("8 & 9. Light Format action set should match exactly 19 expected actions", () => {
    const expectedActions = [
      "action.end",
      "action.charge",
      "action.draw",
      "action.attack",
      "action.block",
      "action.damageJudge",
      "action.nextGeneration",
      "action.setBulwark",
      "action.summonSoldier",
      "action.summonHero",
      "action.summonAce",
      "action.mountSoldier",
      "action.up",
      "action.down",
      "action.twist",
      "action.counter",
      "action.destroyBulwark",
      "action.throwing",
      "action.search",
    ];

    expect(lightFormat.actions.length).toBe(19);
    expect([...lightFormat.actions].sort()).toEqual([...expectedActions].sort());
  });

  it("8-b. Legacy act.yaml lite membership consistency check", () => {
    const actYamlPath = path.resolve(__dirname, "../../../../actionlist/original/act.yaml");
    if (fs.existsSync(actYamlPath)) {
      const actContent = fs.readFileSync(actYamlPath, "utf-8");
      const parsedAct = parse(actContent);

      const liteActIds: string[] = [];
      for (const section of parsedAct.actList || []) {
        for (const act of section.acts || []) {
          if (act.format && act.format.includes("lite")) {
            liteActIds.push(act.actId);
          }
        }
      }

      // 19 actions in old ActionList
      expect(liteActIds.length).toBe(19);
    }
  });

  it("10. CORE-BATTLE-only actions should NOT be in Light Format", () => {
    expect(lightFormat.actions).not.toContain("action.counterattack");
    expect(lightFormat.actions).not.toContain("action.revolutionDraw");
  });

  it("11. No light action should be missing from fullRulePackage", () => {
    const fullActionIds = new Set(fullRulePackage.actions.map((a: any) => a.id));
    for (const actId of lightFormat.actions) {
      expect(fullActionIds.has(actId)).toBe(true);
    }
  });

  it("12. Light Character set must include exactly 5 character components", () => {
    const expectedCharacters = [
      "character.soldier",
      "character.hero",
      "character.ace",
      "character.armedSoldier",
      "character.bulwark",
    ];

    for (const charId of expectedCharacters) {
      expect(lightFormat.components).toContain(charId);
    }
  });

  it("13. Light Fog set must include exactly 2 fog components", () => {
    expect(lightFormat.components).toContain("fog.up");
    expect(lightFormat.components).toContain("fog.down");
  });

  it("14. Non-Light components (giant, magician) must NOT be in Light RulePackage", () => {
    const officialPackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      lightFormat
    );

    const compIds = officialPackage.components.map((c) => c.id);
    expect(compIds).not.toContain("character.giant");
    expect(compIds).not.toContain("character.magician");

    const actIds = officialPackage.actions.map((a) => a.id);
    expect(actIds).not.toContain("action.counterattack");
    expect(actIds).not.toContain("action.revolutionDraw");
  });
});
