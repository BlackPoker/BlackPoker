import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { ScenarioBuilderModal } from "../../ui/scenario/ScenarioBuilderModal";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { prepareScenarioMatchAttempt } from "../../engine/playtest/ScenarioMatchCoordinator";
import { getAvailableEnvironments } from "../../engine/playtest/PlaytestEnvironmentController";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";

function extractText(node: any): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node.children) return extractText(node.children);
  return "";
}

describe("ScenarioBuilderModal RarePack Integration [BP-SIM-SCENARIO-RAREPACK-INTEGRATION-R1]", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

  const baseScenarioDef: ScenarioDefinitionV1 = {
    version: 1,
    environmentId: "official:pro-rarePack",
    seed: 42,
    turnPlayer: "p1",
    chancePlayer: "p1",
    turnCount: 1,
    name: "Test Scenario",
    description: "Integration test scenario",
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

  it("1. 対戦環境の並び順が通常対戦画面 (getAvailableEnvironments) と完全一致すること (SSOT)", () => {
    const expectedEnvironments = getAvailableEnvironments(catalog)
      .filter((env) => env.isOfficial && env.id !== "official:core-battle");

    let root: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      root = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
        />
      );
    });

    const select = root!.root.findAllByType("select")[0];
    const options = select.findAllByType("option");

    expect(options.length).toBe(expectedEnvironments.length);
    for (let i = 0; i < expectedEnvironments.length; i++) {
      expect(options[i].props.value).toBe(expectedEnvironments[i].id);
      expect(extractText(options[i])).toBe(`${expectedEnvironments[i].name} (公式)`);
    }
  });

  it("2. 通常対戦画面で pro-rarePack 選択中に初期盤面設定を開いた場合、最初から pro-rarePack が選択されていること", () => {
    let root: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      root = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
          initialEnvironmentId="official:pro-rarePack"
        />
      );
    });

    const select = root!.root.findAllByType("select")[0];
    expect(select.props.value).toBe("official:pro-rarePack");
  });

  it("3. pro-rarePack 選択状態で Rare Card UI が即座に表示され、バッジ・インジケーター・デフォルト選択が有効であること", () => {
    let root: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      root = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
          initialEnvironmentId="official:pro-rarePack"
        />
      );
    });

    // レギュレーションバーにレアカードバッジが表示されていること
    const rareBadge = root!.root.findByProps({ "data-testid": "scenario-builder-rare-badge" });
    expect(rareBadge).toBeDefined();
    expect(extractText(rareBadge)).toContain("レアカード: 1枚");

    // 基本設定タブにレア設定インジケーターが表示されていること
    const tabIndicator = root!.root.findByProps({ "data-testid": "scenario-builder-settings-rare-indicator" });
    expect(tabIndicator).toBeDefined();

    // settings タブ内に RareCardSetupPanel が存在すること
    const rarePanel = root!.root.findByProps({ rareCardCount: 1 });
    expect(rarePanel).toBeDefined();
    expect(rarePanel.props.deckProfile).toBeDefined();
    expect(rarePanel.props.confirmedSelections.p1).toBeDefined();
    expect(rarePanel.props.confirmedSelections.p1[0]).toEqual({ suit: "J", rank: "Joker", occurrence: 0 });
  });

  it("4. 優先順位の検証: initialDefinition.environmentId > initialEnvironmentId > defaultEnvId", () => {
    // Case 4A: initialDefinition.environmentId が指定されている場合はそちらが最優先
    let rootA: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      rootA = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
          initialDefinition={{ ...baseScenarioDef, environmentId: "official:pro-rarePack" }}
          initialEnvironmentId="official:light-entry16"
        />
      );
    });
    const selectA = rootA!.root.findAllByType("select")[0];
    expect(selectA.props.value).toBe("official:pro-rarePack");

    // Case 4B: initialDefinition に environmentId がなく initialEnvironmentId がある場合は initialEnvironmentId
    let rootB: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      rootB = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
          initialEnvironmentId="official:pro-rarePack"
        />
      );
    });
    const selectB = rootB!.root.findAllByType("select")[0];
    expect(selectB.props.value).toBe("official:pro-rarePack");

    // Case 4C: いずれも未指定の場合は defaultEnvId (official:light-entry16)
    let rootC: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      rootC = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
        />
      );
    });
    const selectC = rootC!.root.findAllByType("select")[0];
    expect(selectC.props.value).toBe("official:light-entry16");
  });

  it("5. 無効な environmentId や core-battle が渡された場合でも安全にフォールバックすること", () => {
    // 不正な環境ID
    let rootInvalid: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      rootInvalid = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
          initialEnvironmentId="official:invalid-unknown-env"
        />
      );
    });
    const selectInvalid = rootInvalid!.root.findAllByType("select")[0];
    expect(selectInvalid.props.value).toBe("official:light-entry16");

    // official:core-battle (初期盤面設定では除外対象)
    let rootCoreBattle: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      rootCoreBattle = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
          initialEnvironmentId="official:core-battle"
        />
      );
    });
    const selectCoreBattle = rootCoreBattle!.root.findAllByType("select")[0];
    expect(selectCoreBattle.props.value).toBe("official:light-entry16");
  });

  it("6. 初期盤面設定内で環境を切り替えた場合、Setup Requirements が正しく再評価されること", () => {
    let root: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      root = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
          initialEnvironmentId="official:light-entry16"
        />
      );
    });

    // 初期状態: light-entry16 (rareCardCount === 0)
    expect(root!.root.findAllByProps({ "data-testid": "scenario-builder-rare-badge" })).toHaveLength(0);

    // 環境を pro-rarePack に切り替え
    const select = root!.root.findAllByType("select")[0];
    act(() => {
      select.props.onChange({ target: { value: "official:pro-rarePack" } });
    });

    // 切り替え後: rareCardCount === 1 のバッジが出現
    expect(root!.root.findAllByProps({ "data-testid": "scenario-builder-rare-badge" })).toHaveLength(1);
    const rarePanel = root!.root.findByProps({ rareCardCount: 1 });
    expect(rarePanel.props.confirmedSelections.p1).toBeDefined();

    // 再度 light-entry16 に戻す
    act(() => {
      select.props.onChange({ target: { value: "official:light-entry16" } });
    });

    // light-entry16 ではバッジが消滅し、RareCardSetupPanel も非表示
    expect(root!.root.findAllByProps({ "data-testid": "scenario-builder-rare-badge" })).toHaveLength(0);
    expect(root!.root.findAllByProps({ rareCardCount: 1 })).toHaveLength(0);
  });

  it("7. 選択した Rare Card が初期盤面開始時に GameState へ正しく反映されること", () => {
    const startScenarioMock = vi.fn();
    let root: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      root = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={startScenarioMock}
          initialDefinition={baseScenarioDef}
          initialEnvironmentId="official:pro-rarePack"
        />
      );
    });

    // RareCardSetupPanel で P1 に ♠K (0), P2 に ♠K (0) を選択確定
    const rarePanel = root!.root.findByProps({ rareCardCount: 1 });
    act(() => {
      rarePanel.props.onConfirmSelections({
        p1: [{ suit: "S", rank: "K", occurrence: 0 }],
        p2: [{ suit: "S", rank: "K", occurrence: 0 }],
      });
    });

    const allButtons = root!.root.findAllByType("button");
    const launchButton = allButtons.find((btn) => extractText(btn).includes("初期盤面で対戦開始"));
    expect(launchButton).toBeDefined();
    expect(launchButton!.props.disabled).toBe(false);

    act(() => {
      launchButton!.props.onClick();
    });

    expect(startScenarioMock).toHaveBeenCalledTimes(1);
    const [startedDef, startedOptions] = startScenarioMock.mock.calls[0];
    expect(startedDef.environmentId).toBe("official:pro-rarePack");
    expect(startedOptions.rareCardSelections).toBeDefined();
    expect(startedOptions.rareCardSelections.p1[0]).toEqual({ suit: "S", rank: "K", occurrence: 0 });

    // prepareScenarioMatchAttempt に渡して GameState に到達することを検証
    const outcome = prepareScenarioMatchAttempt({
      definition: startedDef,
      catalog,
      fullRulePackage,
      mode: startedOptions.mode,
      humanSeat: startedOptions.humanSeat,
      policyId: startedOptions.policyId,
      rareCardSelections: startedOptions.rareCardSelections,
    });

    expect(outcome.status).toBe("READY");
    if (outcome.status === "READY") {
      const session = outcome.prepared.session;
      expect(session.state.players.p1.rareCards).toBeDefined();
      expect(session.state.players.p1.rareCards).toHaveLength(1);
      expect(session.state.players.p1.rareCards![0].suit).toBe("S");
      expect(session.state.players.p1.rareCards![0].rank).toBe("K");
    }
  });

  it("8. Human vs Human の場合、両プレイヤーの Rare Card が独立して設定できること", () => {
    const startScenarioMock = vi.fn();
    let root: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      root = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={startScenarioMock}
          initialDefinition={baseScenarioDef}
          initialEnvironmentId="official:pro-rarePack"
          initialMode="humanVsHuman"
        />
      );
    });

    const rarePanel = root!.root.findByProps({ rareCardCount: 1 });
    // P1 に ♠K (0), P2 に ♥K (0) を明示設定
    act(() => {
      rarePanel.props.onConfirmSelections({
        p1: [{ suit: "S", rank: "K", occurrence: 0 }],
        p2: [{ suit: "H", rank: "K", occurrence: 0 }],
      });
    });

    const allButtons = root!.root.findAllByType("button");
    const launchButton = allButtons.find((btn) => extractText(btn).includes("初期盤面で対戦開始"));
    act(() => {
      launchButton!.props.onClick();
    });

    const [, startedOptions] = startScenarioMock.mock.calls[0];
    expect(startedOptions.rareCardSelections.p1[0]).toEqual({ suit: "S", rank: "K", occurrence: 0 });
    expect(startedOptions.rareCardSelections.p2[0]).toEqual({ suit: "H", rank: "K", occurrence: 0 });
  });

  it("9. Rare Card を要求しない環境では Rare Card UI (バッジ・パネル・インジケーター) が表示されないこと", () => {
    let root: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      root = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
          initialEnvironmentId="official:standard-entry16"
        />
      );
    });

    expect(root!.root.findAllByProps({ "data-testid": "scenario-builder-rare-badge" })).toHaveLength(0);
    expect(root!.root.findAllByProps({ "data-testid": "scenario-builder-settings-rare-indicator" })).toHaveLength(0);
    expect(root!.root.findAllByProps({ "data-testid": "scenario-builder-tab-rare-summary" })).toHaveLength(0);
  });

  it("10. P1/P2 タブ表示時にもレアカードサマリーが表示され、基本設定タブへ誘導できること", () => {
    let root: TestRenderer.ReactTestRenderer | null = null;
    act(() => {
      root = TestRenderer.create(
        <ScenarioBuilderModal
          isOpen={true}
          onClose={vi.fn()}
          catalog={catalog}
          fullRulePackage={fullRulePackage}
          onStartScenario={vi.fn()}
          initialEnvironmentId="official:pro-rarePack"
          initialTab="p1"
        />
      );
    });

    // P1 タブが開かれているためサマリーが表示される
    const summary = root!.root.findByProps({ "data-testid": "scenario-builder-tab-rare-summary" });
    expect(summary).toBeDefined();
    expect(extractText(summary)).toContain("レアカード設定 (1枚必要)");

    // 誘導ボタンをクリックして settings タブへ切り替え
    const switchBtn = summary.findByType("button");
    act(() => {
      switchBtn.props.onClick();
    });

    // settings タブ内の RareCardSetupPanel が表示されていること
    expect(root!.root.findByProps({ rareCardCount: 1 })).toBeDefined();
  });
});
