import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import scenario from "../src/data/tutorials/entry16.json";
import { PREVIEW_MS, RESULT_MS } from "../src/hooks/useScenePlayback";
import { learningUnits } from "../src/lib/scenes";
import { clearIntroComplete, loadIntroComplete, loadProgress, saveIntroComplete, saveProgress } from "../src/lib/storage";
import type { TutorialScenario } from "../src/types";

const units = learningUnits(scenario as TutorialScenario);
function at(id: string, extra = {}) {
  saveProgress({ scenarioId: scenario.id,
    stepIndex: scenario.steps.findIndex((step) => step.id === id),
    completed: false, updatedAt: "", ...extra }, window.localStorage);
}
function tick(ms: number) { act(() => vi.advanceTimersByTime(ms)); }
function finishMicroSteps(count: number) {
  for (let i = 0; i < count; i++) { tick(PREVIEW_MS); tick(RESULT_MS); }
}

describe("scene単位のTutorial", () => {
  beforeEach(() => { window.localStorage.clear(); saveIntroComplete(window.localStorage); });
  afterEach(() => { vi.useRealTimers(); });

  it("3画面のINTROから完成済み盤面sceneへ進み、やり直すとINTROへ戻る", () => {
    clearIntroComplete(window.localStorage);
    render(<App />);
    expect(screen.getByRole("heading", { name: /BlackPokerって.*どんなゲーム？/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    expect(screen.getByRole("heading", { name: "どうなったら勝ち？" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    expect(screen.getByText("ライト＋エントリー16")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /画面で練習してみる/ }));
    expect(screen.getByRole("heading", { name: "盤面を知る" })).toBeVisible();
    expect(screen.getByTestId("A-soldiers")).toHaveTextContent("♣6");
    expect(screen.getByTestId("B-soldiers")).toHaveTextContent("♥7");
    expect(document.querySelector(".board-route")).toBeNull();
    expect(loadIntroComplete(window.localStorage)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "最初からやり直す" }));
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
    expect(screen.getByRole("heading", { name: /BlackPokerって.*どんなゲーム？/ })).toBeVisible();
    expect(loadProgress(scenario.id, window.localStorage).stepIndex).toBe(0);
  });

  it("盤面を知るは1回の次へだけで攻撃sceneへ進む", () => {
    render(<App />);
    expect(screen.getByText(/縦がチャージ・横がドライブ/)).toBeVisible();
    expect(screen.getByRole("button", { name: "次へ →" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /もう一度見る/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByRole("heading", { name: "攻撃してみる" })).toBeVisible();
    expect(loadProgress(scenario.id, window.localStorage).stepIndex).toBe(4);
  });

  it("攻撃sceneはattack→block→damageをクリックなしで再生し、完了後だけ次へ進める", () => {
    vi.useFakeTimers(); at("attack"); render(<App />);
    expect(screen.getByRole("button", { name: "再生中…" })).toBeDisabled();
    expect(screen.getByLabelText("A ♣6 表向き 縦向き")).toBeVisible();
    tick(PREVIEW_MS);
    expect(screen.getByLabelText("A ♣6 表向き 横向き")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("アタック");
    tick(RESULT_MS);
    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(screen.getByText("ブロック", { selector: ".scene-progress span" })).toBeVisible();
    tick(PREVIEW_MS);
    expect(screen.getByRole("status")).toHaveTextContent("ブロック");
    tick(RESULT_MS);
    expect(document.querySelector('line.board-route[data-from="soldiers"][data-to="grave"]')).toBeInTheDocument();
    tick(PREVIEW_MS);
    expect(within(screen.getByTestId("A-grave")).getByLabelText(/♣6/)).toBeVisible();
    tick(RESULT_MS);
    expect(screen.getByText("この場面のまとめ")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByRole("heading", { name: "兵士を召喚する" })).toBeVisible();
  });

  it("兵士召喚sceneはB→L→解決を自動再生し、直線矢印を予告する", () => {
    vi.useFakeTimers(); at("summon-cost-b"); render(<App />);
    expect(screen.getByText("1 / 3")).toBeVisible();
    tick(PREVIEW_MS);
    expect(screen.getByRole("status")).toHaveTextContent("コストB");
    tick(RESULT_MS);
    expect(document.querySelector('line.board-route[data-from="life"][data-to="grave"]')).toBeInTheDocument();
    tick(PREVIEW_MS);
    expect(screen.getByRole("status")).toHaveTextContent("コストL");
    tick(RESULT_MS);
    expect(document.querySelector('line.board-route[data-from="hand"][data-to="soldiers"]')).toBeInTheDocument();
    tick(PREVIEW_MS); tick(RESULT_MS);
    expect(screen.getByText("この場面のまとめ")).toBeVisible();
    expect(screen.getByText(/B：防壁をドライブ。L：1点ダメージ/)).toBeVisible();
  });

  it("もう一度見るはsceneだけを再生し保存進捗と最高到達を巻き戻さない", () => {
    vi.useFakeTimers(); at("summon-cost-l", { maxReachedStepIndex: 21 }); render(<App />);
    expect(screen.getByRole("heading", { name: "兵士を召喚する" })).toBeVisible();
    expect(screen.getByText("1 / 3")).toBeVisible();
    finishMicroSteps(3);
    const saved = loadProgress(scenario.id, window.localStorage);
    fireEvent.click(screen.getByRole("button", { name: /もう一度見る/ }));
    expect(screen.getByText("1 / 3")).toBeVisible();
    expect(screen.getByRole("button", { name: "再生中…" })).toBeDisabled();
    expect(loadProgress(scenario.id, window.localStorage)).toMatchObject({
      stepIndex: saved.stepIndex, maxReachedStepIndex: saved.maxReachedStepIndex,
    });
  });

  it("古いstepIndexは対応sceneに復帰し、最高到達sceneも保持する", () => {
    at("summon-cost-l", { maxReachedStepIndex: 20 });
    render(<App />);
    expect(screen.getByRole("heading", { name: "兵士を召喚する" })).toBeVisible();
    expect(screen.getByText("1 / 3")).toBeVisible();
    expect(screen.getByLabelText(/^全体の進捗/)).toHaveAttribute("aria-label", "全体の進捗 33%");
    expect(loadProgress(scenario.id, window.localStorage).stepIndex).toBe(8);
  });

  it("戻ってもmaxReachedと解放済みsceneを維持する", () => {
    at("summon-cost-l", { maxReachedStepIndex: 20 }); render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "← 戻る" }));
    expect(screen.getByRole("heading", { name: "攻撃してみる" })).toBeVisible();
    expect(loadProgress(scenario.id, window.localStorage).maxReachedStepIndex).toBe(20);
    const menu = screen.getByLabelText("チュートリアル全体の進捗");
    fireEvent.click(within(menu).getByRole("button", { name: /PLAYER Bのターン/ }));
    expect(screen.getByRole("heading", { name: "PLAYER Bのターン" })).toBeVisible();
  });

  it("解説を見るでscene内の各処理・phase・公式リンクを参照できる", () => {
    at("summon-cost-b"); render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /解説を見る/ }));
    const detail = document.querySelector(".why-content")!;
    expect(within(detail as HTMLElement).getByRole("heading", { name: /1\. コストB/ })).toBeVisible();
    expect(within(detail as HTMLElement).getByRole("heading", { name: /2\. コストL/ })).toBeVisible();
    expect(within(detail as HTMLElement).getByRole("heading", { name: /3\. 召喚/ })).toBeVisible();
    expect(detail).toHaveTextContent("リクエスト時");
    expect(detail).toHaveTextContent("解決時");
    expect(detail.querySelectorAll("a").length).toBeGreaterThan(0);
  });

  it("sidebarと進捗はmicro stepではなくsceneを表示する", () => {
    at("summon-cost-l"); render(<App />);
    const practice = document.querySelectorAll(".chapter-group")[1];
    expect(practice.querySelectorAll(".chapter-list button")).toHaveLength(5);
    expect(practice).toHaveTextContent("兵士を召喚する");
    expect(practice).not.toHaveTextContent("防壁を横向きに。");
    expect(screen.getByLabelText(/^全体の進捗/)).toHaveTextContent("2 / 5");
    expect(units.filter((unit) => unit.mode === "fixed")).toHaveLength(6);
  });

  it("状態変更にはゾーン移動矢印を出さず、通常の移動には直線を使う", () => {
    vi.useFakeTimers(); at("attack"); render(<App />);
    expect(document.querySelector(".board-route")).toBeNull();
    tick(PREVIEW_MS); tick(RESULT_MS); tick(PREVIEW_MS); tick(RESULT_MS);
    expect(document.querySelector('line.board-route[data-from="soldiers"][data-to="grave"]')).toBeInTheDocument();
    expect(document.querySelector("path.board-route")).toBeNull();
  });

  it("reduced motionでも処理順と結果・理由が離散的に読める", () => {
    vi.useFakeTimers(); at("attack");
    vi.stubGlobal("matchMedia", () => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() }));
    render(<App />);
    expect(screen.getByText("1 / 3")).toBeVisible();
    tick(PREVIEW_MS);
    expect(screen.getByRole("status")).toHaveTextContent("アタック");
    tick(RESULT_MS);
    expect(screen.getByText("2 / 3")).toBeVisible();
    vi.unstubAllGlobals();
  });

  it("実物カードの操作は意味ごとに次へで進み、先攻選択なしでは進めない", () => {
    at("real-deck"); render(<App />);
    for (const id of ["shuffle", "real-life", "real-hand", "preset-bulwark", "preset-soldier", "first-player"]) {
      fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
      expect(screen.getByRole("heading", { name: scenario.steps.find((step) => step.id === id)!.title })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "次へ →" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "PLAYER B" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByRole("heading", { name: "先攻だけ、1枚引きます。" })).toBeVisible();
    expect(screen.getByRole("region", { name: "実物ではこう動かす" })).toHaveTextContent("ライフ");
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByRole("heading", { name: "早見を開いて、1戦開始。" })).toBeVisible();
  });

  it("固定6sceneだけを進めれば実物カード準備が始まる", () => {
    vi.useFakeTimers(); render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    for (const count of [3, 3, 3, 5, 3]) {
      expect(screen.getByRole("button", { name: "再生中…" })).toBeDisabled();
      finishMicroSteps(count);
      fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    }
    expect(screen.getByText("ここから実物カード")).toBeVisible();
    expect(loadProgress(scenario.id, window.localStorage).stepIndex).toBe(21);
  });

  it("INTRO開始から実物カード開始までのprimary操作を45回から9回にする", () => {
    const fixedStepCount = scenario.steps.filter((step) => step.mode === "fixed").length;
    const fixedSceneCount = units.filter((unit) => unit.mode === "fixed").length;
    expect(3 + fixedStepCount * 2).toBe(45);
    expect(3 + fixedSceneCount).toBe(9);
  });

  it("ルール早見とロードマップを維持する", () => {
    render(<App />);
    expect(document.querySelectorAll(".learning-roadmap li")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "ルール早見" }));
    expect(screen.getByRole("dialog", { name: "ルール早見" })).toBeVisible();
  });
});
