import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LessonExplainer, ConceptSlide } from "../src/components/LessonExplainer";
import { lessonById } from "../src/data/lessons";
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
