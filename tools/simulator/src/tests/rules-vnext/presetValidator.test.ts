import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { validatePlaytestPreset } from "../../engine/session/playtest/validatePlaytestPreset";

describe("Playtest Preset Validator Tests (Phase 21B.1)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("Test A: should detect invalid soldier card rank (e.g. SK) as validator error", () => {
    const state = createCoreBattlePresetState();
    // Player A の一般兵を不正な ♠K (rank: "K") に書き換え (soldier は "2..10")
    state.players.p1.field.find((u: any) => u.unitId === "soldier-p1-1").cards = [
      { id: "bad-soldier", suit: "S", rank: "K", value: 13 },
    ];

    const result = validatePlaytestPreset(state, rulePackage);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("ランク") && e.includes("character.soldier"))).toBe(true);
  });


  it("Test B: should detect duplicate card (e.g. D4 in both life and field) in the same player as validator error", () => {
    const state = createCoreBattlePresetState();
    // Player A の Life に Field 防壁と同じ D4 を挿入
    state.players.p1.life[2] = { id: "dup-l3", suit: "D", rank: "4", value: 4 };

    const result = validatePlaytestPreset(state, rulePackage);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("重複") && e.includes("D4"))).toBe(true);
  });

  it("Test C: should validate corrected CORE-BATTLE-001 preset successfully", () => {
    const state = createCoreBattlePresetState();
    const result = validatePlaytestPreset(state, rulePackage);

    if (!result.valid) {
      console.error("Validation errors:", result.errors);
    }
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});
