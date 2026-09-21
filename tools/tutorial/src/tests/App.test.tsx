import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "../App";

describe("tutorial app", () => {
  it("現在の操作を最優先で表示し、次へ進める", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("heading", { name: "トランプが、戦場になる。" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /はじめる/ }));
    expect(screen.getByRole("heading", { name: "トランプを2組、用意しましょう。" })).toBeVisible();
  });

  it("モバイル幅でも主要UIと学習メニューへアクセスできる", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    fireEvent(window, new Event("resize"));
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText("いまやること")).toBeVisible();
    expect(screen.getByRole("button", { name: /はじめる/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "学習メニューを開く" }));
    expect(screen.getByLabelText("チュートリアル全体の進捗")).toBeInTheDocument();
  });

  it("確認後に最初からやり直せる", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /はじめる/ }));
    await user.click(screen.getByRole("button", { name: /最初からやり直す/ }));
    await user.click(screen.getByRole("button", { name: "やり直す" }));
    expect(screen.getByRole("heading", { name: "トランプが、戦場になる。" })).toBeVisible();
  });
});
