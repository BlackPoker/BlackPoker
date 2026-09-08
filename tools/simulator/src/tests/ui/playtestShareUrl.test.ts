import { describe, it, expect } from "vitest";
import {
  parsePlaytestShareUrl,
  serializePlaytestShareUrl,
  buildPlaytestShareUrl,
  PlaytestShareConfigV1,
  SHARE_PARAM_KEYS,
} from "../../ui/playtest/PlaytestShareUrl";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { validateSeed } from "../../engine/playtest/PlaytestEnvironmentController";

describe("PlaytestShareUrl Unit Tests (UI Phase 2.7)", () => {
  const catalog = loadRegulationCatalogForBrowser();

  // A. Official Human vs AI round-trip
  it("A: Official Human vs AI round-trip で serialize -> parse して同じ設定に戻ること", () => {
    const originalConfig: PlaytestShareConfigV1 = {
      version: 1,
      environmentId: "official:light-entry16",
      mode: "humanVsAi",
      humanSeat: "p1",
      policyId: "manualGenericGenome",
      seedInput: "42",
    };

    const query = serializePlaytestShareUrl(originalConfig, catalog);
    expect(query).toBe("?bpv=1&env=official%3Alight-entry16&mode=humanVsAi&human=p1&policy=manualGenericGenome&seed=42");

    const result = parsePlaytestShareUrl(query, catalog);
    expect(result.kind).toBe("READY");
    if (result.kind === "READY") {
      expect(result.config).toEqual(originalConfig);
      expect(result.warnings.length).toBe(0);
    }
  });

  // B. Human vs Human canonicalization
  it("B: Human vs Human canonicalization で human / policy が URL に含まれないこと", () => {
    const config: PlaytestShareConfigV1 = {
      version: 1,
      environmentId: "official:light-entry16",
      mode: "humanVsHuman",
      humanSeat: "p1", // should be omitted
      policyId: "manualGenericGenome", // should be omitted
      seedInput: "42",
    };

    const query = serializePlaytestShareUrl(config, catalog);
    expect(query).not.toContain("human=");
    expect(query).not.toContain("policy=");
    expect(query).toBe("?bpv=1&env=official%3Alight-entry16&mode=humanVsHuman&seed=42");

    const result = parsePlaytestShareUrl(query, catalog);
    expect(result.kind).toBe("READY");
    if (result.kind === "READY") {
      expect(result.config.mode).toBe("humanVsHuman");
      expect(result.config.environmentId).toBe("official:light-entry16");
      expect(result.config.seedInput).toBe("42");
    }
  });

  // C. Core Battle canonicalization
  it("C: Core Battle canonicalization で seed が Canonical URL に含まれないこと", () => {
    const config: PlaytestShareConfigV1 = {
      version: 1,
      environmentId: "core-battle",
      mode: "humanVsAi",
      humanSeat: "p2",
      policyId: "firstLegal",
      seedInput: "999", // should be omitted for core-battle
    };

    const query = serializePlaytestShareUrl(config, catalog);
    expect(query).not.toContain("seed=");
    expect(query).toBe("?bpv=1&env=core-battle&mode=humanVsAi&human=p2&policy=firstLegal");

    const result = parsePlaytestShareUrl(query, catalog);
    expect(result.kind).toBe("READY");
    if (result.kind === "READY") {
      expect(result.config.environmentId).toBe("core-battle");
      expect(result.config.mode).toBe("humanVsAi");
      expect(result.config.humanSeat).toBe("p2");
      expect(result.config.policyId).toBe("firstLegal");
    }
  });

  // D. URL encoding
  it("D: official:light-entry16 が安全に encode/decode されること", () => {
    const config: PlaytestShareConfigV1 = {
      version: 1,
      environmentId: "official:light-entry16",
      mode: "humanVsHuman",
      humanSeat: "p1",
      policyId: "firstLegal",
      seedInput: "123",
    };

    const query = serializePlaytestShareUrl(config, catalog);
    expect(query).toContain("env=official%3Alight-entry16");

    const result = parsePlaytestShareUrl(query, catalog);
    expect(result.kind).toBe("READY");
    if (result.kind === "READY") {
      expect(result.config.environmentId).toBe("official:light-entry16");
    }
  });

  // E. Invalid Environment
  it("E: catalog に存在しない env を拒否し、クラッシュせずデフォルトへフォールバックすること", () => {
    const url = "?bpv=1&env=hoge&mode=humanVsAi&human=p1&policy=firstLegal&seed=42";
    const result = parsePlaytestShareUrl(url, catalog);
    expect(result.kind).toBe("READY");
    if (result.kind === "READY") {
      expect(result.config.environmentId).toBe("core-battle");
      expect(result.warnings.some((w) => w.includes("hoge"))).toBe(true);
    }
  });

  // F. Invalid Mode
  it("F: mode=hoge などの不正値を拒否し、デフォルト (humanVsHuman) へフォールバックすること", () => {
    const url = "?bpv=1&env=core-battle&mode=hoge";
    const result = parsePlaytestShareUrl(url, catalog);
    expect(result.kind).toBe("READY");
    if (result.kind === "READY") {
      expect(result.config.mode).toBe("humanVsHuman");
      expect(result.warnings.some((w) => w.includes("hoge"))).toBe(true);
    }
  });

  // G. Invalid Seat
  it("G: human=p3 などの不正値を拒否し、デフォルト (p1) へフォールバックすること", () => {
    const url = "?bpv=1&env=core-battle&mode=humanVsAi&human=p3&policy=firstLegal";
    const result = parsePlaytestShareUrl(url, catalog);
    expect(result.kind).toBe("READY");
    if (result.kind === "READY") {
      expect(result.config.humanSeat).toBe("p1");
      expect(result.warnings.some((w) => w.includes("p3"))).toBe(true);
    }
  });

  // H. Invalid Policy
  it("H: policy=unknown などの不正値を拒否し、デフォルト (firstLegal) へフォールバックすること", () => {
    const url = "?bpv=1&env=core-battle&mode=humanVsAi&human=p1&policy=unknown";
    const result = parsePlaytestShareUrl(url, catalog);
    expect(result.kind).toBe("READY");
    if (result.kind === "READY") {
      expect(result.config.policyId).toBe("firstLegal");
      expect(result.warnings.some((w) => w.includes("unknown"))).toBe(true);
    }
  });

  // I. Invalid Seed
  it("I: 既存 validateSeed() と同じ結果になり、-1, 1.5, abc, Infinity を受け付けずデフォルト (42) にフォールバックすること", () => {
    const invalidSeeds = ["-1", "1.5", "abc", "Infinity", "NaN", "   "];
    for (const seed of invalidSeeds) {
      expect(validateSeed(seed).valid).toBe(false);
      const url = `?bpv=1&env=official:light-entry16&mode=humanVsAi&human=p1&policy=firstLegal&seed=${encodeURIComponent(seed)}`;
      const result = parsePlaytestShareUrl(url, catalog);
      expect(result.kind).toBe("READY");
      if (result.kind === "READY") {
        expect(result.config.seedInput).toBe("42");
        expect(result.warnings.some((w) => w.includes("無効なSeed"))).toBe(true);
      }
    }
  });

  // J. Unknown version
  it("J: bpv=2 などの未知バージョンは v1 として読まず、UNSUPPORTED_VERSION を返すこと", () => {
    const url = "?bpv=2&env=official:light-entry16&mode=humanVsAi&human=p1&policy=firstLegal&seed=42";
    const result = parsePlaytestShareUrl(url, catalog);
    expect(result.kind).toBe("UNSUPPORTED_VERSION");
    if (result.kind === "UNSUPPORTED_VERSION") {
      expect(result.warnings.some((w) => w.includes("bpv=2"))).toBe(true);
    }
  });

  // K. Policy / Environment normalization
  it("K: Seed requirementのあるPolicy (seededRandom) + 非Official Environment (core-battle) で安全に firstLegal へ normalize されること", () => {
    const url = "?bpv=1&env=core-battle&mode=humanVsAi&human=p1&policy=seededRandom";
    const result = parsePlaytestShareUrl(url, catalog);
    expect(result.kind).toBe("READY");
    if (result.kind === "READY") {
      expect(result.config.policyId).toBe("firstLegal");
      expect(result.warnings.some((w) => w.includes("FirstLegal に変更しました"))).toBe(true);
    }
  });

  // L. Canonical ordering
  it("L: URLパラメータの順序が bpv -> env -> mode -> human -> policy -> seed の順になること", () => {
    const config: PlaytestShareConfigV1 = {
      version: 1,
      environmentId: "official:light-entry16",
      mode: "humanVsAi",
      humanSeat: "p2",
      policyId: "manualGenericGenome",
      seedInput: "777",
    };

    const query = serializePlaytestShareUrl(config, catalog);
    const keysInQuery = Array.from(new URLSearchParams(query.slice(1)).keys());
    expect(keysInQuery).toEqual(["bpv", "env", "mode", "human", "policy", "seed"]);
  });

  // 追加 C: 既存URLの非ShareパラメータおよびHash保持
  it("追加 C: 既存URL ?foo=bar&policy=old#section からShare URL生成時、foo=bar と #section は維持し、Share parameters のみ Canonical 化されること", () => {
    const currentUrl = "https://blackpoker.github.io/simulator/?foo=bar&policy=old#section";
    const config: PlaytestShareConfigV1 = {
      version: 1,
      environmentId: "official:light-entry16",
      mode: "humanVsAi",
      humanSeat: "p1",
      policyId: "firstLegal",
      seedInput: "42",
    };

    const resultUrl = buildPlaytestShareUrl(currentUrl, config, catalog);
    expect(resultUrl).toContain("https://blackpoker.github.io/simulator/");
    expect(resultUrl).toContain("foo=bar");
    expect(resultUrl).toContain("#section");

    // old policy が削除され、新しい share parameter に置換されていること
    expect(resultUrl).not.toContain("policy=old");
    expect(resultUrl).toContain("policy=firstLegal");

    // パラメータ順の確認
    const parsed = new URL(resultUrl);
    const keys = Array.from(parsed.searchParams.keys());
    expect(keys.indexOf("bpv")).toBe(0);
    expect(keys.indexOf("env")).toBe(1);
    expect(keys.indexOf("mode")).toBe(2);
    expect(keys.indexOf("human")).toBe(3);
    expect(keys.indexOf("policy")).toBe(4);
    expect(keys.indexOf("seed")).toBe(5);
    expect(keys.indexOf("foo")).toBe(6);
    expect(parsed.hash).toBe("#section");
  });

  // 追加 D: Pure Function として Node.js（window/document/navigator なし）で完結動作すること
  it("追加 D: window / document / navigator が未定義の環境でも parse / serialize / build が問題なく動作すること", () => {
    // window / document が未定義の Node.js 環境であることを確認
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");

    const config: PlaytestShareConfigV1 = {
      version: 1,
      environmentId: "core-battle",
      mode: "humanVsHuman",
      humanSeat: "p1",
      policyId: "firstLegal",
      seedInput: "42",
    };

    const serialized = serializePlaytestShareUrl(config, catalog);
    expect(serialized).toBe("?bpv=1&env=core-battle&mode=humanVsHuman");

    const parsed = parsePlaytestShareUrl(serialized, catalog);
    expect(parsed.kind).toBe("READY");

    const built = buildPlaytestShareUrl("http://localhost:5173/game/?debug=true", config, catalog);
    expect(built).toContain("bpv=1");
    expect(built).toContain("debug=true");
  });
});
