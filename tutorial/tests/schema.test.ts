import { describe, expect, it } from "vitest";
import scenario from "../src/data/tutorials/entry16.json";
import { ruleCatalog } from "../src/generated/ruleCatalog";
import { validateScenario } from "../src/lib/schema";
describe("tutorial schema", () => {
  it("全データのschema・参照・盤面連続性が正しい", () =>
    expect(validateScenario(scenario, ruleCatalog)).toEqual([]));
  it.each(["action.unknown", "character.unknown", "fog.unknown"])(
    "不明な参照 %s を拒否",
    (ref) => {
      const value = structuredClone(scenario);
      value.steps[0].ruleRefs = [ref];
      expect(validateScenario(value, ruleCatalog)).toContain(
        "Tutorial references unknown rule: " + ref,
      );
    },
  );
  it.each(["format", "frame"])("不明な %s を拒否", (key) => {
    const value = {
      ...scenario,
      regulation: { ...scenario.regulation, [key]: "unknown" },
    };
    expect(validateScenario(value, ruleCatalog)).toContain(
      "Tutorial references unknown rule: " + key + ".unknown",
    );
  });
  it("壊れた値で例外を投げず検証エラーにする", () => {
    for (const value of [
      null,
      {},
      { steps: "wrong" },
      { steps: [null] },
      { ...scenario, steps: [{ actor: "C", board: {} }] },
    ])
      expect(validateScenario(value, ruleCatalog).length).toBeGreaterThan(0);
  });
  it("actorと盤面の欠落を拒否", () => {
    const value = structuredClone(scenario);
    value.steps[1].actor = "invalid";
    value.steps[1].board.after.A.hand[0].state = "invalid";
    expect(validateScenario(value, ruleCatalog)).toContain("Invalid actor");
    expect(validateScenario(value, ruleCatalog)).toContain(
      "Invalid board card",
    );
  });
  it("固定盤面の接続が切れた場合を拒否", () => {
    const value = structuredClone(scenario);
    value.steps[4].board.before.A.life = [];
    expect(validateScenario(value, ruleCatalog)).toContain(
      "Fixed board continuity is broken",
    );
  });
  it("存在しない移動対象カードを拒否", () => {
    const value = structuredClone(scenario);
    value.steps[4].operations[0].cards = ["HK"];
    expect(validateScenario(value, ruleCatalog)).toContain(
      "Operation card is absent from its board",
    );
  });
  it("固定練習はEntry16のカードのみ、準備後は各自16枚を維持", () => {
    const deck = new Set(
      scenario.steps.find((s) => s.id === "real-deck")!.checklist,
    );
    for (const step of scenario.steps.filter((s) => s.mode === "fixed"))
      for (const board of [step.board.before, step.board.after])
        for (const player of [board.A, board.B])
          for (const cards of Object.values(player))
            for (const c of cards) expect(deck.has(c.card)).toBe(true);
    for (const step of scenario.steps.filter((s) => s.chapter === "practice"))
      for (const player of [step.board.after.A, step.board.after.B])
        expect(Object.values(player).flat()).toHaveLength(16);
  });
  it("先攻決定と開始時ドローが通常対戦前に存在する", () => {
    const ids = scenario.steps.map((s) => s.id);
    expect(ids.indexOf("first-player")).toBeLessThan(ids.indexOf("start-draw"));
    expect(ids.indexOf("start-draw")).toBeLessThan(ids.indexOf("free-play"));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("welcome");
    expect(ids.at(-1)).toBe("free-play");
  });
  it("通常準備ではランダムなカードを決めつけない", () => {
    for (const step of scenario.steps.filter((s) => s.mode === "real"))
      for (const b of [step.board.before, step.board.after])
        expect(Object.values(b.A).flat()).toHaveLength(0);
  });
});
