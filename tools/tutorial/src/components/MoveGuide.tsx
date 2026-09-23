import { cardName } from "../lib/cards";
import type { BoardState, Operation, Zone } from "../types";

const zoneNames: Record<Zone, string> = {
  life: "ライフ",
  hand: "手札",
  soldiers: "兵士",
  bulwarks: "防壁",
  grave: "墓地",
};

const directionName = (state?: "charge" | "drive") =>
  state === "drive" ? "横向き" : "縦向き";

export function MoveGuide({
  operations,
  before,
  after,
}: {
  operations: Operation[];
  before: BoardState;
  after: BoardState;
}) {
  if (!operations.length) return null;

  return (
    <section className="move-guide" aria-label="実物ではこう動かす">
      <strong className="move-guide-title">実物ではこう動かす</strong>
      <div className="move-guide-list">
        {operations.map((operation, index) => {
          const card = operation.cards[0];
          const beforeCard = card
            ? before[operation.player][operation.from].find((item) => item.card === card)
            : undefined;
          const afterCard = card
            ? after[operation.player][operation.to].find((item) => item.card === card)
            : undefined;
          const sameZone = operation.from === operation.to;
          const cards = operation.cards.length
            ? operation.cards.map(cardName).join("・")
            : "実物カード";
          const sourceCards = cards;
          const destinationCards = sameZone ? cards :
            operation.to === "bulwarks" ? "実物カード・裏向き" : "実物カード";

          return (
            <article className="move-row" key={`${operation.player}-${index}`}>
              <b className="move-player">PLAYER {operation.player}</b>
              <div className="move-place">
                <span>{zoneNames[operation.from]}</span>
                <strong>{sourceCards}</strong>
                {sameZone && <small>{directionName(beforeCard?.state)}</small>}
              </div>
              <span className="move-arrow" aria-hidden="true">→</span>
              <span className="visually-hidden">から</span>
              <div className="move-place destination-place">
                <span>{zoneNames[operation.to]}</span>
                <strong>{destinationCards}</strong>
                {sameZone && <small>{directionName(afterCard?.state)}</small>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
