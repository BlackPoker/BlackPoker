import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MobileHeaderMenu } from "../../ui/game/MobileHeaderMenu";
import {
  PLAYTEST_PREFERENCES_STORAGE_KEY,
  DEFAULT_PLAYTEST_USER_PREFERENCES,
  validateAndNormalizePreferences,
} from "../../ui/preferences/PlaytestUserPreferences";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";
import { MatchSetupScreen } from "../../ui/playtest/MatchSetupScreen";
import { selectAutoGraveTopCandidate } from "../../engine/playtest/GraveTopAutoSelector";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

describe("Playtest Auto Grave Top Integration (Phase 5B)", () => {
  beforeEach(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.clear();
    }
  });

  it("1. MobileHeaderMenu に『墓地TOPの選択方法』UIが存在し、手動/自動の切り替えコールバックが発火すること", () => {
    const onSelectGraveTopSelectionMode = vi.fn();

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
          graveTopSelectionMode="manual"
          onSelectGraveTopSelectionMode={onSelectGraveTopSelectionMode}
        />
      );
    });

    const manualBtn = renderer.root.findByProps({ "data-testid": "grave-top-mode-manual" });
    const autoBtn = renderer.root.findByProps({ "data-testid": "grave-top-mode-auto" });

    expect(manualBtn).toBeDefined();
    expect(autoBtn).toBeDefined();

    // 初期状態は manual が選択スタイル（bg-zinc-950 text-white）
    expect(String(manualBtn.props.className)).toContain("bg-zinc-950");
    expect(String(autoBtn.props.className)).not.toContain("bg-zinc-950");

    // 自動選択ボタンをクリック
    act(() => {
      autoBtn.props.onClick();
    });

    expect(onSelectGraveTopSelectionMode).toHaveBeenCalledWith("auto");
  });

  it("2. CoreBattlePlaytest で設定メニューを開き、墓地TOPの自動選択を選択するとユーザー設定が auto に更新されること", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    // 設定メニューを開く
    const menuBtn = renderer.root.findByProps({ "data-testid": "header-settings-menu-button" });
    act(() => {
      menuBtn.props.onClick();
    });

    const headerMenu = renderer.root.findByType(MobileHeaderMenu);
    expect(headerMenu.props.graveTopSelectionMode).toBe("manual");

    // 自動選択ボタンをクリック
    const autoBtn = renderer.root.findByProps({ "data-testid": "grave-top-mode-auto" });
    act(() => {
      autoBtn.props.onClick();
    });

    // ヘッダーメニューの prop が auto に即時更新されること
    const updatedMenu = renderer.root.findByType(MobileHeaderMenu);
    expect(updatedMenu.props.graveTopSelectionMode).toBe("auto");

    // localStorage に保存されていること
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = JSON.parse(window.localStorage.getItem(PLAYTEST_PREFERENCES_STORAGE_KEY) || "{}");
      expect(stored.graveTopSelectionMode).toBe("auto");
    }
  });

  it("3. 文字サイズリセット（標準に戻す）を実行しても、graveTopSelectionMode の設定が維持されること", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    const menuBtn = renderer.root.findByProps({ "data-testid": "header-settings-menu-button" });
    act(() => {
      menuBtn.props.onClick();
    });

    // 文字サイズを 150% に変更
    const font150Btn = renderer.root.findByProps({ "data-testid": "font-scale-button-150%" });
    act(() => {
      font150Btn.props.onClick();
    });

    // 墓地TOPを auto に変更
    const autoBtn = renderer.root.findByProps({ "data-testid": "grave-top-mode-auto" });
    act(() => {
      autoBtn.props.onClick();
    });

    let currentMenu = renderer.root.findByType(MobileHeaderMenu);
    expect(currentMenu.props.fontScale).toBe("150%");
    expect(currentMenu.props.graveTopSelectionMode).toBe("auto");

    // 文字サイズを標準に戻す
    act(() => {
      currentMenu.props.onResetFontScale?.();
    });

    currentMenu = renderer.root.findByType(MobileHeaderMenu);
    expect(currentMenu.props.fontScale).toBe("100%");
    // graveTopSelectionMode は auto のまま維持されていること
    expect(currentMenu.props.graveTopSelectionMode).toBe("auto");

    if (typeof window !== "undefined" && window.localStorage) {
      const stored = JSON.parse(window.localStorage.getItem(PLAYTEST_PREFERENCES_STORAGE_KEY) || "{}");
      expect(stored.fontScale).toBe("100%");
      expect(stored.graveTopSelectionMode).toBe("auto");
    }
  });

  it("4. selectAutoGraveTopCandidate が ZONE_TOP_SELECTION 要求に対して安定した決定論的選択結果を返すこと", () => {
    const mockRequest: DecisionRequest = {
      decisionId: "dec-zone-top-test",
      stateVersion: 10,
      playerId: "p1",
      source: {
        type: "ZONE_TOP_SELECTION",
        reason: "MULTI_CARD_GRAVE_MOVE",
        player: "p1",
        zone: "GRAVE",
      },
      patterns: [
        { kind: "EFFECT_SELECTION", effectSelectionRef: 0 },
        { kind: "EFFECT_SELECTION", effectSelectionRef: 1 },
      ],
      catalog: {
        effectSelections: [
          { selectionType: "card", selectedValues: ["c1_dA"] },
          { selectionType: "card", selectedValues: ["c2_sK"] },
        ],
      },
    };

    const result1 = selectAutoGraveTopCandidate({
      request: mockRequest,
      matchSeed: 42,
      stateVersion: 10,
    });
    const result2 = selectAutoGraveTopCandidate({
      request: mockRequest,
      matchSeed: 42,
      stateVersion: 10,
    });

    expect(result1.selectedPatternRef).toBe(result2.selectedPatternRef);
    expect(result1.selectedCardId).toBe(result2.selectedCardId);
    expect(["c1_dA", "c2_sK"]).toContain(result1.selectedCardId);
  });
});
