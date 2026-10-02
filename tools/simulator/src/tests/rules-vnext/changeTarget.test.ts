import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { RulePackage, ActionDefinition, ActionRequest, ActionRequestTarget } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext, cancelStageRequest } from "../../engine/rules/CommandRegistry";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { ActionTargetService } from "../../engine/rules/ActionTargetService";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { GameSession } from "../../engine/session/GameSession";
import { loadRegulationCatalog, getFormat, getRegulation } from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { TargetSelection, EffectSelection } from "../../domain/decision/DecisionCatalog";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { evaluateRequestTargetCondition } from "../../engine/rules/targetConditionUtils";

describe("BP-SIM-REG-5.0-F-R1-PRO-CHANGE-TARGET: Pro Action Change Target & Hardened Generic Target Foundation", () => {
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
  // 1. Official Rule SSOT & Schema Contracts (Section 54.1, 54.35)
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

      // Target: request with hasTarget: true (no artificial status: pending)
      expect(changeTargetAction.targets).toBeDefined();
      expect(changeTargetAction.targets).toHaveLength(1);
      expect(changeTargetAction.targets![0]).toEqual({
        id: "targetRequest",
        type: "request",
        condition: {
          hasTarget: true,
        },
      });

      // Effect text: does NOT require a different target ("別の" is removed)
      expect(changeTargetAction.text?.effect).toBe(
        "対象のリクエストで指定されている対象をそのアクションが指定できる範囲で変更する。"
      );
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

    it("1.2: Counter YAML does not contain artificial status: pending", () => {
      const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
      expect(counterAction).toBeDefined();
      expect(counterAction.targets![0].condition?.status).toBeUndefined();
      expect(counterAction.targets![0].condition?.keyCards).toEqual({ count: [1, 2] });
    });

    it("1.3: Format inclusion/exclusion contract", async () => {
      const lightFormat = await getFormat("light");
      const standardFormat = await getFormat("standard");
      const proFormat = await getFormat("pro");

      expect(lightFormat).toBeDefined();
      expect(lightFormat.actions).not.toContain("action.changeTarget");

      expect(standardFormat).toBeDefined();
      expect(standardFormat.actions).not.toContain("action.changeTarget");

      expect(proFormat).toBeDefined();
      expect(proFormat.actions).toContain("action.changeTarget");
      expect(proFormat.actions).toHaveLength(31);
    });

    it("1.4: Total actions count is 36 including action.changeTarget", () => {
      expect(rulePackage.actions).toHaveLength(36);
      expect(rulePackage.actions.map((a) => a.id)).toContain("action.changeTarget");
    });

    it("1.5: pro:rarePack remains unimplemented / unpublished", async () => {
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
              targets: [{ type: "unit", unitId: "u-1", kind: "character", componentId: "character.soldier", targetDefinitionId: "target" }],
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
  // 3. Request-Time Target Validation & Stage Invariant (Section 54.6, 54.7, 54.8, 54.29)
  // =========================================================================
  describe("3. Request-Time Target Validation & Stage Invariant", () => {
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
          stage: { requests: stageReqs, history: [] },
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

    it("3.2: Can target resolving request with targets (resolving with status omitted is legal)", () => {
      const resolvingKill = {
        id: "req-kill",
        actionId: "action.kill",
        controller: "p2",
        status: "resolving",
        targets: [{ type: "unit", unitId: "u-1" }],
      };
      const ctx = makeContextWithTarget(resolvingKill, [resolvingKill]);
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).not.toThrow();
    });

    it("3.3: Cannot target request without targets (e.g. End)", () => {
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

    it("3.4: Cannot target request with status resolved (structurally invalid)", () => {
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

    it("3.5: Cannot target request with status cancelled (structurally invalid)", () => {
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

    it("3.6: Cannot target self request", () => {
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

    it("3.7: Fails if target request is not present on Stage (ghost request)", () => {
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

    it("3.8: Fails if target request is only in stage.history (Section 21, 29)", () => {
      const historyReq = {
        id: "req-history",
        actionId: "action.kill",
        controller: "p2",
        status: "pending",
        targets: [{ type: "unit", unitId: "u-1" }],
      };
      const ctx = makeContextWithTarget(historyReq, []);
      ctx.state.stage.history = [historyReq];
      expect(() => validator.validateActionRequest(changeTargetAction, ctx)).toThrow(ValidationError);
    });
  });

  // =========================================================================
  // 4. Exact Request Status Semantics Evaluator (Section 34, 54.6, 54.7, 54.8)
  // =========================================================================
  describe("4. Exact Request Status Semantics Evaluator", () => {
    it("4.1: evaluateRequestTargetCondition respects exact status equality without aliasing", () => {
      const pendingReq = { id: "r1", status: "pending" };
      const resolvingReq = { id: "r2", status: "resolving" };

      // target.status = pending, condition.status = pending -> PASS
      expect(evaluateRequestTargetCondition(pendingReq, { status: "pending" }).isValid).toBe(true);

      // target.status = resolving, condition.status = pending -> FAIL
      expect(evaluateRequestTargetCondition(resolvingReq, { status: "pending" }).isValid).toBe(false);

      // target.status = resolving, condition.status = resolving -> PASS
      expect(evaluateRequestTargetCondition(resolvingReq, { status: "resolving" }).isValid).toBe(true);

      // target.status = resolving, condition.status omitted -> PASS
      expect(evaluateRequestTargetCondition(resolvingReq, {}).isValid).toBe(true);
    });
  });

  // =========================================================================
  // 5. ActionTargetService SSOT & Candidate Enumeration (Section 54.9, 10, 11, 12, 13)
  // =========================================================================
  describe("5. ActionTargetService Candidate Enumeration", () => {
    it("5.1: enumerateTargets for Change Target only lists active stage requests with targets", () => {
      const state = {
        players: { p1: {}, p2: {} },
        stage: {
          requests: [
            { id: "r1", actionId: "action.end", controller: "p2", status: "pending", targets: [] },
            { id: "r2", actionId: "action.kill", controller: "p2", status: "pending", targets: [{ type: "unit", unitId: "u1" }] },
            { id: "r3", actionId: "action.counter", controller: "p1", status: "pending", targets: [{ type: "request", requestId: "r2" }] },
            { id: "r4-resolved", actionId: "action.kill", controller: "p2", status: "resolved", targets: [{ type: "unit", unitId: "u1" }] },
            { id: "r5-cancelled", actionId: "action.kill", controller: "p2", status: "cancelled", targets: [{ type: "unit", unitId: "u1" }] },
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
      expect(targetRequestIds).not.toContain("r4-resolved"); // resolved is structurally invalid
      expect(targetRequestIds).not.toContain("r5-cancelled"); // cancelled is structurally invalid
    });

    it("5.2: TargetSelectionEnumerator delegates cleanly to ActionTargetService", () => {
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

    it("5.3: enumerateReplacementTargets for Kill only lists soldier units", () => {
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
      expect(unitIds).toContain("u-hero-1"); // hero is a soldier characterType
      expect(unitIds).not.toContain("u-bulwark-1"); // bulwark is not a soldier
    });

    it("5.4: enumerateReplacementTargets for Mount Soldier uses original key card suit (Section 54.13)", () => {
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

    it("5.5: enumerateReplacementTargets for player-targeting action uses original controller (Section 54.10, 54.12)", () => {
      const syntheticPlayerAction: any = {
        id: "action.syntheticPlayerTarget",
        name: "プレイヤー対象アクション",
        type: "magic",
        targets: [
          {
            id: "targetPlayer",
            type: "player",
            condition: { relation: "opponent" },
          },
        ],
      };

      const req: any = {
        id: "req-player-tgt",
        actionId: "action.syntheticPlayerTarget",
        action: syntheticPlayerAction,
        controller: "p2",
        status: "pending",
        targets: [{ type: "player", targetPlayerKey: "p1", targetDefinitionId: "targetPlayer" }],
      };

      const state = {
        players: { p1: {}, p2: {} },
        stage: { requests: [req] },
      };

      // When P1 calls Change Target on req-player-tgt (whose controller is P2),
      // the relation "opponent" must be evaluated relative to P2, resulting in P1 as opponent candidate!
      const candidates = ActionTargetService.enumerateReplacementTargets(
        req,
        state,
        rulePackage.components,
        { actions: [syntheticPlayerAction] }
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].targetPlayerKey).toBe("p1");
    });
  });

  // =========================================================================
  // 6. Apply-Time Canonical Revalidation & Fail-Closed Scenarios (Section 54.14 - 54.21)
  // =========================================================================
  describe("6. Apply-Time Canonical Revalidation & Fail-Closed", () => {
    it("6.1: Stale Unit candidate (removed from field before apply) throws Error and leaves target unchanged (Section 54.14)", () => {
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

      // State without u-2 (u-2 was removed before apply)
      const state = {
        players: {
          p1: {
            field: [{ unitId: "u-1", componentId: "character.soldier", kind: "character" }],
          },
        },
      };

      expect(() =>
        ActionTargetService.replaceTarget(
          targetReq,
          { targetType: "unit", targetPlayerKey: "p1", targetUnitId: "u-2", targetDefinitionId: "target" },
          state,
          rulePackage.components
        )
      ).toThrow("ユニット [u-2] はフィールド上に存在しません。");

      // targetRequest is untouched (atomic)
      expect((targetReq.targets![0] as any).unitId).toBe("u-1");
    });

    it("6.2: Stale Request candidate (removed from stage before apply) throws Error (Section 54.15)", () => {
      const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
      const counterReq: any = {
        id: "req-counter",
        actionId: "action.counter",
        action: counterAction,
        controller: "p2",
        keyCards: [{ suit: "club", rank: "5", value: 5 }],
        status: "pending",
        targets: [{ type: "request", requestId: "req-orig", actionId: "action.attack", targetDefinitionId: "targetRequest" }],
      };

      const state = {
        stage: {
          requests: [counterReq], // req-stale is gone from stage!
          history: [{ id: "req-stale", actionId: "action.attack", status: "pending" }],
        },
        players: { p1: {}, p2: {} },
      };

      expect(() =>
        ActionTargetService.replaceTarget(
          counterReq,
          { targetType: "request", targetRequestId: "req-stale", targetDefinitionId: "targetRequest" },
          state,
          rulePackage.components
        )
      ).toThrow("ターゲットリクエスト [req-stale] はステージ上に存在しません。");

      expect((counterReq.targets![0] as any).requestId).toBe("req-orig");
    });

    it("6.3: Candidate condition changed after enumeration (charge -> drive) throws Error (Section 54.16)", () => {
      const syntheticAction: any = {
        id: "action.strikeCharged",
        name: "チャージ撃破",
        type: "magic",
        targets: [
          {
            id: "target",
            type: "unit",
            condition: { state: "charge" },
          },
        ],
      };

      const targetReq: any = {
        id: "req-strike",
        actionId: "action.strikeCharged",
        action: syntheticAction,
        controller: "p1",
        status: "pending",
        targets: [{ type: "unit", unitId: "u-1", kind: "character", componentId: "character.soldier", targetDefinitionId: "target" }],
      };

      // u-2 is driven, not charged
      const state = {
        players: {
          p2: {
            field: [
              { unitId: "u-1", componentId: "character.soldier", kind: "character", state: "charge" },
              { unitId: "u-2", componentId: "character.soldier", kind: "character", state: "drive" },
            ],
          },
        },
      };

      expect(() =>
        ActionTargetService.replaceTarget(
          targetReq,
          { targetType: "unit", targetPlayerKey: "p2", targetUnitId: "u-2", targetDefinitionId: "target" },
          state,
          rulePackage.components,
          undefined,
          [syntheticAction]
        )
      ).toThrow("ターゲットユニットの状態が不適合です");

      expect((targetReq.targets![0] as any).unitId).toBe("u-1");
    });

    it("6.4: Duplicate unitId across fields fails closed (Section 54.18)", () => {
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const targetReq: any = {
        id: "req-kill",
        actionId: "action.kill",
        action: killAction,
        controller: "p2",
        keyCards: [],
        status: "pending",
        targets: [{ type: "unit", unitId: "u-1", kind: "character", componentId: "character.soldier", targetDefinitionId: "target" }],
      };

      // Duplicate u-dup on p1 and p2 fields
      const state = {
        players: {
          p1: { field: [{ unitId: "u-dup", componentId: "character.soldier", kind: "character" }] },
          p2: { field: [{ unitId: "u-dup", componentId: "character.soldier", kind: "character" }] },
        },
      };

      expect(() =>
        ActionTargetService.replaceTarget(
          targetReq,
          { targetType: "unit", targetPlayerKey: "p1", targetUnitId: "u-dup", targetDefinitionId: "target" },
          state,
          rulePackage.components
        )
      ).toThrow("重複するユニットID [u-dup] がフィールド上で検出されました。");
    });

    it("6.5: Duplicate requestId on Stage fails closed (Section 54.19)", () => {
      const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
      const counterReq: any = {
        id: "req-counter",
        actionId: "action.counter",
        action: counterAction,
        controller: "p2",
        keyCards: [{ suit: "club", rank: "5", value: 5 }],
        status: "pending",
        targets: [{ type: "request", requestId: "req-orig", actionId: "action.attack", targetDefinitionId: "targetRequest" }],
      };

      const state = {
        stage: {
          requests: [
            counterReq,
            { id: "req-dup", actionId: "action.attack", status: "pending", controller: "p1", keyCards: [{ suit: "spade", rank: "A" }] },
            { id: "req-dup", actionId: "action.attack", status: "pending", controller: "p1", keyCards: [{ suit: "spade", rank: "A" }] },
          ],
        },
        players: { p1: {}, p2: {} },
      };

      expect(() =>
        ActionTargetService.replaceTarget(
          counterReq,
          { targetType: "request", targetRequestId: "req-dup", targetDefinitionId: "targetRequest" },
          state,
          rulePackage.components
        )
      ).toThrow("重複するリクエストID [req-dup] がステージ上で検出されました。");
    });

    it("6.6: Unknown player fails closed (Section 54.20)", () => {
      const syntheticPlayerAction: any = {
        id: "action.synPlayer",
        name: "プレイヤー対象",
        type: "magic",
        targets: [{ id: "targetPlayer", type: "player" }],
      };

      const targetReq: any = {
        id: "req-p",
        actionId: "action.synPlayer",
        action: syntheticPlayerAction,
        controller: "p1",
        status: "pending",
        targets: [{ type: "player", targetPlayerKey: "p2", targetDefinitionId: "targetPlayer" }],
      };

      const state = { players: { p1: {}, p2: {} } };

      expect(() =>
        ActionTargetService.replaceTarget(
          targetReq,
          { targetType: "player", targetPlayerKey: "p-ghost", targetDefinitionId: "targetPlayer" },
          state,
          rulePackage.components,
          undefined,
          [syntheticPlayerAction]
        )
      ).toThrow("プレイヤー [p-ghost] が存在しません。");
    });

    it("6.7: Wrong targetDefinitionId fails closed (Section 54.21)", () => {
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const targetReq: any = {
        id: "req-kill",
        actionId: "action.kill",
        action: killAction,
        controller: "p2",
        status: "pending",
        targets: [{ type: "unit", unitId: "u-1", kind: "character", componentId: "character.soldier", targetDefinitionId: "target" }],
      };

      const state = {
        players: {
          p1: { field: [{ unitId: "u-2", componentId: "character.soldier", kind: "character" }] },
        },
      };

      expect(() =>
        ActionTargetService.replaceTarget(
          targetReq,
          { targetType: "unit", targetPlayerKey: "p1", targetUnitId: "u-2", targetDefinitionId: "wrongSlot" },
          state,
          rulePackage.components
        )
      ).toThrow("指定された targetDefinitionId [wrongSlot] はアクション [action.kill] のターゲット定義に存在しません。");
    });

    it("6.8: Spoofed TargetSelection type fails closed (Section 54.17)", () => {
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const targetReq: any = {
        id: "req-kill",
        actionId: "action.kill",
        action: killAction,
        controller: "p2",
        status: "pending",
        targets: [{ type: "unit", unitId: "u-1", kind: "character", componentId: "character.soldier", targetDefinitionId: "target" }],
      };

      const state = {
        players: { p1: {}, p2: {} },
      };

      // Expected type is unit, but caller supplied player
      expect(() =>
        ActionTargetService.replaceTarget(
          targetReq,
          { targetType: "player", targetPlayerKey: "p1", targetDefinitionId: "target" },
          state,
          rulePackage.components
        )
      ).toThrow("ターゲット種別が不適合です。期待: unit, 実際: player");
    });
  });

  // =========================================================================
  // 7. Same-Target Legality & Validation Order (Section 54.2, 54.3, 54.30)
  // =========================================================================
  describe("7. Same-Target Legality & Validation Order", () => {
    it("7.1: Same target is legal when still present and valid -> changed: false (Section 54.2)", () => {
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
      expect((result.previousTarget as any)?.unitId).toBe("u-1");
      expect((result.newTarget as any)?.unitId).toBe("u-1");
    });

    it("7.2: Same target candidate that became stale fails closed (validates before no-op) (Section 22)", () => {
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const targetReq: any = {
        id: "req-kill",
        actionId: "action.kill",
        action: killAction,
        controller: "p2",
        status: "pending",
        targets: [{ type: "unit", unitId: "u-1", kind: "character", componentId: "character.soldier", targetDefinitionId: "target" }],
      };

      // u-1 has been removed from field
      const state = {
        players: {
          p1: { field: [] },
        },
      };

      // Even though selection has unitId: "u-1" (same as current target), it must NOT silently no-op!
      expect(() =>
        ActionTargetService.replaceTarget(
          targetReq,
          { targetType: "unit", targetPlayerKey: "p1", targetUnitId: "u-1", targetDefinitionId: "target" },
          state,
          rulePackage.components
        )
      ).toThrow("ユニット [u-1] はフィールド上に存在しません。");
    });
  });

  // =========================================================================
  // 8. Multi-Target Definition Resolution & Pattern Identity (Section 54.22, 23, 24, 36, 37)
  // =========================================================================
  describe("8. Multi-Target Definition Resolution & Decision Slot Identity", () => {
    const multiTargetAction: any = {
      id: "action.doubleStrike",
      name: "連撃",
      type: "magic",
      targets: [
        { id: "targetA", type: "unit", condition: { characterType: "soldier" } },
        { id: "targetB", type: "unit", condition: { characterType: "soldier" } },
      ],
    };

    it("8.1: Multi-target explicit slot replacement replaces only matched slot (Section 54.22)", () => {
      const targetReq: any = {
        id: "req-multi",
        actionId: "action.doubleStrike",
        action: multiTargetAction,
        controller: "p1",
        status: "pending",
        targets: [
          { type: "unit", unitId: "u-s1", kind: "character", componentId: "character.soldier", targetDefinitionId: "targetA" },
          { type: "unit", unitId: "u-s2", kind: "character", componentId: "character.soldier", targetDefinitionId: "targetB" },
        ],
      };

      const state = {
        players: {
          p2: {
            field: [
              { unitId: "u-s1", componentId: "character.soldier", kind: "character" },
              { unitId: "u-s2", componentId: "character.soldier", kind: "character" },
              { unitId: "u-s3", componentId: "character.soldier", kind: "character" },
            ],
          },
        },
      };

      // Candidate enumeration lists candidates with targetDefinitionId
      const candidates = ActionTargetService.enumerateReplacementTargets(
        targetReq,
        state,
        rulePackage.components,
        { actions: [multiTargetAction] }
      );

      expect(candidates.some((c) => c.targetDefinitionId === "targetA")).toBe(true);
      expect(candidates.some((c) => c.targetDefinitionId === "targetB")).toBe(true);

      // Replace targetB with u-s3
      const result = ActionTargetService.replaceTarget(
        targetReq,
        { targetType: "unit", targetPlayerKey: "p2", targetUnitId: "u-s3", targetDefinitionId: "targetB" },
        state,
        rulePackage.components,
        "targetB",
        [multiTargetAction]
      );

      expect(result.changed).toBe(true);
      expect(result.targetDefinitionId).toBe("targetB");
      expect((result.previousTarget as any)?.unitId).toBe("u-s2");
      expect((result.newTarget as any)?.unitId).toBe("u-s3");

      // Verify targetA is completely untouched
      expect((targetReq.targets![0] as any).unitId).toBe("u-s1");
      expect(targetReq.targets![0].targetDefinitionId).toBe("targetA");
      expect((targetReq.targets![1] as any).unitId).toBe("u-s3");
      expect(targetReq.targets![1].targetDefinitionId).toBe("targetB");
    });

    it("8.2: Multi-target ambiguous slot fails closed (Section 54.23)", () => {
      const targetReq: any = {
        id: "req-ambiguous",
        actionId: "action.doubleStrike",
        action: multiTargetAction,
        controller: "p1",
        status: "pending",
        // Targets missing targetDefinitionId
        targets: [
          { type: "unit", unitId: "u-s1", kind: "character", componentId: "character.soldier" },
        ],
      };

      const state = {
        players: {
          p2: { field: [{ unitId: "u-s1", componentId: "character.soldier", kind: "character" }] },
        },
      };

      expect(() =>
        ActionTargetService.replaceTarget(
          targetReq,
          { targetType: "unit", targetPlayerKey: "p2", targetUnitId: "u-s1" },
          state,
          rulePackage.components,
          undefined,
          [multiTargetAction]
        )
      ).toThrow("対象スロット (targetDefinitionId) を一意に特定できません。");
    });

    it("8.3: Decision patterns for multi-target slots have distinct patternId and targetDefinitionId (Section 54.24, 37)", () => {
      const candidates: TargetSelection[] = [
        { targetType: "unit", targetPlayerKey: "p1", targetUnitId: "u-1", targetDefinitionId: "targetA" },
        { targetType: "unit", targetPlayerKey: "p1", targetUnitId: "u-1", targetDefinitionId: "targetB" },
      ];

      const decReq = LegalPatternGenerator.generateTargetSelectionDecision(
        { stateVersion: 1, matchId: "m-1" },
        "p1",
        { id: "req-ct" },
        "selectActionTarget",
        candidates
      );

      expect(decReq.patterns).toHaveLength(2);
      expect(decReq.patterns[0].patternId).toBe("effect-target-targetA-unit-u-1");
      expect(decReq.patterns[1].patternId).toBe("effect-target-targetB-unit-u-1");
      expect(decReq.catalog.targetSelections).toHaveLength(2);
      expect(decReq.catalog.targetSelections[0].targetDefinitionId).toBe("targetA");
      expect(decReq.catalog.targetSelections[1].targetDefinitionId).toBe("targetB");
    });
  });

  // =========================================================================
  // 9. Lifecycle & GameSession Integration (Section 54.4, 5, 25, 26, 27, 28)
  // =========================================================================
  describe("9. Lifecycle & GameSession Integration", () => {
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

    it("9.1: Counter target changed to Change Target causes Counter to fizzle (Section 28-C E2E) (Section 54.4, 5)", () => {
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

      expect(session.state.stage.requests).toHaveLength(3);

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

    it("9.2: Change Target redirects Kill from Soldier A to Soldier B and logs canonical event (Section 54.9, 54.27, 54.28)", () => {
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

      // Verify canonical event structure
      const logEvents = session.getMatchLog().events;
      const changeEvent = logEvents.find((e) => e.type === "request.target.changed") as any;
      expect(changeEvent).toBeDefined();
      expect(changeEvent.requestId).toBe(killReq.id);
      expect(changeEvent.actionRef).toBe("action.kill");
      expect(changeEvent.controller).toBe("p2");
      expect(changeEvent.targetDefinitionId).toBe("target");
      expect(changeEvent.previousTarget.unitId).toBe(soldierA.unitId);
      expect(changeEvent.newTarget.unitId).toBe(soldierB.unitId);
      expect(changeEvent.cause.actionId).toBe("action.changeTarget");
      expect(changeEvent.cause.requestId).toBe(ctReq.id);
    });

    it("9.3: Cancelled Change Target before resolution creates no decision and causes no mutation (Section 54.25)", () => {
      const soldierA = { unitId: "u-sA", componentId: "character.soldier", kind: "character", cards: [] };
      const ctKeys = [
        { id: "c-c1", suit: "club", rank: "A", value: 1 },
        { id: "c-c2", suit: "club", rank: "2", value: 2 },
      ];
      const killKeys = [
        { id: "c-s1", suit: "spade", rank: "A", value: 1 },
        { id: "c-s2", suit: "spade", rank: "2", value: 2 },
      ];

      const state: any = {
        players: {
          p1: { hand: ctKeys, field: [soldierA], grave: [], life: [{ id: "l1" }] },
          p2: { hand: killKeys, field: [], grave: [], life: [{ id: "l2" }] },
        },
        stage: { requests: [], history: [] },
      };

      const registry = new CommandRegistry();
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const killReq = registry.createRequest(killAction, {
        state,
        playerKey: "p2",
        keyCards: killKeys,
        targetComponent: soldierA,
      });

      const ctReq = registry.createRequest(changeTargetAction, {
        state,
        playerKey: "p1",
        keyCards: ctKeys,
        targetRequest: killReq,
      });

      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      // Cancel Change Target before resolution
      cancelStageRequest(ctReq.id, context);
      expect(ctReq.status).toBe("cancelled");

      // Verify ctReq was popped from stage
      expect(state.stage.requests.some((r: any) => r.id === ctReq.id)).toBe(false);

      // Top request is now killReq
      expect(state.stage.requests[state.stage.requests.length - 1].id).toBe(killReq.id);

      // Kill request's target remains soldierA
      expect((killReq.targets![0] as any).unitId).toBe("u-sA");
    });

    it("9.4: Lost target Request skips Change Target effect (Section 54.26)", () => {
      const soldierA = { unitId: "u-sA", componentId: "character.soldier", kind: "character", cards: [] };
      const ctKeys = [
        { id: "c-c1", suit: "club", rank: "A", value: 1 },
        { id: "c-c2", suit: "club", rank: "2", value: 2 },
      ];
      const killKeys = [
        { id: "c-s1", suit: "spade", rank: "A", value: 1 },
        { id: "c-s2", suit: "spade", rank: "2", value: 2 },
      ];

      const state: any = {
        players: {
          p1: { hand: ctKeys, field: [soldierA], grave: [], life: [{ id: "l1" }] },
          p2: { hand: killKeys, field: [], grave: [], life: [{ id: "l2" }] },
        },
        stage: { requests: [], history: [] },
      };

      const registry = new CommandRegistry();
      const killAction = rulePackage.actions.find((a) => a.id === "action.kill")!;
      const killReq = registry.createRequest(killAction, {
        state,
        playerKey: "p2",
        keyCards: killKeys,
        targetComponent: soldierA,
      });

      const ctReq = registry.createRequest(changeTargetAction, {
        state,
        playerKey: "p1",
        keyCards: ctKeys,
        targetRequest: killReq,
      });

      // Kill request leaves stage before Change Target resolves
      state.stage.requests = state.stage.requests.filter((r: any) => r.id !== killReq.id);

      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      const resolveRes = registry.resolveTopRequest(context);
      expect(resolveRes?.type).toBe("COMPLETED");
      // Change Target effect was skipped due to TARGET_INVALID_AT_RESOLUTION
      expect(ctReq.status).toBe("resolved");
    });
  });

  // =========================================================================
  // 10. Engine Hardcode & Boundary Guard (Section 54.30, 43)
  // =========================================================================
  describe("10. Engine Hardcode & Boundary Guard", () => {
    it("10.1: No action.changeTarget hardcoding in engine directory", () => {
      const engineDir = path.resolve(__dirname, "../../engine");
      const files = getAllFiles(engineDir);

      const matchingLines: string[] = [];
      for (const file of files) {
        if (!file.endsWith(".ts")) continue;
        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          if (line.includes("action.changeTarget")) {
            matchingLines.push(`${file}:${idx + 1}: ${line.trim()}`);
          }
        });
      }

      expect(matchingLines).toEqual([]);
    });

    it("10.2: No specific action IDs hardcoded in ActionTargetService.ts", () => {
      const targetServiceFile = path.resolve(__dirname, "../../engine/rules/ActionTargetService.ts");
      const content = fs.readFileSync(targetServiceFile, "utf-8");

      const forbiddenActionPatterns = [
        "action.kill",
        "action.counter",
        "action.truce",
        "action.mountSoldier",
        "action.handeth",
        "action.changeTarget",
      ];

      const matchingLines: string[] = [];
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        for (const pattern of forbiddenActionPatterns) {
          if (line.includes(pattern)) {
            matchingLines.push(`L${idx + 1} matches ${pattern}: ${line.trim()}`);
          }
        }
      });

      expect(matchingLines).toEqual([]);
    });
  });
});

function getAllFiles(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
}
