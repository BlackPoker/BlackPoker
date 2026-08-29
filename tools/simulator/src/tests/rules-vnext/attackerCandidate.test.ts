import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { hasUnitLabel, isLegalAttackerCandidate, isLegalBlockerCandidate } from "../../engine/rules/characterUtils";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Attacker Candidate and Label Validation Test", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should recognize soldier as having both attack and defense labels from properties.labels", () => {
    const soldierComp = rulePackage.components.find((c) => c.id === "character.soldier");
    expect(soldierComp).toBeDefined();

    const soldierUnit = {
      unitId: "soldier-1",
      componentId: "character.soldier",
      state: "charge",
      face: "up",
      cards: [{ id: "c1", suit: "S", rank: "A", value: 1 }],
      enteredTurn: 1,
    };

    expect(hasUnitLabel(soldierUnit, "攻撃", rulePackage.components)).toBe(true);
    expect(hasUnitLabel(soldierUnit, "attack", rulePackage.components)).toBe(true);
    expect(hasUnitLabel(soldierUnit, "防御", rulePackage.components)).toBe(true);
    expect(hasUnitLabel(soldierUnit, "defense", rulePackage.components)).toBe(true);

    expect(isLegalAttackerCandidate(soldierUnit, rulePackage.components)).toBe(true);
    expect(isLegalBlockerCandidate(soldierUnit, rulePackage.components)).toBe(true);
  });

  it("should recognize bulwark as having defense label ONLY (not attack) from properties.labels", () => {
    const bulwarkComp = rulePackage.components.find((c) => c.id === "character.bulwark");
    expect(bulwarkComp).toBeDefined();

    const bulwarkUnit = {
      unitId: "bulwark-1",
      componentId: "character.bulwark",
      state: "charge",
      face: "down",
      cards: [{ id: "c2", suit: "H", rank: "7", value: 7 }],
      enteredTurn: 1,
    };

    expect(hasUnitLabel(bulwarkUnit, "攻撃", rulePackage.components)).toBe(false);
    expect(hasUnitLabel(bulwarkUnit, "attack", rulePackage.components)).toBe(false);
    expect(hasUnitLabel(bulwarkUnit, "防御", rulePackage.components)).toBe(true);
    expect(hasUnitLabel(bulwarkUnit, "defense", rulePackage.components)).toBe(true);

    // 防壁はアタッカー候補にならない
    expect(isLegalAttackerCandidate(bulwarkUnit, rulePackage.components)).toBe(false);
    // 防壁はブロッカー候補になる
    expect(isLegalBlockerCandidate(bulwarkUnit, rulePackage.components)).toBe(true);
  });


  it("should filter out bulwarks when finding selectable attack candidate units", () => {
    const registry = new CommandRegistry();
    const effectInterpreter = registry.getEffectInterpreter();


    const soldierUnit = {
      unitId: "soldier-1",
      componentId: "character.soldier",
      state: "charge",
      face: "up",
      cards: [],
      enteredTurn: 1,
    };

    const bulwarkUnit = {
      unitId: "bulwark-1",
      componentId: "character.bulwark",
      state: "charge",
      face: "down",
      cards: [],
      enteredTurn: 1,
    };

    const state: any = {
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          field: [soldierUnit, bulwarkUnit],
        },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      components: rulePackage.components,
      actions: rulePackage.actions,
    };

    // アタック用ユニット選択フィルター (type: character, condition: { state: charge, label: attack })
    const selectable = effectInterpreter.findSelectableUnits(
      {
        zone: "field",
        type: "character",
        relation: "self",
        condition: {
          state: "charge",
          label: "attack",
        },
      },
      context,
      "p1"
    );

    expect(selectable.length).toBe(1);
    expect(selectable[0].unitId).toBe("soldier-1");
  });

  it("should reject startAttack when targeting a bulwark unit directly", () => {
    const registry = new CommandRegistry();

    const bulwarkUnit = {
      unitId: "bulwark-1",
      componentId: "character.bulwark",
      state: "charge",
      face: "down",
      cards: [],
      enteredTurn: 1,
    };

    const state: any = {
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          field: [bulwarkUnit],
        },
        p2: {
          field: [],
        },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      components: rulePackage.components,
      actions: rulePackage.actions,
    };

    // 防壁をアタッカーとして startAttack を呼ぶと拒否される
    expect(() => {
      registry.execute("startAttack", { attackers: ["bulwark-1"], defender: "p2" }, context);
    }).toThrow(/攻撃ラベルを持たないキャラクターはアタッカーに指定できません/);
  });
});
