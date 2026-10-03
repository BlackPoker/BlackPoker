import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { MatchLogRecorder } from "../../engine/log/MatchLogRecorder";
import { GameSession } from "../../engine/session/GameSession";
import { ActionCostEvaluator } from "../../engine/rules/ActionCostEvaluator";
import { ActionTargetService } from "../../engine/rules/ActionTargetService";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { ZoneCardResolver } from "../../engine/rules/ZoneCardResolver";
import { revealCardHandler, moveCardHandler } from "../../engine/rules/commandHandlers";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { deriveRuntimeShuffleSeed, shuffleDeterministic } from "../../engine/random/DeterministicShuffle";
import { SeededRandom } from "../../engine/random/RandomSource";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";

describe("action.search (サーチ) & Immediate Life Selection Tests [BP-SIM-REG-5.0-H-SEARCH]", () => {
  let rulePackage: RulePackage;
  let searchAction: ActionDefinition;
  let counterAction: ActionDefinition;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    searchAction = rulePackage.actions.find((a) => a.id === "action.search")!;
    counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
  });

  // ===========================================================================
  // 1. Official Definition
  // ===========================================================================
  it("1. Official Definition: action.search matches official v9.1.2 specification", () => {
    expect(searchAction).toBeDefined();
    expect(searchAction.id).toBe("action.search");
    expect(searchAction.name).toBe("サーチ");
    expect(searchAction.ruby).toBe("さーち");
    expect(searchAction.type).toBe("magic");

    // Request specs
    expect(searchAction.request.trigger).toBe("direct");
    expect(searchAction.request.speed).toBe("immediate");
    expect(searchAction.request.timing).toBe("quick");

    // Cost: NONE
    expect(searchAction.cost).toBeUndefined();

    // Targets: NONE
    expect(searchAction.targets).toBeUndefined();

    // Key condition: Joker x1 from Hand
    expect(searchAction.key).toBeDefined();
    expect(searchAction.key!.condition?.card?.rank).toBe("Joker");
    expect(searchAction.key!.condition?.card?.zone).toBe("hand");

    // Effects sequence: selectCards -> revealCard -> moveCard -> shuffleZone
    expect(searchAction.effect).toBeDefined();
    expect(searchAction.effect!.length).toBe(4);

    const [selectStep, revealStep, moveStep, shuffleStep] = searchAction.effect as any[];
    expect(selectStep.selectCards).toEqual({
      id: "searchCard",
      zone: "life",
      count: 1,
      chooser: "self",
    });
    expect(revealStep.revealCard).toEqual({
      card: "selection.searchCard",
      target: "opponent",
      sourceZone: "life",
    });
    expect(moveStep.moveCard).toEqual({
      card: "selection.searchCard",
      from: "life",
      to: "hand",
    });
    expect(shuffleStep.shuffleZone).toEqual({
      zone: "life",
      player: "self",
    });
  });

  // ===========================================================================
  // 2. Format Coverage
  // ===========================================================================
  it("2. All four formats include Search: Light, Standard, Pro, and Master formats", async () => {
    const catalog = await loadRegulationCatalog();

    // Light format
    const lightFormat = catalog.formats.get("light");
    expect(lightFormat).toBeDefined();
    expect(lightFormat!.actions).toContain("action.search");

    // Standard format
    const standardFormat = catalog.formats.get("standard");
    expect(standardFormat).toBeDefined();
    expect(standardFormat!.actions).toContain("action.search");

    // Pro format
    const proFormat = catalog.formats.get("pro");
    expect(proFormat).toBeDefined();
    expect(proFormat!.actions).toContain("action.search");
    expect(proFormat!.actions.length).toBe(31);

    // Master format (Full RulePackage: 37 actions)
    expect(rulePackage.actions.some((a) => a.id === "action.search")).toBe(true);
    expect(rulePackage.actions.length).toBe(37);
  });

  // ===========================================================================
  // 3. Joker Key Valid
  // ===========================================================================
  it("3. Joker key valid: Canonical Joker from Hand validates successfully", () => {
    const validator = new ActionRequestValidator();
    const context: CommandContext = {
      state: {
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
            life: [{ id: "c-1", suit: "S", rank: "A" }],
          },
        },
      },
      playerKey: "p1",
      keyCard: { id: "jk-1", suit: "joker", rank: "JOKER" },
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
    };

    expect(() => validator.validateActionRequest(searchAction, context)).not.toThrow();
  });

  // ===========================================================================
  // 4. Non-Joker Invalid
  // ===========================================================================
  it("4. Non-Joker invalid: Normal card as key card throws ValidationError", () => {
    const validator = new ActionRequestValidator();
    const context: CommandContext = {
      state: {
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [], history: [] },
        players: {
          p1: {
            hand: [{ id: "c-sa", suit: "S", rank: "A", value: 1 }],
            life: [{ id: "c-1", suit: "S", rank: "2" }],
          },
        },
      },
      playerKey: "p1",
      keyCard: { id: "c-sa", suit: "S", rank: "A", value: 1 },
      keyCards: [{ id: "c-sa", suit: "S", rank: "A", value: 1 }],
    };

    expect(() => validator.validateActionRequest(searchAction, context)).toThrow(ValidationError);
  });

  // ===========================================================================
  // 5. Canonical Joker Identity from Hand
  // ===========================================================================
  it("5. Canonical Joker identity from Hand: resolves State-owned Joker, ignores caller spoofing", () => {
    const registry = new CommandRegistry();
    const logRecorder = new MatchLogRecorder({ matchId: "match-search-key" });
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "real-jk", suit: "joker", rank: "JOKER" }],
          life: [{ id: "c-1", suit: "H", rank: "7" }],
        },
      },
    };
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [{ id: "real-jk", suit: "spoofed", rank: "spoofed" }],
      logRecorder,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    expect(req.keyCards[0].id).toBe("real-jk");
    expect(req.keyCards[0].suit).toBe("joker");
    expect(req.keyCards[0].rank).toBe("JOKER");
  });

  // ===========================================================================
  // 6. No Cost
  // ===========================================================================
  it("6. No cost: ActionCostEvaluator evaluates cost as none/undefined", () => {
    const costEvaluator = new ActionCostEvaluator();
    const cost = costEvaluator.resolveEffectiveCost(searchAction, {}, "p1", rulePackage.components);
    expect(cost === "" || cost === undefined).toBe(true);
    expect(searchAction.cost).toBeUndefined();
  });

  // ===========================================================================
  // 7. No Target
  // ===========================================================================
  it("7. No target: Search requires 0 targets", () => {
    expect(searchAction.targets).toBeUndefined();
  });

  // ===========================================================================
  // 8. Immediate Request Not Stage-pushed
  // ===========================================================================
  it("8. Immediate Request not Stage-pushed: Search is never placed in stage.requests and no stage.pushed logged", () => {
    const registry = new CommandRegistry();
    const logRecorder = new MatchLogRecorder({ matchId: "match-search-stage" });
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [{ id: "c-1", suit: "S", rank: "A" }],
        },
      },
    };
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      logRecorder,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    expect(state.stage.requests).toHaveLength(0);

    const pushedEvents = logRecorder.getEvents().filter((e) => e.type === "stage.pushed");
    expect(pushedEvents).toHaveLength(0);
  });

  // ===========================================================================
  // 9. No stage.popped for Search
  // ===========================================================================
  it("9. No stage.popped for Search: Resolution does not emit stage.popped", () => {
    const registry = new CommandRegistry();
    const logRecorder = new MatchLogRecorder({ matchId: "match-search-pop" });
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 42,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 42,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      logRecorder,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    registry.resolveRequest(req, context);

    const poppedEvents = logRecorder.getEvents().filter((e) => e.type === "stage.popped");
    expect(poppedEvents).toHaveLength(0);
  });

  // ===========================================================================
  // 10. Existing Stage Unchanged
  // ===========================================================================
  it("10. Existing Stage unchanged: Search leaves pending normal Stage requests completely intact", () => {
    const registry = new CommandRegistry();
    const pendingNormalReq = {
      id: "req-normal-1",
      actionId: "action.attack",
      controller: "p1",
      status: "pending" as const,
      sequence: 1,
      keyCards: [],
    };
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p2",
      matchSeed: 1234,
      stage: { requests: [pendingNormalReq], history: [] },
      players: {
        p1: { hand: [], life: [] },
        p2: {
          hand: [{ id: "jk-p2", suit: "joker", rank: "JOKER" }],
          life: [],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 1234,
      playerKey: "p2",
      keyCards: [{ id: "jk-p2", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const searchReq = registry.createRequest(searchAction, context);
    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0].id).toBe("req-normal-1");

    registry.resolveRequest(searchReq, context);
    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0].id).toBe("req-normal-1");
  });

  // ===========================================================================
  // 11. Cannot Be Counter Target
  // ===========================================================================
  it("11. Cannot be Counter target: Immediate Search is absent from Stage and cannot be targeted by Counter", () => {
    const normalReq = {
      id: "req-attack-1",
      actionId: "action.attack",
      controller: "p1",
      status: "pending" as const,
      sequence: 1,
      keyCards: [{ id: "c-atk-key", suit: "S", rank: "A" }],
    };
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p2",
      stage: { requests: [normalReq], history: [] },
      players: {
        p1: { hand: [], life: [] },
        p2: {
          hand: [{ id: "jk-p2", suit: "joker", rank: "JOKER" }],
          life: [],
          grave: [],
        },
      },
    };

    const candidates = ActionTargetService.enumerateTargets(
      counterAction,
      state,
      "p2",
      rulePackage.components
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].targetRequestId).toBe("req-attack-1");
    // Immediate Search request is not on Stage, therefore cannot be targeted by Counter
    expect(candidates.some((c) => c.targetRequestId?.includes("search"))).toBe(false);
  });

  // ===========================================================================
  // 12. Life Candidates Include All Controller Life Cards
  // ===========================================================================
  it("12. Life candidates include all controller Life cards: findSelectableCards enumerates all Life cards", () => {
    const interpreter = new EffectInterpreter(
      new CommandRegistry(),
      new ExpressionEvaluator(),
      new AbilityEvaluator()
    );
    const context: CommandContext = {
      state: {
        players: {
          p1: {
            life: [
              { id: "c-1", suit: "S", rank: "A" },
              { id: "c-2", suit: "H", rank: "K" },
              { id: "c-3", suit: "D", rank: "10" },
            ],
          },
        },
      },
      playerKey: "p1",
    };

    const candidates = interpreter.findSelectableCards({ zone: "life" }, context, "p1");
    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => c.id)).toEqual(["c-1", "c-2", "c-3"]);
  });

  // ===========================================================================
  // 13. Decision Belongs to Controller
  // ===========================================================================
  it("13. Decision belongs to controller: DecisionRequest.playerId is Search controller", () => {
    const registry = new CommandRegistry();
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [{ id: "c-life", suit: "S", rank: "A" }],
        },
      },
    };
    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const result = registry.resolveRequest(req, context);
    expect(result.type).toBe("WAITING_FOR_DECISION");
    expect((result as any).decisionRequest.playerId).toBe("p1");
  });

  // ===========================================================================
  // 14. Opponent Does Not Receive Unselected Life Identities
  // ===========================================================================
  it("14. Opponent does not receive unselected Life identities: Observation hides opponent life cards", () => {
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          life: [
            { id: "c-secret-1", suit: "S", rank: "A" },
            { id: "c-secret-2", suit: "H", rank: "K" },
          ],
        },
        p2: {
          life: [{ id: "c-p2-1", suit: "D", rank: "7" }],
        },
      },
    };

    const obsP2 = ObservationFactory.createObservation(state, "p2");
    const p1View = obsP2.players.find((p) => p.playerId === "p1")!;
    expect(p1View.lifeCount).toBe(2);
    expect(p1View.lifeDisplay).toBe("2");
    expect((p1View as any).life).toBeUndefined();
  });

  // ===========================================================================
  // 15. Selected Card Revealed to Opponent
  // ===========================================================================
  it("15. Selected card revealed to opponent: cardRevealed event emitted with canonical card and target opponent", () => {
    const registry = new CommandRegistry();
    const events: any[] = [];
    registry.onEvent((e) => events.push(e));

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 777,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [
            { id: "c-1", suit: "S", rank: "A" },
            { id: "c-2", suit: "H", rank: "K" },
          ],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 777,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const step1 = registry.resolveRequest(req, context);
    registry.resumeRequest(req, (step1 as any).continuation, ["c-2"], context);

    const revealed = events.find((e) => e.type === "cardRevealed");
    expect(revealed).toBeDefined();
    expect(revealed.payload.card.id).toBe("c-2");
    expect(revealed.payload.target).toBe("opponent");
    expect(revealed.payload.sourceZone).toBe("life");
  });

  // ===========================================================================
  // 16. Selected Card Life -> Hand
  // ===========================================================================
  it("16. Selected card Life -> Hand: Card is added to hand and removed from life", () => {
    const registry = new CommandRegistry();
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 778,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [
            { id: "c-1", suit: "S", rank: "A" },
            { id: "c-2", suit: "H", rank: "K" },
          ],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 778,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const step1 = registry.resolveRequest(req, context);
    registry.resumeRequest(req, (step1 as any).continuation, ["c-2"], context);

    expect(state.players.p1.hand.some((c: any) => c.id === "c-2")).toBe(true);
    expect(state.players.p1.life.some((c: any) => c.id === "c-2")).toBe(false);
  });

  // ===========================================================================
  // 17. Remaining Life Shuffled
  // ===========================================================================
  it("17. Remaining Life shuffled: zoneShuffled event emitted with remaining count", () => {
    const registry = new CommandRegistry();
    const events: any[] = [];
    registry.onEvent((e) => events.push(e));

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 779,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [
            { id: "c-1", suit: "S", rank: "A" },
            { id: "c-2", suit: "H", rank: "K" },
            { id: "c-3", suit: "D", rank: "10" },
          ],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 779,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const step1 = registry.resolveRequest(req, context);
    registry.resumeRequest(req, (step1 as any).continuation, ["c-2"], context);

    expect(state.players.p1.life).toHaveLength(2);
    const shuffledEvent = events.find((e) => e.type === "zoneShuffled");
    expect(shuffledEvent).toBeDefined();
    expect(shuffledEvent.payload.cardCount).toBe(2);
  });

  // ===========================================================================
  // 18. Selected Card Excluded from Shuffled Life
  // ===========================================================================
  it("18. Selected card excluded from shuffled Life: Selected card absent from Life before and after shuffle", () => {
    const registry = new CommandRegistry();
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 780,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [
            { id: "c-1", suit: "S", rank: "A" },
            { id: "c-2", suit: "H", rank: "K" },
          ],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 780,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const step1 = registry.resolveRequest(req, context);
    registry.resumeRequest(req, (step1 as any).continuation, ["c-2"], context);

    expect(state.players.p1.life.map((c: any) => c.id)).toEqual(["c-1"]);
  });

  // ===========================================================================
  // 19. Card Conservation
  // ===========================================================================
  it("19. Card conservation: Total cards across Hand, Life, Grave are conserved", () => {
    const registry = new CommandRegistry();
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 999,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [
            { id: "c-1", suit: "S", rank: "A" },
            { id: "c-2", suit: "H", rank: "K" },
          ],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 999,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const step1 = registry.resolveRequest(req, context);
    registry.resumeRequest(req, (step1 as any).continuation, ["c-1"], context);

    // Total cards = 3 (1 hand + 1 life + 1 grave)
    expect(state.players.p1.hand.length + state.players.p1.life.length + state.players.p1.grave.length).toBe(3);
  });

  // ===========================================================================
  // 20. Joker Finalized to Grave
  // ===========================================================================
  it("20. Joker finalized to Grave: Key card Joker is sent to Grave upon request resolution", () => {
    const registry = new CommandRegistry();
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 999,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [{ id: "c-1", suit: "S", rank: "A" }],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 999,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const step1 = registry.resolveRequest(req, context);
    registry.resumeRequest(req, (step1 as any).continuation, ["c-1"], context);

    expect(state.players.p1.grave).toHaveLength(1);
    expect(state.players.p1.grave[0].id).toBe("jk-1");
  });

  // ===========================================================================
  // 21. cardRevealed before cardMoved
  // ===========================================================================
  it("21. cardRevealed before cardMoved: Selected card is revealed to opponent before it moves to hand", () => {
    const registry = new CommandRegistry();
    const events: any[] = [];
    registry.onEvent((e) => events.push(e));

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 1001,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [{ id: "c-1", suit: "S", rank: "A" }, { id: "c-2", suit: "H", rank: "K" }],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 1001,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const step1 = registry.resolveRequest(req, context);
    registry.resumeRequest(req, (step1 as any).continuation, ["c-1"], context);

    const revealIdx = events.findIndex((e) => e.type === "cardRevealed");
    const lifeToHandMoveIdx = events.findIndex(
      (e) => e.type === "cardMoved" && e.payload?.fromZone === "life" && e.payload?.toZone === "hand"
    );

    expect(revealIdx).toBeGreaterThanOrEqual(0);
    expect(lifeToHandMoveIdx).toBeGreaterThanOrEqual(0);
    expect(revealIdx).toBeLessThan(lifeToHandMoveIdx);
  });

  // ===========================================================================
  // 22. cardMoved before zoneShuffled
  // ===========================================================================
  it("22. cardMoved before zoneShuffled: Card moves to hand before Life is shuffled", () => {
    const registry = new CommandRegistry();
    const events: any[] = [];
    registry.onEvent((e) => events.push(e));

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 1001,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [{ id: "c-1", suit: "S", rank: "A" }, { id: "c-2", suit: "H", rank: "K" }],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 1001,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const step1 = registry.resolveRequest(req, context);
    registry.resumeRequest(req, (step1 as any).continuation, ["c-1"], context);

    const lifeToHandMoveIdx = events.findIndex(
      (e) => e.type === "cardMoved" && e.payload?.fromZone === "life" && e.payload?.toZone === "hand"
    );
    const shuffleIdx = events.findIndex((e) => e.type === "zoneShuffled");

    expect(lifeToHandMoveIdx).toBeGreaterThanOrEqual(0);
    expect(shuffleIdx).toBeGreaterThanOrEqual(0);
    expect(lifeToHandMoveIdx).toBeLessThan(shuffleIdx);
  });

  // ===========================================================================
  // 23. Duplicate Life ID Fail-closed
  // ===========================================================================
  it("23. Duplicate Life ID fail-closed: Duplicate physical card IDs in Life throw Error without state mutation", () => {
    const interpreter = new EffectInterpreter(
      new CommandRegistry(),
      new ExpressionEvaluator(),
      new AbilityEvaluator()
    );
    const context: CommandContext = {
      state: {
        players: {
          p1: {
            life: [
              { id: "c-dup", suit: "S", rank: "A" },
              { id: "c-dup", suit: "H", rank: "K" },
            ],
          },
        },
      },
      playerKey: "p1",
    };

    // Candidate generation fails closed
    expect(() => {
      interpreter.findSelectableCards({ zone: "life" }, context, "p1");
    }).toThrow(/重複するカードID/);

    // Direct reveal fails closed
    expect(() => {
      revealCardHandler()(
        { card: "c-dup", sourceZone: "life", target: "opponent" },
        context
      );
    }).toThrow(/重複するカードID/);

    // Direct move fails closed
    expect(() => {
      moveCardHandler()(
        { card: "c-dup", from: "life", to: "hand" },
        context
      );
    }).toThrow(/重複するカードID/);

    // Life is untouched
    expect(context.state.players.p1.life).toHaveLength(2);
  });

  // ===========================================================================
  // 24. Malformed Life Card Fail-closed
  // ===========================================================================
  it("24. Malformed Life card fail-closed: Bad rank/suit, noncanonical Joker, unit wrapper fail-closed", () => {
    const interpreter = new EffectInterpreter(
      new CommandRegistry(),
      new ExpressionEvaluator(),
      new AbilityEvaluator()
    );

    // Bad suit/rank
    const contextBadCard: CommandContext = {
      state: {
        players: {
          p1: { life: [{ id: "c-bad", suit: "banana", rank: "999" }] },
        },
      },
      playerKey: "p1",
    };
    expect(() => {
      interpreter.findSelectableCards({ zone: "life" }, contextBadCard, "p1");
    }).toThrow(/Canonical Printed Cardではありません/);

    // Non-canonical Joker
    const contextBadJoker: CommandContext = {
      state: {
        players: {
          p1: { life: [{ id: "c-bad-joker", suit: "H", rank: "0" }] },
        },
      },
      playerKey: "p1",
    };
    expect(() => {
      interpreter.findSelectableCards({ zone: "life" }, contextBadJoker, "p1");
    }).toThrow(/Canonical Printed Cardではありません/);

    // Unit wrapper in Life
    const contextWrapper: CommandContext = {
      state: {
        players: {
          p1: { life: [{ id: "c-wrap", unitId: "u-1", kind: "防壁" }] },
        },
      },
      playerKey: "p1",
    };
    expect(() => {
      interpreter.findSelectableCards({ zone: "life" }, contextWrapper, "p1");
    }).toThrow(/不正なエントリまたはUnit wrapperが含まれています/);

    // Empty card ID
    const contextEmptyId: CommandContext = {
      state: {
        players: {
          p1: { life: [{ id: "", suit: "S", rank: "A" }] },
        },
      },
      playerKey: "p1",
    };
    expect(() => {
      interpreter.findSelectableCards({ zone: "life" }, contextEmptyId, "p1");
    }).toThrow(/カードIDが空または不正です/);
  });

  // ===========================================================================
  // 25. Stale Selection Fail-closed
  // ===========================================================================
  it("25. Stale selection fail-closed: Selected card removed before resume throws Error, no reveal/move/shuffle", () => {
    const registry = new CommandRegistry();
    const events: any[] = [];
    registry.onEvent((e) => events.push(e));

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 123,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [
            { id: "c-1", suit: "S", rank: "A" },
            { id: "c-2", suit: "H", rank: "K" },
          ],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 123,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const step1 = registry.resolveRequest(req, context);

    // Stale: c-1 removed from life externally before resume
    state.players.p1.life = [{ id: "c-2", suit: "H", rank: "K" }];

    expect(() => {
      registry.resumeRequest(req, (step1 as any).continuation, ["c-1"], context);
    }).toThrow(/対象カードが見つかりません: 'c-1'/);

    // No false reveal, move from life, or shuffle
    expect(events.filter((e) => e.type === "cardRevealed")).toHaveLength(0);
    expect(events.filter((e) => e.type === "cardMoved" && e.payload?.fromZone === "life")).toHaveLength(0);
    expect(events.filter((e) => e.type === "zoneShuffled")).toHaveLength(0);
  });

  // ===========================================================================
  // 26. Spoofed Card Metadata Cannot Override State
  // ===========================================================================
  it("26. Spoofed Card metadata cannot override State: State-owned Card is authoritative", () => {
    const state: any = {
      players: {
        p1: {
          life: [{ id: "c-real", suit: "H", rank: "K", value: 13 }],
          hand: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      playerKey: "p1",
      selections: {
        searchCard: [{ id: "c-real", suit: "spoofed-suit", rank: "spoofed-rank" }],
      },
    };

    const registry = new CommandRegistry();
    const events: any[] = [];
    registry.onEvent((e) => events.push(e));

    const interpreter = new EffectInterpreter(
      registry,
      new ExpressionEvaluator(),
      new AbilityEvaluator()
    );
    // Direct revealHandler execution with spoofed selection object
    revealCardHandler(interpreter)(
      { card: "selection.searchCard", sourceZone: "life", target: "opponent" },
      context
    );

    const revealed = events.find((e) => e.type === "cardRevealed");
    expect(revealed).toBeDefined();
    // Authoritative State values
    expect(revealed.payload.card.id).toBe("c-real");
    expect(revealed.payload.card.suit).toBe("H");
    expect(revealed.payload.card.rank).toBe("K");
  });

  // ===========================================================================
  // 27. Empty Life
  // ===========================================================================
  it("27. Empty Life: Resolves safely with empty candidates, no-op reveal/move, safe shuffle, Joker in grave", () => {
    const registry = new CommandRegistry();
    const events: any[] = [];
    registry.onEvent((e) => events.push(e));

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 555,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 555,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const result = registry.resolveRequest(req, context);
    // Completes synchronously without decision interruption because candidates is empty
    expect(result.type).toBe("COMPLETED");

    // No reveal or move from life
    expect(events.filter((e) => e.type === "cardRevealed")).toHaveLength(0);
    expect(events.filter((e) => e.type === "cardMoved" && e.payload?.fromZone === "life")).toHaveLength(0);

    // Shuffle emitted once with cardCount 0
    const shuffled = events.filter((e) => e.type === "zoneShuffled");
    expect(shuffled).toHaveLength(1);
    expect(shuffled[0].payload.cardCount).toBe(0);

    // Joker finalized to grave
    expect(state.players.p1.grave).toHaveLength(1);
    expect(state.players.p1.grave[0].id).toBe("jk-1");
  });

  // ===========================================================================
  // 28. One-card Life
  // ===========================================================================
  it("28. One-card Life: Only 1 candidate, moves to Hand, revealed, Life empty, Joker in grave", () => {
    const registry = new CommandRegistry();
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 888,
      stage: { requests: [], history: [] },
      players: {
        p1: {
          hand: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
          life: [{ id: "c-only", suit: "S", rank: "A" }],
          grave: [],
        },
      },
    };
    const context: CommandContext = {
      state,
      matchSeed: 888,
      playerKey: "p1",
      keyCards: [{ id: "jk-1", suit: "joker", rank: "JOKER" }],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(searchAction, context);
    const step1 = registry.resolveRequest(req, context);
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    expect((step1 as any).decisionRequest.patterns).toHaveLength(1);
    expect((step1 as any).decisionRequest.catalog.effectSelections[0].selectedValues).toEqual(["c-only"]);

    const resumeResult = registry.resumeRequest(
      req,
      (step1 as any).continuation,
      ["c-only"],
      context
    );
    expect(resumeResult.type).toBe("COMPLETED");

    expect(state.players.p1.hand[0].id).toBe("c-only");
    expect(state.players.p1.life).toHaveLength(0);
    expect(state.players.p1.grave[0].id).toBe("jk-1");
  });

  // ===========================================================================
  // 29. Deterministic Shuffle
  // ===========================================================================
  it("29. Deterministic shuffle: Same seed produces identical order, advancing runtime count advances seed sequence", () => {
    const cards1 = [
      { id: "c-1", suit: "S", rank: "A" },
      { id: "c-2", suit: "S", rank: "2" },
      { id: "c-3", suit: "S", rank: "3" },
      { id: "c-4", suit: "S", rank: "4" },
    ];
    const cards2 = [...cards1];

    const matchSeed = 12345;
    const seedA = deriveRuntimeShuffleSeed(matchSeed, 1);
    const shuffledA1 = shuffleDeterministic(cards1, new SeededRandom(seedA));
    const shuffledA2 = shuffleDeterministic(cards2, new SeededRandom(seedA));

    expect(shuffledA1.map((c) => c.id)).toEqual(shuffledA2.map((c) => c.id));

    // Next shuffle count
    const seedB = deriveRuntimeShuffleSeed(matchSeed, 2);
    expect(seedB).not.toBe(seedA);
  });

  // ===========================================================================
  // 30. Search While Stage Non-empty
  // ===========================================================================
  it("30. Search while Stage non-empty: Quick timing allows requesting Search when stage contains requests", () => {
    const validator = new ActionRequestValidator();
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      stage: {
        requests: [
          {
            id: "req-p1-attack",
            actionId: "action.attack",
            controller: "p1",
            status: "pending",
            sequence: 1,
            keyCards: [],
          },
        ],
        history: [],
      },
      players: {
        p1: {
          hand: [{ id: "jk-p1", suit: "joker", rank: "JOKER" }],
          life: [{ id: "c-p1-1", suit: "H", rank: "7" }],
        },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [{ id: "jk-p1", suit: "joker", rank: "JOKER" }],
    };

    expect(() => validator.validateActionRequest(searchAction, context)).not.toThrow();
  });

  // ===========================================================================
  // 31. Non-turn Chance Player Search
  // ===========================================================================
  it("31. Non-turn Chance player Search: Player holding Chance can request Search even on opponent's turn", () => {
    const validator = new ActionRequestValidator();
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p2",
      stage: {
        requests: [
          {
            id: "req-p1-attack",
            actionId: "action.attack",
            controller: "p1",
            status: "pending",
            sequence: 1,
            keyCards: [],
          },
        ],
        history: [],
      },
      players: {
        p1: { hand: [], life: [{ id: "c-p1-l", suit: "S", rank: "A" }] },
        p2: {
          hand: [{ id: "jk-p2", suit: "joker", rank: "JOKER" }],
          life: [{ id: "c-p2-1", suit: "H", rank: "7" }],
        },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p2",
      keyCards: [{ id: "jk-p2", suit: "joker", rank: "JOKER" }],
    };

    // p2 is NOT turnPlayer, but has Chance
    expect(() => validator.validateActionRequest(searchAction, context)).not.toThrow();

    const { request: p2Decision } = LegalPatternGenerator.generateActionRequestDecision(
      state,
      "p2",
      rulePackage
    );
    const searchPattern = p2Decision.patterns.find((p) => {
      const act = p2Decision.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.search";
    });
    expect(searchPattern).toBeDefined();
  });

  // ===========================================================================
  // 32. Chance Preserved After Immediate Decision Resolution
  // ===========================================================================
  it("32. Chance preserved after immediate Decision resolution: p2 preserves Chance after Search finishes", () => {
    const normalReq = {
      id: "req-p1-attack",
      actionId: "action.attack",
      controller: "p1",
      status: "pending" as const,
      sequence: 1,
      keyCards: [],
    };
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p2",
      matchSeed: 3333,
      stage: {
        requests: [normalReq],
        history: [],
      },
      players: {
        p1: { hand: [], life: [{ id: "c-p1-l", suit: "S", rank: "A" }] },
        p2: {
          hand: [{ id: "jk-p2", suit: "joker", rank: "JOKER" }],
          life: [
            { id: "c-p2-1", suit: "H", rank: "7" },
            { id: "c-p2-2", suit: "D", rank: "8" },
          ],
          grave: [],
        },
      },
    };

    const session = new GameSession(state, rulePackage, { matchSeed: 3333 });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") {
      throw new Error(`Expected WAITING_FOR_DECISION, got ${step1.type}`);
    }
    expect(step1.request.playerId).toBe("p2");

    // Find Search action pattern
    const searchPatIdx = step1.request.patterns.findIndex((p: any) => {
      const act = step1.request.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.search";
    });
    expect(searchPatIdx).toBeGreaterThanOrEqual(0);

    // p2 requests Search
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: searchPatIdx,
    });

    // Pauses for EFFECT_RESOLUTION
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") {
      throw new Error(`Expected WAITING_FOR_DECISION, got ${step2.type}`);
    }
    expect(step2.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step2.request.playerId).toBe("p2");

    // Select c-p2-1
    const chooseCardPatIdx = step2.request.patterns.findIndex((p: any) => {
      const eff = step2.request.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-p2-1");
    });
    expect(chooseCardPatIdx).toBeGreaterThanOrEqual(0);

    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: chooseCardPatIdx,
    });

    // Search finished! Stage still has p1's request!
    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0].id).toBe("req-p1-attack");

    // CRITICAL: chancePlayer MUST REMAIN p2!
    expect(state.chancePlayer).toBe("p2");
  });

  // ===========================================================================
  // 33. Normal Stage Resolution Still Resets Chance Normally
  // ===========================================================================
  it("33. Normal Stage resolution still resets Chance normally: Resolving normal Stage request returns Chance to turnPlayer", () => {
    const normalReq = {
      id: "req-p1-attack",
      actionId: "action.attack",
      controller: "p1",
      status: "pending" as const,
      sequence: 1,
      keyCards: [],
    };
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p2",
      matchSeed: 4444,
      stage: {
        requests: [normalReq],
        history: [],
      },
      players: {
        p1: { hand: [], life: [{ id: "c-p1-1", suit: "S", rank: "A" }], field: [] },
        p2: { hand: [], life: [{ id: "c-p2-1", suit: "H", rank: "7" }], field: [] },
      },
    };

    const session = new GameSession(state, rulePackage, { matchSeed: 4444 });
    // p2 passes
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") {
      throw new Error(`Expected WAITING_FOR_DECISION, got ${step1.type}`);
    }
    const passPatIdx = step1.request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: passPatIdx,
    });

    // p1 passes -> all passed -> stage top resolves
    const step3 = session.advance();
    if (step3.type === "WAITING_FOR_DECISION") {
      const p1PassIdx = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
      session.submitDecision({
        decisionId: step3.request.decisionId,
        stateVersion: step3.request.stateVersion,
        selectedPatternRef: p1PassIdx,
      });
    }

    // After normal stage top resolution, Chance is returned to turnPlayer (p1)
    expect(state.chancePlayer).toBe("p1");
  });

  // ===========================================================================
  // 34. GameSession E2E
  // ===========================================================================
  it("34. GameSession E2E: Full Search flow while Stage non-empty, choosing Life card, verifying all invariants and chance preservation", () => {
    const pendingAttackReq = {
      id: "req-attack-top",
      actionId: "action.attack",
      controller: "p1",
      status: "pending" as const,
      sequence: 1,
      keyCards: [],
    };

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p2",
      matchSeed: 10007,
      stage: {
        requests: [pendingAttackReq],
        history: [],
      },
      players: {
        p1: { hand: [], life: [{ id: "c-p1-l1", suit: "S", rank: "A" }], field: [] },
        p2: {
          hand: [{ id: "jk-p2-main", suit: "joker", rank: "JOKER" }],
          life: [
            { id: "c-p2-l1", suit: "H", rank: "2" },
            { id: "c-p2-l2", suit: "D", rank: "5" },
            { id: "c-p2-l3", suit: "C", rank: "K" },
          ],
          grave: [],
          field: [],
        },
      },
    };

    const session = new GameSession(state, rulePackage, { matchSeed: 10007 });
    const events: any[] = [];
    session.registry.onEvent((e) => events.push(e));

    const initialStep = session.advance();
    expect(initialStep.type).toBe("WAITING_FOR_DECISION");
    if (initialStep.type !== "WAITING_FOR_DECISION") {
      throw new Error(`Expected WAITING_FOR_DECISION, got ${initialStep.type}`);
    }
    expect(initialStep.request.playerId).toBe("p2");

    // 1. p2 selects Search
    const searchIdx = initialStep.request.patterns.findIndex((p: any) => {
      const act = initialStep.request.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.search";
    });
    expect(searchIdx).toBeGreaterThanOrEqual(0);

    const step2 = session.submitDecision({
      decisionId: initialStep.request.decisionId,
      stateVersion: initialStep.request.stateVersion,
      selectedPatternRef: searchIdx,
    });

    // 2. Search Request created, NOT in Stage, Attack still Stage TOP
    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0].id).toBe("req-attack-top");

    // 3. Pauses for EFFECT_RESOLUTION
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") {
      throw new Error(`Expected WAITING_FOR_DECISION, got ${step2.type}`);
    }
    expect(step2.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step2.request.playerId).toBe("p2");

    // 4. Decision candidates are all 3 p2 Life cards
    const candidateIds = step2.request.catalog.effectSelections.flatMap((e: any) => e.selectedValues || []);
    expect(candidateIds).toContain("c-p2-l1");
    expect(candidateIds).toContain("c-p2-l2");
    expect(candidateIds).toContain("c-p2-l3");

    // 5. Choose Life card B: c-p2-l2 ("D", "5")
    const chooseBIdx = step2.request.patterns.findIndex((p: any) => {
      const eff = step2.request.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-p2-l2");
    });
    expect(chooseBIdx).toBeGreaterThanOrEqual(0);

    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: chooseBIdx,
    });

    // 6. Verification:
    // B revealed
    const revealedEvents = events.filter((e) => e.type === "cardRevealed");
    expect(revealedEvents).toHaveLength(1);
    expect(revealedEvents[0].payload.card.id).toBe("c-p2-l2");

    // B in p2 Hand
    expect(state.players.p2.hand.map((c: any) => c.id)).toEqual(["c-p2-l2"]);

    // B absent from p2 Life
    expect(state.players.p2.life.map((c: any) => c.id)).not.toContain("c-p2-l2");
    expect(state.players.p2.life).toHaveLength(2);

    // Joker in p2 Grave
    expect(state.players.p2.grave.map((c: any) => c.id)).toEqual(["jk-p2-main"]);

    // Search resolved
    expect(state.stage.history.some((r: any) => r.actionId === "action.search")).toBe(true);

    // Existing Stage Request unchanged
    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0].id).toBe("req-attack-top");

    // chancePlayer remains p2
    expect(state.chancePlayer).toBe("p2");
  });

  // ===========================================================================
  // 35. Engine Hardcoding Check
  // ===========================================================================
  it("35. Generic Engine Guard: Zero hardcoding of 'action.search' in tools/simulator/src/engine", () => {
    function searchInDir(dir: string, pattern: string): string[] {
      const matches: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          matches.push(...searchInDir(fullPath, pattern));
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (content.includes(pattern)) {
            matches.push(fullPath);
          }
        }
      }
      return matches;
    }

    const engineDir = path.resolve(__dirname, "../../engine");
    const found = searchInDir(engineDir, "action.search");
    expect(found).toEqual([]);
  });

  // ===========================================================================
  // 36. Pack Open Generic Regression (BP-SIM-REG-5.0-H-R1-SEARCH-GENERIC-IMMEDIATE-CHANCE)
  // ===========================================================================
  it("36. Pack Open Generic Regression: non-magic Immediate Action preserves chancePlayer when Stage non-empty", () => {
    const normalReq = {
      id: "req-p1-attack",
      actionId: "action.attack",
      controller: "p1",
      status: "pending" as const,
      sequence: 1,
      keyCards: [],
    };

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p2",
      matchSeed: 7777,
      stage: {
        requests: [normalReq],
        history: [],
      },
      players: {
        p1: { hand: [], life: [{ id: "c-p1-1", suit: "S", rank: "A" }], field: [] },
        p2: {
          hand: [],
          life: [{ id: "c-p2-1", suit: "H", rank: "7" }],
          field: [],
          pack: {
            opened: false,
            cards: [
              { id: "pk-1", suit: "S", rank: "K" },
              { id: "pk-2", suit: "D", rank: "Q" },
            ],
          },
        },
      },
    };

    const session = new GameSession(state, rulePackage, { matchSeed: 7777 });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step1.request.playerId).toBe("p2");

    // p2 requests action.packOpen
    const packOpenPatIdx = step1.request.patterns.findIndex((p: any) => {
      const act = step1.request.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.packOpen";
    });
    expect(packOpenPatIdx).toBeGreaterThanOrEqual(0);

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: packOpenPatIdx,
    });

    // Immediate action -> directly pauses for EFFECT_RESOLUTION
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step2.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step2.request.playerId).toBe("p2");

    // Choose pk-1
    const chooseCardPatIdx = step2.request.patterns.findIndex((p: any) => {
      const eff = step2.request.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("pk-1");
    });
    expect(chooseCardPatIdx).toBeGreaterThanOrEqual(0);

    session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: chooseCardPatIdx,
    });

    // Verification:
    // 1. Pack Open never placed on Stage, Request X still on Stage
    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0].id).toBe("req-p1-attack");

    // 2. Selected card moved to p2 Hand
    expect(state.players.p2.hand.map((c: any) => c.id)).toContain("pk-1");

    // 3. Pack opened
    expect(state.players.p2.pack.opened).toBe(true);
    expect(state.players.p2.pack.cards.map((c: any) => c.id)).toEqual(["pk-2"]);

    // 4. CRITICAL: chancePlayer MUST REMAIN p2!
    expect(state.chancePlayer).toBe("p2");
  });

  // ===========================================================================
  // 37. Stage-backed Effect Decision Regression (BP-SIM-REG-5.0-H-R1-SEARCH-GENERIC-IMMEDIATE-CHANCE)
  // ===========================================================================
  it("37. Stage-backed Effect Decision Regression: Stage Request pausing for EFFECT_RESOLUTION resets Chance to turnPlayer", () => {
    const reunionAction = rulePackage.actions.find((a) => a.id === "action.reunion")!;
    expect(reunionAction).toBeDefined();

    const stagedReq = {
      id: "req-reunion-1",
      actionId: "action.reunion",
      action: reunionAction,
      controller: "p1",
      status: "pending" as const,
      sequence: 1,
      keyCards: [
        { id: "k1", suit: "H", rank: "3" },
        { id: "k2", suit: "H", rank: "5" },
      ],
    };

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p2",
      matchSeed: 8888,
      stage: {
        requests: [stagedReq],
        history: [],
      },
      players: {
        p1: {
          hand: [],
          life: [{ id: "c-p1-1", suit: "S", rank: "A" }],
          field: [],
          grave: [
            { id: "g-p1-1", suit: "S", rank: "K" },
            { id: "g-p1-2", suit: "D", rank: "10" },
          ],
        },
        p2: {
          hand: [],
          life: [{ id: "c-p2-1", suit: "H", rank: "7" }],
          field: [],
          grave: [],
        },
      },
    };

    const session = new GameSession(state, rulePackage, { matchSeed: 8888 });

    // p2 passes
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const p2PassIdx = step1.request.patterns.findIndex((p: any) => p.kind === "PASS");
    expect(p2PassIdx).toBeGreaterThanOrEqual(0);

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: p2PassIdx,
    });

    // p1 passes
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const p1PassIdx = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    expect(p1PassIdx).toBeGreaterThanOrEqual(0);

    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1PassIdx,
    });

    // All passed -> Stage top (Reunion) resolves -> pauses for selectCards from grave
    expect(step3.type).toBe("WAITING_FOR_DECISION");
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step3.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step3.request.playerId).toBe("p1");

    // Before resume: Request is still physically on Stage!
    expect(state.stage.requests.some((r: any) => r.id === "req-reunion-1")).toBe(true);

    // Choose grave card g-p1-1
    const chooseGraveIdx = step3.request.patterns.findIndex((p: any) => {
      const eff = step3.request.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("g-p1-1");
    });
    expect(chooseGraveIdx).toBeGreaterThanOrEqual(0);

    session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: chooseGraveIdx,
    });

    // Verification:
    // 1. Request removed from Stage
    expect(state.stage.requests.some((r: any) => r.id === "req-reunion-1")).toBe(false);

    // 2. Chosen card moved to p1 Hand
    expect(state.players.p1.hand.map((c: any) => c.id)).toContain("g-p1-1");

    // 3. Stage-backed resolution resets Chance to turnPlayer (p1)
    expect(state.chancePlayer).toBe("p1");
  });

  // ===========================================================================
  // 38. Immediate Main Regression (Set Bulwark) (BP-SIM-REG-5.0-H-R1-SEARCH-GENERIC-IMMEDIATE-CHANCE)
  // ===========================================================================
  it("38. Immediate Main Regression: action.setBulwark completes via generic non-stage path without breaking chance", () => {
    const bulwarkComponent = rulePackage.components.find((c) => c.id === "character.bulwark")!;
    expect(bulwarkComponent).toBeDefined();

    const state: any = {
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      matchSeed: 9999,
      stage: {
        requests: [],
        history: [],
      },
      players: {
        p1: {
          hand: [{ id: "c-p1-b1", suit: "S", rank: "4" }],
          life: [{ id: "c-p1-1", suit: "S", rank: "A" }],
          field: [],
          grave: [],
        },
        p2: {
          hand: [],
          life: [{ id: "c-p2-1", suit: "H", rank: "7" }],
          field: [],
          grave: [],
        },
      },
    };

    const session = new GameSession(state, rulePackage, { matchSeed: 9999 });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step1.request.playerId).toBe("p1");

    const bulwarkPatIdx = step1.request.patterns.findIndex((p: any) => {
      const act = step1.request.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.setBulwark";
    });
    expect(bulwarkPatIdx).toBeGreaterThanOrEqual(0);

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: bulwarkPatIdx,
    });

    // Pauses for EFFECT_RESOLUTION (selecting card from hand for bulwark)
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step2.request.source.type).toBe("EFFECT_RESOLUTION");
    expect(step2.request.playerId).toBe("p1");

    const chooseCardPatIdx = step2.request.patterns.findIndex((p: any) => {
      const eff = step2.request.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-p1-b1");
    });
    expect(chooseCardPatIdx).toBeGreaterThanOrEqual(0);

    session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: chooseCardPatIdx,
    });

    // Verification:
    // Bulwark set on field
    expect(state.players.p1.field).toHaveLength(1);
    expect(state.players.p1.field[0].componentId).toBe("character.bulwark");
    expect(state.players.p1.field[0].cards[0].id).toBe("c-p1-b1");

    // Hand empty
    expect(state.players.p1.hand).toHaveLength(0);

    // Stage was not used
    expect(state.stage.requests).toHaveLength(0);

    // chancePlayer is still p1
    expect(state.chancePlayer).toBe("p1");
  });

  // ===========================================================================
  // 39. Zero Hardcoding Check for GameSession
  // ===========================================================================
  it("39. Generic Engine Guard: Zero hardcoding of 'action.packOpen' in GameSession.ts", () => {
    const gameSessionPath = path.resolve(__dirname, "../../engine/session/GameSession.ts");
    const content = fs.readFileSync(gameSessionPath, "utf-8");
    expect(content.includes("action.packOpen")).toBe(false);
  });
});
