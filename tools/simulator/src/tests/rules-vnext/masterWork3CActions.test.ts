import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import { GameSession } from "../../engine/session/GameSession";
import { RulePackage } from "../../domain/rules/RulePackage";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { calculateBlackjackScore } from "../../engine/rules/commandHandlers";
import { hasHaste, isLegalAttackerCandidate } from "../../engine/rules/characterUtils";

describe("作業3C: マスターアクション（徴募・B・J）統合検証", () => {
  let masterRulePackage: RulePackage;

  beforeEach(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const basePackage = await loadRulePackageFromDirectory(rulesDir);
    const catalog = await loadRegulationCatalog();
    const format = catalog.formats.get("mast")!;
    const regulation = catalog.regulations.get("mast-strategy")!;
    const frame = catalog.frames.get("strategy")!;

    masterRulePackage = RegulationRulePackageSelector.selectRulePackage(
      basePackage,
      format,
      regulation,
      frame
    );
  });

  function createBaseState(): any {
    return {
      stateVersion: 1,
      turn: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      focusPlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          graveTopCardId: undefined,
        },
        p2: {
          name: "Player 2",
          life: [
            { id: "p2-l1", suit: "H", rank: "A", value: 1 },
            { id: "p2-l2", suit: "H", rank: "2", value: 2 },
            { id: "p2-l3", suit: "H", rank: "3", value: 3 },
          ],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          graveTopCardId: undefined,
        },
      },
      stage: { requests: [] },
      pendingGraveTopSelections: [],
    };
  }

  function resolveStageToEmpty(session: GameSession): any {
    let step: any;
    while (session.state.stage && session.state.stage.requests && session.state.stage.requests.length > 0) {
      step = session.advance();
      if (step.type === "FINISHED") return step;
      if (step.type !== "WAITING_FOR_DECISION") break;
      const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passRef < 0) break;
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passRef,
      });
      if (step.type === "FINISHED") return step;
    }
    return step;
  }

  // ==========================================================================
  // 1. 徴募 (action.recruit)
  // ==========================================================================
  describe("1. action.recruit (徴募)", () => {
    it("1.1: YAML 定義が正しく読み込まれ、uncounterable: true, cost: BB, key: ♢A..10 x 2 であること", () => {
      const action = masterRulePackage.actions.find((a) => a.id === "action.recruit");
      expect(action).toBeDefined();
      expect(action?.uncounterable).toBe(true);
      expect(action?.cost).toBe("BB");
      expect(action?.key?.count).toBe(2);
      expect(action?.key?.condition?.card?.suit).toBe("diamond");
      expect(action?.key?.condition?.card?.rank).toBe("A..10");
    });

    it("1.2: 4枚めくり、キーカード合計値以下のカードが兵士（ドライブ状態）として場に出ること", () => {
      const state = createBaseState();
      // p1 の防壁（コスト BB 用）
      state.players.p1.field = [
        {
          unitId: "u-bw-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-1", suit: "D", rank: "2", value: 2 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-bw-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-2", suit: "D", rank: "3", value: 3 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
      ];
      // p1 の手札: ♢3 + ♢4 (合計 7)
      state.players.p1.hand = [
        { id: "c-d-3", suit: "D", rank: "3", value: 3 },
        { id: "c-d-4", suit: "D", rank: "4", value: 4 },
      ];
      // p1 のライフ（先頭から4枚めくる）:
      // - ♠5 (<= 7 なので兵士化)
      // - ♡7 (<= 7 なので兵士化)
      // - ♣8 (> 7 なので超過: 1枚だけなので自動ライフBOT戻し)
      // - ♠2 (<= 7 なので兵士化)
      // - ♡K (5枚目: めくられない)
      state.players.p1.life = [
        { id: "c-l-s5", suit: "S", rank: "5", value: 5 },
        { id: "c-l-h7", suit: "H", rank: "7", value: 7 },
        { id: "c-l-c8", suit: "C", rank: "8", value: 8 },
        { id: "c-l-s2", suit: "S", rank: "2", value: 2 },
        { id: "c-l-hk", suit: "H", rank: "K", value: 13 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      const recruitRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.recruit";
      });
      expect(recruitRef).toBeGreaterThanOrEqual(0);

      // p1 が徴募を提出
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: recruitRef,
      });

      // ステージ解決
      resolveStageToEmpty(session);

      // 検証:
      // 1. 兵士が3体場に出ていること（♠5, ♡7, ♠2）かつ状態は drive
      const soldiers = session.state.players.p1.field.filter((u: any) => u.componentId === "character.soldier");
      expect(soldiers).toHaveLength(3);
      expect(soldiers.every((u: any) => u.state === "drive")).toBe(true);
      expect(soldiers.every((u: any) => u.face === "up")).toBe(true);
      expect(soldiers.map((u: any) => u.cards[0].id).sort()).toEqual(["c-l-c8", "c-l-h7", "c-l-s2", "c-l-s5"].filter(id => id !== "c-l-c8").sort());

      // 2. 超過カード（♣8）がライフBOTへ戻され、元々の5枚目（♡K）の後に配置されていること
      // 元のライフ: [♠5, ♡7, ♣8, ♠2, ♡K] -> 4枚めくられ [♡K] が残り、超過カード [♣8] がBOTに追加 -> [♡K, ♣8]
      expect(session.state.players.p1.life.map((c: any) => c.id)).toEqual(["c-l-hk", "c-l-c8"]);
    });

    it("1.3: 超過カードが2枚以上の場合、順序選択（selectionType: order）が要求され、指定順にライフBOTへ戻されること", () => {
      const state = createBaseState();
      state.players.p1.field = [
        {
          unitId: "u-bw-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-1", suit: "D", rank: "2", value: 2 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-bw-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-2", suit: "D", rank: "3", value: 3 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
      ];
      // p1 の手札: ♢2 + ♢3 (合計 5)
      state.players.p1.hand = [
        { id: "c-d-2", suit: "D", rank: "2", value: 2 },
        { id: "c-d-3", suit: "D", rank: "3", value: 3 },
      ];
      // p1 のライフ:
      // - ♠3 (<= 5: 兵士化)
      // - ♣6 (> 5: 超過A)
      // - ♡8 (> 5: 超過B)
      // - ♠2 (<= 5: 兵士化)
      // - ♢K (残ライフBOT)
      state.players.p1.life = [
        { id: "c-l-s3", suit: "S", rank: "3", value: 3 },
        { id: "c-l-c6", suit: "C", rank: "6", value: 6 },
        { id: "c-l-h8", suit: "H", rank: "8", value: 8 },
        { id: "c-l-s2", suit: "S", rank: "2", value: 2 },
        { id: "c-l-dk", suit: "D", rank: "K", value: 13 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      const recruitRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.recruit";
      });
      expect(recruitRef).toBeGreaterThanOrEqual(0);

      // p1 が徴募を提出
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: recruitRef,
      });

      // 連続パスでステージ解決を進める
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "recruitUnitsFromLife") {
          // 順序選択Decisionに到達！
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        expect(passRef).toBeGreaterThanOrEqual(0);
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      // 順序選択の検証
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.effectStepId).toBe("recruitUnitsFromLife");
      expect(step.request.catalog.orderSelections).toBeDefined();
      expect(step.request.catalog.orderSelections.length).toBeGreaterThan(0);

      // 候補カードに ♣6 と ♡8 が含まれていること
      const pickH8Ref = step.request.patterns.findIndex((p: any) => {
        const ordSel = step.request.catalog.orderSelections?.[p.orderSelectionRef];
        return ordSel?.orderedIds?.includes("c-l-h8") || ordSel?.summary?.includes("8");
      });
      expect(pickH8Ref).toBeGreaterThanOrEqual(0);

      // ♡8 を先に選択提出
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: pickH8Ref,
      });

      // 2枚のうち1枚選んだため、残り1枚（♣6）は自動確定して完了する
      resolveStageToEmpty(session);

      // 検証:
      // 兵士2体（♠3, ♠2）がドライブで配置
      const soldiers = session.state.players.p1.field.filter((u: any) => u.componentId === "character.soldier");
      expect(soldiers).toHaveLength(2);

      // ライフBOT: [♢K] の後ろに、選んだ順 [♡8, ♣6] が追加されていること
      expect(session.state.players.p1.life.map((c: any) => c.id)).toEqual(["c-l-dk", "c-l-h8", "c-l-c6"]);
    });

    it("1.4: ライフが4枚未満（2枚）の場合、あるだけの枚数をめくって正常に動作すること", () => {
      const state = createBaseState();
      state.players.p1.field = [
        {
          unitId: "u-bw-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-1", suit: "D", rank: "2", value: 2 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-bw-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-2", suit: "D", rank: "3", value: 3 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
      ];
      state.players.p1.hand = [
        { id: "c-d-2", suit: "D", rank: "2", value: 2 },
        { id: "c-d-3", suit: "D", rank: "3", value: 3 },
      ];
      // ライフが2枚のみ（♠2, ♣9）
      state.players.p1.life = [
        { id: "c-l-s2", suit: "S", rank: "2", value: 2 },
        { id: "c-l-c9", suit: "C", rank: "9", value: 9 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      const recruitRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.recruit";
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: recruitRef,
      });

      resolveStageToEmpty(session);

      // ♠2 は兵士化、♣9 は超過1枚なので自動ライフBOT戻し
      const soldiers = session.state.players.p1.field.filter((u: any) => u.componentId === "character.soldier");
      expect(soldiers).toHaveLength(1);
      expect(soldiers[0].cards[0].id).toBe("c-l-s2");
      expect(session.state.players.p1.life.map((c: any) => c.id)).toEqual(["c-l-c9"]);
    });

    it("1.5: 適格カードが0枚の場合、全カードがライフBOTへ戻ること", () => {
      const state = createBaseState();
      state.players.p1.field = [
        {
          unitId: "u-bw-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-1", suit: "D", rank: "2", value: 2 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-bw-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-2", suit: "D", rank: "3", value: 3 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
      ];
      // ♢A + ♢A (合計 2)
      state.players.p1.hand = [
        { id: "c-d-a1", suit: "D", rank: "A", value: 1 },
        { id: "c-d-a2", suit: "D", rank: "A", value: 1 },
      ];
      // ライフ5枚: 4枚めくられ全て超過 (val > 2) + 生存用ライフ1枚 (c-l-survive)
      state.players.p1.life = [
        { id: "c-l-s5", suit: "S", rank: "5", value: 5 },
        { id: "c-l-h6", suit: "H", rank: "6", value: 6 },
        { id: "c-l-c7", suit: "C", rank: "7", value: 7 },
        { id: "c-l-d8", suit: "D", rank: "8", value: 8 },
        { id: "c-l-survive", suit: "S", rank: "K", value: 13 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const recruitRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.recruit";
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: recruitRef,
      });

      // 連続パスで解決
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "recruitUnitsFromLife") {
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      // 超過カードの順序選択が完了するまで提出
      while (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "recruitUnitsFromLife") {
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: 0,
        });
      }

      resolveStageToEmpty(session);

      // 兵士は0体
      const soldiers = session.state.players.p1.field.filter((u: any) => u.componentId === "character.soldier");
      expect(soldiers).toHaveLength(0);
      // ライフには元々の1枚 + 戻った4枚で5枚
      expect(session.state.players.p1.life).toHaveLength(5);
    });

    it("1.6: 適格カードのランクに応じた正確なコンポーネント解決（A→ace, 2..10→soldier, J..K→hero, Joker→magician）、ドライブ状態、召喚酔い、速攻、カード保存則の検証", () => {
      const state = createBaseState();
      state.players.p1.field = [
        {
          unitId: "u-bw-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-1", suit: "D", rank: "2", value: 2 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-bw-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-2", suit: "D", rank: "3", value: 3 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
      ];
      // ♢10 + ♢10 (合計 20: 全カードが適格上限内)
      state.players.p1.hand = [
        { id: "c-d-10a", suit: "D", rank: "10", value: 10 },
        { id: "c-d-10b", suit: "D", rank: "10", value: 10 },
      ];
      // ライフ: A, 5, K, Joker の4種別を配置 + 生存用ライフ1枚
      state.players.p1.life = [
        { id: "c-l-sa", suit: "S", rank: "A", value: 1 },
        { id: "c-l-h5", suit: "H", rank: "5", value: 5 },
        { id: "c-l-ck", suit: "C", rank: "K", value: 13 },
        { id: "c-l-jk", suit: "J", rank: "Joker", value: 0 },
        { id: "c-l-survive", suit: "D", rank: "2", value: 2 },
      ];

      const initialTotalCards =
        state.players.p1.hand.length +
        state.players.p1.field.length +
        state.players.p1.life.length;

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const recruitRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.recruit";
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: recruitRef,
      });

      resolveStageToEmpty(session);

      // 1. 各カードのコンポーネント解決検証
      const fieldUnits = session.state.players.p1.field;

      // A -> character.ace
      const aceUnit = fieldUnits.find((u: any) => u.cards[0]?.id === "c-l-sa");
      expect(aceUnit).toBeDefined();
      expect(aceUnit.componentId).toBe("character.ace");
      expect(aceUnit.kind).toBe("エース");
      expect(aceUnit.state).toBe("drive");
      expect(aceUnit.face).toBe("up");
      expect(aceUnit.enteredFieldTurn).toBe(1);

      // 5 -> character.soldier
      const soldierUnit = fieldUnits.find((u: any) => u.cards[0]?.id === "c-l-h5");
      expect(soldierUnit).toBeDefined();
      expect(soldierUnit.componentId).toBe("character.soldier");
      expect(soldierUnit.kind).toBe("一般兵");
      expect(soldierUnit.state).toBe("drive");
      expect(soldierUnit.face).toBe("up");
      expect(soldierUnit.enteredFieldTurn).toBe(1);

      // K -> character.hero
      const heroUnit = fieldUnits.find((u: any) => u.cards[0]?.id === "c-l-ck");
      expect(heroUnit).toBeDefined();
      expect(heroUnit.componentId).toBe("character.hero");
      expect(heroUnit.kind).toBe("英雄");
      expect(heroUnit.state).toBe("drive");
      expect(heroUnit.face).toBe("up");
      expect(heroUnit.enteredFieldTurn).toBe(1);

      // Joker -> character.magician
      const magicianUnit = fieldUnits.find((u: any) => u.cards[0]?.id === "c-l-jk");
      expect(magicianUnit).toBeDefined();
      expect(magicianUnit.componentId).toBe("character.magician");
      expect(magicianUnit.kind).toBe("魔術士");
      expect(magicianUnit.state).toBe("drive");
      expect(magicianUnit.face).toBe("up");
      expect(magicianUnit.enteredFieldTurn).toBe(1);

      // 2. 速攻（hasHaste）と召喚酔い（isLegalAttackerCandidate）の検証
      // エースは速攻を保持するため、召喚ターンでもアタッカー候補になれる
      expect(hasHaste(aceUnit, masterRulePackage.components)).toBe(true);
      expect(isLegalAttackerCandidate({ ...aceUnit, state: "charge" }, masterRulePackage.components, 1)).toBe(true);

      // 一般兵、英雄は速攻を持たないため、召喚ターンには攻撃不可（召喚酔い）
      expect(hasHaste(soldierUnit, masterRulePackage.components)).toBe(false);
      expect(isLegalAttackerCandidate({ ...soldierUnit, state: "charge" }, masterRulePackage.components, 1)).toBe(false);

      expect(hasHaste(heroUnit, masterRulePackage.components)).toBe(false);
      expect(isLegalAttackerCandidate({ ...heroUnit, state: "charge" }, masterRulePackage.components, 1)).toBe(false);

      // 魔術士は公式ルール上速攻（haste）を持つため、召喚ターンでもアタッカー候補になれる
      expect(hasHaste(magicianUnit, masterRulePackage.components)).toBe(true);
      expect(isLegalAttackerCandidate({ ...magicianUnit, state: "charge" }, masterRulePackage.components, 1)).toBe(true);

      // 3. カード保存則（Total Card Count Invariant）の検証
      // ライフから減った4枚が過不足なくフィールドに配置され、キーカード2枚は墓地へ送られている
      const finalTotalCards =
        session.state.players.p1.hand.length +
        session.state.players.p1.field.reduce((sum: number, u: any) => sum + (u.cards?.length || 0), 0) +
        session.state.players.p1.life.length +
        session.state.players.p1.grave.reduce((sum: number, g: any) => sum + (Array.isArray(g.cards) ? g.cards.length : 1), 0);
      expect(finalTotalCards).toBe(initialTotalCards);
    });
  });

  // ==========================================================================
  // 2. B・J (action.bj)
  // ==========================================================================
  describe("2. action.bj (B・J)", () => {
    it("2.1: calculateBlackjackScore の単体計算ロジック検証", () => {
      // A単体 = 11
      expect(calculateBlackjackScore([{ rank: "A", value: 1 }])).toBe(11);
      // A + 9 = 20
      expect(calculateBlackjackScore([{ rank: "A", value: 1 }, { rank: "9", value: 9 }])).toBe(20);
      // A + 9 + 5 = 15 (25 >= 22 なので A が 1 点に)
      expect(calculateBlackjackScore([
        { rank: "A", value: 1 },
        { rank: "9", value: 9 },
        { rank: "5", value: 5 },
      ])).toBe(15);
      // A + A = 12 (11 + 1)
      expect(calculateBlackjackScore([
        { rank: "A", value: 1 },
        { rank: "A", value: 1 },
      ])).toBe(12);
      // A + A + 10 = 12 (1 + 1 + 10)
      expect(calculateBlackjackScore([
        { rank: "A", value: 1 },
        { rank: "A", value: 1 },
        { rank: "10", value: 10 },
      ])).toBe(12);
      // JQK = 10, Joker = 0
      expect(calculateBlackjackScore([
        { rank: "J", value: 11 },
        { rank: "Q", value: 12 },
        { rank: "JOKER", value: 0 },
      ])).toBe(20);
      // 10 + 6 + 6 = 22 (バースト)
      expect(calculateBlackjackScore([
        { rank: "10", value: 10 },
        { rank: "6", value: 6 },
        { rank: "6", value: 6 },
      ])).toBe(22);
    });

    it("2.1.2: A → A → 10 のめくり順序において、動的再評価方式によりバーストを回避し、12点でスタンドして手札に加えられること（逐次加算方式との差異保証）", () => {
      const state = createBaseState();
      state.players.p1.hand = [
        { id: "c-a", suit: "S", rank: "A", value: 1 },
        { id: "c-j", suit: "H", rank: "J", value: 11 },
      ];
      // ライフ構成:
      // 1枚目: ♠A (11点)
      // 2枚目: ♡A (動的再評価で 11 + 1 = 12点)
      // 3枚目: ♠10 (動的再評価で 1 + 1 + 10 = 12点。逐次加算方式なら 12 + 10 = 22 でバースト)
      // 4枚目: 生存用ライフ
      state.players.p1.life = [
        { id: "c-l-sa", suit: "S", rank: "A", value: 1 },
        { id: "c-l-ha", suit: "H", rank: "A", value: 1 },
        { id: "c-l-s10", suit: "S", rank: "10", value: 10 },
        { id: "c-l-survive", suit: "D", rank: "2", value: 2 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      const bjRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.bj";
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: bjRef,
      });

      // パスでステージを進めて 1枚目めくり後（♠A = 11点）の選択へ
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "playBlackjack") {
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      // 1回目選択: ヒットを選択 (♡A をめくる)
      const hitRef1 = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      expect(hitRef1).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: hitRef1,
      });

      // 2回目選択へ到達（1枚目A + 2枚目A = 12点）
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.effectStepId).toBe("playBlackjack");

      // 2回目選択: ヒットを選択 (♠10 をめくる)
      const hitRef2 = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      expect(hitRef2).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: hitRef2,
      });

      // 3回目選択へ到達（動的再評価により A+A+10 = 1+1+10 = 12点。バーストせず選択肢が提示される！）
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.effectStepId).toBe("playBlackjack");

      // 3回目選択: スタンドを選択
      const standRef = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "stand" || p.patternId?.includes("stand");
      });
      expect(standRef).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: standRef,
      });

      resolveStageToEmpty(session);

      // めくられた3枚すべて（♠A, ♡A, ♠10）が手札に加わっていること
      expect(session.state.players.p1.hand.some((c: any) => c.id === "c-l-sa")).toBe(true);
      expect(session.state.players.p1.hand.some((c: any) => c.id === "c-l-ha")).toBe(true);
      expect(session.state.players.p1.hand.some((c: any) => c.id === "c-l-s10")).toBe(true);
      // ライフには生存用ライフのみ残る
      expect(session.state.players.p1.life.map((c: any) => c.id)).toEqual(["c-l-survive"]);
    });

    it("2.1.3: A → 2 → 9 のめくり順序において、動的再評価方式により12点でスタンドできること", () => {
      const state = createBaseState();
      state.players.p1.hand = [
        { id: "c-a", suit: "S", rank: "A", value: 1 },
        { id: "c-j", suit: "H", rank: "J", value: 11 },
      ];
      // ライフ構成:
      // 1枚目: ♠A (11点)
      // 2枚目: ♠2 (11 + 2 = 13点)
      // 3枚目: ♠9 (動的再評価で 1 + 2 + 9 = 12点。バースト回避)
      // 4枚目: 生存用ライフ
      state.players.p1.life = [
        { id: "c-l-sa", suit: "S", rank: "A", value: 1 },
        { id: "c-l-s2", suit: "S", rank: "2", value: 2 },
        { id: "c-l-s9", suit: "S", rank: "9", value: 9 },
        { id: "c-l-survive", suit: "D", rank: "2", value: 2 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const bjRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.bj";
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: bjRef,
      });

      // パスでステージを進めて1枚目めくり後へ
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "playBlackjack") {
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      // 1回目選択: ヒット (♠2 をめくる -> 13点)
      const hitRef1 = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: hitRef1,
      });

      // 2回目選択: ヒット (♠9 をめくる -> 動的再評価で 1+2+9 = 12点)
      const hitRef2 = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: hitRef2,
      });

      // 3回目選択: スタンド
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const standRef = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "stand" || p.patternId?.includes("stand");
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: standRef,
      });

      resolveStageToEmpty(session);

      expect(session.state.players.p1.hand.some((c: any) => c.id === "c-l-sa")).toBe(true);
      expect(session.state.players.p1.hand.some((c: any) => c.id === "c-l-s2")).toBe(true);
      expect(session.state.players.p1.hand.some((c: any) => c.id === "c-l-s9")).toBe(true);
      expect(session.state.players.p1.life.map((c: any) => c.id)).toEqual(["c-l-survive"]);
    });

    it("2.2: YAML 定義が正しく読み込まれ、キーカード A と J、タイミング quick、コストなしであること", () => {
      const action = masterRulePackage.actions.find((a) => a.id === "action.bj");
      expect(action).toBeDefined();
      expect(action?.cost).toBeUndefined();
      expect(action?.request?.timing).toBe("quick");
      expect(action?.key?.count).toBe(2);
      expect(action?.key?.conditions).toHaveLength(2);
      expect(action?.key?.conditions?.[0]?.card?.rank).toBe("A");
      expect(action?.key?.conditions?.[1]?.card?.rank).toBe("J");
    });

    it("2.3: スタンド選択時、公開カードがすべて手札に加えられて終了すること", () => {
      const state = createBaseState();
      state.players.p1.hand = [
        { id: "c-a", suit: "S", rank: "A", value: 1 },
        { id: "c-j", suit: "H", rank: "J", value: 11 },
      ];
      // ライフ: 1枚目 ♠8、2枚目 ♡K
      state.players.p1.life = [
        { id: "c-l-s8", suit: "S", rank: "8", value: 8 },
        { id: "c-l-hk", suit: "H", rank: "K", value: 13 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      const bjRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.bj";
      });
      expect(bjRef).toBeGreaterThanOrEqual(0);

      // p1 が BJ を提出
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: bjRef,
      });

      // 連続パスでステージ解決を進める
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "playBlackjack") {
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      // ヒット／スタンド選択の提示
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.effectStepId).toBe("playBlackjack");
      expect(step.request.catalog.effectSelections).toBeDefined();
      expect(step.request.catalog.effectSelections[0].selectionType).toBe("option");

      // スタンドを選択
      const standRef = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "stand" || p.patternId?.includes("stand");
      });
      expect(standRef).toBeGreaterThanOrEqual(0);

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: standRef,
      });

      resolveStageToEmpty(session);

      // 検証: めくられた ♠8 が手札に加わっていること
      expect(session.state.players.p1.hand.some((c: any) => c.id === "c-l-s8")).toBe(true);
      // ライフには残りの ♡K のみ存在
      expect(session.state.players.p1.life.map((c: any) => c.id)).toEqual(["c-l-hk"]);
    });

    it("2.4: ヒット選択後にバースト（22点以上）した場合、ZONE_TOP_SELECTION が発生し、選択したカードが墓地TOPになること", () => {
      const state = createBaseState();
      state.players.p1.hand = [
        { id: "c-a", suit: "S", rank: "A", value: 1 },
        { id: "c-j", suit: "H", rank: "J", value: 11 },
      ];
      // ライフ: 1枚目 ♠10 (10点)、2枚目 ♡K (10点 -> 合計20点)、3枚目 ♣5 (5点 -> 合計25点: バースト！)、4枚目 生存用ライフ
      state.players.p1.life = [
        { id: "c-l-s10", suit: "S", rank: "10", value: 10 },
        { id: "c-l-hk", suit: "H", rank: "K", value: 13 },
        { id: "c-l-c5", suit: "C", rank: "5", value: 5 },
        { id: "c-l-survive", suit: "D", rank: "A", value: 1 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();

      const bjRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.bj";
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: bjRef,
      });

      // パスして解決開始
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "playBlackjack") {
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      // 1回目の選択 (10点): ヒットを選択
      expect(step.request.source?.effectStepId).toBe("playBlackjack");
      const hitRef1 = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      expect(hitRef1).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: hitRef1,
      });

      // 2回目の選択 (20点): 再びヒットを選択
      expect(step.request.source?.effectStepId).toBe("playBlackjack");
      const hitRef2 = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
      });
      expect(hitRef2).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: hitRef2,
      });

      // 3枚目めくりで25点（バースト）！
      // 複数枚（3枚）のカードが同時に墓地へ送られたため、GraveTopCoordinator により墓地TOP選択が要求される
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("ZONE_TOP_SELECTION");
      expect(session.state.pendingGraveTopSelections).toHaveLength(1);
      expect(session.state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["c-l-s10", "c-l-hk", "c-l-c5"]);
      expect(step.request.catalog.effectSelections).toHaveLength(3);

      // ♣5 (c-l-c5) を墓地TOPとして選択
      const topSelectRef = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.includes("c-l-c5");
      });
      expect(topSelectRef).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: topSelectRef,
      });

      // バースト墓地TOP選択後の検証:
      // 1. バースト分の ZONE_TOP_SELECTION により ♣5 が墓地TOPに設定されたことが zone.top.changed ログに記録されていること
      const topChangedLogsBeforeKey = session.logRecorder.getEvents().filter((l: any) => l.type === "zone.top.changed");
      expect(topChangedLogsBeforeKey.some((l: any) => l.cardId === "c-l-c5" && l.playerId === "p1")).toBe(true);

      // 2. 続いて、action.bj 自身の2枚キーカード (c-a, c-j) 同時墓地移動に伴う別バッチの ZONE_TOP_SELECTION が要求されること
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("ZONE_TOP_SELECTION");
      expect(step.request.playerId).toBe("p1");
      expect(session.state.pendingGraveTopSelections).toHaveLength(1);
      expect(session.state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["c-a", "c-j"]);

      // キーカードの中から c-j を墓地TOPとして選択
      const keyTopRef = step.request.patterns.findIndex((p: any) => {
        const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
        return effSel?.selectedValues?.includes("c-j");
      });
      expect(keyTopRef).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: keyTopRef,
      });

      // 3. pendingGraveTopSelections が完全に解消され、最終墓地TOPが c-j になること
      expect(session.state.pendingGraveTopSelections).toHaveLength(0);
      expect(session.state.players.p1.graveTopCardId).toBe("c-j");
      // 4. 公開カード ♠10, ♡K, ♣5 がすべて墓地に移動していること（Identity保持）
      const graveCardIds = session.state.players.p1.grave.map((c: any) => c.id);
      expect(graveCardIds).toContain("c-l-s10");
      expect(graveCardIds).toContain("c-l-hk");
      expect(graveCardIds).toContain("c-l-c5");
      expect(graveCardIds).toContain("c-a");
      expect(graveCardIds).toContain("c-j");

      // ステージ解決完了
      resolveStageToEmpty(session);

      // 手札には加わっていないこと
      expect(session.state.players.p1.hand.some((c: any) => c.id === "c-l-s10")).toBe(false);
      // ライフは生存用の1枚
      expect(session.state.players.p1.life).toHaveLength(1);
      expect(session.state.players.p1.life[0].id).toBe("c-l-survive");
    });

    it("2.5: ライフが尽きた（ライフ0枚）場合、引けないため自動的にスタンド扱いとなり手札に加わること", () => {
      const state = createBaseState();
      state.players.p1.hand = [
        { id: "c-a", suit: "S", rank: "A", value: 1 },
        { id: "c-j", suit: "H", rank: "J", value: 11 },
      ];
      // ライフは1枚のみ (♠7)
      state.players.p1.life = [
        { id: "c-l-s7", suit: "S", rank: "7", value: 7 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();

      const bjRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.bj";
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: bjRef,
      });

      // 解決へ
      resolveStageToEmpty(session);

      // ライフ1枚めくった時点で残りライフ0枚のため、ヒット／スタンド選択なく自動スタンド
      expect(session.state.players.p1.hand.some((c: any) => c.id === "c-l-s7")).toBe(true);
      expect(session.state.players.p1.life).toHaveLength(0);
    });

    it("2.6: BJシナリオが Canonical Match Log / 決定列から決定論的に Replay 再現できること", () => {
      const state = createBaseState();
      state.players.p1.hand = [
        { id: "c-a", suit: "S", rank: "A", value: 1 },
        { id: "c-j", suit: "H", rank: "J", value: 11 },
      ];
      state.players.p1.life = [
        { id: "c-l-s8", suit: "S", rank: "8", value: 8 },
        { id: "c-l-h7", suit: "H", rank: "7", value: 7 },
        { id: "c-l-dk", suit: "D", rank: "K", value: 13 },
      ];

      const initialSnapshot = JSON.parse(JSON.stringify(state));
      const session1 = new GameSession(state, masterRulePackage);
      const recordedDecisions: any[] = [];

      let step1: any = session1.advance();
      while (step1.type === "WAITING_FOR_DECISION") {
        let chosenRef = 0;
        if (step1.request.playerId === "p1" && recordedDecisions.length === 0) {
          chosenRef = step1.request.patterns.findIndex((p: any) => {
            const act = step1.request.catalog.actions[p.actionSelectionRef];
            return act?.actionId === "action.bj";
          });
        } else if (step1.request.source?.effectStepId === "playBlackjack") {
          // スタンドを選択
          chosenRef = step1.request.patterns.findIndex((p: any) => {
            const effSel = step1.request.catalog.effectSelections?.[p.effectSelectionRef];
            return effSel?.selectedValues?.[0] === "stand" || p.patternId?.includes("stand");
          });
          if (chosenRef < 0) chosenRef = 0;
        } else {
          chosenRef = step1.request.patterns.findIndex((p: any) => p.kind === "PASS");
          if (chosenRef < 0) chosenRef = 0;
        }

        recordedDecisions.push({
          decisionId: step1.request.decisionId,
          stateVersion: step1.request.stateVersion,
          selectedPatternRef: chosenRef,
        });

        step1 = session1.submitDecision({
          decisionId: step1.request.decisionId,
          stateVersion: step1.request.stateVersion,
          selectedPatternRef: chosenRef,
        });

        if (session1.state.stage.requests.length === 0 && recordedDecisions.length >= 3) {
          break;
        }
      }

      // Replay 実行
      const session2 = new GameSession(JSON.parse(JSON.stringify(initialSnapshot)), masterRulePackage);
      let step2: any = session2.advance();
      for (const dec of recordedDecisions) {
        expect(step2.type).toBe("WAITING_FOR_DECISION");
        expect(step2.request.stateVersion).toBe(dec.stateVersion);
        step2 = session2.submitDecision({
          decisionId: step2.request.decisionId,
          stateVersion: step2.request.stateVersion,
          selectedPatternRef: dec.selectedPatternRef,
        });
      }

      // 完全一致を検証
      expect(session2.state.stateVersion).toBe(session1.state.stateVersion);
      expect(session2.state.players.p1.hand).toEqual(session1.state.players.p1.hand);
      expect(session2.state.players.p1.life).toEqual(session1.state.players.p1.life);
      expect(session2.state.players.p1.grave).toEqual(session1.state.players.p1.grave);
      expect(session2.state.stage).toEqual(session1.state.stage);
    });

    it("2.7: バースト時の墓地TOP選択を含む一連の対戦が Replay / Undo で完全再現すること", () => {
      const state = createBaseState();
      state.players.p1.hand = [
        { id: "c-a", suit: "S", rank: "A", value: 1 },
        { id: "c-j", suit: "H", rank: "J", value: 11 },
      ];
      state.players.p1.life = [
        { id: "c-l-s10", suit: "S", rank: "10", value: 10 },
        { id: "c-l-hk", suit: "H", rank: "K", value: 13 },
        { id: "c-l-c5", suit: "C", rank: "5", value: 5 },
        { id: "c-l-survive", suit: "D", rank: "A", value: 1 },
      ];

      const initialSnapshot = JSON.parse(JSON.stringify(state));
      const session = new GameSession(state, masterRulePackage);
      const recordedDecisions: any[] = [];

      let step: any = session.advance();
      while (step.type === "WAITING_FOR_DECISION") {
        let chosenRef = 0;
        if (step.request.playerId === "p1" && recordedDecisions.length === 0) {
          chosenRef = step.request.patterns.findIndex((p: any) => {
            const act = step.request.catalog.actions[p.actionSelectionRef];
            return act?.actionId === "action.bj";
          });
        } else if (step.request.source?.effectStepId === "playBlackjack") {
          // ヒットを選択
          chosenRef = step.request.patterns.findIndex((p: any) => {
            const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
            return effSel?.selectedValues?.[0] === "hit" || p.patternId?.includes("hit");
          });
          if (chosenRef < 0) chosenRef = 0;
        } else if (step.request.source?.type === "ZONE_TOP_SELECTION") {
          // 墓地TOP選択: ♣5 を選択
          chosenRef = step.request.patterns.findIndex((p: any) => {
            const effSel = step.request.catalog.effectSelections?.[p.effectSelectionRef];
            return effSel?.selectedValues?.includes("c-l-c5");
          });
          if (chosenRef < 0) chosenRef = 0;
        } else {
          chosenRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
          if (chosenRef < 0) chosenRef = 0;
        }

        recordedDecisions.push({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: chosenRef,
        });

        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: chosenRef,
        });

        if (session.state.stage.requests.length === 0 && session.state.pendingGraveTopSelections.length === 0 && recordedDecisions.length >= 4) {
          break;
        }
      }

      // 墓地TOP選択ログに ♣5 が記録されていること
      expect(session.logRecorder.getEvents().some((l: any) => l.type === "zone.top.changed" && l.cardId === "c-l-c5")).toBe(true);
      expect(session.state.players.p1.grave.map((c: any) => c.id)).toContain("c-l-c5");

      // Replay 実行
      const replaySession = new GameSession(JSON.parse(JSON.stringify(initialSnapshot)), masterRulePackage);
      let replayStep: any = replaySession.advance();
      for (const dec of recordedDecisions) {
        expect(replayStep.type).toBe("WAITING_FOR_DECISION");
        expect(replayStep.request.stateVersion).toBe(dec.stateVersion);
        replayStep = replaySession.submitDecision({
          decisionId: replayStep.request.decisionId,
          stateVersion: replayStep.request.stateVersion,
          selectedPatternRef: dec.selectedPatternRef,
        });
      }

      expect(replaySession.state.stateVersion).toBe(session.state.stateVersion);
      expect(replaySession.state.players.p1.graveTopCardId).toBe(session.state.players.p1.graveTopCardId);
      expect(replaySession.state.players.p1.grave).toEqual(session.state.players.p1.grave);
      expect(replaySession.state.players.p1.life).toEqual(session.state.players.p1.life);
    });
  });

  // ==========================================================================
  // 3. ライフ不足と中断中状態・カード保存則・Undo検証
  // ==========================================================================
  describe("3. ライフ不足と中断中状態・カード保存則・Undo検証", () => {
    it("3.1: 徴募の中断中（超過カード順序選択待ち）において、全ゲームカード保存則が厳密に成立すること", () => {
      const state = createBaseState();
      state.players.p1.field = [
        {
          unitId: "u-bw-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-1", suit: "D", rank: "2", value: 2 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-bw-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-2", suit: "D", rank: "3", value: 3 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
      ];
      state.players.p1.hand = [
        { id: "c-d-2", suit: "D", rank: "2", value: 2 },
        { id: "c-d-3", suit: "D", rank: "3", value: 3 },
      ];
      // ライフ: 2枚適格, 2枚超過, 1枚BOT
      state.players.p1.life = [
        { id: "c-l-s3", suit: "S", rank: "3", value: 3 },
        { id: "c-l-c6", suit: "C", rank: "6", value: 6 },
        { id: "c-l-h8", suit: "H", rank: "8", value: 8 },
        { id: "c-l-s2", suit: "S", rank: "2", value: 2 },
        { id: "c-l-dk", suit: "D", rank: "K", value: 13 },
      ];

      // 初期カードIDリスト（全ゾーン）
      const initialCardIds: string[] = [
        ...state.players.p1.hand.map((c: any) => c.id),
        ...state.players.p1.field.map((u: any) => u.cards[0].id),
        ...state.players.p1.life.map((c: any) => c.id),
      ].sort();

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const recruitRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.recruit";
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: recruitRef,
      });

      // 解決を進め、順序選択待ち（中断状態）に到達させる
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "recruitUnitsFromLife") {
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      expect(step.request.source?.effectStepId).toBe("recruitUnitsFromLife");

      // 中断中（順序選択待ち）のカード走査:
      // 手札 + フィールド + ライフ + 墓地 + stage上のキーカード + resolvingContext.selections._recruitExcessCards
      const currentCardsInPlay: string[] = [
        ...session.state.players.p1.hand.map((c: any) => c.id),
        ...session.state.players.p1.field.flatMap((u: any) => u.cards.map((c: any) => c.id)),
        ...session.state.players.p1.life.map((c: any) => c.id),
        ...session.state.players.p1.grave.map((c: any) => c.id),
        ...(session.state.stage?.requests?.flatMap((r: any) => r.keyCards?.map((c: any) => c.id) || []) || []),
        ...(session.resolvingContext?.selections?.["_recruitExcessCards"]?.map((c: any) => c.id) || []),
      ].sort();

      expect(currentCardsInPlay).toEqual(initialCardIds);
    });

    it("3.2: BJの中断中（ヒット／スタンド選択待ち）において、全ゲームカード保存則が厳密に成立すること", () => {
      const state = createBaseState();
      state.players.p1.hand = [
        { id: "c-a", suit: "S", rank: "A", value: 1 },
        { id: "c-j", suit: "H", rank: "J", value: 11 },
      ];
      state.players.p1.life = [
        { id: "c-l-s8", suit: "S", rank: "8", value: 8 },
        { id: "c-l-hk", suit: "H", rank: "K", value: 13 },
      ];

      const initialCardIds: string[] = [
        ...state.players.p1.hand.map((c: any) => c.id),
        ...state.players.p1.life.map((c: any) => c.id),
      ].sort();

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const bjRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.bj";
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: bjRef,
      });

      // 解決へ進め、1回目のヒット/スタンド選択待ちに到達
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "playBlackjack") {
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      expect(step.request.source?.effectStepId).toBe("playBlackjack");

      // 中断中のカード走査:
      // 手札 + ライフ + 墓地 + stage上のキーカード + resolvingContext.selections._bjCards
      const currentCardsInPlay: string[] = [
        ...session.state.players.p1.hand.map((c: any) => c.id),
        ...session.state.players.p1.life.map((c: any) => c.id),
        ...session.state.players.p1.grave.map((c: any) => c.id),
        ...(session.state.stage?.requests?.flatMap((r: any) => r.keyCards?.map((c: any) => c.id) || []) || []),
        ...(session.resolvingContext?.selections?.["_bjCards"]?.map((c: any) => c.id) || []),
      ].sort();

      expect(currentCardsInPlay).toEqual(initialCardIds);
    });

    it("3.3: BJにおけるライフ0枚時の動作検証（初期ライフ0枚での安全な即時終了）", () => {
      const state = createBaseState();
      state.players.p1.hand = [
        { id: "c-a", suit: "S", rank: "A", value: 1 },
        { id: "c-j", suit: "H", rank: "J", value: 11 },
      ];
      // ライフ0枚（本来ライフ0は敗北だが、効果解決時の境界値として安全に終了することを検証）
      state.players.p1.life = [];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();

      // 勝敗判定で即時終了するか、または合法アクションから除外されるか、あるいは実行時安全に0枚終了するか
      if (step.type === "WAITING_FOR_DECISION") {
        const bjRef = step.request.patterns.findIndex((p: any) => {
          const act = step.request.catalog.actions[p.actionSelectionRef];
          return act?.actionId === "action.bj";
        });
        if (bjRef >= 0) {
          step = session.submitDecision({
            decisionId: step.request.decisionId,
            stateVersion: step.request.stateVersion,
            selectedPatternRef: bjRef,
          });
          // クラッシュせず安全に終了すること
          expect(() => resolveStageToEmpty(session)).not.toThrow();
          expect(session.state.players.p1.hand).toHaveLength(0); // キーカード2枚が消費されたのみ
        }
      }
    });

    it("3.4: 徴募の中断中からの Undo / Snapshot 復元と再決定の完全再現性検証", () => {
      const state = createBaseState();
      state.players.p1.field = [
        {
          unitId: "u-bw-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-1", suit: "D", rank: "2", value: 2 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-bw-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-2", suit: "D", rank: "3", value: 3 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
      ];
      state.players.p1.hand = [
        { id: "c-d-2", suit: "D", rank: "2", value: 2 },
        { id: "c-d-3", suit: "D", rank: "3", value: 3 },
      ];
      state.players.p1.life = [
        { id: "c-l-s3", suit: "S", rank: "3", value: 3 },
        { id: "c-l-c6", suit: "C", rank: "6", value: 6 },
        { id: "c-l-h8", suit: "H", rank: "8", value: 8 },
        { id: "c-l-s2", suit: "S", rank: "2", value: 2 },
        { id: "c-l-dk", suit: "D", rank: "K", value: 13 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const recruitRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.recruit";
      });
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: recruitRef,
      });

      // 順序選択待ちまで進める
      while (session.state.stage.requests.length > 0) {
        if (step.type === "WAITING_FOR_DECISION" && step.request.source?.effectStepId === "recruitUnitsFromLife") {
          break;
        }
        const passRef = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passRef,
        });
      }

      expect(step.request.source?.effectStepId).toBe("recruitUnitsFromLife");

      // この中断状態の Snapshot を作成
      const snapshot = session.createSnapshot();

      // パターン0で決定を提出して完了させる
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: 0,
      });
      resolveStageToEmpty(session);
      const finalState1 = JSON.parse(JSON.stringify(session.state));

      // Snapshot からセッションを復元 (Undo 相当)
      const restoredSession = GameSession.fromSnapshot(snapshot, masterRulePackage);
      let restoredStep: any = restoredSession.advance();
      expect(restoredStep.type).toBe("WAITING_FOR_DECISION");
      expect(restoredStep.request.source?.effectStepId).toBe("recruitUnitsFromLife");

      // 再度同一の決定（パターン0）を提出
      restoredStep = restoredSession.submitDecision({
        decisionId: restoredStep.request.decisionId,
        stateVersion: restoredStep.request.stateVersion,
        selectedPatternRef: 0,
      });
      resolveStageToEmpty(restoredSession);
      const finalState2 = JSON.parse(JSON.stringify(restoredSession.state));

      // 2回の実行結果（状態、ライフ、フィールド、墓地）が完全に一致すること
      expect(finalState2.players.p1.life).toEqual(finalState1.players.p1.life);
      expect(finalState2.players.p1.field).toEqual(finalState1.players.p1.field);
      expect(finalState2.players.p1.grave).toEqual(finalState1.players.p1.grave);
      expect(finalState2.stateVersion).toBe(finalState1.stateVersion);
    });
  });
});
