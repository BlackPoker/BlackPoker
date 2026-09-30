import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import scenario from "../src/data/tutorials/entry16.json";
import { RESULT_MS } from "../src/hooks/useSceneInteraction";
import { deriveInteractions } from "../src/lib/interaction.mjs";
import { clearIntroComplete, loadProgress, saveIntroComplete, saveProgress } from "../src/lib/storage";
import type { TutorialStep } from "../src/types";
import { lessonStorageKey } from "../src/lib/lesson-storage";
function at(id: string, extra = {}) {
  saveProgress({ scenarioId: scenario.id, stepIndex: scenario.steps.findIndex((s) => s.id === id),
    completed: false, updatedAt: "", ...extra }, window.localStorage);
}
const wait = () => act(() => { vi.advanceTimersByTime(RESULT_MS); });
const card = (player: string, code: string) => document.querySelector(`.player-${player} [data-card="${code}"]`)!.closest("button")!;
const zone = (player: string, name: string) => within(screen.getByTestId(`${player}-${name}`)).getByRole("button", { name: /^PLAYER/ });
const tap = (player: string, code: string) => fireEvent.click(card(player, code));
const move = (player: string, code: string, destination: string) => { tap(player, code); fireEvent.click(zone(player, destination)); };
function perform(id: string) {
  const step = scenario.steps.find((s) => s.id === id) as TutorialStep;
  for (const command of deriveInteractions(step)) {
    if (command.kind === "action") fireEvent.click(screen.getByRole("button", { name: command.label }));
    else {
      tap(command.source.player, command.source.card);
      if (command.kind === "move-card") fireEvent.click(zone(command.source.player, command.to));
      if (command.kind === "select-target") tap(command.target.player, command.target.card);
    }
    wait();
  }
}
describe("画面でカードを操作するTutorial", () => {
  beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear(); saveIntroComplete(window.localStorage); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("3画面INTROから盤面と向きを確認し、最初の攻撃へ進み、最初からやり直せる", () => {
    clearIntroComplete(window.localStorage); render(<App />);
    expect(screen.getByRole("heading", { name: /BlackPokerって.*どんなゲーム？/ })).toBeVisible();
    expect(JSON.parse(localStorage.getItem(lessonStorageKey)!).completedIds).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    expect(screen.getByRole("heading", { name: "どうなったら勝ち？" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
    fireEvent.click(screen.getByRole("button", { name: /画面で練習してみる/ }));
    expect(screen.getByRole("heading", { name: "まずは盤面を見てみよう" })).toBeVisible();
    expect(JSON.parse(localStorage.getItem(lessonStorageKey)!).completedIds).toEqual(["board-overview"]);
    expect(screen.getByRole("figure", { name: "カードの向き：チャージとドライブ" })).toBeVisible();
    expect(screen.getByText("縦＝チャージ")).toBeVisible();
    expect(screen.getByText("横＝ドライブ")).toBeVisible();
    expect(screen.queryByText("Lesson完了")).toBeNull();
    // 置き場を全てクリックする必要はなく、そのまま次へ進める。
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByRole("heading", { name: "まずは攻撃してみよう" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "守らなかったら、どうなる？" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "やってみる →" }));
    expect(screen.queryByRole("button", { name: "次へ →" })).toBeNull();
    expect(document.querySelector(".board-route")).toBeNull();
    expect(screen.getByTestId("A-soldiers")).toHaveTextContent("♠2");
    fireEvent.click(screen.getByRole("button", { name: "最初からやり直す" }));
    fireEvent.click(screen.getByRole("button", { name: "やり直す" }));
    expect(screen.getByRole("heading", { name: /BlackPokerって.*どんなゲーム？/ })).toBeVisible();
    expect(JSON.parse(localStorage.getItem(lessonStorageKey)!).lessonId).toBe("board-overview");
    expect(JSON.parse(localStorage.getItem(lessonStorageKey)!).completedIds).toEqual([]);
  });
  it("時間経過だけでは進まず、scene途中にNextを出さない", () => {
    at("attack"); render(<App />);
    act(() => { vi.advanceTimersByTime(60000); });
    expect(card("A", "C6")).toHaveAccessibleName("A ♣6 表向き 縦向き");
    expect(screen.queryByRole("button", { name: /次へ|再生中/ })).toBeNull();
  });
  it("兵士召喚を防壁→ライフ→手札の操作で完了する", () => {
    at("summon-cost-b"); render(<App />); tap("A", "D5");
    expect(card("A", "D5")).toHaveAccessibleName(/横向き/); wait();
    expect(document.querySelector(".interaction-guide")).toHaveTextContent("ライフの一番上");
    expect(document.querySelector(".interaction-guide")).not.toHaveTextContent("♠3");
    move("A", "S3", "grave"); wait();
    expect(screen.queryByRole("button", { name: "次へ →" })).toBeNull();
    move("A", "S2", "soldiers"); wait();
    expect(screen.getByTestId("A-soldiers")).toHaveTextContent("♠2");
    expect(screen.getByRole("button", { name: "次へ →" })).toBeEnabled();
  });
  it("選択解除・誤source・誤destinationでカードを動かさない", () => {
    at("summon-cost-b"); render(<App />); perform("summon-cost-b"); tap("B", "D5");
    expect(document.querySelector(".interaction-feedback")).toHaveTextContent("ライフの一番上");
    tap("A", "S3");
    expect(card("A", "S3")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("A-grave")).toHaveClass("destination-zone");
    expect(document.querySelector('line.board-route[data-from="life"][data-to="grave"]')).toBeInTheDocument();
    tap("A", "S3");
    expect(card("A", "S3")).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector(".board-route")).toBeNull();
    tap("A", "S3"); fireEvent.click(zone("B", "grave"));
    expect(screen.getByTestId("A-life").querySelector('[data-card="S3"]')).toBeInTheDocument();
    expect(screen.getByTestId("A-grave").querySelector('[data-card="S3"]')).toBeNull();
  });
  it("EnterとSpaceでカード選択と移動先確定ができる", async () => {
    at("summon-cost-b"); render(<App />); perform("summon-cost-b");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    card("A", "S3").focus(); await user.keyboard("{Enter}");
    expect(card("A", "S3")).toHaveAttribute("aria-pressed", "true");
    zone("A", "grave").focus(); await user.keyboard(" ");
    expect(screen.getByTestId("A-grave")).toHaveTextContent("♠3");
  });
  it("攻撃→ブロッカーと対象指定→ダメージを自分で操作する", () => {
    at("attack"); render(<App />); perform("attack");
    expect(card("A", "C6")).toHaveAccessibleName(/横向き/);
    tap("B", "H7"); expect(card("A", "C6")).toHaveClass("expected-card"); tap("A", "C6");
    expect(card("B", "H7")).toHaveAccessibleName(/縦向き/);
    expect(document.querySelector(".interaction-result")).toHaveTextContent("♥7が♣6をブロック");
    expect(document.querySelector(".interaction-guide")).not.toHaveTextContent("自動で起きるチャージ");
    wait(); expect(screen.getByText(/6 < 7/)).toBeVisible(); perform("damage");
    expect(screen.getByTestId("A-grave")).toHaveTextContent("♣6");
    expect(screen.getByRole("button", { name: "次へ →" })).toBeEnabled();
  });
  it("エンド→チャージ→2枚を1枚ずつドローする", () => {
    at("end"); render(<App />); perform("end");
    expect(screen.getByTestId("actor")).toHaveTextContent("ターン：PLAYER B");
    expect(screen.getByText(/自動で起きるチャージ/)).toBeVisible(); perform("charge");
    move("B", "S3", "hand");
    expect(document.querySelector(".scene-progress small")).toHaveTextContent("1 / 2枚目");
    expect(screen.getByTestId("B-hand")).toHaveTextContent("♠3");
    expect(screen.getByTestId("B-hand")).not.toHaveTextContent("♢8");
    expect(card("B", "D8")).toHaveAccessibleName(/ライフの裏向きカード/);
    wait(); move("B", "D8", "hand"); wait();
    expect(screen.getByTestId("B-hand")).toHaveTextContent("♢8");
    expect(screen.getByRole("button", { name: "次へ →" })).toBeEnabled();
  });
  it("PLAYER Bの防壁は裏向きで置き、ターンを戻す", () => {
    at("set-bulwark-cost-l"); render(<App />);
    perform("set-bulwark-cost-l"); perform("set-bulwark-place");
    expect(card("B", "D8")).toHaveAccessibleName(/防壁の裏向きカード/);
    perform("end-to-a"); perform("charge-a"); perform("draw-a");
    expect(screen.getByRole("button", { name: "次へ →" })).toBeEnabled();
  });
  it("ブロックしないとライフを1枚ずつ2回墓地へ動かす", () => {
    at("direct-attack"); render(<App />); perform("direct-attack"); perform("no-block");
    move("B", "S2", "grave");
    expect(screen.getByTestId("B-grave")).toHaveTextContent("♠2");
    expect(card("B", "SK")).toHaveAccessibleName(/ライフの裏向きカード/);
    wait(); move("B", "SK", "grave"); wait();
    expect(screen.getByTestId("B-grave")).toHaveTextContent("♠K");
    expect(screen.getByRole("button", { name: "次へ →" })).toBeEnabled();
  });
  it("解説の開閉でも選択を維持し、replayでも保存進捗を巻き戻さない", () => {
    at("summon-cost-l", { maxReachedStepIndex: 21 }); render(<App />);
    expect(screen.getByRole("heading", { name: "兵士を召喚する" })).toBeVisible();
    perform("summon-cost-b"); tap("A", "S3");
    fireEvent.click(screen.getByRole("button", { name: /解説を見る/ }));
    expect(document.querySelector(".why-content")).toHaveTextContent("リクエスト時");
    expect(document.querySelector(".why-content")).not.toHaveTextContent("♠3");
    fireEvent.click(screen.getByRole("button", { name: /解説を見る/ }));
    expect(card("A", "S3")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(zone("A", "grave")); wait(); perform("summon");
    const saved = loadProgress(scenario.id, window.localStorage);
    fireEvent.click(screen.getByRole("button", { name: /もう一度やる/ }));
    expect(card("A", "D5")).toHaveAccessibleName(/縦向き/);
    expect(loadProgress(scenario.id, window.localStorage)).toEqual(saved);
    expect(screen.queryByRole("button", { name: "次へ →" })).toBeNull();
  });
  it("既存6sceneの全20ゲーム操作と実物モードを維持する", () => {
    let count = 0;
    for (const scene of scenario.scenes) {
      window.localStorage.removeItem(lessonStorageKey);
      at(scene.stepIds[scene.presentation === "static" ? 1 : 0]);
      const view = render(<App />);
      if (scene.presentation === "interactive") for (const id of scene.stepIds) {
        count += deriveInteractions(scenario.steps.find((s) => s.id === id) as TutorialStep).length; perform(id);
      }
      expect(screen.getByRole("button", { name: "次へ →" })).toBeEnabled();
      view.unmount();
    }
    expect(count).toBe(20);
    window.localStorage.removeItem(lessonStorageKey); at("real-deck"); render(<App />);
    expect(screen.getByText("ここから実物カード")).toBeVisible();
    expect(document.querySelector(".interactive-board")).toBeNull();
  });
  it("もう一度やるでも表示上の最高進捗を巻き戻さない", () => {
    at("summon-cost-b"); render(<App />);
    perform("summon-cost-b"); perform("summon-cost-l"); perform("summon");
    const percent = screen.getByLabelText(/^全体の進捗/).getAttribute("aria-label");
    fireEvent.click(screen.getByRole("button", { name: /もう一度やる/ }));
    expect(screen.getByLabelText(percent!)).toBeVisible();
  });
  it("sidebar・最高到達・早見・8コースを維持する", () => {
    at("summon-cost-l", { maxReachedStepIndex: 20 }); render(<App />);
    expect(document.querySelectorAll(".chapter-group")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "← 戻る" }));
    expect(loadProgress(scenario.id, window.localStorage).maxReachedStepIndex).toBe(20);
    expect(document.querySelectorAll(".learning-roadmap li")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "ルール早見" }));
    expect(screen.getByRole("dialog", { name: "ルール早見" })).toBeVisible();
  });
  it("realモードの各実物操作と先攻決定を維持する", () => {
    at("real-deck"); render(<App />);
    for (const id of ["shuffle", "real-life", "real-hand", "preset-bulwark", "preset-soldier", "first-player"]) {
      fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
      expect(screen.getByRole("heading", { name: scenario.steps.find((s) => s.id === id)!.title })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "次へ →" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "PLAYER B" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByRole("heading", { name: "先攻だけ、1枚引きます。" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    fireEvent.click(screen.getByRole("button", { name: "対戦を始める →" }));
    expect(screen.getByRole("dialog", { name: "ルール早見" })).toBeVisible();
  });
  it("reduced motionでも成功後の順序を維持する", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    at("attack"); render(<App />); tap("A", "C6");
    expect(card("A", "C6")).toHaveAccessibleName(/横向き/);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(screen.queryByRole("button", { name: "次へ →" })).toBeNull();
  });
  it("mouse dragはghostと移動先を示し、誤dropで戻り、正しいdropだけ成功する", () => {
    class TestPointerEvent extends MouseEvent {
      pointerType: string;
      constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerType = options.pointerType || "mouse"; }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    at("summon-cost-b"); render(<App />); perform("summon-cost-b");
    const source = card("A", "S3");
    const previousHitTest = document.elementFromPoint;
    const hitTest = vi.fn(() => screen.getByTestId("B-grave"));
    document.elementFromPoint = hitTest;
    try {
      fireEvent.pointerDown(source, { pointerType: "mouse", button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(source, { pointerType: "mouse", clientX: 20, clientY: 20 });
      expect(document.querySelector(".card-ghost")).toHaveTextContent("ライフの裏向きカード");
      expect(screen.getByTestId("A-grave")).toHaveClass("destination-zone");
      fireEvent.pointerUp(source, { pointerType: "mouse", clientX: 30, clientY: 30 });
      expect(document.querySelector(".card-ghost")).toBeNull();
      expect(screen.getByTestId("A-life").querySelector('[data-card="S3"]')).toBeInTheDocument();
      hitTest.mockReturnValue(screen.getByTestId("A-grave"));
      fireEvent.pointerDown(source, { pointerType: "pen", button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(source, { pointerType: "pen", clientX: 20, clientY: 20 });
      fireEvent.pointerUp(source, { pointerType: "pen", clientX: 30, clientY: 30 });
      expect(screen.getByTestId("A-grave")).toHaveTextContent("♠3");
    } finally { document.elementFromPoint = previousHitTest; }
  });
  it("touchの移動をdragとして奪わず、移動先の既存カードにもタップできる", () => {
    class TestPointerEvent extends MouseEvent {
      pointerType = "touch";
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    at("summon-cost-b"); render(<App />); perform("summon-cost-b");
    const source = card("A", "S3");
    fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(source, { clientX: 20, clientY: 80 });
    expect(document.querySelector(".card-ghost")).toBeNull();
    expect(source).toHaveAttribute("aria-pressed", "false");
    fireEvent.pointerCancel(source);
    tap("A", "S3"); tap("A", "C6");
    expect(screen.getByTestId("A-grave")).toHaveTextContent("♠3");
  });
});
