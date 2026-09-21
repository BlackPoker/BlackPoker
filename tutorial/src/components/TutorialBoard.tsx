import type { BoardCard, BoardState, Operation, Player, Zone } from "../types";
export const cardName = (code: string) =>
  (({ S: "♠", H: "♥", D: "♦", C: "♣" })[code[0]] || "") + code.slice(1);
const labels: Record<Zone, string> = {
  life: "ライフ",
  soldiers: "兵士",
  bulwarks: "防壁",
  grave: "墓地",
  hand: "手札",
};
export function TutorialBoard({
  board,
  after,
  operations,
  applied,
  real,
}: {
  board: BoardState;
  after: BoardState;
  operations: Operation[];
  applied: boolean;
  real: boolean;
}) {
  function zone(player: Player, zone: Zone) {
    const cards = board[player][zone];
    const related = operations.filter((o) => o.player === player);
    const target = related.some((o) => o.to === zone);
    const source = related.some((o) => o.from === zone);
    const preview =
      !applied && !real
        ? after[player][zone].filter(
            (c) =>
              !cards.some((existing) => existing.card === c.card) &&
              related.some((o) => o.to === zone && o.cards.includes(c.card)),
          )
        : [];
    const stack = zone === "life" || zone === "grave";
    const shown = stack
      ? zone === "life"
        ? cards.slice(0, 1)
        : cards.slice(-1)
      : cards;
    return (
      <div
        key={zone}
        data-testid={player + "-" + zone}
        className={`table-zone ${target ? "destination" : ""} ${source ? "source" : ""} zone-${zone}`}
      >
        <span className="zone-label">
          {labels[zone]}
          {!real && cards.length > 0 && <small> {cards.length}枚</small>}
        </span>
        <div className="zone-cards">
          {shown.map((c: BoardCard) => (
            <span
              key={c.card}
              className={`board-card ${c.state} ${c.face === "down" ? "face-down" : ""} ${related.some((o) => o.cards.includes(c.card)) ? "selected-card" : ""}`}
              aria-label={`${player} ${cardName(c.card)} ${c.face === "down" ? "裏向き" : "表向き"} ${c.state === "drive" ? "横向き" : "縦向き"}`}
            >
              {c.face === "down" ? "BP" : cardName(c.card)}
            </span>
          ))}
          {preview.slice(0, 2).map((c) => (
            <span
              key={"preview-" + c.card}
              className={`board-card ghost-card ${c.state}`}
              aria-label={`置く位置 ${cardName(c.card)}`}
            >
              {cardName(c.card)}
            </span>
          ))}
          {!shown.length && !preview.length && (
            <span className="empty-zone">{real ? "実物のカード" : "—"}</span>
          )}
        </div>
        {target && (
          <small className="target-label">
            {applied
              ? "確認"
              : related.some((o) => o.from === zone && o.to === zone)
                ? "ここを操作"
                : "↓ ここへ"}
          </small>
        )}
      </div>
    );
  }
  return (
    <figure
      className="persistent-board"
      aria-label={real ? "実物カードの配置ガイド" : "練習の盤面"}
    >
      <figcaption>
        {real
          ? "配置ガイド · カードと枚数は実物で確認"
          : applied
            ? "操作後の盤面"
            : "操作前の盤面"}
      </figcaption>
      {(["B", "A"] as const).map((p) => (
        <section
          key={p}
          className={`player-half player-${p}`}
          aria-label={`プレイヤー${p}の盤面`}
        >
          <header>
            <strong>PLAYER {p}</strong>
            {board.turn === p && <span>いまのターン</span>}
          </header>
          <div className="table-zones">
            {(p === "A"
              ? ["life", "soldiers", "bulwarks", "grave", "hand"]
              : ["grave", "bulwarks", "soldiers", "life", "hand"]
            ).map((z) => zone(p, z as Zone))}
          </div>
        </section>
      ))}
    </figure>
  );
}
