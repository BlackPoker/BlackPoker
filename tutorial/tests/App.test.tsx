import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../src/App";
import scenario from "../src/data/tutorials/entry16.json";
import { saveProgress } from "../src/lib/storage";
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
  it("操作を確定してから用語と次の操作を表示する", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "トランプを2組、用意しましょう。" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /2人の場所を決めた/ }));
    expect(screen.getByRole("status")).toHaveTextContent("プレイヤーBが上");
    await user.click(screen.getByRole("button", { name: /次の操作へ/ }));
    expect(screen.getByTestId("actor")).toHaveTextContent("PLAYER A");
  });
  it("actor BでもターンAを維持し、ブロックで兵士を回転しない", async () => {
    at("block");
    render(<App />);
    expect(screen.getByTestId("actor")).toHaveTextContent("PLAYER B");
    expect(screen.getByTestId("actor")).toHaveTextContent("ターン：PLAYER A");
    await userEvent.click(
      screen.getByRole("button", { name: /♥7でブロックした/ }),
    );
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
    await userEvent.click(
      screen.getByRole("button", { name: /♣6を横向きにした/ }),
    );
    expect(screen.getByLabelText("A ♣6 表向き 横向き")).toBeVisible();
    view.unmount();
    at("damage");
    render(<App />);
    await userEvent.click(
      screen.getByRole("button", { name: /♣6を墓地へ置いた/ }),
    );
    expect(
      within(screen.getByTestId("A-grave")).getByLabelText(/♣6/),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("A-soldiers")).queryByLabelText(/♣6/),
    ).toBeNull();
  });
  it("操作後の盤面を再開し最初からやり直せる", async () => {
    at("attack");
    const view = render(<App />);
    await userEvent.click(
      screen.getByRole("button", { name: /♣6を横向きにした/ }),
    );
    view.unmount();
    render(<App />);
    expect(screen.getByLabelText("A ♣6 表向き 横向き")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "最初からやり直す" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "やり直す" }));
    expect(
      screen.getByRole("heading", { name: "トランプを2組、用意しましょう。" }),
    ).toBeVisible();
  });
  it("先攻決定なしで進めず、選んだBが開始時1枚を引く", async () => {
    at("first-player");
    render(<App />);
    expect(screen.getByRole("button", { name: /先攻を決め、/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "PLAYER B" }));
    await userEvent.click(screen.getByRole("button", { name: /先攻を決め、/ }));
    await userEvent.click(screen.getByRole("button", { name: /次の操作へ/ }));
    expect(screen.getByTestId("actor")).toHaveTextContent("PLAYER B");
    expect(
      screen.getByText("ライフ → 手札（1枚）", { exact: false }),
    ).toBeVisible();
  });
  it("早見をどの段階でも開き、ライトの魔法・コストを確認できる", async () => {
    render(<App />);
    await userEvent.click(
      screen.getByRole("button", { name: "アクション早見" }),
    );
    const help = screen.getByRole("dialog", { name: "アクション早見" });
    expect(within(help).getByRole("heading", { name: "アップ" })).toBeVisible();
    expect(
      within(help).getByRole("heading", { name: "英雄召喚" }),
    ).toBeVisible();
    expect(
      within(help).queryByRole("heading", { name: "クイック召喚" }),
    ).toBeNull();
    await userEvent.type(within(help).getByRole("textbox"), "兵士召喚");
    expect(within(help).getByText(/縦向きの防壁1体を横に/)).toBeVisible();
    await userEvent.click(
      within(help).getByRole("button", { name: "早見を閉じる" }),
    );
    expect(screen.queryByRole("dialog", { name: "アクション早見" })).toBeNull();
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
  });
});
