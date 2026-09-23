import { useState } from "react";
import type { BoardCard, BoardState, MovementCause, Operation, Player, Zone } from "../types";
import { cardName } from "../lib/cards";
import { BoardOverlay } from "./BoardOverlay";
export { cardName } from "../lib/cards";
const labels: Record<Zone, string> = {
  life: "ライフ",
  soldiers: "兵士",
  bulwarks: "防壁",
  grave: "墓地",
  hand: "手札",
};
const stateName = (state?: BoardCard["state"]) =>
  state === "drive" ? "ドライブ" : "チャージ";

function movement(operation: Operation, before: BoardState, after: BoardState) {
  const first = operation.cards[0];
  const fromCard = before[operation.player][operation.from].find((card) => card.card === first);
  const toCard = after[operation.player][operation.to].find((card) => card.card === first);
  const hidden = (operation.from === "bulwarks" || operation.to === "bulwarks")
    && (toCard?.face === "down" || (!toCard && fromCard?.face === "down"));
  const name = hidden ? "裏向きの防壁" : operation.cards.length > 1
    ? `${operation.cards.length}枚のカード` : first ? cardName(first) : "カード";
  if (operation.from !== operation.to) {
    return { kind: "route", text: `${name}：${labels[operation.from]} → ${labels[operation.to]}`,
      chip: `${name}が移動` };
  }
  if (fromCard && toCard && fromCard.state !== toCard.state) {
    return { kind: "state", text: `${name}：${stateName(fromCard.state)} → ${stateName(toCard.state)}`,
      chip: `↻ ${stateName(fromCard.state)} → ${stateName(toCard.state)}` };
  }
  if (fromCard && toCard && fromCard.face !== toCard.face) {
    return { kind: "state", text: `${name}：${fromCard.face === "down" ? "裏" : "表"} → ${toCard.face === "down" ? "裏" : "表"}`,
      chip: "↻ 表示を変更" };
  }
  if (!fromCard && toCard) {
    return { kind: "appear", text: `${name}：${labels[operation.to]}に追加`, chip: `${name}を追加` };
  }
  const blocker = operation.label.includes("ブロック");
  return { kind: "mark", text: blocker ? `${name}：ブロッカーに指定` : operation.label,
    chip: blocker ? "ブロッカーに指定" : "カードは移動なし" };
}
export function TutorialBoard({
  board,
  before,
  after,
  operations,
  applied,
  real,
  stepId,
  cause,
  focusZones = [],
}: {
  board: BoardState;
  before: BoardState;
  after: BoardState;
  operations: Operation[];
  applied: boolean;
  real: boolean;
  stepId: string;
  cause?: MovementCause;
  focusZones?: { player: Player; zone: Zone }[];
}) {
  const [boardElement, setBoardElement] = useState<HTMLElement | null>(null);
  const realHints: Record<Zone, { main: string; sub: string }> = {
    life: stepId === "real-life"
      ? { main: "裏向きで16枚", sub: "実物カードの束" }
      : { main: "裏向きの束", sub: "一番上から引く" },
    hand: stepId === "real-hand"
      ? { main: "手元に7枚", sub: "相手に見せない" }
      : { main: "手札", sub: "相手に見せない" },
    bulwarks: stepId === "preset-bulwark"
      ? { main: "表・縦で1枚", sub: "最初の防壁" }
      : { main: "防壁の列", sub: "ライフ側から並べる" },
    soldiers: stepId === "preset-soldier"
      ? { main: "表・縦で1枚", sub: "最初の兵士" }
      : { main: "表向きのカード", sub: "兵士の置き場" },
    grave: stepId === "first-player"
      ? { main: "比べたカード", sub: "表向きで置く" }
      : { main: "表向きの束", sub: "使い終わったカード" },
  };

  function zone(player: Player, zone: Zone) {
    const cards = board[player][zone];
    const related = operations.filter((o) => o.player === player);
    const focused = cause?.phase === "setup" && focusZones.some((focus) => focus.player === player && focus.zone === zone);
    const changed = !real && cause?.phase !== "setup" && related.some((o) => (applied ? o.to : o.from) === zone);
    const annotations = !real && cause?.phase !== "setup" ? related.filter((o) => o.to === zone &&
      (applied || o.from === o.to))
      .map((operation) => movement(operation, before, after)) : [];
    const stack = zone === "life" || zone === "grave";
    const shown = stack
      ? zone === "life"
        ? cards.slice(0, 1)
        : cards.slice(-1)
      : cards;
    return (
      <div
        key={zone}
        data-zone={zone}
        data-testid={player + "-" + zone}
        className={`table-zone ${changed ? "changed-zone" : ""} ${focused ? "focused-zone" : ""} zone-${zone}`}
      >
        <span className="zone-label">
          {labels[zone]}
          {!real && cards.length > 0 && <small> {cards.length}枚</small>}
        </span>
        <div className="zone-cards">
          {shown.map((c: BoardCard) => (
            <span className={`card-slot ${c.state}`} key={c.card}>
              <span
                data-card={c.card}
                className={`board-card ${c.state} ${c.face === "down" ? "face-down" : ""} ${changed && related.some((o) => o.cards.includes(c.card)) ? "changed-card" : ""}`}
                aria-label={`${player} ${c.face === "down" ? `${labels[zone]}の裏向きカード` : cardName(c.card)} ${c.face === "down" ? "裏向き" : "表向き"} ${c.state === "drive" ? "横向き" : "縦向き"}`}
              >
                {c.face === "down" ? "BP" : cardName(c.card)}
              </span>
            </span>
          ))}
          {!shown.length && real && (
            <span className={`real-placeholder placeholder-${zone}`}>
              <span className={`slot-stack slot-${zone}`} aria-hidden="true">
                <i /><i /><i />
              </span>
              <strong>{realHints[zone].main}</strong>
              <small>{realHints[zone].sub}</small>
            </span>
          )}
          {!shown.length && !real && <span className="empty-zone">—</span>}
        </div>
        {annotations.map((annotation, index) => (
          <span className={`zone-motion-label motion-${annotation.kind}`} key={index} aria-hidden="true">
            {annotation.chip}
          </span>
        ))}
      </div>
    );
  }
  return (
    <figure
      ref={setBoardElement}
      className="persistent-board"
      aria-label={real ? "実物カードの配置ガイド" : "練習の盤面"}
    >
      <figcaption>
        {real
          ? "実物カードの置き場ガイド"
          : cause?.phase === "setup"
            ? "対戦途中の練習用盤面"
            : applied
            ? "変化後の盤面"
            : "操作前の盤面"}
      </figcaption>
      {!real && applied && before.turn !== after.turn && (
        <div className="turn-motion" aria-label={`ターン：PLAYER ${before.turn}からPLAYER ${after.turn}へ`}>
          PLAYER {before.turn} <span aria-hidden="true">→</span> PLAYER {after.turn}
        </div>
      )}
      {(["B", "A"] as const).map((p) => (
        <section
          key={p}
          className={`player-half player-${p}`}
          aria-label={`プレイヤー${p}の盤面`}
        >
          <header>
            <strong>PLAYER {p}</strong>
            {board.turn === p && <span>いまのターン</span>}
            {!real && applied && !operations.length && before.turn === after.turn &&
              cause && cause.phase !== "setup" && board.turn === p &&
              <span className="board-still-label">カード移動なし</span>}
          </header>
          <div className="table-zones">
            {(p === "A"
              ? ["life", "soldiers", "bulwarks", "grave", "hand"]
              : ["grave", "bulwarks", "soldiers", "life", "hand"]
            ).map((z) => zone(p, z as Zone))}
          </div>
        </section>
      ))}
      {!real && !applied && cause?.phase !== "setup" && boardElement &&
        <BoardOverlay board={boardElement} operations={operations} />}
      {!real && applied && (
        <ul className="visually-hidden" aria-label="カードの変化">
          {operations.map((operation, index) => (
            <li key={index}>PLAYER {operation.player}：{movement(operation, before, after).text}</li>
          ))}
          {before.turn !== after.turn && <li>ターン：PLAYER {before.turn} → PLAYER {after.turn}</li>}
          {!operations.length && before.turn === after.turn && cause && cause.phase !== "setup" &&
            <li>カード移動なし</li>}
        </ul>
      )}
    </figure>
  );
}
