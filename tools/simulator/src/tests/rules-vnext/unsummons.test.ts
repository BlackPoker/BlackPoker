import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionDefinition, ActionRequest } from "../../domain/rules/RulePackage";
import { CommandRegistry, CommandContext, cancelStageRequest, finalizeRequestKeyCards } from "../../engine/rules/CommandRegistry";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { ActionTargetService } from "../../engine/rules/ActionTargetService";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { GameSession } from "../../engine/session/GameSession";
import { loadRegulationCatalog, getRegulation } from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { CostResolver } from "../../engine/rules/CostResolver";
import { resolveUniqueFieldUnitById, moveUnitToHand } from "../../engine/rules/unitMovementUtils";
import { moveUnitToHandHandler, moveRequestKeyCardsToHandHandler } from "../../engine/rules/commandHandlers";
import { validateTargetsAtResolution } from "../../engine/rules/ResolutionTargetValidator";
import { matchesKeyGroupConstraints } from "../../engine/rules/keyCardGroupUtils";

describe("action.unsummons (帰還) & Generic Character Hand-Return Foundation [BP-SIM-REG-5.0-I-UNSUMMONS]", () => {
  let rulePackage: RulePackage;
  let unsummonsAction: ActionDefinition;
  let counterAction: ActionDefinition;

  const createBaseState = (p1Hand: any[] = [], p1Field: any[] = []) => ({
    turnPlayer: "p1",
    chancePlayer: "p1",
    players: {
      p1: {
        hand: p1Hand,
        field: p1Field.length > 0 ? p1Field : [
          { unitId: "bw-cost", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] },
          { unitId: "sol-target", componentId: "character.soldier", state: "charge", cards: [{ id: "solc1", suit: "spade", rank: "4" }] },
        ],
        life: [{ id: "lp1", suit: "spade", rank: "A" }],
        grave: [],
        fog: [],
      },
      p2: {
        hand: [],
        field: [
          { unitId: "p2-sol", componentId: "character.soldier", state: "charge", cards: [{ id: "p2c1", suit: "heart", rank: "6" }] },
        ],
        life: [{ id: "lp2", suit: "heart", rank: "A" }],
        grave: [],
        fog: [],
      },
    },
    stage: { requests: [], history: [] },
    phase: "main",
    turnCount: 1,
  });

  const createMockInterpreter = (events: any[] = []) => ({
    dispatchEvent: (evt: any) => events.push(evt),
  } as any);

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    unsummonsAction = rulePackage.actions.find((a) => a.id === "action.unsummons")!;
    counterAction = rulePackage.actions.find((a) => a.id === "action.counter")!;
  });

  // ===========================================================================
  // 1. Official Definition & YAML Audit (v9.1.2 7.3.1.4.13)
  // ===========================================================================
  it("1. Official Definition: action.unsummons matches official v9.1.2 specification", () => {
    expect(unsummonsAction).toBeDefined();
    expect(unsummonsAction.id).toBe("action.unsummons");
    expect(unsummonsAction.name).toBe("帰還");
    expect(unsummonsAction.ruby).toBe("きかん");
    expect(unsummonsAction.type).toBe("magic");

    // Request specs
    expect(unsummonsAction.request.trigger).toBe("direct");
    expect(unsummonsAction.request.speed).toBe("normal");
    expect(unsummonsAction.request.timing).toBe("quick");

    // Cost: B
    expect(unsummonsAction.cost).toBe("B");

    // Key Card: 2 cards, sameSuit: true, hand zone, A..K rank
    expect(unsummonsAction.key).toBeDefined();
    expect(unsummonsAction.key!.count).toBe(2);
    expect(unsummonsAction.key!.sameSuit).toBe(true);
    expect(unsummonsAction.key!.condition?.card?.zone).toBe("hand");
    expect(unsummonsAction.key!.condition?.card?.rank).toBe("A..K");

    // Targets: 1 target, relation self, componentType character
    expect(unsummonsAction.targets).toBeDefined();
    expect(unsummonsAction.targets!.length).toBe(1);
    const targetDef = unsummonsAction.targets![0];
    expect(targetDef.id).toBe("target");
    expect(targetDef.type).toBe("unit");
    expect(targetDef.condition?.relation).toBe("self");
    expect(targetDef.condition?.componentType).toBe("character");
    expect(targetDef.condition?.state).toBeUndefined(); // "チャージ状態" is NOT a target condition!

    // Effect: moveUnitToHand (requiredState: charge), moveRequestKeyCardsToHand
    expect(unsummonsAction.effect).toBeDefined();
    expect(unsummonsAction.effect!.length).toBe(2);
    const [step1, step2] = unsummonsAction.effect as any[];
    expect(step1.moveUnitToHand).toEqual({
      target: "target",
      requiredState: "charge",
    });
    expect(step2.moveRequestKeyCardsToHand).toEqual({});
  });

  // ===========================================================================
  // 2. Format Coverage & Pro Guard
  // ===========================================================================
  it("2. Format Coverage: action.unsummons excluded from Light, present in Standard, Pro, Master", async () => {
    const catalog = await loadRegulationCatalog();

    // Light format: excluded (×)
    const lightFormat = catalog.formats.get("light");
    expect(lightFormat).toBeDefined();
    expect(lightFormat!.actions).not.toContain("action.unsummons");

    // Standard format: present (○)
    const standardFormat = catalog.formats.get("standard");
    expect(standardFormat).toBeDefined();
    expect(standardFormat!.actions).toContain("action.unsummons");

    // Pro format: present (○)
    const proFormat = catalog.formats.get("pro");
    expect(proFormat).toBeDefined();
    expect(proFormat!.actions).toContain("action.unsummons");

    // Master format: present in full rulePackage (○)
    expect(rulePackage.actions.some((a) => a.id === "action.unsummons")).toBe(true);
  });

  it("3. Pro Publication Guard: pro:rarePack remains unpublished (simulatorImplemented: false)", async () => {
    const catalog = await loadRegulationCatalog();
    const proRarePack = await getRegulation("pro-rarePack");
    expect(proRarePack).toBeDefined();
    expect(proRarePack.formatId).toBe("pro");
    expect(proRarePack.frameId).toBe("rarePack");

    const validation = RegulationValidator.validateRegulation(catalog, "pro-rarePack");
    expect(validation.simulatorImplemented).toBe(false);
  });

  // ===========================================================================
  // 3. Key Card Validation
  // ===========================================================================
  it("4. Key Card condition: same suit 2 cards from Hand is VALID", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const state = createBaseState([c1, c2]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: state.players.p1.field[1],
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).not.toThrow();

    const groupCheck = matchesKeyGroupConstraints([c1, c2], unsummonsAction.key!);
    expect(groupCheck.isValid).toBe(true);
  });

  it("5. Key Card condition: different suits 2 cards FAILS validation", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "h3", suit: "heart", rank: "3" };
    const state = createBaseState([c1, c2]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: state.players.p1.field[1],
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);

    const groupCheck = matchesKeyGroupConstraints([c1, c2], unsummonsAction.key!);
    expect(groupCheck.isValid).toBe(false);
  });

  it("6. Key Card condition: same suit different ranks (e.g. ♠A and ♠K) is VALID", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "sA", suit: "spade", rank: "A" };
    const c2 = { id: "sK", suit: "spade", rank: "K" };
    const state = createBaseState([c1, c2]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: state.players.p1.field[1],
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).not.toThrow();

    const groupCheck = matchesKeyGroupConstraints([c1, c2], unsummonsAction.key!);
    expect(groupCheck.isValid).toBe(true);
  });

  it("7. Key Card condition: 1 card only FAILS validation (count mismatch)", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const state = createBaseState([c1]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1],
      targetComponent: state.players.p1.field[1],
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);
  });

  it("8. Key Card condition: 3 cards FAILS validation (count mismatch)", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s5", suit: "spade", rank: "5" };
    const c3 = { id: "s7", suit: "spade", rank: "7" };
    const state = createBaseState([c1, c2, c3]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2, c3],
      targetComponent: state.players.p1.field[1],
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);
  });

  it("9. Key Card condition: Joker as key card FAILS validation (A..K condition)", () => {
    const validator = new ActionRequestValidator();
    const j1 = { id: "j1", suit: "joker", rank: "JOKER" };
    const j2 = { id: "j2", suit: "joker", rank: "JOKER" };
    const state = createBaseState([j1, j2]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [j1, j2],
      targetComponent: state.players.p1.field[1],
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);
  });

  it("10. Key Card condition: Key card from non-hand zone FAILS validation", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const state = createBaseState([c1]);
    state.players.p1.life = [c2]; // c2 is in life, not in hand!

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: state.players.p1.field[1],
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);
  });

  it("11. Key Card condition: Duplicate physical card ID FAILS validation (fail-closed)", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const state = createBaseState([c1]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c1],
      targetComponent: state.players.p1.field[1],
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);
  });

  it("12. Key Card condition: Malformed card (rank '0', missing suit, etc.) FAILS validation (fail-closed)", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const bad = { id: "bad1", suit: "spade", rank: "0" };
    const state = createBaseState([c1, bad]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, bad],
      targetComponent: state.players.p1.field[1],
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);
  });

  // ===========================================================================
  // 4. Target Eligibility & Semantic Condition (Section 5)
  // ===========================================================================
  it("13. Target Condition: Own Soldier in charge state is a VALID target", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const sol = { unitId: "sol-charge", componentId: "character.soldier", state: "charge", cards: [{ id: "sc1", suit: "spade", rank: "4" }] };
    const bw = { unitId: "bw-cost", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] };
    const state = createBaseState([c1, c2], [bw, sol]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: sol,
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).not.toThrow();
  });

  it("14. Target Condition: Own Soldier in drive state is a VALID target (charge is NOT a target condition)", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const solDrive = { unitId: "sol-drive", componentId: "character.soldier", state: "drive", cards: [{ id: "sc1", suit: "spade", rank: "4" }] };
    const bw = { unitId: "bw-cost", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] };
    const state = createBaseState([c1, c2], [bw, solDrive]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: solDrive,
      components: rulePackage.components,
    };

    // Both charge and drive characters are VALID at Request creation!
    expect(() => validator.validateActionRequest(unsummonsAction, context)).not.toThrow();
  });

  it("15. Target Condition: Own Bulwark in charge state is a VALID target", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const bw1 = { unitId: "bw1", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] };
    const bw2 = { unitId: "bw2", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc2", suit: "spade", rank: "6" }] };
    const state = createBaseState([c1, c2], [bw1, bw2]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: bw2,
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).not.toThrow();
  });

  it("16. Target Condition: Own Bulwark in drive state is a VALID target", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const bw1 = { unitId: "bw1", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] };
    const bwDrive = { unitId: "bw-drive", componentId: "character.bulwark", state: "drive", cards: [{ id: "bwc2", suit: "spade", rank: "6" }] };
    const state = createBaseState([c1, c2], [bw1, bwDrive]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: bwDrive,
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).not.toThrow();
  });

  it("17. Target Condition: Own Hero / Ace in charge state is a VALID target", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const hero = { unitId: "hero1", componentId: "character.hero", state: "charge", cards: [{ id: "heroc1", suit: "spade", rank: "K" }] };
    const bw = { unitId: "bw-cost", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] };
    const state = createBaseState([c1, c2], [bw, hero]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: hero,
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).not.toThrow();
  });

  it("18. Target Condition: Own Hero / Ace in drive state is a VALID target", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const aceDrive = { unitId: "ace-drive", componentId: "character.ace", state: "drive", cards: [{ id: "acec1", suit: "spade", rank: "A" }] };
    const bw = { unitId: "bw-cost", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] };
    const state = createBaseState([c1, c2], [bw, aceDrive]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: aceDrive,
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).not.toThrow();
  });

  it("19. Target Condition: Own Magician in charge or drive state is a VALID target", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const mag = { unitId: "mag1", componentId: "character.magician", state: "charge", cards: [{ id: "j1", suit: "joker", rank: "JOKER" }] };
    const bw = { unitId: "bw-cost", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] };
    const state = createBaseState([c1, c2], [bw, mag]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: mag,
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).not.toThrow();
  });

  it("20. Target Condition: Opponent Character in charge state FAILS validation (relation: self violation)", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const state = createBaseState([c1, c2]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: state.players.p2.field[0], // Opponent's character!
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);
  });

  it("21. Target Condition: Opponent Character in drive state FAILS validation", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const state = createBaseState([c1, c2]);
    state.players.p2.field[0].state = "drive";

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: state.players.p2.field[0],
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);
  });

  it("22. Target Condition: Non-character unit FAILS validation (componentType: character violation)", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const relic = { unitId: "relic1", componentId: "artifact.relic", state: "charge", cards: [{ id: "rc1", suit: "club", rank: "2" }] };
    const bw = { unitId: "bw-cost", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] };
    const state = createBaseState([c1, c2], [bw, relic]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: relic,
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);
  });

  it("23. Target Condition: Target count mismatch (0 targets) FAILS validation", () => {
    const validator = new ActionRequestValidator();
    const c1 = { id: "s3", suit: "spade", rank: "3" };
    const c2 = { id: "s7", suit: "spade", rank: "7" };
    const state = createBaseState([c1, c2]);

    const context: CommandContext = {
      playerKey: "p1",
      state,
      keyCards: [c1, c2],
      targetComponent: undefined, // 0 targets!
      components: rulePackage.components,
    };

    expect(() => validator.validateActionRequest(unsummonsAction, context)).toThrow(ValidationError);
  });

  // ===========================================================================
  // 5. Legal Pattern Generation
  // ===========================================================================
  it("24. Legal Pattern Generation: Generates unsummons pattern when same-suit pair, charge bulwark, and own character exist", () => {
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "s3", suit: "spade", rank: "3" },
            { id: "s7", suit: "spade", rank: "7" },
          ],
          field: [
            { unitId: "bw1", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] },
            { unitId: "sol1", componentId: "character.soldier", state: "charge", cards: [{ id: "solc1", suit: "spade", rank: "4" }] },
          ],
          life: [{ id: "lp1", suit: "spade", rank: "A" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "lp2", suit: "heart", rank: "A" }], grave: [] },
      },
      stage: { requests: [], history: [] },
      phase: "main",
    };

    const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    const unsummonsPatterns = decision.patterns.filter((p) => {
      const act = decision.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.unsummons";
    });

    expect(unsummonsPatterns.length).toBeGreaterThan(0);
  });

  it("25. Legal Pattern Generation: Does NOT generate pattern when no same-suit pairs in hand", () => {
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "s3", suit: "spade", rank: "3" },
            { id: "h7", suit: "heart", rank: "7" },
          ],
          field: [
            { unitId: "bw1", componentId: "character.bulwark", state: "charge", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] },
            { unitId: "sol1", componentId: "character.soldier", state: "charge", cards: [{ id: "solc1", suit: "spade", rank: "4" }] },
          ],
          life: [{ id: "lp1", suit: "spade", rank: "A" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "lp2", suit: "heart", rank: "A" }], grave: [] },
      },
      stage: { requests: [], history: [] },
      phase: "main",
    };

    const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    const unsummonsPatterns = decision.patterns.filter((p) => {
      const act = decision.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.unsummons";
    });

    expect(unsummonsPatterns.length).toBe(0);
  });

  it("26. Legal Pattern Generation: Does NOT generate pattern when player has 0 charge bulwarks (cannot pay B)", () => {
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "s3", suit: "spade", rank: "3" },
            { id: "s7", suit: "spade", rank: "7" },
          ],
          field: [
            // Only drive bulwark -> cannot pay B
            { unitId: "bw1", componentId: "character.bulwark", state: "drive", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] },
            { unitId: "sol1", componentId: "character.soldier", state: "charge", cards: [{ id: "solc1", suit: "spade", rank: "4" }] },
          ],
          life: [{ id: "lp1", suit: "spade", rank: "A" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "lp2", suit: "heart", rank: "A" }], grave: [] },
      },
      stage: { requests: [], history: [] },
      phase: "main",
    };

    const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    const unsummonsPatterns = decision.patterns.filter((p) => {
      const act = decision.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.unsummons";
    });

    expect(unsummonsPatterns.length).toBe(0);
  });

  it("27. Legal Pattern Generation: Does NOT generate pattern when player has 0 characters on field", () => {
    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [
            { id: "s3", suit: "spade", rank: "3" },
            { id: "s7", suit: "spade", rank: "7" },
          ],
          field: [], // 0 characters on field
          life: [{ id: "lp1", suit: "spade", rank: "A" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "lp2", suit: "heart", rank: "A" }], grave: [] },
      },
      stage: { requests: [], history: [] },
      phase: "main",
    };

    const { request: decision } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    const unsummonsPatterns = decision.patterns.filter((p) => {
      const act = decision.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.unsummons";
    });

    expect(unsummonsPatterns.length).toBe(0);
  });

  it("28. Legal Pattern Generation: Enumerates both charge and drive own characters as target choices, excludes opponent characters", () => {
    const state: any = {
      players: {
        p1: {
          field: [
            { unitId: "bw-charge", componentId: "character.bulwark", state: "charge", cards: [{ id: "b1", suit: "D", rank: "5" }] },
            { unitId: "sol-charge", componentId: "character.soldier", state: "charge", cards: [{ id: "s1", suit: "S", rank: "4" }] },
            { unitId: "sol-drive", componentId: "character.soldier", state: "drive", cards: [{ id: "s2", suit: "H", rank: "6" }] },
          ],
        },
        p2: {
          field: [
            { unitId: "p2-sol", componentId: "character.soldier", state: "charge", cards: [{ id: "s3", suit: "C", rank: "8" }] },
          ],
        },
      },
    };

    const targets = ActionTargetService.enumerateTargets(unsummonsAction, state, "p1", rulePackage.components as any);

    const targetUnitIds = targets.map((t) => t.targetUnitId);
    expect(targetUnitIds).toContain("bw-charge");
    expect(targetUnitIds).toContain("sol-charge");
    expect(targetUnitIds).toContain("sol-drive");
    expect(targetUnitIds).not.toContain("p2-sol");
    expect(targetUnitIds.length).toBe(3);
  });

  // ===========================================================================
  // 6. Cost B Validation & Edge Cases
  // ===========================================================================
  it("29. Cost B Validation: Charge Bulwark satisfies Cost B and transitions from charge to drive", () => {
    const costResolver = new CostResolver();
    const mockInterpreter = createMockInterpreter();
    const bulwark = { unitId: "bw1", componentId: "character.bulwark", state: "charge", cards: [{ id: "c1", suit: "D", rank: "5" }] };
    const player = {
      hand: [],
      field: [bulwark],
      life: 10,
    };
    const context: CommandContext = {
      playerKey: "p1",
      state: { players: { p1: player } },
      components: rulePackage.components,
    };

    const costPayment = {
      discardedCardIds: [],
      drivenBulwarkUnitIds: ["bw1"],
      sacrificedUnitIds: [],
      lifeCount: 0,
    };

    expect(costResolver.canPaySelection(costPayment, context, "B")).toBe(true);
    costResolver.paySelection(costPayment, context, mockInterpreter);

    expect(bulwark.state).toBe("drive");
  });

  it("30. Cost B Validation: Drive Bulwark cannot pay Cost B (insufficient charge bulwarks)", () => {
    const costResolver = new CostResolver();
    const bulwark = { unitId: "bw1", componentId: "character.bulwark", state: "drive", cards: [{ id: "c1", suit: "D", rank: "5" }] };
    const player = {
      hand: [],
      field: [bulwark],
      life: 10,
    };
    const context: CommandContext = {
      playerKey: "p1",
      state: { players: { p1: player } },
      components: rulePackage.components,
    };

    const costPayment = {
      discardedCardIds: [],
      drivenBulwarkUnitIds: ["bw1"],
      sacrificedUnitIds: [],
      lifeCount: 0,
    };

    expect(costResolver.canPaySelection(costPayment, context, "B")).toBe(false);
  });

  it("31. Cost B Validation: Charge Soldier cannot pay Cost B (spoofed payment rejected)", () => {
    const costResolver = new CostResolver();
    const soldier = { unitId: "sol1", componentId: "character.soldier", state: "charge", cards: [{ id: "c1", suit: "S", rank: "4" }] };
    const player = {
      hand: [],
      field: [soldier],
      life: 10,
    };
    const context: CommandContext = {
      playerKey: "p1",
      state: { players: { p1: player } },
      components: rulePackage.components,
    };

    const costPayment = {
      discardedCardIds: [],
      drivenBulwarkUnitIds: ["sol1"], // spoofed: soldier passed as bulwark!
      sacrificedUnitIds: [],
      lifeCount: 0,
    };

    // canPaySelection MUST return false for soldier!
    expect(costResolver.canPaySelection(costPayment, context, "B")).toBe(false);

    // paySelection MUST throw error for non-bulwark!
    const mockInterpreter = createMockInterpreter();
    expect(() => costResolver.paySelection(costPayment, context, mockInterpreter)).toThrow();
  });

  it("32. Cost B Self-Payment: Target charge Bulwark can pay its own B cost, becoming drive", () => {
    const costResolver = new CostResolver();
    const mockInterpreter = createMockInterpreter();
    const targetBulwark = { unitId: "bw-target", componentId: "character.bulwark", state: "charge", cards: [{ id: "c1", suit: "D", rank: "5" }] };
    const player = {
      hand: [],
      field: [targetBulwark],
      life: 10,
    };
    const context: CommandContext = {
      playerKey: "p1",
      state: { players: { p1: player } },
      components: rulePackage.components,
    };

    const costPayment = {
      discardedCardIds: [],
      drivenBulwarkUnitIds: ["bw-target"],
      sacrificedUnitIds: [],
      lifeCount: 0,
    };

    expect(costResolver.canPaySelection(costPayment, context, "B")).toBe(true);
    costResolver.paySelection(costPayment, context, mockInterpreter);

    expect(targetBulwark.state).toBe("drive");
  });

  it("33. Cost B Self-Payment: When target Bulwark paid its own B, it is drive at resolution, so moveUnitToHand is no-op, but key cards return to hand", () => {
    const mockInterpreter = createMockInterpreter();
    const evaluator = new ExpressionEvaluator();
    const targetBulwark = { unitId: "bw-target", componentId: "character.bulwark", state: "drive", cards: [{ id: "bwc1", suit: "diamond", rank: "5" }] };
    const k1 = { id: "k1", suit: "spade", rank: "A" };
    const k2 = { id: "k2", suit: "spade", rank: "K" };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [targetBulwark],
          grave: [],
        },
      },
    };

    const context: CommandContext = {
      playerKey: "p1",
      state,
      components: rulePackage.components,
      targetComponent: targetBulwark,
      currentRequest: {
        id: "req-unsummons",
        actionId: "action.unsummons",
        controller: "p1",
        keyCards: [k1, k2],
        targets: [{ id: "target", type: "unit", unitId: "bw-target" }],
      } as any,
    };

    // Step 1: moveUnitToHand with requiredState: charge
    const handler1 = moveUnitToHandHandler(evaluator, mockInterpreter);
    handler1({ target: "target", requiredState: "charge" }, context);

    // Because targetBulwark is drive, it is NOT moved to hand (safe no-op, Rule 5.4.4)
    expect(state.players.p1.field).toContain(targetBulwark);
    expect(state.players.p1.hand).not.toContainEqual(expect.objectContaining({ id: "bwc1" }));

    // Step 2: moveRequestKeyCardsToHand
    const handler2 = moveRequestKeyCardsToHandHandler(mockInterpreter);
    handler2({}, context);

    // Key cards returned to hand!
    expect(state.players.p1.hand).toHaveLength(2);
    expect(state.players.p1.hand).toContain(k1);
    expect(state.players.p1.hand).toContain(k2);
  });

  // ===========================================================================
  // 7. Effect Resolution: Target in Charge State
  // ===========================================================================
  it("34. Effect Resolution (Charge Target): Target Character in charge state is moved from field to hand", () => {
    const mockInterpreter = createMockInterpreter();
    const evaluator = new ExpressionEvaluator();
    const soldier = {
      unitId: "sol1",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-sol", suit: "heart", rank: "5" }],
    };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [soldier],
          grave: [],
        },
      },
    };

    const context: CommandContext = {
      playerKey: "p1",
      state,
      components: rulePackage.components,
      targetComponent: soldier,
      currentRequest: {
        id: "req-1",
        actionId: "action.unsummons",
        controller: "p1",
      } as any,
    };

    const handler = moveUnitToHandHandler(evaluator, mockInterpreter);
    handler({ target: "target", requiredState: "charge" }, context);

    expect(state.players.p1.field).toHaveLength(0);
    expect(state.players.p1.hand).toHaveLength(1);
    expect(state.players.p1.hand[0].id).toBe("c-sol");
  });

  it("35. Effect Resolution (Charge Target): Physical card is appended to controller Hand; Unit wrapper does NOT enter hand", () => {
    const mockInterpreter = createMockInterpreter();
    const soldierCard = { id: "c-sol", suit: "club", rank: "9" };
    const soldier = {
      unitId: "sol-wrapper",
      componentId: "character.soldier",
      state: "charge",
      cards: [soldierCard],
    };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [soldier],
        },
      },
    };

    moveUnitToHand(soldier, "p1", state, mockInterpreter, { components: rulePackage.components });

    expect(state.players.p1.hand).toHaveLength(1);
    expect(state.players.p1.hand[0]).toEqual(soldierCard);
    expect((state.players.p1.hand[0] as any).unitId).toBeUndefined(); // No unit wrapper in hand!
  });

  it("36. Effect Resolution (Charge Target): Emits cardMoved event (field -> hand) with characterType and combat metadata", () => {
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);

    const soldierCard = { id: "c-sol", suit: "diamond", rank: "7" };
    const soldier = {
      unitId: "sol-combat",
      componentId: "character.soldier",
      state: "charge",
      cards: [soldierCard],
      battle: { role: "attacker" },
    };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [soldier],
        },
      },
    };

    moveUnitToHand(soldier, "p1", state, mockInterpreter, { components: rulePackage.components });

    expect(events).toHaveLength(1);
    expect(events[0].payload.card).toEqual(soldierCard);
    expect(events[0].payload.fromZone).toBe("field");
    expect(events[0].payload.toZone).toBe("hand");
    expect(events[0].payload.playerKey).toBe("p1");
    expect(events[0].payload.characterType).toBe("soldier");
    expect(events[0].payload.combat?.role).toBe("attacker");
  });

  // ===========================================================================
  // 8. Multi-Card Armed Soldier
  // ===========================================================================
  it("37. Multi-Card Armed Soldier: Constituent physical cards all move to hand in exact cards order", () => {
    const mockInterpreter = createMockInterpreter();
    const c1 = { id: "sol-base", suit: "spade", rank: "4" };
    const c2 = { id: "sol-equip", suit: "spade", rank: "7" };
    const armedSoldier = {
      unitId: "armed-sol",
      componentId: "character.soldier",
      state: "charge",
      cards: [c1, c2],
    };

    const state: any = {
      players: {
        p1: {
          hand: [{ id: "existing-hand", suit: "heart", rank: "2" }],
          field: [armedSoldier],
        },
      },
    };

    moveUnitToHand(armedSoldier, "p1", state, mockInterpreter, { components: rulePackage.components });

    expect(state.players.p1.field).toHaveLength(0);
    expect(state.players.p1.hand).toHaveLength(3);
    expect(state.players.p1.hand[1]).toEqual(c1);
    expect(state.players.p1.hand[2]).toEqual(c2);
  });

  it("38. Multi-Card Armed Soldier: Unit wrapper ceases to exist; hand size increases by constituent card count", () => {
    const mockInterpreter = createMockInterpreter();
    const c1 = { id: "c1", suit: "club", rank: "3" };
    const c2 = { id: "c2", suit: "club", rank: "8" };
    const c3 = { id: "c3", suit: "club", rank: "10" };
    const triArmedSoldier = {
      unitId: "tri-armed",
      componentId: "character.soldier",
      state: "charge",
      cards: [c1, c2, c3],
    };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [triArmedSoldier],
        },
      },
    };

    moveUnitToHand(triArmedSoldier, "p1", state, mockInterpreter, { components: rulePackage.components });

    expect(state.players.p1.field).toHaveLength(0);
    expect(state.players.p1.hand).toHaveLength(3);
    expect(state.players.p1.hand.map((c: any) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  // ===========================================================================
  // 9. Effect Resolution: Target in Drive State (Rule 5.4.4)
  // ===========================================================================
  it("39. Effect Resolution (Drive Target): Target Character in drive state causes moveUnitToHand to safe no-op (Rule 5.4.4)", () => {
    const mockInterpreter = createMockInterpreter();
    const evaluator = new ExpressionEvaluator();
    const driveSoldier = {
      unitId: "sol-drive",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "diamond", rank: "6" }],
    };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [driveSoldier],
        },
      },
    };

    const context: CommandContext = {
      playerKey: "p1",
      state,
      components: rulePackage.components,
      targetComponent: driveSoldier,
    };

    const handler = moveUnitToHandHandler(evaluator, mockInterpreter);
    // Should NOT throw, but safely do nothing
    expect(() => handler({ target: "target", requiredState: "charge" }, context)).not.toThrow();

    expect(state.players.p1.field).toHaveLength(1);
    expect(state.players.p1.field[0]).toBe(driveSoldier);
    expect(state.players.p1.hand).toHaveLength(0);
  });

  it("40. Effect Resolution (Drive Target): Drive target remains on field; NO cardMoved event emitted for target", () => {
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);

    const evaluator = new ExpressionEvaluator();
    const driveSoldier = {
      unitId: "sol-drive",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "diamond", rank: "6" }],
    };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [driveSoldier],
        },
      },
    };

    const context: CommandContext = {
      playerKey: "p1",
      state,
      components: rulePackage.components,
      targetComponent: driveSoldier,
    };

    const handler = moveUnitToHandHandler(evaluator, mockInterpreter);
    handler({ target: "target", requiredState: "charge" }, context);

    expect(events).toHaveLength(0);
  });

  // ===========================================================================
  // 10. Effect Step 2: Key Cards Return to Hand
  // ===========================================================================
  it("41. Effect Step 2: Key cards return to Hand via moveRequestKeyCardsToHandHandler", () => {
    const mockInterpreter = createMockInterpreter();
    const k1 = { id: "k1", suit: "heart", rank: "3" };
    const k2 = { id: "k2", suit: "heart", rank: "9" };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [],
          grave: [],
        },
      },
    };

    const context: CommandContext = {
      playerKey: "p1",
      state,
      components: rulePackage.components,
      currentRequest: {
        id: "req-unsummons",
        actionId: "action.unsummons",
        controller: "p1",
        keyCards: [k1, k2],
      } as any,
    };

    const handler = moveRequestKeyCardsToHandHandler(mockInterpreter);
    handler({}, context);

    expect(state.players.p1.hand).toHaveLength(2);
    expect(state.players.p1.hand[0]).toEqual(k1);
    expect(state.players.p1.hand[1]).toEqual(k2);
  });

  it("42. Effect Step 2: Emits cardMoved event (request -> hand) for each key card maintaining order", () => {
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);

    const k1 = { id: "k1", suit: "spade", rank: "2" };
    const k2 = { id: "k2", suit: "spade", rank: "5" };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [],
        },
      },
    };

    const context: CommandContext = {
      playerKey: "p1",
      state,
      components: rulePackage.components,
      currentRequest: {
        id: "req-unsummons",
        actionId: "action.unsummons",
        controller: "p1",
        keyCards: [k1, k2],
      } as any,
    };

    const handler = moveRequestKeyCardsToHandHandler(mockInterpreter);
    handler({}, context);

    expect(events).toHaveLength(2);
    expect(events[0].payload.card).toEqual(k1);
    expect(events[0].payload.fromZone).toBe("request");
    expect(events[0].payload.toZone).toBe("hand");
    expect(events[1].payload.card).toEqual(k2);
    expect(events[1].payload.fromZone).toBe("request");
    expect(events[1].payload.toZone).toBe("hand");
  });

  it("43. Key Card Finalization: Returned key cards are NOT sent to Grave upon request completion (card conservation)", () => {
    const mockInterpreter = createMockInterpreter();
    const k1 = { id: "k1", suit: "heart", rank: "A" };
    const k2 = { id: "k2", suit: "heart", rank: "K" };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [],
          grave: [],
        },
      },
      stage: {
        requests: [
          {
            id: "req-1",
            actionId: "action.unsummons",
            controller: "p1",
            keyCards: [k1, k2],
          },
        ],
        history: [],
      },
    };

    const context: CommandContext = {
      playerKey: "p1",
      state,
      components: rulePackage.components,
      currentRequest: state.stage.requests[0],
    };

    // First, keys return to hand via effect
    const handler = moveRequestKeyCardsToHandHandler(mockInterpreter);
    handler({}, context);
    expect(state.players.p1.hand).toHaveLength(2);

    // Then, request finishes and finalizeRequestKeyCards is called
    finalizeRequestKeyCards(state.stage.requests[0], context, mockInterpreter);

    // Grave must remain 0! Hand must preserve both cards!
    expect(state.players.p1.grave).toHaveLength(0);
    expect(state.players.p1.hand).toHaveLength(2);
  });

  // ===========================================================================
  // 11. Target Lost & Counter Cancellation
  // ===========================================================================
  it("44. Target Lost (Rule 5.4.5): Target destroyed before resolution triggers TARGET_INVALID_AT_RESOLUTION, whole effect skipped", () => {
    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [], // sol1 has been destroyed/removed!
        },
      },
    };

    const request: ActionRequest = {
      id: "req-unsummons",
      actionId: "action.unsummons",
      controller: "p1",
      keyCards: [{ id: "k1", suit: "spade", rank: "2" }, { id: "k2", suit: "spade", rank: "5" }],
      targets: [{ id: "target", type: "unit", unitId: "sol1" } as any],
      status: "pending" as any,
      sequence: 1,
    };

    const context: CommandContext = {
      playerKey: "p1",
      state,
      components: rulePackage.components,
      currentRequest: request,
    };

    const valResult = validateTargetsAtResolution(unsummonsAction, request, context);
    expect(valResult.isValid).toBe(false);
    expect(valResult.reason).toBe("TARGET_INVALID_AT_RESOLUTION");
  });

  it("45. Target Lost: When effect skipped, moveRequestKeyCardsToHand does NOT run, key cards finalize to Grave", () => {
    const k1 = { id: "k1", suit: "heart", rank: "2" };
    const k2 = { id: "k2", suit: "heart", rank: "7" };

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [],
          field: [
            { unitId: "bw1", componentId: "character.bulwark", state: "drive", cards: [{ id: "bwc", suit: "club", rank: "K" }] },
          ],
          life: [{ id: "lp1", suit: "spade", rank: "A" }],
          grave: [],
        },
        p2: {
          hand: [],
          field: [],
          life: [{ id: "lp2", suit: "heart", rank: "A" }],
          grave: [],
        },
      },
      stage: {
        requests: [
          {
            id: "req-unsummons",
            actionId: "action.unsummons",
            controller: "p1",
            keyCards: [k1, k2],
            targets: [{ id: "target", type: "unit", unitId: "sol-dead" }],
            selectedCostPayment: {
              discardedCardIds: [],
              drivenBulwarkUnitIds: ["bw1"],
              sacrificedUnitIds: [],
              lifeCount: 0,
            },
          },
        ],
        history: [],
      },
      phase: "main",
      turnCount: 1,
    };

    const session = new GameSession(state, rulePackage);

    // Pass priority until resolution
    let step: any = session.advance();
    // P1 pass
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: step.request.patterns.findIndex((p: any) => p.kind === "PASS"),
    });
    // P2 pass -> resolves!
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: step.request.patterns.findIndex((p: any) => p.kind === "PASS"),
    });

    // Request fizzled with TARGET_INVALID_AT_RESOLUTION
    // Target was not on field, so effect skipped
    // Key cards MUST finalize to Grave, NOT to Hand!
    expect(state.players.p1.hand).toHaveLength(0);
    expect(state.players.p1.grave).toHaveLength(2);
    expect(state.players.p1.grave.map((c: any) => c.id)).toContain("k1");
    expect(state.players.p1.grave.map((c: any) => c.id)).toContain("k2");
  });

  it("46. Target Lost: Cost B is NOT refunded when effect skipped due to target invalidity", () => {
    const k1 = { id: "k1", suit: "heart", rank: "2" };
    const k2 = { id: "k2", suit: "heart", rank: "7" };

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [],
          field: [
            { unitId: "bw1", componentId: "character.bulwark", state: "drive", cards: [{ id: "bwc", suit: "club", rank: "K" }] },
          ],
          life: [{ id: "lp1", suit: "spade", rank: "A" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "lp2", suit: "heart", rank: "A" }], grave: [] },
      },
      stage: {
        requests: [
          {
            id: "req-unsummons",
            actionId: "action.unsummons",
            controller: "p1",
            keyCards: [k1, k2],
            targets: [{ id: "target", type: "unit", unitId: "sol-nonexistent" }],
            selectedCostPayment: {
              discardedCardIds: [],
              drivenBulwarkUnitIds: ["bw1"],
              sacrificedUnitIds: [],
              lifeCount: 0,
            },
          },
        ],
        history: [],
      },
      phase: "main",
      turnCount: 1,
    };

    const session = new GameSession(state, rulePackage);
    let step: any = session.advance();
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: step.request.patterns.findIndex((p: any) => p.kind === "PASS"),
    });
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: step.request.patterns.findIndex((p: any) => p.kind === "PASS"),
    });

    // Bulwark used for B remains drive (NO cost refund)
    expect(state.players.p1.field[0].state).toBe("drive");
  });

  it("47. Counter Interaction: Counter cancels Unsummons; effect skipped, key cards to grave, cost B not refunded", () => {
    const k1 = { id: "k1", suit: "spade", rank: "2" };
    const k2 = { id: "k2", suit: "spade", rank: "7" };
    const soldier = {
      unitId: "sol1",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "solc", suit: "heart", rank: "5" }],
    };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [
            soldier,
            { unitId: "bw1", componentId: "character.bulwark", state: "drive", cards: [{ id: "bwc", suit: "diamond", rank: "K" }] },
          ],
          grave: [],
        },
        p2: { hand: [], field: [], grave: [] },
      },
      stage: {
        requests: [
          {
            id: "req-unsummons",
            actionId: "action.unsummons",
            controller: "p1",
            keyCards: [k1, k2],
            targets: [{ id: "target", type: "unit", unitId: "sol1" }],
            selectedCostPayment: {
              discardedCardIds: [],
              drivenBulwarkUnitIds: ["bw1"],
              sacrificedUnitIds: [],
              lifeCount: 0,
            },
          },
        ],
        history: [],
      },
    };

    // Cancel Unsummons via cancelStageRequest
    const cancelledReq = cancelStageRequest("req-unsummons", { state, playerKey: "p1" });

    expect(cancelledReq.status).toBe("cancelled");
    expect(state.stage.requests).toHaveLength(0);
    expect(state.stage.history).toContain(cancelledReq);

    // Key cards went to Grave
    expect(state.players.p1.grave).toHaveLength(2);
    expect(state.players.p1.hand).toHaveLength(0);

    // Target soldier remains on field in charge state
    expect(state.players.p1.field).toContain(soldier);
    expect(soldier.state).toBe("charge");
  });

  // ===========================================================================
  // 12. Battle Role Cleanup
  // ===========================================================================
  it("48. Battle Role Cleanup: Unsummons targeting active Attacker or Blocker clears unit.battle upon returning to hand", () => {
    const mockInterpreter = createMockInterpreter();
    const soldierCard = { id: "c-battle", suit: "spade", rank: "8" };
    const attackerSoldier = {
      unitId: "att-sol",
      componentId: "character.soldier",
      state: "charge",
      cards: [soldierCard],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [attackerSoldier],
        },
      },
    };

    moveUnitToHand(attackerSoldier, "p1", state, mockInterpreter, { components: rulePackage.components });

    expect(state.players.p1.field).toHaveLength(0);
    expect(state.players.p1.hand).toHaveLength(1);
    expect(attackerSoldier.battle).toBeUndefined(); // unit.battle was completely deleted!
  });

  // ===========================================================================
  // 13. GameSession End-to-End
  // ===========================================================================
  it("49. GameSession E2E: Full Unsummons lifecycle on Stage with pass progression, resolution, unit to hand, keys to hand, chance preservation", () => {
    const k1 = { id: "k1", suit: "heart", rank: "4" };
    const k2 = { id: "k2", suit: "heart", rank: "8" };
    const soldierCard = { id: "solc", suit: "spade", rank: "5" };
    const bulwarkCard = { id: "bwc", suit: "diamond", rank: "7" };

    const targetSoldier = {
      unitId: "my-soldier",
      componentId: "character.soldier",
      state: "charge",
      cards: [soldierCard],
    };
    const paymentBulwark = {
      unitId: "my-bulwark",
      componentId: "character.bulwark",
      state: "charge",
      cards: [bulwarkCard],
    };

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [k1, k2],
          field: [paymentBulwark, targetSoldier],
          life: [{ id: "lp1", suit: "spade", rank: "A" }],
          grave: [],
          fog: [],
        },
        p2: {
          hand: [],
          field: [],
          life: [{ id: "lp2", suit: "heart", rank: "A" }],
          grave: [],
          fog: [],
        },
      },
      stage: { requests: [], history: [] },
      turnCount: 1,
      phase: "main",
    };

    const session = new GameSession(state, rulePackage);

    // Step 1: P1 requests Unsummons
    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.playerId).toBe("p1");

    const unsummonsIdx = step.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = step.request.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.unsummons";
    });
    expect(unsummonsIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: unsummonsIdx,
    });

    // P1 pays Cost B immediately on request: bulwark becomes drive
    expect(paymentBulwark.state).toBe("drive");
    expect(state.stage.requests).toHaveLength(1);
    expect(state.stage.requests[0].actionId).toBe("action.unsummons");

    // P1 PASS on Unsummons
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.playerId).toBe("p1");
    const passIdx1 = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passIdx1,
    });

    // P2 PASS on Unsummons -> resolves!
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.playerId).toBe("p2");
    const passIdx2 = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passIdx2,
    });

    // Unsummons completed!
    // 1. Target soldier returned to Hand
    expect(state.players.p1.field).toHaveLength(1);
    expect(state.players.p1.field[0].unitId).toBe("my-bulwark");
    expect(paymentBulwark.state).toBe("drive");

    // 2. Both key cards (k1, k2) + soldier card in Hand
    expect(state.players.p1.hand).toHaveLength(3);
    const handIds = state.players.p1.hand.map((c: any) => c.id);
    expect(handIds).toContain("solc");
    expect(handIds).toContain("k1");
    expect(handIds).toContain("k2");

    // 3. Grave has 0 cards
    expect(state.players.p1.grave).toHaveLength(0);

    // 4. Stage is empty
    expect(state.stage.requests).toHaveLength(0);

    // 5. Chance returns to turnPlayer (p1)
    expect(state.chancePlayer).toBe("p1");
  });

  // ===========================================================================
  // 14. BP-SIM-REG-5.0-I-R1 Mandatory Regressions
  // ===========================================================================
  it("50. Canonical Authority: Spoofed caller Unit object with fake cards moves canonical cards only, ignoring fake caller cards", () => {
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);
    const realCard = { id: "real-card", suit: "spade", rank: "5" };
    const fakeCard = { id: "fake-card", suit: "heart", rank: "K" };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [
            {
              unitId: "unit-a",
              componentId: "character.soldier",
              state: "charge",
              cards: [realCard],
              battle: { role: "attacker", targetPlayerKey: "p2" },
            },
          ],
        },
      },
    };

    const spoofedUnit = {
      unitId: "unit-a",
      componentId: "character.bulwark",
      state: "drive",
      cards: [fakeCard],
      battle: { role: "blocker" },
    };

    moveUnitToHand(spoofedUnit, "p1", state, mockInterpreter as any, { components: rulePackage.components });

    // Field: unit-a removed
    expect(state.players.p1.field).toHaveLength(0);

    // Hand: contains real-card, does NOT contain fake-card
    expect(state.players.p1.hand).toHaveLength(1);
    expect(state.players.p1.hand[0]).toEqual(realCard);

    // Event: emitted for real-card only, characterType and combat derived from canonical unit
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("cardMoved");
    expect(events[0].payload.card).toEqual(realCard);
    expect(events[0].payload.characterType).toBe("soldier");
    expect(events[0].payload.combat?.role).toBe("attacker");
  });

  it("51. Canonical Authority: Spoofed caller Unit with malformed cards does not poison valid canonical State Unit movement", () => {
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);
    const realCard = { id: "real-card", suit: "spade", rank: "5" };

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [
            {
              unitId: "unit-a",
              componentId: "character.soldier",
              state: "charge",
              cards: [realCard],
            },
          ],
        },
      },
    };

    const malformedCallerUnit = {
      unitId: "unit-a",
      cards: [{ id: "fake", suit: "banana", rank: "999" }],
    };

    expect(() => {
      moveUnitToHand(malformedCallerUnit, "p1", state, mockInterpreter as any, { components: rulePackage.components });
    }).not.toThrow();

    expect(state.players.p1.field).toHaveLength(0);
    expect(state.players.p1.hand).toHaveLength(1);
    expect(state.players.p1.hand[0]).toEqual(realCard);
  });

  it("52. Canonical Authority: Malformed card in canonical State Unit FAILS-CLOSED (no mutation, no events)", () => {
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);

    const state: any = {
      players: {
        p1: {
          hand: [],
          field: [
            {
              unitId: "unit-bad",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "bad-card", suit: "spade", rank: "999" }], // invalid rank!
            },
          ],
        },
      },
    };

    const callerUnit = {
      unitId: "unit-bad",
      cards: [{ id: "valid-card", suit: "spade", rank: "5" }],
    };

    expect(() => {
      moveUnitToHand(callerUnit, "p1", state, mockInterpreter as any, { components: rulePackage.components });
    }).toThrow(/非Canonicalカード/);

    expect(state.players.p1.field).toHaveLength(1);
    expect(state.players.p1.hand).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("53. Explicit Target Resolution: Missing explicit target while context.targetComponent is valid FAILS-CLOSED without silent fallback", () => {
    const exprEval = new ExpressionEvaluator();
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);
    const handler = moveUnitToHandHandler(exprEval, mockInterpreter as any);

    const unitA = {
      unitId: "unit-a",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "ca", suit: "spade", rank: "3" }],
    };

    const state: any = {
      players: {
        p1: {
          field: [unitA],
          hand: [],
        },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: unitA, // Valid Unit A in context
      components: rulePackage.components,
    };

    // Explicit target points to missing unit B
    expect(() => {
      handler({ target: "unit-b", requiredState: "charge" }, context);
    }).toThrow(/見つかりません/);

    // Unit A must remain on field unchanged (NO silent fallback!)
    expect(state.players.p1.field).toHaveLength(1);
    expect(state.players.p1.field[0]).toBe(unitA);
    expect(state.players.p1.hand).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("54. Explicit Target Resolution: Explicit target B is chosen over context.targetComponent A", () => {
    const exprEval = new ExpressionEvaluator();
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);
    const handler = moveUnitToHandHandler(exprEval, mockInterpreter as any);

    const unitA = {
      unitId: "unit-a",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "ca", suit: "spade", rank: "3" }],
    };
    const unitB = {
      unitId: "unit-b",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "cb", suit: "heart", rank: "7" }],
    };

    const state: any = {
      players: {
        p1: {
          field: [unitA, unitB],
          hand: [],
        },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: unitA, // context has A
      components: rulePackage.components,
    };

    // Explicit target specifies B
    handler({ target: "unit-b", requiredState: "charge" }, context);

    // B moved to hand, A remains on field!
    expect(state.players.p1.field).toHaveLength(1);
    expect(state.players.p1.field[0]).toBe(unitA);
    expect(state.players.p1.hand).toHaveLength(1);
    expect(state.players.p1.hand[0].id).toBe("cb");
  });

  it("55. Explicit Target Resolution: Explicit malformed target (null, number, {}, { unitId: '' }) FAILS-CLOSED without fallback", () => {
    const exprEval = new ExpressionEvaluator();
    const mockInterpreter = createMockInterpreter();
    const handler = moveUnitToHandHandler(exprEval, mockInterpreter as any);

    const unitA = {
      unitId: "unit-a",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "ca", suit: "spade", rank: "3" }],
    };

    const state: any = {
      players: {
        p1: {
          field: [unitA],
          hand: [],
        },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: unitA,
      components: rulePackage.components,
    };

    // null
    expect(() => handler({ target: null, requiredState: "charge" }, context)).toThrow(/不正/);
    // number
    expect(() => handler({ target: 123, requiredState: "charge" }, context)).toThrow(/不正/);
    // {}
    expect(() => handler({ target: {}, requiredState: "charge" }, context)).toThrow(/不正/);
    // { unitId: "" }
    expect(() => handler({ target: { unitId: "" }, requiredState: "charge" }, context)).toThrow(/不正/);

    expect(state.players.p1.field).toHaveLength(1);
    expect(state.players.p1.hand).toHaveLength(0);
  });

  it("56. Request Controller Authority: Missing request.controller FAILS-CLOSED without fallback to context.playerKey", () => {
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);
    const handler = moveRequestKeyCardsToHandHandler(mockInterpreter as any);

    const k1 = { id: "k1", suit: "spade", rank: "2" };
    const state: any = {
      players: {
        p1: { hand: [] },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      currentRequest: {
        id: "req-1",
        actionId: "action.unsummons",
        controller: undefined as any, // Missing controller!
        keyCards: [k1],
      } as any,
    };

    expect(() => handler({}, context)).toThrow(/request.controller が無効または未指定です/);
    expect(state.players.p1.hand).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("57. Request Controller Authority: Unknown request.controller ('ghost') FAILS-CLOSED", () => {
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);
    const handler = moveRequestKeyCardsToHandHandler(mockInterpreter as any);

    const k1 = { id: "k1", suit: "spade", rank: "2" };
    const state: any = {
      players: {
        p1: { hand: [] },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      currentRequest: {
        id: "req-1",
        actionId: "action.unsummons",
        controller: "ghost", // Unknown player!
        keyCards: [k1],
      } as any,
    };

    expect(() => handler({}, context)).toThrow(/コントローラーが見つかりません: ghost/);
    expect(state.players.p1.hand).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("58. Request Controller Authority: When request.controller ('p1') != context.playerKey ('p2'), cards return to controller's Hand", () => {
    const events: any[] = [];
    const mockInterpreter = createMockInterpreter(events);
    const handler = moveRequestKeyCardsToHandHandler(mockInterpreter as any);

    const k1 = { id: "k1", suit: "spade", rank: "2" };
    const state: any = {
      players: {
        p1: { hand: [] },
        p2: { hand: [] },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p2", // Context player is p2
      currentRequest: {
        id: "req-1",
        actionId: "action.unsummons",
        controller: "p1", // Request controller is p1
        keyCards: [k1],
      } as any,
    };

    handler({}, context);

    // p1 hand gets the card, p2 hand remains empty!
    expect(state.players.p1.hand).toHaveLength(1);
    expect(state.players.p1.hand[0]).toEqual(k1);
    expect(state.players.p2.hand).toHaveLength(0);

    expect(events).toHaveLength(1);
    expect(events[0].payload.playerKey).toBe("p1");
  });

  it("59. GameSession E2E: Full Unsummons lifecycle with drive target: target stays on field, key cards return to hand, chance returns to turnPlayer", () => {
    const k1 = { id: "k1", suit: "spade", rank: "4" };
    const k2 = { id: "k2", suit: "spade", rank: "8" };
    const soldierCard = { id: "solc", suit: "diamond", rank: "5" };
    const bulwarkCard = { id: "bwc", suit: "heart", rank: "7" };

    const driveSoldier = {
      unitId: "my-drive-soldier",
      componentId: "character.soldier",
      state: "drive", // Target is in drive state
      cards: [soldierCard],
    };
    const paymentBulwark = {
      unitId: "my-bulwark",
      componentId: "character.bulwark",
      state: "charge",
      cards: [bulwarkCard],
    };

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [k1, k2],
          field: [paymentBulwark, driveSoldier],
          life: [{ id: "lp1", suit: "spade", rank: "A" }],
          grave: [],
          fog: [],
        },
        p2: {
          hand: [],
          field: [],
          life: [{ id: "lp2", suit: "heart", rank: "A" }],
          grave: [],
          fog: [],
        },
      },
      stage: { requests: [], history: [] },
      turnCount: 1,
      phase: "main",
    };

    const session = new GameSession(state, rulePackage);

    // Step 1: P1 requests Unsummons targeting driveSoldier
    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.playerId).toBe("p1");

    // Find pattern that targets my-drive-soldier
    const unsummonsIdx = step.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = step.request.catalog.actions[p.actionSelectionRef];
      if (act?.actionId !== "action.unsummons") return false;
      if (p.targetSelectionRef === undefined) return false;
      const targetSel = step.request.catalog.targetSelections[p.targetSelectionRef];
      return targetSel?.targetUnitId === "my-drive-soldier";
    });
    expect(unsummonsIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: unsummonsIdx,
    });

    // Cost B paid: bulwark is drive
    expect(paymentBulwark.state).toBe("drive");
    expect(state.stage.requests).toHaveLength(1);

    // P1 pass
    const passIdx1 = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passIdx1,
    });

    // P2 pass -> resolves!
    const passIdx2 = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passIdx2,
    });

    // Resolution:
    // 1. Target driveSoldier REMAINS on Field in drive state (moveUnitToHand was no-op)
    expect(state.players.p1.field).toHaveLength(2);
    expect(driveSoldier.state).toBe("drive");

    // 2. Both key cards returned to Hand
    expect(state.players.p1.hand).toHaveLength(2);
    const handIds = state.players.p1.hand.map((c: any) => c.id);
    expect(handIds).toContain("k1");
    expect(handIds).toContain("k2");

    // 3. Stage cleared
    expect(state.stage.requests).toHaveLength(0);

    // 4. Chance returns to turnPlayer (p1)
    expect(state.chancePlayer).toBe("p1");
  });

  // ===========================================================================
  // 15. Generic Engine Guard
  // ===========================================================================
  it("60. Generic Engine Guard: tools/simulator/src/engine contains ZERO occurrences of 'action.unsummons'", () => {
    const engineDir = path.resolve(__dirname, "../../engine");
    const grepEngine = (dir: string): string[] => {
      const results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results.push(...grepEngine(fullPath));
        } else if (file.endsWith(".ts")) {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (content.includes("action.unsummons")) {
            results.push(fullPath);
          }
        }
      }
      return results;
    };

    const matches = grepEngine(engineDir);
    expect(matches).toEqual([]);
  });
});
