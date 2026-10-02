import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { CommandRegistry, CommandContext, cancelStageRequest } from "../../engine/rules/CommandRegistry";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { loadRegulationCatalog, getRegulation, getFormat, getFrame } from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { CostPayment } from "../../domain/decision/DecisionCatalog";
import { evaluateUnitTargetCondition } from "../../engine/rules/targetConditionUtils";
import { TriggerProcessingCoordinator } from "../../engine/rules/TriggerProcessingCoordinator";
import { GraveTopCoordinator } from "../../engine/rules/GraveTopCoordinator";

function makeCostPayment(overrides: Partial<CostPayment> = {}): CostPayment {
  return {
    discardedCardIds: [],
    drivenBulwarkUnitIds: [],
    sacrificedUnitIds: [],
    lifeCount: 0,
    ...overrides,
  };
}

function getGraveCardIds(grave: any[]): string[] {
  return (grave || []).flatMap((item: any) =>
    item.cards ? item.cards.map((c: any) => c.id) : [item.id]
  );
}

describe("BP-SIM-REG-5.0-C-PRO-KILL: Pro Action Kill Implementation & Specification Contract", () => {
  let fullRulePackage: RulePackage;
  let proRulePackage: RulePackage;
  let standardRulePackage: RulePackage;
  const getKillAction = () => fullRulePackage.actions.find((a) => a.id === "action.kill")!;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
    await loadRegulationCatalog();

    const standardFormat = await getFormat("standard");
    const proFormat = await getFormat("pro");
    const packFrame = await getFrame("pack");
    const standardPackReg = await getRegulation("standard-pack");
    const proRarePackReg = await getRegulation("pro-rarePack");

    standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg,
      packFrame
    );

    proRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      proFormat,
      proRarePackReg,
      packFrame
    );
  });

  // =========================================================================
  // 1. Definition Contract & Format Contract (Sections 20, 21, 36)
  // =========================================================================
  describe("1. Action Definition & Format Contract (Sections 20, 21, 36)", () => {
    it("20.1: action.kill matches official specification exactly in fullRulePackage", () => {
      const killAction = fullRulePackage.actions.find((a) => a.id === "action.kill");
      expect(killAction).toBeDefined();
      if (!killAction) return;

      expect(killAction.id).toBe("action.kill");
      expect(killAction.name).toBe("キル");
      expect(killAction.type).toBe("magic");

      // Request
      expect(killAction.request?.trigger).toBe("direct");
      expect(killAction.request?.speed).toBe("normal");
      expect(killAction.request?.timing).toBe("quick");

      // Cost: none (undefined)
      expect(killAction.cost).toBeUndefined();

      // Key: 2 cards, Spade A..10, Hand
      expect(killAction.key).toBeDefined();
      expect(killAction.key?.count).toBe(2);
      expect(killAction.key?.condition?.card?.suit).toBe("spade");
      expect(killAction.key?.condition?.card?.rank).toBe("A..10");
      expect(killAction.key?.condition?.card?.zone).toBe("hand");

      // Targets: 1 unit, soldier, unspecified relation
      expect(killAction.targets).toHaveLength(1);
      const targetDef = killAction.targets![0];
      expect(targetDef.id).toBe("target");
      expect(targetDef.type).toBe("unit");
      expect(targetDef.condition?.characterType).toBe("soldier");
      expect(targetDef.condition?.relation).toBeUndefined();
      expect(targetDef.condition?.owner).toBeUndefined();

      // Text & Effect
      expect(killAction.text?.effect).toBe("対象とした兵士を墓地に移す。");
      expect(killAction.effect).toEqual([
        {
          moveToGraveyard: {
            target: "target",
          },
        },
      ]);
    });

    it("21.1: Format inclusion contract: Pro includes action.kill, Standard excludes it", () => {
      const inPro = proRulePackage.actions.some((a) => a.id === "action.kill");
      expect(inPro).toBe(true);

      const inStandard = standardRulePackage.actions.some((a) => a.id === "action.kill");
      expect(inStandard).toBe(false);
    });

    it("36.1: Pro format retains 31 actions with Quick Summon and other Pro actions intact", async () => {
      const proFormat = await getFormat("pro");
      expect(proFormat.actions).toHaveLength(31);
      expect(proFormat.actions).toContain("action.quickSummonsAce");
      expect(proFormat.actions).toContain("action.kill");
      expect(proFormat.actions).toContain("action.reunion");
      expect(proFormat.actions).toContain("action.truce");
      expect(proFormat.actions).toContain("action.changeTarget");
      expect(proFormat.actions).toContain("action.reverse");
    });
  });

  // =========================================================================
  // 2. Character Component Soldier Taxonomy (Sections 5, 19)
  // =========================================================================
  describe("2. Character Component Soldier Taxonomy (Sections 5, 19)", () => {
    it("19.1: evaluateUnitTargetCondition validates all official Soldier types and rejects Bulwark", () => {
      const killAction = fullRulePackage.actions.find((a) => a.id === "action.kill")!;
      const cond = killAction.targets![0].condition;

      const components = fullRulePackage.components;

      const soldierUnit = { unitId: "u-soldier", componentId: "character.soldier" };
      const heroUnit = { unitId: "u-hero", componentId: "character.hero" };
      const aceUnit = { unitId: "u-ace", componentId: "character.ace" };
      const magicianUnit = { unitId: "u-magician", componentId: "character.magician" };
      const armedSoldierUnit = { unitId: "u-armed", componentId: "character.armedSoldier" };
      const bulwarkUnit = { unitId: "u-bulwark", componentId: "character.bulwark" };

      expect(evaluateUnitTargetCondition(soldierUnit, cond, { components }).isValid).toBe(true);
      expect(evaluateUnitTargetCondition(heroUnit, cond, { components }).isValid).toBe(true);
      expect(evaluateUnitTargetCondition(aceUnit, cond, { components }).isValid).toBe(true);
      expect(evaluateUnitTargetCondition(magicianUnit, cond, { components }).isValid).toBe(true);
      expect(evaluateUnitTargetCondition(armedSoldierUnit, cond, { components }).isValid).toBe(true);

      // Bulwark MUST be rejected
      const bulwarkRes = evaluateUnitTargetCondition(bulwarkUnit, cond, { components });
      expect(bulwarkRes.isValid).toBe(false);
      expect(bulwarkRes.detail).toContain("キャラクタータイプが不適合");
    });
  });

  // =========================================================================
  // 3. LegalPatternGenerator Contracts (Sections 18, 22, 23)
  // =========================================================================
  describe("3. LegalPatternGenerator Contracts (Sections 18, 22, 23)", () => {
    it("22.1 & 18.1: Positive Contract - generates patterns targeting both own Soldier and opponent Soldier, but not Bulwark", () => {
      const spade3 = { id: "p1-s3", suit: "S", rank: "3", value: 3 };
      const spade7 = { id: "p1-s7", suit: "S", rank: "7", value: 7 };

      const p1Soldier = {
        unitId: "p1-soldier-1",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-p1-s", suit: "H", rank: "2", value: 2 }],
      };

      const p2Soldier = {
        unitId: "p2-soldier-1",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-p2-s", suit: "D", rank: "4", value: 4 }],
      };

      const p2Bulwark = {
        unitId: "p2-bulwark-1",
        componentId: "character.bulwark",
        kind: "防壁",
        state: "charge",
        cards: [{ id: "c-p2-bw", suit: "C", rank: "5", value: 5 }],
      };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        turnUsage: { p1: {} },
        players: {
          p1: {
            hand: [spade3, spade7],
            field: [p1Soldier],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            grave: [],
          },
          p2: {
            hand: [],
            field: [p2Soldier, p2Bulwark],
            life: [{ id: "l2", suit: "D", rank: "3", value: 3 }],
            grave: [],
          },
        },
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(
        state,
        "p1",
        proRulePackage
      );

      const killPatterns = decision.patterns.filter((p) => {
        const actionDef = decision.catalog.actions[p.actionSelectionRef!];
        return actionDef?.actionId === "action.kill";
      });

      // Must have patterns targeting p1Soldier and p2Soldier
      expect(killPatterns.length).toBeGreaterThanOrEqual(2);

      const targetedUnitIds = killPatterns.map((p) => {
        const targetSel = decision.catalog.targetSelections[p.targetSelectionRef!];
        return targetSel?.targetUnitId;
      });

      expect(targetedUnitIds).toContain("p1-soldier-1");
      expect(targetedUnitIds).toContain("p2-soldier-1");
      expect(targetedUnitIds).not.toContain("p2-bulwark-1");

      // Verify key cards reference canonical physical spade cards
      const firstPattern = killPatterns[0];
      const keyCardSel = decision.catalog.cardSelections[firstPattern.keyCardSelectionRef!];
      expect(keyCardSel.cardIds).toEqual(expect.arrayContaining(["p1-s3", "p1-s7"]));
    });

    it("23.1: Negative Contract A - only 1 valid Spade -> no Kill pattern", () => {
      const spade3 = { id: "p1-s3", suit: "S", rank: "3", value: 3 };
      const heart5 = { id: "p1-h5", suit: "H", rank: "5", value: 5 };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        turnUsage: { p1: {} },
        players: {
          p1: {
            hand: [spade3, heart5],
            field: [{ unitId: "u-1", componentId: "character.soldier", cards: [] }],
            life: [],
            grave: [],
          },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", proRulePackage);
      const killPatterns = decision.patterns.filter(
        (p) => decision.catalog.actions[p.actionSelectionRef!]?.actionId === "action.kill"
      );
      expect(killPatterns).toHaveLength(0);
    });

    it("23.2: Negative Contract C - Spade 10 + Spade J (rank > 10) -> no Kill pattern", () => {
      const spade10 = { id: "p1-s10", suit: "S", rank: "10", value: 10 };
      const spadeJ = { id: "p1-sj", suit: "S", rank: "J", value: 11 };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        turnUsage: { p1: {} },
        players: {
          p1: {
            hand: [spade10, spadeJ],
            field: [{ unitId: "u-1", componentId: "character.soldier", cards: [] }],
            life: [],
            grave: [],
          },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", proRulePackage);
      const killPatterns = decision.patterns.filter(
        (p) => decision.catalog.actions[p.actionSelectionRef!]?.actionId === "action.kill"
      );
      expect(killPatterns).toHaveLength(0);
    });

    it("23.3: Negative Contract D - 2 valid Spades but no Soldier on field -> no Kill pattern", () => {
      const spade3 = { id: "p1-s3", suit: "S", rank: "3", value: 3 };
      const spade7 = { id: "p1-s7", suit: "S", rank: "7", value: 7 };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        turnUsage: { p1: {} },
        players: {
          p1: {
            hand: [spade3, spade7],
            field: [], // empty field
            life: [],
            grave: [],
          },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", proRulePackage);
      const killPatterns = decision.patterns.filter(
        (p) => decision.catalog.actions[p.actionSelectionRef!]?.actionId === "action.kill"
      );
      expect(killPatterns).toHaveLength(0);
    });

    it("23.4: Negative Contract E - only Bulwark targets on field -> no Kill pattern", () => {
      const spade3 = { id: "p1-s3", suit: "S", rank: "3", value: 3 };
      const spade7 = { id: "p1-s7", suit: "S", rank: "7", value: 7 };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        turnUsage: { p1: {} },
        players: {
          p1: {
            hand: [spade3, spade7],
            field: [{ unitId: "u-bw-1", componentId: "character.bulwark", cards: [] }],
            life: [],
            grave: [],
          },
          p2: {
            hand: [],
            field: [{ unitId: "u-bw-2", componentId: "character.bulwark", cards: [] }],
            life: [],
            grave: [],
          },
        },
      };

      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", proRulePackage);
      const killPatterns = decision.patterns.filter(
        (p) => decision.catalog.actions[p.actionSelectionRef!]?.actionId === "action.kill"
      );
      expect(killPatterns).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. ActionRequestValidator Contracts (Section 24)
  // =========================================================================
  describe("4. ActionRequestValidator Contracts (Section 24)", () => {
    const validator = new ActionRequestValidator();
    let killAction: any;
    beforeEach(() => {
      killAction = getKillAction();
    });

    it("24.1: PASS with 2 canonical Hand Spades A..10 and a legal Soldier target", () => {
      const s3 = { id: "c-s3", suit: "S", rank: "3", value: 3 };
      const s8 = { id: "c-s8", suit: "S", rank: "8", value: 8 };
      const soldier = {
        unitId: "u-target",
        componentId: "character.soldier",
        cards: [],
      };

      const state: any = {
        players: {
          p1: { hand: [s3, s8], field: [soldier] },
          p2: { field: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s3, s8],
        targetComponent: soldier,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      expect(() => validator.validateActionRequest(killAction, context)).not.toThrow();
    });

    it("24.2: FAIL with wrong suit (Spade + Heart)", () => {
      const s3 = { id: "c-s3", suit: "S", rank: "3", value: 3 };
      const h8 = { id: "c-h8", suit: "H", rank: "8", value: 8 };
      const soldier = { unitId: "u-target", componentId: "character.soldier", cards: [] };

      const state: any = {
        players: {
          p1: { hand: [s3, h8], field: [soldier] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s3, h8],
        targetComponent: soldier,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      expect(() => validator.validateActionRequest(killAction, context)).toThrow(ValidationError);
      expect(() => validator.validateActionRequest(killAction, context)).toThrow(
        /キーカードが要求される条件を満たしていません/
      );
    });

    it("24.3: FAIL with rank > 10 (Spade 10 + Spade K)", () => {
      const s10 = { id: "c-s10", suit: "S", rank: "10", value: 10 };
      const sk = { id: "c-sk", suit: "S", rank: "K", value: 13 };
      const soldier = { unitId: "u-target", componentId: "character.soldier", cards: [] };

      const state: any = {
        players: {
          p1: { hand: [s10, sk], field: [soldier] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s10, sk],
        targetComponent: soldier,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      expect(() => validator.validateActionRequest(killAction, context)).toThrow(ValidationError);
      expect(() => validator.validateActionRequest(killAction, context)).toThrow(
        /キーカードが要求される条件を満たしていません/
      );
    });

    it("24.4: FAIL with incorrect card count (1 card or 3 cards)", () => {
      const s3 = { id: "c-s3", suit: "S", rank: "3", value: 3 };
      const s4 = { id: "c-s4", suit: "S", rank: "4", value: 4 };
      const s5 = { id: "c-s5", suit: "S", rank: "5", value: 5 };
      const soldier = { unitId: "u-target", componentId: "character.soldier", cards: [] };

      const state: any = {
        players: {
          p1: { hand: [s3, s4, s5], field: [soldier] },
        },
      };

      // 1 card
      expect(() =>
        validator.validateActionRequest(killAction, {
          state,
          playerKey: "p1",
          keyCards: [s3],
          targetComponent: soldier,
          actions: proRulePackage.actions,
          components: proRulePackage.components,
        })
      ).toThrow(/キーカードの枚数が一致しません/);

      // 3 cards
      expect(() =>
        validator.validateActionRequest(killAction, {
          state,
          playerKey: "p1",
          keyCards: [s3, s4, s5],
          targetComponent: soldier,
          actions: proRulePackage.actions,
          components: proRulePackage.components,
        })
      ).toThrow(/キーカードの枚数が一致しません/);
    });

    it("24.5: FAIL when targeting a Bulwark", () => {
      const s3 = { id: "c-s3", suit: "S", rank: "3", value: 3 };
      const s8 = { id: "c-s8", suit: "S", rank: "8", value: 8 };
      const bulwark = {
        unitId: "u-bw",
        componentId: "character.bulwark",
        cards: [],
      };

      const state: any = {
        players: {
          p1: { hand: [s3, s8], field: [bulwark] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s3, s8],
        targetComponent: bulwark,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      expect(() => validator.validateActionRequest(killAction, context)).toThrow(ValidationError);
      expect(() => validator.validateActionRequest(killAction, context)).toThrow(/キャラクタータイプが不適合/);
    });
  });

  // =========================================================================
  // 5. Normal Resolution & Target Ownership (Sections 25, 26, 27)
  // =========================================================================
  describe("5. Normal Resolution, Target Ownership & Match Log (Sections 25, 26, 27)", () => {
    it("25.1 & 27.1: p1 Kills p2 Soldier -> Soldier moves to p2 Grave, Key Cards move to p1 Grave", () => {
      const killAction = fullRulePackage.actions.find((a) => a.id === "action.kill")!;
      const registry = new CommandRegistry();
      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      const recordedLogs: any[] = [];
      const logRecorder = {
        record: (entry: any) => recordedLogs.push(entry),
      };

      const s3 = { id: "p1-s3", suit: "S", rank: "3", value: 3 };
      const s7 = { id: "p1-s7", suit: "S", rank: "7", value: 7 };

      const p2SoldierCard = { id: "p2-soldier-c", suit: "H", rank: "5", value: 5 };
      const p2Soldier = {
        unitId: "u-p2-soldier",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [p2SoldierCard],
      };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [s3, s7],
            field: [],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            grave: [],
          },
          p2: {
            hand: [],
            field: [p2Soldier],
            life: [{ id: "l2", suit: "D", rank: "3", value: 3 }],
            grave: [],
          },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s3, s7],
        targetComponent: p2Soldier,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
        logRecorder: logRecorder as any,
      };

      // 1. Create request
      const req = registry.createRequest(killAction, context);
      expect(req.status).toBe("pending");
      expect(state.stage.requests).toHaveLength(1);
      expect(state.stage.requests[0]).toBe(req);

      // Section 25 verification: immediately after createRequest
      // Key cards removed from hand and attached to request
      expect(state.players.p1.hand).toHaveLength(0);
      expect(req.keyCards).toHaveLength(2);
      expect(req.keyCards[0]).toBe(s3);
      expect(req.keyCards[1]).toBe(s7);

      // Target Soldier is still on field (effect NOT executed yet)
      expect(state.players.p2.field).toHaveLength(1);
      expect(state.players.p2.grave).toHaveLength(0);

      // 2. Resolve request
      const res = registry.resolveRequest(req, context);
      expect(res.type).toBe("COMPLETED");

      // Target Soldier removed from p2 field and placed in p2 grave (NOT p1 grave!)
      expect(state.players.p2.field).toHaveLength(0);
      expect(getGraveCardIds(state.players.p2.grave)).toContain("p2-soldier-c");
      expect(getGraveCardIds(state.players.p1.grave)).not.toContain("p2-soldier-c");

      // Kill Key Cards finalized in p1 grave
      const p1GraveIds = getGraveCardIds(state.players.p1.grave);
      expect(p1GraveIds).toContain("p1-s3");
      expect(p1GraveIds).toContain("p1-s7");

      // Stage: request removed and moved to history
      expect(state.stage.requests).toHaveLength(0);
      expect(state.stage.history).toContain(req);
      expect(req.status).toBe("resolved");

      // Section 26: Canonical Match Log verification
      const reqCreatedLog = recordedLogs.find((l) => l.type === "request.created");
      expect(reqCreatedLog).toBeDefined();
      expect(reqCreatedLog.actionRef).toBe("action.kill");
      expect(reqCreatedLog.keyCardIds).toEqual(["p1-s3", "p1-s7"]);

      const stagePushedLog = recordedLogs.find((l) => l.type === "stage.pushed");
      expect(stagePushedLog).toBeDefined();

      const stagePoppedLog = recordedLogs.find((l) => l.type === "stage.popped");
      expect(stagePoppedLog).toBeDefined();

      const reqResolvedLog = recordedLogs.find((l) => l.type === "request.resolved");
      expect(reqResolvedLog).toBeDefined();

      // Check cardMoved events
      const targetMovedEvt = emittedEvents.find(
        (e) => e.type === "cardMoved" && e.payload?.toZone === "grave" && e.payload?.fromZone === "field"
      );
      expect(targetMovedEvt).toBeDefined();
      expect(targetMovedEvt.payload.playerKey).toBe("p2"); // owner is p2
      expect(targetMovedEvt.payload.card.id).toBe("p2-soldier-c");
    });

    it("27.2: p1 Kills own Soldier -> Soldier moves to p1 Grave", () => {
      const killAction = fullRulePackage.actions.find((a) => a.id === "action.kill")!;
      const registry = new CommandRegistry();

      const s3 = { id: "p1-s3", suit: "S", rank: "3", value: 3 };
      const s7 = { id: "p1-s7", suit: "S", rank: "7", value: 7 };

      const p1SoldierCard = { id: "p1-soldier-c", suit: "S", rank: "4", value: 4 };
      const p1Soldier = {
        unitId: "u-p1-soldier",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [p1SoldierCard],
      };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [s3, s7],
            field: [p1Soldier],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            grave: [],
          },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s3, s7],
        targetComponent: p1Soldier,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const req = registry.createRequest(killAction, context);
      registry.resolveRequest(req, context);

      // Both own soldier card and key cards are in p1 grave
      expect(state.players.p1.field).toHaveLength(0);
      const p1GraveIds = getGraveCardIds(state.players.p1.grave);
      expect(p1GraveIds).toContain("p1-soldier-c");
      expect(p1GraveIds).toContain("p1-s3");
      expect(p1GraveIds).toContain("p1-s7");
    });
  });

  // =========================================================================
  // 6. Multi-Card Armed Soldier Test (Section 14, 28)
  // =========================================================================
  describe("6. Multi-Card Armed Soldier Test (Sections 14, 28)", () => {
    it("28.1: Killing an Armed Soldier with multiple cards moves all cards to Grave and emits cardMoved for each", () => {
      const killAction = fullRulePackage.actions.find((a) => a.id === "action.kill")!;
      const registry = new CommandRegistry();
      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      const s1 = { id: "p1-s1", suit: "S", rank: "A", value: 1 };
      const s2 = { id: "p1-s2", suit: "S", rank: "2", value: 2 };

      const baseCard = { id: "c-base", suit: "H", rank: "5", value: 5 };
      const mountCard = { id: "c-mount", suit: "H", rank: "6", value: 6 };
      const armedSoldier = {
        unitId: "u-armed-1",
        componentId: "character.armedSoldier",
        kind: "重装兵",
        state: "charge",
        cards: [baseCard, mountCard],
      };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [s1, s2],
            field: [],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            grave: [],
          },
          p2: {
            hand: [],
            field: [armedSoldier],
            life: [{ id: "l2", suit: "D", rank: "3", value: 3 }],
            grave: [],
          },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s1, s2],
        targetComponent: armedSoldier,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const req = registry.createRequest(killAction, context);
      registry.resolveRequest(req, context);

      // Armed Soldier removed from field
      expect(state.players.p2.field).toHaveLength(0);

      // Both cards are in p2's grave
      const p2GraveIds = getGraveCardIds(state.players.p2.grave);
      expect(p2GraveIds).toContain("c-base");
      expect(p2GraveIds).toContain("c-mount");

      // Verify cardMoved emitted for each constituent card
      const fieldToGraveEvents = emittedEvents.filter(
        (e) => e.type === "cardMoved" && e.payload?.toZone === "grave" && e.payload?.fromZone === "field"
      );
      expect(fieldToGraveEvents).toHaveLength(2);
      expect(fieldToGraveEvents.map((e) => e.payload.card.id)).toEqual(
        expect.arrayContaining(["c-base", "c-mount"])
      );
      expect(fieldToGraveEvents.every((e) => e.payload.playerKey === "p2")).toBe(true);
    });
  });

  // =========================================================================
  // 7. Legacy Card / Generation Change Regression (Sections 15, 29)
  // =========================================================================
  describe("7. Legacy Card / Generation Change Generic Pipeline (Sections 15, 29)", () => {
    it("29.1: Killing a Soldier containing a Legacy Card triggers nextGeneration via generic pipeline", () => {
      const killAction = fullRulePackage.actions.find((a) => a.id === "action.kill")!;
      const registry = new CommandRegistry();

      const s1 = { id: "p1-s1", suit: "S", rank: "A", value: 1 };
      const s2 = { id: "p1-s2", suit: "S", rank: "2", value: 2 };

      // Soldier with a Legacy card (Jack of Hearts)
      const legacyJack = { id: "c-legacy-j", suit: "H", rank: "J", value: 11 };
      const soldierWithLegacy = {
        unitId: "u-legacy-soldier",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [legacyJack],
      };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        requestBuffer: { requests: [], history: [] },
        players: {
          p1: {
            hand: [s1, s2],
            field: [],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            grave: [],
          },
          p2: {
            hand: [],
            field: [soldierWithLegacy],
            life: [
              { id: "p2-l1", suit: "D", rank: "3", value: 3 },
              { id: "p2-l2", suit: "S", rank: "K", value: 13 }, // Legacy card drawn into hand
            ],
            grave: [],
          },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s1, s2],
        targetComponent: soldierWithLegacy,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      const req = registry.createRequest(killAction, context);
      registry.resolveRequest(req, context);

      // Soldier was moved to grave
      expect(state.players.p2.field).toHaveLength(0);
      expect(getGraveCardIds(state.players.p2.grave)).toContain("c-legacy-j");

      // Trigger buffer received action.nextGeneration
      expect(state.requestBuffer?.requests?.length).toBeGreaterThan(0);
      const nextGenTrigger = state.requestBuffer.requests.find(
        (trg: any) => trg.actionId === "action.nextGeneration"
      );
      expect(nextGenTrigger).toBeDefined();
      expect(nextGenTrigger.controller).toBe("p2"); // p2 is owner of the killed legacy unit
    });
  });

  // =========================================================================
  // 8. Invalid Target at Resolution Contract (Sections 16, 30)
  // =========================================================================
  describe("8. Invalid Target at Resolution (Sections 16, 30)", () => {
    it("30.1: When target Soldier is removed before resolution, Kill effect is safely skipped and key cards finalize normally", () => {
      const killAction = fullRulePackage.actions.find((a) => a.id === "action.kill")!;
      const registry = new CommandRegistry();

      const s3 = { id: "p1-s3", suit: "S", rank: "3", value: 3 };
      const s7 = { id: "p1-s7", suit: "S", rank: "7", value: 7 };

      const otherSoldier = {
        unitId: "u-survivor",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-other", suit: "C", rank: "4", value: 4 }],
      };

      const targetSoldier = {
        unitId: "u-doomed",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-doomed", suit: "H", rank: "5", value: 5 }],
      };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [s3, s7],
            field: [],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            grave: [],
          },
          p2: {
            hand: [],
            field: [targetSoldier, otherSoldier],
            life: [{ id: "l2", suit: "D", rank: "3", value: 3 }],
            grave: [],
          },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s3, s7],
        targetComponent: targetSoldier,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      // 1. Create request normally
      const req = registry.createRequest(killAction, context);
      expect(state.stage.requests).toHaveLength(1);

      // 2. Intervening event: targetSoldier leaves field before Kill resolves (e.g. sacrificed or returned)
      state.players.p2.field = [otherSoldier];

      // 3. Resolve request
      const res = registry.resolveRequest(req, context);
      expect(res.type).toBe("COMPLETED");

      // Survivor soldier is untouched
      expect(state.players.p2.field).toHaveLength(1);
      expect(state.players.p2.field[0].unitId).toBe("u-survivor");

      // Doomed card was NOT added to grave (no duplicate movement)
      expect(state.players.p2.grave).toEqual([]);

      // Kill key cards finalized to p1 grave normally
      const p1GraveIds = state.players.p1.grave.map((c: any) => c.id);
      expect(p1GraveIds).toContain("p1-s3");
      expect(p1GraveIds).toContain("p1-s7");

      // Stage is clean
      expect(state.stage.requests).toHaveLength(0);
      expect(req.status).toBe("resolved");
    });
  });

  // =========================================================================
  // 9. Cancellation Regression (Sections 17, 31)
  // =========================================================================
  describe("9. Cancellation Regression (Sections 17, 31)", () => {
    it("31.1: Cancelling Kill via cancelStageRequest leaves Soldier on field and moves Kill key cards to Grave", () => {
      const killAction = fullRulePackage.actions.find((a) => a.id === "action.kill")!;
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const s3 = { id: "p1-s3", suit: "S", rank: "3", value: 3 };
      const s7 = { id: "p1-s7", suit: "S", rank: "7", value: 7 };

      const p2Soldier = {
        unitId: "u-target-soldier",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        cards: [{ id: "c-p2", suit: "H", rank: "5", value: 5 }],
      };

      const state: any = {
        stateVersion: 1,
        nextRequestSeq: 0,
        turnUsage: {},
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [s3, s7],
            field: [],
            life: [{ id: "l1", suit: "C", rank: "2", value: 2 }],
            grave: [],
          },
          p2: {
            hand: [],
            field: [p2Soldier],
            life: [{ id: "l2", suit: "D", rank: "3", value: 3 }],
            grave: [],
          },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [s3, s7],
        targetComponent: p2Soldier,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      // 1. Create request on stage
      const req = registry.createRequest(killAction, context);
      expect(state.stage.requests).toHaveLength(1);

      // 2. Cancel request via cancelStageRequest
      const cancelled = cancelStageRequest(req.id, context, interp);
      expect(cancelled.status).toBe("cancelled");
      expect(state.stage.requests).toHaveLength(0);

      // Soldier remains untouched on p2 field
      expect(state.players.p2.field).toHaveLength(1);
      expect(state.players.p2.field[0].unitId).toBe("u-target-soldier");
      expect(state.players.p2.grave).toHaveLength(0);

      // Kill Key Cards moved to p1 grave
      const p1GraveIds = state.players.p1.grave.map((c: any) => c.id);
      expect(p1GraveIds).toContain("p1-s3");
      expect(p1GraveIds).toContain("p1-s7");
    });
  });

  // =========================================================================
  // 10. Canonical Physical Identity Regression (Section 32)
  // =========================================================================
  describe("10. Canonical Physical Identity Regression (Section 32)", () => {
    const validator = new ActionRequestValidator();
    let killAction: any;
    beforeEach(() => {
      killAction = getKillAction();
    });

    it("32.1: State cards ♠5 + ♠8 are authoritative even if caller passes spoofed rank K for ♠5", () => {
      const canonicalS5 = { id: "p1-s5", suit: "S", rank: "5", value: 5 };
      const canonicalS8 = { id: "p1-s8", suit: "S", rank: "8", value: 8 };

      const soldier = {
        unitId: "u-soldier",
        componentId: "character.soldier",
        cards: [],
      };

      const state: any = {
        players: {
          p1: { hand: [canonicalS5, canonicalS8], field: [soldier] },
        },
      };

      // Caller attempts to spoof p1-s5 as King of Hearts
      const forgedS5 = { id: "p1-s5", suit: "H", rank: "K", value: 13 };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [forgedS5, canonicalS8],
        targetComponent: soldier,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      // PASS because State card is canonical S5 (which is Spade A..10)
      expect(() => validator.validateActionRequest(killAction, context)).not.toThrow();

      // createRequest holds the canonical card
      const registry = new CommandRegistry();
      const req = registry.createRequest(killAction, context);
      expect(req.keyCards[0]).toBe(canonicalS5);
      expect(req.keyCards[0].suit).toBe("S");
      expect(req.keyCards[0].rank).toBe("5");
    });

    it("32.2: State card ♠K is authoritative and fails even if caller passes spoofed ♠5 for same ID", () => {
      const canonicalSK = { id: "p1-sk", suit: "S", rank: "K", value: 13 };
      const canonicalS8 = { id: "p1-s8", suit: "S", rank: "8", value: 8 };

      const soldier = {
        unitId: "u-soldier",
        componentId: "character.soldier",
        cards: [],
      };

      const state: any = {
        players: {
          p1: { hand: [canonicalSK, canonicalS8], field: [soldier] },
        },
      };

      // Caller attempts to spoof p1-sk as Spade 5
      const forgedS5 = { id: "p1-sk", suit: "S", rank: "5", value: 5 };

      const context: CommandContext = {
        state,
        playerKey: "p1",
        keyCards: [forgedS5, canonicalS8],
        targetComponent: soldier,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      // FAIL because State card is King (value 13 > 10)
      expect(() => validator.validateActionRequest(killAction, context)).toThrow(ValidationError);
      expect(() => validator.validateActionRequest(killAction, context)).toThrow(
        /キーカードが要求される条件を満たしていません/
      );
    });
  });
});
