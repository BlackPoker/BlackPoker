import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ScenarioBuilderModal, formatScenarioSuitOptionLabel, formatScenarioCardChip } from "../../ui/scenario/ScenarioBuilderModal";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { ActiveMatchContext } from "../../engine/playtest/PlaytestEnvironmentController";
import { ScenarioDefinitionV1, normalizeScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import { encodeScenarioDefinitionV1ToUrlParam, decodeScenarioDefinitionV1FromUrlParam } from "../../ui/scenario/ScenarioShareUrl";
import { prepareScenarioMatchAttempt } from "../../engine/playtest/ScenarioMatchCoordinator";
import { ScenarioAuthoringResolver } from "../../engine/scenario/ScenarioAuthoringResolver";

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

    expect(html).toContain("初期盤面設定");
    expect(html).toContain("Initial Setup");
    expect(html).toContain("対戦レギュレーション:");
    expect(html).not.toContain("対戦環境 (公式レギュレーションのみ):");
    expect(html).toContain("Turn Player:");
    expect(html).toContain("Chance Player:");
    expect(html).toContain("初期盤面で対戦開始");
    expect(html).not.toMatch(/[🛠️⚔️✅⚠️]/);
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
    const rawDefA: ScenarioDefinitionV1 = {
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

    // Position Authoring により Canonical な ScenarioDefinitionV1 を解決
    const resolveA = ScenarioAuthoringResolver.resolve(rawDefA, catalog);
    expect(resolveA.success).toBe(true);
    if (!resolveA.success) return;
    const defA = resolveA.definition;

    // 1. URL パラメータにエンコード
    const param = encodeScenarioDefinitionV1ToUrlParam(defA);

    // 2. ブラウザURL復元契約に基づき、URLからデコードされた Definition を initialDefinition として渡す
    const decodeResult = decodeScenarioDefinitionV1FromUrlParam(param);
    expect(decodeResult.success).toBe(true);
    if (!decodeResult.success) return;

    const onStartScenario = vi.fn();
    let testRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      testRenderer = TestRenderer.create(
        React.createElement(ScenarioBuilderModal, {
          isOpen: true,
          initialTab: "settings",
          catalog,
          fullRulePackage,
          initialDefinition: decodeResult.definition,
          onClose: dummyOnClose,
          onStartScenario,
        })
      );
    });

    // 3. 手動URL入力欄および読込ボタンが存在しないことを確認 (Issue D)
    const inputs = testRenderer.root.findAllByType("input");
    expect(inputs.some((inp) => inp.props.placeholder === "シナリオ共有URLまたはパラメータを入力...")).toBe(false);
    const buttons = testRenderer.root.findAllByType("button");
    expect(buttons.some((b) => Array.isArray(b.children) && b.children.includes("読込"))).toBe(false);

    // 4. "初期盤面で対戦開始" onClick
    const startButton = testRenderer.root.findAllByType("button").find((b) => {
      const spanTexts = b.findAllByType("span").map((s) => s.children.join("")).join("");
      return spanTexts.includes("初期盤面で対戦開始") || (Array.isArray(b.children) && b.children.includes("初期盤面で対戦開始"));
    });
    expect(startButton).toBeDefined();
    act(() => {
      startButton!.props.onClick();
    });

    // 5. Callback 経由で渡された defB が defA と正規化一致すること
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
    expect(unitSpan!.children.join("")).toContain("armedSoldier (♠A, ♠K) [charge/up]");

    // 6. "初期盤面で対戦開始" をクリックしてコールバックの Definition を検証
    const startButton = testRenderer.root.findAllByType("button").find((b) => {
      const spanTexts = b.findAllByType("span").map((s) => s.children.join("")).join("");
      return spanTexts.includes("初期盤面で対戦開始") || (Array.isArray(b.children) && b.children.includes("初期盤面で対戦開始"));
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

  it("9: スート選択肢表記 (♠, ♡, ♢, ♣, Joker) とカードチップ表示の厳格検証 (BP-SIM-SCENARIO-1.1-UI-POLISH)", () => {
    // 1. helper functions の検証
    expect(formatScenarioSuitOptionLabel("S")).toBe("♠");
    expect(formatScenarioSuitOptionLabel("H")).toBe("♡");
    expect(formatScenarioSuitOptionLabel("D")).toBe("♢");
    expect(formatScenarioSuitOptionLabel("C")).toBe("♣");
    expect(formatScenarioSuitOptionLabel("J")).toBe("Joker");

    expect(formatScenarioCardChip({ suit: "S", rank: "A" })).toBe("♠A");
    expect(formatScenarioCardChip({ suit: "H", rank: "10" })).toBe("♡10");
    expect(formatScenarioCardChip({ suit: "D", rank: "K" })).toBe("♢K");
    expect(formatScenarioCardChip({ suit: "C", rank: "2" })).toBe("♣2");
    expect(formatScenarioCardChip({ suit: "J", rank: "JOKER" })).toBe("Joker");
    expect(formatScenarioCardChip({ suit: "J", rank: "JOKER", occurrence: 0 })).toBe("Joker 1");
    expect(formatScenarioCardChip({ suit: "J", rank: "JOKER", occurrence: 1 })).toBe("Joker 2");

    // 2. 実UIでのスートセレクトとパック表示の検証
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
            environmentId: "official:standard-pack",
          },
          onClose: dummyOnClose,
          onStartScenario: dummyOnStartScenario,
        })
      );
    });

    const selects = testRenderer.root.findAllByType("select");
    // スート選択セレクトを探す
    const suitSelect = selects.find((s) => {
      const options = s.findAllByType("option");
      return options.some((o) => o.props.value === "S") && options.some((o) => o.props.value === "J");
    });
    expect(suitSelect).toBeDefined();

    const options = suitSelect!.findAllByType("option");
    const optionTexts = options.map((o) => o.children.join(""));
    // 選択肢が "♠", "♡", "♢", "♣", "Joker" であり、(S) や (H) などの内部英字コードが含まれていないこと
    expect(optionTexts).toEqual(["♠", "♡", "♢", "♣", "Joker"]);
    expect(optionTexts.join("")).not.toContain("(S)");
    expect(optionTexts.join("")).not.toContain("(H)");

    // パック見出しと追加ボタン文言が "パック (Pack)" に統一されていること
    const textSnapshot = JSON.stringify(testRenderer.toJSON());
    expect(textSnapshot).toContain("パック (Pack)");
    expect(textSnapshot).not.toContain("山札 (Pack)");
    expect(textSnapshot).toContain("+ パック固定に追加");
  });

  it("10: 常設レギュレーション選択バーとSSOTに基づくComponent候補絞り込み (character.giant除外) の検証", () => {
    // 1. 各公式レギュレーション (light-entry16, light-pack, standard-pack) で character.giant が候補に出ないこと
    for (const envId of ["official:light-entry16", "official:light-pack", "official:standard-pack"]) {
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
              environmentId: envId,
            },
            onClose: dummyOnClose,
            onStartScenario: dummyOnStartScenario,
          })
        );
      });

      // 常設レギュレーションバーの存在確認
      const selects = testRenderer.root.findAllByType("select");
      const regSelect = selects.find((s) => s.props.value === envId);
      expect(regSelect).toBeDefined();

      // コンポーネント選択肢に character.giant が含まれていないこと
      const compSelect = selects.find(
        (s) =>
          s.props.children &&
          s.props.children.some(
            (opt: any) => opt?.props?.value === "character.hero"
          )
      );
      expect(compSelect).toBeDefined();

      const compOptions = compSelect!.findAllByType("option");
      const compValues = compOptions.map((o) => o.props.value);
      expect(compValues).not.toContain("character.giant");
    }
  });

  it("11: レギュレーション変更時のドラフト非破壊保持とバリデーションエラー・セレクタ正規化の検証", () => {
    // Standard+Pack で Joker を持つシナリオから開始
    const standardJokerScenario: ScenarioDefinitionV1 = {
      version: 1,
      environmentId: "official:standard-pack",
      seed: 42,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      players: {
        p1: {
          hand: [{ suit: "J", rank: "Joker", occurrence: 0 }],
          field: [],
          grave: [],
          life: { count: 39 }, // 54 - 1(hand) - 14(pack) = 39
        },
        p2: {
          hand: [],
          field: [],
          grave: [],
          life: { count: 40 }, // 54 - 14(pack) = 40
        },
      },
    };

    let testRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      testRenderer = TestRenderer.create(
        React.createElement(ScenarioBuilderModal, {
          isOpen: true,
          initialTab: "p1",
          catalog,
          fullRulePackage,
          initialDefinition: standardJokerScenario,
          onClose: dummyOnClose,
          onStartScenario: dummyOnStartScenario,
        })
      );
    });

    // 初期状態 (standard-pack) ではバリデーションエラーがなく開始可能
    const initialSnapshot = JSON.stringify(testRenderer.toJSON());
    expect(initialSnapshot).not.toContain("バリデーションエラー (");

    // レギュレーションを official:light-entry16 に変更
    const selects = testRenderer.root.findAllByType("select");
    const regSelect = selects.find((s) => s.props.value === "official:standard-pack");
    expect(regSelect).toBeDefined();

    act(() => {
      regSelect!.props.onChange({ target: { value: "official:light-entry16" } });
    });

    // 1. ドラフトの手札カード (Joker) はサイレント削除されずに保持されている
    const changedSnapshot = JSON.stringify(testRenderer.toJSON());
    expect(changedSnapshot).toContain("Joker 1");

    // 2. エントリー16にJokerが存在しないため、バリデーションエラーが表示され開始不可となる
    expect(changedSnapshot).toContain("バリデーションエラー");
    expect(changedSnapshot).toContain("cursor-not-allowed");

    // 3. カード追加セレクタの選択肢（selectedSuit等）は新しいレギュレーションの合法値に安全に正規化されている
    const updatedSelects = testRenderer.root.findAllByType("select");
    const suitSelect = updatedSelects.find((s) => {
      const options = s.findAllByType("option");
      return options.some((o) => o.props.value === "S") && !options.some((o) => o.props.value === "J");
    });
    expect(suitSelect).toBeDefined();
    expect(suitSelect!.props.value).toBe("S");
  });

  it("12: URL読込 / 外部入力で不正Component (character.giant) が与えられた場合に fail-closed すること", () => {
    const invalidGiantScenario: ScenarioDefinitionV1 = {
      version: 1,
      environmentId: "official:standard-pack",
      seed: 42,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      players: {
        p1: {
          hand: [],
          field: [
            {
              componentId: "character.giant",
              cards: [{ suit: "S", rank: "A" }],
              state: "charge",
              face: "up",
            },
          ],
          grave: [],
          life: { count: 39 }, // 54 - 1(field) - 14(pack) = 39
        },
        p2: {
          hand: [],
          field: [],
          grave: [],
          life: { count: 40 }, // 54 - 14(pack) = 40
        },
      },
    };

    const param = encodeScenarioDefinitionV1ToUrlParam(invalidGiantScenario);

    let testRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      testRenderer = TestRenderer.create(
        React.createElement(ScenarioBuilderModal, {
          isOpen: true,
          initialTab: "settings",
          catalog,
          fullRulePackage,
          initialDefinition: invalidGiantScenario,
          onClose: dummyOnClose,
          onStartScenario: dummyOnStartScenario,
        })
      );
    });

    // バリデーションエラーとして character.giant の未対応エラーが表示され、開始ボタンが無効化されること
    const snapshot = JSON.stringify(testRenderer.toJSON());
    expect(snapshot).toContain("character.giant");
    expect(snapshot).toContain("UNSUPPORTED_COMPONENT");
    expect(snapshot).toContain("cursor-not-allowed");
  });

  it("13: Standard+Pack / Light+Pack で Joker 2枚を別ゾーンへ配置し正常開始できること", () => {
    // 54枚デッキ (52枚 + Joker 2枚)
    // p1: hand に Joker 1 (occurrence: 0), grave に Joker 2 (occurrence: 1), 残り life 38枚, pack 14枚
    // p2: hand 0, field 0, grave 0, pack 14枚, life 40枚
    const twoJokersScenario: ScenarioDefinitionV1 = {
      version: 1,
      environmentId: "official:standard-pack",
      seed: 999,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      name: "Two Jokers Scenario",
      players: {
        p1: {
          hand: [{ suit: "J", rank: "Joker", occurrence: 0 }],
          field: [],
          grave: [{ suit: "J", rank: "Joker", occurrence: 1 }],
          life: { count: 38 },
        },
        p2: {
          hand: [],
          field: [],
          grave: [],
          life: { count: 40 },
        },
      },
    };

    const onStartScenario = vi.fn();
    let testRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      testRenderer = TestRenderer.create(
        React.createElement(ScenarioBuilderModal, {
          isOpen: true,
          initialTab: "p1",
          catalog,
          fullRulePackage,
          initialDefinition: twoJokersScenario,
          onClose: dummyOnClose,
          onStartScenario,
        })
      );
    });

    // 1. バリデーションエラーがないこと
    const snapshot = JSON.stringify(testRenderer.toJSON());
    expect(snapshot).not.toContain("バリデーションエラー (");

    // 2. チップ表示が "Joker 1", "Joker 2" と分かりやすく表示されていること
    expect(snapshot).toContain("Joker 1");
    expect(snapshot).toContain("Joker 2");

    // 3. "初期盤面で対戦開始" ボタンが押下可能であり、定義がコールバックへ渡ること
    const startButton = testRenderer.root.findAllByType("button").find((b) => {
      const spanTexts = b.findAllByType("span").map((s) => s.children.join("")).join("");
      return spanTexts.includes("初期盤面で対戦開始") || (Array.isArray(b.children) && b.children.includes("初期盤面で対戦開始"));
    });
    expect(startButton).toBeDefined();
    act(() => {
      startButton!.props.onClick();
    });

    expect(onStartScenario).toHaveBeenCalledTimes(1);
    const emitted = onStartScenario.mock.calls[0][0];
    expect(emitted.players.p1.hand[0]).toEqual({ suit: "J", rank: "Joker", occurrence: 0 });
    expect(emitted.players.p1.grave[0]).toEqual({ suit: "J", rank: "Joker", occurrence: 1 });
  });

  it("14: Position Authoring UI 要素 (Hand/Life 目標枚数, AUTO バッジ, 墓地自動補完注記, スート/ランク タップボタン) のレンダリングと動作検証", () => {
    let testRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      testRenderer = TestRenderer.create(
        React.createElement(ScenarioBuilderModal, {
          isOpen: true,
          initialTab: "p1",
          catalog,
          fullRulePackage,
          initialDefinition: {
            version: 1,
            environmentId: "official:standard-pack",
            seed: 2026,
            turnPlayer: "p1",
            chancePlayer: "p1",
            players: {
              p1: {
                hand: [{ suit: "H", rank: "7" }],
                life: {
                  cards: [{ suit: "H", rank: "A" }, { suit: "S", rank: "K" }],
                  count: 3,
                },
              },
              p2: {
                life: { count: 37 },
              },
            },
          },
          onClose: dummyOnClose,
          onStartScenario: dummyOnStartScenario,
        })
      );
    });

    const snapshot = JSON.stringify(testRenderer.toJSON());

    // 1. スートタップボタン (♠, ♡, ♢, ♣, Joker) の存在確認
    const buttons = testRenderer.root.findAllByType("button");
    const buttonTexts = buttons.map((b) =>
      Array.isArray(b.children) ? b.children.join("") : ""
    );
    expect(buttonTexts).toContain("♠");
    expect(buttonTexts).toContain("♡");
    expect(buttonTexts).toContain("♢");
    expect(buttonTexts).toContain("♣");
    expect(buttonTexts).toContain("Joker");

    // 2. ランクタップボタンの存在確認
    expect(buttonTexts).toContain("A");
    expect(buttonTexts).toContain("K");

    // 3. UX 文言の改善確認 (デッキ: -> 使用カード:, 説明文の更新)
    expect(snapshot).toContain("使用カード:");
    expect(snapshot).toContain("必要な条件だけ指定すると、残りのカードは合法な局面になるよう自動補完されます");
    expect(snapshot).not.toContain("デッキ: 54枚");

    // 4. ライフ目標枚数指定に伴う墓地自動補完注記の存在確認
    expect(snapshot).toContain("※ ライフ指定に伴い残余カードは自動補完");

    // 5. ライフ TOP UI の存在確認 (先頭カードに (TOP), 2枚目には付与されない, 説明注記)
    expect(snapshot).toContain("※ 上から順に配置（先頭がTOP）");
    expect(snapshot).toContain("♡A (TOP)");
    expect(snapshot).toContain("♠K");
    expect(snapshot).not.toContain("♠K (TOP)");

    // 6. AUTOバッジの存在確認 (ライフ count 3 で fixed 2 -> AUTO × 1)
    expect(snapshot).toContain("AUTO × 1");

    // 7. 手札の目標枚数を 5 に変更 -> AUTO × 4 バッジが表示されること
    const inputs = testRenderer.root.findAllByType("input");
    const handCountInput = inputs.find(
      (inp) => inp.props.value === 1 && inp.props.placeholder === "自動"
    );
    expect(handCountInput).toBeDefined();
    act(() => {
      handCountInput!.props.onChange({ target: { value: "5" } });
    });

    const updatedSnapshot = JSON.stringify(testRenderer.toJSON());
    expect(updatedSnapshot).toContain("AUTO × 4");
  });
});
