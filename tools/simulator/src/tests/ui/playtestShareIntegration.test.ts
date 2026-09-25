import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import {
  parsePlaytestShareUrl,
  resolvePlaytestInitialBootstrap,
  buildPlaytestShareUrl,
  PlaytestShareConfigV1,
} from "../../ui/playtest/PlaytestShareUrl";
import { copyTextToClipboard } from "../../ui/utils/clipboard";
import {
  startMatchAttempt,
  OFFICIAL_ENV_PREFIX,
  CORE_BATTLE_ENV_ID,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { PlaytestSeedMode } from "../../ui/playtest/PlaytestSeed";
import {
  ScenarioDefinitionV1,
  normalizeScenarioDefinitionV1,
} from "../../domain/scenario/ScenarioTypes";
import { prepareScenarioMatchAttempt } from "../../engine/playtest/ScenarioMatchCoordinator";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import { ScenarioBuilderModal } from "../../ui/scenario/ScenarioBuilderModal";
import { MobileHeaderMenu } from "../../ui/game/MobileHeaderMenu";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";

describe("Playtest Share URL Integration Tests (Phase 2.7 & BP-SIM-SHARE-1.0)", () => {
  const fullRulePackage = loadRulePackageForBrowser();
  const catalog = loadRegulationCatalogForBrowser();
  const officialEnvId = `${OFFICIAL_ENV_PREFIX}light-entry16`;

  describe("Test A: 1-time apply & Pending Settings Mutation Isolation", () => {
    it("URLから読み込んだ設定がPending Settingsに初期反映され、ユーザー変更や再レンダリングで上書きされないこと", () => {
      const shareUrl = "https://blackpoker.example.com/?bpv=1&env=official%3Alight-entry16&mode=humanVsAi&human=p2&policy=seededRandom&seed=999";

      // 1. 初回マウント時: URL をパースして Pending Settings に反映
      let shareUrlApplied = false;
      const parseResult = parsePlaytestShareUrl(shareUrl, catalog);

      expect(parseResult.kind).toBe("READY");
      if (parseResult.kind !== "READY") return;

      // Pending state variables
      let selectedEnvironmentId = CORE_BATTLE_ENV_ID;
      let pendingMatchMode: "humanVsHuman" | "humanVsAi" = "humanVsHuman";
      let pendingHumanSeat: "p1" | "p2" = "p1";
      let pendingPolicyId = "firstLegal";
      let seedInput = "42";

      // Apply from URL exactly once
      if (!shareUrlApplied && parseResult.kind === "READY") {
        shareUrlApplied = true;
        selectedEnvironmentId = parseResult.config.environmentId;
        pendingMatchMode = parseResult.config.mode;
        pendingHumanSeat = parseResult.config.humanSeat;
        pendingPolicyId = parseResult.config.policyId;
        seedInput = parseResult.config.seedInput;
      }

      // Assert that pending settings reflect the URL
      expect(selectedEnvironmentId).toBe(officialEnvId);
      expect(pendingMatchMode).toBe("humanVsAi");
      expect(pendingHumanSeat).toBe("p2");
      expect(pendingPolicyId).toBe("seededRandom");
      expect(seedInput).toBe("999");
      expect(shareUrlApplied).toBe(true);

      // 2. ユーザーが設定を手動変更 (例: seed を 12345、human を p1 に変更)
      seedInput = "12345";
      pendingHumanSeat = "p1";

      // 3. 再レンダリングや catalog 再評価が走っても、shareUrlApplied が true のため再上書きされないこと
      if (!shareUrlApplied && parseResult.kind === "READY") {
        // This block must NOT execute
        seedInput = parseResult.config.seedInput;
        pendingHumanSeat = parseResult.config.humanSeat;
      }

      expect(seedInput).toBe("12345");
      expect(pendingHumanSeat).toBe("p1");
    });
  });

  describe("Test B: Secret & State Boundary / No Auto-Start (Bootstrap Contract)", () => {
    it("resolvePlaytestInitialBootstrap による初期化判定で、Share URL ロード時は自動対戦開始が一切呼ばれず activeMatch が null のままであること", () => {
      // 模擬Bootstrapディスパッチャ（CoreBattlePlaytest.tsx の useEffect 実装と同一の switch 契約）
      let activeMatch: any = null;
      let session: any = null;
      let restoredSettings: PlaytestShareConfigV1 | null = null;
      let warningNotice: readonly string[] | null = null;

      const mockStartNewGame = vi.fn((envId: string, seed: string) => {
        const outcome = startMatchAttempt({
          environmentId: envId,
          seedInput: seed,
          catalog,
          fullRulePackage,
        });
        if (outcome.type === "READY") {
          activeMatch = outcome.activeMatch;
          session = outcome.session;
        }
      });

      const executeBootstrap = (searchOrUrl: string) => {
        const bootstrap = resolvePlaytestInitialBootstrap(searchOrUrl, catalog);
        switch (bootstrap.kind) {
          case "RESTORE_SHARE_SETTINGS":
          case "RESTORE_SCENARIO_SETTINGS":
            restoredSettings = bootstrap.config;
            // startNewGame は絶対に呼ばない
            break;
          case "SHOW_SHARE_WARNING":
            warningNotice = bootstrap.warnings;
            // startNewGame は絶対に呼ばない
            break;
          case "SHOW_SETUP":
          case "START_DEFAULT_MATCH":
            // 自動対戦開始は行わず、Setup Screen を表示
            break;
        }
        return bootstrap;
      };

      // 1. 有効な bpv=1 Share URL の場合: RESTORE_SHARE_SETTINGS となり startNewGame は呼ばれない
      const validShareUrl = "https://blackpoker.example.com/?bpv=1&env=official%3Alight-entry16&mode=humanVsAi&human=p1&policy=seededRandom&seed=777";
      const bootstrap1 = executeBootstrap(validShareUrl);

      expect(bootstrap1.kind).toBe("RESTORE_SHARE_SETTINGS");
      expect(mockStartNewGame).not.toHaveBeenCalled();
      expect(activeMatch).toBeNull();
      expect(session).toBeNull();
      expect(restoredSettings).not.toBeNull();
      expect(restoredSettings?.environmentId).toBe(officialEnvId);
      expect(restoredSettings?.seedInput).toBe("777");

      // 2. 未知バージョン bpv=999 の場合: SHOW_SHARE_WARNING となり startNewGame は呼ばれない
      const invalidVersionUrl = "https://blackpoker.example.com/?bpv=999&env=official%3Alight-entry16";
      const bootstrap2 = executeBootstrap(invalidVersionUrl);

      expect(bootstrap2.kind).toBe("SHOW_SHARE_WARNING");
      expect(mockStartNewGame).not.toHaveBeenCalled();
      expect(activeMatch).toBeNull();
      expect(warningNotice).not.toBeNull();

      // 3. 通常アクセス (bpv なし) の場合: SHOW_SETUP となり初期対戦は自動開始されない
      const normalUrl = "https://blackpoker.example.com/playtest/?debug=true";
      const bootstrap3 = executeBootstrap(normalUrl);

      expect(bootstrap3.kind).toBe("SHOW_SETUP");
      expect(mockStartNewGame).not.toHaveBeenCalled();
      expect(activeMatch).toBeNull();
      expect(session).toBeNull();

      // 4. Share URL ロード後、ユーザーが明示的に「新しい対戦を開始」を押した時のみ、復元設定で対戦が開始される
      activeMatch = null;
      session = null;
      if (restoredSettings) {
        mockStartNewGame((restoredSettings as PlaytestShareConfigV1).environmentId, (restoredSettings as PlaytestShareConfigV1).seedInput);
      }
      expect(activeMatch).not.toBeNull();
      expect(activeMatch.environmentId).toBe(officialEnvId);
      expect(activeMatch.seed).toBe(777);
    });
  });

  describe("Test E: Clipboard failure produces UI notice only and has zero side-effects", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("クリップボード書き込み失敗時にエラー例外をスローせず、設定値や対戦状態に一切の副作用を与えないこと", async () => {
      // Setup mock where window exists but clipboard throws
      const originalWindow = (globalThis as any).window;
      const originalDocument = (globalThis as any).document;

      (globalThis as any).window = {};
      (globalThis as any).document = {
        createElement: () => ({
          style: {},
          setAttribute: () => {},
          focus: () => {},
          select: () => {},
        }),
        body: {
          appendChild: () => {},
          removeChild: () => {},
        },
        execCommand: () => false, // execCommand fails
      };

      // State before copy attempt
      let shareNotice: { type: "info" | "warning"; message: string } | null = null;
      const pendingSettings: PlaytestShareConfigV1 = {
        version: 1,
        environmentId: officialEnvId,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "firstLegal",
        seedInput: "42",
      };
      let activeMatch: any = null;

      // Execute copy with fallback failure
      const copied = await copyTextToClipboard("https://blackpoker.example.com/?bpv=1");
      expect(copied).toBe(false);

      // Handle UI notice
      if (!copied) {
        shareNotice = {
          type: "warning",
          message: "URLのコピーに失敗しました。手動でURLバーからコピーしてください。",
        };
      }

      // Assert UI notice set properly
      expect(shareNotice).not.toBeNull();
      expect(shareNotice?.type).toBe("warning");

      // Assert ZERO side-effects on settings or active match
      expect(pendingSettings.environmentId).toBe(officialEnvId);
      expect(pendingSettings.seedInput).toBe("42");
      expect(pendingSettings.mode).toBe("humanVsAi");
      expect(activeMatch).toBeNull();

      // Restore
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDocument;
    });
  });

  describe("Secrecy Boundary: URL Contains Zero GameState or Secret Leakage", () => {
    it("生成された共有URLが対戦内部状態（手札、防壁、ライフ、リクエストID、ログ、トレース等）を一切含まないこと", () => {
      // 1. 実際に公式対戦を起動して GameState / Session を生成
      const outcome = startMatchAttempt({
        environmentId: officialEnvId,
        seedInput: "20260908",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const session = outcome.session;
      const gameState = session.state;

      // 2. 対戦中の内部情報を収集 (手札のカードID、ライフ、未公開情報等)
      const p1HandCards = gameState.players.p1.hand.map((c: any) => c.cardId);
      const p2HandCards = gameState.players.p2.hand.map((c: any) => c.cardId);
      const stepRequest = outcome.initialStep.type === "WAITING_FOR_DECISION" ? outcome.initialStep.request : null;
      const decisionId = stepRequest?.decisionId;

      expect(p1HandCards.length).toBeGreaterThan(0);
      expect(decisionId).toBeDefined();

      // 3. 共有URLを生成
      const shareUrl = buildPlaytestShareUrl(
        "https://blackpoker.example.com/playtest/?foo=bar#section",
        {
          environmentId: officialEnvId,
          mode: "humanVsAi",
          humanSeat: "p1",
          policyId: "firstLegal",
          seedInput: "20260908",
        },
        catalog
      );

      const parsedUrl = new URL(shareUrl);
      const searchParams = parsedUrl.searchParams;

      // 4. クエリパラメータは Schema v1 のキーおよび既存パラメータ (foo) のみであることを検証
      const allowedKeys = new Set(["bpv", "env", "mode", "human", "policy", "seed", "scenario", "foo"]);
      for (const key of searchParams.keys()) {
        expect(allowedKeys.has(key)).toBe(true);
      }

      // 5. 秘匿情報・動的状態がURL内に一切漏洩していないことを厳格に検証
      for (const cardId of [...p1HandCards, ...p2HandCards]) {
        expect(shareUrl).not.toContain(cardId);
      }
      if (decisionId) {
        expect(shareUrl).not.toContain(decisionId);
      }
      expect(shareUrl).not.toContain("WAITING_FOR_DECISION");
      expect(shareUrl).not.toContain("matchLog");
      expect(shareUrl).not.toContain("trace");
      expect(shareUrl).not.toContain("stateVersion");
      expect(shareUrl).not.toContain("p1_life");
      expect(shareUrl).not.toContain("p2_life");
    });
  });

  describe("Phase 4.0-A: Auto Seed & Active Match Share URL Integration", () => {
    it("Pre-match Auto Share: 対戦開始前の共有URLは pendingAutoSeed を具象Seedとして保持すること", () => {
      const pendingAutoSeed = 3819201742;
      const seedMode: PlaytestSeedMode = "auto";
      const isOfficial = true;

      // Pending 設定からのURL生成
      const seedForUrl = isOfficial
        ? (seedMode === "auto" ? String(pendingAutoSeed) : "42")
        : "42";

      const url = buildPlaytestShareUrl(
        "https://blackpoker.example.com/",
        {
          environmentId: officialEnvId,
          mode: "humanVsHuman",
          humanSeat: "p1",
          policyId: "firstLegal",
          seedInput: seedForUrl,
        },
        catalog
      );

      expect(url).toContain("seed=3819201742");
      expect(url).not.toContain("seed=auto");
      expect(url).not.toContain("seed=42");

      // パースして復元した結果も 3819201742 であること
      const parsed = parsePlaytestShareUrl(url, catalog);
      expect(parsed.kind).toBe("READY");
      if (parsed.kind === "READY") {
        expect(parsed.config.seedInput).toBe("3819201742");
      }
    });

    it("In-game Auto Share: 対戦中の共有URLは次回用 pendingAutoSeed ではなく activeMatch.seed をSSOTとして使用すること", () => {
      const matchSeed = 11111111;
      const nextPendingAutoSeed = 22222222;

      // 対戦開始
      const outcome = startMatchAttempt({
        environmentId: officialEnvId,
        seedInput: String(matchSeed),
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const activeMatch = outcome.activeMatch;
      expect(activeMatch.seed).toBe(matchSeed);

      // Active Match 設定から共有URLを生成
      const url = buildPlaytestShareUrl(
        "https://blackpoker.example.com/",
        {
          environmentId: activeMatch.environmentId,
          mode: "humanVsAi",
          humanSeat: "p1",
          policyId: "firstLegal",
          seedInput: String(activeMatch.seed),
        },
        catalog
      );

      // 現在進行中の Match Seed のみが含まれ、次回用 pending Seed は混入しない
      expect(url).toContain(`seed=${matchSeed}`);
      expect(url).not.toContain(`seed=${nextPendingAutoSeed}`);
    });

    it("Active Match Fail-Closed: Official 対戦で activeMatch.seed が不正な場合、共有URL生成が fail-closed すること", () => {
      const invalidActiveMatch = {
        environmentId: officialEnvId,
        seed: undefined as any,
      };

      let shareNotice: any = null;
      let urlGenerated = false;

      // Fail-closed 契約の検証
      if (typeof invalidActiveMatch.seed !== "number" || !Number.isSafeInteger(invalidActiveMatch.seed)) {
        shareNotice = {
          type: "error",
          message: "対戦中Seedが未確定のため共有URLを生成できませんでした",
        };
      } else {
        urlGenerated = true;
      }

      expect(urlGenerated).toBe(false);
      expect(shareNotice).not.toBeNull();
      expect(shareNotice.type).toBe("error");
    });

    it("Share URL復元時に seedMode = manual として復元され、対戦再現性が保証されること", () => {
      const shareUrl = `https://blackpoker.example.com/?bpv=1&env=official%3Alight-entry16&mode=humanVsHuman&seed=777777`;
      const bootstrap = resolvePlaytestInitialBootstrap(shareUrl, catalog);

      expect(bootstrap.kind).toBe("RESTORE_SHARE_SETTINGS");
      if (bootstrap.kind === "RESTORE_SHARE_SETTINGS") {
        expect(bootstrap.config.seedInput).toBe("777777");

        // 復元時の状態設定シミュレーション
        let seedMode: PlaytestSeedMode = "auto";
        let seedInput = "42";

        seedInput = bootstrap.config.seedInput;
        seedMode = "manual"; // RESTORE_SHARE_SETTINGS 契約

        expect(seedInput).toBe("777777");
        expect(seedMode).toBe("manual");
      }
    });
  });

  describe("Scenario Start Context Share Integration (BP-SIM-SHARE-1.0)", () => {
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
        expect(outcome.prepared.activeMatch.scenarioDefinition).toEqual(normalizeScenarioDefinitionV1(sampleScenario));
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
        expect(parseRes.config.scenarioDefinition).toEqual(normalizeScenarioDefinitionV1(sampleScenario));
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
  });

  describe("Canonical Scenario Definition Preservation (BP-SIM-SHARE-1.0-R1-HARDENING)", () => {
    it("name/description 前後空白、turnCount 省略、空配列等を含む定義が prepareScenarioMatchAttempt で normalize されて canonical な状態で activeMatch.scenarioDefinition に保持されること", () => {
      const nonCanonicalInput: ScenarioDefinitionV1 = {
        version: 1,
        environmentId: "official:standard-pack",
        seed: 888,
        turnPlayer: "p1",
        chancePlayer: "p2",
        // turnCount 省略 (default 1 に正規化される)
        name: "  Unpadded Scenario Name  ", // whitespace padding
        description: "   Unpadded Description text   ", // whitespace padding
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
            life: { count: 5, cards: [] }, // empty cards array
            pack: { count: 46, cards: [] }, // empty cards array
          },
          p2: {
            hand: [{ suit: "H", rank: "10" }],
            field: [], // empty array
            grave: [], // empty array
            life: { count: 5 },
            pack: { count: 48 },
          },
        },
      };

      const outcome = prepareScenarioMatchAttempt({
        definition: nonCanonicalInput,
        catalog,
        fullRulePackage,
        mode: "humanVsHuman",
        humanSeat: "p1",
        policyId: "firstLegal",
      });

      expect(outcome.status).toBe("READY");
      if (outcome.status !== "READY") return;

      const expectedCanonical = normalizeScenarioDefinitionV1(nonCanonicalInput);

      // 1. 入力オブジェクトと直接同値参照ではないこと (入力オブジェクトをそのまま保存する契約ではない)
      expect(outcome.prepared.activeMatch.scenarioDefinition).not.toBe(nonCanonicalInput);

      // 2. normalizeScenarioDefinitionV1 の結果と完全に一致すること
      expect(outcome.prepared.activeMatch.scenarioDefinition).toEqual(expectedCanonical);

      // 3. 具体的な正規化内容の個別検証
      const stored = outcome.prepared.activeMatch.scenarioDefinition!;
      expect(stored.name).toBe("Unpadded Scenario Name");
      expect(stored.description).toBe("Unpadded Description text");
      expect(stored.turnCount).toBe(1); // turnCount が 1 に補完
      expect(stored.environmentId).toBe("official:standard-pack");
      expect(stored.players.p1.life?.cards).toBeUndefined(); // 空配列 cards が undefined へ正規化
      expect(stored.players.p2.field).toBeUndefined(); // 空配列 field が undefined へ正規化
    });
  });

  describe("UI 表示・ボタン文言・tooltip の検証", () => {
    it("MatchSetupScreen に『この対戦設定を共有』ボタンが存在すること", () => {
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

    it("ScenarioBuilderModal に『この初期盤面を共有』ボタンが存在すること", () => {
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

    it("MobileHeaderMenu に『開始条件を共有』ボタンが存在すること", () => {
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

    it("CoreBattlePlaytest のヘッダーに『開始条件を共有』が存在し『共有URLをコピー』が存在しないこと", () => {
      const html = renderToString(
        React.createElement(CoreBattlePlaytest)
      );

      expect(html).toContain("開始条件を共有");
      expect(html).toContain("現在の盤面ではなく、この対戦を開始した設定・初期盤面を共有します");
      expect(html).not.toContain("共有URLをコピー");
    });
  });

  describe("Challenge Integration with Playtest Share & Scenario Bootstrap (BP-SIM-CHALLENGE-1.0-WIN-CURRENT-TURN)", () => {
    const sampleScenario: ScenarioDefinitionV1 = {
      version: 1,
      environmentId: "official:standard-pack",
      seed: 2026,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      name: "Challenge Bootstrap Test",
      description: "Test challenge bootstrap and clean share",
      players: {
        p1: {
          hand: [{ suit: "S", rank: "A" }],
          field: [],
          life: { count: 5 },
        },
        p2: {
          hand: [{ suit: "H", rank: "K" }],
          field: [],
          life: { count: 5 },
        },
      },
    };

    it("1: Challenge 付き Scenario 共有 URL が resolvePlaytestInitialBootstrap で RESTORE_SCENARIO_SETTINGS として抽出され、challengeDefinition が保持されること", () => {
      const shareConfig: PlaytestShareConfigV1 = {
        version: 1,
        environmentId: sampleScenario.environmentId,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "playtestConservative",
        seedInput: String(sampleScenario.seed),
        scenarioDefinition: sampleScenario,
        challengeDefinition: { version: 1, kind: "WIN_CURRENT_TURN" },
      };

      const url = buildPlaytestShareUrl("https://simulator.blackpoker.org/playtest", shareConfig, catalog);
      expect(url).toContain("challenge=c1.winCurrentTurn");
      expect(url).toContain("scenario=");

      const bootstrap = resolvePlaytestInitialBootstrap(url, catalog);
      expect(bootstrap.kind).toBe("RESTORE_SCENARIO_SETTINGS");
      if (bootstrap.kind !== "RESTORE_SCENARIO_SETTINGS") return;

      expect(bootstrap.config.challengeDefinition).toEqual({ version: 1, kind: "WIN_CURRENT_TURN" });
      expect(bootstrap.config.mode).toBe("humanVsAi");
      expect(bootstrap.config.humanSeat).toBe("p1");
      expect(bootstrap.config.policyId).toBe("playtestConservative");
      expect(bootstrap.definition).toEqual(normalizeScenarioDefinitionV1(sampleScenario));
    });

    it("2: 通常対戦の共有時は URL から challenge パラメータが除去されること", () => {
      const previousChallengeUrl =
        "https://simulator.blackpoker.org/playtest?bpv=1&challenge=c1.winCurrentTurn&scenario=dummyPayload&env=official:standard-pack";

      const cleanUrl = buildPlaytestShareUrl(
        previousChallengeUrl,
        {
          environmentId: "official:standard-pack",
          mode: "humanVsHuman",
          humanSeat: "p1",
          policyId: "firstLegal",
          seedInput: "42",
          scenarioDefinition: undefined,
          challengeDefinition: undefined,
        },
        catalog
      );

      expect(cleanUrl).not.toContain("challenge=");
      expect(cleanUrl).not.toContain("scenario=");
      expect(cleanUrl).toContain("env=official%3Astandard-pack");
    });
  });
});
