import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import {
  loadRegulationCatalog,
  getRegulation,
  getFormat,
  getFrame,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { CommandRegistry, CommandContext, finalizeRequestKeyCards } from "../../engine/rules/CommandRegistry";
import { ActionRequestValidator } from "../../engine/rules/ActionRequestValidator";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { PatternExecutor } from "../../engine/decision/PatternExecutor";
import { GameSession } from "../../engine/session/GameSession";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { SeededRandom } from "../../engine/random/RandomSource";
import { BattleRelationPresenter } from "../../ui/game/BattleRelationPresenter";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import type { ActionDefinition, ComponentDefinition, RulePackage } from "../../domain/rules/RulePackage";
import { deployTopCardsAsUnitsHandler, buildFieldUnitFromComponent } from "../../engine/rules/commandHandlers";
import { createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { validateOptionSelectionDefinition } from "../../engine/rules/OptionSelectionValidator";
import { StateHasher } from "../../engine/simulation/StateHasher";

describe("Official Regulation Phase 3.0-C - Add Bulwark & Partial Effect Resolution Tests", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let standardFormat: any;
  let standardPackReg: any;
  let standardRulePackage: RulePackage;
  let lightFormat: any;
  let lightPackReg: any;
  let lightRulePackage: RulePackage;

  let validator: ActionRequestValidator;
  let abilityEvaluator: AbilityEvaluator;
  let expressionEvaluator: ExpressionEvaluator;
  let effectInterpreter: EffectInterpreter;
  let registry: CommandRegistry;

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
    lightPackReg = await getRegulation("light-pack");
    lightRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      lightFormat,
      lightPackReg
    );

    abilityEvaluator = new AbilityEvaluator();
    expressionEvaluator = new ExpressionEvaluator();
    validator = new ActionRequestValidator();
    registry = new CommandRegistry();
    effectInterpreter = (registry as any).effectInterpreter;
  });

  // =========================================================================
  // 1. メタデータおよび定義の整合性テスト
  // =========================================================================
  it("Test 1: action.addBulwark exact metadata in examples/add-bulwark.yaml", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.addBulwark");
    expect(action).toBeDefined();
    expect(action!.id).toBe("action.addBulwark");
    expect(action!.name).toBe("防壁補充");
    expect(action!.ruby).toBe("ぼうへきほじゅう");
    expect(action!.type).toBe("magic");

    // request properties
    expect(action!.request?.trigger).toBe("direct");
    expect(action!.request?.speed).toBe("normal");
    expect(action!.request?.timing).toBe("main");

    // cost & targets are undefined or empty (no cost, no target)
    expect(action!.cost).toBeUndefined();
    expect(action!.targets).toBeUndefined();

    // key definition: 2 cards (heart A..K + club A..K)
    expect(action!.key).toBeDefined();
    expect(action!.key?.count).toBe(2);
    expect(action!.key?.conditions).toHaveLength(2);
    expect(action!.key?.conditions?.[0]?.card?.suit).toBe("heart");
    expect(action!.key?.conditions?.[0]?.card?.rank).toBe("A..K");
    expect(action!.key?.conditions?.[1]?.card?.suit).toBe("club");
    expect(action!.key?.conditions?.[1]?.card?.rank).toBe("A..K");

    // Action top-level component is not defined (removed in R1; specified in effect DSL instead)
    expect((action as any).component).toBeUndefined();
  });

  it("Test 2: Node Loader & Browser Loader load action.addBulwark consistently (Action count 24)", () => {
    const browserPackage = loadRulePackageForBrowser();
    expect(browserPackage.actions.length).toBe(24);
    expect(fullRulePackage.actions.length).toBe(24);

    const nodeAction = fullRulePackage.actions.find((a) => a.id === "action.addBulwark");
    const browserAction = browserPackage.actions.find((a) => a.id === "action.addBulwark");
    expect(nodeAction).toBeDefined();
    expect(browserAction).toBeDefined();
    expect(browserAction!.name).toBe(nodeAction!.name);
  });

  it("Test 3: standard format includes action.addBulwark, light format excludes it", () => {
    const stdAction = standardRulePackage.actions.find((a) => a.id === "action.addBulwark");
    expect(stdAction).toBeDefined();

    const lightAction = lightRulePackage.actions.find((a) => a.id === "action.addBulwark");
    expect(lightAction).toBeUndefined();
  });

  it("Test 4: standard-pack regulation remains simulatorImplemented = false in Phase 3.0-C", () => {
    const validation = RegulationValidator.validateRegulation(catalog, "standard-pack");
    expect(validation.ruleLegal).toBe(true);
    expect(validation.simulatorImplemented).toBe(false);
  });

  // =========================================================================
  // 2. パターン生成・発動条件テスト
  // =========================================================================
  it("Test 5: generates legal pattern when hand contains Heart + Club key cards", () => {
    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [
            { id: "h-5", suit: "H", rank: "5", value: 5 },
            { id: "c-7", suit: "C", rank: "7", value: 7 },
          ],
          field: [],
          life: [{ id: "l1" }, { id: "l2" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l3" }], grave: [] },
      },
    };

    const res = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const addBulwarkPatterns = res.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        res.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );

    expect(addBulwarkPatterns.length).toBe(1);
    const pat = addBulwarkPatterns[0];

    // Key cards in pattern reference both h-5 and c-7
    const keyCardSel = res.request.catalog.cardSelections[pat.keyCardSelectionRef!];
    expect(keyCardSel.cardIds).toEqual(expect.arrayContaining(["h-5", "c-7"]));

    // Cost payment has 0 life, 0 discarded, 0 driven
    const costSel = res.request.catalog.costPayments[pat.costPaymentRef!];
    expect(costSel.lifeCount).toBe(0);
    expect(costSel.discardedCardIds).toEqual([]);
    expect(costSel.drivenBulwarkUnitIds).toEqual([]);

    // Target is none
    const targetSel = res.request.catalog.targetSelections[pat.targetSelectionRef!];
    expect(targetSel.targetType).toBe("none");
  });

  it("Test 6: does NOT generate pattern when hand lacks Heart card", () => {
    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [
            { id: "s-5", suit: "S", rank: "5", value: 5 },
            { id: "c-7", suit: "C", rank: "7", value: 7 },
          ],
          field: [],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const res = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const addBulwarkPatterns = res.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        res.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    expect(addBulwarkPatterns).toHaveLength(0);
  });

  it("Test 7: does NOT generate pattern when hand lacks Club card", () => {
    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [
            { id: "h-5", suit: "H", rank: "5", value: 5 },
            { id: "d-7", suit: "D", rank: "7", value: 7 },
          ],
          field: [],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const res = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const addBulwarkPatterns = res.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        res.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    expect(addBulwarkPatterns).toHaveLength(0);
  });

  it("Test 8: multi-key combinations: 2 Hearts and 2 Clubs generate 4 distinct patterns", () => {
    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [
            { id: "h-1", suit: "H", rank: "A", value: 1 },
            { id: "h-2", suit: "H", rank: "2", value: 2 },
            { id: "c-1", suit: "C", rank: "A", value: 1 },
            { id: "c-2", suit: "C", rank: "2", value: 2 },
          ],
          field: [],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [], grave: [] },
      },
    };

    const res = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const addBulwarkPatterns = res.request.patterns.filter(
      (p) =>
        p.kind === "ACTION" &&
        res.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    expect(addBulwarkPatterns).toHaveLength(4);
  });

  it("Test 9: Action legality is independent of Life count (Life 3, Life 1, Life 0 all generate patterns)", () => {
    for (const lifeCount of [3, 1, 0]) {
      const lifeArray = Array.from({ length: lifeCount }, (_, i) => ({ id: `l-${i}` }));
      const state = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [
              { id: "h-A", suit: "H", rank: "A", value: 1 },
              { id: "c-A", suit: "C", rank: "A", value: 1 },
            ],
            field: [],
            life: lifeArray,
            grave: [],
          },
          p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
        },
      };

      const res = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
      const addBulwarkPatterns = res.request.patterns.filter(
        (p) =>
          p.kind === "ACTION" &&
          res.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
      );
      expect(addBulwarkPatterns.length).toBeGreaterThanOrEqual(1);
    }
  });

  // =========================================================================
  // 3. 解決時 Option 選択と DecisionRequest 契約
  // =========================================================================
  it("Test 10: Action request execution halts with EFFECT_RESOLUTION selectOption DecisionRequest", () => {
    const actionDef = standardRulePackage.actions.find((a) => a.id === "action.addBulwark")!;
    const hCard = { id: "h-1", suit: "H", rank: "A", value: 1 };
    const cCard = { id: "c-1", suit: "C", rank: "A", value: 1 };

    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [hCard, cCard],
          field: [],
          life: [{ id: "l-1" }, { id: "l-2" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");

    // action.addBulwark を選択
    const patIdx = step1.request.patterns.findIndex(
      (p: any) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    expect(patIdx).toBeGreaterThanOrEqual(0);

    const step2: any = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: patIdx,
    });

    // NORMAL speed なので stage に積載され、P1がチャンスを維持
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    expect(step2.request.playerId).toBe("p1");

    // P1 PASS
    const p1PassIdx = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3: any = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1PassIdx,
    });

    // P2 のチャンス（P2 PASS）
    expect(step3.type).toBe("WAITING_FOR_DECISION");
    expect(step3.request.playerId).toBe("p2");

    const p2PassIdx = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step4: any = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: p2PassIdx,
    });

    // ステージ解決が開始され、selectOption により EFFECT_RESOLUTION で中断
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    expect(step4.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step4.request.playerId).toBe("p1");

    const decReq = step4.request;
    expect(decReq.catalog.effectSelections).toHaveLength(2);

    // index 0: charge1, index 1: drive2 (YAML canonical order maintained)
    const opt0 = decReq.catalog.effectSelections[0];
    const opt1 = decReq.catalog.effectSelections[1];

    expect(opt0.selectionType).toBe("option");
    expect(opt0.selectedValues).toEqual(["charge1"]);
    expect(opt0.summary).toContain("1枚");

    expect(opt1.selectionType).toBe("option");
    expect(opt1.selectedValues).toEqual(["drive2"]);
    expect(opt1.summary).toContain("2枚");

    // Patterns
    expect(decReq.patterns).toHaveLength(2);
    expect(decReq.patterns[0].kind).toBe("EFFECT_SELECTION");
    expect(decReq.patterns[0].effectSelectionRef).toBe(0);
    expect(decReq.patterns[1].kind).toBe("EFFECT_SELECTION");
    expect(decReq.patterns[1].effectSelectionRef).toBe(1);

    // M. Life card identities (ID, suit, rank) are NEVER in DecisionRequest
    const reqStr = JSON.stringify(decReq);
    expect(reqStr).not.toContain("l-1");
    expect(reqStr).not.toContain("l-2");
  });

  // =========================================================================
  // 4. モード1 (charge1) 解決テスト
  // =========================================================================
  it("Test 11: Mode 1 (charge1) with Life >= 1 takes 1 card from Life TOP -> 1 charge bulwark, moves key cards to grave", () => {
    const actionDef = standardRulePackage.actions.find((a) => a.id === "action.addBulwark")!;
    const hCard = { id: "h-K", suit: "H", rank: "K", value: 13 };
    const cCard = { id: "c-K", suit: "C", rank: "K", value: 13 };
    const topLife = { id: "life-card-top", suit: "S", rank: "9", value: 9 };
    const remainingLife = { id: "life-card-second", suit: "D", rank: "4", value: 4 };

    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [hCard, cCard],
          field: [],
          life: [topLife, remainingLife],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const s1: any = session.advance();
    const patIdx = s1.request.patterns.findIndex(
      (p: any) => p.kind === "ACTION" && s1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    const s2: any = session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: patIdx });
    // P1 PASS
    const p1Pass = s2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const s3: any = session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: p1Pass });
    // P2 PASS
    const p2Pass = s3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const s4: any = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: p2Pass });

    // s4 is EFFECT_RESOLUTION. Submit pattern 0 (charge1)
    expect(s4.request.source.type).toBe("EFFECT_RESOLUTION");
    session.submitDecision({
      decisionId: s4.request.decisionId,
      stateVersion: s4.request.stateVersion,
      selectedPatternRef: 0, // charge1
    });

    const finalState = session.state;
    const p1 = finalState.players.p1;

    // 1 Bulwark placed on field
    expect(p1.field).toHaveLength(1);
    const bw = p1.field[0];
    expect(bw.componentId).toBe("character.bulwark");
    expect(bw.kind).toBe("防壁");
    expect(bw.state).toBe("charge");
    expect(bw.face).toBe("down");
    expect(bw.cards).toHaveLength(1);
    expect(bw.cards[0].id).toBe(topLife.id);

    // Life decreased from 2 to 1 (remaining is second life card)
    expect(p1.life).toHaveLength(1);
    expect(p1.life[0].id).toBe(remainingLife.id);

    // Key cards moved to grave via finalizeRequestKeyCards
    const graveIds = p1.grave.map((c: any) => c.id);
    expect(graveIds).toContain(hCard.id);
    expect(graveIds).toContain(cCard.id);
  });

  // =========================================================================
  // 5. モード2 (drive2) & 部分解決 (Rule 5.4.4) テスト
  // =========================================================================
  it("Test 12: Mode 2 (drive2) with Life >= 2 takes 2 cards from Life TOP -> 2 separate drive bulwarks (A then B)", () => {
    const hCard = { id: "h-Q", suit: "H", rank: "Q", value: 12 };
    const cCard = { id: "c-Q", suit: "C", rank: "Q", value: 12 };
    const lifeA = { id: "life-A", suit: "S", rank: "10", value: 10 };
    const lifeB = { id: "life-B", suit: "H", rank: "3", value: 3 };
    const lifeC = { id: "life-C", suit: "D", rank: "2", value: 2 };

    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [hCard, cCard],
          field: [],
          life: [lifeA, lifeB, lifeC],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const s1: any = session.advance();
    const patIdx = s1.request.patterns.findIndex(
      (p: any) => p.kind === "ACTION" && s1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    const s2: any = session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: patIdx });
    const p1Pass = s2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const s3: any = session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: p1Pass });
    const p2Pass = s3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const s4: any = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: p2Pass });

    // Submit pattern 1 (drive2)
    expect(s4.request.source.type).toBe("EFFECT_RESOLUTION");
    session.submitDecision({
      decisionId: s4.request.decisionId,
      stateVersion: s4.request.stateVersion,
      selectedPatternRef: 1, // drive2
    });

    const p1 = session.state.players.p1;

    // 2 separate Bulwarks placed (Unit 1 has cards: [lifeA], Unit 2 has cards: [lifeB]; NOT 1 unit with 2 cards)
    expect(p1.field).toHaveLength(2);
    const bw1 = p1.field[0];
    const bw2 = p1.field[1];

    expect(bw1.componentId).toBe("character.bulwark");
    expect(bw1.state).toBe("drive");
    expect(bw1.face).toBe("down");
    expect(bw1.cards).toHaveLength(1);
    expect(bw1.cards[0].id).toBe(lifeA.id);

    expect(bw2.componentId).toBe("character.bulwark");
    expect(bw2.state).toBe("drive");
    expect(bw2.face).toBe("down");
    expect(bw2.cards).toHaveLength(1);
    expect(bw2.cards[0].id).toBe(lifeB.id);

    // Life decreased by 2 (only lifeC remains)
    expect(p1.life).toHaveLength(1);
    expect(p1.life[0].id).toBe(lifeC.id);

    // Key cards moved to grave
    const graveIds = p1.grave.map((c: any) => c.id);
    expect(graveIds).toContain(hCard.id);
    expect(graveIds).toContain(cCard.id);
  });

  it("Test 13: Rule 5.4.4 Partial Resolution: Mode 2 (drive2) with Life == 1 places exactly 1 drive bulwark, does NOT fail to 0", () => {
    const hCard = { id: "h-J", suit: "H", rank: "J", value: 11 };
    const cCard = { id: "c-J", suit: "C", rank: "J", value: 11 };
    const singleLife = { id: "life-sole", suit: "C", rank: "5", value: 5 };

    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [hCard, cCard],
          field: [],
          life: [singleLife],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const s1: any = session.advance();
    const patIdx = s1.request.patterns.findIndex(
      (p: any) => p.kind === "ACTION" && s1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    const s2: any = session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: patIdx });
    const p1Pass = s2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const s3: any = session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: p1Pass });
    const p2Pass = s3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const s4: any = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: p2Pass });

    // Submit pattern 1 (drive2) even though Life is only 1
    expect(s4.request.source.type).toBe("EFFECT_RESOLUTION");
    session.submitDecision({
      decisionId: s4.request.decisionId,
      stateVersion: s4.request.stateVersion,
      selectedPatternRef: 1, // drive2
    });

    const p1 = session.state.players.p1;

    // Partial resolution: 1 Bulwark placed, NOT 0!
    expect(p1.field).toHaveLength(1);
    const bw = p1.field[0];
    expect(bw.state).toBe("drive");
    expect(bw.face).toBe("down");
    expect(bw.cards[0].id).toBe(singleLife.id);

    // Life is now 0
    expect(p1.life).toHaveLength(0);

    // Key cards safely in grave
    const graveIds = p1.grave.map((c: any) => c.id);
    expect(graveIds).toContain(hCard.id);
    expect(graveIds).toContain(cCard.id);
  });

  // =========================================================================
  // 6. プリミティブ直接テスト & Life 0 テスト
  // =========================================================================
  it("Test 14: deployTopCardsAsUnits primitive directly handles Life 0 as legitimate no-op without throwing", () => {
    const dummyContext: CommandContext = {
      state: {
        stateVersion: 1,
        turnCount: 1,
        players: {
          p1: { life: [], field: [], grave: [] },
        },
      },
      playerKey: "p1",
      components: standardRulePackage.components,
    };

    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);

    // count 2 on 0 life -> no-op, no throw
    expect(() => {
      handler({ sourceZone: "life", player: "self", count: 2, component: "character.bulwark", face: "down", state: "drive" }, dummyContext);
    }).not.toThrow();

    expect(dummyContext.state.players.p1.field).toHaveLength(0);
    expect(dummyContext.state.players.p1.life).toHaveLength(0);
  });

  it("Test 15: deployTopCardsAsUnits count validation throws on invalid count (negative, NaN, fraction)", () => {
    const dummyContext: CommandContext = {
      state: { stateVersion: 1, players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);

    expect(() => handler({ sourceZone: "life", player: "self", count: -1, component: "character.bulwark", face: "down", state: "charge" }, dummyContext)).toThrow(/0以上の整数/);
    expect(() => handler({ sourceZone: "life", player: "self", count: NaN, component: "character.bulwark", face: "down", state: "charge" }, dummyContext)).toThrow(/0以上の整数/);
    expect(() => handler({ sourceZone: "life", player: "self", count: 1.5, component: "character.bulwark", face: "down", state: "charge" }, dummyContext)).toThrow(/0以上の整数/);
    expect(() => handler({ sourceZone: "life", player: "self", count: Infinity, component: "character.bulwark", face: "down", state: "charge" }, dummyContext)).toThrow(/0以上の整数/);
  });

  it("Test 16: deployTopCardsAsUnits count 0 is legitimate no-op", () => {
    const dummyContext: CommandContext = {
      state: { stateVersion: 1, players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);

    expect(() => handler({ sourceZone: "life", player: "self", count: 0, component: "character.bulwark", face: "down", state: "charge" }, dummyContext)).not.toThrow();
    expect(dummyContext.state.players.p1.field).toHaveLength(0);
    expect(dummyContext.state.players.p1.life).toHaveLength(1);
  });

  it("Test 17: deployTopCardsAsUnits sourceZone validation throws on unsupported zone", () => {
    const dummyContext: CommandContext = {
      state: { stateVersion: 1, players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);

    expect(() => handler({ sourceZone: "invalidZone", count: 1 }, dummyContext)).toThrow(/未対応の sourceZone/);
  });

  it("Test 18: deployTopCardsAsUnits player validation throws on unknown player spec", () => {
    const dummyContext: CommandContext = {
      state: { stateVersion: 1, players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);

    expect(() =>
      handler(
        { sourceZone: "life", player: "unknownPlayer", count: 1, component: "character.bulwark", face: "down", state: "charge" },
        dummyContext
      )
    ).toThrow(/未知の player/);
  });

  // =========================================================================
  // 7. 防壁の物理配置順序 (Canonical Bulwark Placement Order)
  // =========================================================================
  it("Test 19: Bulwark canonical placement order: existing preset is ①, card A is ②, card B is ③", () => {
    const presetBulwark = {
      unitId: "bw-p1-preset",
      componentId: "character.bulwark",
      kind: "防壁",
      state: "charge",
      face: "down",
      cards: [{ id: "c-preset", suit: "S", rank: "A" }],
    };

    const cardA = { id: "card-A", suit: "H", rank: "10" };
    const cardB = { id: "card-B", suit: "D", rank: "7" };

    const state = {
      stateVersion: 1,
      turnCount: 1,
      players: {
        p1: {
          field: [presetBulwark],
          life: [cardA, cardB],
        },
      },
    };

    const dummyContext: CommandContext = {
      state,
      playerKey: "p1",
      components: standardRulePackage.components,
    };

    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    handler({ sourceZone: "life", player: "self", count: 2, component: "character.bulwark", state: "drive", face: "down" }, dummyContext);

    const bulwarks = state.players.p1.field;
    expect(bulwarks).toHaveLength(3);

    // Array order: preset, then A, then B
    expect(bulwarks[0].unitId).toBe("bw-p1-preset");
    expect(bulwarks[1].cards[0].id).toBe("card-A");
    expect(bulwarks[2].cards[0].id).toBe("card-B");

    // Presentation mapping
    const obs = ObservationFactory.createObservation(state, "p1");
    const relationMap = BattleRelationPresenter.buildPresentationMap(state, obs);

    expect(relationMap.get(bulwarks[0].unitId)?.bulwarkPosition).toBe("①");
    expect(relationMap.get(bulwarks[1].unitId)?.bulwarkPosition).toBe("②");
    expect(relationMap.get(bulwarks[2].unitId)?.bulwarkPosition).toBe("③");
  });

  it("Test 20: cardMoved events order: card A emitted first, then card B; NO revealCard event", () => {
    const events: any[] = [];
    const localEffectInterpreter = {
      dispatchEvent: (evt: any) => {
        events.push(evt);
      },
    } as any;

    const cardA = { id: "ev-A", suit: "H", rank: "A" };
    const cardB = { id: "ev-B", suit: "C", rank: "2" };

    const state = {
      stateVersion: 1,
      turnCount: 1,
      players: {
        p1: { field: [], life: [cardA, cardB] },
      },
    };

    const ctx: CommandContext = {
      state,
      playerKey: "p1",
      components: standardRulePackage.components,
      currentAction: { id: "action.addBulwark" } as any,
      currentRequest: { id: "req-test-123" } as any,
    };

    const handler = deployTopCardsAsUnitsHandler(localEffectInterpreter);
    handler({ sourceZone: "life", player: "self", count: 2, component: "character.bulwark", state: "charge", face: "down" }, ctx);

    // Exactly 2 cardMoved events
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("cardMoved");
    expect(events[0].payload.card.id).toBe("ev-A");
    expect(events[0].payload.fromZone).toBe("life");
    expect(events[0].payload.toZone).toBe("field");

    expect(events[1].type).toBe("cardMoved");
    expect(events[1].payload.card.id).toBe("ev-B");
    expect(events[1].payload.fromZone).toBe("life");
    expect(events[1].payload.toZone).toBe("field");

    // NO revealCard event emitted
    const revealEvents = events.filter((e) => e.type === "revealCard");
    expect(revealEvents).toHaveLength(0);
  });

  it("Test 21: Bulwark labels SSOT: derived from character.bulwark component definition ([defense])", () => {
    const unit = buildFieldUnitFromComponent({
      componentId: "character.bulwark",
      playerKey: "p1",
      card: { id: "c1" },
      components: standardRulePackage.components,
    });

    expect(unit.kind).toBe("防壁");
    expect(unit.labels).toEqual(["defense"]);
    expect(unit.labels).not.toEqual(["攻撃", "防御"]);
  });

  // =========================================================================
  // 8. ifSelection 正規化 & fail-closed バリデーション
  // =========================================================================
  it("Test 22: ifSelection executes charge1 branch when context.selections.bulwarkMode === ['charge1']", () => {
    let executedBranch = "";
    const mockInterpreter = new EffectInterpreter(registry, expressionEvaluator, abilityEvaluator);

    const ctx: CommandContext = {
      state: { stateVersion: 1 },
      playerKey: "p1",
      selections: {
        bulwarkMode: ["charge1"],
      },
      currentAction: {
        id: "action.addBulwark",
        effect: [
          {
            selectOption: {
              id: "bulwarkMode",
              options: [{ value: "charge1" }, { value: "drive2" }],
            },
          },
        ],
      } as any,
    };

    // Execute charge1 ifSelection
    const res1 = (mockInterpreter as any).evaluateIfSelection(
      { selection: "bulwarkMode", equals: "charge1" },
      ctx
    );
    expect(res1.shouldExecuteThen).toBe(true);
    expect(res1.shouldExecuteElse).toBe(false);

    // Execute drive2 ifSelection
    const res2 = (mockInterpreter as any).evaluateIfSelection(
      { selection: "bulwarkMode", equals: "drive2" },
      ctx
    );
    expect(res2.shouldExecuteThen).toBe(false);
    expect(res2.shouldExecuteElse).toBe(true);
  });

  it("Test 23: ifSelection executes drive2 branch when context.selections.bulwarkMode === ['drive2']", () => {
    const mockInterpreter = new EffectInterpreter(registry, expressionEvaluator, abilityEvaluator);

    const ctx: CommandContext = {
      state: { stateVersion: 1 },
      playerKey: "p1",
      selections: {
        bulwarkMode: ["drive2"],
      },
      currentAction: {
        id: "action.addBulwark",
        effect: [
          {
            selectOption: {
              id: "bulwarkMode",
              options: [{ value: "charge1" }, { value: "drive2" }],
            },
          },
        ],
      } as any,
    };

    const res1 = (mockInterpreter as any).evaluateIfSelection(
      { selection: "bulwarkMode", equals: "charge1" },
      ctx
    );
    expect(res1.shouldExecuteThen).toBe(false);

    const res2 = (mockInterpreter as any).evaluateIfSelection(
      { selection: "bulwarkMode", equals: "drive2" },
      ctx
    );
    expect(res2.shouldExecuteThen).toBe(true);
  });

  it("Test 24: ifSelection fail-closed: empty array [] throws Error", () => {
    const mockInterpreter = new EffectInterpreter(registry, expressionEvaluator, abilityEvaluator);
    const ctx: CommandContext = {
      state: { stateVersion: 1 },
      playerKey: "p1",
      selections: { bulwarkMode: [] },
      currentAction: {
        id: "action.addBulwark",
        effect: [
          {
            selectOption: {
              id: "bulwarkMode",
              options: [{ value: "charge1" }, { value: "drive2" }],
            },
          },
        ],
      } as any,
    };

    expect(() => {
      (mockInterpreter as any).evaluateIfSelection({ selection: "bulwarkMode", equals: "charge1" }, ctx);
    }).toThrow(/選択肢は1つのみ指定してください/);
  });

  it("Test 25: ifSelection fail-closed: multiple values ['charge1', 'drive2'] throws Error", () => {
    const mockInterpreter = new EffectInterpreter(registry, expressionEvaluator, abilityEvaluator);
    const ctx: CommandContext = {
      state: { stateVersion: 1 },
      playerKey: "p1",
      selections: { bulwarkMode: ["charge1", "drive2"] },
      currentAction: {
        id: "action.addBulwark",
        effect: [
          {
            selectOption: {
              id: "bulwarkMode",
              options: [{ value: "charge1" }, { value: "drive2" }],
            },
          },
        ],
      } as any,
    };

    expect(() => {
      (mockInterpreter as any).evaluateIfSelection({ selection: "bulwarkMode", equals: "charge1" }, ctx);
    }).toThrow(/選択肢は1つのみ指定してください/);
  });

  it("Test 26: ifSelection fail-closed: unknown value ['unknown'] throws Error", () => {
    const mockInterpreter = new EffectInterpreter(registry, expressionEvaluator, abilityEvaluator);
    const ctx: CommandContext = {
      state: { stateVersion: 1 },
      playerKey: "p1",
      selections: { bulwarkMode: ["unknown"] },
      currentAction: {
        id: "action.addBulwark",
        effect: [
          {
            selectOption: {
              id: "bulwarkMode",
              options: [{ value: "charge1" }, { value: "drive2" }],
            },
          },
        ],
      } as any,
    };

    expect(() => {
      (mockInterpreter as any).evaluateIfSelection({ selection: "bulwarkMode", equals: "charge1" }, ctx);
    }).toThrow(/未知の選択値です/);
  });

  it("Test 27: ifSelection fail-closed: undefined selection throws Error", () => {
    const mockInterpreter = new EffectInterpreter(registry, expressionEvaluator, abilityEvaluator);
    const ctx: CommandContext = {
      state: { stateVersion: 1 },
      playerKey: "p1",
      selections: {},
      currentAction: {
        id: "action.addBulwark",
        effect: [
          {
            selectOption: {
              id: "bulwarkMode",
              options: [{ value: "charge1" }, { value: "drive2" }],
            },
          },
        ],
      } as any,
    };

    expect(() => {
      (mockInterpreter as any).evaluateIfSelection({ selection: "bulwarkMode", equals: "charge1" }, ctx);
    }).toThrow(/選択結果が見つかりません/);
  });

  it("Test 28: YAML definition does NOT use else fallback for drive2", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.addBulwark")!;
    const effects = action.effect!;

    const ifSteps: any[] = effects.filter((e: any) => e.ifSelection);
    expect(ifSteps).toHaveLength(2);

    expect(ifSteps[0].ifSelection.equals).toBe("charge1");
    expect(ifSteps[0].ifSelection.else).toBeUndefined();

    expect(ifSteps[1].ifSelection.equals).toBe("drive2");
    expect(ifSteps[1].ifSelection.else).toBeUndefined();
  });

  // =========================================================================
  // 9. AI ポリシー & 決定論 & Replay テスト
  // =========================================================================
  it("Test 29: FirstLegalPolicy resolves EFFECT_RESOLUTION option seamlessly (picks charge1)", () => {
    const hCard = { id: "h-ai", suit: "H", rank: "A", value: 1 };
    const cCard = { id: "c-ai", suit: "C", rank: "A", value: 1 };

    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [hCard, cCard],
          field: [],
          life: [{ id: "l-ai-1" }, { id: "l-ai-2" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const policy = new FirstLegalPolicy(false);

    let step = session.advance();
    let steps = 0;
    while (step.type === "WAITING_FOR_DECISION" && steps < 10) {
        const resp = policy.choose(step.request);
      step = session.submitDecision(resp);
      steps++;
    }

    // Effect resolution completed, bulwark placed
    const p1 = session.state.players.p1;
    expect(p1.field).toHaveLength(1);
    expect(p1.field[0].state).toBe("charge");
  });

  it("Test 30: RandomPolicy with SeededRandom resolves deterministically", () => {
    const runSimulation = (seed: number) => {
      const hCard = { id: "h-rand", suit: "H", rank: "K", value: 13 };
      const cCard = { id: "c-rand", suit: "C", rank: "K", value: 13 };

      const state = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [hCard, cCard],
            field: [],
            life: [{ id: "l-r-1" }, { id: "l-r-2" }, { id: "l-r-3" }],
            grave: [],
          },
          p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
        },
      };

      const session = new GameSession(state, standardRulePackage);
      const policy = new RandomPolicy(new SeededRandom(seed));

      let step = session.advance();
      let steps = 0;
      while (step.type === "WAITING_FOR_DECISION" && steps < 10) {
          const resp = policy.choose(step.request);
        step = session.submitDecision(resp);
        steps++;
      }

      return {
        fieldCount: session.state.players.p1.field.length,
        bulwarkState: session.state.players.p1.field[0]?.state,
      };
    };

    const resA = runSimulation(42);
    const resB = runSimulation(42);
    expect(resA).toEqual(resB);
  });

  // =========================================================================
  // 10. deployTopCardsAsUnits 汎用プリミティブ fail-closed 検証 (Phase 3.0-C-R1)
  // =========================================================================
  it("Test 31: deployTopCardsAsUnits: component missing throws Error", () => {
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    const context: CommandContext = {
      state: { players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    expect(() => {
      handler({ sourceZone: "life", player: "self", count: 1, face: "down", state: "charge" }, context);
    }).toThrow(/component は必須です/);
  });

  it("Test 32: deployTopCardsAsUnits: unknown component throws Error", () => {
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    const context: CommandContext = {
      state: { players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    expect(() => {
      handler({ sourceZone: "life", player: "self", count: 1, component: "character.unknown", face: "down", state: "charge" }, context);
    }).toThrow(/コンポーネントが見つかりません/);
  });

  it("Test 33: deployTopCardsAsUnits: sourceZone missing throws Error", () => {
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    const context: CommandContext = {
      state: { players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    expect(() => {
      handler({ player: "self", count: 1, component: "character.bulwark", face: "down", state: "charge" }, context);
    }).toThrow(/sourceZone は必須です/);
  });

  it("Test 34: deployTopCardsAsUnits: player missing throws Error", () => {
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    const context: CommandContext = {
      state: { players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    expect(() => {
      handler({ sourceZone: "life", count: 1, component: "character.bulwark", face: "down", state: "charge" }, context);
    }).toThrow(/player は必須です/);
  });

  it("Test 35: deployTopCardsAsUnits: face missing throws Error", () => {
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    const context: CommandContext = {
      state: { players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    expect(() => {
      handler({ sourceZone: "life", player: "self", count: 1, component: "character.bulwark", state: "charge" }, context);
    }).toThrow(/face は 'up' または 'down' である必要があります/);
  });

  it("Test 36: deployTopCardsAsUnits: state missing throws Error", () => {
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    const context: CommandContext = {
      state: { players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    expect(() => {
      handler({ sourceZone: "life", player: "self", count: 1, component: "character.bulwark", face: "down" }, context);
    }).toThrow(/state は 'charge' または 'drive' である必要があります/);
  });

  it("Test 37: deployTopCardsAsUnits: life: [] is legitimate no-op", () => {
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    const context: CommandContext = {
      state: { players: { p1: { life: [], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    expect(() => {
      handler({ sourceZone: "life", player: "self", count: 2, component: "character.bulwark", face: "down", state: "drive" }, context);
    }).not.toThrow();
    expect(context.state.players.p1.field).toHaveLength(0);
  });

  it("Test 38: deployTopCardsAsUnits: life missing or malformed throws Error", () => {
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    const context: CommandContext = {
      state: { players: { p1: { life: null as any, field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    expect(() => {
      handler({ sourceZone: "life", player: "self", count: 1, component: "character.bulwark", face: "down", state: "charge" }, context);
    }).toThrow(/ライフ領域が不正です/);
  });

  it("Test 39: deployTopCardsAsUnits: invalid face throws Error", () => {
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    const context: CommandContext = {
      state: { players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    expect(() => {
      handler({ sourceZone: "life", player: "self", count: 1, component: "character.bulwark", face: "sideways", state: "charge" }, context);
    }).toThrow(/face は 'up' または 'down' である必要があります/);
  });

  it("Test 40: deployTopCardsAsUnits: invalid state throws Error", () => {
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);
    const context: CommandContext = {
      state: { players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    expect(() => {
      handler({ sourceZone: "life", player: "self", count: 1, component: "character.bulwark", face: "down", state: "sleeping" }, context);
    }).toThrow(/state は 'charge' または 'drive' である必要があります/);
  });

  // =========================================================================
  // 11. selectOption & ifSelection DSL バリデーション (Phase 3.0-C-R1)
  // =========================================================================
  it("Test 41: selectOption: options missing throws Error", () => {
    expect(() => {
      validateOptionSelectionDefinition({ id: "bulwarkMode" });
    }).toThrow(/options は配列である必要があります/);
  });

  it("Test 42: selectOption: options [] throws Error", () => {
    expect(() => {
      validateOptionSelectionDefinition({ id: "bulwarkMode", options: [] });
    }).toThrow(/1件以上の選択肢が必要です/);
  });

  it("Test 43: selectOption: option value missing throws Error", () => {
    expect(() => {
      validateOptionSelectionDefinition({ id: "bulwarkMode", options: [{ label: "モード1" }] });
    }).toThrow(/value は空でない文字列である必要があります/);
  });

  it("Test 44: selectOption: option value empty throws Error", () => {
    expect(() => {
      validateOptionSelectionDefinition({ id: "bulwarkMode", options: [{ value: "   " }] });
    }).toThrow(/value は空でない文字列である必要があります/);
  });

  it("Test 45: selectOption: duplicate option value throws Error", () => {
    expect(() => {
      validateOptionSelectionDefinition({
        id: "bulwarkMode",
        options: [{ value: "charge1" }, { value: "charge1" }],
      });
    }).toThrow(/重複した value が指定されています/);
  });

  it("Test 46: LegalPatternGenerator: valid charge1 / drive2 generates exactly 2 patterns", () => {
    const state = { stateVersion: 1, players: { p1: {}, p2: {} } };
    const res = LegalPatternGenerator.generateOptionSelectionDecision(
      state,
      "p1",
      { id: "req-test" },
      "selectOption",
      [{ value: "charge1", label: "チャージ1枚" }, { value: "drive2", label: "ドライブ2枚" }]
    );
    expect(res.patterns).toHaveLength(2);
    expect(res.catalog.effectSelections[0].selectedValues).toEqual(["charge1"]);
    expect(res.catalog.effectSelections[1].selectedValues).toEqual(["drive2"]);
  });

  it("Test 47: ifSelection: references unknown selection id throws Error", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.addBulwark")!;
    const ctx: CommandContext = {
      state: {},
      playerKey: "p1",
      currentAction: action,
      selections: { unknownMode: ["charge1"] },
    };
    expect(() => {
      effectInterpreter.evaluateIfSelection({ selection: "unknownMode", equals: "charge1" }, ctx);
    }).toThrow(/対応する有効な selectOption 定義または validValues が見つかりません/);
  });

  it("Test 48: ifSelection: equals unknown value (DSL typo) throws Error", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.addBulwark")!;
    const ctx: CommandContext = {
      state: {},
      playerKey: "p1",
      currentAction: action,
      selections: { bulwarkMode: ["charge1"] },
    };
    expect(() => {
      effectInterpreter.evaluateIfSelection({ selection: "bulwarkMode", equals: "drive3" }, ctx);
    }).toThrow(/equals に指定された値 'drive3' は.*選択肢.*存在しません \(Rule DSL typo\)/);
  });

  it("Test 49: ifSelection: malformed selectedValues [] throws Error", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.addBulwark")!;
    const ctx: CommandContext = {
      state: {},
      playerKey: "p1",
      currentAction: action,
      selections: { bulwarkMode: [] },
    };
    expect(() => {
      effectInterpreter.evaluateIfSelection({ selection: "bulwarkMode", equals: "charge1" }, ctx);
    }).toThrow(/選択肢は1つのみ指定してください/);
  });

  it("Test 50: ifSelection: malformed multi selectedValues throws Error", () => {
    const action = fullRulePackage.actions.find((a) => a.id === "action.addBulwark")!;
    const ctx: CommandContext = {
      state: {},
      playerKey: "p1",
      currentAction: action,
      selections: { bulwarkMode: ["charge1", "drive2"] },
    };
    expect(() => {
      effectInterpreter.evaluateIfSelection({ selection: "bulwarkMode", equals: "charge1" }, ctx);
    }).toThrow(/選択肢は1つのみ指定してください/);
  });

  // =========================================================================
  // 12. Snapshot/Restore, Deterministic Replay & AI (Phase 3.0-C-R1)
  // =========================================================================
  it("Test 51: Option WAITING state createSnapshot and restore via GameSession.fromSnapshot", () => {
    const hCard = { id: "h-snap", suit: "H", rank: "A", value: 1 };
    const cCard = { id: "c-snap", suit: "C", rank: "A", value: 1 };
    const l1 = { id: "l-s1", suit: "S", rank: "2", value: 2 };
    const l2 = { id: "l-s2", suit: "S", rank: "3", value: 3 };

    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: { hand: [hCard, cCard], field: [], life: [l1, l2], grave: [] },
        p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const s1: any = session.advance();
    const patIdx = s1.request.patterns.findIndex(
      (p: any) => p.kind === "ACTION" && s1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    const s2: any = session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: patIdx });
    const s3: any = session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: s2.request.patterns.findIndex((p: any) => p.kind === "PASS") });
    const s4: any = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: s3.request.patterns.findIndex((p: any) => p.kind === "PASS") });

    // s4 is waiting for EFFECT_RESOLUTION option
    expect(s4.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(s4.request.catalog.effectSelections).toHaveLength(2);

    // Create snapshot at option waiting state
    const snapshot = session.createSnapshot();
    expect(snapshot.gameState).toBeDefined();
    expect(snapshot.gameStateHash).toBeDefined();
    expect(snapshot.session.pendingDecision).toBeDefined();
    expect(snapshot.session.pendingDecision.source.type).toBe("EFFECT_RESOLUTION");

    // Restore into fresh session
    const restoredSession = GameSession.fromSnapshot(snapshot, standardRulePackage);
    const restoredStep: any = restoredSession.advance();
    expect(restoredStep.type).toBe("WAITING_FOR_DECISION");
    expect(restoredStep.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(restoredStep.request.catalog.effectSelections).toHaveLength(2);
    expect(restoredStep.request.catalog.effectSelections[0].selectedValues).toEqual(["charge1"]);
    expect(restoredStep.request.catalog.effectSelections[1].selectedValues).toEqual(["drive2"]);
  });

  it("Test 52: Restored session executes drive2 and completes normal resolution", () => {
    const hCard = { id: "h-snap2", suit: "H", rank: "A", value: 1 };
    const cCard = { id: "c-snap2", suit: "C", rank: "A", value: 1 };
    const l1 = { id: "l-s2-1", suit: "S", rank: "2", value: 2 };
    const l2 = { id: "l-s2-2", suit: "S", rank: "3", value: 3 };

    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: { hand: [hCard, cCard], field: [], life: [l1, l2], grave: [] },
        p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const s1: any = session.advance();
    const patIdx = s1.request.patterns.findIndex(
      (p: any) => p.kind === "ACTION" && s1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    const s2: any = session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: patIdx });
    const s3: any = session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: s2.request.patterns.findIndex((p: any) => p.kind === "PASS") });
    session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: s3.request.patterns.findIndex((p: any) => p.kind === "PASS") });

    const snapshot = session.createSnapshot();
    const restoredSession = GameSession.fromSnapshot(snapshot, standardRulePackage);

    const pendingReq: any = restoredSession.pendingDecision!;
    // Submit drive2 (pattern index 1) in restored session
    restoredSession.submitDecision({
      decisionId: pendingReq.decisionId,
      stateVersion: pendingReq.stateVersion,
      selectedPatternRef: 1, // drive2
    });

    // Resolution completes, units deployed properly
    const p1 = restoredSession.state.players.p1;
    expect(p1.field).toHaveLength(2);
    expect(p1.field[0].componentId).toBe("character.bulwark");
    expect(p1.field[0].state).toBe("drive");
    expect(p1.field[0].face).toBe("down");
    expect(p1.field[1].componentId).toBe("character.bulwark");
    expect(p1.field[1].state).toBe("drive");
    expect(p1.field[1].face).toBe("down");
    expect(p1.life).toHaveLength(0);
    expect(p1.grave).toHaveLength(2); // Key cards moved to grave
  });

  it("Test 53: Restored final state matches non-restored final state identically", () => {
    const createState = () => {
      const hCard = { id: "h-match", suit: "H", rank: "A", value: 1 };
      const cCard = { id: "c-match", suit: "C", rank: "A", value: 1 };
      const l1 = { id: "l-m1", suit: "H", rank: "7", value: 7 };
      const l2 = { id: "l-m2", suit: "C", rank: "8", value: 8 };

      return {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: { hand: [hCard, cCard], field: [], life: [l1, l2], grave: [] },
          p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
        },
      };
    };

    const sessionA = new GameSession(createState(), standardRulePackage);
    const s1A: any = sessionA.advance();
    const patIdx = s1A.request.patterns.findIndex(
      (p: any) => p.kind === "ACTION" && s1A.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    const s2A: any = sessionA.submitDecision({ decisionId: s1A.request.decisionId, stateVersion: s1A.request.stateVersion, selectedPatternRef: patIdx });
    const s3A: any = sessionA.submitDecision({ decisionId: s2A.request.decisionId, stateVersion: s2A.request.stateVersion, selectedPatternRef: s2A.request.patterns.findIndex((p: any) => p.kind === "PASS") });
    const s4A: any = sessionA.submitDecision({ decisionId: s3A.request.decisionId, stateVersion: s3A.request.stateVersion, selectedPatternRef: s3A.request.patterns.findIndex((p: any) => p.kind === "PASS") });

    // Snapshot at s4A
    const snapshotA = sessionA.createSnapshot();
    const sessionRestored = GameSession.fromSnapshot(snapshotA, standardRulePackage);

    // Both sessions submit drive2
    sessionA.submitDecision({
      decisionId: s4A.request.decisionId,
      stateVersion: s4A.request.stateVersion,
      selectedPatternRef: 1,
    });

    const resReq: any = sessionRestored.pendingDecision!;
    sessionRestored.submitDecision({
      decisionId: resReq.decisionId,
      stateVersion: resReq.stateVersion,
      selectedPatternRef: 1,
    });

    expect(StateHasher.hash(sessionA.state)).toBe(StateHasher.hash(sessionRestored.state));
    expect(sessionA.state.players.p1.field).toEqual(sessionRestored.state.players.p1.field);
    expect(sessionA.state.players.p1.life).toEqual(sessionRestored.state.players.p1.life);
    expect(sessionA.state.players.p1.grave).toEqual(sessionRestored.state.players.p1.grave);
  });

  it("Test 54: Fresh synthetic Decision Transcript replay reconstructs state deterministically", () => {
    const makeInitialState = () => ({
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: {
          hand: [
            { id: "h-rep", suit: "H", rank: "9", value: 9 },
            { id: "c-rep", suit: "C", rank: "9", value: 9 },
          ],
          field: [{ unitId: "u-bw0", componentId: "character.bulwark", kind: "防壁", state: "charge", face: "down", cards: [{ id: "l-init" }] }],
          life: [
            { id: "l-rep-1", suit: "H", rank: "2", value: 2 },
            { id: "l-rep-2", suit: "C", rank: "3", value: 3 },
            { id: "l-rep-3", suit: "D", rank: "4", value: 4 },
          ],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
      },
    });

    // Session A: Run forward and record transcript
    const sessionA = new GameSession(makeInitialState(), standardRulePackage);
    const transcript: Array<{ playerId: string; selectedPatternRef: number }> = [];

    const s1: any = sessionA.advance();
    const actRef = s1.request.patterns.findIndex(
      (p: any) => p.kind === "ACTION" && s1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    transcript.push({ playerId: "p1", selectedPatternRef: actRef });
    const s2: any = sessionA.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: actRef });

    const pass1 = s2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    transcript.push({ playerId: "p1", selectedPatternRef: pass1 });
    const s3: any = sessionA.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: pass1 });

    const pass2 = s3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    transcript.push({ playerId: "p2", selectedPatternRef: pass2 });
    const s4: any = sessionA.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: pass2 });

    // Option decision: drive2 (pattern 1)
    transcript.push({ playerId: "p1", selectedPatternRef: 1 });
    sessionA.submitDecision({ decisionId: s4.request.decisionId, stateVersion: s4.request.stateVersion, selectedPatternRef: 1 });

    // Session B: Fresh reconstruct by applying transcript
    const sessionB = new GameSession(makeInitialState(), standardRulePackage);
    for (const entry of transcript) {
      let step: any = sessionB.pendingDecision ? { type: "WAITING_FOR_DECISION", request: sessionB.pendingDecision } : sessionB.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      sessionB.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: entry.selectedPatternRef,
      });
    }

    // Compare final states
    expect(StateHasher.hash(sessionA.state)).toBe(StateHasher.hash(sessionB.state));
    expect(sessionA.state.players.p1.field).toEqual(sessionB.state.players.p1.field);
    expect(sessionA.state.players.p1.life).toEqual(sessionB.state.players.p1.life);
    expect(sessionA.state.players.p1.grave).toEqual(sessionB.state.players.p1.grave);
    expect(sessionA.state.players.p1.field).toHaveLength(3); // 1 initial + 2 new
  });

  it("Test 55: ManualGenericGenome selects valid pattern for EFFECT_SELECTION option seamlessly", () => {
    const hCard = { id: "h-ai-m", suit: "H", rank: "Q", value: 12 };
    const cCard = { id: "c-ai-m", suit: "C", rank: "Q", value: 12 };

    const state = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [] },
      players: {
        p1: { hand: [hCard, cCard], field: [], life: [{ id: "l1" }, { id: "l2" }], grave: [] },
        p2: { hand: [], field: [], life: [{ id: "l-opp" }], grave: [] },
      },
    };

    const session = new GameSession(state, standardRulePackage);
    const s1: any = session.advance();
    const patIdx = s1.request.patterns.findIndex(
      (p: any) => p.kind === "ACTION" && s1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.addBulwark"
    );
    const s2: any = session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: patIdx });
    const s3: any = session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: s2.request.patterns.findIndex((p: any) => p.kind === "PASS") });
    const s4: any = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: s3.request.patterns.findIndex((p: any) => p.kind === "PASS") });

    // At s4, Option Decision is waiting
    expect(s4.request.source.type).toBe("EFFECT_RESOLUTION");

    const manualPolicy = new GenomePolicy(createManualGenericGenomeDNA());
    const aiResp = manualPolicy.choose(s4.request);

    expect(aiResp.decisionId).toBe(s4.request.decisionId);
    expect(aiResp.stateVersion).toBe(s4.request.stateVersion);
    expect(aiResp.selectedPatternRef).toBeGreaterThanOrEqual(0);
    expect(aiResp.selectedPatternRef).toBeLessThan(s4.request.patterns.length);

    // Submit AI response into session to verify smooth resolution
    session.submitDecision(aiResp);
    expect(session.state.players.p1.field.length).toBeGreaterThanOrEqual(1);
  });

  it("Test 56: FEATURE_SCHEMA_VERSION remains 1 without new features", () => {
    expect(FEATURE_SCHEMA_VERSION).toBe(1);
  });

  it("Test 57: ManualGenericGenome DNA dimension remains exactly 1482 weights", () => {
    const dna = createManualGenericGenomeDNA();
    expect(dna.patternWeights.length + dna.contextPatternWeights.length).toBe(1482);
  });
});
