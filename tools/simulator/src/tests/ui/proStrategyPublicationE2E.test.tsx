import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeAll } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import {
  getAvailableEnvironments,
  startMatchAttempt,
  MatchStartRequest,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import {
  STANDARD_54_DECK_CARDS,
  SimulatorDeckProfile,
  CardOccurrenceSelection,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import { ScenarioCompiler } from "../../engine/scenario/ScenarioCompiler";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";

describe("BP-SIM-PRO-STRATEGY-PHASE-4: Pro + Strategy Publication E2E Acceptance", () => {
  let catalog: any;
  let fullRulePackage: any;

  const standardProfile: SimulatorDeckProfile = {
    id: "standard54",
    name: "Standard 54-Card Deck",
    cardCount: 54,
    cards: STANDARD_54_DECK_CARDS,
    defaultRareCardSelections: [{ suit: "J", rank: "Joker", occurrence: 0 }],
  };

  const validP1Scenario: CardOccurrenceSelection[] = [
    { suit: "S", rank: "A", occurrence: 0 },
    { suit: "H", rank: "K", occurrence: 0 },
    { suit: "D", rank: "Q", occurrence: 0 },
  ];
  const validP2Scenario: CardOccurrenceSelection[] = [
    { suit: "C", rank: "A", occurrence: 0 },
    { suit: "C", rank: "K", occurrence: 0 },
    { suit: "C", rank: "Q", occurrence: 0 },
  ];
  const validP1Rare: CardOccurrenceSelection[] = [{ suit: "J", rank: "Joker", occurrence: 0 }];
  const validP2Rare: CardOccurrenceSelection[] = [{ suit: "J", rank: "Joker", occurrence: 1 }];

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  // =========================================================================
  // 1. Publication Contract (Section 38, 43)
  // =========================================================================
  describe("1. Publication Contract & Environment List Ordering", () => {
    it("official:pro-strategy appears naturally in getAvailableEnvironments with exact specifications", () => {
      const envs = getAvailableEnvironments(catalog);
      const proStrategyEnv = envs.find((e) => e.id === "official:pro-strategy");

      expect(proStrategyEnv).toBeDefined();
      expect(proStrategyEnv?.isOfficial).toBe(true);
      expect(proStrategyEnv?.regulationId).toBe("pro-strategy");
      expect(proStrategyEnv?.name).toBe("プロ + ストラテジー (公式)");
      expect(proStrategyEnv?.name).not.toContain("(公式) (公式)");
      expect(proStrategyEnv?.setupRequirements?.scenarioHandCount).toBe(3);
      expect(proStrategyEnv?.setupRequirements?.rareCardCount).toBe(1);
    });

    it("orders official environments strictly: Core Battle -> Light -> Standard -> Pro with pro-strategy at the end", () => {
      const envs = getAvailableEnvironments(catalog);
      const envIds = envs.map((e) => e.id);

      expect(envIds).toEqual([
        "core-battle",
        "official:light-entry16",
        "official:light-pack",
        "official:standard-pack",
        "official:standard-rarePack",
        "official:pro-rarePack",
        "official:pro-strategy",
      ]);
    });
  });

  // =========================================================================
  // 2. UI Publication & Sequential Setup (Section 39, 7, 8, 9)
  // =========================================================================
  describe("2. UI Publication & Sequential Setup in MatchSetupScreen", () => {
    it("renders ScenarioHandSetupPanel and keeps RareCardSetupPanel locked until Scenario Hand is confirmed", () => {
      const envs = getAvailableEnvironments(catalog);
      const onStartMatch = vi.fn();

      // 初期状態: シナリオ手札未選択
      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <MatchSetupScreen
            environmentOptions={envs}
            selectedEnvironmentId="official:pro-strategy"
            onSelectEnvironment={vi.fn()}
            matchMode="humanVsHuman"
            onSelectMatchMode={vi.fn()}
            policyId="firstLegal"
            onSelectPolicyId={vi.fn()}
            seedInput="42"
            onSeedInputChange={vi.fn()}
            deckProfile={standardProfile}
            confirmedScenarioHandSelections={undefined}
            confirmedRareCardSelections={undefined}
            onStartMatch={onStartMatch}
            onOpenReplayVerify={vi.fn()}
          />
        );
      });

      const root = renderer!.root;

      // 1. シナリオ手札設定パネルが表示されていること
      const scenarioPanel = root.findByProps({ "data-testid": "scenario-setup-panel" });
      expect(scenarioPanel).toBeDefined();

      // 2. レアカード設定はロック状態であること
      const lockedBanner = root.findByProps({ "data-testid": "rare-setup-locked" });
      expect(lockedBanner).toBeDefined();
      expect(JSON.stringify(renderer!.toJSON())).toContain("レアカード設定はロックされています");

      // 3. 対戦開始ボタンは無効化 (disabled)
      const startButton = root.findByProps({ "data-testid": "start-match-button" });
      expect(startButton.props.disabled).toBe(true);
    });

    it("unlocks RareCardSetupPanel when Scenario Hand is confirmed, and enables startMatch when both are ready", () => {
      const envs = getAvailableEnvironments(catalog);
      const onStartMatch = vi.fn();

      // シナリオ手札確定済み、レアカード未確定
      let renderer: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          <MatchSetupScreen
            environmentOptions={envs}
            selectedEnvironmentId="official:pro-strategy"
            onSelectEnvironment={vi.fn()}
            matchMode="humanVsHuman"
            onSelectMatchMode={vi.fn()}
            policyId="firstLegal"
            onSelectPolicyId={vi.fn()}
            seedInput="42"
            onSeedInputChange={vi.fn()}
            deckProfile={standardProfile}
            confirmedScenarioHandSelections={{
              p1: validP1Scenario,
              p2: validP2Scenario,
            }}
            confirmedRareCardSelections={undefined}
            onStartMatch={onStartMatch}
            onOpenReplayVerify={vi.fn()}
          />
        );
      });

      const root = renderer!.root;

      // 1. シナリオ手札完了サマリーが表示
      expect(root.findByProps({ "data-testid": "scenario-setup-completed" })).toBeDefined();

      // 2. レアカード設定パネルがアンロックされていること
      const rarePanel = root.findByProps({ "data-testid": "rare-setup-panel" });
      expect(rarePanel).toBeDefined();

      // 3. レアカード未確定のため開始ボタンは disabled
      const startButton = root.findByProps({ "data-testid": "start-match-button" });
      expect(startButton.props.disabled).toBe(true);

      // 4. レアカードも確定済みに更新
      act(() => {
        renderer.update(
          <MatchSetupScreen
            environmentOptions={envs}
            selectedEnvironmentId="official:pro-strategy"
            onSelectEnvironment={vi.fn()}
            matchMode="humanVsHuman"
            onSelectMatchMode={vi.fn()}
            policyId="firstLegal"
            onSelectPolicyId={vi.fn()}
            seedInput="42"
            onSeedInputChange={vi.fn()}
            deckProfile={standardProfile}
            confirmedScenarioHandSelections={{
              p1: validP1Scenario,
              p2: validP2Scenario,
            }}
            confirmedRareCardSelections={{
              p1: validP1Rare,
              p2: validP2Rare,
            }}
            onStartMatch={onStartMatch}
            onOpenReplayVerify={vi.fn()}
          />
        );
      });

      // 開始ボタンが enabled になる
      const enabledStartButton = renderer!.root.findByProps({ "data-testid": "start-match-button" });
      expect(enabledStartButton.props.disabled).toBe(false);
    });
  });

  // =========================================================================
  // 3. Human vs Human E2E (Section 40)
  // =========================================================================
  describe("3. Human vs Human E2E Match Flow", () => {
    it("completes full match setup to READY state with exact zone counts and advances to decision request", async () => {
      const startReq: MatchStartRequest = {
        catalog,
        fullRulePackage,
        environmentId: "official:pro-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
        scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
      };

      const outcome = await startMatchAttempt(startReq);
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      expect(outcome.activeMatch?.environmentId).toBe("official:pro-strategy");
      expect(outcome.activeMatch?.scenarioHandSelections?.p1).toEqual(validP1Scenario);
      expect(outcome.activeMatch?.scenarioHandSelections?.p2).toEqual(validP2Scenario);
      expect(outcome.activeMatch?.rareCardSelections?.p1).toEqual(validP1Rare);
      expect(outcome.activeMatch?.rareCardSelections?.p2).toEqual(validP2Rare);

      const state = outcome.session.state;

      // 各プレイヤーのゾーン枚数検証
      for (const pKey of ["p1", "p2"] as const) {
        const player = state.players[pKey];
        expect(player.rareCards.length).toBe(1);
        expect(player.pack.count).toBe(14);
        expect(player.pack.cards.length).toBe(14);

        // 指定したシナリオ手札が手札に含まれていること
        const expectedScenario = pKey === "p1" ? validP1Scenario : validP2Scenario;
        for (const spec of expectedScenario) {
          expect(player.hand.some((c: any) => c.suit === spec.suit && c.rank === spec.rank)).toBe(true);
        }
      }

      // 先攻・後攻の手札枚数: 先攻 7 + 1 = 8枚, 後攻 7枚
      const first = outcome.firstPlayer;
      const second = first === "p1" ? "p2" : "p1";
      expect(state.players[first].hand.length).toBe(8);
      expect(state.players[second].hand.length).toBe(7);

      // DecisionRequest 到達確認
      let step = outcome.initialStep;
      while (step.type === "PROGRESSED") {
        step = outcome.session.advance();
      }
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type === "WAITING_FOR_DECISION") {
        expect(step.request.patterns.length).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // 4. Human vs AI E2E (Section 41)
  // =========================================================================
  describe("4. Human vs AI E2E Match Flow", () => {
    it("auto-resolves AI scenario hand, protects hidden info, and starts successfully", async () => {
      const startReq: MatchStartRequest = {
        catalog,
        fullRulePackage,
        environmentId: "official:pro-strategy",
        matchMode: "humanVsAi",
        seedInput: "12345",
        rareCardSelections: { p1: validP1Rare }, // AI Rare is auto-resolved
        scenarioHandSelections: { p1: validP1Scenario }, // AI Scenario is auto-resolved
      };

      const outcome = await startMatchAttempt(startReq);
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      // P1 (Human)
      expect(outcome.activeMatch?.scenarioHandSelections?.p1).toEqual(validP1Scenario);

      // P2 (AI): 3枚の合法なシナリオ手札が自動解決されて保存されている
      const p2Scenario = outcome.activeMatch?.scenarioHandSelections?.p2;
      expect(p2Scenario).toBeDefined();
      expect(p2Scenario?.length).toBe(3);

      const p2Rare = outcome.activeMatch?.rareCardSelections?.p2;
      expect(p2Rare).toBeDefined();
      expect(p2Rare?.length).toBe(1);

      // AI の Rare と Scenario に物理重複がないこと
      for (const s of p2Scenario!) {
        for (const r of p2Rare!) {
          const same = s.suit === r.suit && s.rank === r.rank && (s.occurrence ?? 0) === (r.occurrence ?? 0);
          expect(same).toBe(false);
        }
      }

      // GameState 成立
      const state = outcome.session.state;
      expect(state.players.p1.rareCards.length).toBe(1);
      expect(state.players.p2.rareCards.length).toBe(1);
      expect(state.players.p1.pack.count).toBe(14);
      expect(state.players.p2.pack.count).toBe(14);
    });
  });

  // =========================================================================
  // 5. Fail-Closed Validation E2E (Section 42)
  // =========================================================================
  describe("5. Fail-Closed Validation E2E", () => {
    it("fails closed on incomplete or overlapping setup inputs", async () => {
      // 1. P1 Scenario 2枚
      const resIncomplete = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:pro-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
        scenarioHandSelections: {
          p1: validP1Scenario.slice(0, 2),
          p2: validP2Scenario,
        },
      });
      expect(resIncomplete.type).toBe("VALIDATION_ERROR");

      // 2. P2 Scenario 欠落 (H2H)
      const resMissingP2 = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:pro-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
        scenarioHandSelections: { p1: validP1Scenario },
      });
      expect(resMissingP2.type).toBe("VALIDATION_ERROR");

      // 3. Scenario Hand と Rare Card の同一 physical occurrence 指定
      const resOverlap = await startMatchAttempt({
        catalog,
        fullRulePackage,
        environmentId: "official:pro-strategy",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: {
          p1: [{ suit: "S", rank: "A", occurrence: 0 }], // Overlaps with S-A in validP1Scenario
          p2: validP2Rare,
        },
        scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
      });
      expect(resOverlap.type).toBe("VALIDATION_ERROR");
      if (resOverlap.type === "VALIDATION_ERROR") {
        expect(resOverlap.setupNotice?.title).toContain("物理カード重複エラー");
      }
    });
  });

  // =========================================================================
  // 6. Scenario Builder Strategy Integration (Section 44, 20, 21, 22)
  // =========================================================================
  describe("6. Scenario Builder Strategy Integration", () => {
    it("compiles and initializes arbitrary Scenario Definition under official:pro-strategy", () => {
      const definition: ScenarioDefinitionV1 = {
        version: 1,
        environmentId: "official:pro-strategy",
        seed: 42,
        turnPlayer: "p1",
        chancePlayer: "p1",
        turnCount: 1,
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

      const outcome = ScenarioCompiler.compile(
        definition,
        catalog,
        fullRulePackage,
        {
          rareCardSelections: {
            p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
            p2: [{ suit: "J", rank: "Joker", occurrence: 1 }],
          },
        }
      );

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      expect(outcome.session.state.formatId).toBe("pro");
      expect(outcome.session.state.frameId).toBe("strategy");
      expect(outcome.session.state.players.p1.rareCards.length).toBe(1);
      expect(outcome.session.state.players.p2.rareCards.length).toBe(1);
      expect(outcome.session.state.players.p1.pack.count).toBe(14);
      expect(outcome.session.state.players.p2.pack.count).toBe(14);
      expect(outcome.session.state.players.p1.hand.length).toBe(7);
      expect(outcome.session.state.players.p2.hand.length).toBe(7);
    });
  });
});
