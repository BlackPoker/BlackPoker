import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import {
  loadRegulationCatalog,
  getFormat,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { GameSession } from "../../engine/session/GameSession";
import type { RulePackage } from "../../domain/rules/RulePackage";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { resolveEffectPlayerKey } from "../../engine/rules/playerUtils";

describe("Official Regulation Phase 3.0-F - Handes & Opponent Hand Effect Selection Tests", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let standardFormat: any;
  let standardPackReg: any;
  let standardRulePackage: RulePackage;
  let lightFormat: any;

  let abilityEvaluator: AbilityEvaluator;
  let expressionEvaluator: ExpressionEvaluator;
  let registry: CommandRegistry;
  let effectInterpreter: EffectInterpreter;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    standardFormat = await getFormat("standard");
    standardPackReg = catalog.regulations.get("standard-pack");
    standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg
    );

    lightFormat = await getFormat("light");

    abilityEvaluator = new AbilityEvaluator();
    expressionEvaluator = new ExpressionEvaluator();
    registry = new CommandRegistry();
    effectInterpreter = (registry as any).effectInterpreter;
  });

  /**
   * ハンド発動から優先権パス（p1 PASS -> p2 PASS）までを進める共通ヘルパー
   */
  function playHandesAndPass(session: GameSession): any {
    const step1: any = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");

    const handethPat = step1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.handeth";
    });
    expect(handethPat).toBeGreaterThanOrEqual(0);

    const step2: any = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: handethPat,
    });

    const p1Pass = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    expect(p1Pass).toBeGreaterThanOrEqual(0);
    const step3: any = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1Pass,
    });

    const p2Pass = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    expect(p2Pass).toBeGreaterThanOrEqual(0);
    return session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: p2Pass,
    });
  }

  // =========================================================================
  // 1. メタデータ完全性検証 (SSOT exact: ruby undefined, targets, keys, effects)
  // =========================================================================
  it("Test 1: action.handeth exact metadata in examples/handeth.yaml (SSOT line 417-429)", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.handeth");
    expect(action).toBeDefined();
    expect(action!.id).toBe("action.handeth");
    expect(action!.name).toBe("ハンデス");
    // SSOT (act.yaml line 417-429) では ruby は未定義
    expect(action!.ruby).toBeUndefined();
    expect(action!.type).toBe("magic");

    // request properties
    expect(action!.request?.trigger).toBe("direct");
    expect(action!.request?.speed).toBe("normal");
    expect(action!.request?.timing).toBe("main");

    // cost は未定義 (コストなし)
    expect(action!.cost).toBeUndefined();

    // key 定義: 2枚 (diamond A..K + club A..K)
    expect(action!.key).toBeDefined();
    expect(action!.key!.count).toBe(2);
    expect(action!.key!.conditions?.length).toBe(2);
    expect(action!.key!.conditions![0].card?.suit).toBe("diamond");
    expect(action!.key!.conditions![0].card?.rank).toBe("A..K");
    expect(action!.key!.conditions![1].card?.suit).toBe("club");
    expect(action!.key!.conditions![1].card?.rank).toBe("A..K");

    // targets: exactly 1 target, type: player, relation: opponent
    expect(action!.targets).toBeDefined();
    expect(action!.targets!.length).toBe(1);
    expect(action!.targets![0].id).toBe("targetPlayer");
    expect(action!.targets![0].type).toBe("player");
    expect(action!.targets![0].condition?.relation).toBe("opponent");

    // text.effect
    expect(action!.text?.effect).toBe(
      "対戦相手の手札を見て1枚カードを指定する。対戦相手は指定されたカードを手札から捨てる。"
    );

    // effect 定義: selectCards + discardCards (player: targetPlayer, decisionPlayer: controller)
    expect(action!.effect).toBeDefined();
    expect(action!.effect!.length).toBe(2);

    const selectStep = action!.effect![0] as any;
    expect(selectStep.selectCards).toBeDefined();
    expect(selectStep.selectCards.id).toBe("discardCard");
    expect(selectStep.selectCards.player).toBe("targetPlayer");
    expect(selectStep.selectCards.decisionPlayer).toBe("controller");
    expect(selectStep.selectCards.zone).toBe("hand");
    expect(selectStep.selectCards.count).toBe(1);

    const discardStep = action!.effect![1] as any;
    expect(discardStep.discardCards).toBeDefined();
    expect(discardStep.discardCards.player).toBe("targetPlayer");
    expect(discardStep.discardCards.cards).toBe("selection.discardCard");
  });

  // =========================================================================
  // 2. 基本ハンデス解決 (相手手札破棄, 相手墓地格納, graveTopCardId 更新)
  // =========================================================================
  it("Test 2: Basic Handes resolution (p2.hand -> p2.grave, graveTopCardId updated, p1.grave has keys)", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2CardA = { id: "c-p2-a", suit: "S", rank: "7", value: 7 };
    const p2CardB = { id: "c-p2-b", suit: "H", rank: "10", value: 10 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-2",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyDiamond, keyClub],
          field: [],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: {
          hand: [p2CardA, p2CardB],
          field: [],
          life: [{ id: "l2" }],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step4 = playHandesAndPass(session);

    // 効果解決時: selectCards で中断 (WAITING_FOR_DECISION)
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    expect(step4.request.playerId).toBe("p1"); // コントローラーが意思決定者
    expect(step4.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step4.request.source.effectStepId).toBe("selectCards");

    // 候補に p2CardA, p2CardB が存在することを確認
    const chooseBPat = step4.request.patterns.findIndex((p: any) => {
      if (p.effectSelectionRef === undefined) return false;
      const sel = step4.request.catalog.effectSelections[p.effectSelectionRef];
      return sel.selectedValues && sel.selectedValues.includes("c-p2-b");
    });
    expect(chooseBPat).toBeGreaterThanOrEqual(0);

    // p1 が p2CardB を選択
    session.submitDecision({
      decisionId: step4.request.decisionId,
      stateVersion: step4.request.stateVersion,
      selectedPatternRef: chooseBPat,
    });

    // 解決後の盤面検証
    const p1 = session.state.players.p1;
    const p2 = session.state.players.p2;

    // p2 の手札から c-p2-b が除去され、c-p2-a のみが残る
    expect(p2.hand.length).toBe(1);
    expect(p2.hand[0].id).toBe("c-p2-a");

    // p2 の墓地に c-p2-b が格納され、graveTopCardId が c-p2-b になる
    expect(p2.grave.length).toBe(1);
    expect(p2.grave[0].id).toBe("c-p2-b");
    expect(p2.graveTopCardId).toBe("c-p2-b");

    // p1 の墓地にキーカード (c-d1, c-c1) が格納され、p1.hand は空
    expect(p1.hand.length).toBe(0);
    expect(p1.grave.some((c: any) => c.id === "c-d1")).toBe(true);
    expect(p1.grave.some((c: any) => c.id === "c-c1")).toBe(true);
  });

  // =========================================================================
  // 3. プライバシー境界検証 (Observation 非公開維持 & DecisionRequest 限定可視)
  // =========================================================================
  it("Test 3: Privacy boundary (Observation masks opponent hand before/during/after, DecisionRequest catalog reveals candidates)", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2CardA = { id: "c-p2-a", suit: "S", rank: "7", value: 7 };
    const p2CardB = { id: "c-p2-b", suit: "H", rank: "10", value: 10 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-3",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2CardA, p2CardB], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    // 発動前: p1 の Observation では p2 の手札カードは秘匿されている
    const obsBeforeP1 = ObservationFactory.createObservation(state, "p1");
    const oppViewBefore = obsBeforeP1.players.find((p) => p.playerId === "p2");
    expect(oppViewBefore).toBeDefined();
    expect(oppViewBefore!.handCards.length).toBe(2);
    expect((oppViewBefore!.handCards[0] as any).suit).toBeUndefined();
    expect((oppViewBefore!.handCards[0] as any).rank).toBeUndefined();
    expect(oppViewBefore!.handCards[0].visibility).toBe("HIDDEN");

    // p2 自身の Observation では手札が見える
    const obsBeforeP2 = ObservationFactory.createObservation(state, "p2");
    const selfViewBefore = obsBeforeP2.players.find((p) => p.playerId === "p2");
    expect(selfViewBefore).toBeDefined();
    expect(selfViewBefore!.handCards[0].visibility).toBe("KNOWN");
    expect((selfViewBefore!.handCards[0] as any).suit).toBe("S");

    const session = new GameSession(state, standardRulePackage);
    const interruptedStep = playHandesAndPass(session);

    expect(interruptedStep.type).toBe("WAITING_FOR_DECISION");
    const decReq = interruptedStep.request;

    // DecisionRequest の observation では、p1 に対する Observation なので依然として p2 の手札はマスクされている
    const oppViewDuring = decReq.observation.players.find((p: any) => p.playerId === "p2");
    expect(oppViewDuring).toBeDefined();
    expect(oppViewDuring!.handCards[0].visibility).toBe("HIDDEN");
    expect((oppViewDuring!.handCards[0] as any).suit).toBeUndefined();

    // 一方、カタログの effectSelections には選択対象として物理カードの identity / 表示名が一時的に提供されている
    expect(decReq.catalog.effectSelections.length).toBe(2);
    const sel0 = decReq.catalog.effectSelections[0];
    const sel1 = decReq.catalog.effectSelections[1];
    expect(["c-p2-a", "c-p2-b"]).toContain(sel0.selectedValues[0]);
    expect(["c-p2-a", "c-p2-b"]).toContain(sel1.selectedValues[0]);

    // 解決完了後
    session.submitDecision({
      decisionId: decReq.decisionId,
      stateVersion: decReq.stateVersion,
      selectedPatternRef: 0,
    });

    const obsAfterP1 = ObservationFactory.createObservation(session.state, "p1");
    const oppViewAfter = obsAfterP1.players.find((p) => p.playerId === "p2");
    expect(oppViewAfter).toBeDefined();
    expect(oppViewAfter!.handCards.length).toBe(1);
    expect((oppViewAfter!.handCards[0] as any).suit).toBeUndefined(); // 残ったカードも秘匿
    expect(oppViewAfter!.handCards[0].visibility).toBe("HIDDEN");
  });

  // =========================================================================
  // 4. card.revealed 0件検証 (ログに card.revealed は発行されない)
  // =========================================================================
  it("Test 4: card.revealed event count is strictly 0", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2Card = { id: "c-p2-1", suit: "S", rank: "7", value: 7 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-4",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2Card], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step4 = playHandesAndPass(session);
    session.submitDecision({ decisionId: step4.request.decisionId, stateVersion: step4.request.stateVersion, selectedPatternRef: 0 });

    const logs = session.logRecorder.getEvents();
    const revealedLogs = logs.filter((l: any) => l.type === "card.revealed");
    expect(revealedLogs.length).toBe(0);
  });

  // =========================================================================
  // 5. 空手札の正常解決検証 (Rule 5.4.4: 決定スキップ, 空破棄 no-op, 正常完走)
  // =========================================================================
  it("Test 5: Empty opponent hand resolves cleanly without decision interruption (Rule 5.4.4 no-op)", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-5",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] }, // 空手札
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step4 = playHandesAndPass(session);

    // 中断 (EFFECT_RESOLUTION) にならず、手番プレイヤー (p1) の通常行動要求に戻っている
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    expect(step4.request.source.type).toBe("ACTION_REQUEST");
    expect(session.state.players.p2.hand.length).toBe(0);
    expect(session.state.players.p2.grave.length).toBe(0);
    expect(session.state.players.p1.grave.length).toBe(2); // キーカードは正常に墓地へ
  });

  // =========================================================================
  // 6. 1枚手札の決定検証 (汎用決定コントラクトに従いDecisionRequest生成)
  // =========================================================================
  it("Test 6: 1-card opponent hand generates DecisionRequest with 1 candidate", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2Card = { id: "c-p2-single", suit: "S", rank: "A", value: 1 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-6",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2Card], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step = playHandesAndPass(session);

    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.patterns.length).toBe(1);
    expect(step.request.catalog.effectSelections[0].selectedValues).toEqual(["c-p2-single"]);

    session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: 0,
    });
    expect(session.state.players.p2.hand.length).toBe(0);
    expect(session.state.players.p2.grave[0].id).toBe("c-p2-single");
  });

  // =========================================================================
  // 7. 所有権分離検証 (p2 手札 -> p2 墓地, p1 墓地と混ざらない)
  // =========================================================================
  it("Test 7: Ownership segregation (p2 discarded card strictly placed in p2.grave)", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2Card = { id: "c-p2-target", suit: "D", rank: "5", value: 5 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-7",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2Card], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step = playHandesAndPass(session);
    session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: 0,
    });

    const p1Grave = session.state.players.p1.grave;
    const p2Grave = session.state.players.p2.grave;

    expect(p2Grave.some((c: any) => c.id === "c-p2-target")).toBe(true);
    expect(p1Grave.some((c: any) => c.id === "c-p2-target")).toBe(false);
  });

  // =========================================================================
  // 8 & 9. 墓地 TOP 遷移検証 (空墓地および既存墓地への追加, zone.top.changed 発行, ZONE_TOP_SELECTION なし)
  // =========================================================================
  it("Test 8: Empty grave transition emits zone.top.changed and no ZONE_TOP_SELECTION", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2Card = { id: "c-p2-new", suit: "S", rank: "2", value: 2 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-8",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2Card], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step = playHandesAndPass(session);
    session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: 0,
    });

    expect(session.state.players.p2.graveTopCardId).toBe("c-p2-new");

    const logs = session.logRecorder.getEvents();
    const topChanged: any = logs.find(
      (l: any) => l.type === "zone.top.changed" && l.playerId === "p2" && l.zone === "grave"
    );
    expect(topChanged).toBeDefined();
    expect(topChanged.cardId).toBe("c-p2-new");
    expect(topChanged.previousCardId).toBeUndefined();

    const zoneTopDec = logs.find((l: any) => l.source === "ZONE_TOP_SELECTION");
    expect(zoneTopDec).toBeUndefined();
  });

  it("Test 9: Existing grave transition emits zone.top.changed with previousTopCardId", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2OldGraveCard = { id: "c-p2-old", suit: "C", rank: "9", value: 9 };
    const p2Card = { id: "c-p2-top", suit: "S", rank: "2", value: 2 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-9",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: {
          hand: [p2Card],
          field: [],
          life: [{ id: "l2" }],
          grave: [p2OldGraveCard],
          graveTopCardId: "c-p2-old",
        },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step = playHandesAndPass(session);
    session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: 0,
    });

    expect(session.state.players.p2.graveTopCardId).toBe("c-p2-top");

    const logs = session.logRecorder.getEvents();
    const topChanged: any = logs.find(
      (l: any) =>
        l.type === "zone.top.changed" &&
        l.playerId === "p2" &&
        l.zone === "grave" &&
        l.cardId === "c-p2-top"
    );
    expect(topChanged).toBeDefined();
    expect(topChanged.previousCardId).toBe("c-p2-old");
  });

  // =========================================================================
  // 10. 正規マッチログ順序検証
  // =========================================================================
  it("Test 10: Canonical match log sequence during Handes resolution", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2Card = { id: "c-p2-log", suit: "H", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-10",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2Card], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step = playHandesAndPass(session);
    session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: 0,
    });

    const logs = session.logRecorder.getEvents();

    const resolveStartedIdx = logs.findIndex(
      (l: any) => l.type === "request.resolve.started" && l.actionRef === "action.handeth"
    );
    const decReqIdx = logs.findIndex(
      (l: any) => l.type === "decision.requested" && l.source === "EFFECT_RESOLUTION"
    );
    const decRespIdx = logs.findIndex(
      (l: any) => l.type === "decision.responded" && l.source === "EFFECT_RESOLUTION"
    );
    const cardMovedIdx = logs.findIndex(
      (l: any) => l.type === "card.moved" && l.cardId === "c-p2-log"
    );
    const topChangedIdx = logs.findIndex(
      (l: any) => l.type === "zone.top.changed" && l.cardId === "c-p2-log"
    );
    const stagePoppedIdx = logs.findIndex(
      (l: any) => l.type === "stage.popped" && l.actionRef === "action.handeth"
    );
    const reqResolvedIdx = logs.findIndex(
      (l: any) => l.type === "request.resolved" && l.actionRef === "action.handeth"
    );

    expect(resolveStartedIdx).toBeGreaterThanOrEqual(0);
    expect(decReqIdx).toBeGreaterThan(resolveStartedIdx);
    expect(decRespIdx).toBeGreaterThan(decReqIdx);
    expect(cardMovedIdx).toBeGreaterThan(decRespIdx);
    expect(topChangedIdx).toBeGreaterThan(cardMovedIdx);
    expect(stagePoppedIdx).toBeGreaterThan(topChangedIdx);
    expect(reqResolvedIdx).toBeGreaterThan(stagePoppedIdx);

    const moveLog: any = logs[cardMovedIdx];
    expect(moveLog.cardId).toBe("c-p2-log");
    expect(moveLog.from.zone).toBe("hand");
    expect(moveLog.from.playerId).toBe("p2");
    expect(moveLog.to.zone).toBe("grave");
    expect(moveLog.to.playerId).toBe("p2");
  });

  // =========================================================================
  // 11 & 12. fail-closed 検証 (欠損カード, 重複カード ID, 不正エントリ)
  // =========================================================================
  it("Test 11: Fail-closed when selected card ID is not present in target hand", () => {
    const context: CommandContext = {
      state: {
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: { hand: [{ id: "c-real", suit: "S", rank: "A" }], field: [], life: [], grave: [] },
        },
      },
      playerKey: "p1",
      targetPlayerKey: "p2",
      selections: {
        discardCard: ["c-missing-fake"],
      },
    };

    expect(() => {
      registry.execute("discardCards", { player: "targetPlayer", cards: "selection.discardCard" }, context);
    }).toThrow(/手札に見つかりません/);
  });

  it("Test 12: Fail-closed on duplicate card ID in target hand", () => {
    const context: CommandContext = {
      state: {
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: {
            hand: [
              { id: "c-dup", suit: "S", rank: "A" },
              { id: "c-dup", suit: "S", rank: "A" },
            ],
            field: [],
            life: [],
            grave: [],
          },
        },
      },
      playerKey: "p1",
      targetPlayerKey: "p2",
    };

    expect(() => {
      effectInterpreter.findSelectableCards({ zone: "hand" }, context, "p2");
    }).toThrow(/手札に重複するカードIDが存在します/);
  });

  // =========================================================================
  // 13. スナップショット保存・復元検証 (StateHash 一致)
  // =========================================================================
  it("Test 13: Snapshot and restore during WAITING_FOR_DECISION (StateHash match)", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2CardA = { id: "c-p2-a", suit: "S", rank: "7", value: 7 };
    const p2CardB = { id: "c-p2-b", suit: "H", rank: "10", value: 10 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-13",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2CardA, p2CardB], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step = playHandesAndPass(session);
    expect(step.type).toBe("WAITING_FOR_DECISION");

    // スナップショットキャプチャ
    const snapshot = session.createSnapshot();
    const hashOriginal = StateHasher.hash(session.state);

    // 復元
    const restored = GameSession.fromSnapshot(snapshot, standardRulePackage);
    const hashRestored = StateHasher.hash(restored.state);
    expect(hashRestored).toBe(hashOriginal);
    expect(restored.pendingDecision).toBeDefined();
    expect(restored.pendingDecision?.playerId).toBe("p1");

    // 復元セッションでの判断提出
    restored.submitDecision({
      decisionId: restored.pendingDecision!.decisionId,
      stateVersion: restored.pendingDecision!.stateVersion,
      selectedPatternRef: 0,
    });
    expect(restored.state.players.p2.hand.length).toBe(1);
    expect(restored.state.players.p2.grave.length).toBe(1);
  });

  // =========================================================================
  // 14. 決定論的フレッシュリプレイ検証 (StateHash 一致)
  // =========================================================================
  it("Test 14: Deterministic fresh replay produces exact identical state hashes", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2CardA = { id: "c-p2-a", suit: "S", rank: "7", value: 7 };
    const p2CardB = { id: "c-p2-b", suit: "H", rank: "10", value: 10 };

    const makeInitialState = () => ({
      stateVersion: 1,
      matchId: "match-test-14",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [{ ...keyDiamond }, { ...keyClub }], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [{ ...p2CardA }, { ...p2CardB }], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    });

    // 1回目実行
    const session1 = new GameSession(makeInitialState(), standardRulePackage);
    const stepA = playHandesAndPass(session1);
    session1.submitDecision({ decisionId: stepA.request.decisionId, stateVersion: stepA.request.stateVersion, selectedPatternRef: 1 });
    const finalHash1 = StateHasher.hash(session1.state);

    // 2回目実行 (同一判断系列)
    const session2 = new GameSession(makeInitialState(), standardRulePackage);
    const stepB = playHandesAndPass(session2);
    session2.submitDecision({ decisionId: stepB.request.decisionId, stateVersion: stepB.request.stateVersion, selectedPatternRef: 1 });
    const finalHash2 = StateHasher.hash(session2.state);

    expect(finalHash2).toBe(finalHash1);
  });

  // =========================================================================
  // 15, 16, 17. AI ポリシー互換性 (FirstLegal, SeededRandom, GenomePolicy DNA 1482)
  // =========================================================================
  it("Test 15: AI compatibility - FirstLegalPolicy navigates Handes successfully", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2Card = { id: "c-p2-ai", suit: "S", rank: "3", value: 3 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-15",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2Card], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step = playHandesAndPass(session);
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source.type).toBe("EFFECT_RESOLUTION");

    const policy = new FirstLegalPolicy();
    const response = policy.choose(step.request);
    expect(response.selectedPatternRef).toBeGreaterThanOrEqual(0);
    session.submitDecision(response);

    expect(session.state.players.p2.grave.length).toBe(1);
    expect(session.state.players.p2.grave[0].id).toBe("c-p2-ai");
  });

  it("Test 16: AI compatibility - Seeded RandomPolicy is deterministic", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2CardA = { id: "c-p2-a", suit: "S", rank: "7", value: 7 };
    const p2CardB = { id: "c-p2-b", suit: "H", rank: "10", value: 10 };

    const runWithSeed = (seed: number) => {
      const state: any = {
        stateVersion: 1,
        matchId: "match-test-16",
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: { hand: [{ ...keyDiamond }, { ...keyClub }], field: [], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [{ ...p2CardA }, { ...p2CardB }], field: [], life: [{ id: "l2" }], grave: [] },
        },
        stage: { requests: [], history: [] },
      };
      const session = new GameSession(state, standardRulePackage);
      const step = playHandesAndPass(session);
      const policy = new RandomPolicy(seed);
      const response = policy.choose(step.request);
      session.submitDecision(response);
      return StateHasher.hash(session.state);
    };

    const hashA = runWithSeed(42);
    const hashB = runWithSeed(42);
    expect(hashA).toBe(hashB);
  });

  it("Test 17: AI compatibility - GenomePolicy with DNA 1482 and FEATURE_SCHEMA_VERSION = 1", () => {
    expect(FEATURE_SCHEMA_VERSION).toBe(1);
    const dna = createManualGenericGenomeDNA();
    expect(dna.patternWeights.length + dna.contextPatternWeights.length).toBe(1482);

    const genomePolicy = new GenomePolicy(dna);

    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2Card = { id: "c-p2-genome", suit: "D", rank: "6", value: 6 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-17",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2Card], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step = playHandesAndPass(session);
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source.type).toBe("EFFECT_RESOLUTION");

    const response = genomePolicy.choose(step.request);
    expect(response.selectedPatternRef).toBeGreaterThanOrEqual(0);
    session.submitDecision(response);

    expect(session.state.players.p2.grave.length).toBe(1);
    expect(session.state.players.p2.grave[0].id).toBe("c-p2-genome");
  });

  // =========================================================================
  // 18. standard-pack.simulatorImplemented = true / standard-entry16 = false 検証
  // =========================================================================
  it("Test 18: standard-pack regulation has simulatorImplemented = true in Phase 3.0-H", () => {
    const result = RegulationValidator.validateRegulation(catalog, "standard-pack");
    expect(result.simulatorImplemented).toBe(true);

    const standardEntry16 = RegulationValidator.validateCombination(catalog, "standard", "entry16");
    expect(standardEntry16.simulatorImplemented).toBe(false);
  });

  // =========================================================================
  // 19. 解決時手札動的変化テスト (Effect-time hand mutation)
  // =========================================================================
  it("Test 19: Hand candidates are resolved dynamically at effect execution time", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2CardInitial = { id: "c-p2-old", suit: "S", rank: "3", value: 3 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-19",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2CardInitial], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    const handethPat = step1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.handeth";
    });

    const step2: any = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: handethPat,
    });

    const p1Pass = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3: any = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1Pass,
    });

    // 優先権パス（p2 PASS）の直前に、p2 の手札が別カードに入れ替わったとする
    const p2CardMutated = { id: "c-p2-new", suit: "H", rank: "9", value: 9 };
    session.state.players.p2.hand = [p2CardMutated];

    const p2Pass = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step4: any = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: p2Pass,
    });

    expect(step4.type).toBe("WAITING_FOR_DECISION");
    expect(step4.request.patterns.length).toBe(1);
    // リクエスト生成時ではなく、効果解決時の手札 [c-p2-new] が候補となる
    expect(step4.request.catalog.effectSelections[0].selectedValues).toEqual(["c-p2-new"]);
  });

  // =========================================================================
  // 20. 正規 targetPlayer トラッキング検証 (resolveEffectPlayerKey fail-closed)
  // =========================================================================
  it("Test 20: resolveEffectPlayerKey strictly resolves targetPlayer or throws fail-closed", () => {
    const validCtx: CommandContext = {
      state: { players: { p1: {}, p2: {} } },
      playerKey: "p1",
      targetPlayerKey: "p2",
    };
    expect(resolveEffectPlayerKey("targetPlayer", validCtx)).toBe("p2");

    const invalidCtx: CommandContext = {
      state: { players: { p1: {}, p2: {} } },
      playerKey: "p1",
      targetPlayerKey: undefined,
    };
    expect(() => {
      resolveEffectPlayerKey("targetPlayer", invalidCtx);
    }).toThrow(/requires context\.targetPlayerKey/);
  });

  // =========================================================================
  // 21. ジョーカー候補・破棄対応検証
  // =========================================================================
  it("Test 21: Joker card in opponent hand is a valid Handes candidate and discards cleanly", () => {
    const keyDiamond = { id: "c-d1", suit: "D", rank: "A", value: 1 };
    const keyClub = { id: "c-c1", suit: "C", rank: "K", value: 13 };
    const p2Joker = { id: "c-joker-1", suit: "J", rank: "Joker", value: 0 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-21",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [keyDiamond, keyClub], field: [], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [p2Joker], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step = playHandesAndPass(session);

    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.patterns.length).toBe(1);
    expect(step.request.catalog.effectSelections[0].selectedValues).toEqual(["c-joker-1"]);

    session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: 0,
    });

    expect(session.state.players.p2.hand.length).toBe(0);
    expect(session.state.players.p2.grave[0].id).toBe("c-joker-1");
    expect(session.state.players.p2.graveTopCardId).toBe("c-joker-1");
  });

  // =========================================================================
  // 22. 手札不正エントリ / Unit wrapper 拒否検証 (fail-closed)
  // =========================================================================
  it("Test 22: Unit wrapper in hand causes fail-closed Error", () => {
    const wrapperInHand = {
      unitId: "u-invalid",
      componentId: "character.soldier",
      cards: [{ id: "c-1", suit: "S", rank: "A" }],
    };

    const context: CommandContext = {
      state: {
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: { hand: [wrapperInHand], field: [], life: [], grave: [] },
        },
      },
      playerKey: "p1",
      targetPlayerKey: "p2",
    };

    expect(() => {
      effectInterpreter.findSelectableCards({ zone: "hand" }, context, "p2");
    }).toThrow(/手札に不正なエントリまたはUnit wrapperが含まれています/);
  });

  // =========================================================================
  // 23. AI 視点 Observation プライバシー保護検証
  // =========================================================================
  it("Test 23: ObservationFactory never leaks suit or rank of opponent hand to controller", () => {
    const state: any = {
      turnPlayer: "p1",
      players: {
        p1: {
          hand: [{ id: "c-p1", suit: "D", rank: "A", value: 1 }],
          field: [],
          life: [],
          grave: [],
        },
        p2: {
          hand: [
            { id: "c-p2-secret1", suit: "S", rank: "K", value: 13 },
            { id: "c-p2-secret2", suit: "H", rank: "Q", value: 12 },
          ],
          field: [],
          life: [],
          grave: [],
        },
      },
    };

    const p1Obs = ObservationFactory.createObservation(state, "p1");
    const p2Obs = p1Obs.players.find((p) => p.playerId === "p2");
    expect(p2Obs).toBeDefined();
    expect(p2Obs!.handCards.length).toBe(2);
    for (const card of p2Obs!.handCards) {
      expect(card.visibility).toBe("HIDDEN");
      expect((card as any).suit).toBeUndefined();
      expect((card as any).rank).toBeUndefined();
      expect((card as any).value).toBeUndefined();
    }
  });
});
