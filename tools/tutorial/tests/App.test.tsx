import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { entryScenario } from "../src/data/lessons";
import { bookStorageKey } from "../src/lib/book-storage";
import { lessonStorageKey } from "../src/lib/lesson-storage";
import { loadProgress, saveProgress, saveIntroComplete } from "../src/lib/storage";
import { section, card, zone, tap, move, destination, wait, automatic, next, select, finish, hash } from "./book-helpers";

describe("1冊のInteractive HowTo", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("表紙から導入3項目・盤面・向きへappendし、過去DOMを残してscrollする", () => {
    render(<App />);
    expect(document.querySelectorAll("[data-section-id]")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "はじめる ↓" }));
    const first = section("about");
    for (const id of ["about", "game-purpose", "entry16", "board-overview"]) next(id);
    expect(section("orientation")).toHaveTextContent("縦＝チャージ");
    expect(section("about")).toBe(first);
    expect(document.querySelectorAll("[data-section-id]")).toHaveLength(5);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
    expect(document.activeElement).toBe(document.getElementById("orientation-title"));
    expect(window.location.hash).toBe("#orientation");
    next("orientation");
    expect(section("unblocked-attack")).toBeInTheDocument();
    expect(within(section("unblocked-attack")).queryByRole("button", { name: "次へ →" })).toBeNull();
  });
  it("3つの戦闘をA側で進め、過去の最終盤面・完了・再読込時の復帰を保持する", () => {
    hash("unblocked-attack");
    const view = render(<App />);
    for (const id of ["unblocked-attack", "first-battle", "bulwark-block"]) {
      finish(id);
      expect(within(section(id)).getByRole("status")).toHaveTextContent("操作は完了");
      if (id !== "bulwark-block") next(id);
    }
    expect(zone("unblocked-attack", "B", "grave").querySelector('[data-card="SK"]')).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem(bookStorageKey)!);
    expect(saved.completedIds).toEqual(expect.arrayContaining(["unblocked-attack", "first-battle", "bulwark-block"]));
    view.unmount(); render(<App />);
    expect(JSON.parse(localStorage.getItem(bookStorageKey)!)).toEqual(saved);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "start" });
    expect(zone("bulwark-block", "A", "grave").querySelector('[data-card="C6"]')).toBeInTheDocument();
  });
  it("兵士ブロックへhash直アクセスでき、未到達と準備中は完了扱いしない", () => {
    hash("soldier-block"); render(<App />);
    expect(card("first-battle", "B", "C6")).toHaveAccessibleName(/横向き/);
    expect(card("first-battle", "A", "H7")).toHaveAccessibleName(/縦向き/);
    expect(section("about")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(bookStorageKey)!).completedIds).toEqual([]);
    expect(section("multi-attack")).toBeNull();
  });
  it("目次はINTROにも戻れ、drawerを閉じてスクロールし、本文は消さない", () => {
    hash("bulwark-block"); render(<App />);
    const wall = section("bulwark-block");
    fireEvent.click(screen.getByRole("button", { name: "目次を開く" }));
    select("about");
    expect(document.querySelector(".sidebar-wrap")).not.toHaveClass("open");
    expect(section("bulwark-block")).toBe(wall);
    expect(window.location.hash).toBe("#about");
    expect(within(screen.getByRole("complementary", { name: "HowToの目次" })).getByRole("button", { name: /BlackPokerとは/ })).toHaveAttribute("aria-current", "step");
  });
  it("reduced motionではsmooth scrollを使わない", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<App />); fireEvent.click(screen.getByRole("button", { name: "はじめる ↓" }));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "start" });
  });
  it("時間だけではユーザーの攻撃・防壁操作は進まない", () => {
    hash("unblocked-attack"); render(<App />);
    act(() => vi.advanceTimersByTime(60000));
    expect(card("unblocked-attack", "A", "S2")).toHaveAccessibleName(/縦向き/);
    expect(within(section("unblocked-attack")).queryByRole("button", { name: "次へ →" })).toBeNull();
  });
  it("攻撃が通った因果と相手のライフ2枚の自動移動を1枚ずつ表示する", () => {
    const id = "unblocked-attack"; hash(id); render(<App />);
    tap(id, "A", "S2"); wait(); automatic();
    expect(section(id).querySelector(".interaction-guide")).toHaveTextContent("攻撃が通ったので");
    automatic();
    expect(zone(id, "B", "grave").querySelector('[data-card="S2"]')).toBeInTheDocument();
    expect(card(id, "B", "SK")).toHaveAccessibleName(/裏向き/);
    automatic();
    expect(zone(id, "B", "grave").querySelector('[data-card="SK"]')).toBeInTheDocument();
    expect(within(section(id)).getByRole("button", { name: "次へ →" })).toBeEnabled();
  });
  it("兵士ブロックは相手が攻撃済み、Aのブロッカー→Bの対象指定で完了する", () => {
    hash("soldier-block"); render(<App />);
    tap("first-battle", "A", "H7");
    expect(card("first-battle", "B", "C6")).toHaveClass("expected-card");
    tap("first-battle", "B", "C6");
    expect(card("first-battle", "A", "H7")).toHaveAccessibleName(/縦向き/);
    expect(section("first-battle").querySelector(".interaction-result")).toHaveTextContent("♥7が♣6をブロック");
    wait(); automatic();
    expect(zone("first-battle", "B", "grave").querySelector('[data-card="C6"]')).toBeInTheDocument();
  });
  it("防壁は選択で向きを変えず、公開→相手の墓地→あなたの防壁を墓地へ", () => {
    const id = "bulwark-block"; hash(id); render(<App />);
    tap(id, "A", "C6"); tap(id, "B", "C6");
    expect(card(id, "A", "C6")).toHaveAccessibleName(/裏向き 縦向き/); wait();
    tap(id, "A", "C6");
    expect(card(id, "A", "C6")).toHaveAccessibleName(/表向き 縦向き/); wait(); automatic();
    move(id, "A", "C6", "grave"); wait();
    expect(within(section(id)).getByRole("status")).toHaveTextContent("大小比較ではありません");
  });
  it("兵士召喚はAの防壁→ライフ→手札を操作する", () => {
    const id = "soldier"; hash(id); render(<App />); tap(id, "A", "D5"); wait();
    expect(card(id, "A", "D5")).toHaveAccessibleName(/横向き/);
    expect(section(id).querySelector(".interaction-guide")).toHaveTextContent("ライフの一番上");
    expect(section(id).querySelector(".interaction-guide")).not.toHaveTextContent("♠3");
    move(id, "A", "S3", "grave"); wait(); move(id, "A", "S2", "soldiers"); wait();
    expect(zone(id, "A", "soldiers").querySelector('[data-card="S2"]')).toBeInTheDocument();
    expect(within(section(id)).getByRole("button", { name: "次へ →" })).toBeEnabled();
  });
  it("防壁設置はAのコストLと設置だけで完了し、ターン終了を始めない", () => {
    const id = "bulwark"; hash(id); render(<App />); finish(id);
    expect(card(id, "A", "D8")).toHaveAccessibleName(/裏向き 縦向き/);
    expect(section(id).querySelector(".micro-trail")).not.toHaveTextContent(/エンド|チャージ|ドロー/);
    expect(within(section(id)).getByRole("status")).toHaveTextContent("設置しました");
    expect(section("pass-turn")).toBeNull();
  });
  it("エンドだけユーザー操作し、相手のチャージと2枚のドローは自動", () => {
    const id = "pass-turn"; hash(id); render(<App />);
    const end = within(section(id)).getByRole("button", { name: "エンド" });
    fireEvent.click(end); wait(); automatic();
    expect(card(id, "B", "D5")).toHaveAccessibleName(/縦向き/);
    automatic();
    expect(zone(id, "B", "hand").querySelector('[data-card="S3"]')).toBeInTheDocument();
    expect(zone(id, "B", "hand").querySelector('[data-card="D8"]')).toBeNull();
    automatic();
    expect(zone(id, "B", "hand").querySelector('[data-card="D8"]')).toBeInTheDocument();
  });
  it("選択解除・誤source・誤destinationで盤面を変更せず、矢印を選択時だけ出す", () => {
    const id = "soldier"; hash(id); render(<App />); tap(id, "A", "D5"); wait(); tap(id, "B", "D5");
    expect(section(id).querySelector(".interaction-guide")).toHaveTextContent("今回は");
    tap(id, "A", "S3"); expect(card(id, "A", "S3")).toHaveAttribute("aria-pressed", "true");
    expect(zone(id, "A", "grave")).toHaveClass("destination-zone");
    expect(section(id).querySelector("line.board-route")).toBeInTheDocument();
    tap(id, "A", "S3"); expect(section(id).querySelector("line.board-route")).toBeNull();
    tap(id, "A", "S3"); fireEvent.click(destination(id, "B", "grave"));
    expect(zone(id, "A", "life").querySelector('[data-card="S3"]')).toBeInTheDocument();
  });
  it("EnterとSpaceでカード選択と移動先確定ができる", async () => {
    const id = "soldier"; hash(id); render(<App />); tap(id, "A", "D5"); wait();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    card(id, "A", "S3").focus(); await user.keyboard("{Enter}");
    expect(card(id, "A", "S3")).toHaveAttribute("aria-pressed", "true");
    destination(id, "A", "grave").focus(); await user.keyboard(" ");
    expect(zone(id, "A", "grave").querySelector('[data-card="S3"]')).toBeInTheDocument();
  });
  it("解説開閉・目次で離れてもカード選択を保持し、replayは完了・旧最高進捗を戻さない", () => {
    saveProgress({ scenarioId: entryScenario.id, stepIndex: 7, maxReachedStepIndex: 25, completed: false, updatedAt: "" }, localStorage);
    const id = "soldier"; hash(id); render(<App />); tap(id, "A", "D5"); wait(); tap(id, "A", "S3");
    fireEvent.click(within(section(id)).getByText("解説を見る", { selector: "summary" }));
    select("about"); select(id);
    expect(card(id, "A", "S3")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(destination(id, "A", "grave")); wait(); move(id, "A", "S2", "soldiers"); wait();
    fireEvent.click(within(section(id)).getByRole("button", { name: /もう一度やる/ }));
    expect(card(id, "A", "D5")).toHaveAccessibleName(/縦向き/);
    expect(JSON.parse(localStorage.getItem(bookStorageKey)!).completedIds).toContain(id);
    expect(loadProgress(entryScenario.id, localStorage).maxReachedStepIndex).toBe(25);
  });
  it("mouse/pen dragは誤dropを拒否し、正しいdropで移動する", () => {
    class TestPointerEvent extends MouseEvent {
      pointerType: string;
      constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerType = options.pointerType || "mouse"; }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    const id = "soldier"; hash(id); render(<App />); tap(id, "A", "D5"); wait();
    const source = card(id, "A", "S3"); const previous = document.elementFromPoint;
    const hitTest = vi.fn(() => zone(id, "B", "grave")); document.elementFromPoint = hitTest;
    try {
      for (const pointerType of ["mouse", "mouse", "pen"]) {
        fireEvent.pointerDown(source, { pointerType, button: 0, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(source, { pointerType, clientX: 20, clientY: 20 });
        expect(section(id).querySelector(".card-ghost")).toBeInTheDocument();
        fireEvent.pointerUp(source, { pointerType, clientX: 30, clientY: 30 });
        if (pointerType === "mouse") {
          expect(zone(id, "A", "life").querySelector('[data-card="S3"]')).toBeInTheDocument();
          hitTest.mockReturnValue(hitTest.mock.results.length === 1 ? zone("first-battle", "A", "grave") : zone(id, "A", "grave"));
        }
      }
      expect(zone(id, "A", "grave").querySelector('[data-card="S3"]')).toBeInTheDocument();
    } finally { document.elementFromPoint = previous; }
  });
  it("touchの縦スクロールをdragとして奪わず、移動先のカードにもタップできる", () => {
    class TouchPointer extends MouseEvent { pointerType = "touch"; }
    vi.stubGlobal("PointerEvent", TouchPointer);
    const id = "soldier"; hash(id); render(<App />); tap(id, "A", "D5"); wait();
    const source = card(id, "A", "S3");
    fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(source, { clientX: 20, clientY: 80 });
    expect(section(id).querySelector(".card-ghost")).toBeNull();
    expect(source).toHaveAttribute("aria-pressed", "false");
    fireEvent.pointerCancel(source); tap(id, "A", "S3"); tap(id, "A", "C6");
    expect(zone(id, "A", "grave").querySelector('[data-card="S3"]')).toBeInTheDocument();
  });
  it("準備中を直接開けるが大量の空Sectionを出さず、進捗を完了扱いしない", () => {
    hash("up"); render(<App />);
    expect(section("up")).toHaveTextContent("準備中");
    expect(section("down")).toBeNull();
    expect(section("multi-attack")).toBeNull();
    expect(JSON.parse(localStorage.getItem(bookStorageKey)!).completedIds).not.toContain("up");
    expect(document.querySelectorAll(".learning-roadmap li")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "ルール早見" }));
    expect(screen.getByRole("dialog", { name: "ルール早見" })).toBeVisible();
  });
  it("実物準備も前の説明を残し、先攻と開始時1ドローを維持する", () => {
    hash("real-game"); render(<App />);
    const first = document.getElementById("real-real-deck")!;
    for (let index = 0; index < 6; index++) {
      const buttons = within(section("real-game")).getAllByRole("button", { name: /準備できた/ });
      fireEvent.click(buttons.at(-1)!);
    }
    expect(first).toBeInTheDocument();
    const choose = document.getElementById("real-first-player")!;
    expect(within(choose).getByRole("button", { name: /準備できた/ })).toBeDisabled();
    fireEvent.click(within(choose).getByRole("radio", { name: "PLAYER B" }));
    fireEvent.click(within(choose).getByRole("button", { name: /準備できた/ }));
    expect(document.getElementById("real-start-draw")).toHaveTextContent("1枚");
    expect(document.getElementById("real-preset-bulwark")).toHaveTextContent("表向き");
    expect(loadProgress(entryScenario.id, localStorage).firstPlayer).toBe("B");
    expect(section("real-game").querySelector(".interactive-board")).toBeNull();
  });
  it("旧Lesson・30操作からの復帰と明示的な最初からやり直すを区別する", () => {
    saveIntroComplete(localStorage);
    localStorage.setItem(lessonStorageKey, JSON.stringify({ lessonId: "soldier", completedIds: ["first-battle"] }));
    render(<App />);
    expect(section("soldier")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(bookStorageKey)!).completedIds).toContain("first-battle");
    expect(localStorage.getItem(lessonStorageKey)).toContain("first-battle");
    fireEvent.click(screen.getByRole("button", { name: "最初からやり直す" }));
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
    expect(document.querySelectorAll("[data-section-id]")).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(bookStorageKey)!)).toEqual({ lastSectionId: "cover", unlockedIds: [], completedIds: [] });
    expect(window.location.hash).toBe("");
  });
});
