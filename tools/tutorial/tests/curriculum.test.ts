import { describe, expect, it } from "vitest";
import { learningPath, entryScenario, bulwarkScenario, legacyLesson, lessonById } from "../src/data/lessons";
import { ruleCatalog } from "../src/generated/ruleCatalog";
import { validateCurriculum, youtubeEmbed } from "../src/lib/curriculum-schema.mjs";
import { validateScenario } from "../src/lib/schema.mjs";
import { deriveInteractions, interactionBoard } from "../src/lib/interaction.mjs";
import { loadLessonProgress, saveLessonProgress, lessonStorageKey } from "../src/lib/lesson-storage";

const validate = (data: unknown) => validateCurriculum(data, ruleCatalog, [entryScenario, bulwarkScenario]);
describe("現行YAMLに基づくLesson構造", () => {
  it("推奨入口は盤面→攻撃→兵士ブロック→防壁、前提は強制ロックにしない", () => {
    const ids = ["board-overview", "unblocked-attack", "first-battle", "bulwark-block"];
    expect(learningPath.lessons.slice(0, 4).map((l) => l.id)).toEqual(ids);
    ids.forEach((id, index) => {
      expect(lessonById(id).optional).not.toBe(true);
      expect(lessonById(id).prerequisites).toEqual(index ? [ids[index - 1]] : []);
    });
    expect(learningPath.lessons.findIndex((l) => l.id === "equal-numbers")).toBeLessThan(learningPath.lessons.findIndex((l) => l.id === "soldier"));
    expect(lessonById("unblocked-attack").explainer).toMatchObject({ type: "flow", items: [
      { title: "アタック" }, { title: "ブロック", text: expect.stringContaining("指定しません") }, { title: "ダメージ判定" },
    ] });
  });
  it("ブロッカーの防壁は裏向き・チャージで、宣言してもドライブしない", () => {
    const [choose, reveal] = bulwarkScenario.steps;
    for (const phase of ["before", "after"] as const)
      expect(choose.board[phase].A.bulwarks[0]).toMatchObject({ face: "down", state: "charge" });
    expect(reveal.board.after.A.bulwarks[0]).toMatchObject({ face: "up", state: "charge" });
    expect(bulwarkScenario.steps.at(-1)!.board.after.A.life).toEqual(choose.board.before.A.life);
  });
  it.each([bulwarkScenario, entryScenario])("ドライブ状態の防壁・兵士をブロッカーにする教材を拒否する", (source) => {
    const invalid = structuredClone(source);
    const step = invalid.steps.find((s) => s.interaction?.kind === "select-target")!;
    const command = deriveInteractions(step)[0];
    if (command.kind !== "select-target") throw new Error("select-target expected");
    for (const phase of ["before", "after"] as const)
      step.board[phase][command.source.player][command.source.zone].find((c) => c.card === command.source.card)!.state = "drive";
    expect(validateScenario(invalid, ruleCatalog)).toContain("Blocker must be charged: " + step.id);
  });
  it("Liteの全IDを1つずつ主担当へ割り当て、再登場はreviewとして明示する", () => {
    expect(validate(learningPath)).toEqual([]);
    expect(learningPath.lessons.flatMap((l) => l.actionIds).sort()).toEqual([...ruleCatalog.formats.lite.actions].sort());
  });
  it.each([
    ["duplicate", "Duplicate lesson id", (data: any) => data.lessons.push(data.lessons[0])],
    ["prerequisite", "Invalid prerequisite", (data: any) => data.lessons[0].prerequisites.push("missing")],
    ["scene", "Unknown scene", (data: any) => data.lessons[0].sceneIds.push("missing")],
    ["coverage", "Missing Lite coverage", (data: any) => data.lessons.find((l: any) => l.id === "unblocked-attack").actionIds.pop()],
    ["owner", "Duplicate action owner", (data: any) => data.lessons[2].actionIds.push("attack")],
    ["explainer", "Invalid explainer", (data: any) => data.lessons[1].explainer.type = "unknown"],
    ["media", "Invalid media", (data: any) => data.lessons[0].media = { type: "youtube", url: "javascript:alert(1)" }],
    ["cycle", "Cyclic prerequisite", (data: any) => data.lessons[0].prerequisites.push("unblocked-attack")],
    ["pending", "Non-ready lesson", (data: any) => data.lessons[0].status = "pending"],
    ["real", "Unknown real step", (data: any) => data.lessons.find((l: any) => l.id === "real-game").realStepIds.push("missing")],
    ["multiple scenes", "one scene", (data: any) => data.lessons[0].sceneIds.push("pass-turn")],
    ["null media", "Invalid media", (data: any) => data.lessons[0].media = null],
    ["null explainer", "Invalid explainer", (data: any) => data.lessons[0].explainer = null],
    ["action shape", "Invalid lesson actionIds", (data: any) => { data.lessons[1].actionIds = {}; }],
  ])("%sを検出する", (_, expected, change) => {
    const data = structuredClone(learningPath); change(data);
    expect(validate(data).join(" ")).toContain(expected);
  });
  it("安全なYouTube URLだけをautoplayなしの埋め込みへ変換する", () => {
    expect(youtubeEmbed("https://youtu.be/abcdefghijk?autoplay=1")).toBe("https://www.youtube-nocookie.com/embed/abcdefghijk");
    expect(youtubeEmbed("https://www.youtube.com/watch?v=abcdefghijk")).toContain("/abcdefghijk");
    for (const url of ["http://youtu.be/abcdefghijk", "https://youtube.com.evil.test/watch?v=abcdefghijk", "https://youtube.com/watch?v=x"]) expect(youtubeEmbed(url)).toBeNull();
    const data = structuredClone(learningPath);
    data.lessons[0].media = { type: "youtube", url: "https://youtu.be/abcdefghijk", title: "テスト動画", note: "参考", edition: "legacy" };
    expect(validate(data)).toEqual([]);
  });
  it("防壁fixtureはEntry16だけで成立し、face公開・同数の攻撃側・防壁を順に処理する", () => {
    expect(validateScenario(bulwarkScenario, ruleCatalog)).toEqual([]);
    const [choose, reveal, attacker, grave] = bulwarkScenario.steps;
    expect(deriveInteractions(choose)[0].kind).toBe("select-target");
    expect(reveal.board.before.A.bulwarks[0].face).toBe("down");
    expect(interactionBoard(reveal, 1).A.bulwarks[0].face).toBe("up");
    expect(attacker.board.after.B.grave.map((c) => c.card)).toContain("C6");
    expect(grave.board.after.A.grave.map((c) => c.card)).toContain("C6");
    const deck = entryScenario.steps.find((s) => s.id === "real-deck")!.checklist!;
    for (const step of bulwarkScenario.steps) for (const phase of ["before", "after"] as const) for (const player of ["A", "B"] as const)
      expect(Object.values(step.board[phase][player]).flat().map((c) => c.card).sort()).toEqual([...deck].sort());
  });
  it("チャンス・誘発は魔法の後、Jokerは別LessonでEntry16へ追加しない", () => {
    expect(learningPath.lessons.findIndex((l) => l.id === "chance")).toBeGreaterThan(learningPath.lessons.findIndex((l) => l.id === "counter"));
    expect(learningPath.lessons.find((l) => l.id === "search")?.category).toBe("extra");
    expect(entryScenario.steps.find((s) => s.id === "real-deck")!.checklist).not.toContain("Joker");
  });
  it("既存6sceneを全て担当し、独立防壁fixtureを作っても元データを変更しない", async () => {
    expect(learningPath.lessons.flatMap((l) => l.sceneIds).sort()).toEqual([...entryScenario.scenes.map((s) => s.id), "bulwark-block"].sort());
    const before = JSON.stringify(entryScenario);
    const { makeBulwarkFixture } = await import("../src/data/bulwark-fixture.mjs");
    const fixture = makeBulwarkFixture(entryScenario);
    fixture.steps[0].board.before.B.life.pop();
    expect(JSON.stringify(entryScenario)).toBe(before);
  });
  it("旧micro保存を復元し、新しい完了集合は準備中を除き復習でも保持する", () => {
    const index = entryScenario.steps.findIndex((s) => s.id === "summon-cost-l");
    expect(legacyLesson(index).id).toBe("soldier");
    localStorage.clear();
    expect(loadLessonProgress(localStorage, index)).toEqual({ lessonId: "soldier", completedIds: [] });
    saveLessonProgress(localStorage, { lessonId: "first-battle", completedIds: ["soldier", "soldier", "up"] });
    expect(loadLessonProgress(localStorage, index).completedIds).toEqual(["soldier"]);
    localStorage.setItem(lessonStorageKey, "{");
    expect(loadLessonProgress(localStorage, index).lessonId).toBe("soldier");
    expect(loadLessonProgress(null, 0).lessonId).toBe("board-overview");
  });
});
