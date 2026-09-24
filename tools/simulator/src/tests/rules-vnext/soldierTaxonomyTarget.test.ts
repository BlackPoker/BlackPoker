import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { evaluateUnitTargetCondition } from "../../engine/rules/targetConditionUtils";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { formatActionSummary } from "../../engine/rules/formatActionSummary";

describe("Soldier Target Taxonomy & Magician Up Regression Tests (BP-SIM-RULE-TARGET-1.0)", () => {
  let rulePackage: RulePackage;
  let registry: CommandRegistry;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    registry = new CommandRegistry();
  });

  it("Reproduction: Attacking drive Magician should be targetable by Quick Up during DamageJudge", () => {
    const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
    expect(upAction).toBeDefined();

    const magicianCard = { id: "joker-1", suit: "J", rank: "Joker", value: 0 };
    const heartKeyCard = { id: "h-7", suit: "H", rank: "7", value: 7 };

    const state: any = {
      stateVersion: 1,
      regulationId: "standard-pack",
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      stage: {
        requests: [
          {
            id: "req-dj-1",
            actionId: "action.damageJudge",
            type: "damageJudge",
            timing: "damageJudge",
            controller: "p1",
          },
        ],
      },
      players: {
        p1: {
          name: "Player A",
          life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
          hand: [heartKeyCard],
          field: [
            {
              unitId: "magician-unit-1",
              kind: "魔術士",
              componentId: "character.magician",
              state: "drive",
              cards: [magicianCard],
              labels: ["攻撃", "防御", "速攻"],
              battle: {
                role: "attacker",
              },
            },
          ],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [{ id: "l2", suit: "S", rank: "3", value: 3 }],
          hand: [],
          field: [
            {
              unitId: "bulwark-p2-1",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "charge",
              cards: [{ id: "bw-c", suit: "C", rank: "4", value: 4 }],
              labels: ["防御"],
            },
          ],
          grave: [],
          fog: [],
        },
      },
    };

    // 1. TargetSelectionEnumerator 単体での検証
    const targets = TargetSelectionEnumerator.enumerateTargets(
      upAction,
      state,
      "p1",
      rulePackage.components
    );
    const magicianTarget = targets.find((t) => t.targetUnitId === "magician-unit-1");
    expect(magicianTarget).toBeDefined();

    // 2. LegalPatternGenerator を通したフルパイプライン検証 (cost modifier + timing + target)
    const { request: decisionReq } = LegalPatternGenerator.generateActionRequestDecision(
      state,
      "p1",
      rulePackage
    );

    const upPatterns = decisionReq.patterns.filter((p) => {
      if (p.kind !== "ACTION") return false;
      const actEntry = decisionReq.catalog.actions[p.actionSelectionRef!];
      return actEntry?.actionId === "action.up";
    });

    expect(upPatterns.length).toBeGreaterThan(0);

    const magicianUpPattern = upPatterns.find((p) => {
      const targetEntry = decisionReq.catalog.targetSelections[p.targetSelectionRef!];
      return targetEntry?.targetUnitId === "magician-unit-1";
    });

    expect(magicianUpPattern).toBeDefined();
  });

  describe("Table-Driven Taxonomy Verification: All character components against Up and Down", () => {
    const testUnits = [
      { componentId: "character.soldier", expectedTaxonomy: "soldier", shouldBeTargetable: true },
      { componentId: "character.hero", expectedTaxonomy: "soldier", shouldBeTargetable: true },
      { componentId: "character.ace", expectedTaxonomy: "soldier", shouldBeTargetable: true },
      { componentId: "character.magician", expectedTaxonomy: "soldier", shouldBeTargetable: true },
      { componentId: "character.armedSoldier", expectedTaxonomy: "soldier", shouldBeTargetable: true },
      { componentId: "character.bulwark", expectedTaxonomy: "bulwark", shouldBeTargetable: false },
    ];

    for (const testCase of testUnits) {
      it(`action.up: ${testCase.componentId} (taxonomy: ${testCase.expectedTaxonomy}) -> targetable: ${testCase.shouldBeTargetable}`, () => {
        const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
        const comp = rulePackage.components.find((c) => c.id === testCase.componentId);
        expect(comp).toBeDefined();
        expect(comp?.properties?.characterType).toBe(testCase.expectedTaxonomy);

        const targetCond = upAction.targets![0].condition;
        const mockUnit = {
          unitId: `unit-${testCase.componentId}`,
          componentId: testCase.componentId,
          state: "charge",
          cards: [{ id: "c-1", suit: "S", rank: "5", value: 5 }],
        };

        const result = evaluateUnitTargetCondition(mockUnit, targetCond, {
          components: rulePackage.components,
        });

        expect(result.isValid).toBe(testCase.shouldBeTargetable);

        // TargetSelectionEnumerator による列挙検証
        const state: any = {
          players: {
            p1: {
              field: [mockUnit],
            },
          },
        };
        const targets = TargetSelectionEnumerator.enumerateTargets(
          upAction,
          state,
          "p1",
          rulePackage.components
        );
        const enumerated = targets.some((t) => t.targetUnitId === mockUnit.unitId);
        expect(enumerated).toBe(testCase.shouldBeTargetable);
      });

      it(`action.down: ${testCase.componentId} (taxonomy: ${testCase.expectedTaxonomy}) -> targetable: ${testCase.shouldBeTargetable}`, () => {
        const downAction = rulePackage.actions.find((a) => a.id === "action.down")!;
        const targetCond = downAction.targets![0].condition;
        const mockUnit = {
          unitId: `unit-${testCase.componentId}`,
          componentId: testCase.componentId,
          state: "charge",
          cards: [{ id: "c-1", suit: "S", rank: "5", value: 5 }],
        };

        const result = evaluateUnitTargetCondition(mockUnit, targetCond, {
          components: rulePackage.components,
        });

        expect(result.isValid).toBe(testCase.shouldBeTargetable);

        // TargetSelectionEnumerator による列挙検証
        const state: any = {
          players: {
            p1: {
              field: [mockUnit],
            },
          },
        };
        const targets = TargetSelectionEnumerator.enumerateTargets(
          downAction,
          state,
          "p1",
          rulePackage.components
        );
        const enumerated = targets.some((t) => t.targetUnitId === mockUnit.unitId);
        expect(enumerated).toBe(testCase.shouldBeTargetable);
      });
    }
  });

  describe("Parity & Format Verification", () => {
    it("formatActionSummary outputs '対象: 兵士1体' for up and down", () => {
      const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
      const downAction = rulePackage.actions.find((a) => a.id === "action.down")!;

      expect(formatActionSummary(upAction)).toContain("対象: 兵士1体");
      expect(formatActionSummary(downAction)).toContain("対象: 兵士1体");
    });

    it("Up effect applies size modifier on Magician", () => {
      const upAction = rulePackage.actions.find((a) => a.id === "action.up")!;
      const magicianUnit = {
        unitId: "mag-1",
        componentId: "character.magician",
        state: "charge",
        cards: [{ id: "j-1", suit: "J", rank: "Joker", value: 0 }],
      };
      const state: any = {
        players: {
          p1: {
            name: "Player A",
            field: [magicianUnit],
            fog: [],
          },
        },
      };

      const keyCard = { id: "h-5", suit: "H", rank: "5", value: 5 };
      const ctx: CommandContext = {
        state,
        playerKey: "p1",
        keyCard,
        targetComponent: magicianUnit,
      };

      registry.executeEffects(upAction.effect, ctx);

      expect(state.players.p1.fog.length).toBe(1);
      expect(state.players.p1.fog[0].componentId).toBe("fog.up");
      expect(state.players.p1.fog[0].bindings.amount).toBe(5);
      expect(state.players.p1.fog[0].bindings.target).toBe("mag-1");
    });

    it("Down effect moves non-standard soldier to graveyard when size <= 0", () => {
      const downAction = rulePackage.actions.find((a) => a.id === "action.down")!;
      const heroUnit = {
        unitId: "hero-1",
        componentId: "character.hero",
        state: "charge",
        cards: [{ id: "c-1", suit: "C", rank: "5", value: 5 }],
      };

      const state: any = {
        players: {
          p1: {
            name: "Player A",
            field: [heroUnit],
            grave: [],
            fog: [],
          },
        },
      };

      const keyCard = { id: "s-7", suit: "S", rank: "7", value: 7 }; // spade 7 reduces size 5 to <= 0
      const ctx: CommandContext = {
        state,
        playerKey: "p1",
        keyCard,
        targetComponent: heroUnit,
      };

      registry.executeEffects(downAction.effect, ctx);

      // Hero should be in graveyard, field empty, no fog
      expect(state.players.p1.field.length).toBe(0);
      expect(state.players.p1.grave.length).toBe(1);
      expect(state.players.p1.grave[0].unitId).toBe("hero-1");
      expect(state.players.p1.fog.length).toBe(0);
    });
  });
});

