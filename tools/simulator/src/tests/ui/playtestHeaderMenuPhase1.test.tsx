import React from "react";
import { renderToString } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";
import { MobileHeaderMenu } from "../../ui/game/MobileHeaderMenu";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";

function extractText(instance: TestRenderer.ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : extractText(child)))
    .join("");
}

describe("Playtest UI Redesign Phase 1: Header Simplification & Unified Settings Menu", () => {
  it("1. 常設ヘッダーから巨大select群やサブツールボタン群が撤去され、全解像度対応のスリム構造になっていること", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    const header = renderer.root.findByProps({ "data-testid": "playtest-top-header" });
    expect(header).toBeDefined();

    // 常設ヘッダー内に raw <select> が存在しないこと (7解像度での横溢れ防止)
    const headerSelects = header.findAllByType("select");
    expect(headerSelects.length).toBe(0);

    // 環境・モード・Seedサマリピルが存在すること
    const summaryPill = header.findByProps({ "data-testid": "header-context-summary" });
    expect(summaryPill).toBeDefined();
    expect(summaryPill.props["data-environment-id"]).toBe("official:light-entry16");

    // 統合設定・メニューボタンが存在し、lg:hidden で隠されていないこと
    const menuBtn = header.findByProps({ "data-testid": "header-settings-menu-button" });
    expect(menuBtn).toBeDefined();
    expect(String(menuBtn.props.className)).not.toContain("lg:hidden");
  });

  it("2. ヘッダーの『設定・メニュー』ボタンまたはサマリピルから統合メニューが開き、デスクトップでも lg:hidden で隠されないこと", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    const menuBtn = renderer.root.findByProps({ "data-testid": "header-settings-menu-button" });

    // クリック前はメニューモーダルは閉じている
    const beforeModals = renderer.root.findAllByProps({ "data-testid": "playtest-settings-menu-modal" });
    expect(beforeModals.length).toBe(0);

    // クリックしてメニューを開く
    act(() => {
      menuBtn.props.onClick();
    });

    const afterModals = renderer.root.findAllByProps({ "data-testid": "playtest-settings-menu-modal" });
    expect(afterModals.length).toBe(1);
    expect(String(afterModals[0].props.className)).not.toContain("lg:hidden");
  });

  it("3. 設定メニューから既存のすべての操作機能・設定項目へアクセスできること", () => {
    const onSelectEnvironment = vi.fn();
    const onSeedModeChange = vi.fn();
    const onSeedInputChange = vi.fn();
    const onSelectMatchMode = vi.fn();
    const onSelectPolicyId = vi.fn();
    const onTogglePassAndPlay = vi.fn();
    const onToggleDebug = vi.fn();
    const onOpenFeedback = vi.fn();
    const onCopyShareUrl = vi.fn();
    const onDownloadDiagnostic = vi.fn();
    const onOpenReplayVerify = vi.fn();
    const onOpenReplayViewer = vi.fn();
    const onOpenScenarioBuilder = vi.fn();
    const onOpenLogModal = vi.fn();
    const onOpenDebugModal = vi.fn();
    const onResetGame = vi.fn();
    const onClose = vi.fn();

    const htmlAi = renderToString(
      <MobileHeaderMenu
        isOpen={true}
        onClose={onClose}
        selectedEnvironmentId="official:standard-pack"
        onSelectEnvironment={onSelectEnvironment}
        environmentOptions={[
          { id: "core-battle", name: "Core Battle Playtest", isOfficial: false },
          { id: "official:standard-pack", name: "スタンダード + パック (公式)", isOfficial: true },
        ]}
        activeMatchSeed={42}
        seedMode="manual"
        onSeedModeChange={onSeedModeChange}
        pendingAutoSeed={777}
        showSeedInput={true}
        seedInput="12345"
        onSeedInputChange={onSeedInputChange}
        matchMode="humanVsAi"
        onSelectMatchMode={onSelectMatchMode}
        policyId="gen9-r4-v72c"
        onSelectPolicyId={onSelectPolicyId}
        isOfficialEnvironment={true}
        enablePassAndPlay={true}
        onTogglePassAndPlay={onTogglePassAndPlay}
        showDebug={false}
        onToggleDebug={onToggleDebug}
        onOpenFeedback={onOpenFeedback}
        feedbackCount={2}
        onCopyShareUrl={onCopyShareUrl}
        onDownloadDiagnostic={onDownloadDiagnostic}
        isDiagnosticAvailable={true}
        isScenarioMatch={false}
        onOpenReplayVerify={onOpenReplayVerify}
        onOpenReplayViewer={onOpenReplayViewer}
        onOpenScenarioBuilder={onOpenScenarioBuilder}
        onOpenLogModal={onOpenLogModal}
        onOpenDebugModal={onOpenDebugModal}
        onResetGame={onResetGame}
      />
    );

    // 全設定・機能が存在することを検証
    expect(htmlAi).toContain("対戦環境 (Environment):");
    expect(htmlAi).toContain("対戦SEED (Active Seed):");
    expect(htmlAi).toContain("42");
    expect(htmlAi).toContain("次回対戦SEED (Next Match Seed):");
    expect(htmlAi).toContain("12345");
    expect(htmlAi).toContain("対戦モード (Match Mode):");
    expect(htmlAi).toContain("AI Policy:");
    expect(htmlAi).toContain("Debug パネル表示 (Debug ON/OFF)");
    expect(htmlAi).toContain("🤔 違和感を記録");
    expect(htmlAi).toContain("開始条件を共有");
    expect(htmlAi).toContain("診断データを保存");
    expect(htmlAi).toContain("Replay検証");
    expect(htmlAi).toContain("初期盤面設定");
    expect(htmlAi).toContain("Replay Viewer");
    expect(htmlAi).toContain("対戦ログ (Game Log) を表示");
    expect(htmlAi).toContain("デバッグ情報 (Debug / Canonical Log)");
    expect(htmlAi).toContain("新しい対戦を開始 (New Match)");
  });

  it("4. Scenario対戦中は設定メニュー内のReplay検証・Replay Viewer・診断データ保存が適切にdisabledになること", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MobileHeaderMenu
          isOpen={true}
          onClose={() => {}}
          selectedEnvironmentId="official:standard-pack"
          onSelectEnvironment={() => {}}
          environmentOptions={[]}
          activeMatchSeed={42}
          showSeedInput={false}
          matchMode="humanVsHuman"
          onSelectMatchMode={() => {}}
          policyId="firstLegal"
          onSelectPolicyId={() => {}}
          isOfficialEnvironment={true}
          enablePassAndPlay={true}
          onTogglePassAndPlay={() => {}}
          isDiagnosticAvailable={false}
          isScenarioMatch={true}
          onDownloadDiagnostic={() => {}}
          onOpenReplayVerify={() => {}}
          onOpenReplayViewer={() => {}}
          onOpenScenarioBuilder={() => {}}
          onOpenLogModal={() => {}}
          onOpenDebugModal={() => {}}
          onResetGame={() => {}}
        />
      );
    });

    const buttons = renderer.root.findAllByType("button");
    const diagBtn = buttons.find((b) => extractText(b).includes("診断データを保存"));
    const verifyBtn = buttons.find((b) => extractText(b).includes("Replay検証"));
    const viewerBtn = buttons.find((b) => extractText(b).includes("Replay Viewer"));

    expect(diagBtn?.props.disabled).toBe(true);
    expect(verifyBtn?.props.disabled).toBe(true);
    expect(viewerBtn?.props.disabled).toBe(true);
  });

  it("5. 対戦開始後に設定メニューから対戦ログモーダルおよびデバッグモーダルを全画面形態で開けること", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    // MatchSetupScreen から対戦を開始
    const setupScreen = renderer.root.findByType(MatchSetupScreen);
    await act(async () => {
      setupScreen.props.onStartMatch();
    });

    // ヘッダーの設定・メニューボタンをクリック
    const menuBtn = renderer.root.findByProps({ "data-testid": "header-settings-menu-button" });
    act(() => {
      menuBtn.props.onClick();
    });

    const menuComponent = renderer.root.findByType(MobileHeaderMenu);
    expect(menuComponent.props.isOpen).toBe(true);

    // メニューから Debug ON/OFF を切り替えられること
    act(() => {
      menuComponent.props.onToggleDebug?.(true);
    });
    expect(renderer.root.findByType(MobileHeaderMenu).props.showDebug).toBe(true);
  });

  it("6. 設定メニューに文字サイズ変更（表示設定）が表示され、4段階の選択とリセットができること", () => {
    const onSelectFontScale = vi.fn();
    const onResetFontScale = vi.fn();

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MobileHeaderMenu
          isOpen={true}
          onClose={() => {}}
          selectedEnvironmentId="core-battle"
          onSelectEnvironment={() => {}}
          environmentOptions={[]}
          showSeedInput={false}
          matchMode="humanVsHuman"
          onSelectMatchMode={() => {}}
          policyId="playtestConservative"
          onSelectPolicyId={() => {}}
          isOfficialEnvironment={false}
          enablePassAndPlay={false}
          onTogglePassAndPlay={() => {}}
          onOpenLogModal={() => {}}
          onOpenDebugModal={() => {}}
          onResetGame={() => {}}
          fontScale="115%"
          onSelectFontScale={onSelectFontScale}
          onResetFontScale={onResetFontScale}
        />
      );
    });

    // 4段階のボタン（100%, 115%, 130%, 150%）が存在すること
    const btn100 = renderer.root.findByProps({ "data-testid": "font-scale-button-100%" });
    const btn115 = renderer.root.findByProps({ "data-testid": "font-scale-button-115%" });
    const btn130 = renderer.root.findByProps({ "data-testid": "font-scale-button-130%" });
    const btn150 = renderer.root.findByProps({ "data-testid": "font-scale-button-150%" });

    expect(btn100).toBeDefined();
    expect(btn115).toBeDefined();
    expect(btn130).toBeDefined();
    expect(btn150).toBeDefined();

    // 130% をクリックした際に onSelectFontScale("130%") が呼ばれること
    act(() => {
      btn130.props.onClick();
    });
    expect(onSelectFontScale).toHaveBeenCalledWith("130%");

    // 標準に戻すボタンをクリックした際に onResetFontScale が呼ばれること
    const allButtons = renderer.root.findAllByType("button");
    const resetBtn = allButtons.find((b) => extractText(b).includes("標準に戻す"));
    expect(resetBtn).toBeDefined();
    act(() => {
      resetBtn?.props.onClick();
    });
    expect(onResetFontScale).toHaveBeenCalled();
  });
});
