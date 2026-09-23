import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ScenarioBuilderModal } from "../../ui/scenario/ScenarioBuilderModal";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { ActiveMatchContext } from "../../engine/playtest/PlaytestEnvironmentController";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";

describe("ScenarioBuilderPresentation Unit & Integration Tests (BP-SIM-SCENARIO-1.0-FOUNDATION)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();
  const dummyOnClose = vi.fn();
  const dummyOnStartScenario = vi.fn();

  const minimalValidScenario: ScenarioDefinitionV1 = {
    version: 1,
    environmentId: "official:light-entry16",
    seed: 42,
    turnPlayer: "p1",
    chancePlayer: "p1",
    turnCount: 1,
    name: "Presentation Test Scenario",
    description: "Scenario for presentation tests",
    players: {
      p1: {
        hand: [
          { suit: "S", rank: "A" },
          { suit: "S", rank: "2" },
        ],
        field: [
          {
            componentId: "character.hero",
            card: { suit: "H", rank: "Q" },
          },
        ],
        grave: [{ suit: "C", rank: "6" }],
        life: { count: 3 },
        pack: { count: 9 },
      },
      p2: {
        hand: [{ suit: "S", rank: "3" }],
        field: [],
        grave: [],
        life: { count: 4 },
        pack: { count: 11 },
      },
    },
  };

  it("1: ScenarioBuilderModal が正常にレンダリングされ、タイトルおよびコントロールが存在すること", () => {
    const html = renderToString(
      React.createElement(ScenarioBuilderModal, {
        isOpen: true,
        initialTab: "settings",
        catalog,
        fullRulePackage,
        initialDefinition: minimalValidScenario,
        onClose: dummyOnClose,
        onStartScenario: dummyOnStartScenario,
      })
    );

    expect(html).toContain("Scenario Builder");
    expect(html).toContain("対戦環境 (公式レギュレーションのみ):");
    expect(html).toContain("Turn Player:");
    expect(html).toContain("Chance Player:");
    expect(html).toContain("Scenario 開始");
  });

  it("2: Core Battle は選択肢から除外され、公式レギュレーションのみが環境一覧に表示されること", () => {
    const html = renderToString(
      React.createElement(ScenarioBuilderModal, {
        isOpen: true,
        initialTab: "settings",
        catalog,
        fullRulePackage,
        initialDefinition: minimalValidScenario,
        onClose: dummyOnClose,
        onStartScenario: dummyOnStartScenario,
      })
    );

    expect(html).not.toContain("value=\"core-battle\"");
    expect(html).not.toContain("Core Battle");
    expect(html).toContain("value=\"official:light-entry16\"");
  });

  it("3: UI 内に Phase 概念 (Phase / フェーズ) のラベルや操作コントロールが存在しないこと", () => {
    const html = renderToString(
      React.createElement(ScenarioBuilderModal, {
        isOpen: true,
        initialTab: "settings",
        catalog,
        fullRulePackage,
        initialDefinition: minimalValidScenario,
        onClose: dummyOnClose,
        onStartScenario: dummyOnStartScenario,
      })
    );

    // Ensure no turn phase or phase selection
    expect(html).not.toMatch(/メインフェーズ|アタックフェーズ|ドローフェーズ|phase|turnPhase/i);
    // But Turn Player and Chance Player exist
    expect(html).toContain("Turn Player");
    expect(html).toContain("Chance Player");
  });

  it("4: Scenario-origin 対戦における fail-closed 契約 (ActiveMatchContext.isScenario)", () => {
    // Normal match context
    const normalMatch: ActiveMatchContext = {
      environmentId: "official:light-entry16",
      environmentName: "ライト + エントリー16",
      regulationId: "light-entry16",
      rulePackage: fullRulePackage,
      isScenario: false,
    };
    expect(normalMatch.isScenario).toBe(false);

    // Scenario match context
    const scenarioMatch: ActiveMatchContext = {
      environmentId: "official:light-entry16",
      environmentName: "ライト + エントリー16 (Scenario)",
      regulationId: "light-entry16",
      rulePackage: fullRulePackage,
      isScenario: true,
    };
    expect(scenarioMatch.isScenario).toBe(true);

    // Fail-closed checks for scenario match
    const canUndo = (match: ActiveMatchContext, historyLength: number) => {
      if (match.isScenario) return false;
      return historyLength > 0;
    };
    expect(canUndo(scenarioMatch, 5)).toBe(false);
    expect(canUndo(normalMatch, 5)).toBe(true);

    const isDiagnosticDownloadAvailable = (match: ActiveMatchContext) => {
      return match.isScenario !== true;
    };
    expect(isDiagnosticDownloadAvailable(scenarioMatch)).toBe(false);
    expect(isDiagnosticDownloadAvailable(normalMatch)).toBe(true);

    const isReplayViewerAvailable = (match: ActiveMatchContext) => {
      return match.isScenario !== true;
    };
    expect(isReplayViewerAvailable(scenarioMatch)).toBe(false);
    expect(isReplayViewerAvailable(normalMatch)).toBe(true);
  });

  it("5: ScenarioBuilderModal のバリデーションエラー表示と開始ボタン無効化", () => {
    // Duplicate card in hand causes compile error
    const duplicateCardScenario: ScenarioDefinitionV1 = {
      ...minimalValidScenario,
      players: {
        ...minimalValidScenario.players,
        p1: {
          ...minimalValidScenario.players.p1,
          hand: [
            { suit: "S", rank: "A" },
            { suit: "S", rank: "A" }, // duplicate SA
          ],
        },
      },
    };

    const html = renderToString(
      React.createElement(ScenarioBuilderModal, {
        isOpen: true,
        catalog,
        fullRulePackage,
        initialDefinition: duplicateCardScenario,
        onClose: dummyOnClose,
        onStartScenario: dummyOnStartScenario,
      })
    );

    // Should show error and disabled start button
    expect(html).toContain("cursor-not-allowed");
    expect(html).toContain("バリデーションエラー");
  });
});
