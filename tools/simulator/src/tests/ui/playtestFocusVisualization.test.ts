/**
 * playtestFocusVisualization.test.ts
 *
 * BlackPoker Playtest UI改善：フォーカスの可視化 テストスイート
 *
 * 【検証項目】
 * 1. 単体テスト (Unit Tests: PlayerObservationPresenter & ViewModel)
 *    - focusPlayerId が P1 なら P1 の isFocusPlayer だけが true、P2 は false
 *    - focusPlayerId が P2 なら P2 の isFocusPlayer だけが true、P1 は false
 *    - focusPlayerId が undefined の場合は誤ったプレイヤーを表示せず両者 false
 *    - TURN, CHANCE, FOCUS が同一プレイヤーでもすべて true
 *    - CHANCE が "system" (Rule System) の場合でも FOCUS を正しく判定・表示
 *
 * 2. 必須組み合わせシナリオ (6パターン)
 *    - P1 / P1 / P1
 *    - P1 / P2 / P1
 *    - P1 / P1 / P2
 *    - P2 / P1 / P2
 *    - P2 / P2 / P2
 *    - P1 / system / P2
 *
 * 3. 状態遷移テスト (GameSession 駆動 7フェーズ)
 *    1. ゲーム開始直後
 *    2. 通常アクションをステージに積載した直後
 *    3. チャンスをパスして相手へ渡した直後
 *    4. フォーカスに基づく全員パス成立時
 *    5. ルールシステムがチャンスを保持しているステージ解決中
 *    6. ステージ最上段の解決後
 *    7. ターン交代後
 *
 * 4. Human vs AI / Human vs Human 視点検証
 *    - 人間操作プレイヤーを手前に配置する既存仕様の維持
 *    - フォーカス移動によって盤面上下が勝手に入れ替わらないこと
 */

import React from "react";
import { renderToString } from "react-dom/server";
import { GameStatusBar } from "../../ui/game/GameStatusBar.js";
import { PlayerBoard } from "../../ui/game/PlayerBoard.js";
import { describe, it, expect, beforeAll } from "vitest";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter.js";
import { ObservationFactory } from "../../engine/decision/ObservationFactory.js";
import { PlayerObservation } from "../../domain/decision/PlayerObservation.js";
import { GameSession } from "../../engine/session/GameSession.js";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest.js";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator.js";
import { PlayerKey } from "../../domain/decision/DecisionSource.js";

