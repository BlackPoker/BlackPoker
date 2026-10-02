import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext, cancelStageRequest } from "../../engine/rules/CommandRegistry";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { evaluateRequestTargetCondition } from "../../engine/rules/targetConditionUtils";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { GameSession } from "../../engine/session/GameSession";
import { RequestBufferProcessor } from "../../engine/rules/RequestBufferProcessor";
import { loadRegulationCatalog, getFormat, getRegulation } from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { cleanupTransientBattleState } from "../../engine/rules/damageJudgeUtils";

describe("BP-SIM-REG-5.0-E-PRO-TRUCE: Pro Action Truce (停戦) Specification & Implementation Contracts", () => {
  let rulePackage: RulePackage;
  let proRulePackage: RulePackage;
  let truceAction: ActionDefinition;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    proRulePackage = loadRulePackageForBrowser();
    truceAction = rulePackage.actions.find((a) => a.id === "action.truce")!;
    await loadRegulationCatalog();
  });

  // =========================================================================
  // 1. Official Rule SSOT & Schema Contracts (Sections 3, 8, 9)
  // =========================================================================
  describe("1. Official Rule SSOT & Schema Contracts (Sections 3, 8, 9)", () => {
    it("1.1: Truce action definition conforms exactly to v9.1.2 Section 7.3.1.4.9", () => {
      expect(truceAction).toBeDefined();
      expect(truceAction.id).toBe("action.truce");
      expect(truceAction.name).toBe("停戦");
      expect(truceAction.ruby).toBe("ていせん");
      expect(truceAction.type).toBe("magic");

      // Request semantics: direct, normal, quick
      expect(truceAction.request).toEqual({
        trigger: "direct",
        speed: "normal",
        timing: "quick",
      });

      // Cost: NONE
      expect(truceAction.cost).toBeUndefined();

      // Key: 2 x Diamond A..10 from Hand
      expect(truceAction.key).toEqual({
        id: "keys",
        count: 2,
        condition: {
          card: {
            suit: "diamond",
            rank: "A..10",
            zone: "hand",
          },
        },
      });

      // Target: exactly action.damageJudge with status: pending
      expect(truceAction.targets).toBeDefined();
      expect(truceAction.targets).toHaveLength(1);
      expect(truceAction.targets![0]).toEqual({
        id: "targetRequest",
        type: "request",
        condition: {
          status: "pending",
          actionId: "action.damageJudge",
        },
      });

      // Effect: cancelRequest -> cleanupBattleState
      expect(truceAction.text?.effect).toBe("対象のリクエストを無効にし、対象のリクエストをステージから取り除く。");
      expect(truceAction.effect).toHaveLength(2);
      const effects = truceAction.effect as any[];
      expect(effects[0].cancelRequest).toEqual({
        target: "targetRequest",
      });
      expect(effects[1].cleanupBattleState).toEqual({});
    });

    it("1.2: Format inclusion/exclusion contract (Sections 3, 35, 36)", async () => {
      const lightFormat = await getFormat("light");
      const standardFormat = await getFormat("standard");
      const proFormat = await getFormat("pro");

      expect(lightFormat).toBeDefined();
      expect(lightFormat.actions).not.toContain("action.truce");

      expect(standardFormat).toBeDefined();
      expect(standardFormat.actions).not.toContain("action.truce");

      expect(proFormat).toBeDefined();
      expect(proFormat.actions).toContain("action.truce");
      expect(proFormat.actions).toHaveLength(31);

      // Full RulePackage action count: 35
      expect(rulePackage.actions).toHaveLength(35);
      expect(proRulePackage.actions).toHaveLength(35);
    });
  });

  // =========================================================================
  // 2. Generic Request Target actionId Condition & Enumeration (Sections 10, 11, 34)
  // =========================================================================
  describe("2. Generic Request Target actionId Condition & Enumeration (Sections 10, 11, 34)", () => {
    it("2.1: evaluateRequestTargetCondition - actionId exact match, mismatch, and omitted", () => {
      const djReq = { id: "req-dj", actionId: "action.damageJudge", status: "pending" };
      const upReq = { id: "req-up", actionId: "action.up", status: "pending" };

      // Exact match -> PASS
      const resMatch = evaluateRequestTargetCondition(djReq, {
        status: "pending",
        actionId: "action.damageJudge",
      });
      expect(resMatch.isValid).toBe(true);

      // Mismatch -> FAIL (TARGET_CONDITION_UNMET)
      const resMismatch = evaluateRequestTargetCondition(upReq, {
        status: "pending",
        actionId: "action.damageJudge",
      });
      expect(resMismatch.isValid).toBe(false);
      expect(resMismatch.reason).toBe("TARGET_CONDITION_UNMET");

      // actionId omitted -> backward compatible (PASS)
      const resOmitted = evaluateRequestTargetCondition(upReq, {
        status: "pending",
      });
      expect(resOmitted.isValid).toBe(true);
    });

    it("2.2: TargetSelectionEnumerator filters exact actionId and rejects non-matching stage requests", () => {
      const state: any = {
        players: { p1: {}, p2: {} },
        stage: {
          requests: [
            { id: "req-dj-1", actionId: "action.damageJudge", status: "pending", controller: "p1" },
            { id: "req-up-1", actionId: "action.up", status: "pending", controller: "p1" },
            { id: "req-counter-1", actionId: "action.counter", status: "pending", controller: "p2" },
          ],
        },
      };

      const targets = TargetSelectionEnumerator.enumerateTargets(
        truceAction,
        state,
        "p2"
      );

      // Only req-dj-1 should be enumerated
      expect(targets).toHaveLength(1);
      expect(targets[0].targetRequestId).toBe("req-dj-1");
      expect(targets[0].targetType).toBe("request");
    });

    it("2.3: TargetSelectionEnumerator returns empty array when stage has no action.damageJudge", () => {
      const state: any = {
        players: { p1: {}, p2: {} },
        stage: {
          requests: [
            { id: "req-up-1", actionId: "action.up", status: "pending", controller: "p1" },
            { id: "req-counter-1", actionId: "action.counter", status: "pending", controller: "p2" },
          ],
        },
      };

      const targets = TargetSelectionEnumerator.enumerateTargets(
        truceAction,
        state,
        "p2"
      );
      expect(targets).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. Key Card Contracts & Canonical Physical Identity (Sections 6, 20, 30)
  // =========================================================================
  describe("3. Key Card Contracts & Canonical Physical Identity (Sections 6, 20, 30)", () => {
    it("3.1: Valid Diamond A..10 key cards (2 cards) succeed", () => {
      const d1 = { id: "c-d1", suit: "D", rank: "A", value: 1 };
      const d2 = { id: "c-d2", suit: "D", rank: "2", value: 2 };
      const djReq = { id: "req-dj", actionId: "action.damageJudge", status: "pending", controller: "p1" };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p2",
        stage: { requests: [djReq] },
        players: {
          p1: { hand: [] },
          p2: { hand: [d1, d2] },
        },
      };

      const validator = new ActionRequestValidator();
      const context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [d1, d2],
        targetRequest: djReq as any,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      expect(() => validator.validateActionRequest(truceAction, context)).not.toThrow();
    });

    it("3.2: Rejects invalid key cards - wrong suit, face cards (J, Q, K), wrong count", () => {
      const d10 = { id: "c-d10", suit: "D", rank: "10", value: 10 };
      const dj = { id: "c-dj", suit: "D", rank: "J", value: 11 };
      const dq = { id: "c-dq", suit: "D", rank: "Q", value: 12 };
      const dk = { id: "c-dk", suit: "D", rank: "K", value: 13 };
      const h5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
      const d5 = { id: "c-d5", suit: "D", rank: "5", value: 5 };
      const djReq = { id: "req-dj", actionId: "action.damageJudge", status: "pending", controller: "p1" };

      const validator = new ActionRequestValidator();

      // Diamond Face card (J) -> FAIL
      expect(() => {
        const state: any = { turnPlayer: "p1", chancePlayer: "p2", stage: { requests: [djReq] }, players: { p2: { hand: [d10, dj] } } };
        validator.validateActionRequest(truceAction, {
          state, playerKey: "p2", keyCards: [d10, dj], targetRequest: djReq as any,
          actions: proRulePackage.actions, components: proRulePackage.components,
        });
      }).toThrow(ValidationError);

      // Diamond Face card (Q) -> FAIL
      expect(() => {
        const state: any = { turnPlayer: "p1", chancePlayer: "p2", stage: { requests: [djReq] }, players: { p2: { hand: [d5, dq] } } };
        validator.validateActionRequest(truceAction, {
          state, playerKey: "p2", keyCards: [d5, dq], targetRequest: djReq as any,
          actions: proRulePackage.actions, components: proRulePackage.components,
        });
      }).toThrow(ValidationError);

      // Diamond Face card (K) -> FAIL
      expect(() => {
        const state: any = { turnPlayer: "p1", chancePlayer: "p2", stage: { requests: [djReq] }, players: { p2: { hand: [d5, dk] } } };
        validator.validateActionRequest(truceAction, {
          state, playerKey: "p2", keyCards: [d5, dk], targetRequest: djReq as any,
          actions: proRulePackage.actions, components: proRulePackage.components,
        });
      }).toThrow(ValidationError);

      // Non-diamond suit (Heart) -> FAIL
      expect(() => {
        const state: any = { turnPlayer: "p1", chancePlayer: "p2", stage: { requests: [djReq] }, players: { p2: { hand: [h5, d5] } } };
        validator.validateActionRequest(truceAction, {
          state, playerKey: "p2", keyCards: [h5, d5], targetRequest: djReq as any,
          actions: proRulePackage.actions, components: proRulePackage.components,
        });
      }).toThrow(ValidationError);

      // Single key card (1 instead of 2) -> FAIL
      expect(() => {
        const state: any = { turnPlayer: "p1", chancePlayer: "p2", stage: { requests: [djReq] }, players: { p2: { hand: [d5] } } };
        validator.validateActionRequest(truceAction, {
          state, playerKey: "p2", keyCards: [d5], targetRequest: djReq as any,
          actions: proRulePackage.actions, components: proRulePackage.components,
        });
      }).toThrow(ValidationError);
    });

    it("3.3: Canonical Physical Identity - State Hand properties authoritative against caller spoofing", () => {
      // In State Hand: card is Heart (not Diamond)
      const realHeartCard = { id: "card-spoofed-1", suit: "H", rank: "7", value: 7 };
      const realDiamondCard = { id: "card-d-2", suit: "D", rank: "8", value: 8 };

      const state: any = {
        stage: { requests: [{ id: "req-dj", actionId: "action.damageJudge", status: "pending", controller: "p1" }] },
        players: {
          p1: { hand: [] },
          p2: { hand: [realHeartCard, realDiamondCard] },
        },
      };

      // Caller spoofs realHeartCard as Diamond
      const spoofedCard = { id: "card-spoofed-1", suit: "D", rank: "7", value: 7 };

      const registry = new CommandRegistry();
      const context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [spoofedCard, realDiamondCard],
        targetRequest: state.stage.requests[0],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      // createRequest validates canonical identity from state hand -> fails because real suit is Heart
      expect(() => registry.createRequest(truceAction, context)).toThrow();
    });
  });

  // =========================================================================
  // 4. Invalid Target & RequestBuffer Contracts (Sections 4, 19, 20, 27)
  // =========================================================================
  describe("4. Invalid Target & RequestBuffer Contracts (Sections 4, 19, 20, 27)", () => {
    it("4.1: Rejects targeting non-DamageJudge actions even if status is pending", () => {
      const validator = new ActionRequestValidator();
      const d3 = { id: "c-d3", suit: "D", rank: "3", value: 3 };
      const d4 = { id: "c-d4", suit: "D", rank: "4", value: 4 };

      const nonDjActions = [
        "action.attack",
        "action.block",
        "action.up",
        "action.counter",
        "action.kill",
        "action.reunion",
        "action.truce",
      ];

      for (const nonDjActionId of nonDjActions) {
        const nonDjReq = { id: `req-${nonDjActionId}`, actionId: nonDjActionId, status: "pending", controller: "p1" };
        const state: any = {
          turnPlayer: "p1",
          chancePlayer: "p2",
          stage: { requests: [nonDjReq] },
          players: { p1: { hand: [] }, p2: { hand: [d3, d4] } },
        };

        expect(() => {
          validator.validateActionRequest(truceAction, {
            state,
            playerKey: "p2",
            keyCards: [d3, d4],
            targetRequest: nonDjReq as any,
            actions: proRulePackage.actions,
            components: proRulePackage.components,
          });
        }).toThrow(ValidationError);
      }
    });

    it("4.2: Rejects cancelled, resolved, or non-existent DamageJudge requests", () => {
      const validator = new ActionRequestValidator();
      const d3 = { id: "c-d3", suit: "D", rank: "3", value: 3 };
      const d4 = { id: "c-d4", suit: "D", rank: "4", value: 4 };

      // Status: cancelled
      const cancelledDj = { id: "req-dj-canc", actionId: "action.damageJudge", status: "cancelled", controller: "p1" };
      const stateCanc: any = {
        turnPlayer: "p1",
        chancePlayer: "p2",
        stage: { requests: [cancelledDj] },
        players: { p2: { hand: [d3, d4] } },
      };
      expect(() => {
        validator.validateActionRequest(truceAction, {
          state: stateCanc, playerKey: "p2", keyCards: [d3, d4], targetRequest: cancelledDj as any,
          actions: proRulePackage.actions, components: proRulePackage.components,
        });
      }).toThrow(ValidationError);

      // Status: resolved
      const resolvedDj = { id: "req-dj-res", actionId: "action.damageJudge", status: "resolved", controller: "p1" };
      const stateRes: any = {
        turnPlayer: "p1",
        chancePlayer: "p2",
        stage: { requests: [resolvedDj] },
        players: { p2: { hand: [d3, d4] } },
      };
      expect(() => {
        validator.validateActionRequest(truceAction, {
          state: stateRes, playerKey: "p2", keyCards: [d3, d4], targetRequest: resolvedDj as any,
          actions: proRulePackage.actions, components: proRulePackage.components,
        });
      }).toThrow(ValidationError);

      // Not in stage
      const ghostDj = { id: "req-dj-ghost", actionId: "action.damageJudge", status: "pending", controller: "p1" };
      const stateGhost: any = {
        turnPlayer: "p1",
        chancePlayer: "p2",
        stage: { requests: [] },
        players: { p2: { hand: [d3, d4] } },
      };
      expect(() => {
        validator.validateActionRequest(truceAction, {
          state: stateGhost, playerKey: "p2", keyCards: [d3, d4], targetRequest: ghostDj as any,
          actions: proRulePackage.actions, components: proRulePackage.components,
        });
      }).toThrow(ValidationError);
    });

    it("4.3: Truce cannot target DamageJudge while it is in requestBuffer", () => {
      const d3 = { id: "c-d3", suit: "D", rank: "3", value: 3 };
      const d4 = { id: "c-d4", suit: "D", rank: "4", value: 4 };
      const bufferDj = { id: "req-dj-buf", actionId: "action.damageJudge", status: "pending", controller: "p1" };

      const state: any = {
        turnPlayer: "p1",
        chancePlayer: "p2",
        stage: { requests: [] }, // NOT on stage
        requestBuffer: { requests: [bufferDj], history: [] },
        players: { p1: { hand: [] }, p2: { hand: [d3, d4] } },
      };

      // 1. Validator rejects targeting buffer request
      const validator = new ActionRequestValidator();
      expect(() => {
        validator.validateActionRequest(truceAction, {
          state,
          playerKey: "p2",
          keyCards: [d3, d4],
          targetRequest: bufferDj as any,
          actions: proRulePackage.actions,
          components: proRulePackage.components,
        });
      }).toThrow(ValidationError);

      // 2. LegalPatternGenerator does not enumerate Truce when DamageJudge is only in buffer
      const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p2", proRulePackage);
      const trucePatterns = decision.patterns.filter((p: any) => {
        const act = decision.catalog.actions[p.actionSelectionRef!];
        return act?.actionId === "action.truce";
      });
      expect(trucePatterns).toHaveLength(0);
    });
  });

  // =========================================================================
  // 5. Successful Stack Resolution & LIFO Preservation (Sections 13, 21, 22)
  // =========================================================================
  describe("5. Successful Stack Resolution & LIFO Preservation (Sections 13, 21, 22)", () => {
    it("5.1: Stage bottom = DamageJudge, top = Truce -> Truce cancels DamageJudge, stage emptied", () => {
      const registry = new CommandRegistry();
      const expr = new ExpressionEvaluator();
      const ability = new AbilityEvaluator();
      const interp = new EffectInterpreter(registry, expr, ability);

      const emittedEvents: any[] = [];
      registry.onEvent((evt: any) => emittedEvents.push(evt));

      const recordedLogs: any[] = [];
      const logRecorder = { record: (entry: any) => recordedLogs.push(entry) };

      const d5 = { id: "c-d5", suit: "D", rank: "5", value: 5 };
      const d9 = { id: "c-d9", suit: "D", rank: "9", value: 9 };

      const djAction = proRulePackage.actions.find((a) => a.id === "action.damageJudge")!;

      const djReq: any = {
        id: "req-dj-100",
        actionId: "action.damageJudge",
        action: djAction,
        controller: "p1",
        status: "pending",
        keyCards: [],
      };

      const truceReq: any = {
        id: "req-truce-101",
        actionId: "action.truce",
        action: truceAction,
        controller: "p2",
        status: "pending",
        keyCards: [d5, d9],
        targets: [
          {
            type: "request",
            requestId: "req-dj-100",
            targetDefinitionId: "targetRequest",
          },
        ],
      };

      const state: any = {
        stateVersion: 1,
        stage: {
          requests: [djReq, truceReq],
          history: [],
        },
        players: {
          p1: { hand: [], field: [], grave: [], life: [] },
          p2: { hand: [], field: [], grave: [], life: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [d5, d9],
        targetRequest: djReq,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
        logRecorder: logRecorder as any,
      };

      // Resolve Truce from top of Stage
      const result = registry.resolveRequest(truceReq, context);
      expect(result.type).toBe("COMPLETED");

      // Truce is resolved and moved to history
      expect(truceReq.status).toBe("resolved");

      // DamageJudge was cancelled and moved to history
      expect(djReq.status).toBe("cancelled");

      // Stage requests is empty
      expect(state.stage.requests).toHaveLength(0);

      // Stage history contains both djReq (cancelled) and truceReq (resolved)
      expect(state.stage.history).toContain(djReq);
      expect(state.stage.history).toContain(truceReq);

      // Truce key cards finalized to p2 grave
      expect(state.players.p2.grave.map((c: any) => c.id)).toEqual(["c-d5", "c-d9"]);

      // Verify logs
      const cancelledLog = recordedLogs.find((l) => l.type === "request.cancelled");
      expect(cancelledLog).toBeDefined();
      expect(cancelledLog.requestId).toBe("req-dj-100");
      expect(cancelledLog.reason).toBe("countered");

      const resolvedLog = recordedLogs.find((l) => l.type === "request.resolved" && l.requestId === "req-truce-101");
      expect(resolvedLog).toBeDefined();

      // No resolved log for DamageJudge
      const djResolvedLog = recordedLogs.find((l) => l.type === "request.resolved" && l.requestId === "req-dj-100");
      expect(djResolvedLog).toBeUndefined();
    });

    it("5.2: LIFO Preservation - only target DamageJudge is removed, unrelated requests preserved in order", () => {
      const registry = new CommandRegistry();
      const d1 = { id: "c-d1", suit: "D", rank: "A", value: 1 };
      const d2 = { id: "c-d2", suit: "D", rank: "2", value: 2 };

      const olderReq = { id: "req-older", actionId: "action.up", status: "pending", controller: "p1" };
      const djReq = { id: "req-dj", actionId: "action.damageJudge", status: "pending", controller: "p1" };
      const truceReq: any = {
        id: "req-truce",
        actionId: "action.truce",
        action: truceAction,
        controller: "p2",
        status: "pending",
        keyCards: [d1, d2],
        targets: [{ type: "request", requestId: "req-dj", targetDefinitionId: "targetRequest" }],
      };

      const state: any = {
        stateVersion: 1,
        stage: {
          requests: [olderReq, djReq, truceReq],
          history: [],
        },
        players: {
          p1: { hand: [], field: [], grave: [], life: [] },
          p2: { hand: [], field: [], grave: [], life: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [d1, d2],
        targetRequest: djReq as any,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      registry.resolveRequest(truceReq, context);

      // djReq removed, truceReq resolved and removed
      // olderReq MUST remain on stage as index 0
      expect(state.stage.requests).toHaveLength(1);
      expect(state.stage.requests[0].id).toBe("req-older");
    });
  });

  // =========================================================================
  // 6. Damage Prevention & Combat Grave Movement Suppression (Section 23)
  // =========================================================================
  describe("6. Damage Prevention & Combat Grave Movement Suppression (Section 23)", () => {
    it("6.1: Combat that would destroy characters and deal lethal life damage produces 0 damage and 0 grave moves when Truced", () => {
      const registry = new CommandRegistry();
      const d7 = { id: "c-d7", suit: "D", rank: "7", value: 7 };
      const d8 = { id: "c-d8", suit: "D", rank: "8", value: 8 };

      const attackerCard = { id: "att-c", suit: "S", rank: "10", value: 10 };
      const attackerUnit = {
        unitId: "u-att",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "drive",
        cards: [attackerCard],
        battle: { role: "attacker", targetPlayerKey: "p2" },
      };

      const blockerCard = { id: "blk-c", suit: "H", rank: "2", value: 2 };
      const blockerUnit = {
        unitId: "u-blk",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [blockerCard],
        battle: { role: "blocker", blocksUnitId: "u-att" },
      };

      const p2LifeCard = { id: "p2-l1", suit: "C", rank: "5", value: 5 };

      const djAction = proRulePackage.actions.find((a) => a.id === "action.damageJudge")!;
      const djReq: any = {
        id: "req-dj-combat",
        actionId: "action.damageJudge",
        action: djAction,
        controller: "p1",
        status: "pending",
      };

      const truceReq: any = {
        id: "req-truce-combat",
        actionId: "action.truce",
        action: truceAction,
        controller: "p2",
        status: "pending",
        keyCards: [d7, d8],
        targets: [{ type: "request", requestId: "req-dj-combat", targetDefinitionId: "targetRequest" }],
      };

      const state: any = {
        stateVersion: 1,
        stage: { requests: [djReq, truceReq], history: [] },
        players: {
          p1: { hand: [], field: [attackerUnit], grave: [], life: [] },
          p2: { hand: [], field: [blockerUnit], grave: [], life: [p2LifeCard] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [d7, d8],
        targetRequest: djReq,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      registry.resolveRequest(truceReq, context);

      // Blocker was NOT destroyed (not moved to grave)
      expect(state.players.p2.field).toHaveLength(1);
      expect(state.players.p2.field[0].unitId).toBe("u-blk");

      // Attacker was NOT moved to grave
      expect(state.players.p1.field).toHaveLength(1);
      expect(state.players.p1.field[0].unitId).toBe("u-att");

      // Player B took 0 life damage (life count unchanged)
      expect(state.players.p2.life).toHaveLength(1);
      expect(state.players.p2.life[0].id).toBe("p2-l1");
    });
  });

  // =========================================================================
  // 7. Transient Battle State Cleanup & Attacker Preservation (Sections 14-17, 24)
  // =========================================================================
  describe("7. Transient Battle State Cleanup & Attacker Preservation (Sections 14-17, 24)", () => {
    it("7.1: Blocked Attack - both attacker.battle and blocker.battle are cleaned up, attacker drive state preserved", () => {
      const registry = new CommandRegistry();
      const d1 = { id: "c-d1", suit: "D", rank: "A", value: 1 };
      const d2 = { id: "c-d2", suit: "D", rank: "2", value: 2 };

      const attackerUnit: any = {
        unitId: "u-att",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "drive",
        cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
        battle: { role: "attacker", targetPlayerKey: "p2" },
      };

      const blockerUnit: any = {
        unitId: "u-blk",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }],
        battle: { role: "blocker", blocksUnitId: "u-att" },
      };

      const djReq: any = {
        id: "req-dj-b",
        actionId: "action.damageJudge",
        action: proRulePackage.actions.find((a) => a.id === "action.damageJudge")!,
        controller: "p1",
        status: "pending",
      };

      const truceReq: any = {
        id: "req-truce-b",
        actionId: "action.truce",
        action: truceAction,
        controller: "p2",
        status: "pending",
        keyCards: [d1, d2],
        targets: [{ type: "request", requestId: "req-dj-b", targetDefinitionId: "targetRequest" }],
      };

      const state: any = {
        stateVersion: 1,
        stage: { requests: [djReq, truceReq], history: [] },
        players: {
          p1: { hand: [], field: [attackerUnit], grave: [], life: [] },
          p2: { hand: [], field: [blockerUnit], grave: [], life: [] },
        },
      };

      // Before Truce
      expect(attackerUnit.battle).toBeDefined();
      expect(blockerUnit.battle).toBeDefined();

      const context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [d1, d2],
        targetRequest: djReq,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      registry.resolveRequest(truceReq, context);

      // After Truce: battle metadata cleaned up
      expect(attackerUnit.battle).toBeUndefined();
      expect(blockerUnit.battle).toBeUndefined();

      // Attacker remains in drive state (Attack not undone, no auto-recharge)
      expect(attackerUnit.state).toBe("drive");
      // Blocker remains in charge state
      expect(blockerUnit.state).toBe("charge");
    });

    it("7.2: Unblocked Attack - attacker.battle is cleaned up, attacker drive state preserved", () => {
      const registry = new CommandRegistry();
      const d1 = { id: "c-d1", suit: "D", rank: "A", value: 1 };
      const d2 = { id: "c-d2", suit: "D", rank: "2", value: 2 };

      const attackerUnit: any = {
        unitId: "u-att-unblk",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "drive",
        cards: [{ id: "c1", suit: "S", rank: "9", value: 9 }],
        battle: { role: "attacker", targetPlayerKey: "p2" },
      };

      const djReq: any = {
        id: "req-dj-ub",
        actionId: "action.damageJudge",
        action: proRulePackage.actions.find((a) => a.id === "action.damageJudge")!,
        controller: "p1",
        status: "pending",
      };

      const truceReq: any = {
        id: "req-truce-ub",
        actionId: "action.truce",
        action: truceAction,
        controller: "p2",
        status: "pending",
        keyCards: [d1, d2],
        targets: [{ type: "request", requestId: "req-dj-ub", targetDefinitionId: "targetRequest" }],
      };

      const state: any = {
        stateVersion: 1,
        stage: { requests: [djReq, truceReq], history: [] },
        players: {
          p1: { hand: [], field: [attackerUnit], grave: [], life: [] },
          p2: { hand: [], field: [], grave: [], life: [{ id: "l1", suit: "D", rank: "4", value: 4 }] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [d1, d2],
        targetRequest: djReq,
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      registry.resolveRequest(truceReq, context);

      expect(attackerUnit.battle).toBeUndefined();
      expect(attackerUnit.state).toBe("drive");
      expect(state.players.p2.life).toHaveLength(1);
    });

    it("7.3: cleanupTransientBattleState helper operates purely internally on state without card movements or log side effects", () => {
      const u1: any = { unitId: "u1", battle: { role: "attacker" } };
      const u2: any = { unitId: "u2", battle: { role: "blocker" } };
      const gEntry: any = { unitId: "g1", cards: [], battle: { role: "dead" } };

      const state: any = {
        players: {
          p1: { field: [u1], grave: [gEntry] },
          p2: { field: [u2], grave: [] },
        },
      };

      cleanupTransientBattleState(state);

      expect(u1.battle).toBeUndefined();
      expect(u2.battle).toBeUndefined();
      expect(gEntry.battle).toBeUndefined();
    });
  });

  // =========================================================================
  // 8. Cancelled Truce & Lost Target Contracts (Sections 25, 26)
  // =========================================================================
  describe("8. Cancelled Truce & Lost Target Contracts (Sections 25, 26)", () => {
    it("8.1: Cancelled Truce - DamageJudge remains pending, battle state remains, Truce cleanup does NOT run", () => {
      const d1 = { id: "c-d1", suit: "D", rank: "A", value: 1 };
      const d2 = { id: "c-d2", suit: "D", rank: "2", value: 2 };

      const attackerUnit: any = {
        unitId: "u-att",
        state: "drive",
        battle: { role: "attacker", targetPlayerKey: "p2" },
      };

      const djReq: any = {
        id: "req-dj",
        actionId: "action.damageJudge",
        action: proRulePackage.actions.find((a) => a.id === "action.damageJudge")!,
        controller: "p1",
        status: "pending",
      };

      const truceReq: any = {
        id: "req-truce",
        actionId: "action.truce",
        action: truceAction,
        controller: "p2",
        status: "pending",
        keyCards: [d1, d2],
        targets: [{ type: "request", requestId: "req-dj", targetDefinitionId: "targetRequest" }],
      };

      const state: any = {
        stateVersion: 1,
        stage: { requests: [djReq, truceReq], history: [] },
        players: {
          p1: { hand: [], field: [attackerUnit], grave: [], life: [] },
          p2: { hand: [], field: [], grave: [], life: [] },
        },
      };

      const registry = new CommandRegistry();
      const context: CommandContext = {
        state,
        playerKey: "p1",
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      // Cancel Truce request (e.g. countered by another action)
      cancelStageRequest("req-truce", context, registry.getEffectInterpreter());

      expect(truceReq.status).toBe("cancelled");
      expect(state.stage.history).toContain(truceReq);

      // DamageJudge remains pending on stage
      expect(state.stage.requests).toHaveLength(1);
      expect(state.stage.requests[0].id).toBe("req-dj");
      expect(djReq.status).toBe("pending");

      // Attacker battle metadata MUST remain intact
      expect(attackerUnit.battle).toBeDefined();
      expect(attackerUnit.battle.role).toBe("attacker");
    });

    it("8.2: Lost Target - DamageJudge removed before Truce resolves -> Truce resolves safely with no effect, no cleanup, no crash", () => {
      const registry = new CommandRegistry();
      const d1 = { id: "c-d1", suit: "D", rank: "A", value: 1 };
      const d2 = { id: "c-d2", suit: "D", rank: "2", value: 2 };

      const attackerUnit: any = {
        unitId: "u-att",
        state: "drive",
        battle: { role: "attacker", targetPlayerKey: "p2" },
      };

      const truceReq: any = {
        id: "req-truce",
        actionId: "action.truce",
        action: truceAction,
        controller: "p2",
        status: "pending",
        keyCards: [d1, d2],
        targets: [{ type: "request", requestId: "req-dj-already-gone", targetDefinitionId: "targetRequest" }],
      };

      const state: any = {
        stateVersion: 1,
        stage: { requests: [truceReq], history: [] },
        players: {
          p1: { hand: [], field: [attackerUnit], grave: [], life: [] },
          p2: { hand: [], field: [], grave: [], life: [] },
        },
      };

      const context: CommandContext = {
        state,
        playerKey: "p2",
        keyCards: [d1, d2],
        actions: proRulePackage.actions,
        components: proRulePackage.components,
      };

      // Resolve Truce whose target is missing from stage
      const result = registry.resolveRequest(truceReq, context);
      expect(result.type).toBe("COMPLETED");
      expect(truceReq.status).toBe("resolved");

      // Truce key cards finalized to grave
      expect(state.players.p2.grave.map((c: any) => c.id)).toEqual(["c-d1", "c-d2"]);

      // Attacker battle was NOT cleaned by Truce (since effect skipped due to invalid target)
      expect(attackerUnit.battle).toBeDefined();
    });
  });

  // =========================================================================
  // 9. GameSession End-to-End & Full Triggered Combat (Sections 29, 31, 33)
  // =========================================================================
  describe("9. GameSession End-to-End & Full Triggered Combat Integration (Sections 29, 31, 33)", () => {
    it("9.1: Full Triggered Flow - Attack -> Block -> DamageJudge triggered -> Truce interrupts -> DamageJudge cancelled", () => {
      const d1 = { id: "p2-d1", suit: "D", rank: "A", value: 1 };
      const d2 = { id: "p2-d2", suit: "D", rank: "2", value: 2 };

      const attacker: any = {
        unitId: "u-p1-att",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c-att", suit: "S", rank: "8", value: 8 }],
        labels: ["攻撃", "防御"],
      };

      const blocker: any = {
        unitId: "u-p2-blk",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c-blk", suit: "C", rank: "3", value: 3 }],
        labels: ["防御"],
      };

      const state: any = {
        stateVersion: 1,
        matchId: "match-truce-e2e",
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        turnUsage: { p1: {}, p2: {} },
        players: {
          p1: {
            hand: [],
            field: [attacker],
            life: [{ id: "l-p1", suit: "H", rank: "5", value: 5 }],
            grave: [],
          },
          p2: {
            hand: [d1, d2],
            field: [blocker],
            life: [{ id: "l-p2", suit: "D", rank: "9", value: 9 }],
            grave: [],
          },
        },
      };

      const session = new GameSession(state, proRulePackage);

      const findActionIdx = (req: any, actionId: string): number => {
        return req.patterns.findIndex((p: any) => {
          if (p.actionSelectionRef === undefined) return false;
          const act = req.catalog.actions[p.actionSelectionRef];
          return act?.actionId === actionId;
        });
      };

      const findPassIdx = (req: any): number => {
        return req.patterns.findIndex((p: any) => p.kind === "PASS");
      };

      // Step 1: Advance -> p1 declares Attack
      let step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p1");

      const attIdx = findActionIdx(step.request, "action.attack");
      expect(attIdx).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: attIdx,
      });

      // p1 PASS on Attack
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p1");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: findPassIdx(step.request),
      });

      // p2 PASS on Attack -> Attack resolves -> EFFECT_RESOLUTION (select attackers)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p2");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: findPassIdx(step.request),
      });

      // Attack selection (select u-p1-att)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("EFFECT_RESOLUTION");
      const selectAtkPattern = step.request.patterns.findIndex((p: any) => {
        const sel = step.request.catalog.effectSelections[p.effectSelectionRef!];
        return Array.isArray(sel?.selectedValues) && sel.selectedValues.includes("u-p1-att");
      });
      expect(selectAtkPattern).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: selectAtkPattern,
      });

      // Step 2: Block is triggered and moves to Stage -> Chance is with p1
      expect(session.state.stage.requests.length).toBe(1);
      expect(session.state.stage.requests[0].actionId).toBe("action.block");

      // p1 PASS on Block chance
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p1");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: findPassIdx(step.request),
      });

      // p2 PASS on Block chance -> Block resolves -> EFFECT_RESOLUTION (select blocker)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p2");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: findPassIdx(step.request),
      });

      // Block selection (assign u-p2-blk to u-p1-att)
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source?.type).toBe("EFFECT_RESOLUTION");
      const blockAssignmentPattern = step.request.patterns.findIndex((p: any) => {
        const sel = step.request.catalog.effectSelections[p.effectSelectionRef!];
        return (
          Array.isArray(sel?.assignments) &&
          sel.assignments.some(
            (a: any) => a.sourceUnitId === "u-p1-att" && a.selectedUnitIds.includes("u-p2-blk")
          )
        );
      });
      expect(blockAssignmentPattern).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: blockAssignmentPattern,
      });

      // Step 3: DamageJudge is triggered and moved to Stage!
      expect(session.state.stage.requests.some((r: any) => r.actionId === "action.damageJudge")).toBe(true);

      // Chance is currently with p1 -> p1 PASS
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p1");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: findPassIdx(step.request),
      });

      // Chance passes to p2 -> p2 declares Truce!
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p2");
      const trucePatternIdx = findActionIdx(step.request, "action.truce");
      expect(trucePatternIdx).toBeGreaterThanOrEqual(0);

      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: trucePatternIdx,
      });

      // Truce is now on Stage on top of DamageJudge!
      expect(session.state.stage.requests.length).toBe(2);
      expect(session.state.stage.requests[1].actionId).toBe("action.truce");

      // Truce declaration chance: p2 PASS, then p1 PASS -> Truce resolves
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p2");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: findPassIdx(step.request),
      });

      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.playerId).toBe("p1");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: findPassIdx(step.request),
      });

      // Outcomes:
      // 1. DamageJudge was cancelled (NOT resolved)
      const djHistory = session.state.stage.history.find((r: any) => r.actionId === "action.damageJudge");
      expect(djHistory).toBeDefined();
      expect(djHistory.status).toBe("cancelled");

      // 2. Truce was resolved
      const truceHistory = session.state.stage.history.find((r: any) => r.actionId === "action.truce");
      expect(truceHistory).toBeDefined();
      expect(truceHistory.status).toBe("resolved");

      // 3. Battle state is completely cleaned up
      expect(attacker.battle).toBeUndefined();
      expect(blocker.battle).toBeUndefined();

      // 4. No units moved to grave from combat (both still on field)
      expect(session.state.players.p1.field).toHaveLength(1);
      expect(session.state.players.p2.field).toHaveLength(1);

      // 5. Truce key cards in p2 grave
      expect(session.state.players.p2.grave.map((c: any) => c.id)).toContain("p2-d1");
      expect(session.state.players.p2.grave.map((c: any) => c.id)).toContain("p2-d2");

      // 6. Game continues legally (not finished, both players have life)
      expect(step.type).not.toBe("FINISHED");
      expect(session.state.players.p1.life.length).toBeGreaterThan(0);
      expect(session.state.players.p2.life.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 10. Engine Non-Hardcoding & Scope Guards (Sections 18, 37, 40)
  // =========================================================================
  describe("10. Engine Non-Hardcoding & Scope Guards (Sections 18, 37, 40)", () => {
    it("10.1: Counter action remains backward compatible and unaffected by actionId support", () => {
      const counterAction = proRulePackage.actions.find((a) => a.id === "action.counter")!;
      expect(counterAction).toBeDefined();

      const stageReq = {
        id: "req-up-c",
        actionId: "action.up",
        status: "pending",
        keyCards: [{ id: "k1", rankValue: 4 }],
        controller: "p1",
      };

      const state: any = {
        stage: { requests: [stageReq] },
        players: { p1: {}, p2: {} },
      };

      const targets = TargetSelectionEnumerator.enumerateTargets(
        counterAction,
        state,
        "p2"
      );
      expect(targets).toHaveLength(1);
      expect(targets[0].targetRequestId).toBe("req-up-c");
    });

    it("10.2: pro:rarePack remains simulatorImplemented: false (unimplemented Pro actions remain)", async () => {
      const catalog = await loadRegulationCatalog();
      const proRarePack = await getRegulation("pro-rarePack");
      expect(proRarePack).toBeDefined();
      expect(proRarePack.formatId).toBe("pro");
      expect(proRarePack.frameId).toBe("rarePack");

      const validation = RegulationValidator.validateRegulation(catalog, "pro-rarePack");
      expect(validation.simulatorImplemented).toBe(false);
    });
  });
});
