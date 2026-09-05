import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRegulationCatalog, RegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";

describe("Shared Official Regulation Match Setup Tests (Phase 2.4)", () => {
  let catalog: RegulationCatalog;
  let fullRulePackage: RulePackage;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("OfficialRegulationMatchSetup.setupMatch が決定論的に READY 状態を生成すること", () => {
    const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", {
      assertImplemented: true,
    });
    const officialRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      validation.format!,
      validation.regulation!
    );

    const outcome = OfficialRegulationMatchSetup.setupMatch(
      validation.regulation!,
      validation.frame!,
      officialRulePackage,
      42
    );

    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    expect(outcome.firstPlayer).toBe("p1");
    expect(outcome.state.turnPlayer).toBe("p1");
    expect(outcome.state.chancePlayer).toBe("p1");
    expect(outcome.state.turnCount).toBe(1);

    // P1: 手札 8 (初期7 + 先攻引1), 防壁 1, 兵士 1, Life 5, 墓地 1 (先攻決定カード) -> 合計16
    expect(outcome.state.players.p1.hand).toHaveLength(8);
    expect(outcome.state.players.p1.field).toHaveLength(2);
    expect(outcome.state.players.p1.life).toHaveLength(5);
    expect(outcome.state.players.p1.grave).toHaveLength(1);

    // P2: 手札 7, 防壁 1, 兵士 1, Life 6, 墓地 1 -> 合計16
    expect(outcome.state.players.p2.hand).toHaveLength(7);
    expect(outcome.state.players.p2.field).toHaveLength(2);
    expect(outcome.state.players.p2.life).toHaveLength(6);
    expect(outcome.state.players.p2.grave).toHaveLength(1);
  });

  it("プリセットユニットに enteredFieldBeforeGame: true が付与されていること", () => {
    const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", {
      assertImplemented: true,
    });
    const officialRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      validation.format!,
      validation.regulation!
    );

    const outcome = OfficialRegulationMatchSetup.setupMatch(
      validation.regulation!,
      validation.frame!,
      officialRulePackage,
      42
    );

    if (outcome.type !== "READY") throw new Error("Expected READY");

    for (const playerKey of ["p1", "p2"] as const) {
      const field = outcome.state.players[playerKey].field;
      expect(field).toHaveLength(2);
      expect(field[0].enteredFieldBeforeGame).toBe(true);
      expect(field[1].enteredFieldBeforeGame).toBe(true);
    }
  });

  it("OfficialRegulationMatchFactory と OfficialRegulationMatchSetup の setupMatch 結果が完全一致すること", () => {
    const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", {
      assertImplemented: true,
    });
    const officialRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      validation.format!,
      validation.regulation!
    );

    const outcome1 = OfficialRegulationMatchSetup.setupMatch(
      validation.regulation!,
      validation.frame!,
      officialRulePackage,
      20260906
    );

    const outcome2 = OfficialRegulationMatchFactory.setupMatch(
      validation.regulation!,
      validation.frame!,
      officialRulePackage,
      20260906
    );

    expect(outcome1).toEqual(outcome2);
  });

  it("verifyCardConservation が枚数不足または重複を正しく検出して例外を投げること", () => {
    const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", {
      assertImplemented: true,
    });

    const brokenPlayer = {
      life: [{ id: "p1-c-S1", suit: "S", rank: "A", value: 1 }],
      hand: [],
      field: [],
      grave: [],
    };

    expect(() => {
      OfficialRegulationMatchSetup.verifyCardConservation(
        "p1",
        brokenPlayer,
        validation.frame!.deck.cards
      );
    }).toThrow("Card conservation violated");
  });
});
