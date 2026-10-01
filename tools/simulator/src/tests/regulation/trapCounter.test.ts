import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory, clearRulePackageCache } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { MatchLogRecorder } from "../../engine/log/MatchLogRecorder";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { matchRequestKeyCardsHandler } from "../../engine/rules/commandHandlers";
import { isSamePrintedCard, normalizeSuit, isJokerCard } from "../../engine/rules/cardUtils";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { STANDARD_54_DECK_CARDS } from "../../engine/regulation/SimulatorDeckProfileResolver";
import {
  getRegulation,
  getFrame,
  getFormat,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { CoreFlowCoordinator } from "../../engine/session/CoreFlowCoordinator";
import { PassTracker } from "../../engine/session/PassTracker";
import { parse } from "yaml";
import * as fs from "fs";

describe("Trap Counter (action.trapCounter) Comprehensive Tests [BP-SIM-REG-4.0-D-TRAP-COUNTER]", () => {
  let rulePackage: RulePackage;
  let rarePackRulePackage: RulePackage;
  let registry: CommandRegistry;
  let validator: ActionRequestValidator;
  let trapAction: ActionDefinition;

  beforeAll(async () => {
    clearRegulationCache();
    clearRulePackageCache();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    registry = new CommandRegistry();
    validator = new ActionRequestValidator();
    trapAction = rulePackage.actions.find((a) => a.id === "action.trapCounter")!;

    const standardFormat = await getFormat("standard");
    const rarePackFrame = await getFrame("rarePack");
    const standardRarePackReg = await getRegulation("standard-rarePack");
    rarePackRulePackage = RegulationRulePackageSelector.selectRulePackage(
      rulePackage,
      standardFormat,
      standardRarePackReg,
      rarePackFrame
    );
  });

  // A. Rule Definition
  it("A: Rule Definition verifies action.trapCounter specification", () => {
    expect(trapAction).toBeDefined();
    expect(trapAction.name).toBe("罠カウンター");
    expect(trapAction.ruby).toBe("わなかうんたー");
    expect(trapAction.type).toBe("rareCardOperation");

    expect(trapAction.request.trigger).toBe("direct");
    expect(trapAction.request.speed).toBe("immediate");
    expect(trapAction.request.timing).toBe("quick");

    expect(trapAction.cost).toBeUndefined();

    expect(trapAction.key).toBeDefined();
    expect(trapAction.key?.count).toBe(1);
    expect(trapAction.key?.condition?.card?.zone).toBe("rare");
    expect(trapAction.key?.visibilityOnRequest).toBeUndefined();

    expect(trapAction.activationCondition).toBeUndefined();

    expect(trapAction.targets).toBeDefined();
    expect(trapAction.targets?.length).toBe(1);
    const target = trapAction.targets![0];
    expect(target.id).toBe("targetRequest");
    expect(target.type).toBe("request");
    expect(target.condition?.status).toBe("pending");
    expect(target.condition?.keyCards?.count).toEqual([1, 2]);
  });

  // B. Frame Integration
  it("B: Frame integration verifies rarePack contains trapCounter and pack does not", () => {
    const rarePackYaml = fs.readFileSync(
      path.resolve(__dirname, "../../data/regulations/frames/rarePack.yaml"),
      "utf-8"
    );
    const rarePack = parse(rarePackYaml);
    expect(rarePack.actions).toContain("action.packOpen");
    expect(rarePack.actions).toContain("action.rareDraw");
    expect(rarePack.actions).toContain("action.rareSummon");
    expect(rarePack.actions).toContain("action.trapCounter");

    const packYaml = fs.readFileSync(
      path.resolve(__dirname, "../../data/regulations/frames/pack.yaml"),
      "utf-8"
    );
    const pack = parse(packYaml);
    expect(pack.actions).not.toContain("action.trapCounter");
  });

  // C. Life Condition
  it("C: Trap Counter is legal regardless of life count (15, 10, 9, 1)", () => {
    for (const lifeCount of [15, 10, 9, 1]) {
      const rareCard = { id: "rare-1", suit: "S", rank: "7", value: 7 };
      const pendingReq = {
        id: "req-pending-1",
        actionId: "action.up",
        controller: "p2",
        status: "pending",
        keyCards: [{ id: "c-target-1", suit: "S", rank: "7", value: 7 }],
      };

      const state: any = {
        turnPlayer: "p2",
        chancePlayer: "p1",
        players: {
          p1: {
            name: "Player A",
            rareCards: [rareCard],
            hand: [],
            life: Array.from({ length: lifeCount }, (_, i) => ({ id: `l-${i}`, suit: "H", rank: "2", value: 2 })),
            grave: [],
            field: [],
          },
          p2: {
            name: "Player B",
            rareCards: [],
            hand: [],
            life: [],
            grave: [],
            field: [],
          },
        },
        stage: {
          requests: [pendingReq],
          history: [],
        },
      };

      const result = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
      const trapPatterns = result.request.patterns.filter(
        (p) => p.kind === "ACTION" && result.request.catalog.actions[p.actionSelectionRef!].actionId === "action.trapCounter"
      );
      expect(trapPatterns.length).toBeGreaterThan(0);
    }
  });

  // D. No Rare
  it("D: Stage has legal target, but rareCards = [] produces no pattern and validator fails", () => {
    const pendingReq = {
      id: "req-pending-1",
      actionId: "action.up",
      controller: "p2",
      status: "pending",
      keyCards: [{ id: "c-target-1", suit: "S", rank: "7", value: 7 }],
    };

    const state: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          rareCards: [], // Empty
          hand: [],
          life: [],
          grave: [],
          field: [],
        },
        p2: {
          name: "Player B",
          rareCards: [],
          hand: [],
          life: [],
          grave: [],
          field: [],
        },
      },
      stage: {
        requests: [pendingReq],
        history: [],
      },
    };

    const result = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    const trapPatterns = result.request.patterns.filter(
      (p) => p.kind === "ACTION" && result.request.catalog.actions[p.actionSelectionRef!].actionId === "action.trapCounter"
    );
    expect(trapPatterns.length).toBe(0);

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [{ id: "phantom-rare", suit: "S", rank: "7", value: 7 }],
      targetRequest: pendingReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => validator.validateActionRequest(trapAction, context)).toThrow(ValidationError);
  });

  // E. No Target
  it("E: Stage empty or no 1/2 keyCards pending request produces no pattern", () => {
    const rareCard = { id: "rare-1", suit: "S", rank: "7", value: 7 };

    // Case 1: Stage empty
    const stateEmpty: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [rareCard], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: { requests: [], history: [] },
    };

    const resEmpty = LegalPatternGenerator.generateActionRequestDecision(stateEmpty, "p1", rulePackage);
    const trapEmpty = resEmpty.request.patterns.filter(
      (p) => p.kind === "ACTION" && resEmpty.request.catalog.actions[p.actionSelectionRef!].actionId === "action.trapCounter"
    );
    expect(trapEmpty.length).toBe(0);

    // Case 2: Stage has pending request with 0 keyCards
    const stateZeroKey: any = {
      ...stateEmpty,
      stage: {
        requests: [
          { id: "req-0", actionId: "action.draw", controller: "p2", status: "pending", keyCards: [] },
        ],
        history: [],
      },
    };
    const resZero = LegalPatternGenerator.generateActionRequestDecision(stateZeroKey, "p1", rulePackage);
    const trapZero = resZero.request.patterns.filter(
      (p) => p.kind === "ACTION" && resZero.request.catalog.actions[p.actionSelectionRef!].actionId === "action.trapCounter"
    );
    expect(trapZero.length).toBe(0);

    // Case 3: Stage has pending request with 3 keyCards
    const stateThreeKey: any = {
      ...stateEmpty,
      stage: {
        requests: [
          {
            id: "req-3",
            actionId: "action.throwing",
            controller: "p2",
            status: "pending",
            keyCards: [
              { id: "k1", suit: "S", rank: "2", value: 2 },
              { id: "k2", suit: "S", rank: "3", value: 3 },
              { id: "k3", suit: "S", rank: "4", value: 4 },
            ],
          },
        ],
        history: [],
      },
    };
    const resThree = LegalPatternGenerator.generateActionRequestDecision(stateThreeKey, "p1", rulePackage);
    const trapThree = resThree.request.patterns.filter(
      (p) => p.kind === "ACTION" && resThree.request.catalog.actions[p.actionSelectionRef!].actionId === "action.trapCounter"
    );
    expect(trapThree.length).toBe(0);
  });

  // F. Target Count
  it("F: Target count validation accepts 1 or 2 keyCards, rejects 0 and 3", () => {
    const rareCard = { id: "rare-1", suit: "S", rank: "7", value: 7 };

    const makeStateWithReq = (keyCards: any[]) => ({
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [rareCard], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [
          { id: "req-test", actionId: "action.test", controller: "p2", status: "pending", keyCards },
        ],
        history: [],
      },
    });

    const c1 = { id: "c1", suit: "H", rank: "5", value: 5 };
    const c2 = { id: "c2", suit: "D", rank: "6", value: 6 };
    const c3 = { id: "c3", suit: "C", rank: "7", value: 7 };

    // 0 keyCards
    const s0 = makeStateWithReq([]);
    const t0 = TargetSelectionEnumerator.enumerateTargets(trapAction, s0, "p1", rulePackage.components);
    expect(t0.length).toBe(0);
    expect(() =>
      validator.validateActionRequest(trapAction, {
        state: s0,
        playerKey: "p1",
        keyCards: [rareCard],
        targetRequest: s0.stage.requests[0] as any,
        actions: rulePackage.actions,
        components: rulePackage.components,
      })
    ).toThrow(ValidationError);

    // 1 keyCard
    const s1 = makeStateWithReq([c1]);
    const t1 = TargetSelectionEnumerator.enumerateTargets(trapAction, s1, "p1", rulePackage.components);
    expect(t1.length).toBe(1);
    expect(() =>
      validator.validateActionRequest(trapAction, {
        state: s1,
        playerKey: "p1",
        keyCards: [rareCard],
        targetRequest: s1.stage.requests[0] as any,
        actions: rulePackage.actions,
        components: rulePackage.components,
      })
    ).not.toThrow();

    // 2 keyCards
    const s2 = makeStateWithReq([c1, c2]);
    const t2 = TargetSelectionEnumerator.enumerateTargets(trapAction, s2, "p1", rulePackage.components);
    expect(t2.length).toBe(1);
    expect(() =>
      validator.validateActionRequest(trapAction, {
        state: s2,
        playerKey: "p1",
        keyCards: [rareCard],
        targetRequest: s2.stage.requests[0] as any,
        actions: rulePackage.actions,
        components: rulePackage.components,
      })
    ).not.toThrow();

    // 3 keyCards
    const s3 = makeStateWithReq([c1, c2, c3]);
    const t3 = TargetSelectionEnumerator.enumerateTargets(trapAction, s3, "p1", rulePackage.components);
    expect(t3.length).toBe(0);
    expect(() =>
      validator.validateActionRequest(trapAction, {
        state: s3,
        playerKey: "p1",
        keyCards: [rareCard],
        targetRequest: s3.stage.requests[0] as any,
        actions: rulePackage.actions,
        components: rulePackage.components,
      })
    ).toThrow(ValidationError);
  });

  // G. One Key Match
  it("G: 1-key match cancels target request, removes from stage, target key to grave, trap rare to grave", () => {
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const targetKey = { id: "hand-s7-2", suit: "S", rank: "7", value: 7 }; // Different physical ID

    const targetReq = {
      id: "req-up-1",
      actionId: "action.up",
      controller: "p2",
      status: "pending",
      keyCards: [targetKey],
    };

    const state: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const request = registry.createRequest(trapAction, context);
    expect(request.status).toBe("pending");
    // Trap Counter is immediate -> not placed on stage
    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0]).toBe(targetReq);
    expect(state.players.p1.rareCards).toHaveLength(0);

    const resolveRes = registry.resolveRequest(request, context);
    expect(resolveRes.type).toBe("COMPLETED");

    // Target request is cancelled and popped from stage
    expect(state.stage.requests).toHaveLength(0);
    expect(targetReq.status).toBe("cancelled");
    expect(state.stage.history).toContain(targetReq);

    // Target key card moved to p2's grave
    expect(state.players.p2.grave).toContainEqual(targetKey);

    // Trap Rare moved to p1's grave
    expect(state.players.p1.grave).toContainEqual(trapRare);
    expect(request.status).toBe("resolved");
  });

  // H1 & H2. One Key Mismatch
  it("H1: 1-key mismatch (suit difference: Rare ♠7 vs Target ♡7) keeps target pending, resolves trap counter", () => {
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const targetKey = { id: "hand-h7-1", suit: "H", rank: "7", value: 7 }; // Different suit

    const targetReq = {
      id: "req-up-1",
      actionId: "action.up",
      controller: "p2",
      status: "pending",
      keyCards: [targetKey],
    };

    const state: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const request = registry.createRequest(trapAction, context);
    const resolveRes = registry.resolveRequest(request, context);
    expect(resolveRes.type).toBe("COMPLETED");

    // Target remains pending on Stage
    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0]).toBe(targetReq);
    expect(targetReq.status).toBe("pending");
    expect(state.players.p2.grave).toHaveLength(0);

    // Trap Counter itself resolved and rare card in grave
    expect(request.status).toBe("resolved");
    expect(state.players.p1.grave).toContainEqual(trapRare);
    expect(context.results?.["trapMatch"]).toBe(false);
  });

  it("H2: 1-key mismatch (rank difference: Rare ♠7 vs Target ♠8) keeps target pending, resolves trap counter", () => {
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const targetKey = { id: "hand-s8-1", suit: "S", rank: "8", value: 8 }; // Different rank

    const targetReq = {
      id: "req-up-1",
      actionId: "action.up",
      controller: "p2",
      status: "pending",
      keyCards: [targetKey],
    };

    const state: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const request = registry.createRequest(trapAction, context);
    const resolveRes = registry.resolveRequest(request, context);
    expect(resolveRes.type).toBe("COMPLETED");

    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0].status).toBe("pending");
    expect(state.players.p2.grave).toHaveLength(0);

    expect(request.status).toBe("resolved");
    expect(state.players.p1.grave).toContainEqual(trapRare);
    expect(context.results?.["trapMatch"]).toBe(false);
  });

  // I1 & I2. Two Key Match
  it("I1: 2-key match (1st key matches: Rare ♠7 vs Target [♠7, ♢Q]) cancels target", () => {
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const k1 = { id: "hand-s7-1", suit: "S", rank: "7", value: 7 };
    const k2 = { id: "hand-dq-1", suit: "D", rank: "Q", value: 12 };

    const targetReq = {
      id: "req-throwing-1",
      actionId: "action.throwing",
      controller: "p2",
      status: "pending",
      keyCards: [k1, k2],
    };

    const state: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const request = registry.createRequest(trapAction, context);
    registry.resolveRequest(request, context);

    expect(state.stage.requests).toHaveLength(0);
    expect(targetReq.status).toBe("cancelled");
    expect(state.players.p2.grave).toContainEqual(k1);
    expect(state.players.p2.grave).toContainEqual(k2);
    expect(context.results?.["trapMatch"]).toBe(true);
  });

  it("I2: 2-key match (2nd key matches: Rare ♠7 vs Target [♡4, ♠7]) cancels target", () => {
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const k1 = { id: "hand-h4-1", suit: "H", rank: "4", value: 4 };
    const k2 = { id: "hand-s7-1", suit: "S", rank: "7", value: 7 };

    const targetReq = {
      id: "req-throwing-1",
      actionId: "action.throwing",
      controller: "p2",
      status: "pending",
      keyCards: [k1, k2],
    };

    const state: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const request = registry.createRequest(trapAction, context);
    registry.resolveRequest(request, context);

    expect(state.stage.requests).toHaveLength(0);
    expect(targetReq.status).toBe("cancelled");
    expect(state.players.p2.grave).toContainEqual(k1);
    expect(state.players.p2.grave).toContainEqual(k2);
    expect(context.results?.["trapMatch"]).toBe(true);
  });

  // J. Two Key Mismatch
  it("J: 2-key mismatch (Rare ♠7 vs Target [♡7, ♢7]) results in no-op, not unconditional cancel", () => {
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const k1 = { id: "hand-h7-1", suit: "H", rank: "7", value: 7 };
    const k2 = { id: "hand-d7-1", suit: "D", rank: "7", value: 7 };

    const targetReq = {
      id: "req-throwing-1",
      actionId: "action.throwing",
      controller: "p2",
      status: "pending",
      keyCards: [k1, k2],
    };

    const state: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const request = registry.createRequest(trapAction, context);
    registry.resolveRequest(request, context);

    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0]).toBe(targetReq);
    expect(targetReq.status).toBe("pending");
    expect(state.players.p2.grave).toHaveLength(0);
    expect(context.results?.["trapMatch"]).toBe(false);
  });

  // K. Joker Match
  it("K: Joker match with different physical IDs matches correctly", () => {
    const rareJoker = { id: "rare-jk-1", suit: "J", rank: "Joker" };
    const targetJoker = { id: "target-jk-2", suit: "J", rank: "Joker" };

    const targetReq = {
      id: "req-joker-action",
      actionId: "action.up",
      controller: "p2",
      status: "pending",
      keyCards: [targetJoker],
    };

    const state: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [rareJoker], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [rareJoker],
      keyCard: rareJoker,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const request = registry.createRequest(trapAction, context);
    registry.resolveRequest(request, context);

    expect(state.stage.requests).toHaveLength(0);
    expect(targetReq.status).toBe("cancelled");
    expect(state.players.p2.grave).toContainEqual(targetJoker);
    expect(state.players.p1.grave).toContainEqual(rareJoker);
    expect(context.results?.["trapMatch"]).toBe(true);
  });

  // L. Immediate Semantics
  it("L: Trap Counter is immediate: not pushed to stage, no opponent interruption, immediate resolve", () => {
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const targetKey = { id: "target-s7-1", suit: "S", rank: "7", value: 7 };

    const targetReq = {
      id: "req-up-1",
      actionId: "action.up",
      controller: "p2",
      status: "pending",
      keyCards: [targetKey],
    };

    const state: any = {
      matchId: "match-trap-imm",
      stateVersion: 1,
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const gen = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    const trapPattern = gen.request.patterns.find(
      (p) => p.kind === "ACTION" && gen.request.catalog.actions[p.actionSelectionRef!].actionId === "action.trapCounter"
    )!;
    expect(trapPattern).toBeDefined();

    const passTracker = new PassTracker();
    const patternIndex = gen.request.patterns.indexOf(trapPattern);
    const flowResult = CoreFlowCoordinator.applyDecision(
      gen.request,
      { decisionId: gen.request.decisionId, stateVersion: gen.request.stateVersion, selectedPatternRef: patternIndex },
      state,
      rulePackage,
      registry,
      passTracker
    );

    expect(flowResult.type).toBe("IMMEDIATE_ACTION_RESOLVED");
    if (flowResult.type === "IMMEDIATE_ACTION_RESOLVED") {
      expect(flowResult.actionRequest.actionId).toBe("action.trapCounter");
      expect(flowResult.actionRequest.status).toBe("resolved");
    }

    // Trap counter request was never on stage
    expect(state.stage.requests).not.toContainEqual(expect.objectContaining({ actionId: "action.trapCounter" }));
    // Target request was cancelled
    expect(state.stage.requests).toHaveLength(0);
    expect(targetReq.status).toBe("cancelled");
  });

  // M. Non-TOP Target
  it("M: Cancelling non-TOP request preserves relative order of remaining stage requests", () => {
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };

    const reqA = { id: "req-A", actionId: "action.attack", controller: "p2", status: "pending", keyCards: [{ id: "kA", suit: "H", rank: "2", value: 2 }] };
    const reqB = { id: "req-B", actionId: "action.up", controller: "p2", status: "pending", keyCards: [{ id: "kB", suit: "S", rank: "7", value: 7 }] };
    const reqC = { id: "req-C", actionId: "action.twist", controller: "p2", status: "pending", keyCards: [{ id: "kC", suit: "D", rank: "3", value: 3 }] };

    const state: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [reqA, reqB, reqC], // reqC is TOP
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: reqB as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const request = registry.createRequest(trapAction, context);
    registry.resolveRequest(request, context);

    expect(reqB.status).toBe("cancelled");
    expect(state.stage.requests).toHaveLength(2);
    expect(state.stage.requests[0]).toBe(reqA);
    expect(state.stage.requests[1]).toBe(reqC); // reqC remains TOP, order preserved!
  });

  // N. Own Request Targetability
  it("N: Player can target their own pending request on stage", () => {
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const ownKey = { id: "hand-s7-own", suit: "S", rank: "7", value: 7 };

    // Player A's own pending request on stage
    const ownReq = {
      id: "req-own-up",
      actionId: "action.up",
      controller: "p1", // Own controller
      status: "pending",
      keyCards: [ownKey],
    };

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [ownReq],
        history: [],
      },
    };

    // TargetSelectionEnumerator includes own request
    const targets = TargetSelectionEnumerator.enumerateTargets(trapAction, state, "p1", rulePackage.components);
    expect(targets.some((t) => t.targetRequestId === "req-own-up")).toBe(true);

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: ownReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(trapAction, context)).not.toThrow();

    const request = registry.createRequest(trapAction, context);
    registry.resolveRequest(request, context);

    expect(ownReq.status).toBe("cancelled");
    expect(state.stage.requests).toHaveLength(0);
    expect(state.players.p1.grave).toContainEqual(ownKey);
    expect(state.players.p1.grave).toContainEqual(trapRare);
  });

  // O. Canonical Logs on Match
  it("O: Canonical logs on match records accurate lifecycle events and no stage.pushed for Trap Counter", () => {
    const logRecorder = new MatchLogRecorder({ matchId: "log-match-1" });
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const targetKey = { id: "target-s7-1", suit: "S", rank: "7", value: 7 };

    const targetReq = {
      id: "req-up-1",
      actionId: "action.up",
      controller: "p2",
      status: "pending",
      keyCards: [targetKey],
    };

    const state: any = {
      matchId: "log-match-1",
      stateVersion: 1,
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
      logRecorder,
    };

    const request = registry.createRequest(trapAction, context);
    registry.resolveRequest(request, context);

    const events = logRecorder.getEvents();

    // Trap Counter itself: request.created, request.resolve.started, request.resolved
    const trapCreated = events.find((e: any) => e.type === "request.created" && e.actionRef === "action.trapCounter");
    expect(trapCreated).toBeDefined();

    const trapStarted = events.find((e: any) => e.type === "request.resolve.started" && e.actionRef === "action.trapCounter");
    expect(trapStarted).toBeDefined();

    const trapResolved = events.find((e: any) => e.type === "request.resolved" && e.actionRef === "action.trapCounter");
    expect(trapResolved).toBeDefined();

    // Trap Counter: NO stage.pushed
    const trapPushed = events.find((e: any) => e.type === "stage.pushed" && e.actionRef === "action.trapCounter");
    expect(trapPushed).toBeUndefined();

    // Target Request: stage.popped, request.cancelled
    const targetPopped = events.find((e: any) => e.type === "stage.popped" && e.requestId === "req-up-1");
    expect(targetPopped).toBeDefined();

    const targetCancelled = events.find((e: any) => e.type === "request.cancelled" && e.requestId === "req-up-1");
    expect(targetCancelled).toBeDefined();
    expect((targetCancelled as any).reason).toBe("countered");
  });

  // P. Canonical Logs on Mismatch
  it("P: Canonical logs on mismatch does NOT emit target request.cancelled or stage.popped", () => {
    const logRecorder = new MatchLogRecorder({ matchId: "log-match-2" });
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const targetKey = { id: "target-h7-1", suit: "H", rank: "7", value: 7 }; // Mismatch

    const targetReq = {
      id: "req-up-1",
      actionId: "action.up",
      controller: "p2",
      status: "pending",
      keyCards: [targetKey],
    };

    const state: any = {
      matchId: "log-match-2",
      stateVersion: 1,
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
      logRecorder,
    };

    const request = registry.createRequest(trapAction, context);
    registry.resolveRequest(request, context);

    const events = logRecorder.getEvents();

    // Target request logs should NOT be emitted
    const targetCancelled = events.find((e: any) => e.type === "request.cancelled" && e.requestId === "req-up-1");
    expect(targetCancelled).toBeUndefined();

    const targetPopped = events.find((e: any) => e.type === "stage.popped" && e.requestId === "req-up-1");
    expect(targetPopped).toBeUndefined();

    // Trap Counter own lifecycle is completed
    const trapResolved = events.find((e: any) => e.type === "request.resolved" && e.actionRef === "action.trapCounter");
    expect(trapResolved).toBeDefined();
  });

  // Q. Visibility / No Reveal
  it("Q: Trap Counter does not have visibilityOnRequest: public and does not emit card.revealed", () => {
    expect(trapAction.key?.visibilityOnRequest).toBeUndefined();

    const logRecorder = new MatchLogRecorder({ matchId: "log-match-3" });
    const trapRare = { id: "rare-s7-1", suit: "S", rank: "7", value: 7 };
    const targetKey = { id: "target-s7-1", suit: "S", rank: "7", value: 7 };

    const targetReq = {
      id: "req-up-1",
      actionId: "action.up",
      controller: "p2",
      status: "pending",
      keyCards: [targetKey],
    };

    const state: any = {
      matchId: "log-match-3",
      stateVersion: 1,
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", rareCards: [trapRare], hand: [], life: [], grave: [], field: [] },
        p2: { name: "Player B", rareCards: [], hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
      logRecorder,
    };

    const request = registry.createRequest(trapAction, context);
    registry.resolveRequest(request, context);

    const events = logRecorder.getEvents();
    const revealedEvents = events.filter((e: any) => e.type === "card.revealed");
    expect(revealedEvents).toHaveLength(0);
  });

  // R. 54-card Conservation
  it("R: 54-card conservation holds before, during transient state, and after Trap Counter resolution", async () => {
    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rarePackRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const state = outcome.state;
    // Verify 54 cards at start
    OfficialRegulationMatchSetup.verifyCardConservation("p1", state.players.p1, STANDARD_54_DECK_CARDS, state);
    OfficialRegulationMatchSetup.verifyCardConservation("p2", state.players.p2, STANDARD_54_DECK_CARDS, state);

    // Give p2 a card from hand to create an Up request on stage
    const p2Card = state.players.p2.hand.pop();
    const targetReq = {
      id: "req-p2-up",
      actionId: "action.up",
      controller: "p2",
      status: "pending",
      keyCards: [p2Card],
    };
    state.stage.requests.push(targetReq);

    // Verify conservation while targetReq is on stage
    OfficialRegulationMatchSetup.verifyCardConservation("p2", state.players.p2, STANDARD_54_DECK_CARDS, state);

    const trapRare = state.players.p1.rareCards[0];
    expect(trapRare).toBeDefined();

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [trapRare],
      keyCard: trapRare,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1. Transient state: createRequest called, before resolveRequest
    const request = registry.createRequest(trapAction, context);

    // During transient state, Trap Counter is immediate and not on stage, so its keyCards are passed as additionalCards
    OfficialRegulationMatchSetup.verifyCardConservation(
      "p1",
      state.players.p1,
      STANDARD_54_DECK_CARDS,
      request.keyCards
    );
    OfficialRegulationMatchSetup.verifyCardConservation("p2", state.players.p2, STANDARD_54_DECK_CARDS, state);

    // 2. Resolve request
    registry.resolveRequest(request, context);

    // Fully resolved: Trap rare is now in p1 grave, target key card is in p2 grave (if match) or on stage (if mismatch)
    OfficialRegulationMatchSetup.verifyCardConservation("p1", state.players.p1, STANDARD_54_DECK_CARDS, state);
    OfficialRegulationMatchSetup.verifyCardConservation("p2", state.players.p2, STANDARD_54_DECK_CARDS, state);
  });

  // Amendment 1 & 2: Fail-closed and Generic Binding
  describe("Amendments 1 & 2: Fail-Closed and Generic Binding", () => {
    it("throws exception on missing or invalid resultId", () => {
      const handler = matchRequestKeyCardsHandler(new ExpressionEvaluator());
      expect(() =>
        handler({ request: "targetRequest", card: "key", predicate: "samePrintedCard", resultId: "" }, {} as any)
      ).toThrow("resultId は空でない文字列である必要があります");
      expect(() =>
        handler({ request: "targetRequest", card: "key", predicate: "samePrintedCard" }, {} as any)
      ).toThrow("resultId は空でない文字列である必要があります");
    });

    it("throws exception on unknown predicate", () => {
      const handler = matchRequestKeyCardsHandler(new ExpressionEvaluator());
      expect(() =>
        handler({ request: "targetRequest", card: "key", predicate: "exactId", resultId: "res" }, {} as any)
      ).toThrow("未知またはサポートされていない predicate です");
    });

    it("throws exception on unknown or unresolved request binding", () => {
      const handler = matchRequestKeyCardsHandler(new ExpressionEvaluator());
      expect(() =>
        handler({ request: "unknownRequest", card: "key", predicate: "samePrintedCard", resultId: "res" }, {} as any)
      ).toThrow("未知または解決できない request binding です");

      expect(() =>
        handler({ request: "targetRequest", card: "key", predicate: "samePrintedCard", resultId: "res" }, { context: {} } as any)
      ).toThrow("targetRequest が解決できないか、不正なリクエストオブジェクトです");
    });

    it("throws exception on unknown or unresolved card binding", () => {
      const handler = matchRequestKeyCardsHandler(new ExpressionEvaluator());
      const targetReq = { id: "r1", status: "pending", keyCards: [{ id: "c1", suit: "S", rank: "7", value: 7 }] };
      expect(() =>
        handler(
          { request: "targetRequest", card: "unknownCard", predicate: "samePrintedCard", resultId: "res" },
          { targetRequest: targetReq } as any
        )
      ).toThrow("未知または解決できない card binding です");

      expect(() =>
        handler(
          { request: "targetRequest", card: "key", predicate: "samePrintedCard", resultId: "res" },
          { targetRequest: targetReq, keyCard: undefined, keyCards: [] } as any
        )
      ).toThrow("source card が解決できないか、不正なカードオブジェクトです");
    });

    it("throws exception on malformed targetRequest keyCards", () => {
      const handler = matchRequestKeyCardsHandler(new ExpressionEvaluator());
      const sourceCard = { id: "k1", suit: "S", rank: "7", value: 7 };

      // Empty keyCards
      expect(() =>
        handler(
          { request: "targetRequest", card: "key", predicate: "samePrintedCard", resultId: "res" },
          { targetRequest: { id: "r1", keyCards: [] }, keyCard: sourceCard } as any
        )
      ).toThrow("targetRequest に有効なキーカードが存在しません");

      // Malformed card element (missing suit/rank)
      expect(() =>
        handler(
          { request: "targetRequest", card: "key", predicate: "samePrintedCard", resultId: "res" },
          { targetRequest: { id: "r1", keyCards: [{ id: "bad-card" }] }, keyCard: sourceCard } as any
        )
      ).toThrow("targetRequest のキーカードのスートまたはランクが欠落しています");
    });

    it("throws exception on malformed source card", () => {
      const handler = matchRequestKeyCardsHandler(new ExpressionEvaluator());
      const targetReq = { id: "r1", status: "pending", keyCards: [{ id: "c1", suit: "S", rank: "7", value: 7 }] };

      expect(() =>
        handler(
          { request: "targetRequest", card: "key", predicate: "samePrintedCard", resultId: "res" },
          { targetRequest: targetReq, keyCard: { id: "bad-source" } } as any
        )
      ).toThrow("source card のスートまたはランクが欠落しています");
    });
  });

  // Amendment 3: Rank Semantics
  describe("Amendment 3: Rank Semantics", () => {
    it("isSamePrintedCard does NOT automatically treat '1' and 'A' as same card", () => {
      const cardA = { id: "c-A", suit: "S", rank: "A", value: 1 };
      const card1 = { id: "c-1", suit: "S", rank: "1", value: 1 };

      expect(isSamePrintedCard(cardA, card1)).toBe(false);
      expect(isSamePrintedCard(card1, cardA)).toBe(false);

      const cardA2 = { id: "c-A2", suit: "S", rank: "a", value: 1 };
      expect(isSamePrintedCard(cardA, cardA2)).toBe(true); // Case-insensitive matches
    });
  });

  // Existing Counter Non-Regression
  it("Existing action.counter regression check: 2-key request remains unconditionally cancelled by regular counter", () => {
    const counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
    expect(counterAction).toBeDefined();

    const targetReq = {
      id: "req-throwing-2k",
      actionId: "action.throwing",
      controller: "p2",
      status: "pending",
      keyCards: [
        { id: "k1", suit: "H", rank: "2", value: 2 },
        { id: "k2", suit: "D", rank: "3", value: 3 },
      ],
    };

    const counterKey = { id: "counter-key", suit: "C", rank: "2", value: 2 };
    const costCard = { id: "cost-d", suit: "S", rank: "4", value: 4 };

    const state: any = {
      turnPlayer: "p2",
      chancePlayer: "p1",
      players: {
        p1: { name: "Player A", hand: [counterKey, costCard], life: [], grave: [], field: [] },
        p2: { name: "Player B", hand: [], life: [], grave: [], field: [] },
      },
      stage: {
        requests: [targetReq],
        history: [],
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCard: counterKey,
      targetRequest: targetReq as any,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const request = registry.createRequest(counterAction, context);
    registry.resolveRequest(request, context);

    // Regular counter unconditionally cancels 2-key requests
    expect(targetReq.status).toBe("cancelled");
    expect(state.stage.requests).not.toContain(targetReq);
  });
});
