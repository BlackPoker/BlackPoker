import { describe, expect, it } from "vitest";
import scenario from "../data/tutorials/entry16.json";
import { ruleCatalog } from "../generated/ruleCatalog";
import { validateScenario } from "../lib/schema";

describe("tutorial schema", () => {
  it("ライト＋エントリー16を正規ルールIDに対して読み込める", () => {
    expect(validateScenario(scenario, ruleCatalog)).toEqual([]);
  });

  it("存在しないaction IDを検出する", () => {
    const broken = structuredClone(scenario);
    broken.steps[0].ruleRefs = ["action.unknown"];
    expect(validateScenario(broken, ruleCatalog)).toContain("Tutorial references unknown rule: action.unknown");
  });

  it.each([
    ["format", { format: "unknown", frame: "entry16" }, "Tutorial references unknown rule: format.unknown"],
    ["frame", { format: "lite", frame: "unknown" }, "Tutorial references unknown rule: frame.unknown"],
  ])("存在しない%s参照を検出する", (_kind, regulation, message) => {
    const broken = { ...scenario, regulation };
    expect(validateScenario(broken, ruleCatalog)).toContain(message);
  });

  it("step IDが一意で順序を持つ", () => {
    const ids = scenario.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("welcome");
    expect(ids.at(-1)).toBe("free-play");
  });
});
