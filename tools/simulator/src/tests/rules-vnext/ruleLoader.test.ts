import { describe, it, expect } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRulePackageForBrowser, getPlaytestRulePackage } from "../../engine/rules/BrowserRuleLoader";

describe("RuleLoader Node & Browser Consistency Tests (Phase 21B)", () => {
  it("should match action IDs and component IDs between Node loader and Browser loader", async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const nodePackage = await loadRulePackageFromDirectory(rulesDir);
    const browserPackage = loadRulePackageForBrowser();

    expect(browserPackage.id).toBe(nodePackage.id);
    expect(browserPackage.version).toBe(nodePackage.version);

    // action ID 集合の一致
    const nodeActionIds = nodePackage.actions.map((a) => a.id).sort();
    const browserActionIds = browserPackage.actions.map((a) => a.id).sort();
    expect(browserActionIds).toEqual(nodeActionIds);

    // component ID 集合の一致
    const nodeCompIds = nodePackage.components.map((c) => c.id).sort();
    const browserCompIds = browserPackage.components.map((c) => c.id).sort();
    expect(browserCompIds).toEqual(nodeCompIds);

    // 重要コンポーネントの存在確認
    expect(browserCompIds).toContain("character.soldier");
    expect(browserCompIds).toContain("character.bulwark");
    expect(browserCompIds).toContain("trump.fortress");
    expect(browserCompIds).toContain("trump.revolution");
    expect(browserCompIds).toContain("character.giant");
    expect(browserCompIds).toContain("fog.up");
    expect(browserCompIds).toContain("fog.down");

    // 実総数の確認 (全17アクション、全7コンポーネント)
    expect(browserActionIds.length).toBe(17);
    expect(browserCompIds.length).toBe(7);
  });

  it("should extract valid Playtest RulePackage with supported action list", () => {
    const browserPackage = loadRulePackageForBrowser();
    const playtestPackage = getPlaytestRulePackage(browserPackage);

    expect(playtestPackage.actions.length).toBeGreaterThan(0);
    const actionIds = playtestPackage.actions.map((a) => a.id);

    // 必須アクションが含まれていること
    expect(actionIds).toContain("action.attack");
    expect(actionIds).toContain("action.block");
    expect(actionIds).toContain("action.damageJudge");
    expect(actionIds).toContain("action.end");
    expect(actionIds).toContain("action.charge");
    expect(actionIds).toContain("action.draw");
    expect(actionIds).toContain("action.twist");

    // 全コンポーネント定義が維持されていること
    expect(playtestPackage.components.length).toBe(browserPackage.components.length);
    expect(playtestPackage.components.length).toBe(7);
  });
});
