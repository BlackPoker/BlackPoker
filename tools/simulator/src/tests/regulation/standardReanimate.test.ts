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
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
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
import {
  enumeratePhysicalCardsInGrave,
  findPhysicalCardInGrave,
  removePhysicalCardFromGrave,
} from "../../engine/rules/graveCardUtils";

describe("Official Regulation Phase 3.0-E - Reanimate & Grave Physical Card Selection Tests", () => {
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
    standardPackReg = await getRegulation("standard-pack");
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

  // =========================================================================
  // 1. メタデータおよび定義の整合性テスト (SSOT検証: ruby undefined)
  // =========================================================================
  it("Test 1: action.reanimate exact metadata in examples/reanimate.yaml (ruby undefined)", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.reanimate");
    expect(action).toBeDefined();
    expect(action!.id).toBe("action.reanimate");
    expect(action!.name).toBe("リアニメイト");
    // SSOT (act.yaml line 405) では ruby は定義されていないため undefined であること
    expect(action!.ruby).toBeUndefined();
    expect(action!.type).toBe("magic");

    // request properties
    expect(action!.request?.trigger).toBe("direct");
    expect(action!.request?.speed).toBe("normal");
    expect(action!.request?.timing).toBe("main");

    // cost is undefined (no cost)
    expect(action!.cost).toBeUndefined();

    // key definition: 2 cards (spade A..K + heart A..K)
    expect(action!.key).toBeDefined();
    expect(action!.key!.count).toBe(2);
    expect(action!.key!.conditions?.length).toBe(2);
    expect(action!.key!.conditions![0].card?.suit).toBe("spade");
    expect(action!.key!.conditions![1].card?.suit).toBe("heart");

    // targets: exactly 1 target, type: unit, relation: self, componentType: character
    expect(action!.targets).toBeDefined();
    expect(action!.targets!.length).toBe(1);
    expect(action!.targets![0].type).toBe("unit");
    expect(action!.targets![0].condition?.relation).toBe("self");
    expect(action!.targets![0].condition?.componentType).toBe("character");
  });

  // =========================================================================
  // 2. Node & Browser Loader 整合性テスト
  // =========================================================================
  it("Test 2: Node loader and Browser loader consistency (count 26, contains reanimate)", () => {
    const browserPackage = loadRulePackageForBrowser();
    expect(browserPackage.actions.length).toBe(26);
    expect(fullRulePackage.actions.length).toBe(26);

    const nodeActionIds = fullRulePackage.actions.map((a) => a.id).sort();
    const browserActionIds = browserPackage.actions.map((a) => a.id).sort();
    expect(browserActionIds).toEqual(nodeActionIds);
    expect(nodeActionIds).toContain("action.reanimate");
    expect(browserActionIds).toContain("action.reanimate");
  });

  // =========================================================================
  // 3. レギュレーションフォーマット包含テスト
  // =========================================================================
  it("Test 3: Standard format contains action.reanimate, Light format does NOT", () => {
    expect(standardFormat.actions).toContain("action.reanimate");
    const stdAction = standardRulePackage.actions.find((a) => a.id === "action.reanimate");
    expect(stdAction).toBeDefined();

    expect(lightFormat.actions).not.toContain("action.reanimate");
  });

  // =========================================================================
  // 4. キーカードの適法・非法組み合わせテスト
  // =========================================================================
  it("Test 4: Key card legality: Spade + Heart is legal, others are illegal", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.reanimate")!;

    const createHandState = (hand: any[]) => ({
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand,
          field: [
            buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", components: fullRulePackage.components }),
          ],
          life: [{ id: "l1" }],
          grave: [{ id: "g1", suit: "C", rank: "2", value: 2 }],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
    });

    const checkLegal = (hand: any[]) => {
      const state = createHandState(hand);
      const { request } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
      return request.patterns.some((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate";
      });
    };

    // ♠ + ♡ -> 合法
    expect(checkLegal([
      { id: "c-s1", suit: "S", rank: "A", value: 1 },
      { id: "c-h1", suit: "H", rank: "K", value: 13 },
    ])).toBe(true);

    // ♠ + ♠ -> 非法
    expect(checkLegal([
      { id: "c-s1", suit: "S", rank: "A", value: 1 },
      { id: "c-s2", suit: "S", rank: "K", value: 13 },
    ])).toBe(false);

    // ♡ + ♡ -> 非法
    expect(checkLegal([
      { id: "c-h1", suit: "H", rank: "A", value: 1 },
      { id: "c-h2", suit: "H", rank: "K", value: 13 },
    ])).toBe(false);

    // ♢ + ♡ -> 非法
    expect(checkLegal([
      { id: "c-d1", suit: "D", rank: "A", value: 1 },
      { id: "c-h1", suit: "H", rank: "K", value: 13 },
    ])).toBe(false);

    // ♠ + ♣ -> 非法
    expect(checkLegal([
      { id: "c-s1", suit: "S", rank: "A", value: 1 },
      { id: "c-c1", suit: "C", rank: "K", value: 13 },
    ])).toBe(false);

    // 1枚のみ -> 非法
    expect(checkLegal([
      { id: "c-s1", suit: "S", rank: "A", value: 1 },
    ])).toBe(false);

    // 3枚 (♠ + ♡ + ♣) -> ♠ + ♡ のペアから合法パターンが生成されるが、3枚一括キーは生成されない
    const state3 = createHandState([
      { id: "c-s1", suit: "S", rank: "A", value: 1 },
      { id: "c-h1", suit: "H", rank: "K", value: 13 },
      { id: "c-c1", suit: "C", rank: "2", value: 2 },
    ]);
    const { request: req3 } = LegalPatternGenerator.generateActionRequestDecision(state3, "p1", standardRulePackage);
    const reanimatePatterns = req3.patterns.filter((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return req3.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate";
    });
    // ペアごとに生成されるため、♠+♡ の組み合わせで1件生成される
    expect(reanimatePatterns.length).toBe(1);
    const cardSel = req3.catalog.cardSelections[reanimatePatterns[0].keyCardSelectionRef!];
    expect(cardSel.cardIds.length).toBe(2);

    // ジョーカーを含む組み合わせ -> 非法 (A..K 指定のため)
    expect(checkLegal([
      { id: "c-j1", suit: "Joker", rank: "Joker", value: 0 },
      { id: "c-h1", suit: "H", rank: "K", value: 13 },
    ])).toBe(false);
  });

  // =========================================================================
  // 5. ターゲット適法性テスト (自軍キャラクターのみ合法)
  // =========================================================================
  it("Test 5: Target legality: Own characters legal, opponent and non-characters illegal", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.reanimate")!;
    const targetDef = action.targets![0];

    const ownSoldier = buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", components: fullRulePackage.components });
    const ownHero = buildFieldUnitFromComponent({ componentId: "character.hero", playerKey: "p1", components: fullRulePackage.components });
    const ownAce = buildFieldUnitFromComponent({ componentId: "character.ace", playerKey: "p1", components: fullRulePackage.components });
    const ownMagician = buildFieldUnitFromComponent({ componentId: "character.magician", playerKey: "p1", components: fullRulePackage.components });
    const ownArmedSoldier = buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p1", components: fullRulePackage.components });
    const ownBulwark = buildFieldUnitFromComponent({ componentId: "character.bulwark", playerKey: "p1", components: fullRulePackage.components });

    const oppSoldier = buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", components: fullRulePackage.components });
    const oppHero = buildFieldUnitFromComponent({ componentId: "character.hero", playerKey: "p2", components: fullRulePackage.components });

    const evalTarget = (unit: any, owner: string) =>
      evaluateUnitTargetCondition(unit, targetDef.condition, {
        playerKey: "p1",
        unitOwnerKey: owner,
        components: fullRulePackage.components,
      });

    // 自軍キャラクター 6種すべて合法
    expect(evalTarget(ownSoldier, "p1").isValid).toBe(true);
    expect(evalTarget(ownHero, "p1").isValid).toBe(true);
    expect(evalTarget(ownAce, "p1").isValid).toBe(true);
    expect(evalTarget(ownMagician, "p1").isValid).toBe(true);
    expect(evalTarget(ownArmedSoldier, "p1").isValid).toBe(true);
    expect(evalTarget(ownBulwark, "p1").isValid).toBe(true);

    // 敵軍キャラクターは非法 (relation: self 違反)
    expect(evalTarget(oppSoldier, "p2").isValid).toBe(false);
    expect(evalTarget(oppSoldier, "p2").reason).toBe("TARGET_CONDITION_UNMET");
    expect(evalTarget(oppHero, "p2").isValid).toBe(false);

    // 非キャラクター (例: fog) は非法
    const fog = { componentId: "fog.up", unitId: "fog-1", bindings: {} };
    expect(evalTarget(fog, "p1").isValid).toBe(false);
    expect(evalTarget(fog, "p1").reason).toBe("TARGET_CONDITION_UNMET");
  });

  // =========================================================================
  // 6. 墓地物理カード抽出ユーティリティテスト (raw card, unit wrapper, mixed)
  // =========================================================================
  it("Test 6: Grave physical card extraction handles raw cards, wrappers, and mixed grave", () => {
    const rawCard1 = { id: "c-raw1", suit: "S", rank: "3", value: 3 };
    const rawCard2 = { id: "c-raw2", suit: "H", rank: "5", value: 5 };
    const wrapperSingle = {
      unitId: "u-single",
      componentId: "character.soldier",
      cards: [{ id: "c-wrap1", suit: "D", rank: "7", value: 7 }],
    };
    const wrapperMulti = {
      unitId: "u-multi",
      componentId: "character.armedSoldier",
      cards: [
        { id: "c-multi1", suit: "C", rank: "9", value: 9 },
        { id: "c-multi2", suit: "S", rank: "J", value: 11 },
      ],
    };

    const grave = [rawCard1, wrapperSingle, rawCard2, wrapperMulti];

    const cards = enumeratePhysicalCardsInGrave(grave);
    expect(cards.length).toBe(5);
    expect(cards.map((c) => c.id)).toEqual(["c-raw1", "c-wrap1", "c-raw2", "c-multi1", "c-multi2"]);

    // findPhysicalCardInGrave
    const loc1 = findPhysicalCardInGrave(grave, "c-raw1");
    expect(loc1).toBeDefined();
    if (loc1 && loc1.type === "direct") {
      expect(loc1.graveIndex).toBe(0);
      expect(loc1.card.id).toBe("c-raw1");
    } else {
      throw new Error("loc1 should be direct");
    }

    const loc2 = findPhysicalCardInGrave(grave, "c-wrap1");
    expect(loc2).toBeDefined();
    if (loc2 && loc2.type === "unit") {
      expect(loc2.graveIndex).toBe(1);
      expect(loc2.cardIndex).toBe(0);
      expect(loc2.card.id).toBe("c-wrap1");
    } else {
      throw new Error("loc2 should be unit");
    }

    const loc3 = findPhysicalCardInGrave(grave, "c-multi2");
    expect(loc3).toBeDefined();
    if (loc3 && loc3.type === "unit") {
      expect(loc3.graveIndex).toBe(3);
      expect(loc3.cardIndex).toBe(1);
      expect(loc3.card.id).toBe("c-multi2");
    } else {
      throw new Error("loc3 should be unit");
    }

    const locNotFound = findPhysicalCardInGrave(grave, "c-nonexistent");
    expect(locNotFound).toBeUndefined();

    // 重複IDのフェイルクローズ検証
    const corruptGrave = [
      rawCard1,
      { unitId: "u-dup", cards: [{ id: "c-raw1", suit: "S", rank: "3", value: 3 }] },
    ];
    expect(() => enumeratePhysicalCardsInGrave(corruptGrave)).toThrow("Grave内に重複したcard.id");
    expect(() => findPhysicalCardInGrave(corruptGrave, "c-raw1")).toThrow("Grave内に重複したcard.id");
  });

  // =========================================================================
  // 7. 基本成功フロー (ターゲット墓地送り -> 墓地カード兵士配置 -> cardMovedイベント)
  // =========================================================================
  it("Test 7: Basic success flow: Target moves to grave, selected card deploys as soldier (up, charge)", () => {
    const soldierCard = { id: "c-soldier1", suit: "D", rank: "4", value: 4 };
    const targetUnit = {
      ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", card: soldierCard, components: fullRulePackage.components }),
      cards: [soldierCard],
    };

    const graveCard = { id: "c-grave1", suit: "H", rank: "7", value: 7 };
    const keySpade = { id: "c-s2", suit: "S", rank: "2", value: 2 };
    const keyHeart = { id: "c-h3", suit: "H", rank: "3", value: 3 };

    const state: any = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keySpade, keyHeart],
          field: [targetUnit],
          life: [{ id: "l1" }],
          grave: [graveCard],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");

    // p1 が reanimate を発動
    const reanimatePat = step1.request.patterns.findIndex(
      (p: any) => p.actionSelectionRef !== undefined && step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
    );
    expect(reanimatePat).toBeGreaterThanOrEqual(0);

    const step2: any = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: reanimatePat,
    });

    // 優先権パス: p1 PASS -> p2 PASS
    const p1Pass = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3: any = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1Pass,
    });
    const p2Pass = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step4: any = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: p2Pass,
    });

    // 効果解決時: selectCards で中断 (WAITING_FOR_DECISION)
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    expect(step4.request.playerId).toBe("p1");
    expect(step4.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step4.request.source.effectStepId).toBe("selectCards");

    // 候補に c-grave1 が存在することを確認
    const cardPat = step4.request.patterns.findIndex(
      (p: any) => p.effectSelectionRef !== undefined && step4.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes("c-grave1")
    );
    expect(cardPat).toBeGreaterThanOrEqual(0);

    // c-grave1 を選択
    const stepFinal: any = session.submitDecision({
      decisionId: step4.request.decisionId,
      stateVersion: step4.request.stateVersion,
      selectedPatternRef: cardPat,
    });

    // 解決完了後の状態検証
    const p1 = session.state.players.p1;
    // 1. targetUnit (soldier1) はフィールドから消え、墓地に存在する
    expect(p1.field.some((u: any) => u.unitId === targetUnit.unitId)).toBe(false);
    expect(p1.grave.some((item: any) => (item.unitId === targetUnit.unitId) || (item.id === "c-soldier1"))).toBe(true);

    // 2. c-grave1 は墓地から消え、フィールドに新たな soldier として存在する
    expect(p1.grave.some((item: any) => item.id === "c-grave1")).toBe(false);
    const newUnit = p1.field.find((u: any) => u.cards?.some((c: any) => c.id === "c-grave1"));
    expect(newUnit).toBeDefined();
    expect(newUnit.componentId).toBe("character.soldier");
    expect(newUnit.face).toBe("up");
    expect(newUnit.state).toBe("charge");

    // 3. キーカード (c-s2, c-h3) は墓地に送られている
    expect(p1.grave.some((c: any) => c.id === "c-s2")).toBe(true);
    expect(p1.grave.some((c: any) => c.id === "c-h3")).toBe(true);
  });

  // =========================================================================
  // 8. 複数カードユニットラッパーからの物理カード抽出と残留検証
  // =========================================================================
  it("Test 8: Extracting 1 card from multi-card wrapper retains remaining card in wrapper", () => {
    const cardA = { id: "c-mA", suit: "S", rank: "5", value: 5 };
    const cardB = { id: "c-mB", suit: "H", rank: "6", value: 6 };
    const multiWrapper = {
      unitId: "u-armed",
      componentId: "character.armedSoldier",
      cards: [cardA, cardB],
    };

    const grave = [multiWrapper];

    // cardA を抽出
    const extracted = removePhysicalCardFromGrave(grave, "c-mA");
    expect(extracted.id).toBe("c-mA");

    // ラッパーは墓地に残り、cardB のみを含む
    expect(grave.length).toBe(1);
    expect(grave[0].unitId).toBe("u-armed");
    expect(grave[0].cards.length).toBe(1);
    expect(grave[0].cards[0].id).toBe("c-mB");
  });

  // =========================================================================
  // 9. 単一カードユニットラッパーからの物理カード抽出と空ラッパー除去検証
  // =========================================================================
  it("Test 9: Extracting only card from single-card wrapper removes the empty wrapper completely", () => {
    const cardA = { id: "c-sA", suit: "D", rank: "8", value: 8 };
    const singleWrapper = {
      unitId: "u-single",
      componentId: "character.soldier",
      cards: [cardA],
    };

    const grave = [singleWrapper];

    const extracted = removePhysicalCardFromGrave(grave, "c-sA");
    expect(extracted.id).toBe("c-sA");

    // 空になったラッパーは墓地から完全に取り除かれる
    expect(grave.length).toBe(0);
  });

  // =========================================================================
  // 10. 世代交代 (Next Generation) 誘発契約の検証
  // =========================================================================
  it("Test 10: Target character with Legacy Card triggers nextGeneration; Reanimated card does NOT", () => {
    // ターゲットは J (Legacy Card) を持つ兵士
    const legacyCard = { id: "c-j1", suit: "S", rank: "J", value: 11 };
    const targetSoldier = {
      ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", card: legacyCard, components: fullRulePackage.components }),
      cards: [legacyCard],
    };

    // 蘇生対象も K (Legacy Card)
    const reanimateCard = { id: "c-k1", suit: "H", rank: "K", value: 13 };

    const state: any = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      requestBuffer: { requests: [], history: [] },
      players: {
        p1: {
          hand: [
            { id: "c-s2", suit: "S", rank: "2", value: 2 },
            { id: "c-h3", suit: "H", rank: "3", value: 3 },
          ],
          field: [targetSoldier],
          life: [
            { id: "c-life1", suit: "C", rank: "5", value: 5 },
            { id: "c-life2", suit: "D", rank: "K", value: 13 }, // 世代交代で手札に入るレガシー
          ],
          grave: [reanimateCard],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    const reanimatePat = step1.request.patterns.findIndex(
      (p: any) => p.actionSelectionRef !== undefined && step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
    );
    const step2: any = session.submitDecision({ decisionId: step1.request.decisionId, stateVersion: step1.request.stateVersion, selectedPatternRef: reanimatePat });
    const p1Pass = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3: any = session.submitDecision({ decisionId: step2.request.decisionId, stateVersion: step2.request.stateVersion, selectedPatternRef: p1Pass });
    const p2Pass = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step4: any = session.submitDecision({ decisionId: step3.request.decisionId, stateVersion: step3.request.stateVersion, selectedPatternRef: p2Pass });

    // c-k1 を選択
    const cardPat = step4.request.patterns.findIndex(
      (p: any) => p.effectSelectionRef !== undefined && step4.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes("c-k1")
    );
    session.submitDecision({ decisionId: step4.request.decisionId, stateVersion: step4.request.stateVersion, selectedPatternRef: cardPat });

    // ターゲットの J 兵士が墓地に送られたことによる nextGeneration は誘発している
    // (field -> grave のみ誘発、grave -> field の c-k1 は誘発しないため nextGen の triggered は 1件のみ)
    const triggeredNextGen = session.state.requestBuffer.history.filter(
      (h: any) => h.actionId === "action.nextGeneration" && h.status === "triggered"
    );
    expect(triggeredNextGen.length).toBe(1);

    const resolvedNextGen = session.state.requestBuffer.history.filter(
      (h: any) => h.actionId === "action.nextGeneration" && h.status === "resolvedImmediately"
    );
    expect(resolvedNextGen.length).toBe(1);
  });

  // =========================================================================
  // 11. 墓地0枚時の部分解決 (Rule 5.4.4)
  // =========================================================================
  it("Test 11: Grave 0 cards partial resolution (Rule 5.4.4): Legal action, target moves, 0 soldiers deployed", () => {
    const soldierCard = { id: "c-sol", suit: "D", rank: "4", value: 4 };
    const targetUnit = {
      ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", card: soldierCard, components: fullRulePackage.components }),
      cards: [soldierCard],
    };

    const state: any = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "c-s2", suit: "S", rank: "2", value: 2 },
            { id: "c-h3", suit: "H", rank: "3", value: 3 },
          ],
          field: [targetUnit],
          life: [{ id: "l1" }],
          grave: [], // 墓地0枚
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
    };

    // 1. 墓地0枚でも発動可能であること
    const { request: initialReq } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const hasReanimate = initialReq.patterns.some(
      (p) => p.actionSelectionRef !== undefined && initialReq.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
    );
    expect(hasReanimate).toBe(true);

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    const reanimatePat = step1.request.patterns.findIndex(
      (p: any) => p.actionSelectionRef !== undefined && step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
    );
    const step2: any = session.submitDecision({ decisionId: step1.request.decisionId, stateVersion: step1.request.stateVersion, selectedPatternRef: reanimatePat });
    const p1Pass = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3: any = session.submitDecision({ decisionId: step2.request.decisionId, stateVersion: step2.request.stateVersion, selectedPatternRef: p1Pass });
    const p2Pass = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");

    // 墓地0枚のため selectCards は中断せず空選択となり、自動的に target が墓地へ送られて完了する
    const stepFinal: any = session.submitDecision({ decisionId: step3.request.decisionId, stateVersion: step3.request.stateVersion, selectedPatternRef: p2Pass });

    const p1 = session.state.players.p1;
    // ターゲットは墓地に送られている
    expect(p1.field.length).toBe(0);
    expect(p1.grave.some((u: any) => u.unitId === targetUnit.unitId || u.id === "c-sol")).toBe(true);
    // 新たな兵士は配置されていない
    expect(p1.field.length).toBe(0);
  });

  // =========================================================================
  // 12. 解決前ターゲット消失 (Target Lost)
  // =========================================================================
  it("Test 12: Target lost before resolution: effect skipped, grave card untouched", () => {
    const soldierCard = { id: "c-sol", suit: "D", rank: "4", value: 4 };
    const targetUnit = {
      ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", card: soldierCard, components: fullRulePackage.components }),
      cards: [soldierCard],
    };
    const graveCard = { id: "c-g1", suit: "H", rank: "9", value: 9 };

    const state: any = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "c-s2", suit: "S", rank: "2", value: 2 },
            { id: "c-h3", suit: "H", rank: "3", value: 3 },
          ],
          field: [targetUnit],
          life: [{ id: "l1" }],
          grave: [graveCard],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    const reanimatePat = step1.request.patterns.findIndex(
      (p: any) => p.actionSelectionRef !== undefined && step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
    );
    const step2: any = session.submitDecision({ decisionId: step1.request.decisionId, stateVersion: step1.request.stateVersion, selectedPatternRef: reanimatePat });
    const p1Pass = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3: any = session.submitDecision({ decisionId: step2.request.decisionId, stateVersion: step2.request.stateVersion, selectedPatternRef: p1Pass });

    // 解決直前に対象がフィールドから除去される（例: 別効果や破壊）
    session.state.players.p1.field = [];

    const p2Pass = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const stepFinal: any = session.submitDecision({ decisionId: step3.request.decisionId, stateVersion: step3.request.stateVersion, selectedPatternRef: p2Pass });

    // ターゲット消失により効果解決がスキップされ、selectCards への到達・カード配置は行われない
    const p1 = session.state.players.p1;
    expect(p1.field.length).toBe(0);
    // 墓地カードはそのまま残る
    expect(p1.grave.some((c: any) => c.id === "c-g1")).toBe(true);
  });

  // =========================================================================
  // 13. 移動失敗 (targetMoved: false) による蘇生キャンセル
  // =========================================================================
  it("Test 13: Move failure (targetMoved: false) leaves grave card in grave without deployment", () => {
    // CommandRegistry 経由で moveToGraveyard と ifResult の連携を直接検証
    const mockContext: CommandContext = {
      state: {
        players: {
          p1: {
            field: [], // フィールドに対象が存在しない
            grave: [{ id: "c-g1", suit: "S", rank: "4", value: 4 }],
          },
        },
      },
      playerKey: "p1",
      targetComponent: { unitId: "ghost-unit", cards: [{ id: "c-ghost" }] },
      components: fullRulePackage.components,
      selections: { reanimateCard: ["c-g1"] },
      results: {},
    };

    // 1. moveToGraveyard を実行
    registry.execute("moveToGraveyard", { target: "target", resultId: "targetMoved" }, mockContext);
    expect(mockContext.results?.targetMoved).toBe(false);

    // 2. ifResult による条件分岐を実行
    const ifResultCmd = {
      ifResult: {
        id: "targetMoved",
        equals: true,
        then: [
          {
            deploySelectedCardsAsUnits: {
              selection: "reanimateCard",
              player: "self",
              component: "character.soldier",
              face: "up",
              state: "charge",
            },
          },
        ],
      },
    };

    effectInterpreter.executeEffect(ifResultCmd, mockContext);

    // then ブロックは実行されず、墓地のカードはそのまま残る
    expect(mockContext.state.players.p1.grave.length).toBe(1);
    expect(mockContext.state.players.p1.grave[0].id).toBe("c-g1");
    expect(mockContext.state.players.p1.field.length).toBe(0);
  });

  // =========================================================================
  // 14. 中断・スナップショット・復元 (Snapshot / Resume) テスト
  // =========================================================================
  it("Test 14: Snapshot & restore during grave card selection preserves exact state and hash", () => {
    const makeInitialState = () => ({
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "c-s2", suit: "S", rank: "2", value: 2 },
            { id: "c-h3", suit: "H", rank: "3", value: 3 },
          ],
          field: [
            {
              ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", card: { id: "c-target", suit: "D", rank: "5", value: 5 }, components: fullRulePackage.components }),
              cards: [{ id: "c-target", suit: "D", rank: "5", value: 5 }],
            },
          ],
          life: [{ id: "l1" }],
          grave: [
            { id: "c-gA", suit: "C", rank: "3", value: 3 },
            { id: "c-gB", suit: "S", rank: "7", value: 7 },
          ],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
    });

    const session = new GameSession(makeInitialState(), standardRulePackage);
    const step1: any = session.advance();
    const reanimatePat = step1.request.patterns.findIndex(
      (p: any) => p.actionSelectionRef !== undefined && step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
    );
    const step2: any = session.submitDecision({ decisionId: step1.request.decisionId, stateVersion: step1.request.stateVersion, selectedPatternRef: reanimatePat });
    const p1Pass = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3: any = session.submitDecision({ decisionId: step2.request.decisionId, stateVersion: step2.request.stateVersion, selectedPatternRef: p1Pass });
    const p2Pass = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step4: any = session.submitDecision({ decisionId: step3.request.decisionId, stateVersion: step3.request.stateVersion, selectedPatternRef: p2Pass });

    expect(step4.type).toBe("WAITING_FOR_DECISION");
    expect(step4.request.source.effectStepId).toBe("selectCards");

    // スナップショットの作成
    const snapshot = session.createSnapshot();
    expect(snapshot.snapshotFormatVersion).toBe(1);
    expect(snapshot.session.pendingDecision).toBeDefined();

    // スナップショットからの復元
    const restoredSession = GameSession.fromSnapshot(snapshot, standardRulePackage);

    // 両方のセッションで c-gB を選択
    const cardPat = step4.request.patterns.findIndex(
      (p: any) => p.effectSelectionRef !== undefined && step4.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes("c-gB")
    );

    session.submitDecision({ decisionId: step4.request.decisionId, stateVersion: step4.request.stateVersion, selectedPatternRef: cardPat });
    restoredSession.submitDecision({ decisionId: step4.request.decisionId, stateVersion: step4.request.stateVersion, selectedPatternRef: cardPat });

    const hashOrig = StateHasher.hash(session.state);
    const hashRestored = StateHasher.hash(restoredSession.state);
    expect(hashRestored).toBe(hashOrig);
  });

  // =========================================================================
  // 15. 別セッション決定論的リプレイ (Fresh Session Deterministic Replay)
  // =========================================================================
  it("Test 15: Fresh session deterministic replay produces exact matching StateHash", () => {
    const makeInitialState = () => ({
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "c-s2", suit: "S", rank: "2", value: 2 },
            { id: "c-h3", suit: "H", rank: "3", value: 3 },
          ],
          field: [
            {
              ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", card: { id: "c-target", suit: "D", rank: "5", value: 5 }, components: fullRulePackage.components }),
              cards: [{ id: "c-target", suit: "D", rank: "5", value: 5 }],
            },
          ],
          life: [{ id: "l1" }],
          grave: [{ id: "c-gA", suit: "C", rank: "3", value: 3 }],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
    });

    const runSession = () => {
      const session = new GameSession(makeInitialState(), standardRulePackage);
      const step1: any = session.advance();
      const reanimatePat = step1.request.patterns.findIndex(
        (p: any) => p.actionSelectionRef !== undefined && step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
      );
      const step2: any = session.submitDecision({ decisionId: step1.request.decisionId, stateVersion: step1.request.stateVersion, selectedPatternRef: reanimatePat });
      const p1Pass = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
      const step3: any = session.submitDecision({ decisionId: step2.request.decisionId, stateVersion: step2.request.stateVersion, selectedPatternRef: p1Pass });
      const p2Pass = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
      const step4: any = session.submitDecision({ decisionId: step3.request.decisionId, stateVersion: step3.request.stateVersion, selectedPatternRef: p2Pass });

      const cardPat = step4.request.patterns.findIndex(
        (p: any) => p.effectSelectionRef !== undefined && step4.request.catalog.effectSelections[p.effectSelectionRef].selectedValues.includes("c-gA")
      );
      session.submitDecision({ decisionId: step4.request.decisionId, stateVersion: step4.request.stateVersion, selectedPatternRef: cardPat });
      return StateHasher.hash(session.state);
    };

    const hashA = runSession();
    const hashB = runSession();
    expect(hashB).toBe(hashA);
  });

  // =========================================================================
  // 16. AI ポリシー対応 (FirstLegal, Random, SeededRandom, GenomePolicy)
  // =========================================================================
  it("Test 16: AI policies can evaluate and select legal decisions during reanimate", () => {
    const makeInitialState = () => ({
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "c-s2", suit: "S", rank: "2", value: 2 },
            { id: "c-h3", suit: "H", rank: "3", value: 3 },
          ],
          field: [
            {
              ...buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", card: { id: "c-target", suit: "D", rank: "5", value: 5 }, components: fullRulePackage.components }),
              cards: [{ id: "c-target", suit: "D", rank: "5", value: 5 }],
            },
          ],
          life: [{ id: "l1" }],
          grave: [{ id: "c-gA", suit: "C", rank: "3", value: 3 }],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
    });

    const setupToReanimateDecision = () => {
      const session = new GameSession(makeInitialState(), standardRulePackage);
      const s1: any = session.advance();
      const reanimatePat = s1.request.patterns.findIndex(
        (p: any) => p.actionSelectionRef !== undefined && s1.request.catalog.actions[p.actionSelectionRef].actionId === "action.reanimate"
      );
      const s2: any = session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: reanimatePat });
      const s3: any = session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: s2.request.patterns.findIndex((p: any) => p.kind === "PASS") });
      const s4: any = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: s3.request.patterns.findIndex((p: any) => p.kind === "PASS") });
      return { session, s4 };
    };

    // 1. FirstLegalPolicy
    const { session: sFL, s4: s4FL } = setupToReanimateDecision();
    expect(s4FL.request.source.type).toBe("EFFECT_RESOLUTION");
    const firstLegal = new FirstLegalPolicy();
    const respFL = firstLegal.choose(s4FL.request);
    expect(respFL.selectedPatternRef).toBeGreaterThanOrEqual(0);
    sFL.submitDecision(respFL);
    expect(sFL.state.players.p1.field.some((u: any) => u.cards?.some((c: any) => c.id === "c-gA"))).toBe(true);

    // 2. RandomPolicy (seeded)
    const { session: sRnd, s4: s4Rnd } = setupToReanimateDecision();
    const randomPol = new RandomPolicy(42);
    const respRnd = randomPol.choose(s4Rnd.request);
    expect(respRnd.selectedPatternRef).toBeGreaterThanOrEqual(0);
    sRnd.submitDecision(respRnd);
    expect(sRnd.state.players.p1.field.some((u: any) => u.cards?.some((c: any) => c.id === "c-gA"))).toBe(true);

    // 3. GenomePolicy
    const { session: sGen, s4: s4Gen } = setupToReanimateDecision();
    const dna = createManualGenericGenomeDNA();
    const genomePolicy = new GenomePolicy(dna);
    const respGen = genomePolicy.choose(s4Gen.request);
    expect(respGen.selectedPatternRef).toBeGreaterThanOrEqual(0);
    sGen.submitDecision(respGen);
    expect(sGen.state.players.p1.field.some((u: any) => u.cards?.some((c: any) => c.id === "c-gA"))).toBe(true);
  });

  // =========================================================================
  // 17. スキーマ・DNA次元の安定性
  // =========================================================================
  it("Test 17: Feature schema version and DNA dimension remain stable", () => {
    expect(FEATURE_SCHEMA_VERSION).toBe(1);
    const dna = createManualGenericGenomeDNA();
    expect(dna.patternWeights.length + dna.contextPatternWeights.length).toBe(1482);
  });
});
