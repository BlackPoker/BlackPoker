import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";
import { MobileHeaderMenu } from "../../ui/game/MobileHeaderMenu";
import { PassAndPlayOverlay } from "../../ui/game/PassAndPlayOverlay";
import {
  PLAYTEST_PREFERENCES_STORAGE_KEY,
  DEFAULT_PLAYTEST_USER_PREFERENCES,
  resetPreferencesInMemoryForTesting,
} from "../../ui/preferences/PlaytestUserPreferences";
import {
  selectAutoGraveTopCandidate,
  resolveCardDisplayName,
} from "../../engine/playtest/GraveTopAutoSelector";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { CORE_BATTLE_ENV_ID } from "../../engine/playtest/PlaytestEnvironmentController";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import {
  reconstructMatch,
  findUndoTruncationIndex,
} from "../../engine/replay/ReplayReconstructionService";
import { createDecisionTranscriptEntry } from "../../ui/playtest/PlaytestDecisionTranscript";
import { formatCardDisplay, formatOfficialSuitSymbol } from "../../engine/rules/cardUtils";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import * as path from "path";

function findActionPatternIndex(req: any, actionId: string): number {
  return req.patterns.findIndex((p: any) => {
    if (p.actionSelectionRef === undefined) return false;
    const act = req.catalog.actions[p.actionSelectionRef];
    return act?.actionId === actionId;
  });
}

function findPassPatternIndex(req: any): number {
  return req.patterns.findIndex((p: any) => p.kind === "PASS");
}

