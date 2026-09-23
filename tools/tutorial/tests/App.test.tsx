import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "../src/App";
import scenario from "../src/data/tutorials/entry16.json";
import {
  clearIntroComplete,
  loadIntroComplete,
  loadProgress,
  saveIntroComplete,
  saveProgress,
} from "../src/lib/storage";
import { cardName } from "../src/lib/cards";
function at(id: string, extra = {}) {
  saveProgress(
    {
      scenarioId: scenario.id,
      stepIndex: scenario.steps.findIndex((s) => s.id === id),
      completed: false,
      updatedAt: "",
      ...extra,
    },
    window.localStorage,
  );
}
describe("hands-on tutorial", () => {
  beforeEach(() => saveIntroComplete(window.localStorage));

  it("初回アクセスでは3画面のINTROから既存Tutorialへ進む", async () => {
    clearIntroComplete(window.localStorage);
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { name: /BlackPokerって.*どんなゲーム？/ })).toBeVisible();
    expect(screen.getByText("トランプだけで、", { exact: false })).toBeVisible();
    expect(screen.getByLabelText(/対戦盤面のイメージ/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: /次へ/ }));
    expect(screen.getByRole("heading", { name: "どうなったら勝ち？" })).toBeVisible();
    expect(screen.getByText(/相手のライフを/)).toBeVisible();
    expect(screen.getByText(/山札を「ライフ」/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: /次へ/ }));
    expect(screen.getByRole("heading", { name: /まずは一番簡単な.*ルールから/ })).toBeVisible();
    expect(screen.getByText("ライト＋エントリー16")).toBeVisible();
    expect(screen.getByText(/実物カードは、まだ用意しなくてOK/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: /画面で練習してみる/ }));
    expect(screen.getByRole("heading", { name: "まずは、画面だけで練習します。" })).toBeVisible();
    expect(loadIntroComplete(window.localStorage)).toBe(true);
  });

  it("INTROを通っても保存済みのTutorial進捗を維持する", async () => {
    at("attack", { maxReachedStepIndex: 14, firstPlayer: "B" });
    clearIntroComplete(window.localStorage);
    const saved = loadProgress(scenario.id, window.localStorage);
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await userEvent.click(screen.getByRole("button", { name: /次へ/ }));
    await userEvent.click(screen.getByRole("button", { name: /画面で練習してみる/ }));

    expect(screen.getByRole("heading", { name: "次の盤面の変化を見てみましょう。" })).toBeVisible();
    expect(loadProgress(scenario.id, window.localStorage)).toMatchObject({
      stepIndex: saved.stepIndex,
      maxReachedStepIndex: saved.maxReachedStepIndex,
      firstPlayer: "B",
    });
  });

  it("固定練習は次へだけで盤面変化と次のステップを表示する", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "まずは、画面だけで練習します。" }),
    ).toBeVisible();
    expect(screen.getByText("実物カードはまだ使いません")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByRole("status")).toHaveTextContent("プレイヤーBが上");
    await user.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByTestId("actor")).toHaveTextContent("PLAYER A");
    expect(screen.queryByText(/ここへ/)).toBeNull();
  });
  it("actor BでもターンAを維持し、ブロックで兵士を回転しない", async () => {
    at("block");
    render(<App />);
    expect(screen.getByTestId("actor")).toHaveTextContent("PLAYER B");
    expect(screen.getByTestId("actor")).toHaveTextContent("ターン：PLAYER A");
    await userEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(
      within(screen.getByTestId("B-soldiers")).getByLabelText(
        "B ♥7 表向き 縦向き",
      ),
    ).toBeVisible();
  });
  it("カードの横向きと墓地移動を操作前後で確認できる", async () => {
    at("attack");
    const view = render(<App />);
    expect(screen.getByLabelText("A ♣6 表向き 縦向き")).toBeVisible();
    expect(screen.queryByText(/アタックの解決で/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByLabelText("A ♣6 表向き 横向き")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("アタックの解決で");
    expect(screen.getByRole("list", { name: "カードの変化" })).toHaveTextContent("♣6：チャージ → ドライブ");
    view.unmount();
    at("damage");
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(
      within(screen.getByTestId("A-grave")).getByLabelText(/♣6/),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("A-soldiers")).queryByLabelText(/♣6/),
    ).toBeNull();
  });
  it("固定練習は解説を開かず次へだけで実物カードの準備まで進める", () => {
    at("welcome");
    render(<App />);
    const fixedSteps = scenario.steps.filter((step) => step.mode === "fixed");
    for (const [index, step] of fixedSteps.entries()) {
      expect(loadProgress(scenario.id, window.localStorage).stepIndex).toBe(index);
      fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
      expect(loadProgress(scenario.id, window.localStorage).applied).toBe(true);
      expect(screen.getByRole("status")).toHaveTextContent(step.learned);
      fireEvent.click(screen.getByRole("button", { name: "次へ →" }));
    }
    expect(screen.getByText("ここから実物カード")).toBeVisible();
    expect(loadProgress(scenario.id, window.localStorage).stepIndex).toBe(fixedSteps.length);
    expect(screen.queryByText(/解説を見る/, { selector: ".why-content *" })).toBeNull();
  });
  it("request・resolve・triggerの教材上の理由を変化後に表示する", async () => {
    for (const [id, phrase, phase] of [
      ["summon-cost-b", "コストB", "リクエスト時"],
      ["summon", "兵士として場に出ました", "解決時"],
      ["charge", "チャージが誘発", "誘発したアクション"],
    ]) {
      at(id);
      const view = render(<App />);
      expect(screen.queryByRole("status")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "次へ →" }));
      expect(screen.getByRole("status")).toHaveTextContent(phrase);
      await userEvent.click(screen.getByRole("button", { name: /解説を見る/ }));
      expect(document.querySelector(".cause-phase")).toHaveTextContent(phase);
      view.unmount();
    }
  });
  it("別の展開を開いても本編の進捗は変わらない", async () => {
    at("damage");
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "次へ →" }));
    const before = loadProgress(scenario.id, window.localStorage).stepIndex;
    await userEvent.click(screen.getByRole("button", { name: /別の展開を見る/ }));
    expect(screen.getByText("もしブロックしなかったら？")).toBeVisible();
    expect(loadProgress(scenario.id, window.localStorage).stepIndex).toBe(before);
  });
  it("操作後の盤面を再開し最初からやり直せる", async () => {
    at("attack");
    const view = render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "次へ →" }));
    view.unmount();
    render(<App />);
    expect(screen.getByLabelText("A ♣6 表向き 横向き")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "最初からやり直す" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "やり直す" }));
    expect(
      screen.getByRole("heading", { name: /BlackPokerって.*どんなゲーム？/ }),
    ).toBeVisible();
    expect(loadProgress(scenario.id, window.localStorage).stepIndex).toBe(0);
    expect(loadIntroComplete(window.localStorage)).toBe(false);
  });
  it("先攻決定なしで進めず、選んだBが開始時1枚を引く", async () => {
    at("first-player");
    render(<App />);
    expect(screen.getByRole("button", { name: "次へ →" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "PLAYER B" }));
    await userEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(screen.getByTestId("actor")).toHaveTextContent("PLAYER B");
    const guide = screen.getByRole("region", { name: "実物ではこう動かす" });
    expect(within(guide).getByText("ライフ")).toBeVisible();
    expect(within(guide).getByText("手札")).toBeVisible();
  });
  it("早見をどの段階でも開き、ライトの魔法・コストを確認できる", async () => {
    render(<App />);
    await userEvent.click(
      screen.getByRole("button", { name: "ルール早見" }),
    );
    const help = screen.getByRole("dialog", { name: "ルール早見" });
    expect(within(help).getByRole("heading", { name: "アップ" })).toBeVisible();
    expect(
      within(help).getByRole("heading", { name: "英雄召喚" }),
    ).toBeVisible();
    expect(within(help).getByText("まず使うアクション")).toBeVisible();
    expect(within(help).getByText("その他のアクション")).toBeVisible();
    expect(within(help).getAllByText("1点ダメージを受ける").length).toBeGreaterThan(0);
    expect(
      within(help).queryByRole("heading", { name: "クイック召喚" }),
    ).toBeNull();
    await userEvent.type(within(help).getByRole("textbox"), "兵士召喚");
    expect(within(help).getAllByText(/防壁をドライブする/).length).toBeGreaterThan(0);
    await userEvent.click(
      within(help).getByRole("button", { name: "早見を閉じる" }),
    );
    expect(screen.queryByRole("dialog", { name: "ルール早見" })).toBeNull();
  });
  it("モバイルでもメニューと早見にアクセスできる", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    fireEvent(window, new Event("resize"));
    render(<App />);
    await userEvent.click(
      screen.getByRole("button", { name: "学習メニューを開く" }),
    );
    expect(
      screen.getByLabelText("チュートリアル全体の進捗"),
    ).toBeInTheDocument();
    expect(document.querySelectorAll(".chapter-group")).toHaveLength(4);
    expect(document.querySelectorAll(".learning-roadmap li")).toHaveLength(8);
  });
  it("実物カードの準備では置き場ガイドを表示する", () => {
    at("real-hand");
    render(<App />);
    expect(screen.getByText("ここから実物カード")).toBeVisible();
    expect(screen.getAllByText("手元に7枚")).toHaveLength(2);
    expect(document.querySelectorAll(".slot-stack").length).toBeGreaterThan(0);
    expect(screen.queryByText(/ここへ/)).toBeNull();
    expect(screen.getByRole("button", { name: "次へ →" })).toBeVisible();
  });
  it("戻っても最高到達ステップと完了率を維持する", async () => {
    const index = scenario.steps.findIndex((step) => step.id === "direct-damage");
    at("direct-damage", { maxReachedStepIndex: index, completed: true });
    render(<App />);
    const before = screen.getByLabelText(/^全体の進捗/).getAttribute("aria-label");
    await userEvent.click(screen.getAllByRole("button", { name: "← 戻る" })[0]);
    expect(screen.getByRole("heading", { name: "今回は、ブロックしません。" })).toBeVisible();
    expect(screen.getByLabelText(/^全体の進捗/).getAttribute("aria-label")).toBe(before);
    expect(loadProgress(scenario.id, window.localStorage)).toMatchObject({
      stepIndex: index - 1,
      maxReachedStepIndex: index,
      completed: true,
    });
  });
  it("アクションとキャラクターを切り替え、主要キャラクターを検索できる", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "ルール早見" }));
    const help = screen.getByRole("dialog", { name: "ルール早見" });
    await userEvent.click(within(help).getByRole("tab", { name: "キャラクター" }));
    for (const name of ["一般兵", "英雄", "エース", "防壁"]) {
      const search = within(help).getByRole("textbox");
      await userEvent.clear(search);
      await userEvent.type(search, name);
      expect(within(help).getByRole("heading", { name })).toBeVisible();
    }
    await userEvent.click(within(help).getByRole("tab", { name: "アクション" }));
    expect(within(help).getByText("まず使うアクション")).toBeVisible();
  });
  it("通常の防壁は種類を見せず裏向きで表示する", async () => {
    at("set-bulwark-place");
    render(<App />);
    const beforeZone = within(screen.getByTestId("B-bulwarks"));
    expect(beforeZone.getAllByLabelText(/防壁の裏向きカード/).length).toBeGreaterThan(0);
    expect(beforeZone.queryByText("♢8")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "次へ →" }));
    const zone = within(screen.getByTestId("B-bulwarks"));
    expect(zone.getAllByLabelText(/防壁の裏向きカード 裏向き 縦向き/).length).toBeGreaterThan(0);
    expect(zone.queryByText("♢8")).toBeNull();
  });
  it("ゲーム開始時のプリセット防壁だけ表向きで案内する", () => {
    at("preset-bulwark");
    render(<App />);
    expect(screen.getAllByText("表・縦で1枚", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText(/ゲーム開始時だけ、防壁は表向き/)).toBeVisible();
    expect(screen.getByText(/通常の「防壁設置」では裏向き/)).toBeVisible();
  });
  it("カード名とブランド表記を統一する", () => {
    expect(cardName("D5")).toBe("♢5");
    render(<App />);
    expect(screen.getAllByText("BlackPoker", { exact: false }).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent("BLACKPOKER");
    expect(document.body).not.toHaveTextContent("Black Poker");
    expect(document.body).not.toHaveTextContent("♦");
    expect(JSON.stringify(scenario)).not.toContain("♦");
  });
  it("戻るはトップバーになく、主操作の左に固定する", () => {
    render(<App />);
    const topbar = document.querySelector(".topbar");
    const actions = document.querySelector(".step-actions");
    expect(topbar?.querySelector('[aria-label="← 戻る"]')).toBeNull();
    expect(actions?.children[0]).toHaveAttribute("aria-label", "← 戻る");
    expect(actions?.children[1]).toHaveClass("primary-button");
    expect(actions?.children[0]).toBeDisabled();
  });
  it("固定練習は下部の移動表を使わず盤面SVGと読み上げテキストを表示する", async () => {
    at("summon");
    render(<App />);
    expect(screen.queryByRole("region", { name: "カードの動かし方" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "次へ →" }));
    expect(document.querySelector(".board-movements")).toBeNull();
    expect(document.querySelector("svg.board-overlay")).toBeInTheDocument();
    const changes = screen.getByRole("list", { name: "カードの変化" });
    expect(changes).toHaveTextContent("♠2：手札 → 兵士");
    expect(within(screen.getByTestId("A-soldiers")).getByText("♠2が移動")).toBeVisible();
    expect(screen.queryByText(/ここへ/)).toBeNull();
  });
});
