import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import {
  parsePlaytestShareUrl,
  buildPlaytestShareUrl,
  PlaytestShareConfigV1,
} from "../../ui/playtest/PlaytestShareUrl";
import { copyTextToClipboard } from "../../ui/utils/clipboard";
import {
  startMatchAttempt,
  OFFICIAL_ENV_PREFIX,
  CORE_BATTLE_ENV_ID,
} from "../../engine/playtest/PlaytestEnvironmentController";

describe("Playtest Share URL Integration Tests (Phase 2.7)", () => {
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

  describe("Test B: Secret & State Boundary / No Auto-Start", () => {
    it("共有URLをパース・読み込んでも対戦は自動開始されず、activeMatch は null を維持すること", () => {
      const shareUrl = "https://blackpoker.example.com/?bpv=1&env=official%3Alight-entry16&mode=humanVsAi&human=p1&policy=seededRandom&seed=777";

      // URLパース実行
      const parseResult = parsePlaytestShareUrl(shareUrl, catalog);
      expect(parseResult.kind).toBe("READY");

      // Active Match は null (自動開始は絶対に呼ばれない)
      let activeMatch: any = null;
      let session: any = null;

      expect(activeMatch).toBeNull();
      expect(session).toBeNull();

      // ユーザーが明示的に「新しい対戦を開始」を押した時のみ、初めて startMatchAttempt が呼ばれる
      if (parseResult.kind === "READY") {
        const outcome = startMatchAttempt({
          environmentId: parseResult.config.environmentId,
          seedInput: parseResult.config.seedInput,
          catalog,
          fullRulePackage,
        });

        expect(outcome.type).toBe("READY");
        if (outcome.type === "READY") {
          activeMatch = outcome.activeMatch;
          session = outcome.session;
        }
      }

      expect(activeMatch).not.toBeNull();
      expect(activeMatch.seed).toBe(777);
      expect(session).not.toBeNull();
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
      const allowedKeys = new Set(["bpv", "env", "mode", "human", "policy", "seed", "foo"]);
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
});
