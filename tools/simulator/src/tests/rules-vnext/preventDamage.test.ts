import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { CommandContext } from "../../engine/rules/CommandRegistry";

describe("AbilityEvaluator preventDamage Definition-Driven Integration Tests (Phase 19.2)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const createBaseState = () => {
    return {
      stateVersion: 1,
      version: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "l1-1", suit: "S", rank: "2", value: 2 }],
          hand: [],
          field: [
            {
              unitId: "soldier-p1",
              componentId: "character.soldier",
              cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
            },
          ],
          fog: [],
          trump: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [{ id: "l2-1", suit: "C", rank: "5", value: 5 }],
          hand: [],
          field: [
            {
              unitId: "soldier-p2",
              componentId: "character.soldier",
              cards: [{ id: "c2", suit: "H", rank: "6", value: 6 }],
            },
          ],
          fog: [],
          trump: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    } as any;
  };

  it("Test A: Generic preventDamage test (works with custom ComponentDefinition regardless of ID)", () => {
    const abilityEvaluator = new AbilityEvaluator();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-shield",
      componentId: "trump.testShield",
      face: "up",
      zone: "trump",
    });

    const customComponents = [
      {
        id: "trump.testShield",
        name: "テスト防壁",
        type: "trump",
        zone: "trump",
        abilities: [
          {
            preventDamage: {
              target: "self",
              source: {
                requestController: "opponent",
                keyCardsIncludeSuit: "spade",
              },
              condition: {
                exists: {
                  zone: "field",
                  controller: "self",
                  componentType: "character",
                },
              },
            },
          },
        ],
      },
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: { id: "action.attack", name: "アタック" } as any,
      keyCards: [{ id: "k1", suit: "S", rank: "8", value: 8 }],
      components: customComponents as any,
    };

    const prevented = abilityEvaluator.shouldPreventDamage(context);
    expect(prevented).toBe(true);
  });

  it("Test B: AbilityEvaluator does NOT synthesize Fortress without ComponentDefinition", () => {
    const abilityEvaluator = new AbilityEvaluator();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      face: "up",
      zone: "trump",
    });

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: { id: "action.attack", name: "アタック" } as any,
      keyCards: [{ id: "k1", suit: "S", rank: "8", value: 8 }],
      components: [], // 定義を渡さない
    };

    const prevented = abilityEvaluator.shouldPreventDamage(context);
    expect(prevented).toBe(false);
  });

  it("Test C: Works with official Fortress definition from fortress.yaml", () => {
    const abilityEvaluator = new AbilityEvaluator();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      face: "up",
      zone: "trump",
    });

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: { id: "action.attack", name: "アタック" } as any,
      keyCards: [{ id: "k1", suit: "S", rank: "8", value: 8 }],
      components: rulePackage.components,
    };

    const prevented = abilityEvaluator.shouldPreventDamage(context);
    expect(prevented).toBe(true);
  });

  it("Test D: Fortress face down -> should NOT prevent damage", () => {
    const abilityEvaluator = new AbilityEvaluator();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      face: "down", // 裏向き
      zone: "trump",
    });

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: { id: "action.attack", name: "アタック" } as any,
      keyCards: [{ id: "k1", suit: "S", rank: "8", value: 8 }],
      components: rulePackage.components,
    };

    const prevented = abilityEvaluator.shouldPreventDamage(context);
    expect(prevented).toBe(false);
  });

  it("Test E: No characters on field -> should NOT prevent damage", () => {
    const abilityEvaluator = new AbilityEvaluator();
    const state = createBaseState();

    state.players.p2.field = []; // キャラクターなし

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      face: "up",
      zone: "trump",
    });

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: { id: "action.attack", name: "アタック" } as any,
      keyCards: [{ id: "k1", suit: "S", rank: "8", value: 8 }],
      components: rulePackage.components,
    };

    const prevented = abilityEvaluator.shouldPreventDamage(context);
    expect(prevented).toBe(false);
  });

  it("Test F: Keycards do NOT include spade -> should NOT prevent damage", () => {
    const abilityEvaluator = new AbilityEvaluator();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      face: "up",
      zone: "trump",
    });

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: { id: "action.attack", name: "アタック" } as any,
      keyCards: [{ id: "k1", suit: "H", rank: "8", value: 8 }], // ハート (スペードではない)
      components: rulePackage.components,
    };

    const prevented = abilityEvaluator.shouldPreventDamage(context);
    expect(prevented).toBe(false);
  });

  it("Test G: Self-inflicted damage -> should NOT prevent damage (requestController is not opponent)", () => {
    const abilityEvaluator = new AbilityEvaluator();
    const state = createBaseState();

    state.players.p2.trump.push({
      id: "trump-fortress-p2",
      componentId: "trump.fortress",
      face: "up",
      zone: "trump",
    });

    const context: CommandContext = {
      state,
      playerKey: "p2", // 実行者が p2 自身
      targetPlayerKey: "p2",
      currentAction: { id: "action.selfDamage", name: "自傷" } as any,
      keyCards: [{ id: "k1", suit: "S", rank: "8", value: 8 }],
      components: rulePackage.components,
    };

    const prevented = abilityEvaluator.shouldPreventDamage(context);
    expect(prevented).toBe(false);
  });

  it("Test H: Supports player.trump array", () => {
    const abilityEvaluator = new AbilityEvaluator();
    const state = createBaseState();

    state.players.p2.trump = [
      {
        id: "trump-fortress-p2",
        componentId: "trump.fortress",
        face: "up",
        zone: "trump",
      },
    ];
    delete state.players.p2.trumps;

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: { id: "action.attack", name: "アタック" } as any,
      keyCards: [{ id: "k1", suit: "S", rank: "8", value: 8 }],
      components: rulePackage.components,
    };

    const prevented = abilityEvaluator.shouldPreventDamage(context);
    expect(prevented).toBe(true);
  });

  it("Test I: Supports player.trumps array", () => {
    const abilityEvaluator = new AbilityEvaluator();
    const state = createBaseState();

    state.players.p2.trumps = [
      {
        id: "trump-fortress-p2",
        componentId: "trump.fortress",
        face: "up",
        zone: "trump",
      },
    ];
    delete state.players.p2.trump;

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      currentAction: { id: "action.attack", name: "アタック" } as any,
      keyCards: [{ id: "k1", suit: "S", rank: "8", value: 8 }],
      components: rulePackage.components,
    };

    const prevented = abilityEvaluator.shouldPreventDamage(context);
    expect(prevented).toBe(true);
  });
});
