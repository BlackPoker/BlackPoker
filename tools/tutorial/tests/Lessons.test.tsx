import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/App";
import { LessonExplainer, ConceptSlide } from "../src/components/LessonExplainer";
import { lessonById, bulwarkScenario } from "../src/data/lessons";
import { RESULT_MS } from "../src/hooks/useSceneInteraction";
import { deriveInteractions } from "../src/lib/interaction.mjs";
import { lessonStorageKey } from "../src/lib/lesson-storage";
import { saveIntroComplete, loadProgress } from "../src/lib/storage";
import { entryScenario } from "../src/data/lessons";
const advance = () => act(() => vi.advanceTimersByTime(RESULT_MS));
const card = (player: string, id: string) => document.querySelector(`.player-${player} [data-card="${id}"]`)!.closest("button")!;
function selectLesson(title: string) {
  fireEvent.click(screen.getByRole("button", { name: "一覧を見る" }));
  const button = [...document.querySelectorAll(".chapter-list button")].find((b) => b.querySelector("b")?.firstChild?.textContent === title)!;
  const details = button.closest("details")!; details.open = true;
  fireEvent.click(button);
}
beforeEach(() => { localStorage.clear(); saveIntroComplete(localStorage); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
it("盤面→守らない攻撃→兵士→防壁へ連続操作でき、公開済みの完了記録を再読込して保持する", () => {
  const view = render(<App />);
  expect(screen.getByRole("heading", { name: lessonById("board-overview").title })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
  for (const id of ["unblocked-attack", "first-battle", "bulwark-block"]) {
    expect(screen.getByRole("heading", { name: lessonById(id).title, level: 1 })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "やってみる →" }));
    const scenario = id === "bulwark-block" ? bulwarkScenario : entryScenario;
    const scene = scenario.scenes.find((s) => s.id === id)!;
    for (const stepId of scene.stepIds) {
      const step = scenario.steps.find((s) => s.id === stepId)!;
      for (const command of deriveInteractions(step)) {
        if (command.kind === "action") fireEvent.click(screen.getByRole("button", { name: command.label }));
        else {
          fireEvent.click(card(command.source.player, command.source.card));
          if (command.kind === "select-target") fireEvent.click(card(command.target.player, command.target.card));
          if (command.kind === "move-card") fireEvent.click(within(screen.getByTestId(`${command.source.player}-${command.to}`)).getByRole("button", { name: /^PLAYER/ }));
        }
        advance();
      }
    }
    expect(screen.getByText("Lesson完了")).toBeVisible();
    if (id !== "bulwark-block") fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
  }
  const saved = JSON.parse(localStorage.getItem(lessonStorageKey)!);
  expect(saved.completedIds).toEqual(["board-overview", "unblocked-attack", "first-battle", "bulwark-block"]);
  view.unmount(); render(<App />);
  expect(screen.getByRole("heading", { name: "防壁で守ってみる", level: 1 })).toBeVisible();
  expect(JSON.parse(localStorage.getItem(lessonStorageKey)!)).toEqual(saved);
});
it("動画なしで説明→操作→完了→次Lessonへ進める", () => {
  render(<App />); selectLesson("兵士で守ってみる");
  expect(screen.getByRole("heading", { name: "6と7、どちらが強い？" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "動画で見る" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "やってみる →" }));
  fireEvent.click(card("A", "C6")); advance();
  fireEvent.click(card("B", "H7")); fireEvent.click(card("A", "C6")); advance();
  fireEvent.click(card("A", "C6"));
  fireEvent.click(within(screen.getByTestId("A-grave")).getByRole("button", { name: /^PLAYER/ })); advance();
  expect(screen.getByText("Lesson完了")).toBeVisible();
  expect(JSON.parse(localStorage.getItem(lessonStorageKey)!).completedIds).toContain("first-battle");
  fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
  expect(screen.getByRole("heading", { name: lessonById("bulwark-block").explainer!.title })).toBeVisible();
});
it("解説だけのLessonを経由した戦闘の復習も初期盤面に戻り、完了記録は維持する", () => {
  render(<App />); selectLesson("兵士で守ってみる");
  fireEvent.click(screen.getByRole("button", { name: "やってみる →" }));
  fireEvent.click(card("A", "C6")); advance();
  fireEvent.click(card("B", "H7")); fireEvent.click(card("A", "C6")); advance();
  fireEvent.click(card("A", "C6"));
  fireEvent.click(within(screen.getByTestId("A-grave")).getByRole("button", { name: /^PLAYER/ })); advance();
  selectLesson("アップ"); selectLesson("兵士で守ってみる");
  fireEvent.click(screen.getByRole("button", { name: "やってみる →" }));
  expect(card("A", "C6")).toHaveAccessibleName("A ♣6 表向き 縦向き");
  expect(screen.queryByText("Lesson完了")).toBeNull();
  expect(screen.queryByRole("button", { name: "次へ →" })).toBeNull();
  expect(JSON.parse(localStorage.getItem(lessonStorageKey)!).completedIds).toContain("first-battle");
});
it("準備中へ直接アクセスでき、完了扱いせず、最高到達を維持して復習できる", () => {
  render(<App />); selectLesson("Entry16で遊ぶ");
  const max = loadProgress(entryScenario.id, localStorage).maxReachedStepIndex;
  selectLesson("アップ");
  expect(screen.getByRole("heading", { name: "アップ", level: 1 })).toBeVisible();
  expect(document.querySelector(".pending-notice")).toHaveTextContent("準備中");
  expect(screen.queryByRole("button", { name: "やってみる →" })).toBeNull();
  fireEvent.click(screen.getByText("解説を見る", { selector: "summary" }));
  expect(document.querySelector(".lesson-definitions")).toHaveTextContent("クイック");
  selectLesson("兵士で守ってみる");
  expect(loadProgress(entryScenario.id, localStorage).maxReachedStepIndex).toBe(max);
  expect(JSON.parse(localStorage.getItem(lessonStorageKey)!).completedIds).not.toContain("up");
});
it("防壁の選択→公開→攻撃側→防壁の墓地移動を自分で完了する", () => {
  render(<App />); selectLesson("防壁で守ってみる");
  fireEvent.click(screen.getByRole("button", { name: "やってみる →" }));
  expect(card("B", "C6")).toHaveAccessibleName(/裏向き/);
  for (const step of bulwarkScenario.steps) for (const command of deriveInteractions(step)) {
    if (command.kind === "action") continue;
    fireEvent.click(card(command.source.player, command.source.card));
    if (command.kind === "select-target") fireEvent.click(card(command.target.player, command.target.card));
    if (command.kind === "move-card") fireEvent.click(within(screen.getByTestId(`${command.source.player}-${command.to}`)).getByRole("button", { name: /^PLAYER/ }));
    if (step.id === "wall-reveal") {
      expect(card("B", "C6")).toHaveAccessibleName(/表向き/);
      expect(document.querySelector(".interaction-result")).toHaveTextContent("公開しました");
    }
    advance();
  }
  expect(screen.getByText("Lesson完了")).toBeVisible();
  expect(screen.getByTestId("A-grave")).toHaveTextContent("♣6");
  expect(screen.getByTestId("B-grave")).toHaveTextContent("♣6");
});
it("実物Lesson入口から既存の準備へ移動できる", () => {
  render(<App />); selectLesson("Entry16で遊ぶ");
  fireEvent.click(screen.getByRole("button", { name: "実物カードを準備する →" }));
  expect(screen.getByText("ここから実物カード")).toBeVisible();
  expect(document.querySelector(".interactive-board")).toBeNull();
});
it("任意動画はクリック後だけ開き、旧版注記・autoplayなし・閉じて同じ説明へ戻る", () => {
  const start = vi.fn();
  render(<LessonExplainer lesson={{ ...lessonById("first-battle"), media: {
    type: "youtube", url: "https://youtu.be/abcdefghijk", title: "テスト用動画", note: "教育構造のみ参考", edition: "legacy",
  } }} prerequisiteTitles={[]} onStart={start} onNext={vi.fn()} onLesson={vi.fn()} />);
  expect(document.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "動画で見る" }));
  expect(screen.getByRole("dialog", { name: "テスト用動画" })).toBeVisible();
  expect(screen.getByText(/旧ルールの参考動画/)).toBeVisible();
  expect(document.querySelector("iframe")!.src).not.toContain("autoplay");
  fireEvent.click(screen.getByRole("button", { name: "動画を閉じる" }));
  expect(document.querySelector("iframe")).toBeNull();
  expect(screen.getByRole("heading", { name: "6と7、どちらが強い？" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "やってみる →" })); expect(start).toHaveBeenCalledOnce();
});
it.each(["first-battle", "soldier", "reading-actions", "unblocked-attack"])("%sの解説presentationを描画する", (id) => {
  const explainer = lessonById(id).explainer!;
  render(<ConceptSlide explainer={explainer} />);
  expect(screen.getByRole("heading", { name: explainer.title })).toBeVisible();
  expect(document.querySelector(`.presentation-${explainer.type}`)).toBeInTheDocument();
});
