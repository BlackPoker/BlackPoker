import { describe, it, expect } from "vitest";
import {
  isRankInRange,
  validateUnitAgainstComponentDefinition,
} from "../../engine/session/playtest/validatePlaytestPreset";
import { compileScenarioDefinitionV1 } from "../../engine/scenario/ScenarioCompiler";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";

describe("Joker & Rank Matcher Tests (BP-SIM-SHARE-1.0-R2-PLAYTEST-UX-HARDENING)", () => {
  describe("isRankInRange Horizontal Tests", () => {
    it("exact match: A vs A -> true", () => {
      expect(isRankInRange("A", "A")).toBe(true);
    });
    it("exact match: K vs K -> true", () => {
      expect(isRankInRange("K", "K")).toBe(true);
    });
    it("exact match: Joker vs Joker -> true", () => {
      expect(isRankInRange("Joker", "Joker")).toBe(true);
    });
    it("exact match: joker vs Joker -> true (case-insensitive)", () => {
      expect(isRankInRange("joker", "Joker")).toBe(true);
    });
    it("exact match: 10 vs 10 -> true", () => {
      expect(isRankInRange("10", "10")).toBe(true);
    });
    it("mismatch: Joker vs A -> false", () => {
      expect(isRankInRange("Joker", "A")).toBe(false);
    });
    it("mismatch: A vs Joker -> false", () => {
      expect(isRankInRange("A", "Joker")).toBe(false);
    });
    it("range: A vs A..K -> true", () => {
      expect(isRankInRange("A", "A..K")).toBe(true);
    });
    it("range: 7 vs 2..10 -> true", () => {
      expect(isRankInRange("7", "2..10")).toBe(true);
    });
    it("range: K vs 2..10 -> false", () => {
      expect(isRankInRange("K", "2..10")).toBe(false);
    });
    it("range: Joker vs A..K -> false", () => {
      expect(isRankInRange("Joker", "A..K")).toBe(false);
    });
    it("invalid range: fail-closed", () => {
      expect(isRankInRange("5", "invalid..range")).toBe(false);
      expect(isRankInRange("5", "2..invalid")).toBe(false);
    });
  });

  describe("ScenarioCompiler Magician + Joker Integration Regression", () => {
    const catalog = loadRegulationCatalogForBrowser();
    const fullRulePackage = loadRulePackageForBrowser();

    it("Player 1 field に Joker 1 (occurrence: 0) を持つ character.magician を配置したシナリオが READY になること", () => {
      const scenario: ScenarioDefinitionV1 = {
        version: 1,
        environmentId: "official:standard-pack",
        seed: 12345,
        turnPlayer: "p1",
        chancePlayer: "p2",
        turnCount: 1,
        players: {
          p1: {
            hand: [
              { suit: "S", rank: "A" },
              { suit: "H", rank: "10" },
            ],
            field: [
              {
                componentId: "character.magician",
                cards: [{ suit: "J", rank: "Joker", occurrence: 0 }],
                state: "charge",
                face: "up",
              },
            ],
            grave: [
              { suit: "C", rank: "2" },
            ],
            life: { count: 5 },
            pack: { count: 45 }, // 2 + 1 + 1 + 5 + 45 = 54
          },
          p2: {
            hand: [{ suit: "D", rank: "A" }],
            field: [],
            grave: [],
            life: { count: 5 },
            pack: { count: 48 }, // 1 + 0 + 0 + 5 + 48 = 54
          },
        },
      };

      const outcome = compileScenarioDefinitionV1(scenario, catalog, fullRulePackage);
      expect(outcome.type).toBe("READY");
    });

    it("Player 1 field に Joker 2 (occurrence: 1) を持つ character.magician を配置したシナリオが READY になること", () => {
      const scenario: ScenarioDefinitionV1 = {
        version: 1,
        environmentId: "official:standard-pack",
        seed: 12345,
        turnPlayer: "p1",
        chancePlayer: "p2",
        turnCount: 1,
        players: {
          p1: {
            hand: [
              { suit: "S", rank: "A" },
              { suit: "H", rank: "10" },
            ],
            field: [
              {
                componentId: "character.magician",
                cards: [{ suit: "J", rank: "Joker", occurrence: 1 }],
                state: "charge",
                face: "up",
              },
            ],
            grave: [
              { suit: "C", rank: "2" },
            ],
            life: { count: 5 },
            pack: { count: 45 },
          },
          p2: {
            hand: [{ suit: "D", rank: "A" }],
            field: [],
            grave: [],
            life: { count: 5 },
            pack: { count: 48 },
          },
        },
      };

      const outcome = compileScenarioDefinitionV1(scenario, catalog, fullRulePackage);
      expect(outcome.type).toBe("READY");
    });
  });
});
