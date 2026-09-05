import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRegulationCatalogForBrowser,
  clearBrowserRegulationCache,
} from "../../engine/regulation/BrowserRegulationLoader";

describe("Browser Regulation Loader Tests (Phase 2.4)", () => {
  beforeEach(() => {
    clearBrowserRegulationCache();
  });

  it("ブラウザ環境互換の loadRegulationCatalogForBrowser が正しく全カタログをロードすること", () => {
    const catalog = loadRegulationCatalogForBrowser();

    expect(catalog).toBeDefined();
    expect(catalog.formats.size).toBeGreaterThan(0);
    expect(catalog.frames.size).toBeGreaterThan(0);
    expect(catalog.regulations.size).toBeGreaterThan(0);
  });

  it("フォーマット light が正しくロードされ定義を持つこと", () => {
    const catalog = loadRegulationCatalogForBrowser();
    const light = catalog.formats.get("light");

    expect(light).toBeDefined();
    expect(light?.id).toBe("light");
    expect(light?.name).toBe("ライト");
    expect(light?.actions).toContain("action.attack");
    expect(light?.actions).toContain("action.block");
    expect(light?.actions).toContain("action.down");
    expect(light?.actions).toContain("action.twist");
    expect(light?.actions).toContain("action.up");
    expect(light?.components).toContain("character.bulwark");
    expect(light?.components).toContain("character.soldier");
  });

  it("フレーム entry16 が正しくロードされ、16枚の固定デッキ定義を持つこと", () => {
    const catalog = loadRegulationCatalogForBrowser();
    const entry16 = catalog.frames.get("entry16");

    expect(entry16).toBeDefined();
    expect(entry16?.id).toBe("entry16");
    expect(entry16?.deck.cardCount).toBe(16);
    expect(entry16?.deck.cards).toHaveLength(16);
    expect(entry16?.setup.initialHandCount).toBe(7);
    expect(entry16?.setup.preset.bulwarkCount).toBe(1);
    expect(entry16?.setup.preset.soldierCount).toBe(1);
  });

  it("レギュレーション light-entry16 が正しくロードされること", () => {
    const catalog = loadRegulationCatalogForBrowser();
    const reg = catalog.regulations.get("light-entry16");

    expect(reg).toBeDefined();
    expect(reg?.id).toBe("light-entry16");
    expect(reg?.formatId).toBe("light");
    expect(reg?.frameId).toBe("entry16");
  });

  it("カタログがインメモリキャッシュされ、同一オブジェクト参照を返すこと", () => {
    const catalog1 = loadRegulationCatalogForBrowser();
    const catalog2 = loadRegulationCatalogForBrowser();

    expect(catalog1).toBe(catalog2);

    clearBrowserRegulationCache();
    const catalog3 = loadRegulationCatalogForBrowser();
    expect(catalog3).not.toBe(catalog1);
    expect(catalog3.regulations.size).toBe(catalog1.regulations.size);
  });
});
