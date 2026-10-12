import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { bookSections, firstGameSections, nextSection, sectionFromHash, unlockThrough } from "../src/data/book";
import layout from "../src/data/book-layout.json";
import { learningPath } from "../src/data/lessons";
import { validateBookLayout } from "../src/lib/book-schema.mjs";
import { bookStorageKey, loadBookProgress } from "../src/lib/book-storage";
import { finish, hash, next, section } from "./book-helpers";

const route = ["about", "game-purpose", "board-overview", "orientation", "unblocked-attack", "first-battle", "bulwark-block", "soldier", "pass-turn", "first-game-ready", "entry16", "real-game"];
describe("最初の1ゲームを始める導線", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("12項目のおすすめ順で進み、応用・Referenceを分母に含めない", () => {
    expect(firstGameSections.map((s) => s.id)).toEqual(route);
    route.slice(0, -1).forEach((id, index) => expect(nextSection(id)?.id).toBe(route[index + 1]));
    expect(nextSection("real-game")).toBeUndefined();
    expect(nextSection("bulwark")).toBeUndefined();
    expect(nextSection("unknown")).toBeUndefined();
    expect(bookSections.filter((s) => s.lesson?.status === "pending")).toHaveLength(20);
    expect(bookSections.find((s) => s.id === "reading-actions")?.track).toBe("reference");
  });
  it("レイアウトschemaは重複・欠落・未知ID・準備中のmain化・順序破壊を拒否する", () => {
    expect(validateBookLayout(layout, learningPath.lessons)).toEqual([]);
    const bad = structuredClone(layout);
    bad.tracks[0].sectionIds.push("up", "unknown", "about");
    bad.tracks[0].sectionIds.splice(2, 1);
    const errors = validateBookLayout(bad, learningPath.lessons);
    expect(errors).toContain("Pending section in first-game: up");
    expect(errors).toContain("Duplicate book section: about");
    expect(errors).toContain("Unknown book section: unknown");
    expect(errors).toContain("Missing book section: board-overview");
    expect(errors).toContain("Board must follow game-purpose");
    expect(validateBookLayout(null, learningPath.lessons)).not.toEqual([]);
    expect(validateBookLayout({ schemaVersion: 1, tracks: [null] }, learningPath.lessons)).not.toEqual([]);
  });
  it("初回目次はまず遊ぶだけ展開し、応用は展開すると直行できる", () => {
    render(<App />);
    const main = document.querySelector('[data-track="first-game"]')!;
    const advanced = document.querySelector('[data-track="learn-more"]')!;
    const reference = document.querySelector('[data-track="reference"]')!;
    expect(main).toHaveAttribute("open"); expect(advanced).not.toHaveAttribute("open"); expect(reference).not.toHaveAttribute("open");
    expect(within(advanced as HTMLElement).getByText("カウンター")).not.toBeVisible();
    fireEvent.click(advanced.querySelector("summary")!);
    fireEvent.click(within(advanced as HTMLElement).getByRole("button", { name: /カウンター/ }));
    expect(section("counter")).toBeVisible();
    expect(document.querySelectorAll("[data-section-id]")).toHaveLength(1);
    expect(section("counter")).toHaveTextContent("準備中");
  });
  it("序盤はEntry16体系図・高度用語を見せず、定義は解説の中に残す", () => {
    hash("unblocked-attack"); render(<App />);
    expect(section("entry16")).toBeNull();
    expect(screen.queryByLabelText("段階的な遊び方")).toBeNull();
    for (const element of document.querySelectorAll(".section-summary,.interaction-guide,.micro-trail"))
      expect(element).not.toHaveTextContent(/リクエスト|ステージ|チャンス|誘発|\bAP\b|\bNAP\b|fixture|actionId/);
    const details = section("unblocked-attack").querySelector(".lesson-definitions")!;
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(details.querySelector("summary")!);
    expect(within(details as HTMLElement).getAllByRole("link").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "ルール早見" })).not.toHaveClass("primary-button");
  });
  it("画面の基本操作からmilestone→Entry16→実物へ進み、応用は強制しない", () => {
    render(<App />); fireEvent.click(screen.getByRole("button", { name: "はじめる ↓" }));
    for (const id of ["about", "game-purpose", "board-overview", "orientation"]) next(id);
    for (const id of ["unblocked-attack", "first-battle", "bulwark-block", "soldier", "pass-turn"]) { finish(id); next(id); }
    const milestone = section("first-game-ready");
    expect(milestone).toHaveTextContent("ここまで分かれば、まず遊べます");
    expect(screen.getByLabelText("まず遊ぶの進捗")).toHaveTextContent("9 / 12");
    fireEvent.click(within(milestone).getByRole("button", { name: "実物カードで遊ぶ →" }));
    expect(section("entry16")).toHaveTextContent("1人16枚だけ");
    expect(section("entry16")).toHaveTextContent("正式には「ライト＋エントリー16」");
    expect(screen.getByLabelText("段階的な遊び方")).not.toBeVisible();
    next("entry16"); expect(section("real-game")).toBeInTheDocument();
    expect(section("bulwark")).toBeNull(); expect(section("reading-actions")).toBeNull(); expect(section("up")).toBeNull();
  });
  it.each(["unblocked-attack", "first-battle", "bulwark-block", "soldier", "pass-turn"])("%sの操作前本文には体系用語を出さない", (id) => {
    hash(id); render(<App />);
    for (const element of section(id).querySelectorAll(".section-summary,.interaction-guide,.micro-trail"))
      expect(element).not.toHaveTextContent(/リクエスト|ステージ|チャンス|誘発|\bAP\b|\bNAP\b|fixture|actionId/);
  });
  it("応用完了は初戦の進捗を増やさず、milestoneの補助CTAから使える", () => {
    hash("first-game-ready"); render(<App />);
    fireEvent.click(within(section("first-game-ready")).getByRole("button", { name: "もう少しルールを覚える" }));
    const progress = screen.getByLabelText("まず遊ぶの進捗").textContent;
    finish("bulwark"); expect(screen.getByLabelText("まず遊ぶの進捗")).toHaveTextContent(progress!);
    expect(JSON.parse(localStorage.getItem(bookStorageKey)!).completedIds).toContain("bulwark");
  });
  it("Referenceの読了も記録できるが、初戦の進捗と自動導線は増やさない", () => {
    hash("reading-actions"); render(<App />);
    fireEvent.click(within(section("reading-actions")).getByRole("button", { name: "読み終えた" }));
    expect(JSON.parse(localStorage.getItem(bookStorageKey)!).completedIds).toContain("reading-actions");
    expect(screen.getByLabelText("まず遊ぶの進捗")).toHaveTextContent("0 / 12");
    expect(section("real-game")).toBeNull();
  });
  it.each(["", "#entry16"])("旧entry16の保存は%sから再開しても大量解放しない", (urlHash) => {
    const saved = { lastSectionId: "entry16", unlockedIds: ["about", "game-purpose", "entry16"], completedIds: ["about", "game-purpose"] };
    localStorage.setItem(bookStorageKey, JSON.stringify(saved));
    expect(loadBookProgress(localStorage)).toEqual(saved);
    window.history.replaceState(null, "", "/" + urlHash);
    render(<App />);
    expect(document.querySelectorAll("[data-section-id]")).toHaveLength(3);
    expect(JSON.parse(localStorage.getItem(bookStorageKey)!)).toEqual(saved);
  });
  it("順序変更前の後方到達・完了も保存し、旧hashを全て解決する", () => {
    const saved = { lastSectionId: "soldier", unlockedIds: ["about", "entry16", "bulwark", "up", "soldier"], completedIds: ["entry16", "bulwark"] };
    localStorage.setItem(bookStorageKey, JSON.stringify(saved));
    expect(loadBookProgress(localStorage)).toEqual(saved);
    for (const id of ["about", "game-purpose", "entry16", "board", "orientation", "unblocked-attack", "soldier-block"]) expect(sectionFromHash("#" + id)).toBeDefined();
    expect(unlockThrough("counter", ["entry16", "bulwark"])).toEqual(expect.arrayContaining(["entry16", "bulwark", "counter"]));
    expect(unlockThrough("counter")).toEqual(["counter"]);
  });
  it("実物の対戦開始後は応用を強制せず、準備中とReferenceを選べる", () => {
    hash("real-game"); render(<App />);
    for (let i = 0; i < 6; i++) fireEvent.click(within(section("real-game")).getAllByRole("button", { name: /準備できた/ }).at(-1)!);
    fireEvent.click(screen.getByRole("radio", { name: "PLAYER A" }));
    for (let i = 0; i < 2; i++) fireEvent.click(within(section("real-game")).getAllByRole("button", { name: /準備できた/ }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "対戦を始める" }));
    const choices = document.getElementById("after-game")!;
    expect(choices).toHaveTextContent("基本の対戦準備ができました");
    expect(within(choices).getByRole("button", { name: /魔法を覚える/ })).toHaveTextContent("準備中");
    expect(within(choices).getAllByRole("link").length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(within(choices).getByRole("button", { name: "ルール早見を見る" }));
    expect(screen.getByRole("dialog", { name: "ルール早見" })).toBeVisible();
  });
});
