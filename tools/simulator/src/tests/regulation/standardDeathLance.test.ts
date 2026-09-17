import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { evaluateUnitTargetCondition } from "../../engine/rules/targetConditionUtils";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { GameSession } from "../../engine/session/GameSession";
import type { RulePackage } from "../../domain/rules/RulePackage";
import { buildFieldUnitFromComponent } from "../../engine/rules/commandHandlers";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { resolveKeyCardRankValueBySuit } from "../../engine/rules/ExpressionEvaluator";

describe("Official Regulation Phase 3.0-D - Death Lance & Owner Card Order Resolution Tests", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let standardFormat: any;
  let standardPackReg: any;
  let standardRulePackage: RulePackage;

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
    standardPackReg = await getRegulation("standard-pack");
    standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg
    );

    abilityEvaluator = new AbilityEvaluator();
    expressionEvaluator = new ExpressionEvaluator();
    registry = new CommandRegistry();
    effectInterpreter = (registry as any).effectInterpreter;
  });

  // =========================================================================
  // 1. メタデータおよび定義の整合性テスト
  // =========================================================================
  it("Test 1: action.deathLance exact metadata in examples/death-lance.yaml", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.deathLance");
    expect(action).toBeDefined();
    expect(action!.id).toBe("action.deathLance");
    expect(action!.name).toBe("死の槍");
    expect(action!.ruby).toBe("しのやり");
    expect(action!.type).toBe("magic");

    // request properties
    expect(action!.request?.trigger).toBe("direct");
    expect(action!.request?.speed).toBe("normal");
    expect(action!.request?.timing).toBe("main");

    // cost is undefined (no cost)
    expect(action!.cost).toBeUndefined();

    // key definition: 2 cards (spade A..K + diamond A..K)
    expect(action!.key).toBeDefined();
    expect(action!.key!.count).toBe(2);
    expect(action!.key!.conditions?.length).toBe(2);
    expect(action!.key!.conditions![0].card?.suit).toBe("spade");
    expect(action!.key!.conditions![1].card?.suit).toBe("diamond");

    // targets: exactly 1 target, type: unit, characterType: soldier
    expect(action!.targets).toBeDefined();
    expect(action!.targets!.length).toBe(1);
    expect(action!.targets![0].type).toBe("unit");
    expect(action!.targets![0].condition?.characterType).toBe("soldier");
    // relation は未指定（自軍・敵軍の双方を対象可能）
    expect(action!.targets![0].condition?.relation).toBeUndefined();
  });

  it("Test 2: standard format contains action.deathLance", () => {
    expect(standardFormat.actions).toContain("action.deathLance");
    const stdAction = standardRulePackage.actions.find((a) => a.id === "action.deathLance");
    expect(stdAction).toBeDefined();
  });

  // =========================================================================
  // 2. ターゲット適法性（Soldier系5種は合法、Bulwark等は非法）
  // =========================================================================
  it("Test 3: character.soldier, hero, ace, magician, armedSoldier are all legal targets", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.deathLance")!;
    const state: any = {
      players: {
        p1: {
          field: [
            buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", components: fullRulePackage.components }),
            buildFieldUnitFromComponent({ componentId: "character.hero", playerKey: "p1", components: fullRulePackage.components }),
            buildFieldUnitFromComponent({ componentId: "character.ace", playerKey: "p1", components: fullRulePackage.components }),
            buildFieldUnitFromComponent({ componentId: "character.magician", playerKey: "p1", components: fullRulePackage.components }),
            buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p1", components: fullRulePackage.components }),
          ],
        },
        p2: {
          field: [
            buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", components: fullRulePackage.components }),
          ],
        },
      },
    };

    const targetDef = action.targets![0];

    // p1 の 5種すべてが soldier 判定を通過すること
    for (const unit of state.players.p1.field) {
      const res = evaluateUnitTargetCondition(unit, targetDef.condition, {
        playerKey: "p1",
        unitOwnerKey: "p1",
        components: fullRulePackage.components,
      });
      expect(res.isValid).toBe(true);
    }

    // p2 (対戦相手) の soldier も合法であること（自軍・敵軍制約なし）
    const p2Soldier = state.players.p2.field[0];
    const resP2 = evaluateUnitTargetCondition(p2Soldier, targetDef.condition, {
      playerKey: "p1",
      unitOwnerKey: "p2",
      components: fullRulePackage.components,
    });
    expect(resP2.isValid).toBe(true);
  });

  it("Test 4: character.bulwark is ILLEGAL target (characterType: bulwark)", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.deathLance")!;
    const bulwark = buildFieldUnitFromComponent({ componentId: "character.bulwark", playerKey: "p2", components: fullRulePackage.components });

    const targetDef = action.targets![0];
    const res = evaluateUnitTargetCondition(bulwark, targetDef.condition, {
      playerKey: "p1",
      unitOwnerKey: "p2",
      components: fullRulePackage.components,
    });
    expect(res.isValid).toBe(false);
    expect(res.reason).toBe("TARGET_CONDITION_UNMET");
  });

  // =========================================================================
  // 3. 発動条件および合法パターン生成
  // =========================================================================
  it("Test 5: LegalPatternGenerator generates deathLance when Spade+Diamond in hand and Soldier on field", () => {
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "c-s5", suit: "S", rank: "5", value: 5 },
            { id: "c-d2", suit: "D", rank: "2", value: 2 },
          ],
          field: [
            { ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", components: fullRulePackage.components }), cards: [{ id: "c-s4", suit: "S", rank: "4", value: 4 }] },
          ],
          life: [{ id: "l1" }, { id: "l2" }],
          grave: [],
        },
        p2: {
          hand: [],
          field: [
            { ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", components: fullRulePackage.components }), cards: [{ id: "c-h6", suit: "H", rank: "6", value: 6 }] },
          ],
          life: [{ id: "l3" }, { id: "l4" }],
          grave: [],
        },
      },
    };

    const { request } = LegalPatternGenerator.generateActionRequestDecision(
      state,
      "p1",
      standardRulePackage
    );

    const deathLancePatterns = request.patterns.filter((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return request.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance";
    });

    // 2体のターゲット（p1 soldier, p2 soldier）に対してそれぞれ合法パターンが生成されていること
    expect(deathLancePatterns.length).toBe(2);
  });

  // =========================================================================
  // 4. 効果解決: 割り切れる場合（条件成立）と割り切れない場合（guardCondition不成立）
  // =========================================================================
  it("Test 6: Divisible: size 4 % diamond 2 == 0 -> moves single-card soldier to life top and deals 5 damage", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.deathLance")!;
    const soldierCard = { id: "c-s4", suit: "S", rank: "4", value: 4 };
    const targetSoldier = {
      ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", card: soldierCard, components: fullRulePackage.components }),
      cards: [soldierCard],
    };

    const state: any = {
      stateVersion: 1,
      players: {
        p1: {
          hand: [],
          field: [],
          life: [{ id: "p1-l1" }],
          grave: [],
        },
        p2: {
          hand: [],
          field: [targetSoldier],
          life: [{ id: "p2-l1" }, { id: "p2-l2" }, { id: "p2-l3" }],
          grave: [],
        },
      },
    };

    const keyCards = [
      { id: "k-s5", suit: "S", rank: "5", value: 5 },
      { id: "k-d2", suit: "D", rank: "2", value: 2 },
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: action,
      keyCards,
      targetComponent: targetSoldier,
      components: fullRulePackage.components,
    };

    // 単一カード兵士: selectUnitCardOrder は決定不要で自動束縛 (複数枚ダメージによるzoneTop中断は許容)
    const execResult = effectInterpreter.executeEffectsWithInterruption(action.effect!, context);
    expect("completed" in execResult ? execResult.completed : execResult.selectionType === "zoneTop").toBe(true);

    // 兵士は p2 のフィールドから除去されていること
    expect(state.players.p2.field.length).toBe(0);

    // 兵士カード c-s4 はライフTOP (先頭) へ移動していること
    // p2 のライフは元々 3枚。c-s4 が unshift されて [c-s4, p2-l1, p2-l2, p2-l3] (計4枚)
    // その後 ♠5 点ダメージにより先頭から最大4枚中4枚すべて墓地へ
    expect(state.players.p2.life.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(4);
    // 墓地の1枚目は c-s4 であること (ライフTOPから引かれた)
    expect(state.players.p2.grave[0].cards[0].id).toBe("c-s4");
  });

  it("Test 7: Not divisible: size 5 % diamond 2 == 1 != 0 -> guardCondition cleanly halts effect", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.deathLance")!;
    const soldierCard = { id: "c-s5", suit: "S", rank: "5", value: 5 };
    const targetSoldier = {
      ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", card: soldierCard, components: fullRulePackage.components }),
      cards: [soldierCard],
    };

    const state: any = {
      stateVersion: 1,
      players: {
        p1: { hand: [], field: [], life: [{ id: "p1-l1" }], grave: [] },
        p2: { hand: [], field: [targetSoldier], life: [{ id: "p2-l1" }, { id: "p2-l2" }], grave: [] },
      },
    };

    const keyCards = [
      { id: "k-s3", suit: "S", rank: "3", value: 3 },
      { id: "k-d2", suit: "D", rank: "2", value: 2 }, // 5 % 2 != 0
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: action,
      keyCards,
      targetComponent: targetSoldier,
      components: fullRulePackage.components,
    };

    const execResult = effectInterpreter.executeEffectsWithInterruption(action.effect!, context);
    expect("completed" in execResult && execResult.completed).toBe(true);

    // 条件不成立のため、兵士はフィールドに残り、ライフもダメージも変化なし
    expect(state.players.p2.field.length).toBe(1);
    expect(state.players.p2.field[0].unitId).toBe(targetSoldier.unitId);
    expect(state.players.p2.life.length).toBe(2);
    expect(state.players.p2.grave.length).toBe(0);
  });

  it("Test 8: Size 0 (Magician without Fog) -> guardCondition cleanly halts effect (target.size != 0 is false)", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.deathLance")!;
    const magician = buildFieldUnitFromComponent({ componentId: "character.magician", playerKey: "p2", components: fullRulePackage.components });

    const state: any = {
      stateVersion: 1,
      players: {
        p1: { hand: [], field: [], life: [], grave: [] },
        p2: { hand: [], field: [magician], life: [{ id: "l1" }], grave: [] },
      },
    };

    const keyCards = [
      { id: "k-s3", suit: "S", rank: "3", value: 3 },
      { id: "k-d2", suit: "D", rank: "2", value: 2 },
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: action,
      keyCards,
      targetComponent: magician,
      components: fullRulePackage.components,
    };

    const execResult = effectInterpreter.executeEffectsWithInterruption(action.effect!, context);
    expect("completed" in execResult && execResult.completed).toBe(true);

    // サイズ0のため効果は中断され、魔術師は盤面に維持される
    expect(state.players.p2.field.length).toBe(1);
    expect(state.players.p2.life.length).toBe(1);
    expect(state.players.p2.grave.length).toBe(0);
  });

  it("Test 9: Magician buffed by Fog (size 4, diamond 2) -> guardCondition passes, moves and damages", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.deathLance")!;
    const magicianCard = { id: "m-card", suit: "C", rank: "0", value: 0 };
    const magician = {
      ...buildFieldUnitFromComponent({ componentId: "character.magician", playerKey: "p2", card: magicianCard, components: fullRulePackage.components }),
      cards: [magicianCard],
    };

    const state: any = {
      stateVersion: 1,
      players: {
        p1: { hand: [], field: [], life: [], grave: [] },
        p2: {
          hand: [],
          field: [magician],
          fog: [
            { componentId: "fog.up", bindings: { target: magician.unitId, amount: 4 } }, // size = 0 + 4 = 4
          ],
          life: [{ id: "l1" }, { id: "l2" }],
          grave: [],
        },
      },
    };

    const keyCards = [
      { id: "k-s1", suit: "S", rank: "1", value: 1 },
      { id: "k-d2", suit: "D", rank: "2", value: 2 }, // 4 % 2 == 0
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: action,
      keyCards,
      targetComponent: magician,
      components: fullRulePackage.components,
    };

    const execResult = effectInterpreter.executeEffectsWithInterruption(action.effect!, context);
    expect("completed" in execResult && execResult.completed).toBe(true);

    // 魔術師はフィールドから除去され、ライフTOPへ移送後、1ダメージ
    expect(state.players.p2.field.length).toBe(0);
    // 元ライフ2枚 + 魔術師1枚 = 3枚、1ダメージで1枚墓地へ -> 残りライフ2枚
    expect(state.players.p2.life.length).toBe(2);
    expect(state.players.p2.grave.length).toBe(1);
    expect(state.players.p2.grave[0].cards[0].id).toBe("m-card");
  });

  // =========================================================================
  // 5. 逐次順序決定（オーナーによる選択、最大 N-1 回、N! 禁止）
  // =========================================================================
  it("Test 10: Armed Soldier with 2 cards requires exactly 1 decision by Owner via GameSession", () => {
    const cardA = { id: "card-A", suit: "S", rank: "2", value: 2 };
    const cardB = { id: "card-B", suit: "H", rank: "2", value: 2 };
    const armedSoldier = {
      ...buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p2", components: fullRulePackage.components }),
      cards: [cardA, cardB], // total size = 4
    };

    const state: any = {
      matchId: "match-test-1",
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "k-s1", suit: "S", rank: "1", value: 1 },
            { id: "k-d2", suit: "D", rank: "2", value: 2 },
          ],
          field: [],
          life: [{ id: "p1-l1" }],
          grave: [],
        },
        p2: {
          hand: [],
          field: [armedSoldier],
          life: [{ id: "p2-l1" }, { id: "p2-l2" }],
          grave: [],
        },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p1 が死の槍を発動するパターンを生成・選択
    const deathLancePatRef = step1.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance";
    });
    expect(deathLancePatRef).toBeGreaterThanOrEqual(0);

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: deathLancePatRef,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // 通常アクションのためステージに積載され、チャンスプレイヤー (p1) の行動待ち
    // p1 が PASS
    const p1PassRef = step2.request.patterns.findIndex((p) => p.kind === "PASS");
    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1PassRef,
    });
    expect(step3.type).toBe("WAITING_FOR_DECISION");
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p2 が PASS -> 全員連続PASS成立でステージトップの死の槍が解決開始
    const p2PassRef = step3.request.patterns.findIndex((p) => p.kind === "PASS");
    const step4 = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: p2PassRef,
    });

    // 順序選択で中断し、判断権は兵士のオーナー (p2) にあること
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    if (step4.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step4.request.playerId).toBe("p2");
    expect(step4.request.source.type).toBe("EFFECT_RESOLUTION");
    if (step4.request.source.type !== "EFFECT_RESOLUTION") throw new Error("Expected EFFECT_RESOLUTION");
    expect(step4.request.source.effectStepId).toBe("selectUnitCardOrder");

    // 候補は2枚（cardA, cardB）
    expect(step4.request.catalog.orderSelections.length).toBe(2);

    // p2 が cardB を一番上に選択
    const patRefCardB = step4.request.patterns.findIndex((p) => {
      const ordSel = step4.request.catalog.orderSelections[p.orderSelectionRef!];
      return ordSel.orderedIds[0] === "card-B";
    });
    expect(patRefCardB).toBeGreaterThanOrEqual(0);

    // p2 が決定を送信すると、残り1枚 (cardA) は自動確定され、全効果が完了すること
    const step5 = session.submitDecision({
      decisionId: step4.request.decisionId,
      stateVersion: step4.request.stateVersion,
      selectedPatternRef: patRefCardB,
    });
    expect(step5.type).toBe("WAITING_FOR_DECISION"); // チャンスが戻り次の決定待機状態

    // 盤面確認:
    // armedSoldier は p2 フィールドから除去されている
    expect(session.state.players.p2.field.length).toBe(0);

    // 順序: cardB が最上位、次が cardA。
    // その後 ♠1 ダメージにより最上位の cardB が墓地へ。
    // 残るライフTOPは cardA となる。
    expect(session.state.players.p2.grave.length).toBe(1);
    expect(session.state.players.p2.grave[0].cards[0].id).toBe("card-B");
    expect(session.state.players.p2.life[0].id).toBe("card-A");
  });

  it("Test 11: Armed Soldier with 3 cards requires exactly 2 decisions (N-1) sequentially by Owner", () => {
    const card1 = { id: "card-1", suit: "S", rank: "2", value: 2 };
    const card2 = { id: "card-2", suit: "H", rank: "2", value: 2 };
    const card3 = { id: "card-3", suit: "C", rank: "2", value: 2 };
    const armedSoldier = {
      ...buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p2", components: fullRulePackage.components }),
      cards: [card1, card2, card3], // total size = 6
    };

    const state: any = {
      matchId: "match-test-2",
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "k-s1", suit: "S", rank: "1", value: 1 },
            { id: "k-d3", suit: "D", rank: "3", value: 3 }, // 6 % 3 == 0
          ],
          field: [],
          life: [{ id: "p1-l1" }],
          grave: [],
        },
        p2: {
          hand: [],
          field: [armedSoldier],
          life: [{ id: "p2-l1" }],
          grave: [],
        },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const deathLancePatRef = step1.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance";
    });
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: deathLancePatRef,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p1 PASS
    const p1PassRef = step2.request.patterns.findIndex((p) => p.kind === "PASS");
    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1PassRef,
    });
    expect(step3.type).toBe("WAITING_FOR_DECISION");
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p2 PASS -> 解決開始
    const p2PassRef = step3.request.patterns.findIndex((p) => p.kind === "PASS");
    const step4 = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: p2PassRef,
    });

    // 中断 1回目 (3枚中1枚目の選択)
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    if (step4.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step4.request.playerId).toBe("p2");
    expect(step4.request.catalog.orderSelections.length).toBe(3);

    // p2 が card-3 を選択
    const patRef3 = step4.request.patterns.findIndex((p) => {
      const ordSel = step4.request.catalog.orderSelections[p.orderSelectionRef!];
      return ordSel.orderedIds[0] === "card-3";
    });
    const step5 = session.submitDecision({
      decisionId: step4.request.decisionId,
      stateVersion: step4.request.stateVersion,
      selectedPatternRef: patRef3,
    });

    // 中断 2回目 (残り2枚中2枚目の選択)
    expect(step5.type).toBe("WAITING_FOR_DECISION");
    if (step5.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step5.request.playerId).toBe("p2");
    expect(step5.request.catalog.orderSelections.length).toBe(2);

    // p2 が card-1 を選択 (順序: card-3 → card-1 → [自動] card-2)
    const patRef1 = step5.request.patterns.findIndex((p) => {
      const ordSel = step5.request.catalog.orderSelections[p.orderSelectionRef!];
      return ordSel.orderedIds[1] === "card-1";
    });
    const step6 = session.submitDecision({
      decisionId: step5.request.decisionId,
      stateVersion: step5.request.stateVersion,
      selectedPatternRef: patRef1,
    });

    // 2回目で確定し、アクション完了
    expect(step6.type).toBe("WAITING_FOR_DECISION");
    expect(session.state.players.p2.field.length).toBe(0);

    // ♠1 点ダメージで最上位の card-3 が墓地へ
    expect(session.state.players.p2.grave[0].cards[0].id).toBe("card-3");
    // 残るライフTOPは card-1, 次が card-2
    expect(session.state.players.p2.life[0].id).toBe("card-1");
    expect(session.state.players.p2.life[1].id).toBe("card-2");
  });

  // =========================================================================
  // 6. 要塞 (Fortress) との相互作用 (ダメージ無効化常在能力)
  // =========================================================================
  it("Test 12: Fortress prevents Death Lance damage to Owner, but unit still moves to Life TOP", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.deathLance")!;
    const soldierCard = { id: "c-s4", suit: "S", rank: "4", value: 4 };
    const targetSoldier = {
      ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", card: soldierCard, components: fullRulePackage.components }),
      cards: [soldierCard],
    };

    const fortress = buildFieldUnitFromComponent({ componentId: "trump.fortress", playerKey: "p2", components: fullRulePackage.components });
    const otherSoldier = buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", card: { id: "c-other" }, components: fullRulePackage.components });

    const state: any = {
      stateVersion: 1,
      players: {
        p1: { hand: [], field: [], life: [], grave: [] },
        p2: {
          hand: [],
          field: [targetSoldier, otherSoldier, fortress],
          life: [{ id: "p2-l1" }],
          grave: [],
        },
      },
    };

    const keyCards = [
      { id: "k-s5", suit: "S", rank: "5", value: 5 },
      { id: "k-d2", suit: "D", rank: "2", value: 2 }, // 4 % 2 == 0
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: action,
      keyCards,
      targetComponent: targetSoldier,
      components: fullRulePackage.components,
    };

    const execResult = effectInterpreter.executeEffectsWithInterruption(action.effect!, context);
    expect("completed" in execResult && execResult.completed).toBe(true);

    // 兵士はライフTOPへ移動していること
    expect(state.players.p2.field.length).toBe(2); // otherSoldier と fortress が残る
    expect(state.players.p2.life.length).toBe(2);
    expect(state.players.p2.life[0].id).toBe("c-s4");

    // 要塞により ♠5 ダメージは完全無効化され、墓地は0枚
    expect(state.players.p2.grave.length).toBe(0);
  });

  // =========================================================================
  // 7. リプレイ決定論（StateHasher一致）
  // =========================================================================
  it("Test 13: Deterministic replay hashes match across two identical GameSessions", () => {
    const createInitialState = () => ({
      matchId: "match-det-1",
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "k-s3", suit: "S", rank: "3", value: 3 },
            { id: "k-d2", suit: "D", rank: "2", value: 2 },
          ],
          field: [],
          life: [{ id: "p1-l1" }],
          grave: [],
        },
        p2: {
          hand: [],
          field: [
            {
              ...buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p2", components: fullRulePackage.components }),
              cards: [
                { id: "c-1", suit: "H", rank: "2", value: 2 },
                { id: "c-2", suit: "D", rank: "2", value: 2 },
              ],
            },
          ],
          life: [{ id: "p2-l1" }],
          grave: [],
        },
      },
    });

    const runSession = () => {
      const session = new GameSession(createInitialState(), standardRulePackage);
      const step1 = session.advance();
      if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // 1. p1 が死の槍を選択
      const pat1 = step1.request.patterns.findIndex((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance";
      });
      const step2 = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: pat1,
      });
      if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // p1 PASS
      const p1Pass = step2.request.patterns.findIndex((p) => p.kind === "PASS");
      const step3 = session.submitDecision({
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: p1Pass,
      });
      if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // p2 PASS -> 死の槍解決開始 (selectUnitCardOrder 中断)
      const p2Pass = step3.request.patterns.findIndex((p) => p.kind === "PASS");
      const step4 = session.submitDecision({
        decisionId: step3.request.decisionId,
        stateVersion: step3.request.stateVersion,
        selectedPatternRef: p2Pass,
      });
      if (step4.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // 2. p2 が最初の順序選択肢を選択
      session.submitDecision({
        decisionId: step4.request.decisionId,
        stateVersion: step4.request.stateVersion,
        selectedPatternRef: 0,
      });

      return StateHasher.hash(session.state);
    };

    const hash1 = runSession();
    const hash2 = runSession();
    expect(hash1).toBe(hash2);
  });

  // =========================================================================
  // 8. Key Card 不正組合せ拒否 & 境界値 & 順序非依存性 (Sections 23, 24, 25, 26)
  // =========================================================================
  it("Test 14: Invalid Key combinations are rejected and boundary valid combinations are accepted", () => {
    const targetSoldier = buildFieldUnitFromComponent({
      componentId: "character.soldier",
      playerKey: "p2",
      card: { id: "c-t", suit: "H", rank: "4", value: 4 },
      components: fullRulePackage.components,
    });

    const checkHandLegality = (hand: any[]) => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: { hand, field: [], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [], field: [targetSoldier], life: [{ id: "l2" }], grave: [] },
        },
      };
      const dec = LegalPatternGenerator.generateActionRequestDecision(
        state,
        "p1",
        standardRulePackage
      ).request;
      const dlPatterns = dec.patterns.filter((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return dec.catalog.actions[p.actionSelectionRef]?.actionId === "action.deathLance";
      });
      return dlPatterns.length;
    };

    // 不正な組合せ: 0件であること
    // 1. Spade + Spade
    expect(checkHandLegality([
      { id: "k-s1", suit: "S", rank: "5", value: 5 },
      { id: "k-s2", suit: "S", rank: "A", value: 1 },
    ])).toBe(0);

    // 2. Diamond + Diamond
    expect(checkHandLegality([
      { id: "k-d1", suit: "D", rank: "5", value: 5 },
      { id: "k-d2", suit: "D", rank: "A", value: 1 },
    ])).toBe(0);

    // 3. Heart + Diamond
    expect(checkHandLegality([
      { id: "k-h1", suit: "H", rank: "5", value: 5 },
      { id: "k-d1", suit: "D", rank: "A", value: 1 },
    ])).toBe(0);

    // 4. Spade + Club
    expect(checkHandLegality([
      { id: "k-s1", suit: "S", rank: "5", value: 5 },
      { id: "k-c1", suit: "C", rank: "A", value: 1 },
    ])).toBe(0);

    // 5. Heart + Club
    expect(checkHandLegality([
      { id: "k-h1", suit: "H", rank: "5", value: 5 },
      { id: "k-c1", suit: "C", rank: "A", value: 1 },
    ])).toBe(0);

    // 6. 1枚のみ
    expect(checkHandLegality([
      { id: "k-s1", suit: "S", rank: "5", value: 5 },
    ])).toBe(0);

    // 7. Joker を Spade/Diamond 代用
    expect(checkHandLegality([
      { id: "k-j1", suit: "Joker", rank: "Joker", value: 20 },
      { id: "k-d1", suit: "D", rank: "5", value: 5 },
    ])).toBe(0);
    expect(checkHandLegality([
      { id: "k-s1", suit: "S", rank: "5", value: 5 },
      { id: "k-j1", suit: "Joker", rank: "Joker", value: 20 },
    ])).toBe(0);

    // 境界値テスト: 合法であること (Spade A..K + Diamond A..K)
    // 8. Spade A + Diamond A
    expect(checkHandLegality([
      { id: "k-sa", suit: "S", rank: "A", value: 1 },
      { id: "k-da", suit: "D", rank: "A", value: 1 },
    ])).toBeGreaterThanOrEqual(1);

    // 9. Spade K + Diamond K
    expect(checkHandLegality([
      { id: "k-sk", suit: "S", rank: "K", value: 13 },
      { id: "k-dk", suit: "D", rank: "K", value: 13 },
    ])).toBeGreaterThanOrEqual(1);

    // 10. Spade 2 + Diamond Q
    expect(checkHandLegality([
      { id: "k-s2", suit: "S", rank: "2", value: 2 },
      { id: "k-dq", suit: "D", rank: "Q", value: 12 },
    ])).toBeGreaterThanOrEqual(1);
  });

  it("Test 15: Key suit order in keyCards does not affect Diamond divisor or Spade damage", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.deathLance")!;
    const soldierCard = { id: "c-s6", suit: "H", rank: "6", value: 6 };
    const targetSoldier = {
      ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", card: soldierCard, components: fullRulePackage.components }),
      cards: [soldierCard],
    };

    const state: any = {
      stateVersion: 1,
      players: {
        p1: { hand: [], field: [], life: [], grave: [] },
        p2: {
          hand: [],
          field: [targetSoldier],
          life: [{ id: "p2-l1" }, { id: "p2-l2" }, { id: "p2-l3" }],
          grave: [],
        },
      },
    };

    // keyCards の順序を通常 (Spade, Diamond) と逆の [Diamond, Spade] に設定
    const keyCardsReversed = [
      { id: "k-d3", suit: "D", rank: "3", value: 3 }, // divisor: 6 % 3 === 0
      { id: "k-s2", suit: "S", rank: "2", value: 2 }, // damage: 2 点
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: action,
      keyCards: keyCardsReversed,
      targetComponent: targetSoldier,
      components: fullRulePackage.components,
    };

    const execResult = effectInterpreter.executeEffectsWithInterruption(action.effect!, context);
    expect("completed" in execResult ? execResult.completed : execResult.selectionType === "zoneTop").toBe(true);

    // 兵士はライフTOPへ移動
    expect(state.players.p2.field.length).toBe(0);
    // 元のライフ3枚 + 移動1枚 = 4枚、その後 ♠2 点ダメージで最上位2枚 (兵士 c-s6 と p2-l1) が墓地へ
    expect(state.players.p2.grave.length).toBe(2);
    expect(state.players.p2.grave[0].cards[0].id).toBe("c-s6");
    expect(state.players.p2.grave[1].cards[0].id).toBe("p2-l1");
    expect(state.players.p2.life.length).toBe(2);
  });

  // =========================================================================
  // 9. Next Generation 非誘発契約 (Sections 27, 28, 29, 30)
  // =========================================================================
  it("Test 16: Next Generation is NOT triggered by Field -> Life -> Grave", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.deathLance")!;
    // Legacy Card (Ace card) を構成カードに持つ武装兵士
    const legacyAceCard = { id: "c-legacy-ace", suit: "S", rank: "A", value: 1 };
    const otherCard = { id: "c-normal-2", suit: "H", rank: "2", value: 2 };

    const targetSoldier = {
      ...buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p2", components: fullRulePackage.components }),
      cards: [legacyAceCard, otherCard],
    };

    const state: any = {
      stateVersion: 1,
      requestBuffer: { requests: [] },
      stage: { requests: [] },
      players: {
        p1: { hand: [], field: [], life: [], grave: [] },
        p2: {
          hand: [],
          field: [targetSoldier],
          life: [{ id: "p2-l1" }],
          grave: [],
        },
      },
    };

    const keyCards = [
      { id: "k-s1", suit: "S", rank: "1", value: 1 }, // damage: 1
      { id: "k-d1", suit: "D", rank: "A", value: 1 }, // 3 % 1 == 0
    ];

    // イベント捕捉用リスナー
    const cardMovedEvents: Array<{ cardId: string; fromZone: string; toZone: string }> = [];
    const originalDispatch = effectInterpreter.dispatchEvent.bind(effectInterpreter);
    effectInterpreter.dispatchEvent = (event: any, ctx: any) => {
      if (event.type === "cardMoved") {
        cardMovedEvents.push({
          cardId: event.payload.card.id,
          fromZone: event.payload.fromZone,
          toZone: event.payload.toZone,
        });
      }
      return originalDispatch(event, ctx);
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: action,
      keyCards,
      targetComponent: targetSoldier,
      components: fullRulePackage.components,
      selections: {
        deathLanceOrder: ["c-legacy-ace", "c-normal-2"], // legacyAceCard を Life TOP に配置
      },
    };

    try {
      const execResult = effectInterpreter.executeEffectsWithInterruption(action.effect!, context);
      expect("completed" in execResult && execResult.completed).toBe(true);

      // 1. イベントシーケンスの検証:
      // field -> life (2枚)
      // life -> grave (1枚: legacyAceCard)
      expect(cardMovedEvents).toHaveLength(3);
      expect(cardMovedEvents[0]).toEqual({ cardId: "c-legacy-ace", fromZone: "field", toZone: "life" });
      expect(cardMovedEvents[1]).toEqual({ cardId: "c-normal-2", fromZone: "field", toZone: "life" });
      expect(cardMovedEvents[2]).toEqual({ cardId: "c-legacy-ace", fromZone: "life", toZone: "grave" });

      // 2. field -> grave イベントが存在しないこと
      const hasFieldToGrave = cardMovedEvents.some((e) => e.fromZone === "field" && e.toZone === "grave");
      expect(hasFieldToGrave).toBe(false);

      // 3. requestBuffer および stage に action.nextGeneration が誘発していないこと (0件)
      const nextGenBuffer = (state.requestBuffer?.requests || []).filter(
        (r: any) => r.actionId === "action.nextGeneration" || r.action?.id === "action.nextGeneration"
      );
      const nextGenStage = (state.stage?.requests || []).filter(
        (r: any) => r.actionId === "action.nextGeneration" || r.action?.id === "action.nextGeneration"
      );
      expect(nextGenBuffer.length).toBe(0);
      expect(nextGenStage.length).toBe(0);
    } finally {
      effectInterpreter.dispatchEvent = originalDispatch;
    }
  });

  // =========================================================================
  // 10. moveUnitCardsToZoneTop の fail-closed 契約 (Sections 31, 32, 33, 34, 35)
  // =========================================================================
  it("Test 17: moveUnitCardsToZoneTop accepts empty array life: []", () => {
    const soldierCard = { id: "c-emp", suit: "S", rank: "2", value: 2 };
    const targetSoldier = {
      ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", card: soldierCard, components: fullRulePackage.components }),
      cards: [soldierCard],
    };
    const state: any = {
      players: {
        p2: { field: [targetSoldier], life: [] },
      },
    };
    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      targetComponent: targetSoldier,
      components: fullRulePackage.components,
    };

    registry.execute(
      "moveUnitCardsToZoneTop",
      { target: "target", player: "p2", zone: "life", order: ["c-emp"] },
      context
    );

    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.life.length).toBe(1);
    expect(state.players.p2.life[0].id).toBe("c-emp");
  });

  it("Test 18: moveUnitCardsToZoneTop rejects missing/malformed life and field fail-closed", () => {
    const soldierCard = { id: "c-mal", suit: "S", rank: "2", value: 2 };
    const makeTarget = () => ({
      ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", card: soldierCard, components: fullRulePackage.components }),
      cards: [soldierCard],
    });

    // 1. life is undefined
    const stateNoLife: any = { players: { p2: { field: [makeTarget()], life: undefined } } };
    expect(() => {
      registry.execute(
        "moveUnitCardsToZoneTop",
        { target: "target", player: "p2", zone: "life", order: ["c-mal"] },
        { state: stateNoLife, playerKey: "p1", targetPlayerKey: "p2", targetComponent: stateNoLife.players.p2.field[0], components: fullRulePackage.components }
      );
    }).toThrow(/life が配列ではありません/);

    // 2. life is null
    const stateNullLife: any = { players: { p2: { field: [makeTarget()], life: null } } };
    expect(() => {
      registry.execute(
        "moveUnitCardsToZoneTop",
        { target: "target", player: "p2", zone: "life", order: ["c-mal"] },
        { state: stateNullLife, playerKey: "p1", targetPlayerKey: "p2", targetComponent: stateNullLife.players.p2.field[0], components: fullRulePackage.components }
      );
    }).toThrow(/life が配列ではありません/);

    // 3. life is object
    const stateObjLife: any = { players: { p2: { field: [makeTarget()], life: {} } } };
    expect(() => {
      registry.execute(
        "moveUnitCardsToZoneTop",
        { target: "target", player: "p2", zone: "life", order: ["c-mal"] },
        { state: stateObjLife, playerKey: "p1", targetPlayerKey: "p2", targetComponent: stateObjLife.players.p2.field[0], components: fullRulePackage.components }
      );
    }).toThrow(/life が配列ではありません/);

    // 4. field is undefined
    const stateNoField: any = { players: { p2: { field: undefined, life: [] } } };
    expect(() => {
      registry.execute(
        "moveUnitCardsToZoneTop",
        { target: "target", player: "p2", zone: "life", order: ["c-mal"] },
        { state: stateNoField, playerKey: "p1", targetPlayerKey: "p2", targetComponent: makeTarget(), components: fullRulePackage.components }
      );
    }).toThrow(/field が配列ではありません/);
  });

  // =========================================================================
  // 11. 3枚カード兵士の Order WAITING 中 Snapshot → Restore → Resume (Sections 5, 6, 7, 8, 9, 10, 11, 45, 53)
  // =========================================================================
  const cardA = { id: "c-A", suit: "S", rank: "4", value: 4 };
  const cardB = { id: "c-B", suit: "H", rank: "4", value: 4 };
  const cardC = { id: "c-C", suit: "D", rank: "4", value: 4 };

  const makeSnapshotTestInitialState = () => ({
    matchId: "match-snap-3card",
    stateVersion: 1,
    turnPlayer: "p1",
    chancePlayer: "p1",
    stage: { requests: [] },
    players: {
      p1: {
        hand: [
          { id: "k-s2", suit: "S", rank: "2", value: 2 }, // ♠2 点ダメージ
          { id: "k-d3", suit: "D", rank: "3", value: 3 }, // 12 % 3 == 0
        ],
        field: [],
        life: [{ id: "p1-l1" }],
        grave: [],
      },
      p2: {
        hand: [],
        field: [
          {
            ...buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p2", components: fullRulePackage.components }),
            cards: [cardA, cardB, cardC],
          },
        ],
        life: [{ id: "p2-l1" }],
        grave: [],
      },
    },
  });

  const setupIntermediateOrderState = () => {
    const session = new GameSession(makeSnapshotTestInitialState(), standardRulePackage);
    const step1: any = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const dlPat = step1.request.patterns.findIndex(
      (p: any) => p.actionSelectionRef !== undefined && step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance"
    );
    const step2: any = session.submitDecision({ decisionId: step1.request.decisionId, stateVersion: step1.request.stateVersion, selectedPatternRef: dlPat });
    const p1Pass = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3: any = session.submitDecision({ decisionId: step2.request.decisionId, stateVersion: step2.request.stateVersion, selectedPatternRef: p1Pass });
    const p2Pass = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step4: any = session.submitDecision({ decisionId: step3.request.decisionId, stateVersion: step3.request.stateVersion, selectedPatternRef: p2Pass });

    // p2 が 1枚目に c-B を選択
    const patRefB = step4.request.patterns.findIndex(
      (p: any) => step4.request.catalog.orderSelections[p.orderSelectionRef!].orderedIds[0] === "c-B"
    );
    const step5: any = session.submitDecision({ decisionId: step4.request.decisionId, stateVersion: step4.request.stateVersion, selectedPatternRef: patRefB });
    return { session, step5 };
  };

  it("Test 19: Order WAITING state with 3-card soldier creates valid snapshot with pending decision", () => {
    const { session, step5 } = setupIntermediateOrderState();
    expect(step5.type).toBe("WAITING_FOR_DECISION");
    expect(step5.request.playerId).toBe("p2");
    expect(step5.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step5.request.catalog.orderSelections.length).toBe(2);

    const snapshot = session.createSnapshot();
    expect(snapshot.snapshotFormatVersion).toBe(1);
    expect(snapshot.gameStateHash).toBeDefined();
    expect(snapshot.session.pendingDecision).toBeDefined();
    expect(snapshot.session.pendingDecision!.playerId).toBe("p2");
    expect(snapshot.session.pendingDecision!.source.type).toBe("EFFECT_RESOLUTION");
    if (snapshot.session.pendingDecision!.source.type !== "EFFECT_RESOLUTION") throw new Error("Expected EFFECT_RESOLUTION");
    expect(snapshot.session.pendingDecision!.source.effectStepId).toBe("selectUnitCardOrder");
  });

  it("Test 20: Snapshot restore via GameSession.fromSnapshot restores exact same Order Decision with partial order", () => {
    const { session } = setupIntermediateOrderState();
    const snapshot = session.createSnapshot();

    const restoredSession = GameSession.fromSnapshot(snapshot, standardRulePackage);
    const restoredStep: any = restoredSession.advance();
    expect(restoredStep.type).toBe("WAITING_FOR_DECISION");
    expect(restoredStep.request.playerId).toBe("p2");
    expect(restoredStep.request.source.type).toBe("EFFECT_RESOLUTION");
    if (restoredStep.request.source.type !== "EFFECT_RESOLUTION") throw new Error("Expected EFFECT_RESOLUTION");
    expect(restoredStep.request.source.effectStepId).toBe("selectUnitCardOrder");
    expect(restoredStep.request.catalog.orderSelections.length).toBe(2);

    const choices = restoredStep.request.catalog.orderSelections.map((s: any) => s.orderedIds[1]);
    expect(choices).toContain("c-A");
    expect(choices).toContain("c-C");
  });

  it("Test 21: Restored session resumes order selection and final StateHash equals non-restored session", () => {
    const { session, step5 } = setupIntermediateOrderState();
    const snapshot = session.createSnapshot();

    const restoredSession = GameSession.fromSnapshot(snapshot, standardRulePackage);
    const restoredStep: any = restoredSession.advance();

    // 復元 Session で c-A を選択 (順序: c-B -> c-A -> [自動] c-C)
    const patRefAInRestored = restoredStep.request.patterns.findIndex(
      (p: any) => restoredStep.request.catalog.orderSelections[p.orderSelectionRef!].orderedIds[1] === "c-A"
    );
    restoredSession.submitDecision({
      decisionId: restoredStep.request.decisionId,
      stateVersion: restoredStep.request.stateVersion,
      selectedPatternRef: patRefAInRestored,
    });

    // 非復元 Session でも同じく c-A を選択
    const patRefAInOrig = step5.request.patterns.findIndex(
      (p: any) => step5.request.catalog.orderSelections[p.orderSelectionRef!].orderedIds[1] === "c-A"
    );
    session.submitDecision({
      decisionId: step5.request.decisionId,
      stateVersion: step5.request.stateVersion,
      selectedPatternRef: patRefAInOrig,
    });

    // 最終 StateHash が完全一致
    expect(StateHasher.hash(restoredSession.state)).toBe(StateHasher.hash(session.state));
    expect(restoredSession.state.players.p2.life[0].id).toBe("c-C");
    expect(restoredSession.state.players.p2.grave[0].cards[0].id).toBe("c-B");
    expect(restoredSession.state.players.p2.grave[1].cards[0].id).toBe("c-A");
  });

  // =========================================================================
  // 12. 実際の Decision Transcript を用いた Fresh Session Replay (Sections 12, 13, 14, 15, 16, 17, 43, 44, 54)
  // =========================================================================
  const cardReplayA = { id: "c-tA", suit: "S", rank: "4", value: 4 };
  const cardReplayB = { id: "c-tB", suit: "H", rank: "4", value: 4 };
  const cardReplayC = { id: "c-tC", suit: "D", rank: "4", value: 4 };

  const makeReplayInitialState = () => ({
    matchId: "match-transcript-replay",
    stateVersion: 1,
    turnPlayer: "p1",
    chancePlayer: "p1",
    stage: { requests: [] },
    players: {
      p1: {
        hand: [
          { id: "k-s3", suit: "S", rank: "3", value: 3 },
          { id: "k-d2", suit: "D", rank: "2", value: 2 },
        ],
        field: [],
        life: [{ id: "p1-l1" }],
        grave: [],
      },
      p2: {
        hand: [],
        field: [
          {
            ...buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p2", components: fullRulePackage.components }),
            cards: [cardReplayA, cardReplayB, cardReplayC],
          },
        ],
        life: [{ id: "p2-l1" }, { id: "p2-l2" }],
        grave: [],
      },
    },
  });

  const recordSessionATranscript = () => {
    const sessionA = new GameSession(makeReplayInitialState(), standardRulePackage);
    const transcript: Array<{ playerId: string; selectedPatternRef: number }> = [];

    const s1: any = sessionA.advance();
    const dlPat = s1.request.patterns.findIndex(
      (p: any) => p.actionSelectionRef !== undefined && s1.request.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance"
    );
    transcript.push({ playerId: "p1", selectedPatternRef: dlPat });
    const s2: any = sessionA.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: dlPat });

    const p1Pass = s2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    transcript.push({ playerId: "p1", selectedPatternRef: p1Pass });
    const s3: any = sessionA.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: p1Pass });

    const p2Pass = s3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    transcript.push({ playerId: "p2", selectedPatternRef: p2Pass });
    const s4: any = sessionA.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: p2Pass });

    const patRefB = s4.request.patterns.findIndex(
      (p: any) => s4.request.catalog.orderSelections[p.orderSelectionRef!].orderedIds[0] === "c-tB"
    );
    transcript.push({ playerId: "p2", selectedPatternRef: patRefB });
    const s5: any = sessionA.submitDecision({ decisionId: s4.request.decisionId, stateVersion: s4.request.stateVersion, selectedPatternRef: patRefB });

    const patRefA = s5.request.patterns.findIndex(
      (p: any) => s5.request.catalog.orderSelections[p.orderSelectionRef!].orderedIds[1] === "c-tA"
    );
    transcript.push({ playerId: "p2", selectedPatternRef: patRefA });
    sessionA.submitDecision({ decisionId: s5.request.decisionId, stateVersion: s5.request.stateVersion, selectedPatternRef: patRefA });

    return { sessionA, transcript };
  };

  it("Test 22: Decision Transcript is captured from Session A containing sequential order selections", () => {
    const { transcript } = recordSessionATranscript();
    expect(transcript).toHaveLength(5);
    expect(transcript[0].playerId).toBe("p1"); // deathLance
    expect(transcript[1].playerId).toBe("p1"); // pass
    expect(transcript[2].playerId).toBe("p2"); // pass
    expect(transcript[3].playerId).toBe("p2"); // order B
    expect(transcript[4].playerId).toBe("p2"); // order A
  });

  it("Test 23: Fresh Session B replays selectedPatternRef transcript using Session B's own decisionId", () => {
    const { transcript } = recordSessionATranscript();
    const sessionB = new GameSession(makeReplayInitialState(), standardRulePackage);

    for (const entry of transcript) {
      const step: any = sessionB.pendingDecision ? { type: "WAITING_FOR_DECISION" as const, request: sessionB.pendingDecision } : sessionB.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe(entry.playerId);

      const next = sessionB.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: entry.selectedPatternRef,
      });
      expect(next).toBeDefined();
    }

    expect(sessionB.state.players.p2.field.length).toBe(0);
  });

  it("Test 24: Replayed Session B produces exact StateHash and full state equality with Session A", () => {
    const { sessionA, transcript } = recordSessionATranscript();
    const sessionB = new GameSession(makeReplayInitialState(), standardRulePackage);

    for (const entry of transcript) {
      const step: any = sessionB.pendingDecision ? { type: "WAITING_FOR_DECISION" as const, request: sessionB.pendingDecision } : sessionB.advance();
      sessionB.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: entry.selectedPatternRef,
      });
    }

    expect(StateHasher.hash(sessionA.state)).toBe(StateHasher.hash(sessionB.state));
    expect(sessionA.state.players.p2.life).toEqual(sessionB.state.players.p2.life);
    expect(sessionA.state.players.p2.grave).toEqual(sessionB.state.players.p2.grave);
    expect(sessionA.state.players.p2.field).toEqual(sessionB.state.players.p2.field);
    expect(sessionA.state.stage).toEqual(sessionB.state.stage);
    expect(sessionA.state.chancePlayer).toEqual(sessionB.state.chancePlayer);
  });

  // =========================================================================
  // 13. AI Policies (FirstLegal / Random / Genome) & AI Schema 回帰 (Sections 18, 19, 20, 21, 22, 28, 29, 55, 56)
  // =========================================================================
  it("Test 25: FirstLegalPolicy resolves Order DecisionRequest and submits successfully", () => {
    const cardA = { id: "c-aiA", suit: "S", rank: "4", value: 4 };
    const cardB = { id: "c-aiB", suit: "H", rank: "4", value: 4 };

    const state: any = {
      matchId: "match-ai-firstlegal",
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [
            { id: "k-s1", suit: "S", rank: "1", value: 1 },
            { id: "k-d2", suit: "D", rank: "2", value: 2 },
          ],
          field: [],
          life: [{ id: "p1-l1" }],
          grave: [],
        },
        p2: {
          hand: [],
          field: [
            {
              ...buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p2", components: fullRulePackage.components }),
              cards: [cardA, cardB],
            },
          ],
          life: [{ id: "p2-l1" }],
          grave: [],
        },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const s1: any = session.advance();
    const dlPat = s1.request.patterns.findIndex(
      (p: any) => p.actionSelectionRef !== undefined && s1.request.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance"
    );
    const s2: any = session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: dlPat });
    const s3: any = session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: s2.request.patterns.findIndex((p: any) => p.kind === "PASS") });
    const s4: any = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: s3.request.patterns.findIndex((p: any) => p.kind === "PASS") });

    // Order Decision
    expect(s4.request.source.type).toBe("EFFECT_RESOLUTION");
    const policy = new FirstLegalPolicy(false);
    const response = policy.choose(s4.request);

    expect(response.decisionId).toBe(s4.request.decisionId);
    expect(response.stateVersion).toBe(s4.request.stateVersion);
    expect(response.selectedPatternRef).toBeGreaterThanOrEqual(0);
    expect(response.selectedPatternRef).toBeLessThan(s4.request.patterns.length);

    // 実 Session への提出
    session.submitDecision(response);
    expect(session.state.players.p2.field.length).toBe(0);
  });

  it("Test 26: RandomPolicy with same SeededRandom seed returns deterministic Order response", () => {
    const cardA = { id: "c-rA", suit: "S", rank: "4", value: 4 };
    const cardB = { id: "c-rB", suit: "H", rank: "4", value: 4 };
    const cardC = { id: "c-rC", suit: "D", rank: "4", value: 4 };

    const state: any = {
      matchId: "match-ai-random",
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [
            { id: "k-s1", suit: "S", rank: "1", value: 1 },
            { id: "k-d2", suit: "D", rank: "2", value: 2 },
          ],
          field: [],
          life: [{ id: "p1-l1" }],
          grave: [],
        },
        p2: {
          hand: [],
          field: [
            {
              ...buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p2", components: fullRulePackage.components }),
              cards: [cardA, cardB, cardC],
            },
          ],
          life: [{ id: "p2-l1" }],
          grave: [],
        },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const s1: any = session.advance();
    const dlPat = s1.request.patterns.findIndex(
      (p: any) => p.actionSelectionRef !== undefined && s1.request.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance"
    );
    const s2: any = session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: dlPat });
    const s3: any = session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: s2.request.patterns.findIndex((p: any) => p.kind === "PASS") });
    const s4: any = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: s3.request.patterns.findIndex((p: any) => p.kind === "PASS") });

    const policy1 = new RandomPolicy(12345);
    const policy2 = new RandomPolicy(12345);

    const resp1 = policy1.choose(s4.request);
    const resp2 = policy2.choose(s4.request);

    expect(resp1.selectedPatternRef).toBe(resp2.selectedPatternRef);

    // 実 Session への提出
    session.submitDecision(resp1);
    expect(session.state.players.p2.field.length).toBe(1); // 2回目 Order WAITING
  });

  it("Test 27: ManualGenericGenome / GenomePolicy resolves Order Decision and submits successfully", () => {
    const cardA = { id: "c-gA", suit: "S", rank: "4", value: 4 };
    const cardB = { id: "c-gB", suit: "H", rank: "4", value: 4 };

    const state: any = {
      matchId: "match-ai-genome",
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [
            { id: "k-s1", suit: "S", rank: "1", value: 1 },
            { id: "k-d2", suit: "D", rank: "2", value: 2 },
          ],
          field: [],
          life: [{ id: "p1-l1" }],
          grave: [],
        },
        p2: {
          hand: [],
          field: [
            {
              ...buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p2", components: fullRulePackage.components }),
              cards: [cardA, cardB],
            },
          ],
          life: [{ id: "p2-l1" }],
          grave: [],
        },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const s1: any = session.advance();
    const dlPat = s1.request.patterns.findIndex(
      (p: any) => p.actionSelectionRef !== undefined && s1.request.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance"
    );
    const s2: any = session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: dlPat });
    const s3: any = session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: s2.request.patterns.findIndex((p: any) => p.kind === "PASS") });
    const s4: any = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: s3.request.patterns.findIndex((p: any) => p.kind === "PASS") });

    const manualPolicy = new GenomePolicy(createManualGenericGenomeDNA());
    const resp = manualPolicy.choose(s4.request);

    expect(resp.decisionId).toBe(s4.request.decisionId);
    expect(resp.stateVersion).toBe(s4.request.stateVersion);
    expect(resp.selectedPatternRef).toBeGreaterThanOrEqual(0);
    expect(resp.selectedPatternRef).toBeLessThan(s4.request.patterns.length);

    session.submitDecision(resp);
    expect(session.state.players.p2.field.length).toBe(0);
  });

  it("Test 28: FEATURE_SCHEMA_VERSION remains 1 without new features", () => {
    expect(FEATURE_SCHEMA_VERSION).toBe(1);
  });

  it("Test 29: ManualGenericGenome DNA dimension remains exactly 1482 weights", () => {
    const dna = createManualGenericGenomeDNA();
    expect(dna.patternWeights.length + dna.contextPatternWeights.length).toBe(1482);
  });
});
