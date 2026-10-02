import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { RulePackage, ActionDefinition, ActionRequest } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { ActionTargetService } from "../../engine/rules/ActionTargetService";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { GameSession } from "../../engine/session/GameSession";
import { loadRegulationCatalog, getFormat, getRegulation } from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { TargetSelection, EffectSelection } from "../../domain/decision/DecisionCatalog";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";

describe("BP-SIM-REG-5.0-F-PRO-CHANGE-TARGET: Pro Action Change Target (対象変更) & Generic Target Foundation", () => {
  let rulePackage: RulePackage;
  let proRulePackage: RulePackage;
  let changeTargetAction: ActionDefinition;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    proRulePackage = loadRulePackageForBrowser();
    changeTargetAction = rulePackage.actions.find((a) => a.id === "action.changeTarget")!;
    await loadRegulationCatalog();
  });

  // =========================================================================
  // 1. Official Rule SSOT & Schema Contracts (Sections 13, 50, 51)
  // =========================================================================
  describe("1. Official Rule SSOT & Schema Contracts", () => {
    it("1.1: Change Target definition conforms exactly to v9.1.2 Section 7.3.1.4.10", () => {
      expect(changeTargetAction).toBeDefined();
      expect(changeTargetAction.id).toBe("action.changeTarget");
      expect(changeTargetAction.name).toBe("対象変更");
      expect(changeTargetAction.ruby).toBe("たいしょうへんこう");
      expect(changeTargetAction.type).toBe("magic");

      // Request semantics: direct, normal, quick
      expect(changeTargetAction.request).toEqual({
        trigger: "direct",
        speed: "normal",
        timing: "quick",
      });

      // Cost: NONE
      expect(changeTargetAction.cost).toBeUndefined();

      // Key: 2 x Club A..10 from Hand
      expect(changeTargetAction.key).toEqual({
        id: "keys",
        count: 2,
        condition: {
          card: {
            suit: "club",
            rank: "A..10",
            zone: "hand",
          },
        },
      });

      // Target: request with status: pending and hasTarget: true
      expect(changeTargetAction.targets).toBeDefined();
      expect(changeTargetAction.targets).toHaveLength(1);
      expect(changeTargetAction.targets![0]).toEqual({
        id: "targetRequest",
        type: "request",
        condition: {
          status: "pending",
          hasTarget: true,
        },
      });

      // Effect: selectActionTarget -> replaceRequestTarget
      expect(changeTargetAction.text?.effect).toBe("対象のリクエストの対象を、別の適正な対象に変更する。");
      expect(changeTargetAction.effect).toHaveLength(2);
      const effects = changeTargetAction.effect as any[];
      expect(effects[0].selectActionTarget).toEqual({
        id: "replacementTarget",
        request: "targetRequest",
        decisionPlayer: "self",
      });
      expect(effects[1].replaceRequestTarget).toEqual({
        request: "targetRequest",
        selection: "replacementTarget",
      });
    });

    it("1.2: Format inclusion/exclusion contract (Sections 50, 51)", async () => {
      const lightFormat = await getFormat("light");
      const standardFormat = await getFormat("standard");
      const proFormat = await getFormat("pro");

      expect(lightFormat).toBeDefined();
      expect(lightFormat.actions).not.toContain("action.changeTarget");

      expect(standardFormat).toBeDefined();
      expect(standardFormat.actions).not.toContain("action.changeTarget");

      expect(proFormat).toBeDefined();
      expect(proFormat.actions).toContain("action.changeTarget");
    });

    it("1.3: Total actions count is 36 including action.changeTarget", () => {
      expect(rulePackage.actions).toHaveLength(36);
      expect(rulePackage.actions.map((a) => a.id)).toContain("action.changeTarget");
    });

    it("1.4: pro:rarePack remains unimplemented / unpublished", async () => {
      const catalog = await loadRegulationCatalog();
      const proRarePack = await getRegulation("pro-rarePack");
      expect(proRarePack).toBeDefined();
      expect(proRarePack.formatId).toBe("pro");
      expect(proRarePack.frameId).toBe("rarePack");

      const validation = RegulationValidator.validateRegulation(catalog, "pro-rarePack");
      expect(validation.simulatorImplemented).toBe(false);
    });
  });

  // =========================================================================
  // 2. Key Card Validation (2x Club A..10 from Hand)
  // =========================================================================
  describe("2. Key Card Validation", () => {
    const validator = new ActionRequestValidator();

    const makeBaseContext = (handCards: any[], keyCards: any[]): CommandContext => ({
      state: {
        players: {
          p1: {
            hand: [...handCards],
            field: [],
            grave: [],
            life: [],
          },
          p2: { hand: [], field: [], grave: [], life: [] },
        },
        stage: {
          requests: [
            {
              id: "req-kill",
              actionId: "action.kill",
              controller: "p2",
              status: "pending",
              targets: [{ type: "unit", unitId: "u-1", targetDefinitionId: "target" }],
              keyCards: [],
            },
          ],
        },
        turnPlayer: "p1",
        chancePlayer: "p1",
      },
      playerKey: "p1",
      keyCards,
      targetRequest: {
        id: "req-kill",
        actionId: "action.kill",
        controller: "p2",
        status: "pending",
        targets: [{ type: "unit", unitId: "u-1", kind: "character", componentId: "character.soldier", targetDefinitionId: "target" }],
        keyCards: [],
        sequence: 1,
      },
    });

    it("2.1: Valid 2 Club cards (A..10) passes validation", () => {
      const hand = [
        { id: "c-c1", suit: "club", rank: "A", value: 1 },
        { id: "c-c10", suit: "club", rank: "10", value: 10 },
      ];
      const ctx = makeBaseContext(hand, hand);
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).not.toThrow();
    });

    it("2.2: Illegal key count: 1 card throws ValidationError", () => {
      const hand = [{ id: "c-c1", suit: "club", rank: "A", value: 1 }];
      const ctx = makeBaseContext(hand, hand);
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });

    it("2.3: Illegal key count: 3 cards throws ValidationError", () => {
      const hand = [
        { id: "c-c1", suit: "club", rank: "A", value: 1 },
        { id: "c-c2", suit: "club", rank: "2", value: 2 },
        { id: "c-c3", suit: "club", rank: "3", value: 3 },
      ];
      const ctx = makeBaseContext(hand, hand);
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });

    it("2.4: Illegal suit: 1 Club + 1 Spade throws ValidationError", () => {
      const hand = [
        { id: "c-c1", suit: "club", rank: "A", value: 1 },
        { id: "c-s2", suit: "spade", rank: "2", value: 2 },
      ];
      const ctx = makeBaseContext(hand, hand);
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });

    it("2.5: Illegal rank: Club K (outside A..10) throws ValidationError", () => {
      const hand = [
        { id: "c-c1", suit: "club", rank: "A", value: 1 },
        { id: "c-ck", suit: "club", rank: "K", value: 13 },
      ];
      const ctx = makeBaseContext(hand, hand);
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });

    it("2.6: Illegal zone: key cards in grave instead of hand throws ValidationError", () => {
      const hand = [{ id: "c-d1", suit: "diamond", rank: "A", value: 1 }];
      const grave = [
        { id: "c-c1", suit: "club", rank: "A", value: 1 },
        { id: "c-c2", suit: "club", rank: "2", value: 2 },
      ];
      const ctx = makeBaseContext(hand, grave);
      ctx.state.players.p1.grave = grave;
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 3. Request-Time Target Validation (hasTarget: true, status: pending)
  // =========================================================================
  describe("3. Request-Time Target Validation", () => {
    const validator = new ActionRequestValidator();

    const makeContextWithTarget = (targetReq: any, stageReqs: any[]): CommandContext => {
      const hand = [
        { id: "c-c1", suit: "club", rank: "A", value: 1 },
        { id: "c-c2", suit: "club", rank: "2", value: 2 },
      ];
      return {
        state: {
          players: {
            p1: { hand: [...hand], field: [], grave: [], life: [] },
            p2: { hand: [], field: [], grave: [], life: [] },
          },
          stage: { requests: stageReqs },
          turnPlayer: "p1",
          chancePlayer: "p1",
        },
        playerKey: "p1",
        keyCards: hand,
        targetRequest: targetReq,
      };
    };

    it("3.1: Can target pending request with targets (e.g. Kill)", () => {
      const killReq = {
        id: "req-kill",
        actionId: "action.kill",
        controller: "p2",
        status: "pending",
        targets: [{ type: "unit", unitId: "u-1" }],
      };
      const ctx = makeContextWithTarget(killReq, [killReq]);
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).not.toThrow();
    });

    it("3.2: Cannot target request without targets (e.g. End)", () => {
      const endReq = {
        id: "req-end",
        actionId: "action.end",
        controller: "p2",
        status: "pending",
        targets: [],
      };
      const ctx = makeContextWithTarget(endReq, [endReq]);
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });

    it("3.3: Cannot target request with status resolved", () => {
      const resolvedKill = {
        id: "req-kill",
        actionId: "action.kill",
        controller: "p2",
        status: "resolved",
        targets: [{ type: "unit", unitId: "u-1" }],
      };
      const ctx = makeContextWithTarget(resolvedKill, [resolvedKill]);
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });

    it("3.4: Cannot target request with status cancelled", () => {
      const cancelledKill = {
        id: "req-kill",
        actionId: "action.kill",
        controller: "p2",
        status: "cancelled",
        targets: [{ type: "unit", unitId: "u-1" }],
      };
      const ctx = makeContextWithTarget(cancelledKill, [cancelledKill]);
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });

    it("3.5: Cannot target self request", () => {
      const myReq = {
        id: "req-ct",
        actionId: "action.changeTarget",
        controller: "p1",
        status: "pending",
        targets: [{ type: "request", requestId: "req-kill" }],
      };
      const ctx = makeContextWithTarget(myReq, [myReq]);
      ctx.currentRequest = myReq as any;
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });

    it("3.6: Fails if target request is not present on Stage", () => {
      const ghostReq = {
        id: "req-ghost",
        actionId: "action.kill",
        controller: "p2",
        status: "pending",
        targets: [{ type: "unit", unitId: "u-1" }],
      };
      const ctx = makeContextWithTarget(ghostReq, []); // empty stage
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 4. ActionTargetService Unit Contracts (SSOT & Replacement Logic)
  // =========================================================================
  describe("4. ActionTargetService Unit Contracts", () => {
    it("4.1: enumerateTargets for Change Target only lists stage requests with targets", () => {
      const state = {
        players: { p1: {}, p2: {} },
        stage: {
          requests: [
            { id: "r1", actionId: "action.end", controller: "p2", status: "pending", targets: [] },
            { id: "r2", actionId: "action.kill", controller: "p2", status: "pending", targets: [{ type: "unit", unitId: "u1" }] },
            { id: "r3", actionId: "action.counter", controller: "p1", status: "pending", targets: [{ type: "request", requestId: "r2" }] },
          ],
        },
      };

      const candidates = ActionTargetService.enumerateTargets(
        changeTargetAction,
        state,
        "p1",
        rulePackage.components
      );

      const targetRequestIds = candidates.map((c) => c.targetRequestId);
      expect(targetRequestIds).not.toContain("r1"); // end has no targets
      expect(targetRequestIds).toContain("r2"); // kill has targets
      expect(targetRequestIds).toContain("r3"); // counter has targets
    });

    it("4.2: TargetSelectionEnumerator delegates to ActionTargetService cleanly", () => {
      const state = {
        players: { p1: {}, p2: {} },
        stage: {
          requests: [
            { id: "r2", actionId: "action.kill", controller: "p2", status: "pending", targets: [{ type: "unit", unitId: "u1" }] },
          ],
        },
      };

      const candidates = TargetSelectionEnumerator.enumerateTargets(
        changeTargetAction,
        state,
        "p1",
        rulePackage.components
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0].targetRequestId).toBe("r2");
    });

    it("4.3: enumerateReplacementTargets for Kill only lists soldier units", () => {
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const targetReq: ActionRequest = {
        id: "req-kill",
        actionId: "action.kill",
        action: killAction,
        controller: "p2",
        keyCards: [{ suit: "spade", rank: "A" }, { suit: "spade", rank: "2" }],
        status: "pending",
        sequence: 1,
        targets: [{ type: "unit", unitId: "u-soldier-1", kind: "character", componentId: "character.soldier" }],
      };

      const state = {
        players: {
          p1: {
            field: [
              { unitId: "u-soldier-1", componentId: "character.soldier", kind: "character", state: "charge" },
              { unitId: "u-bulwark-1", componentId: "character.bulwark", kind: "character", state: "charge" },
            ],
          },
          p2: {
            field: [
              { unitId: "u-soldier-2", componentId: "character.soldier", kind: "character", state: "charge" },
              { unitId: "u-hero-1", componentId: "character.hero", kind: "character", state: "charge" },
            ],
          },
        },
        stage: { requests: [targetReq] },
      };

      const candidates = ActionTargetService.enumerateReplacementTargets(
        targetReq,
        state,
        rulePackage.components
      );

      const unitIds = candidates.map((c) => c.targetUnitId);
      expect(unitIds).toContain("u-soldier-1");
      expect(unitIds).toContain("u-soldier-2");
      expect(unitIds).toContain("u-hero-1"); // In BlackPoker, hero is a soldier characterType
      expect(unitIds).not.toContain("u-bulwark-1"); // bulwark is not a soldier
    });

    it("4.4: enumerateReplacementTargets for Mount Soldier uses original key card suit (Section 30)", () => {
      const mountAction = rulePackage.actions.find((a) => a.id === "action.mountSoldier")!;
      const targetReq: ActionRequest = {
        id: "req-mount",
        actionId: "action.mountSoldier",
        action: mountAction,
        controller: "p1",
        keyCards: [{ suit: "spade", rank: "A" }], // Spade key
        status: "pending",
        sequence: 1,
        targets: [{ type: "unit", unitId: "u-s1", kind: "character", componentId: "character.soldier" }],
      };

      const state = {
        players: {
          p1: {
            field: [
              { unitId: "u-s1", componentId: "character.soldier", kind: "character", suit: "spade", cards: [{ suit: "spade" }] },
              { unitId: "u-s2", componentId: "character.soldier", kind: "character", suit: "spade", cards: [{ suit: "spade" }] },
              { unitId: "u-s3", componentId: "character.soldier", kind: "character", suit: "heart", cards: [{ suit: "heart" }] },
            ],
          },
          p2: { field: [] },
        },
        stage: { requests: [targetReq] },
      };

      const candidates = ActionTargetService.enumerateReplacementTargets(
        targetReq,
        state,
        rulePackage.components
      );

      const unitIds = candidates.map((c) => c.targetUnitId);
      expect(unitIds).toContain("u-s1");
      expect(unitIds).toContain("u-s2");
      expect(unitIds).not.toContain("u-s3"); // Heart does not match Mount Soldier's Spade key
    });

    it("4.5: isSameCanonicalTarget correctly identifies equality", () => {
      expect(ActionTargetService.isSameCanonicalTarget(null, null)).toBe(true);
      expect(ActionTargetService.isSameCanonicalTarget(undefined, undefined)).toBe(true);
      expect(
        ActionTargetService.isSameCanonicalTarget(
          { targetType: "unit", targetUnitId: "u1" },
          { type: "unit", unitId: "u1" }
        )
      ).toBe(true);
      expect(
        ActionTargetService.isSameCanonicalTarget(
          { targetType: "unit", targetUnitId: "u1" },
          { type: "unit", unitId: "u2" }
        )
      ).toBe(false);
      expect(
        ActionTargetService.isSameCanonicalTarget(
          { targetType: "request", targetRequestId: "r1" },
          { type: "request", requestId: "r1" }
        )
      ).toBe(true);
      expect(
        ActionTargetService.isSameCanonicalTarget(
          { targetType: "player", targetPlayerKey: "p1" },
          { type: "player", targetPlayerKey: "p1" }
        )
      ).toBe(true);
      expect(
        ActionTargetService.isSameCanonicalTarget(
          { targetType: "unit", targetUnitId: "u1" },
          { targetType: "player", targetPlayerKey: "p1" }
        )
      ).toBe(false);
    });

    it("4.6: replaceTarget performs atomic update and preserves targetDefinitionId", () => {
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const targetReq: ActionRequest = {
        id: "req-kill",
        actionId: "action.kill",
        action: killAction,
        controller: "p2",
        keyCards: [],
        status: "pending",
        sequence: 1,
        targets: [{ type: "unit", unitId: "u-1", kind: "character", componentId: "character.soldier", targetDefinitionId: "target" }],
      };

      const state = {
        players: {
          p1: {
            field: [
              { unitId: "u-1", componentId: "character.soldier", kind: "character" },
              { unitId: "u-2", componentId: "character.soldier", kind: "character" },
            ],
          },
        },
      };

      const result = ActionTargetService.replaceTarget(
        targetReq,
        { targetType: "unit", targetPlayerKey: "p1", targetUnitId: "u-2", targetDefinitionId: "target" },
        state,
        rulePackage.components
      );

      expect(result.changed).toBe(true);
      expect((result.previousTarget as any)?.unitId).toBe("u-1");
      expect((result.newTarget as any)?.unitId).toBe("u-2");
      expect((result.newTarget as any)?.targetDefinitionId).toBe("target");
      expect((targetReq.targets![0] as any).unitId).toBe("u-2");
    });

    it("4.7: replaceTarget with identical target returns changed: false", () => {
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const targetReq: ActionRequest = {
        id: "req-kill",
        actionId: "action.kill",
        action: killAction,
        controller: "p2",
        keyCards: [],
        status: "pending",
        sequence: 1,
        targets: [{ type: "unit", unitId: "u-1", kind: "character", componentId: "character.soldier", targetDefinitionId: "target" }],
      };

      const state = {
        players: {
          p1: {
            field: [{ unitId: "u-1", componentId: "character.soldier", kind: "character" }],
          },
        },
      };

      const result = ActionTargetService.replaceTarget(
        targetReq,
        { targetType: "unit", targetPlayerKey: "p1", targetUnitId: "u-1", targetDefinitionId: "target" },
        state,
        rulePackage.components
      );

      expect(result.changed).toBe(false);
      expect((targetReq.targets![0] as any).unitId).toBe("u-1");
    });
  });

  // =========================================================================
  // 5. Decision Generation & Interruption (LegalPatternGenerator & GameSession)
  // =========================================================================
  describe("5. Decision Generation & Interruption", () => {
    it("5.1: generateTargetSelectionDecision builds valid DecisionRequest with EFFECT_RESOLUTION", () => {
      const candidates: TargetSelection[] = [
        { targetType: "unit", targetPlayerKey: "p1", targetUnitId: "u-1", displayName: "Player A: Soldier 1" },
        { targetType: "unit", targetPlayerKey: "p1", targetUnitId: "u-2", displayName: "Player A: Soldier 2" },
      ];

      const sourceReq = { id: "req-ct-1" };
      const decReq = LegalPatternGenerator.generateTargetSelectionDecision(
        { stateVersion: 2, matchId: "m-1" },
        "p1",
        sourceReq,
        "selectActionTarget",
        candidates
      );

      expect(decReq.source.type).toBe("EFFECT_RESOLUTION");
      expect((decReq.source as any).sourceRequestRef).toBe("req-ct-1");
      expect(decReq.patterns).toHaveLength(2);
      expect(decReq.catalog.targetSelections).toHaveLength(2);
      expect(decReq.catalog.effectSelections).toHaveLength(2);

      const eff0 = decReq.catalog.effectSelections[0];
      expect(eff0.selectionType).toBe("target");
      expect(eff0.targetSelection?.targetUnitId).toBe("u-1");
    });

    it("5.2: selectActionTarget with 0 units on field binds null and does not interrupt", () => {
      const registry = new CommandRegistry();
      const interp = registry.getEffectInterpreter();

      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const targetReq: ActionRequest = {
        id: "req-kill",
        actionId: "action.kill",
        action: killAction,
        controller: "p2",
        keyCards: [],
        status: "pending",
        sequence: 1,
        targets: [{ type: "unit", unitId: "u-dead", kind: "character", componentId: "character.soldier", targetDefinitionId: "target" }],
      };

      // No units on field
      const context: CommandContext = {
        state: {
          players: { p1: { field: [] }, p2: { field: [] } },
          stage: { requests: [targetReq] },
        },
        playerKey: "p1",
        targetRequest: targetReq,
      };

      const result = interp.executeEffectsWithInterruption(
        [
          {
            selectActionTarget: {
              id: "replacementTarget",
              request: "targetRequest",
              decisionPlayer: "self",
            },
          },
          {
            replaceRequestTarget: {
              request: "targetRequest",
              selection: "replacementTarget",
            },
          },
        ],
        context
      );

      // Completed without interruption
      expect(result).toEqual({ completed: true });
      expect(context.selections?.["replacementTarget"]).toBeNull();
      // Target was not modified
      expect((targetReq.targets![0] as any).unitId).toBe("u-dead");
    });
  });

  // =========================================================================
  // 6. Section 28-A / 28-B / 28-C Integration (Change Target vs Counter)
  // =========================================================================
  describe("6. Section 28-A / 28-B / 28-C Integration (Change Target vs Counter)", () => {
    it("6.1: Resolving Change Target is a legal replacement candidate for Counter (Section 28-A/B)", () => {
      const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;

      const attackReq: ActionRequest = {
        id: "req-attack",
        actionId: "action.attack",
        controller: "p1",
        keyCards: [{ suit: "spade", rank: "A", value: 1 }],
        status: "pending",
        sequence: 1,
      };

      const counterReq: ActionRequest = {
        id: "req-counter",
        actionId: "action.counter",
        action: counterAction,
        controller: "p2",
        keyCards: [{ suit: "club", rank: "5", value: 5 }],
        status: "pending",
        sequence: 2,
        targets: [{ type: "request", requestId: "req-attack", actionId: "action.attack", targetDefinitionId: "targetRequest" }],
      };

      const changeTargetReq: ActionRequest = {
        id: "req-ct",
        actionId: "action.changeTarget",
        action: changeTargetAction,
        controller: "p1",
        keyCards: [
          { suit: "club", rank: "A", value: 1 },
          { suit: "club", rank: "2", value: 2 },
        ],
        status: "resolving", // Currently resolving
        sequence: 3,
        targets: [{ type: "request", requestId: "req-counter", actionId: "action.counter", targetDefinitionId: "targetRequest" }],
      };

      const state = {
        players: { p1: {}, p2: {} },
        stage: {
          requests: [attackReq, counterReq, changeTargetReq],
        },
      };

      // Enumerate replacement targets for Counter from Change Target's perspective
      const candidates = ActionTargetService.enumerateReplacementTargets(
        counterReq,
        state,
        rulePackage.components,
        { resolvingRequestId: "req-ct" }
      );

      const candidateReqIds = candidates.map((c) => c.targetRequestId);
      // Both req-attack and req-ct should be legal candidates!
      expect(candidateReqIds).toContain("req-attack");
      expect(candidateReqIds).toContain("req-ct");
      // req-counter itself must NOT be a candidate (self-target prohibition)
      expect(candidateReqIds).not.toContain("req-counter");
    });

    it("6.2: End-to-end execution: Counter target changed to Change Target causes Counter to fizzle (Section 28-C)", () => {
      const p1CtKeys = [
        { id: "c-c1", suit: "club", rank: "A", value: 1 },
        { id: "c-c2", suit: "club", rank: "2", value: 2 },
      ];
      const p1KillKeys = [
        { id: "c-s1", suit: "spade", rank: "A", value: 1 },
        { id: "c-s2", suit: "spade", rank: "2", value: 2 },
      ];
      const p2CounterKey = [{ id: "c-c5", suit: "club", rank: "5", value: 5 }];
      const p2DiscardForCost = [{ id: "c-c6", suit: "club", rank: "6", value: 6 }];

      const p2TargetUnit = {
        unitId: "u-p2-target",
        componentId: "character.soldier",
        kind: "character",
        state: "charge",
        cards: [{ id: "c-card-target", suit: "spade", rank: "4" }],
      };

      const customState = {
        matchId: "match-ct-counter",
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            hand: [...p1CtKeys, ...p1KillKeys],
            field: [],
            grave: [],
            life: [{ id: "l-p1", suit: "heart", rank: "A" }],
          },
          p2: {
            hand: [...p2CounterKey, ...p2DiscardForCost],
            field: [p2TargetUnit],
            grave: [],
            life: [{ id: "l-p2", suit: "heart", rank: "A" }],
          },
        },
        stage: {
          requests: [] as any[],
          history: [] as any[],
        },
      };

      const session = new GameSession(customState, rulePackage, {
        matchId: "match-ct-counter",
      });

      // 1. P1 requests Kill targeting P2's unit
      session.state.chancePlayer = "p1";
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const killReq = session.registry.createRequest(killAction, {
        state: session.state,
        playerKey: "p1",
        keyCards: p1KillKeys,
        targetComponent: p2TargetUnit,
      });

      // 2. P2 requests Counter targeting Kill
      session.state.chancePlayer = "p2";
      const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
      const counterReq = session.registry.createRequest(counterAction, {
        state: session.state,
        playerKey: "p2",
        keyCards: p2CounterKey,
        targetRequest: killReq,
      });

      // 3. P1 requests Change Target targeting Counter
      session.state.chancePlayer = "p1";
      const ctReq = session.registry.createRequest(changeTargetAction, {
        state: session.state,
        playerKey: "p1",
        keyCards: p1CtKeys,
        targetRequest: counterReq,
      });

      // Helper: advance by having both players pass until stage top resolves or interrupts
      function resolveStageTopWithPasses(sess: GameSession) {
        for (let i = 0; i < 2; i++) {
          const step = sess.advance();
          if (step.type !== "WAITING_FOR_DECISION") return step;
          if (step.request.source.type === "EFFECT_RESOLUTION") {
            return step;
          }
          const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
          if (passIdx === -1) {
            throw new Error(`PASS pattern not found for player ${step.request.playerId}`);
          }
          const nextStep = sess.submitDecision({
            decisionId: step.request.decisionId,
            stateVersion: step.request.stateVersion,
            selectedPatternRef: passIdx,
          });
          if (nextStep.type === "WAITING_FOR_DECISION" && nextStep.request.source.type === "EFFECT_RESOLUTION") {
            return nextStep;
          }
        }
      }

      // Both players pass to trigger Stage TOP resolution (Change Target)
      const step1 = resolveStageTopWithPasses(session)!;
      expect(step1.type).toBe("WAITING_FOR_DECISION");
      const dec1 = (step1 as any).request;
      expect(dec1.source.type).toBe("EFFECT_RESOLUTION");

      // Find pattern where replacement target is Change Target (req-ct)
      const targetPatternIdx = dec1.patterns.findIndex((p: any) => {
        const eff = dec1.catalog.effectSelections[p.effectSelectionRef];
        return eff?.targetSelection?.targetRequestId === ctReq.id;
      });
      expect(targetPatternIdx).toBeGreaterThanOrEqual(0);

      // Submit decision: select Change Target as Counter's new target
      const submitResp: DecisionResponse = {
        decisionId: dec1.decisionId,
        stateVersion: dec1.stateVersion,
        selectedPatternRef: targetPatternIdx,
      };

      session.submitDecision(submitResp);

      // Change Target finishes resolving, mutates Counter's target, and pops from Stage
      expect(session.state.stage.requests).toHaveLength(2);

      // Both players pass to resolve Counter: since Change Target is already popped/resolved, Counter fizzles!
      resolveStageTopWithPasses(session);

      expect(session.state.stage.requests).toHaveLength(1);

      // Both players pass to resolve Kill
      resolveStageTopWithPasses(session);

      const stageAfter = session.state.stage.requests;
      expect(stageAfter).toHaveLength(0);

      // Verify Counter was resolved with effectSkipped: true
      const logs = session.getMatchLog().events;
      const targetChangedEvents = logs.filter((e) => e.type === "request.target.changed");
      expect(targetChangedEvents).toHaveLength(1);
      const ctEvent = targetChangedEvents[0] as any;
      expect(ctEvent.requestId).toBe(counterReq.id);
      expect(ctEvent.previousTarget.requestId).toBe(killReq.id);
      expect(ctEvent.newTarget.requestId).toBe(ctReq.id);

      const counterResolvedEvent = logs.find(
        (e: any) => e.type === "request.resolved" && e.requestId === counterReq.id
      ) as any;
      expect(counterResolvedEvent).toBeDefined();
      expect(counterResolvedEvent.effectSkipped).toBe(true);
      expect(counterResolvedEvent.reason).toBe("TARGET_INVALID_AT_RESOLUTION");

      // Kill request resolved successfully!
      const killResolvedEvent = logs.find(
        (e: any) => e.type === "request.resolved" && e.requestId === killReq.id
      ) as any;
      expect(killResolvedEvent).toBeDefined();
      expect(killResolvedEvent.effectSkipped).toBeFalsy();

      // P2's unit was killed and moved to grave!
      expect(session.state.players.p2.field).toHaveLength(0);
      expect(
        session.state.players.p2.grave.some(
          (u: any) => u.unitId === "u-p2-target" || u.cards?.some((c: any) => c.id === "c-card-target")
        )
      ).toBe(true);
    });
  });

  // =========================================================================
  // 7. Full Game Flow Integration (Kill & Mount Soldier)
  // =========================================================================
  describe("7. Full Game Flow Integration", () => {
    it("7.1: Change Target redirects Kill from Soldier A to Soldier B", () => {
      const soldierA = {
        unitId: "u-sA",
        componentId: "character.soldier",
        kind: "character",
        state: "charge",
        cards: [{ id: "c-card-A", suit: "spade", rank: "2" }],
      };
      const soldierB = {
        unitId: "u-sB",
        componentId: "character.soldier",
        kind: "character",
        state: "charge",
        cards: [{ id: "c-card-B", suit: "spade", rank: "3" }],
      };

      const ctKeys = [
        { id: "c-c1", suit: "club", rank: "A", value: 1 },
        { id: "c-c2", suit: "club", rank: "2", value: 2 },
      ];
      const killKeys = [
        { id: "c-s1", suit: "spade", rank: "A", value: 1 },
        { id: "c-s2", suit: "spade", rank: "2", value: 2 },
      ];

      const customState = {
        matchId: "match-ct-kill",
        stateVersion: 1,
        turnPlayer: "p2",
        chancePlayer: "p2",
        players: {
          p1: {
            hand: ctKeys,
            field: [soldierA, soldierB],
            grave: [],
            life: [{ id: "l-p1", suit: "heart", rank: "A" }],
          },
          p2: {
            hand: killKeys,
            field: [],
            grave: [],
            life: [{ id: "l-p2", suit: "heart", rank: "A" }],
          },
        },
        stage: { requests: [] as any[], history: [] as any[] },
      };

      const session = new GameSession(customState, rulePackage, {
        matchId: "match-ct-kill",
      });

      // P2 requests Kill targeting Soldier A
      session.state.chancePlayer = "p2";
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const killReq = session.registry.createRequest(killAction, {
        state: session.state,
        playerKey: "p2",
        keyCards: killKeys,
        targetComponent: soldierA,
      });

      // P1 requests Change Target targeting Kill
      session.state.chancePlayer = "p1";
      const ctReq = session.registry.createRequest(changeTargetAction, {
        state: session.state,
        playerKey: "p1",
        keyCards: ctKeys,
        targetRequest: killReq,
      });

      function resolveStageTopWithPasses(sess: GameSession) {
        for (let i = 0; i < 2; i++) {
          const step = sess.advance();
          if (step.type !== "WAITING_FOR_DECISION") return step;
          if (step.request.source.type === "EFFECT_RESOLUTION") {
            return step;
          }
          const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
          if (passIdx === -1) {
            throw new Error(`PASS pattern not found for player ${step.request.playerId}`);
          }
          const nextStep = sess.submitDecision({
            decisionId: step.request.decisionId,
            stateVersion: step.request.stateVersion,
            selectedPatternRef: passIdx,
          });
          if (nextStep.type === "WAITING_FOR_DECISION" && nextStep.request.source.type === "EFFECT_RESOLUTION") {
            return nextStep;
          }
        }
      }

      // Both players pass to start resolution of Change Target
      const step1 = resolveStageTopWithPasses(session)!;
      expect(step1.type).toBe("WAITING_FOR_DECISION");
      const dec1 = (step1 as any).request;
      expect(dec1.source.type).toBe("EFFECT_RESOLUTION");

      // Select Soldier B
      const targetPatternIdx = dec1.patterns.findIndex((p: any) => {
        const eff = dec1.catalog.effectSelections[p.effectSelectionRef];
        return eff?.targetSelection?.targetUnitId === soldierB.unitId;
      });
      expect(targetPatternIdx).toBeGreaterThanOrEqual(0);

      session.submitDecision({
        decisionId: dec1.decisionId,
        stateVersion: dec1.stateVersion,
        selectedPatternRef: targetPatternIdx,
      });

      // Change Target resolved! Both players pass to resolve Kill
      resolveStageTopWithPasses(session);

      // After resolution: Soldier B should be in grave, Soldier A should still be on field!
      const p1Field = session.state.players.p1.field;
      const p1Grave = session.state.players.p1.grave;

      expect(p1Field.some((u: any) => u.unitId === soldierA.unitId)).toBe(true);
      expect(p1Field.some((u: any) => u.unitId === soldierB.unitId)).toBe(false);
      expect(
        p1Grave.some(
          (u: any) => u.unitId === soldierB.unitId || u.cards?.some((c: any) => c.id === "c-card-B")
        )
      ).toBe(true);
    });

    it("7.2: CanonicalMatchLog is JSON serializable and valid", () => {
      const session = new GameSession(
        { players: { p1: {}, p2: {} }, stage: { requests: [] } },
        rulePackage,
        { matchId: "match-json-test" }
      );

      const log = session.getMatchLog();
      expect(() => JSON.stringify(log)).not.toThrow();
      const parsed = JSON.parse(JSON.stringify(log));
      expect(parsed.meta.matchId).toBe("match-json-test");
      expect(Array.isArray(parsed.events)).toBe(true);
    });
  });
});
