import { describe, it, expect } from "vitest";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";
import { ViewerAwareGameEventFormatter } from "../../engine/session/playtest/ViewerAwareGameEventFormatter";
import { BattleRelationPresenter } from "../../ui/game/BattleRelationPresenter";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";

describe("Playtest Observation & Log Secret Safety Tests", () => {
  function createMockStateWithSecrets() {
    const state = createCoreBattlePresetState();
    // p1: ライフ 12枚、手札 3枚 (H1, H2, H3)
    state.players.p1.life = Array(12).fill({ id: "l-p1", suit: "H", rank: 1 });
    state.players.p1.hand = [
      { id: "c1", code: "H1", suit: "H", rank: 1 },
      { id: "c2", code: "H2", suit: "H", rank: 2 },
      { id: "c3", code: "H3", suit: "H", rank: 3 },
    ];
    // p2: ライフ 14枚、手札 3枚 (S10, SJ, SQ)
    state.players.p2.life = Array(14).fill({ id: "l-p2", suit: "S", rank: 10 });
    state.players.p2.hand = [
      { id: "c4", code: "S10", suit: "S", rank: 10 },
      { id: "c5", code: "SJ", suit: "S", rank: 11 },
      { id: "c6", code: "SQ", suit: "S", rank: 12 },
    ];
    return state;
  }

  describe("1. 通常盤面 ViewModel の秘密情報保護 (Human = p1 / AI = p2)", () => {
    it("AI (p2) の手札詳細が非表示 (isKnown: false) となり、カード識別情報が漏洩しないこと", () => {
      const state = createMockStateWithSecrets();
      const humanObservation = ObservationFactory.createObservation(state, "p1");

      const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", humanObservation, state, "p1");
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", humanObservation, state, "p1");

      // Human (p1): 自分視点
      expect(p1Vm.isViewer).toBe(true);
      expect(p1Vm.handCards.length).toBe(3);
      expect(p1Vm.handCards[0].visibility).toBe("KNOWN");
      expect(p1Vm.handCards[0].code).toBe("H1");

      // AI (p2): 相手視点 (秘密情報保護)
      expect(p2Vm.isViewer).toBe(false);
      expect(p2Vm.handCount).toBe(3);
      expect(p2Vm.handCards.length).toBe(3);
      for (const card of p2Vm.handCards) {
        expect(card.visibility).toBe("HIDDEN");
        expect((card as any).code).toBeUndefined();
        expect((card as any).suit).toBeUndefined();
        expect((card as any).rank).toBeUndefined();
      }
    });

    it("AI (p2) のライフが10枚以上の場合、正確な枚数が秘匿され '10以上' と表示されること", () => {
      const state = createMockStateWithSecrets();
      const humanObservation = ObservationFactory.createObservation(state, "p1");

      const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", humanObservation, state, "p1");
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", humanObservation, state, "p1");

      // Human (p1): ライフ 12枚が正確に表示
      expect(p1Vm.lifeDisplay).toBe("12");
      expect(p1Vm.lifeCount).toBe(12);

      // AI (p2): ライフ 14枚は秘匿され "10以上"
      expect(p2Vm.lifeDisplay).toBe("10以上");
      expect(p2Vm.lifeCount).toBeUndefined();
    });
  });

  describe("2. 通常盤面 ViewModel の秘密情報保護 (Human = p2 / AI = p1 逆方向)", () => {
    it("AI (p1) の手札・ライフ正確値が非表示となり、Human (p2) の情報が正常表示されること", () => {
      const state = createMockStateWithSecrets();
      const humanObservation = ObservationFactory.createObservation(state, "p2");

      const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", humanObservation, state, "p2");
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", humanObservation, state, "p2");

      // Human (p2): 自分視点
      expect(p2Vm.isViewer).toBe(true);
      expect(p2Vm.handCards[0].visibility).toBe("KNOWN");
      expect(p2Vm.handCards[0].code).toBe("S10");
      expect(p2Vm.lifeDisplay).toBe("14");
      expect(p2Vm.lifeCount).toBe(14);

      // AI (p1): 相手視点 (秘密情報保護)
      expect(p1Vm.isViewer).toBe(false);
      expect(p1Vm.handCards[0].visibility).toBe("HIDDEN");
      expect((p1Vm.handCards[0] as any).code).toBeUndefined();
      expect(p1Vm.lifeDisplay).toBe("10以上");
      expect(p1Vm.lifeCount).toBeUndefined();
    });
  });

  describe("3. ViewerAwareGameEventFormatter のログ秘密情報保護", () => {
    it("Human=p1 のとき、AI (p2) のライフ減少ログで残りライフが10枚以上なら '10以上' と表記されること", () => {
      const prevState = createMockStateWithSecrets(); // p2 life: 14
      const nextState = createMockStateWithSecrets();
      nextState.players.p2.life = Array(11).fill({ id: "l-p2", suit: "S", rank: 10 }); // p2 life: 11 (3 damage)

      const logs = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState, "p1");
      const damageLog = logs.find((l) => l.message.includes("[DAMAGE] Player B"));

      expect(damageLog).toBeDefined();
      expect(damageLog!.message).toContain("残りライフ: 10枚以上");
      expect(damageLog!.message).not.toContain("11枚");
    });

    it("Human=p1 のとき、AI (p2) のコスト手札破棄ログでカードコードが漏洩せず枚数のみ表示されること", () => {
      const prevState = createMockStateWithSecrets();
      const nextState = createMockStateWithSecrets();

      // p2 が手札 c4 (S10) をコスト破棄してステージにリクエストを積載
      nextState.stage.requests = [
        {
          id: "req-cost-1",
          controller: "p2",
          selectedCostPayment: {
            discardedCardIds: ["c4"],
          },
        },
      ];

      const logs = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState, "p1");
      const costLog = logs.find((l) => l.message.includes("[COST]"));

      expect(costLog).toBeDefined();
      expect(costLog!.message).toContain("手札破棄: 1枚 → 墓地");
      expect(costLog!.message).not.toContain("S10");
      expect(costLog!.message).not.toContain("♠10");
    });

    it("Human=p1 自身のコスト手札破棄はカードコードが表示されること", () => {
      const prevState = createMockStateWithSecrets();
      const nextState = createMockStateWithSecrets();

      // p1 が手札 c1 (H1) を破棄
      nextState.stage.requests = [
        {
          id: "req-cost-2",
          controller: "p1",
          selectedCostPayment: {
            discardedCardIds: ["c1"],
          },
        },
      ];

      const logs = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState, "p1");
      const costLog = logs.find((l) => l.message.includes("[COST]"));

      expect(costLog).toBeDefined();
      expect(costLog!.message).toContain("♡1");
    });

    it("Human=p2 / AI=p1 の逆方向でも AI (p1) のライフ・破棄カードが保護されること", () => {
      const prevState = createMockStateWithSecrets();
      const nextState = createMockStateWithSecrets();
      nextState.players.p1.life = Array(10).fill({ id: "l-p1", suit: "H", rank: 1 });
      nextState.stage.requests = [
        {
          id: "req-cost-3",
          controller: "p1",
          selectedCostPayment: {
            discardedCardIds: ["c1", "c2"],
          },
        },
      ];

      const logs = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState, "p2");
      const damageLog = logs.find((l) => l.message.includes("[DAMAGE] Player A"));
      const costLog = logs.find((l) => l.message.includes("[COST]"));

      expect(damageLog!.message).toContain("残りライフ: 10枚以上");
      expect(costLog!.message).toContain("手札破棄: 2枚 → 墓地");
      expect(costLog!.message).not.toContain("H1");
      expect(costLog!.message).not.toContain("H2");
    });
  });

  describe("4. AI Step Observation と Normal Human UI の完全隔離", () => {
    it("AI (p2) の DecisionRequest.observation は p2 視点だが、UI では humanSeat(p1) 視点を維持すること", () => {
      const state = createMockStateWithSecrets();

      // AI に渡される request.observation (AI = p2 視点)
      const aiRequestObservation = ObservationFactory.createObservation(state, "p2");
      // UI 通常盤面に渡すべき humanObservation (Human = p1 視点)
      const normalUiObservation = ObservationFactory.createObservation(state, "p1");

      // AI 側観測では AI 自身の手札が Known
      const aiObsP2 = aiRequestObservation.players.find((p) => p.playerId === "p2");
      expect(aiObsP2!.handCards[0].visibility).toBe("KNOWN");

      // Normal UI 側観測では AI の手札は完全に Hidden
      const uiObsP2 = normalUiObservation.players.find((p) => p.playerId === "p2");
      expect(uiObsP2!.handCards[0].visibility).toBe("HIDDEN");

      // 戦闘関係プレゼンテーションも normalUiObservation を基準として正常構築されること
      const relationMap = BattleRelationPresenter.buildPresentationMap(state, normalUiObservation);
      expect(relationMap).toBeDefined();
    });
  });
});
