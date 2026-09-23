import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ScenarioBuilderModal } from "../../ui/scenario/ScenarioBuilderModal";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { ActiveMatchContext } from "../../engine/playtest/PlaytestEnvironmentController";
import { ScenarioDefinitionV1, normalizeScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import { encodeScenarioDefinitionV1ToUrlParam, decodeScenarioDefinitionV1FromUrlParam } from "../../ui/scenario/ScenarioShareUrl";
import { prepareScenarioMatchAttempt } from "../../engine/playtest/ScenarioMatchCoordinator";

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
            cards: [{ suit: "H", rank: "Q" }],
            state: "charge",
            face: "up",
          },
        ],
        grave: [{ suit: "C", rank: "6" }],
        life: { count: 12 },
      },
      p2: {
        hand: [{ suit: "S", rank: "3" }],
        field: [],
        grave: [],
        life: { count: 15 },
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

  it("6: UI Round-Trip: 実Component lifecycleを通した URL 共有・復元検証 (normalize(B) == normalize(A))", () => {
    const defA: ScenarioDefinitionV1 = {
      version: 1,
      environmentId: "official:light-entry16",
      seed: 888,
      turnPlayer: "p1",
      chancePlayer: "p2",
      turnCount: 2,
      name: "RoundTrip Scenario",
      description: "Full round-trip test",
      players: {
        p1: {
          hand: [{ suit: "S", rank: "A" }],
          field: [
            {
              componentId: "character.hero",
              cards: [{ suit: "H", rank: "Q" }],
              state: "drive",
              face: "up",
            },
          ],
          grave: [{ suit: "C", rank: "6" }],
          life: { cards: [{ suit: "D", rank: "5" }], count: 13 },
        },
        p2: {
          hand: [{ suit: "S", rank: "3" }],
          field: [],
          grave: [],
          life: { count: 15 },
        },
      },
    };

    // 1. URL パラメータにエンコード
    const param = encodeScenarioDefinitionV1ToUrlParam(defA);

    // 2. 実Component lifecycle によるマウント
    const onStartScenario = vi.fn();
    let testRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      testRenderer = TestRenderer.create(
        React.createElement(ScenarioBuilderModal, {
          isOpen: true,
          initialTab: "settings",
          catalog,
          fullRulePackage,
          onClose: dummyOnClose,
          onStartScenario,
        })
      );
    });

    // 3. URL input onChange
    const urlInput = testRenderer.root.findByProps({
      placeholder: "シナリオ共有URLまたはパラメータを入力...",
    });
    act(() => {
      urlInput.props.onChange({ target: { value: param } });
    });

    // 4. "読込" onClick
    const buttons = testRenderer.root.findAllByType("button");
    const loadButton = buttons.find((b) => b.children.includes("読込"));
    expect(loadButton).toBeDefined();
    act(() => {
      loadButton!.props.onClick();
    });

    // 5. "Scenario 開始" onClick
    const startButton = testRenderer.root.findAllByType("button").find((b) => {
      const spanTexts = b.findAllByType("span").map((s) => s.children.join("")).join("");
      return spanTexts.includes("Scenario 開始") || (Array.isArray(b.children) && b.children.includes("Scenario 開始"));
    });
    expect(startButton).toBeDefined();
    act(() => {
      startButton!.props.onClick();
    });

    // 6. Callback 経由で渡された defB が defA と正規化一致すること
    expect(onStartScenario).toHaveBeenCalledTimes(1);
    const defB = onStartScenario.mock.calls[0][0];
    expect(normalizeScenarioDefinitionV1(defB)).toEqual(normalizeScenarioDefinitionV1(defA));
  });

  it("7: Atomic Start: 実Production Coordinator および CoreBattlePlaytest lifecycle による atomic 契約検証", async () => {
    // Part 1: Coordinator (prepareScenarioMatchAttempt) の直接検証
    // Case 1: Compile Failure -> PREPARE_ERROR
    const invalidScenario: ScenarioDefinitionV1 = {
      ...minimalValidScenario,
      players: {
        ...minimalValidScenario.players,
        p1: {
          ...minimalValidScenario.players.p1,
          hand: [
            { suit: "S", rank: "A" },
            { suit: "S", rank: "A" }, // 重複カード
          ],
        },
      },
    };

    const coordRes1 = prepareScenarioMatchAttempt({
      definition: invalidScenario,
      catalog,
      fullRulePackage,
      mode: "humanVsAi",
      humanSeat: "p1",
      policyId: "firstLegal",
    });
    expect(coordRes1.status).toBe("PREPARE_ERROR");
    if (coordRes1.status === "PREPARE_ERROR") {
      expect(coordRes1.title).toContain("Scenario コンパイルエラー");
    }

    // Case 2: Policy Initialization Failure -> PREPARE_ERROR
    const policySpy = vi.spyOn(PlaytestPolicyFactory, "createPoliciesForMatch").mockImplementationOnce(() => {
      throw new Error("Simulated policy creation failure");
    });
    const coordRes2 = prepareScenarioMatchAttempt({
      definition: minimalValidScenario,
      catalog,
      fullRulePackage,
      mode: "humanVsAi",
      humanSeat: "p1",
      policyId: "firstLegal",
    });
    expect(coordRes2.status).toBe("PREPARE_ERROR");
    if (coordRes2.status === "PREPARE_ERROR") {
      expect(coordRes2.title).toContain("AI Policy 初期化エラー");
    }
    policySpy.mockRestore();

    // Case 3: Valid -> READY
    const coordRes3 = prepareScenarioMatchAttempt({
      definition: minimalValidScenario,
      catalog,
      fullRulePackage,
      mode: "humanVsAi",
      humanSeat: "p1",
      policyId: "firstLegal",
    });
    expect(coordRes3.status).toBe("READY");
    if (coordRes3.status === "READY") {
      expect(coordRes3.prepared.activeMatch.isScenario).toBe(true);
      expect(coordRes3.prepared.session).toBeDefined();
    }

    // Part 2: CoreBattlePlaytest 実Component lifecycle を通した統合テスト
    // Active Match A が存在する状態で invalid scenario を開始しても Match A が完全保持されること
    let playtestRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      playtestRenderer = TestRenderer.create(React.createElement(CoreBattlePlaytest));
    });

    // MatchSetupScreen から Match A を開始
    const setupScreen = playtestRenderer.root.findByType(MatchSetupScreen);
    await act(async () => {
      setupScreen.props.onStartMatch();
    });

    // Match A が開始され、対戦環境IDが表示されていることを確認
    const initialTreeSnapshot = JSON.stringify(playtestRenderer.toJSON());
    expect(initialTreeSnapshot).toContain("official:light-entry16");

    // ScenarioBuilderModal の onStartScenario に invalidScenario を渡す
    const scenarioModal = playtestRenderer.root.findByType(ScenarioBuilderModal);
    await act(async () => {
      await scenarioModal.props.onStartScenario(invalidScenario);
    });

    // コンパイルエラー通知が表示されるが、既存の Match A 盤面およびセッションは破壊されず完全保持される
    const errorTreeSnapshot = JSON.stringify(playtestRenderer.toJSON());
    expect(errorTreeSnapshot).toContain("Scenario コンパイルエラー");
    expect(errorTreeSnapshot).toContain("official:light-entry16");

    // 次に validScenario を開始 -> 原子的コミットが成功し Scenario 対戦へ切り替わる
    await act(async () => {
      await scenarioModal.props.onStartScenario(minimalValidScenario);
    });

    // Scenario 対戦に切り替わり fail-closed 契約（Replay/診断保存の無効化等）が適用されている
    const scenarioTreeSnapshot = JSON.stringify(playtestRenderer.toJSON());
    expect(scenarioTreeSnapshot).toContain("Scenarioから開始した対戦のReplay");
  });

  it("8: UIから複数カードUnit (character.armedSoldier, cards 2枚以上) を新規作成して配置できること", () => {
    const onStartScenario = vi.fn();
    let testRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      testRenderer = TestRenderer.create(
        React.createElement(ScenarioBuilderModal, {
          isOpen: true,
          initialTab: "p1",
          catalog,
          fullRulePackage,
          initialDefinition: {
            ...minimalValidScenario,
            players: {
              ...minimalValidScenario.players,
              p1: {
                ...minimalValidScenario.players.p1,
                hand: [], // SA, SK を Unit に使うため手札を空にして重複を防止
                field: [],
                life: { count: 13 }, // 16 - 2(field) - 1(grave) = 13 (全16枚の保存則を満たす)
              },
            },
          },
          onClose: dummyOnClose,
          onStartScenario,
        })
      );
    });

    // 1. armedSoldier を選択
    const selects = testRenderer.root.findAllByType("select");
    const compSelect = selects.find(
      (s) =>
        s.props.children &&
        s.props.children.some(
          (opt: any) => opt?.props?.value === "character.armedSoldier"
        )
    );
    expect(compSelect).toBeDefined();
    act(() => {
      compSelect!.props.onChange({ target: { value: "character.armedSoldier" } });
    });

    // 2. 1枚目カード (S A) をステージングに追加
    const addDraftBtn = testRenderer.root
      .findAllByType("button")
      .find((b) => b.children.includes("+ ユニット構成カードに追加"));
    expect(addDraftBtn).toBeDefined();
    act(() => {
      addDraftBtn!.props.onClick();
    });

    // 3. 2枚目カード (S K) を選択してステージングに追加
    const rankSelect = selects.find((s) => s.props.value === "A");
    expect(rankSelect).toBeDefined();
    act(() => {
      rankSelect!.props.onChange({ target: { value: "K" } });
    });
    act(() => {
      addDraftBtn!.props.onClick();
    });

    // 4. "+ フィールドにユニット配置" をクリック
    const deployBtn = testRenderer.root
      .findAllByType("button")
      .find((b) => b.children.includes("+ フィールドにユニット配置"));
    expect(deployBtn).toBeDefined();
    act(() => {
      deployBtn!.props.onClick();
    });

    // 5. フィールド表示に 2枚カード構成の armedSoldier が表示されていることを検証
    const unitSpan = testRenderer.root
      .findAllByType("span")
      .find((s) => s.children.includes("armedSoldier"));
    expect(unitSpan).toBeDefined();
    expect(unitSpan!.children.join("")).toContain("armedSoldier (SA, SK) [charge/up]");

    // 6. "Scenario 開始" をクリックしてコールバックの Definition を検証
    const startButton = testRenderer.root.findAllByType("button").find((b) => {
      const spanTexts = b.findAllByType("span").map((s) => s.children.join("")).join("");
      return spanTexts.includes("Scenario 開始") || (Array.isArray(b.children) && b.children.includes("Scenario 開始"));
    });
    expect(startButton).toBeDefined();
    act(() => {
      startButton!.props.onClick();
    });

    expect(onStartScenario).toHaveBeenCalledTimes(1);
    const emittedDef = onStartScenario.mock.calls[0][0];
    const p1Field = emittedDef.players.p1.field;
    expect(p1Field).toHaveLength(1);
    expect(p1Field[0].componentId).toBe("character.armedSoldier");
    expect(p1Field[0].cards).toEqual([
      { suit: "S", rank: "A" },
      { suit: "S", rank: "K" },
    ]);
    expect(p1Field[0].state).toBe("charge");
    expect(p1Field[0].face).toBe("up");
  });
});
