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
import { SeededRandom } from "../../engine/random/RandomSource";
import { BattleRelationPresenter } from "../../ui/game/BattleRelationPresenter";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import type { ActionDefinition, ComponentDefinition, RulePackage } from "../../domain/rules/RulePackage";
import { deployTopCardsAsUnitsHandler, buildFieldUnitFromComponent } from "../../engine/rules/commandHandlers";

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

    // component
    expect((action as any).component).toBe("character.bulwark");
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

    expect(() => handler({ count: -1 }, dummyContext)).toThrow(/0以上の整数/);
    expect(() => handler({ count: NaN }, dummyContext)).toThrow(/0以上の整数/);
    expect(() => handler({ count: 1.5 }, dummyContext)).toThrow(/0以上の整数/);
    expect(() => handler({ count: Infinity }, dummyContext)).toThrow(/0以上の整数/);
  });

  it("Test 16: deployTopCardsAsUnits count 0 is legitimate no-op", () => {
    const dummyContext: CommandContext = {
      state: { stateVersion: 1, players: { p1: { life: [{ id: "c1" }], field: [] } } },
      playerKey: "p1",
      components: standardRulePackage.components,
    };
    const handler = deployTopCardsAsUnitsHandler(effectInterpreter);

    expect(() => handler({ count: 0 }, dummyContext)).not.toThrow();
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

    expect(() => handler({ player: "unknownPlayer", count: 1 }, dummyContext)).toThrow(/未知の player/);
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
    handler({ count: 2, state: "drive", face: "down" }, dummyContext);

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
    handler({ count: 2 }, ctx);

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
});
