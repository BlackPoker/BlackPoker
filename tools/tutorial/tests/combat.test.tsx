import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { AttackConceptDiagram } from "../src/components/AttackConceptDiagram";
import { TutorialBoard } from "../src/components/TutorialBoard";
import { scenarios } from "../src/data/lessons";
import { deriveInteractions, attemptInteraction, interactionBoard } from "../src/lib/interaction.mjs";
import { validateScenario } from "../src/lib/schema.mjs";
import { ruleCatalog } from "../src/generated/ruleCatalog";
import { card, section, hash, tap, wait, automatic, finish, zone } from "./book-helpers";
const fixture = (id: string) => structuredClone(scenarios.find((s) => s.scenes[0]?.id === id)!);

describe("アタック全体像と単体指定", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("3体のうち2体だけが相手プレイヤーに参加する図を読む", () => {
    render(<AttackConceptDiagram />);
    expect(screen.getByText("アタックは1ターンに1回")).toBeVisible();
    expect(screen.getByText("そのアタックに参加する兵士をまとめて選ぶ。")).toBeVisible();
    expect(document.querySelectorAll('[data-attacker="true"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-attacker="false"]')).toHaveLength(1);
    expect(screen.getByText("今回は選ばない")).toBeVisible();
    expect(document.querySelector(".attack-player-flow")).toHaveTextContent("相手プレイヤー");
    expect(document.querySelector(".attack-player-flow .playing-card")).toBeNull();
    expect(screen.getByRole("figure")).toHaveAccessibleName(/1ターンに1回.*まとめて指定.*相手プレイヤー/);
    const details = document.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(within(details).getByText("アタッカーにできる条件"));
    expect(details).toHaveTextContent("<攻撃>"); expect(details).toHaveTextContent("<速攻>");
    expect(details).toHaveTextContent("複数指定可能"); expect(details).toHaveTextContent("ドライブ状態");
  });
  it("向き→図→1体の実操作の順で、初戦のSection数は増やさない", () => {
    hash("orientation"); render(<App />);
    const orientation = section("orientation");
    expect(orientation.querySelector(".attack-concept")).toBeVisible();
    expect(orientation.querySelector(".orientation-primer")!.compareDocumentPosition(orientation.querySelector(".attack-concept")!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(within(orientation).getByRole("button", { name: "次へ →" }));
    expect(section("unblocked-attack")).toHaveTextContent("今回は♠2だけをアタッカー");
    expect(screen.getByLabelText("まず遊ぶの進捗")).toHaveTextContent("/ 12");
  });
  it.each(["first-battle", "bulwark-block"])("%sは自分の1回指定だけで、盤面を変えず対応を表示する", (id) => {
    const scene = fixture(id), step = scene.steps[0], command = deriveInteractions(step)[0];
    if (command.kind !== "designate-card") throw new Error("designation required");
    expect(attemptInteraction(command, null, { kind: "card", card: scene.scenes[0].combat!.attacker })).toBe("wrong-source");
    expect(attemptInteraction(command, null, { kind: "card", card: command.source })).toBe("success");
    expect(attemptInteraction(command, null, { kind: "drop", source: command.source })).toBe("wrong-source");
    expect(interactionBoard(step, 1)).toEqual(step.board.before);
    hash(id); render(<App />);
    expect(card(id, "B", "C6")).toHaveAccessibleName(/アタック中/);
    tap(id, "B", "C6"); // 誤入力では指定されない
    expect(section(id).querySelector(".combat-link")).toBeNull();
    tap(id, command.source.player, command.source.card);
    expect(card(id, "A", command.source.card)).toHaveAccessibleName(/縦向き.*ブロッカー/);
    expect(section(id).querySelector(".combat-link")).toHaveAccessibleName(/ブロック/);
    expect(section(id).querySelector(".combat-link")).toHaveTextContent("BLOCK");
    expect(section(id).querySelector(".combat-link svg,.combat-link [marker-end],line.board-route")).toBeNull();
    expect(card(id, "B", "C6")).not.toHaveClass("expected-card");
    if (id === "bulwark-block") expect(section(id).querySelector(".combat-link")).toHaveTextContent("裏向きの防壁");
  });
  it("指定コマンドは任意の教材ラベルを持て、向き変更はschemaで拒否する", () => {
    const scene = fixture("first-battle"), step = scene.steps[0];
    step.interaction = { kind: "designate-card", label: "今回使うカード" };
    expect(deriveInteractions(step)[0]).toMatchObject({ kind: "designate-card", label: "今回使うカード" });
    expect(validateScenario(scene, ruleCatalog)).toEqual([]);
    step.board.after.A.soldiers[0].state = "drive";
    expect(validateScenario(scene, ruleCatalog)).toContain("Designation interaction must not change board");
  });
  it("兵士ブロックは6<7・相手墓地・ライフ不変を結果として残す", () => {
    hash("first-battle"); render(<App />); tap("first-battle", "A", "H7"); wait(); automatic();
    const result = within(section("first-battle")).getByRole("list", { name: "戦闘結果" });
    expect(result).toHaveTextContent("6 < 7"); expect(result).toHaveTextContent("相手の♣6 → 墓地");
    expect(result).toHaveTextContent("ライフ → そのまま（減らない）");
    expect(card("first-battle", "A", "H7")).toHaveAccessibleName(/縦向き/);
    expect(zone("first-battle", "B", "grave").querySelector('[data-card="C6"]')).toBeInTheDocument();
    fireEvent.click(within(section("first-battle")).getByRole("button", { name: /もう一度やる/ }));
    expect(section("first-battle").querySelector(".combat-link")).toBeNull();
    expect(card("first-battle", "A", "H7")).not.toHaveAccessibleName(/ブロッカー/);
    expect(card("first-battle", "B", "C6")).toHaveAccessibleName(/アタック中/);
  });
  it("防壁ブロックは公開・一致・両方墓地・ライフ不変を残す", () => {
    hash("bulwark-block"); render(<App />); finish("bulwark-block");
    const result = within(section("bulwark-block")).getByRole("list", { name: "戦闘結果" });
    expect(result).toHaveTextContent("防壁を公開：6 = 6で数字が一致");
    expect(result).toHaveTextContent("あなたの防壁も → 墓地"); expect(result).toHaveTextContent("ライフ → そのまま（減らない）");
  });
  it("攻撃のreplay注意は攻撃だけに表示し、やり直すと結果・指定を戻す", () => {
    hash("unblocked-attack"); render(<App />); finish("unblocked-attack");
    expect(section("unblocked-attack").querySelector(".replay-note")).toHaveTextContent("練習のやり直し");
    expect(section("unblocked-attack").querySelector(".replay-note")).toHaveTextContent("1ターンに1回");
    fireEvent.click(within(section("unblocked-attack")).getByRole("button", { name: /もう一度やる/ }));
    expect(card("unblocked-attack", "A", "S2")).toHaveAccessibleName(/縦向き/);
    expect(section("unblocked-attack").querySelector(".combat-result")).toBeNull();
  });
});

describe("戦場と非公開情報", () => {
  const step = () => fixture("first-battle").steps[0];
  it("Bが上で防壁→兵士、Aは兵士→防壁、サポート領域は別", () => {
    const s = step(); render(<TutorialBoard board={s.board.before} before={s.board.before} after={s.board.after} operations={[]} real={false} applied={false} stepId="test" />);
    expect([...document.querySelectorAll(".player-half")].map((e) => e.className)).toEqual(["player-half player-B", "player-half player-A"]);
    for (const p of ["A", "B"]) {
      const field = document.querySelector(`.player-${p} .battlefield`)!;
      expect([...field.children].map((e) => (e as HTMLElement).dataset.zone)).toEqual(p === "A" ? ["soldiers", "bulwarks"] : ["bulwarks", "soldiers"]);
      expect(document.querySelectorAll(`.player-${p} .support-zones > .table-zone`)).toHaveLength(3);
      expect(field.querySelector(".zone-hand,.zone-life,.zone-grave")).toBeNull();
    }
  });
  it("Bの手札は表面もaria名も描画せず、Aだけ見せ、明示指定でのみ公開する", () => {
    const s = step();
    s.board.before.B.hand = [{ card: "HK", face: "up", state: "charge" }];
    s.board.before.A.hand = [{ card: "DJ", face: "up", state: "charge" }];
    const props = { board: s.board.before, before: s.board.before, after: s.board.before, operations: [], real: false, applied: false, stepId: "privacy" };
    const view = render(<TutorialBoard {...props} />);
    expect(screen.getByTestId("B-hand")).toHaveTextContent("相手の手札1枚");
    expect(screen.getByTestId("B-hand").querySelector("[data-card],.card-face")).toBeNull();
    expect(screen.queryByLabelText(/B ♥K/)).toBeNull();
    expect(screen.getByTestId("A-hand").querySelector('[data-card="DJ"]')).toBeInTheDocument();
    view.rerender(<TutorialBoard {...props} revealOpponentHand />);
    expect(screen.getByTestId("B-hand").querySelector('[data-card="HK"]')).toBeInTheDocument();
  });
  it("schemaは不正な公開metadataとブロック対応を拒否する", () => {
    const scene = fixture("first-battle");
    (scene.steps[0] as any).revealOpponentHand = "yes";
    scene.scenes[0].combat!.designationStepId = "missing";
    expect(validateScenario(scene, ruleCatalog)).toContain("Invalid revealOpponentHand");
    expect(validateScenario(scene, ruleCatalog)).toContain("Invalid combat designation");
  });
});
