import { describe, expect, it } from "vitest";
import { entryScenario, scenarios, lessonById } from "../src/data/lessons";
import { makeBookFixtures } from "../src/data/book-fixtures.mjs";
import { validateScenario } from "../src/lib/schema.mjs";
import { validateCurriculum } from "../src/lib/curriculum-schema.mjs";
import { learningPath } from "../src/data/lessons";
import { ruleCatalog } from "../src/generated/ruleCatalog";
import { deriveInteractions } from "../src/lib/interaction.mjs";
import { loadBookProgress, saveBookProgress, bookStorageKey } from "../src/lib/book-storage";
import { saveProgress } from "../src/lib/storage";
import { lessonStorageKey } from "../src/lib/lesson-storage";
import { sectionFromHash, unlockThrough } from "../src/data/book";

describe("Aを操作する独立fixture", () => {
  it.each(scenarios)("$idの整合・連続盤面・ユーザー入力のactor/sourceを検証する", (scenario) => {
    expect(validateScenario(scenario, ruleCatalog)).toEqual([]);
    for (const step of scenario.steps.filter((step) => step.mode === "fixed" && step.cause?.phase !== "setup" && !step.automatic)) {
      expect(step.actor).toBe("A");
      for (const command of deriveInteractions(step)) if ("source" in command) expect(command.source.player).toBe("A");
    }
  });
  it("未指定のB操作を検証エラーにし、Bを対象に選ぶ操作は許可する", () => {
    const wall = structuredClone(scenarios.find((s) => s.scenes[0]?.id === "bulwark-block")!);
    expect(wall.steps[0].interaction).toMatchObject({ targetCard: { player: "B" } });
    wall.steps[2].automatic = false;
    expect(validateScenario(wall, ruleCatalog)).toContain("Manual interaction must belong to userPlayer: wall-attacker");
    (wall.steps[0] as any).operations = {};
    expect(validateScenario(wall, ruleCatalog)).toContain("operations must be an array");
  });
  it("防壁設置はL・設置だけで完了、Aの手札から裏・チャージの防壁へ", () => {
    const scenario = scenarios.find((s) => s.scenes[0]?.id === "player-b-turn")!;
    expect(scenario.steps.map((s) => s.id)).toEqual(["set-bulwark-cost-l", "set-bulwark-place"]);
    expect(scenario.steps.map((s) => s.cause?.actionId)).toEqual(["setBulwark", "setBulwark"]);
    const before = scenario.steps[0].board.before.A;
    const after = scenario.steps[1].board.after.A;
    expect(after.life.length).toBe(before.life.length - 1);
    expect(after.grave.length).toBe(before.grave.length + 1);
    expect(after.hand.length).toBe(before.hand.length - 1);
    expect(after.bulwarks.find((c) => c.card === "D8")).toMatchObject({ face: "down", state: "charge" });
    expect(lessonById("bulwark").reviewActionIds).toEqual([]);
  });
  it("防御教材は相手が攻撃済みで、あなたの兵士・防壁はチャージのまま指定する", () => {
    for (const id of ["first-battle", "bulwark-block"]) {
      const scene = scenarios.find((s) => s.scenes[0]?.id === id)!;
      expect(scene.steps[0].board.before.B.soldiers[0]).toMatchObject({ card: "C6", state: "drive" });
      const zone = id === "first-battle" ? "soldiers" : "bulwarks";
      expect(scene.steps[0].board.after.A[zone][0].state).toBe("charge");
    }
  });
  it("元の30操作・実物の開始手順を変更せず、Lite19の担当を維持する", () => {
    const original = JSON.stringify(entryScenario);
    const fixtures = makeBookFixtures(entryScenario);
    expect(JSON.stringify(entryScenario)).toBe(original);
    expect(entryScenario.steps).toHaveLength(30);
    expect(fixtures.find((s) => s.id === "book-real")!.steps).toEqual(entryScenario.steps.filter((s) => s.mode === "real"));
    expect(validateCurriculum(learningPath, ruleCatalog, fixtures)).toEqual([]);
  });
});
describe("book進捗の互換", () => {
  it("新規は表紙、旧30操作は対応Sectionから再開し最高到達を壊さない", () => {
    expect(loadBookProgress(localStorage)).toEqual({ lastSectionId: "cover", unlockedIds: [], completedIds: [] });
    const index = entryScenario.steps.findIndex((s) => s.id === "summon-cost-l");
    saveProgress({ scenarioId: entryScenario.id, stepIndex: index, maxReachedStepIndex: 25, completed: false, updatedAt: "" }, localStorage);
    const saved = localStorage.getItem("blackpoker-tutorial-progress-v1");
    expect(loadBookProgress(localStorage, index).lastSectionId).toBe("soldier");
    expect(localStorage.getItem("blackpoker-tutorial-progress-v1")).toBe(saved);
  });
  it("旧Lessonの完了・現在地を非破壊で移行し、完了した後方Sectionも開く", () => {
    const old = JSON.stringify({ lessonId: "first-battle", completedIds: ["soldier", "first-battle"] });
    localStorage.setItem(lessonStorageKey, old);
    const book = loadBookProgress(localStorage);
    expect(book.lastSectionId).toBe("first-battle");
    expect(book.unlockedIds).toContain("soldier");
    expect(book.completedIds).toContain("soldier");
    saveBookProgress(localStorage, book);
    expect(loadBookProgress(localStorage)).toEqual(book);
    expect(localStorage.getItem(lessonStorageKey)).toBe(old);
  });
  it("不正ID・重複・準備中の完了を除外し、保存不可でも読める", () => {
    localStorage.setItem(bookStorageKey, JSON.stringify({ lastSectionId: "soldier", unlockedIds: ["missing", "soldier", "soldier"], completedIds: ["up", "missing", "about", "about"] }));
    const result = loadBookProgress(localStorage);
    expect(result.unlockedIds).not.toContain("missing");
    expect(result.completedIds).toEqual(["about"]);
    expect(loadBookProgress(null).lastSectionId).toBe("cover");
    expect(() => saveBookProgress({ getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} }, result)).not.toThrow();
  });
  it("hash別名と未到達の直接解放に対応し、大量の準備中を本文へ出さない", () => {
    expect(sectionFromHash("#soldier-block")?.id).toBe("first-battle");
    expect(sectionFromHash("#first-battle")?.id).toBe("first-battle");
    expect(sectionFromHash("#board")?.id).toBe("board-overview");
    expect(sectionFromHash("#unknown")).toBeUndefined();
    expect(unlockThrough("up")).toContain("up");
    expect(unlockThrough("up")).not.toContain("multi-attack");
  });
  it("bookキーが壊れていても旧Lessonの続きから復元する", () => {
    localStorage.setItem(bookStorageKey, "{");
    localStorage.setItem(lessonStorageKey, JSON.stringify({ lessonId: "soldier", completedIds: ["first-battle"] }));
    expect(loadBookProgress(localStorage).lastSectionId).toBe("soldier");
    expect(loadBookProgress(localStorage).completedIds).toContain("first-battle");
  });
});
