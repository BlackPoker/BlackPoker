import React from "react";
import { renderToString } from "react-dom/server";
import * as path from "path";
import { describe, it, expect, beforeAll } from "vitest";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";
import { PlayerBoard } from "../../ui/game/PlayerBoard";
import { formatSuitSymbol } from "../../engine/rules/cardUtils";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { GameSession } from "../../engine/session/GameSession";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";

describe("UI Phase 3.4-R1: Grave Top Observation Contract Tests", () => {
  let playtestRulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    playtestRulePackage = getPlaytestRulePackage(fullPackage);
  });

  // Case A: 通常Cardが直接墓地TOP
  describe("Case A: 通常Cardが墓地TOPの場合", () => {
    it("通常Cardが墓地TOPのとき、graveCount・graveTopCard・grave一覧が正常に投影される", () => {
      const state = {
        players: {
          p1: { name: "Player 1", life: 5, hand: [], field: [], grave: [], fog: [] },
          p2: {
            name: "Player 2",
            life: 5,
            hand: [],
            field: [],
            grave: [
              { id: "c-discard-1", suit: "S", rank: "5", value: 5 },
            ],
            fog: [],
          },
        },
        stage: { requests: [] },
      };

      // 相手視点 (p1 viewer)
      const obsP1 = ObservationFactory.createObservation(state, "p1");
      const p2View = obsP1.players.find((p) => p.playerId === "p2")!;

      expect(p2View.graveCount).toBe(1);
      expect(p2View.graveTopCard).toBeDefined();
      expect(p2View.graveTopCard?.visibility).toBe("KNOWN");
      expect((p2View.graveTopCard as any)?.suit).toBe("S");
      expect((p2View.graveTopCard as any)?.rank).toBe("5");
      // 相手視点には公開TOPカードのみが含まれる
      expect(p2View.grave.length).toBe(1);
      expect(p2View.canViewFullGrave).toBe(false);

      // オーナー視点 (p2 viewer)
      const obsP2 = ObservationFactory.createObservation(state, "p2");
      const p2OwnerView = obsP2.players.find((p) => p.playerId === "p2")!;
      expect(p2OwnerView.graveCount).toBe(1);
      expect(p2OwnerView.grave.length).toBe(1);
      expect(p2OwnerView.canViewFullGrave).toBe(true);
    });
  });

  // Case B: cards.length === 1 の Unit wrapper
  describe("Case B: cards.length === 1 の Unit wrapper が墓地TOPの場合", () => {
    it("単一カードUnit wrapperが墓地TOPのとき、内包カードがgraveTopCardとして解決され、graveCountは1となる", () => {
      const state = {
        players: {
          p1: { name: "Player 1", life: 5, hand: [], field: [], grave: [], fog: [] },
          p2: {
            name: "Player 2",
            life: 5,
            hand: [],
            field: [],
            grave: [
              {
                unitId: "soldier-p2-defeated",
                kind: "一般兵",
                componentId: "character.soldier",
                cards: [{ id: "c-soldier-card", suit: "H", rank: "9", value: 9 }],
              },
            ],
            fog: [],
          },
        },
        stage: { requests: [] },
      };

      // 相手視点 (p1 viewer)
      const obsP1 = ObservationFactory.createObservation(state, "p1");
      const p2View = obsP1.players.find((p) => p.playerId === "p2")!;

      expect(p2View.graveCount).toBe(1);
      expect(p2View.graveTopCard).toBeDefined();
      expect(p2View.graveTopCard?.visibility).toBe("KNOWN");
      expect((p2View.graveTopCard as any)?.suit).toBe("H");
      expect((p2View.graveTopCard as any)?.rank).toBe("9");
      expect(p2View.grave.length).toBe(1);

      // オーナー視点 (p2 viewer)
      const obsP2 = ObservationFactory.createObservation(state, "p2");
      const p2OwnerView = obsP2.players.find((p) => p.playerId === "p2")!;
      expect(p2OwnerView.graveCount).toBe(1);
      expect(p2OwnerView.grave.length).toBe(1);
      expect((p2OwnerView.grave[0] as any).suit).toBe("H");
    });
  });

  // Case C: cards.length === 2 の Unit wrapper
  describe("Case C: cards.length === 2 の Unit wrapper が墓地TOPの場合", () => {
    it("複数カードUnit wrapperでcanonical TOP不在時、推測せずgraveTopCardはundefined、graveCountは物理カード数2となる", () => {
      const state = {
        players: {
          p1: { name: "Player 1", life: 5, hand: [], field: [], grave: [], fog: [] },
          p2: {
            name: "Player 2",
            life: 5,
            hand: [],
            field: [],
            grave: [
              {
                unitId: "equipped-soldier",
                kind: "装備兵",
                componentId: "character.soldier",
                cards: [
                  { id: "c-base", suit: "D", rank: "7", value: 7 },
                  { id: "c-mount", suit: "C", rank: "3", value: 3 },
                ],
              },
            ],
            fog: [],
          },
        },
        stage: { requests: [] },
      };

      // 相手視点 (p1 viewer)
      const obsP1 = ObservationFactory.createObservation(state, "p1");
      const p2View = obsP1.players.find((p) => p.playerId === "p2")!;

      // 物理カード数は 2枚
      expect(p2View.graveCount).toBe(2);
      // canonical TOP がないため推測せず undefined
      expect(p2View.graveTopCard).toBeUndefined();
      // 相手視点には非公開墓地内容が漏洩しない
      expect(p2View.grave.length).toBe(0);

      // オーナー視点 (p2 viewer): 全物理カード2枚が確認可能
      const obsP2 = ObservationFactory.createObservation(state, "p2");
      const p2OwnerView = obsP2.players.find((p) => p.playerId === "p2")!;
      expect(p2OwnerView.graveCount).toBe(2);
      expect(p2OwnerView.grave.length).toBe(2);
      expect((p2OwnerView.grave[0] as any).suit).toBe("D");
      expect((p2OwnerView.grave[1] as any).suit).toBe("C");

      // UI PlayerBoard で fail-safe 表示がされること
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", obsP1, state, "p1");
      const html = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p2",
          viewModel: p2Vm,
          initialShowGraveModal: true,
        })
      );

      // 「墓地は空です」と誤認させず、fail-safe 文言を表示
      expect(html).toContain("墓地トップ情報を表示できません");
      expect(html).toContain("2 枚");
      expect(html).not.toContain("墓地は空です");
      // 相手の秘密カード情報が漏洩しない
      expect(html).not.toContain("♢7");
      expect(html).not.toContain("♣3");
    });
  });

  // Case D: 通常Card + Unit wrapper が混在
  describe("Case D: 通常Card と Unit wrapper の混在", () => {
    it("通常CardとUnit wrapperが混在する場合、graveCountが物理カード総枚数と一致する", () => {
      const state = {
        players: {
          p1: { name: "Player 1", life: 5, hand: [], field: [], grave: [], fog: [] },
          p2: {
            name: "Player 2",
            life: 5,
            hand: [],
            field: [],
            grave: [
              // 1. 通常Card (1枚)
              { id: "c-setup", suit: "S", rank: "A", value: 1 },
              // 2. 2枚構成Unit wrapper (2枚)
              {
                unitId: "u-multi",
                kind: "装備兵",
                cards: [
                  { id: "c-multi-1", suit: "H", rank: "K", value: 13 },
                  { id: "c-multi-2", suit: "D", rank: "Q", value: 12 },
                ],
              },
              // 3. 1枚構成Unit wrapper (1枚) - 墓地TOP
              {
                unitId: "u-single-top",
                kind: "一般兵",
                cards: [
                  { id: "c-top", suit: "C", rank: "10", value: 10 },
                ],
              },
            ],
            fog: [],
          },
        },
        stage: { requests: [] },
      };

      const obsP1 = ObservationFactory.createObservation(state, "p1");
      const p2View = obsP1.players.find((p) => p.playerId === "p2")!;

      // 物理カード数: 1 + 2 + 1 = 4枚 (raw entriesの3ではなく4)
      expect(p2View.graveCount).toBe(4);
      // 墓地TOPは u-single-top の ♣10
      expect(p2View.graveTopCard).toBeDefined();
      expect((p2View.graveTopCard as any)?.suit).toBe("C");
      expect((p2View.graveTopCard as any)?.rank).toBe("10");

      // オーナー視点
      const obsP2 = ObservationFactory.createObservation(state, "p2");
      const p2OwnerView = obsP2.players.find((p) => p.playerId === "p2")!;
      expect(p2OwnerView.graveCount).toBe(4);
      expect(p2OwnerView.grave.length).toBe(4);
    });

    it("不正な要素（suit/rank欠落オブジェクト等）はCardViewとして生成されず除外される", () => {
      const state = {
        players: {
          p1: { name: "Player 1", life: 5, hand: [], field: [], grave: [], fog: [] },
          p2: {
            name: "Player 2",
            life: 5,
            hand: [],
            field: [],
            grave: [
              { broken: "object", suit: "S" }, // rank 欠落
              { broken: "object2", rank: "5" }, // suit 欠落
              null,
              undefined,
            ],
            fog: [],
          },
        },
        stage: { requests: [] },
      };

      const obs = ObservationFactory.createObservation(state, "p1");
      const p2View = obs.players.find((p) => p.playerId === "p2")!;

      expect(p2View.graveCount).toBe(0);
      expect(p2View.graveTopCard).toBeUndefined();
      expect(p2View.grave.length).toBe(0);
    });
  });

  // Case E: 実GameSessionでの戦闘撃破とEnd-to-End検証
  describe("Case E: 実GameSessionでの戦闘撃破とEnd-to-End検証", () => {
    it("実GameSessionで戦闘撃破された一般兵がUnit wrapperとして墓地に送られ、相手視点のObservation/Presenter/PlayerBoardで正しく公開される", () => {
      const rawState = createCoreBattlePresetState();
      const setupResult = MatchSetupCoordinator.setupMatch(rawState);
      const session = new GameSession(setupResult.state, playtestRulePackage);

      // 初期状態で Player B (p2) のフィールドに存在する兵士を取得
      const targetBlockerUnit = session.state.players.p2.field.find(
        (u: any) => u.componentId === "character.soldier"
      );
      expect(targetBlockerUnit).toBeDefined();
      expect(Array.isArray(targetBlockerUnit.cards)).toBe(true);
      expect(targetBlockerUnit.cards.length).toBe(1);

      // 動的に撃破対象兵士の期待カード情報を取得 (固定値決め打ち禁止)
      const expectedUnitId = targetBlockerUnit.unitId;
      const expectedCard = targetBlockerUnit.cards[0];
      const expectedSuit = expectedCard.suit;
      const expectedRank = expectedCard.rank;
      const expectedDisplay = `${formatSuitSymbol(expectedSuit)}${expectedRank}`;

      // アタッカー側の兵士も取得
      const attackerUnit = session.state.players.p1.field.find(
        (u: any) => u.componentId === "character.soldier"
      );
      expect(attackerUnit).toBeDefined();

      // --- 実GameSession進行: Turn 1 Attack -> Block -> DamageJudge ---
      let step = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // 1. Attack リクエスト
      const reqAtk = step.request;
      const atkIdx = reqAtk.patterns.findIndex((p: any) => {
        const act = reqAtk.catalog.actions[p.actionSelectionRef ?? -1];
        return act?.actionId === "action.attack";
      });
      expect(atkIdx).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: reqAtk.decisionId,
        stateVersion: reqAtk.stateVersion,
        selectedPatternRef: atkIdx,
      });

      // PASS / PASS
      const passPass = () => {
        while (step.type === "WAITING_FOR_DECISION" && session.state.stage?.requests?.length > 0) {
          const req = step.request;
          const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
          if (passIdx === -1) break;
          step = session.submitDecision({
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: passIdx,
          });
        }
      };
      passPass();

      // 2. アタッカー選択 (attackerUnit を含む選択肢を選択)
      if (step.type === "WAITING_FOR_DECISION" && step.request.source.type === "EFFECT_RESOLUTION") {
        const reqAtkSel = step.request;
        const selectAtkPattern = reqAtkSel.patterns.findIndex((p: any) => {
          const sel = reqAtkSel.catalog.effectSelections[p.effectSelectionRef!];
          return Array.isArray(sel?.selectedValues) && sel.selectedValues.includes(attackerUnit.unitId);
        });
        expect(selectAtkPattern).toBeGreaterThanOrEqual(0);
        step = session.submitDecision({
          decisionId: reqAtkSel.decisionId,
          stateVersion: reqAtkSel.stateVersion,
          selectedPatternRef: selectAtkPattern,
        });
      }

      // Block 誘発の PASS/PASS
      passPass();

      // 3. ブロッカー選択 (targetBlockerUnit を attackerUnit に割り当て)
      if (step.type === "WAITING_FOR_DECISION" && step.request.source.type === "EFFECT_RESOLUTION") {
        const reqBlockSel = step.request;
        const blockPattern = reqBlockSel.patterns.findIndex((p: any) => {
          const sel = reqBlockSel.catalog.effectSelections[p.effectSelectionRef!];
          return (
            Array.isArray(sel?.assignments) &&
            sel.assignments.some(
              (a: any) =>
                a.sourceUnitId === attackerUnit.unitId &&
                a.selectedUnitIds.includes(expectedUnitId)
            )
          );
        });
        expect(blockPattern).toBeGreaterThanOrEqual(0);
        step = session.submitDecision({
          decisionId: reqBlockSel.decisionId,
          stateVersion: reqBlockSel.stateVersion,
          selectedPatternRef: blockPattern,
        });
      }

      // DamageJudge 誘発の PASS/PASS
      passPass();

      // --- ダメージ判定解決後の墓地状態確認 ---
      const p2Grave = session.state.players.p2.grave;
      expect(p2Grave.length).toBeGreaterThanOrEqual(2); // setupカード + 撃破された兵士

      const rawGraveTop = p2Grave[p2Grave.length - 1];
      expect(rawGraveTop.unitId).toBe(expectedUnitId);
      expect(Array.isArray(rawGraveTop.cards)).toBe(true);

      // --- 4. ObservationFactory (Player A 視点で Player B を観測) ---
      const obsP1 = ObservationFactory.createObservation(session.state, "p1");
      const p2Obs = obsP1.players.find((p) => p.playerId === "p2")!;

      // 相手視点でも Unit wrapper から内包カードが正しく解決されていること
      expect(p2Obs.graveTopCard).toBeDefined();
      expect((p2Obs.graveTopCard as any)?.suit).toBe(expectedSuit);
      expect((p2Obs.graveTopCard as any)?.rank).toBe(expectedRank);

      // 相手視点では墓地全体（setupカード等）が漏洩せず、公開TOPのみであること
      expect(p2Obs.canViewFullGrave).toBe(false);
      expect(p2Obs.grave.length).toBe(1);

      // --- 5. PlayerObservationPresenter.buildPlayerViewModel ---
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel(
        "p2",
        obsP1,
        session.state,
        "p1"
      );
      expect(p2Vm.graveTopCard).toBeDefined();
      expect((p2Vm.graveTopCard as any).suit).toBe(expectedSuit);
      expect((p2Vm.graveTopCard as any).rank).toBe(expectedRank);

      // --- 6. PlayerBoard レンダリング確認 ---
      const html = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p2",
          viewModel: p2Vm,
          initialShowGraveModal: true,
        })
      );

      // ZoneStrip 上の TOP バッジに動的期待値が表示されること
      expect(html).toContain(`TOP: ${expectedDisplay}`);

      // モーダル内に「墓地トップ（公開）: <expectedDisplay>」が表示されること
      expect(html).toContain(`墓地トップ（公開）: ${expectedDisplay}`);

      // 「墓地は空です」や fail-safe 誤表示にならないこと
      expect(html).not.toContain("墓地は空です");
      expect(html).not.toContain("墓地トップ情報を表示できません");
    });
  });
});
