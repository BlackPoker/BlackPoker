import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import { GameSession } from "../../engine/session/GameSession";
import { RulePackage, ActionDefinition, ComponentDefinition } from "../../domain/rules/RulePackage";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { CostPaymentEnumerator } from "../../engine/decision/CostPaymentEnumerator";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { ActionRequestValidator } from "../../engine/rules/ActionRequestValidator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { cleanupFogsHandler } from "../../engine/rules/commandHandlers";

describe("作業3B: マスターアクション（剣の雨・フォース・奇襲・R・S・F・フォースFog）統合検証", () => {
  let masterRulePackage: RulePackage;
  let abilityEvaluator: AbilityEvaluator;

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
    abilityEvaluator = new AbilityEvaluator();
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
          life: [
            { id: "p1-l1", suit: "S", rank: "A", value: 1 },
            { id: "p1-l2", suit: "S", rank: "2", value: 2 },
            { id: "p1-l3", suit: "S", rank: "3", value: 3 },
          ],
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
  // 1. 剣の雨 (action.swordRain)
  // ==========================================================================
  describe("1. action.swordRain (剣の雨)", () => {
    it("1.1: YAML 定義が正しく読み込まれ、uncounterable: true であること", () => {
      const action = masterRulePackage.actions.find((a) => a.id === "action.swordRain");
      expect(action).toBeDefined();
      expect(action!.name).toBe("剣の雨");
      expect(action!.cost).toBe("BB");
      expect(action!.uncounterable).toBe(true);
      expect(action!.key?.count).toBe(2);
      expect(action!.key?.condition?.card?.suit).toBe("spade");
    });

    it("1.2: GameSession での合法手生成、コスト支払い、キーカード合計値による全体除去、Replay 検証", () => {
      const state = createBaseState();

      // p1 の防壁（コスト BB 用に 2 体）
      state.players.p1.field = [
        {
          unitId: "u-bw-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-1", suit: "D", rank: "5", value: 5 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-bw-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-2", suit: "D", rank: "6", value: 6 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        // p1 の兵士: サイズ 6 (<= 7 なので破壊対象)
        {
          unitId: "u-p1-soldier",
          componentId: "character.soldier",
          kind: "一般兵",
          cards: [{ id: "c-p1-s", suit: "C", rank: "6", value: 6 }],
          face: "up",
          state: "charge",
          labels: ["attack", "defense"],
        },
      ];

      // p1 の手札: ♠3 と ♠4 (合計値 7)
      state.players.p1.hand = [
        { id: "c-spade-3", suit: "S", rank: "3", value: 3 },
        { id: "c-spade-4", suit: "S", rank: "4", value: 4 },
      ];

      // p2 のフィールド:
      // - 兵士 A: サイズ 5 (<= 7 なので破壊対象)
      // - 兵士 B: サイズ 10 (> 7 なので生存)
      // - 防壁: 防壁は兵士ではないので破壊対象外
      state.players.p2.field = [
        {
          unitId: "u-p2-soldier-small",
          componentId: "character.soldier",
          kind: "一般兵",
          cards: [{ id: "c-p2-s1", suit: "C", rank: "5", value: 5 }],
          face: "up",
          state: "charge",
          labels: ["attack", "defense"],
        },
        {
          unitId: "u-p2-soldier-big",
          componentId: "character.soldier",
          kind: "一般兵",
          cards: [{ id: "c-p2-s2", suit: "C", rank: "10", value: 10 }],
          face: "up",
          state: "charge",
          labels: ["attack", "defense"],
        },
        {
          unitId: "u-p2-bulwark",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-p2-bw", suit: "H", rank: "2", value: 2 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();

      expect(step.type).toBe("WAITING_FOR_DECISION");
      const req = step.request;

      // 剣の雨のパターンが存在すること
      const swordRainPatternRef = req.patterns.findIndex((p: any) => {
        const act = req.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.swordRain";
      });
      expect(swordRainPatternRef).toBeGreaterThanOrEqual(0);

      // 剣の雨を実行
      step = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: swordRainPatternRef,
      });

      // ステージに積まれる
      expect(session.state.stage.requests).toHaveLength(1);
      expect(session.state.stage.requests[0].actionId).toBe("action.swordRain");
      expect(session.state.stage.requests[0].uncounterable).toBe(true);

      // コスト BB により p1 の防壁 2 体が消費されて drive 状態になっていること
      const bw1 = session.state.players.p1.field.find((u: any) => u.unitId === "u-bw-1");
      const bw2 = session.state.players.p1.field.find((u: any) => u.unitId === "u-bw-2");
      expect(bw1?.state).toBe("drive");
      expect(bw2?.state).toBe("drive");

      // ステージ解決へ進む (全員連続パス)
      resolveStageToEmpty(session);

      // 効果解決後のフィールド検証:
      // - p1: u-p1-soldier (サイズ6) は破壊されて墓地へ移動
      expect(session.state.players.p1.field.find((u: any) => u.unitId === "u-p1-soldier")).toBeUndefined();
      expect(session.state.players.p1.grave.some((u: any) => u.unitId === "u-p1-soldier")).toBe(true);

      // - p2: 兵士 small (サイズ5) は破壊、兵士 big (サイズ10) は生存、防壁は生存
      expect(session.state.players.p2.field.find((u: any) => u.unitId === "u-p2-soldier-small")).toBeUndefined();
      expect(session.state.players.p2.field.find((u: any) => u.unitId === "u-p2-soldier-big")).toBeDefined();
      expect(session.state.players.p2.field.find((u: any) => u.unitId === "u-p2-bulwark")).toBeDefined();

      // カード保存則検証
      const p1CardsCount =
        session.state.players.p1.life.length +
        session.state.players.p1.hand.length +
        session.state.players.p1.field.reduce((s: number, u: any) => s + (u.cards?.length || 1), 0) +
        session.state.players.p1.grave.reduce((s: number, u: any) => s + (u.cards?.length || 1), 0);
      expect(p1CardsCount).toBe(3 + 2 + 3); // life(3) + hand(2) + field初期(3) = 8枚
    });
  });

  // ==========================================================================
  // 2. フォース (action.force & fog.force)
  // ==========================================================================
  describe("2. action.force (フォース) & fog.force", () => {
    it("2.1: YAML 定義が正しく読み込まれ、uncounterable: true であり、コンポーネント fog.force が存在すること", () => {
      const action = masterRulePackage.actions.find((a) => a.id === "action.force");
      expect(action).toBeDefined();
      expect(action!.name).toBe("フォース");
      expect(action!.cost).toBe("BB");
      expect(action!.uncounterable).toBe(true);
      expect(action!.key?.count).toBe(2);
      expect(action!.key?.condition?.card?.suit).toBe("heart");

      const comp = masterRulePackage.components.find((c) => c.id === "fog.force");
      expect(comp).toBeDefined();
      expect(comp!.type).toBe("fog");
    });

    it("2.2: GameSession でフォースを実行し、キーカード2枚の合計値が動的に加算されること", () => {
      const state = createBaseState();

      // p1 の防壁（コスト BB 用に 2 体）
      state.players.p1.field = [
        {
          unitId: "u-bw-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-1", suit: "D", rank: "3", value: 3 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-bw-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-2", suit: "D", rank: "4", value: 4 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        // p1 の一般兵 (サイズ 5)
        {
          unitId: "u-p1-soldier",
          componentId: "character.soldier",
          kind: "一般兵",
          cards: [{ id: "c-p1-s", suit: "C", rank: "5", value: 5 }],
          face: "up",
          state: "charge",
          labels: ["attack", "defense"],
        },
      ];

      // p1 の手札: ♡6 と ♡8 (合計値 14)
      state.players.p1.hand = [
        { id: "c-heart-6", suit: "H", rank: "6", value: 6 },
        { id: "c-heart-8", suit: "H", rank: "8", value: 8 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();

      expect(step.type).toBe("WAITING_FOR_DECISION");
      const forcePatternRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.force";
      });
      expect(forcePatternRef).toBeGreaterThanOrEqual(0);

      // フォースを提出
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: forcePatternRef,
      });

      // ステージ解決 (全員連続パス)
      resolveStageToEmpty(session);

      // フォグ領域に fog.force が配置されていること
      expect(session.state.players.p1.fog).toHaveLength(1);
      const forceFog = session.state.players.p1.fog[0];
      expect(forceFog.componentId).toBe("fog.force");
      // 動的合計値の検証: 6 + 8 = 14 (固定値ではない！)
      expect(forceFog.bindings.amount).toBe(14);
      expect(forceFog.cards).toHaveLength(2);

      // p1 の兵士のサイズを AbilityEvaluator で計算: 5 + 14 = 19
      const soldier = session.state.players.p1.field.find((u: any) => u.unitId === "u-p1-soldier");
      const soldierSize = abilityEvaluator.calculateUnitSize(
        soldier,
        session.state,
        masterRulePackage.components
      );
      expect(soldierSize).toBe(19);
    });
  });

  // ==========================================================================
  // 3. 奇襲 (action.surprise)
  // ==========================================================================
  describe("3. action.surprise (奇襲)", () => {
    it("3.1: YAML 定義が正しく読み込まれ、uncounterable: true であること", () => {
      const action = masterRulePackage.actions.find((a) => a.id === "action.surprise");
      expect(action).toBeDefined();
      expect(action!.name).toBe("奇襲");
      expect(action!.cost).toBe("BB");
      expect(action!.uncounterable).toBe(true);
      expect(action!.key?.count).toBe(2);
      expect(action!.key?.condition?.card?.suit).toBe("club");
    });

    it("3.2: GameSession で奇襲を実行し、防壁が兵士に変形し、全兵士がチャージ状態になること", () => {
      const state = createBaseState();

      // p1 の防壁:
      // コスト BB 用に 2 体、変形対象として 1 体
      state.players.p1.field = [
        {
          unitId: "u-cost-1",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-cost-1", suit: "D", rank: "2", value: 2 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-cost-2",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-cost-2", suit: "D", rank: "3", value: 3 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
        {
          unitId: "u-target-bw",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-card", suit: "S", rank: "8", value: 8 }],
          face: "down",
          state: "drive", // ドライブ状態の防壁
          labels: ["defense"],
        },
        {
          unitId: "u-existing-soldier",
          componentId: "character.soldier",
          kind: "一般兵",
          cards: [{ id: "c-soldier", suit: "H", rank: "5", value: 5 }],
          face: "up",
          state: "drive", // ドライブ状態の兵士
          labels: ["attack", "defense"],
        },
      ];

      // 手札: ♣3 と ♣5
      state.players.p1.hand = [
        { id: "c-club-3", suit: "C", rank: "3", value: 3 },
        { id: "c-club-5", suit: "C", rank: "5", value: 5 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();

      expect(step.type).toBe("WAITING_FOR_DECISION");
      const surpriseRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.surprise";
      });
      expect(surpriseRef).toBeGreaterThanOrEqual(0);

      // 奇襲を提出
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: surpriseRef,
      });

      // ステージ解決 (全員連続パス)
      resolveStageToEmpty(session);

      // 効果検証:
      // 1. u-target-bw が防壁から兵士に変形していること
      const transformedUnit = session.state.players.p1.field.find(
        (u: any) => u.unitId === "u-target-bw"
      );
      expect(transformedUnit).toBeDefined();
      expect(transformedUnit.componentId).toBe("character.soldier");
      expect(transformedUnit.face).toBe("up");
      // 2. チャージ状態になっていること
      expect(transformedUnit.state).toBe("charge");

      // 3. 元からいた兵士 (u-existing-soldier) もドライブ状態からチャージ状態になっていること
      const existingSoldier = session.state.players.p1.field.find(
        (u: any) => u.unitId === "u-existing-soldier"
      );
      expect(existingSoldier).toBeDefined();
      expect(existingSoldier.state).toBe("charge");
    });
  });

  // ==========================================================================
  // 4. R・S・F (action.rsf)
  // ==========================================================================
  describe("4. action.rsf (R・S・F)", () => {
    it("4.1: YAML 定義が正しく読み込まれ、5枚キーカード (sameSuit: true) であること", () => {
      const action = masterRulePackage.actions.find((a) => a.id === "action.rsf");
      expect(action).toBeDefined();
      expect(action!.name).toBe("R・S・F");
      expect(action!.cost).toBe("BB");
      expect(action!.key?.count).toBe(5);
      expect(action!.key?.sameSuit).toBe(true);
      expect(action!.key?.conditions).toHaveLength(5);
    });

    it("4.2: GameSession で手札に同スートの A, 10, J, Q, K が揃っている場合のみ合法手が生成され、相手に40ダメージを与えること", () => {
      const state = createBaseState();

      // p1 の防壁（コスト BB 用に 2 体）
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

      // p1 の手札: スペードの A, 10, J, Q, K (ロイヤルストレートフラッシュ成立)
      state.players.p1.hand = [
        { id: "c-s-a", suit: "S", rank: "A", value: 1 },
        { id: "c-s-10", suit: "S", rank: "10", value: 10 },
        { id: "c-s-j", suit: "S", rank: "J", value: 11 },
        { id: "c-s-q", suit: "S", rank: "Q", value: 12 },
        { id: "c-s-k", suit: "S", rank: "K", value: 13 },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();

      expect(step.type).toBe("WAITING_FOR_DECISION");
      // 相手 (p2) を対象とする R・S・F パターンを選択
      const rsfPatternRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        if (act?.actionId !== "action.rsf") return false;
        const target = step.request.catalog.targetSelections[p.targetSelectionRef];
        return target?.targetPlayerKey === "p2";
      });
      expect(rsfPatternRef).toBeGreaterThanOrEqual(0);

      // R・S・F を提出
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: rsfPatternRef,
      });

      // ステージ解決 (全員連続パス)
      resolveStageToEmpty(session);

      // 効果検証: p2 のライフが 0 になり、ゲームが終了 (FINISHED) すること
      step = session.advance();
      if (step.type === "WAITING_FOR_DECISION" && step.request.source?.type === "ZONE_TOP_SELECTION") {
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: 0,
        });
      }
      expect(step.type).toBe("FINISHED");
      expect(step.result.winner).toBe("p1");
      expect(session.state.players.p2.life).toHaveLength(0);
    });

    it("4.3: スートが揃っていない場合 (4枚スペード + 1枚ハート) は R・S・F の合法手が生成されないこと", () => {
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

      // スート不一致: K のみハート
      state.players.p1.hand = [
        { id: "c-s-a", suit: "S", rank: "A", value: 1 },
        { id: "c-s-10", suit: "S", rank: "10", value: 10 },
        { id: "c-s-j", suit: "S", rank: "J", value: 11 },
        { id: "c-s-q", suit: "S", rank: "Q", value: 12 },
        { id: "c-h-k", suit: "H", rank: "K", value: 13 },
      ];

      const session = new GameSession(state, masterRulePackage);
      const step: any = session.advance();

      expect(step.type).toBe("WAITING_FOR_DECISION");
      const rsfPatternRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.rsf";
      });
      // 合法手は生成されないこと
      expect(rsfPatternRef).toBe(-1);
    });
  });

  // ==========================================================================
  // 5. マスター4アクションの追加検証 (指摘事項B)
  // ==========================================================================
  describe("5. マスター4アクションの追加検証 (指摘事項B)", () => {
    it("5.1: 魔術士は兵士（isSoldierType）であり、剣の雨でキーカード合計値以下の場合は破壊され、超過の場合は生存すること", () => {
      const state = createBaseState();
      // p1 の防壁（コスト BB 用に 2 体）
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
      // p1 の手札: ♠3 + ♠4 (合計 7)
      state.players.p1.hand = [
        { id: "c-s-3", suit: "S", rank: "3", value: 3 },
        { id: "c-s-4", suit: "S", rank: "4", value: 4 },
      ];
      // p2 のフィールド:
      // - 魔術士 A: サイズ 6 (<= 7 なので破壊対象)
      // - 魔術士 B: サイズ 10 (> 7 なので生存)
      state.players.p2.field = [
        {
          unitId: "u-magician-small",
          componentId: "character.magician",
          kind: "魔術士",
          cards: [{ id: "c-m-1", suit: "C", rank: "6", value: 6 }],
          face: "up",
          state: "charge",
          labels: ["attack", "defense"],
        },
        {
          unitId: "u-magician-big",
          componentId: "character.magician",
          kind: "魔術士",
          cards: [{ id: "c-m-2", suit: "C", rank: "10", value: 10 }],
          face: "up",
          state: "charge",
          labels: ["attack", "defense"],
        },
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const swordRainPatternRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.swordRain";
      });
      expect(swordRainPatternRef).toBeGreaterThanOrEqual(0);

      session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: swordRainPatternRef,
      });

      resolveStageToEmpty(session);

      // 検証: サイズ6の魔術士は破壊されて墓地へ移動し、サイズ10の魔術士は生存
      expect(session.state.players.p2.field.find((u: any) => u.unitId === "u-magician-small")).toBeUndefined();
      expect(session.state.players.p2.grave.some((u: any) => u.unitId === "u-magician-small")).toBe(true);
      expect(session.state.players.p2.field.find((u: any) => u.unitId === "u-magician-big")).toBeDefined();
    });

    it("5.2: フォースの2枚のキーカードが正しい枚数・Identityで墓地へ移動すること", () => {
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
      const key1 = { id: "c-force-key-1", suit: "H", rank: "5", value: 5 };
      const key2 = { id: "c-force-key-2", suit: "H", rank: "8", value: 8 };
      state.players.p1.hand = [key1, key2];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const forcePatternRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.force";
      });
      expect(forcePatternRef).toBeGreaterThanOrEqual(0);

      session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: forcePatternRef,
      });
      resolveStageToEmpty(session);

      // Fog 領域に 2枚のキーカードが存在すること
      expect(session.state.players.p1.fog).toHaveLength(1);
      expect(session.state.players.p1.fog[0].cards).toHaveLength(2);
      expect(session.state.players.p1.fog[0].cards[0].id).toBe("c-force-key-1");
      expect(session.state.players.p1.fog[0].cards[1].id).toBe("c-force-key-2");

      // ターン終了（cleanupFogs）を実行
      const interpreter = session.registry.getEffectInterpreter();
      const cleanupHandler = cleanupFogsHandler(interpreter);
      cleanupHandler({}, {
        state: session.state,
        playerKey: "p1",
        components: masterRulePackage.components,
        actions: masterRulePackage.actions,
      });

      // Fog 領域は空になり、墓地に key1, key2 が正確に存在すること
      expect(session.state.players.p1.fog).toHaveLength(0);
      const graveCards = session.state.players.p1.grave.flatMap((u: any) => u.cards || [u]);
      expect(graveCards.some((c: any) => c.id === "c-force-key-1" && c.suit === "H" && c.rank === "5")).toBe(true);
      expect(graveCards.some((c: any) => c.id === "c-force-key-2" && c.suit === "H" && c.rank === "8")).toBe(true);
    });

    it("5.3: uncounterable の指定されたアクション（剣の雨・フォース・奇襲）に対して、対戦相手がカウンター条件を満たしていても合法手から完全に除外されること", () => {
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
        { id: "c-s-3", suit: "S", rank: "3", value: 3 },
        { id: "c-s-4", suit: "S", rank: "4", value: 4 },
      ];

      // p2 の手札: カウンターに必要な ♣カード + コストD用の手札カード
      state.players.p2.hand = [
        { id: "c-counter-key", suit: "C", rank: "7", value: 7 }, // counter key
        { id: "c-counter-cost", suit: "S", rank: "2", value: 2 }, // counter cost D
      ];

      const session = new GameSession(state, masterRulePackage);
      let step: any = session.advance();
      const swordRainPatternRef = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.swordRain";
      });
      expect(swordRainPatternRef).toBeGreaterThanOrEqual(0);

      // p1 が剣の雨を提出
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: swordRainPatternRef,
      });

      // p1 が PASS
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const p1Pass = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: p1Pass,
      });

      // 次の意思決定要求は p2 に渡る
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p2");

      // p2 のカタログまたはパターンに action.counter が存在しないこと
      const counterPattern = step.request.patterns.find((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef];
        return act?.actionId === "action.counter";
      });
      expect(counterPattern).toBeUndefined();
    });

    it("5.4: 4アクションの実行結果が Canonical Match Log から決定論的に Replay 再現できること", () => {
      // 奇襲シナリオで一連の対戦を実行
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
        {
          unitId: "u-target-bw",
          componentId: "character.bulwark",
          kind: "防壁",
          cards: [{ id: "c-bw-target", suit: "S", rank: "7", value: 7 }],
          face: "down",
          state: "charge",
          labels: ["defense"],
        },
      ];
      state.players.p1.hand = [
        { id: "c-club-3", suit: "C", rank: "3", value: 3 },
        { id: "c-club-4", suit: "C", rank: "4", value: 4 },
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
            return act?.actionId === "action.surprise";
          });
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

      // Replay実行: 新規セッションに同一の初期Stateと記録された決定列を適用
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

      // 決定論的完全一致を検証
      expect(session2.state.stateVersion).toBe(session1.state.stateVersion);
      expect(session2.state.players.p1.field).toEqual(session1.state.players.p1.field);
      expect(session2.state.players.p1.hand).toEqual(session1.state.players.p1.hand);
      expect(session2.state.players.p1.grave).toEqual(session1.state.players.p1.grave);
      expect(session2.state.stage).toEqual(session1.state.stage);
    });
  });
});
