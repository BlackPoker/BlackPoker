import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { ScenarioBuilderModal } from "../../ui/scenario/ScenarioBuilderModal";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { ScenarioCompiler } from "../../engine/scenario/ScenarioCompiler";
import { prepareScenarioMatchAttempt } from "../../engine/playtest/ScenarioMatchCoordinator";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import { ScenarioAuthoringResolver } from "../../engine/scenario/ScenarioAuthoringResolver";
import { ScenarioAuthoringDraftV1 } from "../../domain/scenario/ScenarioAuthoringTypes";

describe("Scenario Rare Card Setup Integration Tests [BP-SIM-PRO-RAREPACK-POLISH-1]", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

  const proRarePackScenario: ScenarioDefinitionV1 = {
    version: 1,
    environmentId: "official:pro-rarePack",
    seed: 12345,
    turnPlayer: "p1",
    chancePlayer: "p1",
    turnCount: 1,
    name: "Pro RarePack Scenario",
    description: "Scenario for testing rare card selection in pro-rarePack",
    players: {
      p1: {
        hand: [
          { suit: "S", rank: "A" },
          { suit: "S", rank: "2" },
          { suit: "S", rank: "3" },
          { suit: "S", rank: "4" },
          { suit: "S", rank: "5" },
          { suit: "S", rank: "6" },
          { suit: "S", rank: "7" },
        ],
        field: [],
        grave: [],
        life: { count: 32 },
        pack: { count: 14, opened: false },
      },
      p2: {
        hand: [
          { suit: "H", rank: "A" },
          { suit: "H", rank: "2" },
          { suit: "H", rank: "3" },
          { suit: "H", rank: "4" },
          { suit: "H", rank: "5" },
          { suit: "H", rank: "6" },
          { suit: "H", rank: "7" },
        ],
        field: [],
        grave: [],
        life: { count: 32 },
        pack: { count: 14, opened: false },
      },
    },
  };

  describe("1. ScenarioCompiler: Rare Card 抽出と GameState 反映", () => {
    it("デフォルト Rare Card 解決: rareCardSelections 未指定時はデフォルト (Joker) が抽出され、カード保存則を満たす", () => {
      const outcome = ScenarioCompiler.compile(proRarePackScenario, catalog, fullRulePackage);
      if (outcome.type !== "READY") {
        throw new Error(JSON.stringify(outcome.errors));
      }
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const p1 = outcome.state.players.p1;
      const p2 = outcome.state.players.p2;

      // Rare Card ゾーンに各1枚が存在すること
      expect(p1.rareCards).toBeDefined();
      expect(p1.rareCards.length).toBe(1);
      expect(p1.rareCards[0].rank).toBe("Joker");

      expect(p2.rareCards).toBeDefined();
      expect(p2.rareCards.length).toBe(1);
      expect(p2.rareCards[0].rank).toBe("Joker");

      // 手札(1) + ライフ(32) + パック(14) + レアカード(1) + フィールド/墓地補完 = 54枚
      const p1TotalCards =
        p1.hand.length +
        p1.life.length +
        p1.pack.cards.length +
        p1.rareCards.length +
        p1.grave.length;
      expect(p1TotalCards).toBe(54);
    });

    it("カスタム Rare Card 選択: 指定されたカード (P1: ♠K, P2: Joker #2) が rareCards に割り当てられる", () => {
      const outcome = ScenarioCompiler.compile(proRarePackScenario, catalog, fullRulePackage, {
        rareCardSelections: {
          p1: [{ suit: "S", rank: "K", occurrence: 0 }],
          p2: [{ suit: "J", rank: "Joker", occurrence: 1 }],
        },
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const p1 = outcome.state.players.p1;
      const p2 = outcome.state.players.p2;

      expect(p1.rareCards.length).toBe(1);
      expect(p1.rareCards[0].suit).toBe("S");
      expect(p1.rareCards[0].rank).toBe("K");

      expect(p2.rareCards.length).toBe(1);
      expect(p2.rareCards[0].suit).toBe("J");
      expect(p2.rareCards[0].rank).toBe("Joker");
    });

    it("重複検出: 手札に ♠K を指定し、Rare Card にも ♠K を指定した場合は DUPLICATE_CARD エラーとなる", () => {
      const conflictScenario: ScenarioDefinitionV1 = {
        ...proRarePackScenario,
        players: {
          ...proRarePackScenario.players,
          p1: {
            ...proRarePackScenario.players.p1,
            hand: [{ suit: "S", rank: "K" }],
          },
        },
      };

      const outcome = ScenarioCompiler.compile(conflictScenario, catalog, fullRulePackage, {
        rareCardSelections: {
          p1: [{ suit: "S", rank: "K", occurrence: 0 }],
          p2: [{ suit: "J", rank: "Joker", occurrence: 0 }],
        },
      });

      expect(outcome.type).toBe("VALIDATION_ERROR");
      if (outcome.type !== "VALIDATION_ERROR") return;

      const dupError = outcome.errors.find((e) => e.code === "DUPLICATE_CARD");
      expect(dupError).toBeDefined();
      expect(dupError?.message).toContain("SK");
    });
  });

  describe("2. ScenarioAuthoringResolver: Rare Card 事前物理予約", () => {
    it("pro-rarePack ドラフトで Rare Card が事前予約され、残余補完に混入しない", () => {
      const draft: ScenarioAuthoringDraftV1 = {
        environmentId: "official:pro-rarePack",
        seed: 42,
        turnPlayer: "p1",
        chancePlayer: "p1",
        rareCardSelections: {
          p1: [{ suit: "S", rank: "K", occurrence: 0 }],
          p2: [{ suit: "J", rank: "Joker", occurrence: 0 }],
        },
        players: {
          p1: {
            hand: { count: 7 },
            pack: { count: 14 },
          },
          p2: {
            hand: { count: 7 },
            pack: { count: 14 },
          },
        },
      };

      const result = ScenarioAuthoringResolver.resolve(draft, catalog);
      expect(result.success).toBe(true);
      if (!result.success) return;

      // P1 の補完された手札・パック・ライフに ♠K が重複して入っていないこと
      const p1Def = result.definition.players.p1;
      const handHasSK = p1Def.hand?.some((c) => c.suit === "S" && c.rank === "K");
      const packHasSK = p1Def.pack?.cards?.some((c) => c.suit === "S" && c.rank === "K");
      const lifeHasSK = p1Def.life?.cards?.some((c) => c.suit === "S" && c.rank === "K");

      expect(handHasSK).toBe(false);
      expect(packHasSK).toBe(false);
      expect(lifeHasSK).toBe(false);
    });
  });

  describe("3. ScenarioMatchCoordinator: 対戦準備と ActiveMatchContext 反映", () => {
    it("prepareScenarioMatchAttempt に rareCardSelections が渡された場合、activeMatch および session に保持される", () => {
      const result = prepareScenarioMatchAttempt({
        definition: proRarePackScenario,
        catalog,
        fullRulePackage,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "playtestConservative",
        rareCardSelections: {
          p1: [{ suit: "S", rank: "K", occurrence: 0 }],
          p2: [{ suit: "J", rank: "Joker", occurrence: 0 }],
        },
      });

      expect(result.status).toBe("READY");
      if (result.status !== "READY") return;

      // ActiveMatchContext に rareCardSelections が保持されていること
      expect(result.prepared.activeMatch.rareCardSelections).toBeDefined();
      expect(result.prepared.activeMatch.rareCardSelections?.p1?.[0].rank).toBe("K");

      // GameSession の state にも反映されていること
      const p1State = result.prepared.session.state.players.p1;
      expect(p1State.rareCards.length).toBe(1);
      expect(p1State.rareCards[0].rank).toBe("K");
    });
  });

  describe("4. ScenarioBuilderModal: UI 上でのレアカード設定と対戦開始連携", () => {
    it("pro-rarePack 選択時、settings タブ内に RareCardSetupPanel が表示され、確定した選択が onStartScenario に伝播する", () => {
      const handleStart = vi.fn();
      const handleClose = vi.fn();

      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <ScenarioBuilderModal
            isOpen={true}
            onClose={handleClose}
            catalog={catalog}
            fullRulePackage={fullRulePackage}
            onStartScenario={handleStart}
            initialDefinition={proRarePackScenario}
            initialTab="settings"
            initialMode="humanVsAi"
          />
        );
      });

      const root = renderer!.root;

      // 1. 最初はデフォルト選択で完了ビューが表示されていること
      const completedPanel = root.findByProps({ "data-testid": "rare-setup-completed" });
      expect(completedPanel).toBeDefined();

      // 2. 「選択をやり直す」を押して選択画面へ移行
      const resetButton = root.findByProps({ "data-testid": "reset-rare-button" });
      act(() => {
        resetButton.props.onClick();
      });

      const rarePanel = root.findByProps({ "data-testid": "rare-setup-panel" });
      expect(rarePanel).toBeDefined();

      // 3. 1タップで ♠K を選択
      const spadeK = root.findByProps({ "aria-label": "♠K" });
      act(() => {
        spadeK.props.onClick();
      });

      // 4. 確定ボタンを押す
      const confirmButton = root.findByProps({ "data-testid": "confirm-rare-button" });
      expect(confirmButton.props.disabled).toBe(false);
      act(() => {
        confirmButton.props.onClick();
      });

      // 4. 「初期盤面で対戦開始」ボタンを押す
      const startButtons = root.findAll(
        (node) =>
          node.type === "button" &&
          typeof node.props.children === "object" &&
          node.props.children?.props?.children === "初期盤面で対戦開始"
      );
      expect(startButtons.length).toBe(1);
      const startButton = startButtons[0];
      expect(startButton.props.disabled).toBe(false);

      act(() => {
        startButton.props.onClick();
      });

      // 5. onStartScenario が呼ばれ、options.rareCardSelections に ♠K が含まれていること
      expect(handleStart).toHaveBeenCalledTimes(1);
      const startArgs = handleStart.mock.calls[0];
      const startOptions = startArgs[1];
      expect(startOptions.rareCardSelections).toBeDefined();
      expect(startOptions.rareCardSelections.p1).toBeDefined();
      expect(startOptions.rareCardSelections.p1[0].rank).toBe("K");
      expect(startOptions.rareCardSelections.p1[0].suit).toBe("S");
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });
});
