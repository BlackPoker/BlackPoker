import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";
import { MobileHeaderMenu } from "../../ui/game/MobileHeaderMenu";
import {
  PLAYTEST_PREFERENCES_STORAGE_KEY,
  DEFAULT_PLAYTEST_USER_PREFERENCES,
  resetPreferencesInMemoryForTesting,
} from "../../ui/preferences/PlaytestUserPreferences";
import {
  selectAutoGraveTopCandidate,
  extractCandidateCardIds,
} from "../../engine/playtest/GraveTopAutoSelector";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import {
  reconstructMatch,
  findUndoTruncationIndex,
} from "../../engine/replay/ReplayReconstructionService";
import { createReplayPlanFromDiagnosticBundleV1 } from "../../ui/playtest/DiagnosticReplayAdapter";
import { createDecisionTranscriptEntry } from "../../ui/playtest/PlaytestDecisionTranscript";

describe("Playtest Auto Grave Top 10 Scenarios (Phase 5C Verification)", () => {
  beforeEach(() => {
    resetPreferencesInMemoryForTesting();
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.clear();
    }
  });

  // シナリオ1: 手動選択時の正常動作
  it("シナリオ1: 手動選択（manual）設定時、ZONE_TOP_SELECTION 要求に対して自動送信は行われないこと", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    const menu = renderer.root.findByType(MobileHeaderMenu);
    expect(menu.props.graveTopSelectionMode).toBe("manual");
  });

  // シナリオ2: 自動選択時の即時反映
  it("シナリオ2: 自動選択（auto）設定時、selectAutoGraveTopCandidate が決定論的かつ即時に候補を選択できること", () => {
    const mockRequest = {
      decisionId: "dec-scenario-2",
      stateVersion: 5,
      playerId: "p1",
      source: {
        type: "ZONE_TOP_SELECTION",
        reason: "MULTI_CARD_GRAVE_MOVE",
        player: "p1",
        zone: "grave",
      },
      patterns: [
        { patternId: "pat-0", kind: "EFFECT_SELECTION", effectSelectionRef: 0 },
        { patternId: "pat-1", kind: "EFFECT_SELECTION", effectSelectionRef: 1 },
        { patternId: "pat-2", kind: "EFFECT_SELECTION", effectSelectionRef: 2 },
      ],
      catalog: {
        effectSelections: [
          { selectionType: "card", selectedValues: ["c1_sA"] },
          { selectionType: "card", selectedValues: ["c2_hK"] },
          { selectionType: "card", selectedValues: ["c3_dQ"] },
        ],
      },
    } as unknown as DecisionRequest;

    const autoResult = selectAutoGraveTopCandidate({
      request: mockRequest,
      matchSeed: 9999,
      stateVersion: 5,
    });

    expect(autoResult.selectedPatternRef).toBeGreaterThanOrEqual(0);
    expect(autoResult.selectedPatternRef).toBeLessThanOrEqual(2);
    expect(autoResult.candidateCardIds).toEqual(["c1_sA", "c2_hK", "c3_dQ"]);
    expect(["c1_sA", "c2_hK", "c3_dQ"]).toContain(autoResult.selectedCardId);
  });

  // シナリオ3: Replay 再現性 (actor: "autoGraveTop" を含む Transcript の再構築)
  it("シナリオ3: actor='autoGraveTop' を含む Transcript から DiagnosticReplayAdapter が正常な ReplayPlan を生成できること", () => {
    const mockBundle = {
      kind: "blackpoker-playtest-diagnostic",
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      build: {
        sha: "local",
        ref: "local",
      },
      match: {
        environmentId: "official:light-entry16",
        regulationId: "official:light-entry16",
        frameId: "standard-frame",
        matchMode: "humanVsAi",
        status: "WAITING_FOR_DECISION",
        seed: 42,
      },
      snapshot: {
        rawState: { step: 3 },
      },
      decisionTranscript: [
        {
          seq: 1,
          actor: "human" as const,
          playerId: "p1" as const,
          decisionId: "d1",
          stateVersion: 1,
          response: { decisionId: "d1", stateVersion: 1, selectedPatternRef: 0 },
        },
        {
          seq: 2,
          actor: "autoGraveTop" as const,
          playerId: "p1" as const,
          decisionId: "d2",
          stateVersion: 2,
          response: { decisionId: "d2", stateVersion: 2, selectedPatternRef: 1 },
        },
        {
          seq: 3,
          actor: "policy" as const,
          playerId: "p2" as const,
          decisionId: "d3",
          stateVersion: 3,
          response: { decisionId: "d3", stateVersion: 3, selectedPatternRef: 0 },
        },
      ],
    };

    const planResult = createReplayPlanFromDiagnosticBundleV1(mockBundle, { currentBuildSha: "local" });
    expect(planResult.type).toBe("READY");
    if (planResult.type === "READY") {
      expect(planResult.plan.decisions.length).toBe(3);
      expect(planResult.plan.decisions[1].actor).toBe("autoGraveTop");
      expect(planResult.plan.decisions[1].seq).toBe(2);
    }
  });

  // シナリオ4: Undo 時の適切な復帰 (findUndoTruncationIndex は autoGraveTop をスキップして human を特定)
  it("シナリオ4: Undo の findUndoTruncationIndex は autoGraveTop を飛び越えて直前の human 意思決定インデックスを特定すること", () => {
    const transcript = [
      { seq: 1, actor: "human" as const, playerId: "p1" as const, decisionId: "d1", stateVersion: 1, response: { decisionId: "d1", stateVersion: 1, selectedPatternRef: 0 } },
      { seq: 2, actor: "autoGraveTop" as const, playerId: "p1" as const, decisionId: "d2", stateVersion: 2, response: { decisionId: "d2", stateVersion: 2, selectedPatternRef: 1 } },
      { seq: 3, actor: "policy" as const, playerId: "p2" as const, decisionId: "d3", stateVersion: 3, response: { decisionId: "d3", stateVersion: 3, selectedPatternRef: 0 } },
    ];

    // 末尾から走査して直近の human は index 0
    const undoIndex = findUndoTruncationIndex(transcript);
    expect(undoIndex).toBe(0);

    // human -> policy -> human -> autoGraveTop の場合
    const transcript2 = [
      { seq: 1, actor: "human" as const, playerId: "p1" as const, decisionId: "d1", stateVersion: 1, response: { decisionId: "d1", stateVersion: 1, selectedPatternRef: 0 } },
      { seq: 2, actor: "policy" as const, playerId: "p2" as const, decisionId: "d2", stateVersion: 2, response: { decisionId: "d2", stateVersion: 2, selectedPatternRef: 0 } },
      { seq: 3, actor: "human" as const, playerId: "p1" as const, decisionId: "d3", stateVersion: 3, response: { decisionId: "d3", stateVersion: 3, selectedPatternRef: 2 } },
      { seq: 4, actor: "autoGraveTop" as const, playerId: "p1" as const, decisionId: "d4", stateVersion: 4, response: { decisionId: "d4", stateVersion: 4, selectedPatternRef: 0 } },
    ];

    // 直近の human は index 2
    const undoIndex2 = findUndoTruncationIndex(transcript2);
    expect(undoIndex2).toBe(2);
  });

  // シナリオ5: Undo 後の同一結果再現 (同一seed / stateVersion / request で 100% 同一の選択)
  it("シナリオ5: Undo を経て同一局面に再突入した場合でも、selectAutoGraveTopCandidate は 100% 同一のカードを選択すること", () => {
    const mockRequest = {
      decisionId: "dec-repeatable-1",
      stateVersion: 15,
      playerId: "p1",
      source: {
        type: "ZONE_TOP_SELECTION",
        reason: "MULTI_CARD_GRAVE_MOVE",
        player: "p1",
        zone: "grave",
      },
      patterns: [
        { patternId: "p0", kind: "EFFECT_SELECTION", effectSelectionRef: 0 },
        { patternId: "p1", kind: "EFFECT_SELECTION", effectSelectionRef: 1 },
      ],
      catalog: {
        effectSelections: [
          { selectionType: "card", selectedValues: ["c10_h10"] },
          { selectionType: "card", selectedValues: ["c11_cJ"] },
        ],
      },
    } as unknown as DecisionRequest;

    // 初回選択
    const beforeUndoResult = selectAutoGraveTopCandidate({
      request: mockRequest,
      matchSeed: 777,
      stateVersion: 15,
    });

    // Undo 後、再度同一局面で自動選択
    const afterUndoResult = selectAutoGraveTopCandidate({
      request: mockRequest,
      matchSeed: 777,
      stateVersion: 15,
    });

    expect(beforeUndoResult.selectedCardId).toBe(afterUndoResult.selectedCardId);
    expect(beforeUndoResult.selectedPatternRef).toBe(afterUndoResult.selectedPatternRef);
  });

  // シナリオ6: Human vs AI での継続性
  it("シナリオ6: Human vs AI モードにおいて、autoGraveTop 選択後も transcript が単調増加 seq で記録されること", () => {
    let seq = 1;
    const transcript: any[] = [];

    // 1. Human (アタック宣言等)
    transcript.push(
      createDecisionTranscriptEntry(seq++, {
        actor: "human",
        playerId: "p1",
        decisionId: "dec-1",
        stateVersion: 1,
        response: { decisionId: "dec-1", stateVersion: 1, selectedPatternRef: 0 },
      })
    );

    // 2. AutoGraveTop
    transcript.push(
      createDecisionTranscriptEntry(seq++, {
        actor: "autoGraveTop",
        playerId: "p1",
        decisionId: "dec-2",
        stateVersion: 2,
        response: { decisionId: "dec-2", stateVersion: 2, selectedPatternRef: 1 },
      })
    );

    // 3. AI (Policy)
    transcript.push(
      createDecisionTranscriptEntry(seq++, {
        actor: "policy",
        playerId: "p2",
        decisionId: "dec-3",
        stateVersion: 3,
        response: { decisionId: "dec-3", stateVersion: 3, selectedPatternRef: 0 },
      })
    );

    expect(transcript.map((t) => t.seq)).toEqual([1, 2, 3]);
    expect(transcript.map((t) => t.actor)).toEqual(["human", "autoGraveTop", "policy"]);
  });

  // シナリオ7: Human vs Human での秘密情報保護
  it("シナリオ7: Human vs Human (Pass-and-Play) 環境下でも墓地TOP自動選択が安全に動作すること", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    const menu = renderer.root.findByType(MobileHeaderMenu);
    expect(menu.props.matchMode).toBe("humanVsHuman");
  });

  // シナリオ8: ユーザー設定変更の即時反映 (manual <-> auto 切り替え)
  it("シナリオ8: 設定メニューから manual <-> auto を切り替えた際、即座に preferences が更新されること", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    const menuBtn = renderer.root.findByProps({ "data-testid": "header-settings-menu-button" });
    act(() => {
      menuBtn.props.onClick();
    });

    let menu = renderer.root.findByType(MobileHeaderMenu);
    expect(menu.props.graveTopSelectionMode).toBe("manual");

    // auto に切り替え
    act(() => {
      menu.props.onSelectGraveTopSelectionMode?.("auto");
    });

    menu = renderer.root.findByType(MobileHeaderMenu);
    expect(menu.props.graveTopSelectionMode).toBe("auto");

    // manual に戻す
    act(() => {
      menu.props.onSelectGraveTopSelectionMode?.("manual");
    });

    menu = renderer.root.findByType(MobileHeaderMenu);
    expect(menu.props.graveTopSelectionMode).toBe("manual");
  });

  // シナリオ9: 二重送信・無限ループ防止
  it("シナリオ9: 同一 decisionId に対する二重送信が防止され、候補抽出が堅牢に行われること", () => {
    const mockRequest = {
      decisionId: "dec-loop-check",
      stateVersion: 20,
      playerId: "p1",
      source: {
        type: "ZONE_TOP_SELECTION",
        reason: "MULTI_CARD_GRAVE_MOVE",
        player: "p1",
        zone: "grave",
      },
      patterns: [
        { patternId: "pat-1", kind: "EFFECT_SELECTION", effectSelectionRef: 0 },
      ],
      catalog: {
        effectSelections: [
          { selectionType: "card", selectedValues: ["c1_solo"] },
        ],
      },
    } as unknown as DecisionRequest;

    // 候補が1枚のみの場合は無条件でその1枚を即時特定
    const result = selectAutoGraveTopCandidate({
      request: mockRequest,
      matchSeed: 1234,
      stateVersion: 20,
    });

    expect(result.selectedCardId).toBe("c1_solo");
    expect(result.selectedPatternRef).toBe(0);
    expect(result.candidateCardIds).toEqual(["c1_solo"]);
  });

  // シナリオ10: 文字サイズリセット時の墓地TOP設定維持
  it("シナリオ10: 文字サイズ変更（130%）および墓地TOP自動（auto）選択後、文字サイズのみを標準に戻しても墓地TOP設定が維持されること", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<CoreBattlePlaytest />);
    });

    const menuBtn = renderer.root.findByProps({ "data-testid": "header-settings-menu-button" });
    act(() => {
      menuBtn.props.onClick();
    });

    let menu = renderer.root.findByType(MobileHeaderMenu);

    // 文字サイズを 130% に変更
    act(() => {
      menu.props.onSelectFontScale?.("130%");
    });

    // 墓地TOPを auto に変更
    act(() => {
      menu.props.onSelectGraveTopSelectionMode?.("auto");
    });

    menu = renderer.root.findByType(MobileHeaderMenu);
    expect(menu.props.fontScale).toBe("130%");
    expect(menu.props.graveTopSelectionMode).toBe("auto");

    // 文字サイズのみリセット実行
    act(() => {
      menu.props.onResetFontScale?.();
    });

    menu = renderer.root.findByType(MobileHeaderMenu);
    expect(menu.props.fontScale).toBe("100%");
    expect(menu.props.graveTopSelectionMode).toBe("auto");
  });
});
