import type { BoardCard, BoardState, Operation, Player, Zone } from "../types";
import { cardName } from "../lib/cards";
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

function MovementLane({
  player,
  operations,
  before,
  after,
}: {
  player: Player;
  operations: Operation[];
  before: BoardState;
  after: BoardState;
}) {
  if (!operations.length) return null;
  return (
    <div className="board-movements" aria-label={`PLAYER ${player}のカード変化`}>
      {operations.map((operation, index) => {
        const sameZone = operation.from === operation.to;
        const first = operation.cards[0];
        const fromCard = before[player][operation.from].find((card) => card.card === first);
        const toCard = after[player][operation.to].find((card) => card.card === first);
        const privateBulwark = (operation.from === "bulwarks" || operation.to === "bulwarks")
          && (toCard?.face === "down" || (!toCard && fromCard?.face === "down"));
        const stateChanged = !!fromCard && !!toCard && fromCard.state !== toCard.state;
        const cardText = privateBulwark
          ? "裏向きの防壁"
          : operation.cards.length > 1
            ? `${operation.cards.length}枚のカード`
            : first
              ? cardName(first)
              : "カード";
        const change = sameZone
          ? stateChanged
            ? `${cardText}：${stateName(fromCard?.state)} → ${stateName(toCard?.state)}`
            : fromCard
              ? operation.label
              : `${cardText}：${labels[operation.to]}に表示`
          : `${cardText}：${labels[operation.from]} → ${labels[operation.to]}`;
        return (
          <div className="board-movement" key={`${player}-${index}`}>
            <span className="movement-from">{stateChanged ? stateName(fromCard?.state) : labels[operation.from]}</span>
            <span className="movement-path" aria-hidden="true">
              <span className="movement-token">{stateChanged ? "↻" : cardText}</span>
              <span className="movement-arrow">{stateChanged || !sameZone ? "→" : "・"}</span>
            </span>
            <span className="movement-to">{stateChanged ? stateName(toCard?.state) : labels[operation.to]}</span>
            <span className="movement-description">{change}</span>
          </div>
        );
      })}
    </div>
  );
}
export function TutorialBoard({
  board,
  before,
  after,
  operations,
  applied,
  real,
  stepId,
}: {
  board: BoardState;
  before: BoardState;
  after: BoardState;
  operations: Operation[];
  applied: boolean;
  real: boolean;
  stepId: string;
}) {
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
    const changed = !real && related.some((o) => (applied ? o.to : o.from) === zone);
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
        className={`table-zone ${changed ? "changed-zone" : ""} zone-${zone}`}
      >
        <span className="zone-label">
          {labels[zone]}
          {!real && cards.length > 0 && <small> {cards.length}枚</small>}
        </span>
        <div className="zone-cards">
          {shown.map((c: BoardCard) => (
            <span className={`card-slot ${c.state}`} key={c.card}>
              <span
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
          ? "実物カードの置き場ガイド"
          : applied
            ? "変化後の盤面"
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
          {!real && applied && (
            <MovementLane
              player={p}
              operations={operations.filter((operation) => operation.player === p)}
              before={before}
              after={after}
            />
          )}
        </section>
      ))}
    </figure>
  );
}
