import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import { prepareScenarioMatchAttempt } from "../../engine/playtest/ScenarioMatchCoordinator";
import { startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController";
import {
  buildPlaytestShareUrl,
  parsePlaytestShareUrl,
} from "../../ui/playtest/PlaytestShareUrl";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import { ScenarioBuilderModal } from "../../ui/scenario/ScenarioBuilderModal";
import { MobileHeaderMenu } from "../../ui/game/MobileHeaderMenu";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";

describe("PlaytestShareIntegration Tests (BP-SIM-SHARE-1.0-START-CONTEXT-INTEGRATION)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

  const sampleScenario: ScenarioDefinitionV1 = {
    version: 1,
    environmentId: "official:standard-pack",
    seed: 551,
    turnPlayer: "p1",
    chancePlayer: "p2",
    turnCount: 1,
    name: "Start Context Share Test",
    description: "Scenario for testing start context preservation",
    players: {
      p1: {
        hand: [{ suit: "S", rank: "A" }],
        field: [
          {
            componentId: "character.hero",
            cards: [{ suit: "H", rank: "K" }],
            state: "drive",
            face: "up",
          },
        ],
        grave: [{ suit: "C", rank: "2" }],
        life: { count: 5 },
        pack: { count: 46 }, // 1 + 1 + 1 + 5 + 46 = 54
      },
      p2: {
        hand: [{ suit: "H", rank: "10" }],
        life: { count: 5 },
        pack: { count: 48 }, // 1 + 5 + 48 = 54
      },
    },
  };

  it("1: prepareScenarioMatchAttempt で activeMatch.scenarioDefinition に初期定義が正準保持されること", () => {
    const outcome = prepareScenarioMatchAttempt({
      definition: sampleScenario,
      catalog,
      fullRulePackage,
      mode: "humanVsHuman",
      humanSeat: "p1",
      policyId: "firstLegal",
    });

    expect(outcome.status).toBe("READY");
    if (outcome.status === "READY") {
      expect(outcome.prepared.activeMatch.isScenario).toBe(true);
      expect(outcome.prepared.activeMatch.scenarioDefinition).toBeDefined();
      expect(outcome.prepared.activeMatch.scenarioDefinition).toEqual(sampleScenario);
    }
  });

  it("2: 対戦進行後も共有URLは現在のGameStateではなく対戦開始時の初期シナリオ定義を共有すること", () => {
    const outcome = prepareScenarioMatchAttempt({
      definition: sampleScenario,
      catalog,
      fullRulePackage,
      mode: "humanVsAi",
      humanSeat: "p1",
      policyId: "firstLegal",
    });

    expect(outcome.status).toBe("READY");
    if (outcome.status !== "READY") return;

    const { session, activeMatch } = outcome.prepared;
    expect(session.state.players.p1.hand.length).toBeGreaterThanOrEqual(1);

    const shareUrl = buildPlaytestShareUrl(
      "https://simulator.blackpoker.org/playtest",
      {
        environmentId: activeMatch.environmentId,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "firstLegal",
        seedInput: String(activeMatch.seed),
        scenarioDefinition: activeMatch.scenarioDefinition,
      },
      catalog
    );

    expect(shareUrl).toContain("scenario=");
    expect(shareUrl).toContain("env=official%3Astandard-pack");
    expect(shareUrl).toContain("seed=551");

    const parseRes = parsePlaytestShareUrl(shareUrl, catalog);
    expect(parseRes.kind).toBe("READY");
    if (parseRes.kind === "READY") {
      expect(parseRes.config.scenarioDefinition).toEqual(sampleScenario);
      expect(parseRes.config.environmentId).toBe(sampleScenario.environmentId);
      expect(parseRes.config.seedInput).toBe(String(sampleScenario.seed));
    }
  });

  it("3: 通常対戦の共有時は URL から scenario パラメータが除去されること", () => {
    const normalOutcome = startMatchAttempt({
      environmentId: "official:light-entry16",
      seedInput: "42",
      catalog,
      fullRulePackage,
    });

    expect(normalOutcome.type).toBe("READY");
    if (normalOutcome.type !== "READY") return;

    expect(normalOutcome.activeMatch.isScenario).toBeFalsy();
    expect(normalOutcome.activeMatch.scenarioDefinition).toBeUndefined();

    const previousScenarioUrl = "https://simulator.blackpoker.org/playtest?bpv=1&scenario=previousPayload&env=official:standard-pack";
    const cleanUrl = buildPlaytestShareUrl(
      previousScenarioUrl,
      {
        environmentId: normalOutcome.activeMatch.environmentId,
        mode: "humanVsHuman",
        humanSeat: "p1",
        policyId: "firstLegal",
        seedInput: "42",
        scenarioDefinition: undefined,
      },
      catalog
    );

    expect(cleanUrl).not.toContain("scenario=");
    expect(cleanUrl).toContain("env=official%3Alight-entry16");
    expect(cleanUrl).toContain("seed=42");
  });

  describe("4: UI 表示・ボタン文言・tooltip の検証", () => {
    it("4.1: MatchSetupScreen に『この対戦設定を共有』ボタンが存在すること", () => {
      const html = renderToString(
        React.createElement(MatchSetupScreen, {
          environmentOptions: [{ id: "official:standard-pack", name: "Standard + Pack (公式)", isOfficial: true }],
          selectedEnvironmentId: "official:standard-pack",
          onSelectEnvironment: () => {},
          matchMode: "humanVsHuman",
          onSelectMatchMode: () => {},
          policyId: "firstLegal",
          onSelectPolicyId: () => {},
          seedInput: "42",
          onSeedInputChange: () => {},
          onStartMatch: () => {},
          onOpenReplayVerify: () => {},
          onOpenScenarioBuilder: () => {},
          onCopyShareUrl: () => {},
        })
      );

      expect(html).toContain("この対戦設定を共有");
      expect(html).toContain("現在の対戦設定を共有URLとしてコピーします");
      expect(html).not.toContain("共有URLをコピー");
    });

    it("4.2: ScenarioBuilderModal に『この初期盤面を共有』ボタンが存在すること", () => {
      const html = renderToString(
        React.createElement(ScenarioBuilderModal, {
          isOpen: true,
          onClose: () => {},
          catalog,
          fullRulePackage,
          onStartScenario: () => {},
        })
      );

      expect(html).toContain("この初期盤面を共有");
      expect(html).toContain("入力中の初期盤面設定を共有URLとしてコピーします");
      expect(html).not.toContain("共有URLをコピー");
    });

    it("4.3: MobileHeaderMenu に『開始条件を共有』ボタンが存在すること", () => {
      const html = renderToString(
        React.createElement(MobileHeaderMenu, {
          isOpen: true,
          onClose: () => {},
          selectedEnvironmentId: "official:standard-pack",
          onSelectEnvironment: () => {},
          environmentOptions: [{ id: "official:standard-pack", name: "Standard + Pack (公式)", isOfficial: true }],
          showSeedInput: true,
          matchMode: "humanVsHuman",
          onSelectMatchMode: () => {},
          policyId: "firstLegal",
          onSelectPolicyId: () => {},
          isOfficialEnvironment: true,
          enablePassAndPlay: true,
          onTogglePassAndPlay: () => {},
          onOpenLogModal: () => {},
          onOpenDebugModal: () => {},
          onResetGame: () => {},
          onCopyShareUrl: () => {},
        })
      );

      expect(html).toContain("開始条件を共有");
      expect(html).toContain("現在の盤面ではなく、この対戦を開始した設定・初期盤面を共有します");
      expect(html).not.toContain("共有URLをコピー");
    });

    it("4.4: CoreBattlePlaytest のヘッダーに『開始条件を共有』が存在し『共有URLをコピー』が存在しないこと", () => {
      const html = renderToString(
        React.createElement(CoreBattlePlaytest)
      );

      expect(html).toContain("開始条件を共有");
      expect(html).toContain("現在の盤面ではなく、この対戦を開始した設定・初期盤面を共有します");
      expect(html).not.toContain("共有URLをコピー");
    });
  });
});
