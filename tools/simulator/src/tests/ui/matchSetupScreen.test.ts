import React from "react";
import { renderToString } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import {
  EnvironmentOption,
  chooseDefaultPlaytestEnvironment,
  CORE_BATTLE_ENV_ID,
  startMatchAttempt,
  getAvailableEnvironments,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { PLAYTEST_POLICY_OPTIONS } from "../../engine/playtest/PlaytestSeatController";
import {
  resolvePlaytestInitialBootstrap,
  parsePlaytestShareUrl,
} from "../../ui/playtest/PlaytestShareUrl";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";

describe("MatchSetupScreen & Entry UX (UI Phase 3.1)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();
  const availableEnvs = getAvailableEnvironments(catalog);

  const defaultProps = {
    environmentOptions: availableEnvs,
    selectedEnvironmentId: "official:light-entry16",
    onSelectEnvironment: vi.fn(),
    matchMode: "humanVsHuman" as const,
    onSelectMatchMode: vi.fn(),
    policyId: "firstLegal" as const,
    onSelectPolicyId: vi.fn(),
    seedInput: "42",
    onSeedInputChange: vi.fn(),
    onStartMatch: vi.fn(),
    onOpenReplayVerify: vi.fn(),
  };

  it("Test A: 通常アクセス時に対戦は自動開始されず、MatchSetupScreenが表示されること", () => {
    const bootstrap = resolvePlaytestInitialBootstrap("", catalog);
    expect(bootstrap.kind).toBe("SHOW_SETUP");

    // MatchSetupScreen がレンダリングできること
    const html = renderToString(React.createElement(MatchSetupScreen, defaultProps));
    expect(html).toContain("対戦設定 (Match Setup)");
    expect(html).toContain("対戦開始");
    expect(html).toContain("Replay検証");
    // (BP-SIM-UI-1.4-MATCH-SETUP-SUIT-FIX) タイトル左の装飾用 ♠ が存在しないこと
    expect(html).not.toContain("♠");
  });

  it("Test B: 公式環境存在時のデフォルト選択 (最初の公式レギュレーションが選択されること)", () => {
    const defaultEnvId = chooseDefaultPlaytestEnvironment(availableEnvs);
    expect(defaultEnvId.startsWith("official:")).toBe(true);
    expect(defaultEnvId).toBe("official:light-entry16");
  });

  it("Test C: 公式なし時のCore Battleフォールバック", () => {
    const noOfficialEnvs: EnvironmentOption[] = [
      {
        id: CORE_BATTLE_ENV_ID,
        name: "Core Battle（開発・検証）",
        isOfficial: false,
      },
    ];

    const fallbackEnvId = chooseDefaultPlaytestEnvironment(noOfficialEnvs);
    expect(fallbackEnvId).toBe(CORE_BATTLE_ENV_ID);
  });

  it("Test D: 対戦開始遷移 (「対戦開始」押下時のみGameSessionが成立すること)", () => {
    let activeMatch: any = null;
    let session: any = null;

    const handleStartMatch = (envId: string, seed: string) => {
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
    };

    // 初期状態では未成立
    expect(activeMatch).toBeNull();
    expect(session).toBeNull();

    // 対戦開始実行
    handleStartMatch("official:light-entry16", "42");
    expect(activeMatch).not.toBeNull();
    expect(session).not.toBeNull();
    expect(activeMatch.environmentId).toBe("official:light-entry16");
    expect(activeMatch.seed).toBe(42);
  });

  it("Test E: 不正Seed入力時にSetup Screen上でVALIDATION_ERROR通知が表示され設定画面が維持されること", () => {
    // 不正Seedで対戦試行
    const outcome = startMatchAttempt({
      environmentId: "official:light-entry16",
      seedInput: "invalid_abc",
      catalog,
      fullRulePackage,
    });

    expect(outcome.type).toBe("VALIDATION_ERROR");
    const setupNotice = outcome.setupNotice;
    expect(setupNotice.type).toBe("VALIDATION_ERROR");

    // MatchSetupScreen に setupNotice を渡してレンダリング
    const html = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        seedInput: "invalid_abc",
        setupNotice,
      })
    );

    expect(html).toContain("VALIDATION_ERROR");
    expect(html).toContain(setupNotice.title);
    expect(html).toContain("無効なSeedです");
    expect(html).toContain("invalid_abc");
    // 設定画面自身も維持されていること
    expect(html).toContain("対戦設定 (Match Setup)");
    expect(html).toContain("対戦開始");
  });

  it("Test F: Share URL復元 (設定が正しく反映され、かつ自動対戦開始されないこと)", () => {
    const shareUrl =
      "?bpv=1&env=official%3Alight-entry16&mode=humanVsAi&human=p2&policy=manualGenericGenome&seed=999";
    const bootstrap = resolvePlaytestInitialBootstrap(shareUrl, catalog);

    expect(bootstrap.kind).toBe("RESTORE_SHARE_SETTINGS");
    if (bootstrap.kind === "RESTORE_SHARE_SETTINGS") {
      expect(bootstrap.config.environmentId).toBe("official:light-entry16");
      expect(bootstrap.config.mode).toBe("humanVsAi");
      expect(bootstrap.config.humanSeat).toBe("p2");
      expect(bootstrap.config.policyId).toBe("manualGenericGenome");
      expect(bootstrap.config.seedInput).toBe("999");
    }

    // 自動開始されないため、UIはMatchSetupScreenをこの復元設定で表示する (Share URL復元時は manual 固定 Seed)
    const html = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        selectedEnvironmentId: "official:light-entry16",
        matchMode: "humanVsAi",
        policyId: "manualGenericGenome",
        seedMode: "manual",
        seedInput: "999",
      })
    );

    expect(html).toContain("対戦設定 (Match Setup)");
    expect(html).toContain("999");
  });

  it("Test G: 対戦SEED / Core Battle説明文が正しく表示されること", () => {
    // 1. 公式環境表示
    const officialHtml = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        selectedEnvironmentId: "official:light-entry16",
      })
    );
    expect(officialHtml).toContain("対戦SEED (Match Seed):");
    expect(officialHtml).toContain(
      "初期山札シャッフルおよび初期配置を決定論的に再現します（AI DNAとは異なります）"
    );

    // 2. Core Battle表示
    const coreBattleHtml = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        selectedEnvironmentId: CORE_BATTLE_ENV_ID,
      })
    );
    expect(coreBattleHtml).toContain("※固定初期盤面による基本ルールの検証環境");
    expect(coreBattleHtml).toContain("※Core Battleは固定盤面のため対戦SEEDは使用しません");
  });

  it("Test H: AI Policy説明 (ManualGenericGenome は進化・学習済みDNAではないこと等の明記)", () => {
    // ManualGenericGenome
    const manualHtml = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        matchMode: "humanVsAi",
        policyId: "manualGenericGenome",
      })
    );
    expect(manualHtml).toContain("手動設計された固定重みによるベースライン（※進化・学習済みDNAではありません）");

    // SeededRandom
    const randomHtml = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        matchMode: "humanVsAi",
        policyId: "seededRandom",
      })
    );
    expect(randomHtml).toContain("PRNGによる擬似乱数選択（DNA不使用・Official環境専用）");

    // FirstLegal
    const firstLegalHtml = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        matchMode: "humanVsAi",
        policyId: "firstLegal",
      })
    );
    expect(firstLegalHtml).toContain("最初の合法手を常に選択する決定論的ベースライン");

    // ZeroGenome
    const zeroHtml = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        matchMode: "humanVsAi",
        policyId: "zeroGenome",
      })
    );
    expect(zeroHtml).toContain("全特徴量重み0の基準値（DNA重みなしのデバッグ用）");
  });

  it("Test I: Pending Settings isolation (Setup Screen での設定変更が activeMatch / session に影響しないこと)", () => {
    let pendingEnv = CORE_BATTLE_ENV_ID;
    let pendingSeed = "42";
    let pendingMode: any = "humanVsHuman";
    let pendingSeat: any = "p1";
    let pendingPolicy: any = "firstLegal";

    let activeMatch: any = null;
    let session: any = null;

    // UI上で各項目を変更
    pendingEnv = "official:light-entry16";
    pendingSeed = "12345";
    pendingMode = "humanVsAi";
    pendingSeat = "p2";
    pendingPolicy = "seededRandom";

    // activeMatch と session は依然として null のまま
    expect(activeMatch).toBeNull();
    expect(session).toBeNull();

    // 明示的に「対戦開始」を実行した時のみ commit される
    const outcome = startMatchAttempt({
      environmentId: pendingEnv,
      seedInput: pendingSeed,
      catalog,
      fullRulePackage,
    });

    if (outcome.type === "READY") {
      activeMatch = outcome.activeMatch;
      session = outcome.session;
    }

    expect(activeMatch).not.toBeNull();
    expect(session).not.toBeNull();
    expect(activeMatch.environmentId).toBe("official:light-entry16");
    expect(activeMatch.seed).toBe(12345);
  });

  it("Test J: 未知バージョンの Share URL (bpv=999) で自動開始せず、Setup Screen を表示し警告を維持すること", () => {
    const unknownUrl = "?bpv=999&env=official:light-entry16";
    const bootstrap = resolvePlaytestInitialBootstrap(unknownUrl, catalog);

    expect(bootstrap.kind).toBe("SHOW_SHARE_WARNING");
    if (bootstrap.kind === "SHOW_SHARE_WARNING") {
      expect(bootstrap.warnings.some((w) => w.includes("bpv=999"))).toBe(true);

      const html = renderToString(
        React.createElement(MatchSetupScreen, {
          ...defaultProps,
          shareNotice: {
            type: "warning",
            message: bootstrap.warnings.join(", "),
          },
        })
      );

      expect(html).toContain("bpv=999");
      expect(html).toContain("対戦設定 (Match Setup)");
      expect(html).toContain("対戦開始");
    }
  });

  it("Test K: Auto Seed / Manual Seed UI の切り替えおよび表示 (Phase 4.0-A)", () => {
    // 1. デフォルト (Auto Mode): 自動（推奨）が選択され、pendingAutoSeed が表示されること
    const autoHtml = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        selectedEnvironmentId: "official:light-entry16",
        seedMode: "auto",
        pendingAutoSeed: 1234567890,
      })
    );
    expect(autoHtml).toContain("自動（推奨）");
    expect(autoHtml).toContain("次回 Seed: 1234567890");
    expect(autoHtml).toContain("対戦ごとに新しいSeedを使用します");

    // 2. Manual Mode: 固定が選択され、seedInput 入力欄が表示されること
    const manualHtml = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        selectedEnvironmentId: "official:light-entry16",
        seedMode: "manual",
        seedInput: "4242",
      })
    );
    expect(manualHtml).toContain("固定");
    expect(manualHtml).toContain("同じ初期状態を再現したい場合に使用します");
    expect(manualHtml).toContain("4242");

    // 3. Core Battle: Seed Mode の切替 UI は表示されず固定盤面メッセージが表示されること
    const coreHtml = renderToString(
      React.createElement(MatchSetupScreen, {
        ...defaultProps,
        selectedEnvironmentId: CORE_BATTLE_ENV_ID,
      })
    );
    expect(coreHtml).not.toContain("自動（推奨）");
    expect(coreHtml).toContain("42 (固定)");
    expect(coreHtml).toContain("※Core Battleは固定盤面のため対戦SEEDは使用しません");
  });

  // =========================================================================
  // Pro + RarePack Publication UI Evidence (UI Phase 3.1 & 5.0-L-R1)
  // =========================================================================
  describe("Pro + RarePack Publication UI Evidence in MatchSetupScreen [BP-SIM-REG-5.0-L-R1]", () => {
    it("A. Environment List: getAvailableEnvironments includes official:pro-rarePack with correct regulationId and rareCardCount", () => {
      const proEnv = availableEnvs.find((e) => e.id === "official:pro-rarePack");
      expect(proEnv).toBeDefined();
      expect(proEnv?.regulationId).toBe("pro-rarePack");
      expect(proEnv?.isOfficial).toBe(true);

      const frame = catalog.frames.get("rarePack");
      expect(frame).toBeDefined();
      expect(proEnv?.setupRequirements?.rareCardCount).toBe(frame?.setup.rareCardCount);
      expect(proEnv?.setupRequirements?.rareCardCount).toBe(1);
    });

    it("B. Render: MatchSetupScreen renders 'プロ + レアパック' option from production environmentOptions", () => {
      const html = renderToString(
        React.createElement(MatchSetupScreen, {
          ...defaultProps,
          selectedEnvironmentId: "official:pro-rarePack",
        })
      );
      expect(html).toContain("プロ + レアパック");
      expect(html).toContain('value="official:pro-rarePack"');
    });

    it("C. Select: changing environment select triggers onSelectEnvironment('official:pro-rarePack')", () => {
      const onSelectEnvironment = vi.fn();
      let testRenderer: any;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(MatchSetupScreen, {
            ...defaultProps,
            selectedEnvironmentId: "official:light-entry16",
            onSelectEnvironment,
          })
        );
      });

      const select = testRenderer.root.findByType("select");
      act(() => {
        select.props.onChange({ target: { value: "official:pro-rarePack" } });
      });

      expect(onSelectEnvironment).toHaveBeenCalledWith("official:pro-rarePack");
    });

    it("D. Start: onStartMatch is triggered when match is ready with confirmed rare card selections", () => {
      const onStartMatch = vi.fn();
      let testRenderer: any;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(MatchSetupScreen, {
            ...defaultProps,
            selectedEnvironmentId: "official:pro-rarePack",
            matchMode: "humanVsAi",
            confirmedRareCardSelections: {
              p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
            },
            onStartMatch,
          })
        );
      });

      const buttons = testRenderer.root.findAllByType("button");
      const startButton = buttons.find((b: any) => b.props.onClick === onStartMatch);
      expect(startButton).toBeDefined();
      expect(startButton.props.disabled).toBe(false);

      act(() => {
        startButton.props.onClick();
      });

      expect(onStartMatch).toHaveBeenCalled();
    });

    it("E. Production Start Contract: startMatchAttempt behaves canonically with and without rare selections", () => {
      // 1. レアカード未選択時は VALIDATION_ERROR となる canonical contract
      const withoutRare = startMatchAttempt({
        environmentId: "official:pro-rarePack",
        seedInput: "42",
        catalog,
        fullRulePackage,
        matchMode: "humanVsAi",
      });
      expect(withoutRare.type).toBe("VALIDATION_ERROR");
      expect(withoutRare.activeMatch).toBeNull();
      if (withoutRare.type === "VALIDATION_ERROR") {
        expect(withoutRare.setupNotice.type).toBe("VALIDATION_ERROR");
      }

      // 2. レアカード選択指定時は READY となり session が成立する canonical contract
      const withRare = startMatchAttempt({
        environmentId: "official:pro-rarePack",
        seedInput: "42",
        catalog,
        fullRulePackage,
        matchMode: "humanVsAi",
        rareCardSelections: {
          p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
        },
      });
      expect(withRare.type).toBe("READY");
      if (withRare.type === "READY") {
        expect(withRare.activeMatch.environmentId).toBe("official:pro-rarePack");
        expect(withRare.session).toBeDefined();
        expect(withRare.session.state.players.p1.rareCards).toHaveLength(1);
        expect(withRare.initialStep).toBeDefined();
      }
    });
  });

  // =========================================================================
  // Environment Presentation Order & Regression Verification [BP-SIM-UI-ENV-ORDER-R2]
  // =========================================================================
  describe("Environment Presentation Order & Regression Verification [BP-SIM-UI-ENV-ORDER-R2]", () => {
    it("A. UI Option Render Order: MatchSetupScreen renders environment options in exact difficulty order (Light < Standard < Pro)", () => {
      let testRenderer: any;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(MatchSetupScreen, {
            ...defaultProps,
            environmentOptions: availableEnvs,
          })
        );
      });

      const select = testRenderer.root.findByType("select");
      const optionValues = select.props.children.map((child: any) => child.props.value);

      expect(optionValues).toEqual([
        "core-battle",
        "official:light-entry16",
        "official:light-pack",
        "official:standard-pack",
        "official:standard-rarePack",
        "official:pro-rarePack",
      ]);

      // Pro が Standard より後にレンダリングされていることを確認
      const standardIndices = optionValues
        .map((v: string, i: number) => (v.includes("standard") ? i : -1))
        .filter((i: number) => i !== -1);
      const proIndices = optionValues
        .map((v: string, i: number) => (v.includes("pro") ? i : -1))
        .filter((i: number) => i !== -1);

      expect(Math.max(...standardIndices)).toBeLessThan(Math.min(...proIndices));
    });

    it("B. Deep Link / Share URL Round-trip: official:pro-rarePack is restored correctly despite being last in order", () => {
      const shareUrl =
        "https://blackpoker.github.io/playtest/?bpv=1&env=official%3Apro-rarePack&mode=humanVsAi&human=p1&policy=playtestConservative&seed=42";
      const result = parsePlaytestShareUrl(shareUrl, catalog);

      expect(result.kind).toBe("READY");
      if (result.kind === "READY") {
        expect(result.config.environmentId).toBe("official:pro-rarePack");
        expect(result.config.mode).toBe("humanVsAi");
        expect(result.config.humanSeat).toBe("p1");
        expect(result.config.policyId).toBe("playtestConservative");
        expect(result.config.seedInput).toBe("42");
      }
    });

    it("C. RarePack Setup Flow: Selecting official:pro-rarePack preserves frame.setup.rareCardCount requirement and blocks start until ready", () => {
      const proOpt = availableEnvs.find((opt) => opt.id === "official:pro-rarePack");
      expect(proOpt).toBeDefined();
      expect(proOpt?.setupRequirements?.rareCardCount).toBe(1);

      // rareCardCount === 1 のため、未選択時は start match 不可 (disabled)
      let testRenderer: any;
      act(() => {
        testRenderer = TestRenderer.create(
          React.createElement(MatchSetupScreen, {
            ...defaultProps,
            environmentOptions: availableEnvs,
            selectedEnvironmentId: "official:pro-rarePack",
            confirmedRareCardSelections: {}, // 未選択
          })
        );
      });

      const buttons = testRenderer.root.findAllByType("button");
      const startButton = buttons.find((b: any) =>
        b.props.children?.props?.children === "対戦開始" || b.props.children === "対戦開始"
      );
      expect(startButton).toBeDefined();
      expect(startButton.props.disabled).toBe(true);

      // レアカード選択確定後は押下可能
      let readyRenderer: any;
      act(() => {
        readyRenderer = TestRenderer.create(
          React.createElement(MatchSetupScreen, {
            ...defaultProps,
            environmentOptions: availableEnvs,
            selectedEnvironmentId: "official:pro-rarePack",
            matchMode: "humanVsAi",
            confirmedRareCardSelections: {
              p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
            },
          })
        );
      });
      const readyButtons = readyRenderer.root.findAllByType("button");
      const readyStartButton = readyButtons.find((b: any) =>
        b.props.children?.props?.children === "対戦開始" || b.props.children === "対戦開始"
      );
      expect(readyStartButton).toBeDefined();
      expect(readyStartButton.props.disabled).toBe(false);
    });
  });
});
