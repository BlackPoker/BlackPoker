import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import { GameSession } from "../../engine/session/GameSession";
import { RulePackage } from "../../domain/rules/RulePackage";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { calculateBlackjackScore } from "../../engine/rules/commandHandlers";

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

    it("2.4: ヒット選択後にバースト（22点以上）した場合、全公開カードが墓地へ移動して終了すること", () => {
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

      // 3枚目めくりで25点（バースト）！Decision要求なく即時墓地送りで終了
      resolveStageToEmpty(session);

      // 検証:
      // 公開カード ♠10, ♡K, ♣5 がすべて墓地に移動していること
      expect(session.state.players.p1.grave.some((c: any) => c.id === "c-l-s10")).toBe(true);
      expect(session.state.players.p1.grave.some((c: any) => c.id === "c-l-hk")).toBe(true);
      expect(session.state.players.p1.grave.some((c: any) => c.id === "c-l-c5")).toBe(true);
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
  });
});
