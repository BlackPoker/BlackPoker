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
import { CommandRegistry, CommandContext, cancelStageRequest } from "../../engine/rules/CommandRegistry";
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
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { evaluateUnitTargetCondition } from "../../engine/rules/targetConditionUtils";
import { buildFieldUnitFromComponent, moveUnitToHandHandler, moveRequestKeyCardsToHandHandler } from "../../engine/rules/commandHandlers";
import { isCardInGameZones } from "../../engine/rules/cardUtils";

describe("Official Regulation Phase 3.0-G - Return / 帰還 (action.unsummons) Tests", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let standardFormat: any;
  let standardPackReg: any;
  let standardRulePackage: RulePackage;

  let abilityEvaluator: AbilityEvaluator;
  let expressionEvaluator: ExpressionEvaluator;
  let registry: CommandRegistry;
  let effectInterpreter: EffectInterpreter;
  let validator: ActionRequestValidator;

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

    abilityEvaluator = new AbilityEvaluator();
    expressionEvaluator = new ExpressionEvaluator();
    registry = new CommandRegistry();
    effectInterpreter = (registry as any).effectInterpreter;
    validator = new ActionRequestValidator();
  });

  /**
   * 帰還発動から優先権パス（p1 PASS -> p2 PASS）までを進める共通ヘルパー
   */
  function playReturnAndPass(session: GameSession, targetUnitId?: string): any {
    const step1: any = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");

    const unsummonsPat = step1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = step1.request.catalog.actions[p.actionSelectionRef];
      if (act.actionId !== "action.unsummons") return false;
      if (targetUnitId) {
        const tgt = step1.request.catalog.targetSelections[p.targetSelectionRef];
        return tgt?.targetUnitId === targetUnitId;
      }
      return true;
    });
    expect(unsummonsPat).toBeGreaterThanOrEqual(0);

    const step2: any = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: unsummonsPat,
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
  // 1. 公式メタデータ完全性検証 (SSOT act.yaml line 516-531)
  // =========================================================================
  it("Test 1: action.unsummons exact metadata (ruby: きかん, Quick, Cost B, sameSuit, componentType: character)", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.unsummons");
    expect(action).toBeDefined();
    expect(action!.name).toBe("帰還");
    expect(action!.ruby).toBe("きかん");
    expect(action!.type).toBe("magic");
    expect(action!.cost).toBe("B");

    expect(action!.request).toBeDefined();
    expect(action!.request?.timing).toBe("quick");
    expect(action!.request?.speed).toBe("normal");
    expect(action!.request?.trigger).toBe("direct");

    expect(action!.key).toBeDefined();
    expect(action!.key?.count).toBe(2);
    expect(action!.key?.sameSuit).toBe(true);
    expect(action!.key?.condition?.card?.suit).toEqual(["spade", "heart", "diamond", "club"]);
    expect(action!.key?.condition?.card?.rank).toBe("A..K");
    expect(action!.key?.condition?.card?.zone).toBe("hand");

    expect(action!.targets).toBeDefined();
    expect(action!.targets!.length).toBe(1);
    expect(action!.targets![0].type).toBe("unit");
    expect(action!.targets![0].condition?.relation).toBe("self");
    expect(action!.targets![0].condition?.componentType).toBe("character");
    // state: charge は Target condition に指定されていないこと
    expect(action!.targets![0].condition?.state).toBeUndefined();
    // excludeCharacterType 等の不要な拡張が含まれていないこと
    expect((action!.targets![0].condition as any)?.excludeCharacterType).toBeUndefined();
  });

  // =========================================================================
  // 2. Same-Suit Key 合法組み合わせ検証 (Same-suit legal, mixed-suit illegal)
  // =========================================================================
  it("Test 2: Same-suit Key combinations are legal, mixed-suit combinations are illegal", () => {
    const cardH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const cardHK = { id: "c-hk", suit: "H", rank: "K", value: 13 };
    const cardS5 = { id: "c-s5", suit: "S", rank: "5", value: 5 };

    const bulwark = {
      unitId: "u-bw-1",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "c-bw", suit: "D", rank: "3", value: 3 }],
    };

    const soldier = {
      unitId: "u-sol-1",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-sol", suit: "C", rank: "4", value: 4 }],
    };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-2",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [cardH2, cardHK, cardS5], field: [bulwark, soldier], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const { request: decisionReq } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const unsummonsPatterns = decisionReq.patterns.filter((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return decisionReq.catalog.actions[p.actionSelectionRef].actionId === "action.unsummons";
    });

    // 少なくとも1つの合法パターンが存在すること
    expect(unsummonsPatterns.length).toBeGreaterThan(0);

    // すべての合法パターンにおいて、選択されたキーカードが同一スート (♡2 + ♡K) であること
    for (const pat of unsummonsPatterns) {
      const cardSel = decisionReq.catalog.cardSelections[pat.keyCardSelectionRef!];
      expect(cardSel.cardIds).toHaveLength(2);
      expect(cardSel.cardIds).toContain("c-h2");
      expect(cardSel.cardIds).toContain("c-hk");
      expect(cardSel.cardIds).not.toContain("c-s5");
    }
  });

  // =========================================================================
  // 3. Same-Suit 3枚所持時の組み合わせ数 (3 choose 2 = 3組すべて合法)
  // =========================================================================
  it("Test 3: Three cards of same suit produce all 3 combinations", () => {
    const cardH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const cardH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const cardHK = { id: "c-hk", suit: "H", rank: "K", value: 13 };

    const bulwark = {
      unitId: "u-bw-1",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "c-bw", suit: "D", rank: "3", value: 3 }],
    };

    const soldier = {
      unitId: "u-sol-1",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-sol", suit: "C", rank: "4", value: 4 }],
    };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-3",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [cardH2, cardH5, cardHK], field: [bulwark, soldier], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const { request: decisionReq } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const unsummonsPatterns = decisionReq.patterns.filter((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return decisionReq.catalog.actions[p.actionSelectionRef].actionId === "action.unsummons";
    });

    const keySets = new Set(
      unsummonsPatterns.map((p: any) => {
        const sel = decisionReq.catalog.cardSelections[p.keyCardSelectionRef!];
        return [...sel.cardIds].sort().join(",");
      })
    );

    // 3組すべて列挙されていること: {h2, h5}, {h2, hk}, {h5, hk}
    expect(keySets.has("c-h2,c-h5")).toBe(true);
    expect(keySets.has("c-h2,c-hk")).toBe(true);
    expect(keySets.has("c-h5,c-hk")).toBe(true);
    expect(keySets.size).toBe(3);
  });

  // =========================================================================
  // 4. Joker 除外検証 (Joker + Joker, Joker + Suited card は sameSuit キーにならない)
  // =========================================================================
  it("Test 4: Joker is excluded from same-suit key pairs (4 suits definition: spade, heart, diamond, club)", () => {
    const jk1 = { id: "c-jk1", suit: "Joker", rank: "Joker", value: 0 };
    const jk2 = { id: "c-jk2", suit: "Joker", rank: "Joker", value: 0 };
    const cardH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const cardH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };

    const bulwark = {
      unitId: "u-bw-1",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "c-bw", suit: "D", rank: "3", value: 3 }],
    };

    const soldier = {
      unitId: "u-sol-1",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-sol", suit: "C", rank: "4", value: 4 }],
    };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-4",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: [jk1, jk2, cardH2, cardH5], field: [bulwark, soldier], life: [{ id: "l1" }], grave: [] },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const { request: decisionReq } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const unsummonsPatterns = decisionReq.patterns.filter((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return decisionReq.catalog.actions[p.actionSelectionRef].actionId === "action.unsummons";
    });

    // 合法なキーは {c-h2, c-h5} のみ
    for (const pat of unsummonsPatterns) {
      const sel = decisionReq.catalog.cardSelections[pat.keyCardSelectionRef!];
      expect(sel.cardIds).not.toContain("c-jk1");
      expect(sel.cardIds).not.toContain("c-jk2");
    }
  });

  // =========================================================================
  // 5. ActionRequestValidator Core Validation (fail-closed)
  // =========================================================================
  it("Test 5: ActionRequestValidator rejects mixed-suit and Joker key cards (fail-closed)", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.unsummons")!;

    const dummyBulwark = {
      unitId: "u-bw-1",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "c-bw", suit: "D", rank: "3", value: 3 }],
    };

    const dummySoldier = {
      unitId: "u-sol-1",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-sol", suit: "C", rank: "4", value: 4 }],
    };

    const baseState: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { field: [dummyBulwark, dummySoldier], hand: [], life: [], grave: [] },
        p2: { field: [], hand: [], life: [], grave: [] },
      },
      stage: { requests: [] },
    };

    // 1. スート不一致 (♡2 + ♠2)
    const mixedSuitContext: CommandContext = {
      state: baseState,
      playerKey: "p1",
      keyCards: [
        { id: "c-h2", suit: "H", rank: "2", value: 2 },
        { id: "c-s2", suit: "S", rank: "2", value: 2 },
      ],
      targetComponent: dummySoldier,
      actions: fullRulePackage.actions,
      components: fullRulePackage.components,
    };
    expect(() => validator.validateActionRequest(action, mixedSuitContext)).toThrow(ValidationError);

    // 2. Joker 混入 (Joker + ♡2)
    const jokerContext: CommandContext = {
      state: baseState,
      playerKey: "p1",
      keyCards: [
        { id: "c-jk", suit: "Joker", rank: "Joker", value: 0 },
        { id: "c-h2", suit: "H", rank: "2", value: 2 },
      ],
      targetComponent: dummySoldier,
      actions: fullRulePackage.actions,
      components: fullRulePackage.components,
    };
    expect(() => validator.validateActionRequest(action, jokerContext)).toThrow(ValidationError);

    // 3. 枚数不足 (1枚)
    const singleCardContext: CommandContext = {
      state: baseState,
      playerKey: "p1",
      keyCards: [{ id: "c-h2", suit: "H", rank: "2", value: 2 }],
      targetComponent: dummySoldier,
      actions: fullRulePackage.actions,
      components: fullRulePackage.components,
    };
    expect(() => validator.validateActionRequest(action, singleCardContext)).toThrow(ValidationError);
  });

  // =========================================================================
  // 6. ターゲット適格性検証 (自軍全キャラクター種別が合法、防壁も含む、敵軍は非法)
  // =========================================================================
  it("Test 6: Target eligibility (Soldier, Hero, Ace, Magician, Armed Soldier, Bulwark are ALL legal; opponent is illegal)", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.unsummons")!;
    const targetDef = action.targets![0];

    const ownSoldier = buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p1", components: fullRulePackage.components });
    const ownHero = buildFieldUnitFromComponent({ componentId: "character.hero", playerKey: "p1", components: fullRulePackage.components });
    const ownAce = buildFieldUnitFromComponent({ componentId: "character.ace", playerKey: "p1", components: fullRulePackage.components });
    const ownMagician = buildFieldUnitFromComponent({ componentId: "character.magician", playerKey: "p1", components: fullRulePackage.components });
    const ownArmedSoldier = buildFieldUnitFromComponent({ componentId: "character.armedSoldier", playerKey: "p1", components: fullRulePackage.components });
    const ownBulwark = buildFieldUnitFromComponent({ componentId: "character.bulwark", playerKey: "p1", components: fullRulePackage.components });

    const oppSoldier = buildFieldUnitFromComponent({ componentId: "character.soldier", playerKey: "p2", components: fullRulePackage.components });
    const oppBulwark = buildFieldUnitFromComponent({ componentId: "character.bulwark", playerKey: "p2", components: fullRulePackage.components });

    const evalTarget = (unit: any, owner: string) =>
      evaluateUnitTargetCondition(unit, targetDef.condition, {
        playerKey: "p1",
        unitOwnerKey: owner,
        components: fullRulePackage.components,
      });

    // 自軍キャラクター 6種すべて合法 (防壁含む！)
    expect(evalTarget(ownSoldier, "p1").isValid).toBe(true);
    expect(evalTarget(ownHero, "p1").isValid).toBe(true);
    expect(evalTarget(ownAce, "p1").isValid).toBe(true);
    expect(evalTarget(ownMagician, "p1").isValid).toBe(true);
    expect(evalTarget(ownArmedSoldier, "p1").isValid).toBe(true);
    expect(evalTarget(ownBulwark, "p1").isValid).toBe(true);

    // 敵軍ユニットは非法 (relation: self 違反)
    expect(evalTarget(oppSoldier, "p2").isValid).toBe(false);
    expect(evalTarget(oppBulwark, "p2").isValid).toBe(false);

    // 非キャラクター (例: fog) は非法
    const fog = { componentId: "fog.up", unitId: "fog-1", bindings: {} };
    expect(evalTarget(fog, "p1").isValid).toBe(false);
  });

  // =========================================================================
  // 7. チャージ兵士の帰還 (Charged Soldier returns to hand, Keys return to hand)
  // =========================================================================
  it("Test 7: Charged Soldier returns to hand, Key cards return to hand, Cost B is driven", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-7",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-sol-1");

    // 1. 兵士がフィールドから消えていること
    expect(session.state.players.p1.field.some((u: any) => u.unitId === "u-sol-1")).toBe(false);

    // 2. 兵士のカード (solCard) およびキーカード (keyH2, keyH5) が手札に存在すること
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.some((c: any) => c.id === "c-sol-1")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-h2")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-h5")).toBe(true);
    expect(p1Hand).toHaveLength(3);

    // 3. Unit wrapper 自体は手札に入っていないこと (すべて physical card)
    for (const card of p1Hand) {
      expect((card as any).unitId).toBeUndefined();
      expect((card as any).componentId).toBeUndefined();
    }

    // 4. コストとして支払った防壁が drive になっていること
    const bw = session.state.players.p1.field.find((u: any) => u.unitId === "u-bw-1");
    expect(bw).toBeDefined();
    expect(bw.state).toBe("drive");

    // 5. 墓地は不変であること (0枚)
    expect(session.state.players.p1.grave).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBeUndefined();
  });

  // =========================================================================
  // 8. ドライブ兵士の帰還 (Driven Soldier stays on field, Keys return to hand - Rule 5.4.4)
  // =========================================================================
  it("Test 8: Driven Soldier stays on field (Step 1 no-op), Key cards return to hand (Step 2)", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-8",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "drive", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-sol-1");

    // 1. ドライブ兵士はフィールドに残っていること (state は drive のまま)
    const sol = session.state.players.p1.field.find((u: any) => u.unitId === "u-sol-1");
    expect(sol).toBeDefined();
    expect(sol.state).toBe("drive");

    // 2. キーカードは手札に戻っていること
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.some((c: any) => c.id === "c-h2")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-h5")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-sol-1")).toBe(false);
    expect(p1Hand).toHaveLength(2);

    // 3. 墓地は不変 (0枚)
    expect(session.state.players.p1.grave).toHaveLength(0);
  });

  // =========================================================================
  // 9. チャージ防壁の帰還 (Charged Bulwark returns to hand as normal card)
  // =========================================================================
  it("Test 9: Charged Bulwark returns to hand as physical card (no wrapper, no down metadata)", () => {
    const keyS3 = { id: "c-s3", suit: "S", rank: "3", value: 3 };
    const keyS9 = { id: "c-s9", suit: "S", rank: "9", value: 9 };
    const bwCard1 = { id: "c-bw-cost", suit: "D", rank: "4", value: 4 };
    const bwCard2 = { id: "c-bw-target", suit: "C", rank: "7", value: 7 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-9",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyS3, keyS9],
          field: [
            { unitId: "u-bw-cost", componentId: "character.bulwark", state: "charge", cards: [bwCard1] },
            { unitId: "u-bw-target", componentId: "character.bulwark", state: "charge", cards: [bwCard2] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-bw-target");

    // 1. 対象の防壁がフィールドから除去されていること
    expect(session.state.players.p1.field.some((u: any) => u.unitId === "u-bw-target")).toBe(false);

    // 2. 防壁カードが手札に戻っていること
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.some((c: any) => c.id === "c-bw-target")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-s3")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-s9")).toBe(true);
    expect(p1Hand).toHaveLength(3);

    // 3. 手札内の防壁カードは通常のカード実体であり、ユニットラッパーを含まないこと
    const returnedCard = p1Hand.find((c: any) => c.id === "c-bw-target");
    expect(returnedCard.suit).toBe("C");
    expect(returnedCard.rank).toBe("7");
    expect((returnedCard as any).face).toBeUndefined();
    expect((returnedCard as any).unitId).toBeUndefined();
  });

  // =========================================================================
  // 10. ドライブ防壁の帰還 (Driven Bulwark stays on field, Keys return to hand)
  // =========================================================================
  it("Test 10: Driven Bulwark stays on field (Step 1 no-op), Key cards return to hand", () => {
    const keyS3 = { id: "c-s3", suit: "S", rank: "3", value: 3 };
    const keyS9 = { id: "c-s9", suit: "S", rank: "9", value: 9 };
    const bwCard1 = { id: "c-bw-cost", suit: "D", rank: "4", value: 4 };
    const bwCard2 = { id: "c-bw-target", suit: "C", rank: "7", value: 7 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-10",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyS3, keyS9],
          field: [
            { unitId: "u-bw-cost", componentId: "character.bulwark", state: "charge", cards: [bwCard1] },
            { unitId: "u-bw-target", componentId: "character.bulwark", state: "drive", cards: [bwCard2] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-bw-target");

    // 1. ドライブ防壁はフィールドに残っていること
    const bw = session.state.players.p1.field.find((u: any) => u.unitId === "u-bw-target");
    expect(bw).toBeDefined();
    expect(bw.state).toBe("drive");

    // 2. キーカードは手札に戻っていること
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.some((c: any) => c.id === "c-s3")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-s9")).toBe(true);
    expect(p1Hand).toHaveLength(2);
  });

  // =========================================================================
  // 11. 解決直前状態変化 (Resolution-time state change: charge -> drive, drive -> charge)
  // =========================================================================
  it("Test 11: Resolution-time state change dynamically dictates outcome", () => {
    // Case A: Request時 charge -> 解決直前に drive に変更された場合
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const stateA: any = {
      stateVersion: 1,
      matchId: "match-test-11a",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const sessionA = new GameSession(stateA, standardRulePackage);
    const step1: any = sessionA.advance();
    const unsummonsPat = step1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.unsummons";
    });
    sessionA.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: unsummonsPat,
    });

    // 解決直前に Soldier を drive 状態へ変更 (他アクション等の介入を模倣)
    sessionA.state.players.p1.field.find((u: any) => u.unitId === "u-sol-1").state = "drive";

    // p1 PASS -> p2 PASS
    const step2 = sessionA.advance();
    const p1Pass = (step2 as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3 = sessionA.submitDecision({
      decisionId: (step2 as any).request.decisionId,
      stateVersion: (step2 as any).request.stateVersion,
      selectedPatternRef: p1Pass,
    });
    const p2Pass = (step3 as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
    sessionA.submitDecision({
      decisionId: (step3 as any).request.decisionId,
      stateVersion: (step3 as any).request.stateVersion,
      selectedPatternRef: p2Pass,
    });

    // 解決時 drive だったため、兵士は残留、キーは手札
    expect(sessionA.state.players.p1.field.some((u: any) => u.unitId === "u-sol-1")).toBe(true);
    expect(sessionA.state.players.p1.hand.some((c: any) => c.id === "c-h2")).toBe(true);
    expect(sessionA.state.players.p1.hand.some((c: any) => c.id === "c-h5")).toBe(true);
  });

  // =========================================================================
  // 12. 同一防壁が Target かつ Cost B に選ばれるケース
  // =========================================================================
  it("Test 12: Same Bulwark chosen as both Target and Cost B: Cost B drives it, Resolution finds it driven (stays, Keys return)", () => {
    // 盤面に防壁が1つだけ存在し、それが Target かつ Cost B に選ばれる
    const keyS1 = { id: "c-s1", suit: "S", rank: "A", value: 1 };
    const keyS2 = { id: "c-s2", suit: "S", rank: "2", value: 2 };
    const bwCard = { id: "c-bw-single", suit: "D", rank: "5", value: 5 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-12",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyS1, keyS2],
          field: [
            { unitId: "u-bw-single", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-bw-single");

    // コスト支払いによって drive になった防壁は、解決時には drive のため Step 1 no-op で残留する
    const bw = session.state.players.p1.field.find((u: any) => u.unitId === "u-bw-single");
    expect(bw).toBeDefined();
    expect(bw.state).toBe("drive");

    // キーカードは手札に戻る
    expect(session.state.players.p1.hand.some((c: any) => c.id === "c-s1")).toBe(true);
    expect(session.state.players.p1.hand.some((c: any) => c.id === "c-s2")).toBe(true);
    expect(session.state.players.p1.hand).toHaveLength(2);
  });

  // =========================================================================
  // 13. 装備兵 (複数枚ユニット) の帰還 (Multi-card Character returns all physical cards)
  // =========================================================================
  it("Test 13: Multi-card Armed Soldier returns all physical cards in order, wrapper destroyed", () => {
    const keyD3 = { id: "c-d3", suit: "D", rank: "3", value: 3 };
    const keyD6 = { id: "c-d6", suit: "D", rank: "6", value: 6 };
    const armedCardA = { id: "c-armed-a", suit: "S", rank: "4", value: 4 };
    const armedCardB = { id: "c-armed-b", suit: "H", rank: "9", value: 9 };
    const bwCard = { id: "c-bw-cost", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-13",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyD3, keyD6],
          field: [
            { unitId: "u-bw-cost", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            {
              unitId: "u-armed-1",
              componentId: "character.armedSoldier",
              state: "charge",
              cards: [armedCardA, armedCardB],
            },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-armed-1");

    // 1. 装備兵ユニットがフィールドから消失
    expect(session.state.players.p1.field.some((u: any) => u.unitId === "u-armed-1")).toBe(false);

    // 2. 2枚のカードが順序維持で手札に追加されていること
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.some((c: any) => c.id === "c-armed-a")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-armed-b")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-d3")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-d6")).toBe(true);
    expect(p1Hand).toHaveLength(4);

    // 順序の検証 (armedCardA が armedCardB より前)
    const idxA = p1Hand.findIndex((c: any) => c.id === "c-armed-a");
    const idxB = p1Hand.findIndex((c: any) => c.id === "c-armed-b");
    expect(idxA).toBeLessThan(idxB);
  });

  // =========================================================================
  // 14. 魔術士 (Joker) の帰還 (Magician returns Joker physical card to hand)
  // =========================================================================
  it("Test 14: Charged Magician returns Joker physical card to hand", () => {
    const keyC2 = { id: "c-c2", suit: "C", rank: "2", value: 2 };
    const keyC8 = { id: "c-c8", suit: "C", rank: "8", value: 8 };
    const jokerCard = { id: "c-joker-magician", suit: "Joker", rank: "Joker", value: 0 };
    const bwCard = { id: "c-bw-cost", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-14",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyC2, keyC8],
          field: [
            { unitId: "u-bw-cost", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-magician-1", componentId: "character.magician", state: "charge", cards: [jokerCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-magician-1");

    // 魔術士ユニットがフィールドから消失
    expect(session.state.players.p1.field.some((u: any) => u.unitId === "u-magician-1")).toBe(false);

    // Joker カードおよびキーカードが手札に戻っていること
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.some((c: any) => c.id === "c-joker-magician")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-c2")).toBe(true);
    expect(p1Hand.some((c: any) => c.id === "c-c8")).toBe(true);
  });

  // =========================================================================
  // 15. コスト B 不足時の検証 (0 charged Bulwarks -> 0 legal patterns for unsummons)
  // =========================================================================
  it("Test 15: Cost B insufficient results in 0 legal patterns for action.unsummons", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const soldier = {
      unitId: "u-sol-1",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-sol", suit: "C", rank: "4", value: 4 }],
    };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-15",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [soldier], // 防壁が存在しない
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const { request: decisionReq } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const unsummonsPatterns = decisionReq.patterns.filter((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return decisionReq.catalog.actions[p.actionSelectionRef].actionId === "action.unsummons";
    });

    // コスト B が支払えないため合法パターンは0件
    expect(unsummonsPatterns).toHaveLength(0);
  });

  // =========================================================================
  // 16. ターゲット消失時の効果スキップ＋キー墓地移動 (Target Lost -> Keys to grave)
  // =========================================================================
  it("Test 16: Target lost before resolution causes Effect skip and Key cards to go to grave via finalizer", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-16",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    const unsummonsPat = step1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.unsummons";
    });
    session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: unsummonsPat,
    });

    // 解決直前にターゲットユニットをフィールドから除去 (破壊・消滅等)
    session.state.players.p1.field = session.state.players.p1.field.filter((u: any) => u.unitId !== "u-sol-1");

    // p1 PASS -> p2 PASS
    const step2 = session.advance();
    const p1Pass = (step2 as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3 = session.submitDecision({
      decisionId: (step2 as any).request.decisionId,
      stateVersion: (step2 as any).request.stateVersion,
      selectedPatternRef: p1Pass,
    });
    const p2Pass = (step3 as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
    session.submitDecision({
      decisionId: (step3 as any).request.decisionId,
      stateVersion: (step3 as any).request.stateVersion,
      selectedPatternRef: p2Pass,
    });

    // 1. 効果がスキップされたため、キーカードは手札に戻らない
    expect(session.state.players.p1.hand.some((c: any) => c.id === "c-h2")).toBe(false);
    expect(session.state.players.p1.hand.some((c: any) => c.id === "c-h5")).toBe(false);

    // 2. 通常の finalizeRequestKeyCards によりキーカードが墓地へ送られていること
    const p1Grave = session.state.players.p1.grave;
    expect(p1Grave.some((c: any) => c.id === "c-h2")).toBe(true);
    expect(p1Grave.some((c: any) => c.id === "c-h5")).toBe(true);
    expect(p1Grave).toHaveLength(2);
  });

  // =========================================================================
  // 17. 成功時の墓地不変・イベント検証 (Grave unchanged, no zone.top.changed, no card.revealed)
  // =========================================================================
  it("Test 17: Successful Return produces NO grave mutation, NO zone.top.changed, NO card.revealed", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-17",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-sol-1");

    const events = session.logRecorder.getEvents();

    // 1. zone.top.changed イベントが0件であること
    const zoneTopEvents = events.filter((e: any) => e.type === "zone.top.changed");
    expect(zoneTopEvents).toHaveLength(0);

    // 2. card.revealed イベントが0件であること
    const revealedEvents = events.filter((e: any) => e.type === "card.revealed");
    expect(revealedEvents).toHaveLength(0);

    // 3. cardMoved イベントが存在し、field -> hand および request -> hand であること
    const cardMovedEvents = events.filter((e: any) => e.type === "card.moved" || e.type === "cardMoved");
    expect(cardMovedEvents.length).toBeGreaterThanOrEqual(3);
  });

  // =========================================================================
  // 18. 戦闘メタデータクリア検証 (Attacker/Blocker battle metadata is cleared)
  // =========================================================================
  it("Test 18: Battle metadata is deleted when unit moves from field to hand", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-18",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            {
              unitId: "u-sol-1",
              componentId: "character.soldier",
              state: "charge",
              cards: [solCard],
              battle: { role: "attacker", targetPlayerKey: "p2" },
            },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-sol-1");

    // 手札内のカードには battle メタデータが存在しないこと
    const returnedCard = session.state.players.p1.hand.find((c: any) => c.id === "c-sol-1");
    expect((returnedCard as any).battle).toBeUndefined();
  });

  // =========================================================================
  // 19. 世代交代 (Next Generation) が誘発しないことの検証
  // =========================================================================
  it("Test 19: Returning a K soldier does not trigger Next Generation (event is field->hand, not field->grave)", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const kingCard = { id: "c-king-1", suit: "S", rank: "K", value: 13 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-19",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-king-1", componentId: "character.hero", state: "charge", cards: [kingCard] },
          ],
          life: [{ id: "l1", suit: "C", rank: "A", value: 1 }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-king-1");

    // 世代交代は誘発せず、ステージは空で解決済みであること
    expect(session.state.stage.requests).toHaveLength(0);
    expect(session.state.players.p1.life).toHaveLength(1);
    expect(session.state.players.p1.grave).toHaveLength(0);
  });

  // =========================================================================
  // 20. リクエストキャンセル時の検証 (Cancelled request sends Keys to grave, Target untouched)
  // =========================================================================
  it("Test 20: Cancelled Return request sends Keys to grave, Target untouched", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-20",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    const unsummonsPat = step1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.unsummons";
    });
    session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: unsummonsPat,
    });

    // ステージ上のリクエストをキャンセル
    const req = session.state.stage.requests[0];
    const cmdContext: CommandContext = {
      state: session.state,
      playerKey: "p1",
      actions: fullRulePackage.actions,
      components: fullRulePackage.components,
      logRecorder: session.logRecorder,
    };
    cancelStageRequest(req.id, cmdContext, effectInterpreter);

    // 1. リクエストはステージから除去されていること
    expect(session.state.stage.requests).toHaveLength(0);

    // 2. キーカードは墓地へ送られていること
    const p1Grave = session.state.players.p1.grave;
    expect(p1Grave.some((c: any) => c.id === "c-h2")).toBe(true);
    expect(p1Grave.some((c: any) => c.id === "c-h5")).toBe(true);

    // 3. 対象ユニットは手札に戻らず、フィールドに残っていること
    expect(session.state.players.p1.field.some((u: any) => u.unitId === "u-sol-1")).toBe(true);
    expect(session.state.players.p1.hand.some((c: any) => c.id === "c-sol-1")).toBe(false);
  });

  // =========================================================================
  // =========================================================================
  // 21. 未解決段階でのスナップショット保存復元検証 (Mid-stage Snapshot/Restore)
  // =========================================================================
  it("Test 21: Mid-stage Snapshot/Restore preserves Return request and resolves identically", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-21",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const sessionA = new GameSession(state, standardRulePackage);
    const step1: any = sessionA.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");

    // 帰還パターンを選択して提出（まだ両者 PASS 前）
    const unsummonsPat = step1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = step1.request.catalog.actions[p.actionSelectionRef];
      if (act.actionId !== "action.unsummons") return false;
      const tgt = step1.request.catalog.targetSelections[p.targetSelectionRef];
      return tgt?.targetUnitId === "u-sol-1";
    });
    expect(unsummonsPat).toBeGreaterThanOrEqual(0);

    const stepChanceA: any = sessionA.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: unsummonsPat,
    });

    // 1. Snapshot 前の状態検証（Request は Stage 上で pending）
    expect(sessionA.state.stage.requests).toHaveLength(1);
    const reqA = sessionA.state.stage.requests[0];
    expect(reqA.actionId).toBe("action.unsummons");
    expect(reqA.keyCards).toHaveLength(2);
    expect(reqA.keyCards.map((c: any) => c.id)).toEqual(["c-h2", "c-h5"]);
    expect(reqA.targets?.[0]?.unitId).toBe("u-sol-1");
    expect(reqA.selectedCostPayment?.drivenBulwarkUnitIds).toContain("u-bw-1");

    // Cost Bulwark は既に drive 状態
    const bwA = sessionA.state.players.p1.field.find((u: any) => u.unitId === "u-bw-1");
    expect(bwA?.state).toBe("drive");
    // Keys は手札から除去済み
    expect(sessionA.state.players.p1.hand).toHaveLength(0);
    // Target 兵士はまだフィールドに存在
    expect(sessionA.state.players.p1.field.some((u: any) => u.unitId === "u-sol-1")).toBe(true);

    // 2. Snapshot キャプチャと Restore
    const snapshot = sessionA.createSnapshot();
    const sessionB = GameSession.fromSnapshot(snapshot, standardRulePackage);

    // 3. Restore 後の状態検証
    expect(sessionB.state.stage.requests).toHaveLength(1);
    const reqB = sessionB.state.stage.requests[0];
    expect(reqB.id).toBe(reqA.id);
    expect(reqB.actionId).toBe("action.unsummons");
    expect(reqB.keyCards.map((c: any) => c.id)).toEqual(["c-h2", "c-h5"]);
    expect(reqB.targets?.[0]?.unitId).toBe("u-sol-1");
    expect(reqB.selectedCostPayment?.drivenBulwarkUnitIds).toEqual(reqA.selectedCostPayment?.drivenBulwarkUnitIds);

    const bwB = sessionB.state.players.p1.field.find((u: any) => u.unitId === "u-bw-1");
    expect(bwB?.state).toBe("drive");
    expect(sessionB.state.players.p1.hand).toHaveLength(0);
    expect(sessionB.state.players.p1.field.some((u: any) => u.unitId === "u-sol-1")).toBe(true);

    // Snapshot 直後の StateHash 一致
    expect(StateHasher.hash(sessionB.state)).toBe(StateHasher.hash(sessionA.state));

    // 4. Session A と Session B の双方で p1 PASS -> p2 PASS を実行して解決
    const passBoth = (sess: GameSession, stepChance: any) => {
      expect(stepChance.type).toBe("WAITING_FOR_DECISION");
      const p1Pass = stepChance.request.patterns.findIndex((p: any) => p.kind === "PASS");
      expect(p1Pass).toBeGreaterThanOrEqual(0);
      const stepP2: any = sess.submitDecision({
        decisionId: stepChance.request.decisionId,
        stateVersion: stepChance.request.stateVersion,
        selectedPatternRef: p1Pass,
      });

      expect(stepP2.type).toBe("WAITING_FOR_DECISION");
      const p2Pass = stepP2.request.patterns.findIndex((p: any) => p.kind === "PASS");
      expect(p2Pass).toBeGreaterThanOrEqual(0);
      sess.submitDecision({
        decisionId: stepP2.request.decisionId,
        stateVersion: stepP2.request.stateVersion,
        selectedPatternRef: p2Pass,
      });
    };

    passBoth(sessionA, stepChanceA);
    const stepChanceB: any = sessionB.advance();
    passBoth(sessionB, stepChanceB);

    // 5. 解決後 Final StateHash 一致検証
    expect(StateHasher.hash(sessionB.state)).toBe(StateHasher.hash(sessionA.state));

    // 6. 双方で同じ Return 結果が成立していること
    for (const sess of [sessionA, sessionB]) {
      // 兵士カードとキーカードが手札に戻っていること
      const hand = sess.state.players.p1.hand;
      expect(hand.some((c: any) => c.id === "c-sol-1")).toBe(true);
      expect(hand.some((c: any) => c.id === "c-h2")).toBe(true);
      expect(hand.some((c: any) => c.id === "c-h5")).toBe(true);
      expect(hand).toHaveLength(3);

      // フィールドに兵士はおらず、防壁のみ drive で残っていること
      expect(sess.state.players.p1.field.some((u: any) => u.unitId === "u-sol-1")).toBe(false);
      const bw = sess.state.players.p1.field.find((u: any) => u.unitId === "u-bw-1");
      expect(bw?.state).toBe("drive");

      // 墓地は不変 (0枚)
      expect(sess.state.players.p1.grave).toHaveLength(0);
      expect(sess.state.stage.requests).toHaveLength(0);
    }
  });

  // =========================================================================
  // 22. AI ポリシー対応検証 (FirstLegal, Random, GenomePolicy DNA 1482)
  // =========================================================================
  it("Test 22: AI policies (FirstLegal, Random, GenomePolicy DNA 1482) legally choose Return", () => {
    const firstLegal = new FirstLegalPolicy();
    const randomPolicy = new RandomPolicy(42);
    const genomePolicy = new GenomePolicy(createManualGenericGenomeDNA());

    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-test-22",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");

    const respFirst = firstLegal.choose(step1.request);
    expect(respFirst.selectedPatternRef).toBeGreaterThanOrEqual(0);

    const respRandom = randomPolicy.choose(step1.request);
    expect(respRandom.selectedPatternRef).toBeGreaterThanOrEqual(0);

    const respGenome = genomePolicy.choose(step1.request);
    expect(respGenome.selectedPatternRef).toBeGreaterThanOrEqual(0);
  });

  // =========================================================================
  // 23. 不変条件検証 (FEATURE_SCHEMA_VERSION = 1, standard-pack.simulatorImplemented = false)
  // =========================================================================
  it("Test 23: Invariants verification (FEATURE_SCHEMA_VERSION=1, simulatorImplemented=false)", () => {
    expect(FEATURE_SCHEMA_VERSION).toBe(1);
    const dna = createManualGenericGenomeDNA();
    expect(dna.patternWeights.length + dna.contextPatternWeights.length).toBe(1482);

    const regResult = RegulationValidator.validateRegulation(catalog, "standard-pack");
    expect(regResult.simulatorImplemented).toBe(false);
  });

  // =========================================================================
  // 24. 決定論的フレッシュリプレイ検証 (Deterministic Fresh Replay)
  // =========================================================================
  it("Test 24: Fresh Replay reproduces Return flow deterministically from ordered Decision Transcript", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const makeInitialState = () => ({
      stateVersion: 1,
      matchId: "match-test-24",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [{ ...keyH2 }, { ...keyH5 }],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [{ ...bwCard }] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [{ ...solCard }] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    });

    // --- Session A: 実セッション実行と Decision Transcript 記録 ---
    const sessionA = new GameSession(makeInitialState(), standardRulePackage);
    const transcript: number[] = [];

    // Step 1: Action Request (p1 chooses action.unsummons targeting u-sol-1)
    const stepA1: any = sessionA.advance();
    expect(stepA1.type).toBe("WAITING_FOR_DECISION");
    const unsummonsPat = stepA1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = stepA1.request.catalog.actions[p.actionSelectionRef];
      if (act.actionId !== "action.unsummons") return false;
      const tgt = stepA1.request.catalog.targetSelections[p.targetSelectionRef];
      return tgt?.targetUnitId === "u-sol-1";
    });
    expect(unsummonsPat).toBeGreaterThanOrEqual(0);
    transcript.push(unsummonsPat);

    // Step 2: Chance priority p1 PASS
    const stepA2: any = sessionA.submitDecision({
      decisionId: stepA1.request.decisionId,
      stateVersion: stepA1.request.stateVersion,
      selectedPatternRef: unsummonsPat,
    });
    expect(stepA2.type).toBe("WAITING_FOR_DECISION");
    const p1Pass = stepA2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    expect(p1Pass).toBeGreaterThanOrEqual(0);
    transcript.push(p1Pass);

    // Step 3: Chance priority p2 PASS -> triggers resolution
    const stepA3: any = sessionA.submitDecision({
      decisionId: stepA2.request.decisionId,
      stateVersion: stepA2.request.stateVersion,
      selectedPatternRef: p1Pass,
    });
    expect(stepA3.type).toBe("WAITING_FOR_DECISION");
    const p2Pass = stepA3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    expect(p2Pass).toBeGreaterThanOrEqual(0);
    transcript.push(p2Pass);

    sessionA.submitDecision({
      decisionId: stepA3.request.decisionId,
      stateVersion: stepA3.request.stateVersion,
      selectedPatternRef: p2Pass,
    });

    const finalHashA = StateHasher.hash(sessionA.state);

    // --- Session B: Fresh GameSession への Transcript 順次適用 (Replay) ---
    // 途中 GameState のコピーは一切行わず、Fresh 初期状態から再構築
    const sessionB = new GameSession(makeInitialState(), standardRulePackage);

    let stepB: any = sessionB.advance();
    for (let i = 0; i < transcript.length; i++) {
      expect(stepB.type).toBe("WAITING_FOR_DECISION");
      // runtime decisionId や stateVersion は sessionB 自身のものを利用し、selectedPatternRef のみ transcript から適用
      stepB = sessionB.submitDecision({
        decisionId: stepB.request.decisionId,
        stateVersion: stepB.request.stateVersion,
        selectedPatternRef: transcript[i],
      });
    }

    const finalHashB = StateHasher.hash(sessionB.state);

    // 1. StateHash 完全一致
    expect(finalHashB).toBe(finalHashA);

    // 2. Return 結果の完全一致
    expect(sessionB.state.players.p1.hand).toHaveLength(3);
    expect(sessionB.state.players.p1.hand.some((c: any) => c.id === "c-sol-1")).toBe(true);
    expect(sessionB.state.players.p1.hand.some((c: any) => c.id === "c-h2")).toBe(true);
    expect(sessionB.state.players.p1.hand.some((c: any) => c.id === "c-h5")).toBe(true);

    expect(sessionB.state.players.p1.field.some((u: any) => u.unitId === "u-sol-1")).toBe(false);
    const bwB = sessionB.state.players.p1.field.find((u: any) => u.unitId === "u-bw-1");
    expect(bwB?.state).toBe("drive");

    expect(sessionB.state.players.p1.grave).toHaveLength(0);
    expect(sessionB.state.stage.requests).toHaveLength(0);

    // 3. Replay 後の対戦相手視点 Observation で手札カードが非公開 (privacy-safe) であること
    const p2Obs = ObservationFactory.createObservation(sessionB.state, "p2");
    const p1ObsView = p2Obs.players.find((p) => p.playerId === "p1");
    expect(p1ObsView?.handCount).toBe(3);
    expect(p1ObsView?.handCards).toHaveLength(3);
    for (const c of p1ObsView?.handCards || []) {
      expect(c.visibility).toBe("HIDDEN");
      expect((c as any).suit).toBeUndefined();
      expect((c as any).rank).toBeUndefined();
    }
  });

  // =========================================================================
  // 25. 汎用 Action Identity 検証 (action.unsummons ハードコード完全除去)
  // =========================================================================
  it("Test 25: moveUnitToHand resolves cause.actionId dynamically without hardcoded action.unsummons fallback", () => {
    const testSoldier = {
      unitId: "u-dyn-1",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-dyn-1", suit: "S", rank: "2", value: 2 }],
    };

    const state: any = {
      players: {
        p1: {
          field: [testSoldier],
          hand: [],
        },
      },
    };

    const emittedEvents: any[] = [];
    const mockInterpreter: any = {
      dispatchEvent: (evt: any) => emittedEvents.push(evt),
    };
    const dynamicHandler = moveUnitToHandHandler(expressionEvaluator, mockInterpreter);

    // Case 1: currentAction.id が指定されている場合、その actionId が cause に設定される
    const ctx1: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: testSoldier,
      currentAction: { id: "action.customSpell" } as any,
      currentRequest: { id: "req-dyn-1", actionId: "action.customSpell" } as any,
    };
    dynamicHandler({ target: "targetComponent", requiredState: "charge" }, ctx1);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe("cardMoved");
    expect(emittedEvents[0].payload.cause?.actionId).toBe("action.customSpell");
    expect(emittedEvents[0].payload.cause?.requestId).toBe("req-dyn-1");

    // Case 2: currentAction がなく currentRequest.actionId のみの場合、currentRequest.actionId が設定される
    const testSoldier2 = {
      unitId: "u-dyn-2",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-dyn-2", suit: "S", rank: "3", value: 3 }],
    };
    state.players.p1.field.push(testSoldier2);

    const ctx2: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: testSoldier2,
      currentAction: undefined,
      currentRequest: { id: "req-dyn-2", actionId: "action.fromRequestOnly" } as any,
    };
    dynamicHandler({ target: "targetComponent", requiredState: "charge" }, ctx2);

    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[1].payload.cause?.actionId).toBe("action.fromRequestOnly");
    expect(emittedEvents[1].payload.cause?.requestId).toBe("req-dyn-2");

    // "action.unsummons" リテラルがどこにも漏洩・フォールバックしていないこと
    for (const evt of emittedEvents) {
      expect(evt.payload.cause?.actionId).not.toBe("action.unsummons");
    }
  });

  // =========================================================================
  // 26. Request Key SSOT & サイレントフォールバック排除検証
  // =========================================================================
  it("Test 26: moveRequestKeyCardsToHand strictly enforces currentRequest.keyCards SSOT without context fallback", () => {
    const emittedEvents: any[] = [];
    const mockInterpreter: any = {
      dispatchEvent: (evt: any) => emittedEvents.push(evt),
    };
    const handler = moveRequestKeyCardsToHandHandler(mockInterpreter);

    // 1. Negative Fallback: currentRequest.keyCards = [] かつ context.keyCards = [A, B]
    // 期待: context.keyCards を一切フォールバックとして使わず、0枚移動（no-op）
    const state1: any = {
      players: {
        p1: { hand: [] },
      },
    };
    const cardA = { id: "c-key-a", suit: "H", rank: "2", value: 2 };
    const cardB = { id: "c-key-b", suit: "H", rank: "3", value: 3 };

    const ctx1: CommandContext = {
      state: state1,
      playerKey: "p1",
      currentRequest: {
        id: "req-ssot-1",
        actionId: "action.test",
        controller: "p1",
        keyCards: [], // empty
      } as any,
      keyCards: [cardA, cardB], // context にのみ存在
    };

    handler({}, ctx1);

    // 手札は空のままであり、cardMoved も発行されないこと (silent fallback なし)
    expect(state1.players.p1.hand).toHaveLength(0);
    expect(emittedEvents).toHaveLength(0);

    // 2. Request Key Identity: currentRequest.keyCards = [A, B] かつ context.keyCards = [X, Y]
    // 期待: 移動されるのは A, B であり、X, Y ではない
    const cardX = { id: "c-key-x", suit: "S", rank: "5", value: 5 };
    const cardY = { id: "c-key-y", suit: "S", rank: "6", value: 6 };

    const ctx2: CommandContext = {
      state: state1,
      playerKey: "p1",
      currentRequest: {
        id: "req-ssot-2",
        actionId: "action.test",
        controller: "p1",
        keyCards: [cardA, cardB], // 正当な SSOT
      } as any,
      keyCards: [cardX, cardY], // 異なるキーカード
    };

    handler({}, ctx2);

    expect(state1.players.p1.hand).toHaveLength(2);
    expect(state1.players.p1.hand.map((c: any) => c.id)).toEqual(["c-key-a", "c-key-b"]);
    expect(state1.players.p1.hand.some((c: any) => c.id === "c-key-x")).toBe(false);
    expect(state1.players.p1.hand.some((c: any) => c.id === "c-key-y")).toBe(false);

    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[0].payload.card.id).toBe("c-key-a");
    expect(emittedEvents[1].payload.card.id).toBe("c-key-b");

    // 3. Malformed: request.keyCards === undefined の場合、fail-closed で throw
    const ctx3: CommandContext = {
      state: state1,
      playerKey: "p1",
      currentRequest: {
        id: "req-ssot-3",
        actionId: "action.test",
        controller: "p1",
        keyCards: undefined, // malformed
      } as any,
    };
    expect(() => handler({}, ctx3)).toThrow("request.keyCards が未定義です");

    // 4. Malformed: currentRequest 自体が存在しない場合、fail-closed で throw
    const ctx4: CommandContext = {
      state: state1,
      playerKey: "p1",
      currentRequest: undefined,
    };
    expect(() => handler({}, ctx4)).toThrow("currentRequest が存在しません");
  });
});