describe("Playtest UI改善: フォーカス可視化テストスイート", () => {
  let rulePackage: RulePackage;

  beforeAll(() => {
    rulePackage = loadRulePackageForBrowser();
  });

  // =========================================================================
  // 1. 単体テスト (Presenter & ViewModel)
  // =========================================================================
  describe("1. 単体テスト (PlayerObservationPresenter & ViewModel)", () => {
    function createMockObservation(opts: {
      turnPlayerId?: PlayerKey;
      chancePlayerId?: PlayerKey | "system";
      focusPlayerId?: PlayerKey;
      viewerPlayerId?: PlayerKey;
    }): PlayerObservation {
      const viewer = opts.viewerPlayerId ?? "p1";
      return {
        viewerPlayerId: viewer,
        turnPlayerId: opts.turnPlayerId ?? "p1",
        chancePlayerId: opts.chancePlayerId ?? "p1",
        focusPlayerId: opts.focusPlayerId,
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
        players: [
          {
            playerId: "p1",
            name: "Player A",
            isViewer: viewer === "p1",
            lifeDisplay: "10以上",
            handCount: 5,
            handCards: [],
            field: [],
            trumps: [],
            fog: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: viewer === "p1",
          },
          {
            playerId: "p2",
            name: "Player B",
            isViewer: viewer === "p2",
            lifeDisplay: "10以上",
            handCount: 5,
            handCards: [],
            field: [],
            trumps: [],
            fog: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: viewer === "p2",
          },
        ],
      };
    }

    it("1.1 focusPlayerId が P1 の場合、P1 の isFocusPlayer だけが true、P2 は false であること", () => {
      const obs = createMockObservation({
        turnPlayerId: "p1",
        chancePlayerId: "p2",
        focusPlayerId: "p1",
      });

      const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", obs, null, "p1");
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", obs, null, "p1");

      expect(p1Vm.isFocusPlayer).toBe(true);
      expect(p2Vm.isFocusPlayer).toBe(false);
    });

    it("1.2 focusPlayerId が P2 の場合、P2 の isFocusPlayer だけが true、P1 は false であること", () => {
      const obs = createMockObservation({
        turnPlayerId: "p1",
        chancePlayerId: "p1",
        focusPlayerId: "p2",
      });

      const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", obs, null, "p1");
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", obs, null, "p1");

      expect(p1Vm.isFocusPlayer).toBe(false);
      expect(p2Vm.isFocusPlayer).toBe(true);
    });

    it("1.3 focusPlayerId が undefined の場合、誤った推測を行わず両者とも false であること", () => {
      const obs = createMockObservation({
        turnPlayerId: "p1",
        chancePlayerId: "p1",
        focusPlayerId: undefined, // 未設定
      });

      const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", obs, null, "p1");
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", obs, null, "p1");

      expect(p1Vm.isFocusPlayer).toBe(false);
      expect(p2Vm.isFocusPlayer).toBe(false);
    });

    it("1.4 TURN, CHANCE, FOCUS が同一プレイヤー (P1) の場合、3フラグすべてが true となること", () => {
      const obs = createMockObservation({
        turnPlayerId: "p1",
        chancePlayerId: "p1",
        focusPlayerId: "p1",
      });

      const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", obs, null, "p1");
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", obs, null, "p1");

      expect(p1Vm.isTurnPlayer).toBe(true);
      expect(p1Vm.isChancePlayer).toBe(true);
      expect(p1Vm.isFocusPlayer).toBe(true);

      expect(p2Vm.isTurnPlayer).toBe(false);
      expect(p2Vm.isChancePlayer).toBe(false);
      expect(p2Vm.isFocusPlayer).toBe(false);
    });

    it("1.5 CHANCE が system (Rule System) の場合でも、FOCUS は正しく対象プレイヤーに設定されること", () => {
      const obs = createMockObservation({
        turnPlayerId: "p1",
        chancePlayerId: "system",
        focusPlayerId: "p2",
      });

      const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", obs, null, "p1");
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", obs, null, "p1");

      expect(p1Vm.isChancePlayer).toBe(false);
      expect(p1Vm.isFocusPlayer).toBe(false);

      expect(p2Vm.isChancePlayer).toBe(false);
      expect(p2Vm.isFocusPlayer).toBe(true);
    });
  });

  // =========================================================================
  // 2. 必須組み合わせシナリオ (6パターン)
  // =========================================================================
  describe("2. 必須組み合わせシナリオ (6パターン)", () => {
    const patterns = [
      { turn: "p1", chance: "p1", focus: "p1", label: "P1 / P1 / P1" },
      { turn: "p1", chance: "p2", focus: "p1", label: "P1 / P2 / P1" },
      { turn: "p1", chance: "p1", focus: "p2", label: "P1 / P1 / P2" },
      { turn: "p2", chance: "p1", focus: "p2", label: "P2 / P1 / P2" },
      { turn: "p2", chance: "p2", focus: "p2", label: "P2 / P2 / P2" },
      { turn: "p1", chance: "system", focus: "p2", label: "P1 / system / P2" },
    ];

    for (const pat of patterns) {
      it(`必須組み合わせ: ${pat.label}`, () => {
        const mockState: any = {
          turnPlayer: pat.turn,
          chancePlayer: pat.chance,
          focusPlayer: pat.focus,
          turnCount: 1,
          stateVersion: 1,
          players: {
            p1: { name: "Player A", life: Array(10).fill({}), hand: [], field: [], trumps: [], grave: [] },
            p2: { name: "Player B", life: Array(10).fill({}), hand: [], field: [], trumps: [], grave: [] },
          },
        };

        const obs = ObservationFactory.createObservation(mockState, "p1");
        expect(obs.turnPlayerId).toBe(pat.turn);
        expect(obs.chancePlayerId).toBe(pat.chance);
        expect(obs.focusPlayerId).toBe(pat.focus);

        const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", obs, mockState, "p1");
        const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", obs, mockState, "p1");

        expect(p1Vm.isTurnPlayer).toBe(pat.turn === "p1");
        expect(p2Vm.isTurnPlayer).toBe(pat.turn === "p2");

        expect(p1Vm.isChancePlayer).toBe(pat.chance === "p1");
        expect(p2Vm.isChancePlayer).toBe(pat.chance === "p2");

        expect(p1Vm.isFocusPlayer).toBe(pat.focus === "p1");
        expect(p2Vm.isFocusPlayer).toBe(pat.focus === "p2");
      });
    }
  });

  // =========================================================================
  // 3. 状態遷移テスト (GameSession 駆動 7フェーズ)
  // =========================================================================
  describe("3. 状態遷移テスト (GameSession 駆動 7フェーズ)", () => {
    it("7つの状態遷移フェーズにおいて、Core の focusPlayer が UI ViewModel に完全一致すること", () => {
      const rawState = createCoreBattlePresetState();
      const setupResult = MatchSetupCoordinator.setupMatch(rawState);
      const session = new GameSession(setupResult.state, rulePackage);

      // Phase 1: ゲーム開始直後 (advance 呼び出し前・後)
      expect(session.state.focusPlayer).toBeDefined();
      const p1 = session.state.focusPlayer!;
      const obs1 = ObservationFactory.createObservation(session.state, "p1");
      const vm1P1 = PlayerObservationPresenter.buildPlayerViewModel("p1", obs1, session.state, "p1");
      const vm1P2 = PlayerObservationPresenter.buildPlayerViewModel("p2", obs1, session.state, "p1");
      expect(vm1P1.isFocusPlayer).toBe(p1 === "p1");
      expect(vm1P2.isFocusPlayer).toBe(p1 === "p2");

      let step = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      // Phase 2: 通常アクション (action.attack) をステージに積載した直後
      const reqAtk = (step as any).request;
      const atkIdx = reqAtk.patterns.findIndex((p: any) => {
        if (p.actionSelectionRef === undefined) return false;
        const act = reqAtk.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.attack";
      });

      step = session.submitDecision({
        decisionId: reqAtk.decisionId,
        stateVersion: reqAtk.stateVersion,
        selectedPatternRef: atkIdx !== -1 ? atkIdx : 1,
      });

      const currentFocus2 = session.state.focusPlayer;
      const obs2 = ObservationFactory.createObservation(session.state, "p1");
      const vm2P1 = PlayerObservationPresenter.buildPlayerViewModel("p1", obs2, session.state, "p1");
      const vm2P2 = PlayerObservationPresenter.buildPlayerViewModel("p2", obs2, session.state, "p1");
      expect(vm2P1.isFocusPlayer).toBe(currentFocus2 === "p1");
      expect(vm2P2.isFocusPlayer).toBe(currentFocus2 === "p2");

      // アタッカー選択を進行
      if (step.type === "WAITING_FOR_DECISION" && (step as any).request.source.type === "EFFECT_RESOLUTION") {
        const req = (step as any).request;
        step = session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 1, // アタッカー1体選択
        });
      }

      // Phase 3: チャンスをパスして相手へ渡した直後
      if (step.type === "WAITING_FOR_DECISION") {
        const req = (step as any).request;
        const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
        if (passIdx !== -1) {
          step = session.submitDecision({
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: passIdx,
          });
        }
      }
      // チャンス移動後も focusPlayer の整合性を確認
      const obs3 = ObservationFactory.createObservation(session.state, "p1");
      const vm3P1 = PlayerObservationPresenter.buildPlayerViewModel("p1", obs3, session.state, "p1");
      const vm3P2 = PlayerObservationPresenter.buildPlayerViewModel("p2", obs3, session.state, "p1");
      expect(vm3P1.isFocusPlayer).toBe(session.state.focusPlayer === "p1");
      expect(vm3P2.isFocusPlayer).toBe(session.state.focusPlayer === "p2");

      // Phase 4〜7: ステージ解決・全員パス成立・ルールシステム解決・ターン交代までを進行
      let loopCount = 0;
      let ruleSystemChanceOccurred = false;
      let turnChangeOccurred = false;
      const initialTurnPlayer = session.state.turnPlayer;

      while (step.type !== "FINISHED" && loopCount < 50) {
        loopCount++;

        if (session.state.chancePlayer === "system") {
          ruleSystemChanceOccurred = true;
          // Phase 5: ルールシステムがチャンスを保持しているステージ解決中
          const obsSys = ObservationFactory.createObservation(session.state, "p1");
          const vmSysP1 = PlayerObservationPresenter.buildPlayerViewModel("p1", obsSys, session.state, "p1");
          const vmSysP2 = PlayerObservationPresenter.buildPlayerViewModel("p2", obsSys, session.state, "p1");
          expect(vmSysP1.isFocusPlayer).toBe(session.state.focusPlayer === "p1");
          expect(vmSysP2.isFocusPlayer).toBe(session.state.focusPlayer === "p2");
        }

        if (session.state.turnPlayer !== initialTurnPlayer) {
          turnChangeOccurred = true;
          // Phase 7: ターン交代後
          const obsTurn = ObservationFactory.createObservation(session.state, "p1");
          const vmTurnP1 = PlayerObservationPresenter.buildPlayerViewModel("p1", obsTurn, session.state, "p1");
          const vmTurnP2 = PlayerObservationPresenter.buildPlayerViewModel("p2", obsTurn, session.state, "p1");
          expect(vmTurnP1.isFocusPlayer).toBe(session.state.focusPlayer === "p1");
          expect(vmTurnP2.isFocusPlayer).toBe(session.state.focusPlayer === "p2");
          break;
        }

        if (step.type === "WAITING_FOR_DECISION") {
          const req = (step as any).request;
          // 任意の合法手 (先頭またはPASS) を選択して進行
          const selRef = req.patterns.findIndex((p: any) => p.kind === "PASS");
          step = session.submitDecision({
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: selRef !== -1 ? selRef : 0,
          });
        }
      }

      // ルールシステム解決中とターン交代が正常に観測され、フォーカスが常に正しかったことを確認
      expect(ruleSystemChanceOccurred).toBe(true);
      expect(turnChangeOccurred).toBe(true);
    });
  });

  // =========================================================================
  // 4. Human vs AI / Human vs Human 視点検証
  // =========================================================================
  describe("4. 対戦モードおよび視点検証 (上下配置とフォーカスの独立性)", () => {
    it("Human vs AI (P1 手前) において、フォーカスが P2 にあっても P1 手前・P2 奥の配置が維持されること", () => {
      const mockState: any = {
        turnPlayer: "p1",
        chancePlayer: "p2",
        focusPlayer: "p2", // フォーカスは相手 (P2)
        turnCount: 1,
        players: {
          p1: { name: "Player A (Human)", life: Array(10).fill({}), hand: [], field: [], trumps: [], grave: [] },
          p2: { name: "Player B (AI)", life: Array(10).fill({}), hand: [], field: [], trumps: [], grave: [] },
        },
      };

      // UI 基準: bottomPlayerKey = "p1", topPlayerKey = "p2"
      const bottomPlayerKey = "p1";
      const topPlayerKey = "p2";
      const uiViewerPlayerId = bottomPlayerKey;

      const boardObservation = ObservationFactory.createObservation(mockState, uiViewerPlayerId);
      const bottomVm = PlayerObservationPresenter.buildPlayerViewModel(bottomPlayerKey, boardObservation, mockState, uiViewerPlayerId);
      const topVm = PlayerObservationPresenter.buildPlayerViewModel(topPlayerKey, boardObservation, mockState, uiViewerPlayerId);

      // 手前 (bottom) は P1 (isFocusPlayer: false)
      expect(bottomVm.playerKey).toBe("p1");
      expect(bottomVm.isFocusPlayer).toBe(false);

      // 奥 (top) は P2 (isFocusPlayer: true)
      expect(topVm.playerKey).toBe("p2");
      expect(topVm.isFocusPlayer).toBe(true);
    });

    it("Human vs Human において、手番交代で上下が反転しても各プレイヤーのフォーカス値が正しく追従すること", () => {
      const mockState: any = {
        turnPlayer: "p2",
        chancePlayer: "p2",
        focusPlayer: "p1", // 手番はP2だがフォーカスはP1
        turnCount: 2,
        players: {
          p1: { name: "Player A", life: Array(10).fill({}), hand: [], field: [], trumps: [], grave: [] },
          p2: { name: "Player B", life: Array(10).fill({}), hand: [], field: [], trumps: [], grave: [] },
        },
      };

      // P2 手番時の上下配置: bottom = "p2", top = "p1"
      const bottomPlayerKey = "p2";
      const topPlayerKey = "p1";
      const uiViewerPlayerId = bottomPlayerKey;

      const boardObservation = ObservationFactory.createObservation(mockState, uiViewerPlayerId);
      const bottomVm = PlayerObservationPresenter.buildPlayerViewModel(bottomPlayerKey, boardObservation, mockState, uiViewerPlayerId);
      const topVm = PlayerObservationPresenter.buildPlayerViewModel(topPlayerKey, boardObservation, mockState, uiViewerPlayerId);

      // 手前 (bottom) は P2: isTurnPlayer: true, isFocusPlayer: false
      expect(bottomVm.playerKey).toBe("p2");
      expect(bottomVm.isTurnPlayer).toBe(true);
      expect(bottomVm.isFocusPlayer).toBe(false);

      // 奥 (top) は P1: isTurnPlayer: false, isFocusPlayer: true
      expect(topVm.playerKey).toBe("p1");
      expect(topVm.isTurnPlayer).toBe(false);
      expect(topVm.isFocusPlayer).toBe(true);
    });
  });

  // =========================================================================
  // 5. コンポーネントレンダリング検証 (GameStatusBar & PlayerBoard)
  // =========================================================================
  describe("5. コンポーネントレンダリング検証 (GameStatusBar & PlayerBoard HTML)", () => {
    it("GameStatusBar: focusPlayer が P1 のとき、FOCUS: Player A (P1) バッジが白背景・太枠で描画されること", () => {
      const html = renderToString(
        React.createElement(GameStatusBar, {
          turnPlayer: "p1",
          chancePlayer: "p2",
          focusPlayer: "p1",
          turnCount: 1,
          players: {
            p1: { name: "Player A" },
            p2: { name: "Player B" },
          },
        })
      );

      // 手番、チャンス、フォーカスの各表示が存在すること
      expect(html).toContain("手番:");
      expect(html).toContain("Player A");
      expect(html).toContain("CHANCE:");
      expect(html).toContain("Player B");
      expect(html).toContain("FOCUS:");
      expect(html).toContain("Player A (P1)");

      // フォーカスバッジのスタイル (白背景・太め黒枠 border-2 border-zinc-950) が適用されていること
      expect(html).toContain("border-2 border-zinc-950");
    });

    it("GameStatusBar: focusPlayer が未設定 (undefined) のとき、「未設定」と表示されること", () => {
      const html = renderToString(
        React.createElement(GameStatusBar, {
          turnPlayer: "p1",
          chancePlayer: "p1",
          focusPlayer: undefined,
          turnCount: 1,
          players: {
            p1: { name: "Player A" },
            p2: { name: "Player B" },
          },
        })
      );

      expect(html).toContain("FOCUS:");
      expect(html).toContain("未設定");
    });

    it("PlayerBoard: isFocusPlayer が true のプレイヤーにのみ FOCUS ラベルが描画され、false の場合は描画されないこと", () => {
      const baseVm: any = {
        name: "Player A",
        playerKey: "p1",
        isViewer: true,
        isTurnPlayer: true,
        isChancePlayer: false,
        isFocusPlayer: true,
        lifeDisplay: "15",
        handCount: 3,
        handCards: [],
        fieldUnits: [],
        fog: [],
        graveCount: 0,
        graveCards: [],
        canViewFullGrave: true,
      };

      // Focus あり
      const htmlWithFocus = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p1",
          viewModel: baseVm,
        })
      );
      expect(htmlWithFocus).toContain("FOCUS");
      expect(htmlWithFocus).toContain("TURN");
      expect(htmlWithFocus).not.toContain("CHANCE");

      // Focus なし
      const vmWithoutFocus = { ...baseVm, isFocusPlayer: false };
      const htmlWithoutFocus = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p1",
          viewModel: vmWithoutFocus,
        })
      );
      expect(htmlWithoutFocus).not.toContain("FOCUS");
    });

    it("PlayerBoard: TURN, CHANCE, FOCUS の3状態を同一プレイヤーが保持する場合、3つすべてのラベルが独立して描画されること", () => {
      const allActiveVm: any = {
        name: "Player A",
        playerKey: "p1",
        isViewer: true,
        isTurnPlayer: true,
        isChancePlayer: true,
        isFocusPlayer: true,
        lifeDisplay: "15",
        handCount: 3,
        handCards: [],
        fieldUnits: [],
        fog: [],
        graveCount: 0,
        graveCards: [],
        canViewFullGrave: true,
      };

      const html = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p1",
          viewModel: allActiveVm,
        })
      );

      expect(html).toContain("TURN");
      expect(html).toContain("CHANCE");
      expect(html).toContain("FOCUS");
    });
  });
});
