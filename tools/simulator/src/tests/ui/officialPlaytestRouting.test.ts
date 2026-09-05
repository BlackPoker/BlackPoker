import { describe, it, expect, beforeAll } from "vitest";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { GameSession } from "../../engine/session/GameSession";

describe("Official Playtest UI Routing Tests (Phase 2.4)", () => {
  const fullRulePackage = loadRulePackageForBrowser();
  const catalog = loadRegulationCatalogForBrowser();

  it("Core Battle ルーティングが従来のプリセット初期盤面を正常に生成すること", () => {
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    const playtestPackage = getPlaytestRulePackage(fullRulePackage);

    const session = new GameSession(setupResult.state, playtestPackage);
    const step = session.advance();

    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(session.state.players.p1.field.length).toBeGreaterThanOrEqual(2);
    expect(session.state.regulationId).toBeUndefined(); // Core Battle はレギュレーション外
  });

  it("Official Light+Entry16 ルーティングがブラウザ互換コードのみで公式対戦セッションを生成すること", () => {
    const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", {
      assertImplemented: true,
    });
    expect(validation.ruleLegal).toBe(true);
    expect(validation.simulatorImplemented).toBe(true);

    const officialRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      validation.format!,
      validation.regulation!
    );

    expect(officialRulePackage.id).toBe("official-light-entry16");
    expect(officialRulePackage.actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["action.attack", "action.block", "action.down", "action.twist", "action.up"])
    );
    expect(officialRulePackage.components.map((c) => c.id)).toEqual(
      expect.arrayContaining(["character.bulwark", "character.soldier"])
    );

    const outcome = OfficialRegulationMatchSetup.setupMatch(
      validation.regulation!,
      validation.frame!,
      officialRulePackage,
      42,
      { matchId: "match-official-ui-test", playerNames: { p1: "Player A", p2: "Player B" } }
    );

    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = new GameSession(outcome.state, officialRulePackage, {
      matchId: outcome.state.matchId,
    });
    const step = session.advance();

    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type === "WAITING_FOR_DECISION") {
      expect(step.request.patterns.length).toBeGreaterThan(0);
      expect(step.request.patterns.some((p) => p.kind === "PASS")).toBe(true);
      expect(step.request.playerId).toBe(outcome.firstPlayer);
    }
  });

  it("異なる Seed 値でそれぞれ独立した決定論的初期盤面が生成されること", () => {
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
      42
    );
    const outcome2 = OfficialRegulationMatchSetup.setupMatch(
      validation.regulation!,
      validation.frame!,
      officialRulePackage,
      9999
    );

    expect(outcome1.type).toBe("READY");
    expect(outcome2.type).toBe("READY");

    if (outcome1.type === "READY" && outcome2.type === "READY") {
      // 乱数シードの違いにより、手札やライフのカード配置が異なること
      const p1Hand1 = outcome1.state.players.p1.hand.map((c: any) => c.id).join(",");
      const p1Hand2 = outcome2.state.players.p1.hand.map((c: any) => c.id).join(",");
      expect(p1Hand1).not.toBe(p1Hand2);
    }
  });
});