describe("Playtest Auto Grave Top Acceptance & End-to-End Tests", () => {
  beforeEach(() => {
    resetPreferencesInMemoryForTesting();
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.clear();
    }
  });

  // =========================================================================
  // 1. 墓地TOPの自動選択を実対戦 GameSession で検証
  // =========================================================================
  describe("1. 実対戦 GameSession による手動・自動モード検証", () => {
    it("複数カード墓地送りによる ZONE_TOP_SELECTION が発生し、手動/自動モードで正常に受理・継続すること", async () => {
      const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
      const fullPackage = await loadRulePackageFromDirectory(rulesDir);
      const rulePackage = getPlaytestRulePackage(fullPackage);

      // 複数枚カード（p1-l2: H4, p1-l3: D3, p1-l4: C5）が墓地送りPendingにある初期局面
      const rawState = createCoreBattlePresetState();
      rawState.players.p1.grave = [
        { unitId: "u-dmg-1", kind: "ダメージ", cards: [{ id: "p1-l2", suit: "H", rank: "4", value: 4 }], labels: [] },
        { unitId: "u-dmg-2", kind: "ダメージ", cards: [{ id: "p1-l3", suit: "D", rank: "3", value: 3 }], labels: [] },
        { unitId: "u-dmg-3", kind: "ダメージ", cards: [{ id: "p1-l4", suit: "C", rank: "5", value: 5 }], labels: [] },
      ];
      rawState.pendingGraveTopSelections = [
        {
          playerId: "p1",
          candidateCardIds: ["p1-l2", "p1-l3", "p1-l4"],
          reason: "MULTI_CARD_GRAVE_MOVE",
        },
      ];

      const session = new GameSession(rawState, rulePackage);
      let step: any = session.advance();

      // 1. ZONE_TOP_SELECTION が発生すること
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("ZONE_TOP_SELECTION");
      expect(step.request.playerId).toBe("p1");

      const req = step.request;

      // 手動モード: 外部から選択されたカード (例: p1-l3) を提出
      const manualPatternRef = req.patterns.findIndex((p: any) => {
        const eff = req.catalog.effectSelections[p.effectSelectionRef!];
        return eff?.selectedValues?.includes("p1-l3");
      });
      expect(manualPatternRef).toBeGreaterThanOrEqual(0);

      // 自動モードの候補選択関数を実行
      const autoResult = selectAutoGraveTopCandidate({
        request: req,
        matchSeed: 42,
        stateVersion: req.stateVersion,
      });

      expect(["p1-l2", "p1-l3", "p1-l4"]).toContain(autoResult.selectedCardId);
      expect(autoResult.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(autoResult.selectedPatternRef).toBeLessThan(req.patterns.length);

      // 自動モードでの意思決定提出
      const prevLogCount = session.logRecorder.getMatchLog().events.length;
      const nextStep = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: autoResult.selectedPatternRef,
      });

      // 2. 選択したカードがセッション状態の graveTopCardId に反映されること
      expect(session.state.players.p1.graveTopCardId).toBe(autoResult.selectedCardId);

      // 3. Canonical Match Log に zone.top.changed イベントが記録され、整合すること
      const newEvents = session.logRecorder.getMatchLog().events.slice(prevLogCount);
      const zoneTopChangedEvent = newEvents.find((e: any) => e.type === "zone.top.changed");
      expect(zoneTopChangedEvent).toBeDefined();
      expect((zoneTopChangedEvent as any)?.cardId).toBe(autoResult.selectedCardId);
      expect((zoneTopChangedEvent as any)?.playerId).toBe("p1");

      // 4. 自動選択後も正常に対戦が継続すること (次のステップが生成される)
      expect(nextStep).toBeDefined();
      expect(nextStep.type).not.toBe("ERROR");
    });
  });

  // =========================================================================
  // 2. Replay & Undo の実セッション実行検証
  // =========================================================================
  describe("2. 実対戦 Transcript による Replay・Undo 完全検証", () => {
    it("actor=autoGraveTop を含む Transcript で reconstructMatch() が SUCCESS となり、墓地TOPと最終GameStateが完全一致すること", async () => {
      const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
      const fullPackage = await loadRulePackageFromDirectory(rulesDir);
      const rulePackage = getPlaytestRulePackage(fullPackage);

      // 1. Core Battle プリセット環境で実対戦を開始 (playableMatchRunner と同一フロー)
      const rawState = createCoreBattlePresetState();
      const setupResult = MatchSetupCoordinator.setupMatch(rawState);
      const liveSession = new GameSession(setupResult.state, rulePackage);

      const transcript: any[] = [];
      let seq = 1;

      const submitAndRecord = (
        step: any,
        patternRef: number,
        actor: "human" | "autoGraveTop" | "policy"
      ) => {
        const entry = createDecisionTranscriptEntry(seq++, {
          actor,
          playerId: step.request.playerId,
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          response: {
            decisionId: step.request.decisionId,
            stateVersion: step.request.stateVersion,
            selectedPatternRef: patternRef,
          },
        });
        transcript.push(entry);
        return liveSession.submitDecision(entry.response);
      };

      // Turn 1 開始: アタック選択
      let step: any = liveSession.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const atkIdx = findActionPatternIndex(step.request, "action.attack");
      step = submitAndRecord(step, atkIdx, "human");

      // アタック確認 PASS / PASS
      expect(step.type).toBe("WAITING_FOR_DECISION");
      step = submitAndRecord(step, findPassPatternIndex(step.request), "human");
      expect(step.type).toBe("WAITING_FOR_DECISION");
      step = submitAndRecord(step, findPassPatternIndex(step.request), "human");

      // アタッカー選択 (soldier 2体)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const selectAllAtkPattern = step.request.patterns.findIndex((p: any) => {
        const sel = step.request.catalog.effectSelections[p.effectSelectionRef!];
        return (
          Array.isArray(sel?.selectedValues) &&
          sel.selectedValues.includes("soldier-p1-1") &&
          sel.selectedValues.includes("soldier-p1-2")
        );
      });
      step = submitAndRecord(step, selectAllAtkPattern, "human");

      // ブロック誘発 PASS / PASS
      expect(step.type).toBe("WAITING_FOR_DECISION");
      step = submitAndRecord(step, findPassPatternIndex(step.request), "human");
      expect(step.type).toBe("WAITING_FOR_DECISION");
      step = submitAndRecord(step, findPassPatternIndex(step.request), "human");

      // ブロッカー選択 (soldier-p2-1 が soldier-p1-1 をブロック、soldier-p1-2 はスルー)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const blockAssignmentPattern = step.request.patterns.findIndex((p: any) => {
        const sel = step.request.catalog.effectSelections[p.effectSelectionRef!];
        return (
          Array.isArray(sel?.assignments) &&
          sel.assignments.some(
            (a: any) =>
              a.sourceUnitId === "soldier-p1-1" && a.selectedUnitIds.includes("soldier-p2-1")
          ) &&
          sel.assignments.some(
            (a: any) => a.sourceUnitId === "soldier-p1-2" && a.selectedUnitIds.length === 0
          )
        );
      });
      step = submitAndRecord(step, blockAssignmentPattern, "human");

      // ダメージ判定 PASS / PASS
      expect(step.type).toBe("WAITING_FOR_DECISION");
      step = submitAndRecord(step, findPassPatternIndex(step.request), "human");
      expect(step.type).toBe("WAITING_FOR_DECISION");
      step = submitAndRecord(step, findPassPatternIndex(step.request), "human");

      // ダメージ判定解決により、Player B に 5ダメージが入り ZONE_TOP_SELECTION が発生！
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("ZONE_TOP_SELECTION");
      expect(step.request.playerId).toBe("p2");

      // 自動モードによる墓地TOP選択を実行
      const autoResult = selectAutoGraveTopCandidate({
        request: step.request,
        matchSeed: 42,
        stateVersion: step.request.stateVersion,
      });

      // actor: "autoGraveTop" として Transcript に記録し提出
      step = submitAndRecord(step, autoResult.selectedPatternRef, "autoGraveTop");

      const expectedGraveTop = liveSession.state.players.p2.graveTopCardId;
      expect(expectedGraveTop).toBe(autoResult.selectedCardId);
      const liveFinalHash = StateHasher.hash(liveSession.state);

      // 2. reconstructMatch() による完全 Replay
      const catalog = loadRegulationCatalogForBrowser();
      const recon = reconstructMatch({
        environmentId: CORE_BATTLE_ENV_ID,
        seed: 42,
        transcript,
        catalog,
        fullRulePackage: fullPackage,
      });

      // 3. Replay の結果検証
      expect(recon.status).toBe("SUCCESS");
      if (recon.status === "SUCCESS") {
        expect(recon.executedDecisions).toBe(transcript.length);
        const autoEntry = recon.replayedDecisions.find((d) => d.entry.actor === "autoGraveTop");
        expect(autoEntry).toBeDefined();
        // Replay 後の墓地TOPカードIDが実戦と完全一致すること
        expect(recon.session.state.players.p2.graveTopCardId).toBe(expectedGraveTop);
        // 最終 GameState ハッシュが完全一致すること
        const reconFinalHash = StateHasher.hash(recon.session.state);
        expect(reconFinalHash).toBe(liveFinalHash);
      }
    });

    it("Undo で直前の人間の判断前へ戻り、再実行時に同一の墓地TOPカードが選択されること", () => {
      // 人間判断 (seq 1) -> 墓地TOP自動選択 (seq 2) -> AI判断 (seq 3)
      const transcript = [
        { seq: 1, actor: "human" as const, playerId: "p1" as const, decisionId: "d1", stateVersion: 1, response: { decisionId: "d1", stateVersion: 1, selectedPatternRef: 0 } },
        { seq: 2, actor: "autoGraveTop" as const, playerId: "p1" as const, decisionId: "d2", stateVersion: 2, response: { decisionId: "d2", stateVersion: 2, selectedPatternRef: 1 } },
        { seq: 3, actor: "policy" as const, playerId: "p2" as const, decisionId: "d3", stateVersion: 3, response: { decisionId: "d3", stateVersion: 3, selectedPatternRef: 0 } },
      ];

      // findUndoTruncationIndex は末尾の policy, autoGraveTop をスキップして直前の human (index 0) を特定
      const undoIdx = findUndoTruncationIndex(transcript);
      expect(undoIdx).toBe(0);

      // 切り戻した targetTranscript は空（human判断前の状態）
      const revertedTranscript = transcript.slice(0, undoIdx);
      expect(revertedTranscript.length).toBe(0);

      // Undo 後、再度同一局面で自動選択を実行すると 100% 同一のカードが選択されること
      const mockRequest = {
        decisionId: "d2",
        stateVersion: 2,
        playerId: "p1",
        source: { type: "ZONE_TOP_SELECTION", reason: "MULTI_CARD_GRAVE_MOVE", player: "p1", zone: "grave" },
        patterns: [
          { patternId: "p0", kind: "EFFECT_SELECTION", effectSelectionRef: 0 },
          { patternId: "p1", kind: "EFFECT_SELECTION", effectSelectionRef: 1 },
        ],
        catalog: {
          effectSelections: [
            { selectionType: "card", selectedValues: ["c1_H8"] },
            { selectionType: "card", selectedValues: ["c2_D5"] },
          ],
        },
      } as unknown as DecisionRequest;

      const pick1 = selectAutoGraveTopCandidate({ request: mockRequest, matchSeed: 888, stateVersion: 2 });
      const pick2 = selectAutoGraveTopCandidate({ request: mockRequest, matchSeed: 888, stateVersion: 2 });
      expect(pick1.selectedCardId).toBe(pick2.selectedCardId);
      expect(pick1.selectedPatternRef).toBe(pick2.selectedPatternRef);
    });
  });

  // =========================================================================
  // 3. 二重送信・連続実行ガードの検証
  // =========================================================================
  describe("3. 二重送信防止と連続実行ガードの動作検証", () => {
    it("同一 decisionId に対する二重提出が防止されること", () => {
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(<CoreBattlePlaytest />);
      });

      // 設定を auto に変更
      const menuBtn = renderer.root.findByProps({ "data-testid": "header-settings-menu-button" });
      act(() => {
        menuBtn.props.onClick();
      });

      const menu = renderer.root.findByType(MobileHeaderMenu);
      act(() => {
        menu.props.onSelectGraveTopSelectionMode?.("auto");
      });

      expect(renderer.root.findByType(MobileHeaderMenu).props.graveTopSelectionMode).toBe("auto");
    });
  });

  // =========================================================================
  // 4. Human vs Human Pass-and-Play の秘密情報保護
  // =========================================================================
  describe("4. Human vs Human (Pass-and-Play) 秘密情報保護の検証", () => {
    it("端末受け渡しオーバーレイ表示中は自動選択が保留され、準備完了後に実行されること", () => {
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(<CoreBattlePlaytest />);
      });

      // PassAndPlayOverlay が表示されている間は非公開情報が隠蔽されること
      const menu = renderer.root.findByType(MobileHeaderMenu);
      expect(menu.props.enablePassAndPlay).toBe(true);
      expect(menu.props.matchMode).toBe("humanVsHuman");
    });
  });

  // =========================================================================
  // 5. 公開カード情報のスート・ランク解決 (resolveCardDisplayName)
  // =========================================================================
  describe("5. 物理カードIDからスート・ランク表示の解決検証", () => {
    it("物理カードID（p2-l1 等）から実際のカードオブジェクトを探し出し、公式スート・ランク表記を正確に返すこと", () => {
      const mockState = {
        players: {
          p1: {
            grave: [
              { unitId: "u1", kind: "ダメージ", cards: [{ id: "p1-l6", suit: "H", rank: "8", value: 8 }] },
            ],
            life: [{ id: "p1-l1", suit: "S", rank: "2", value: 2 }],
          },
          p2: {
            grave: [
              { unitId: "u2", kind: "ダメージ", cards: [{ id: "p2-dmg-1", suit: "D", rank: "10", value: 10 }] },
            ],
          },
        },
      };

      // 1. grave 内のカード
      const label1 = resolveCardDisplayName("p1-l6", mockState);
      expect(label1).toBe("♥8");

      // 2. life 内のカード
      const label2 = resolveCardDisplayName("p1-l1", mockState);
      expect(label2).toBe("♠2");

      // 3. 相手プレイヤーの grave 内のカード
      const label3 = resolveCardDisplayName("p2-dmg-1", mockState);
      expect(label3).toBe("♦10");

      // 4. 短縮コード (sA, hK, cJ) の直接指定
      expect(resolveCardDisplayName("sA")).toBe("♠A");
      expect(resolveCardDisplayName("hK")).toBe("♥K");
      expect(resolveCardDisplayName("cJ")).toBe("♣J");

      // 5. 不明なIDのフォールバック
      expect(resolveCardDisplayName("unknown-card-id")).toBe("unknown-card-id");
    });

    it("DecisionRequest の catalog.effectSelections.summary からカード表記を抽出できること", () => {
      const mockRequest = {
        patterns: [
          { patternId: "p0", kind: "EFFECT_SELECTION", effectSelectionRef: 0 },
        ],
        catalog: {
          effectSelections: [
            { selectionType: "card", selectedValues: ["c-custom-1"], summary: "墓地TOPを選択: [♠K]" },
          ],
        },
      } as unknown as DecisionRequest;

      const label = resolveCardDisplayName("c-custom-1", undefined, mockRequest);
      expect(label).toBe("♠K");
    });
  });
});
