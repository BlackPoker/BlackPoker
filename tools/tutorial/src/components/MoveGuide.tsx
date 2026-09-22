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
  hideBulwarkCards = false,
}: {
  operations: Operation[];
  before: BoardState;
  after: BoardState;
  hideBulwarkCards?: boolean;
}) {
  if (!operations.length) return null;

  return (
    <section className="move-guide" aria-label="カードの動かし方">
      <strong className="move-guide-title">カードの動かし方</strong>
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
          const sourceCards = hideBulwarkCards && operation.from === "bulwarks"
            ? "裏向きカード"
            : cards;
          const destinationCards = hideBulwarkCards && operation.to === "bulwarks"
            ? "裏向きカード"
            : sameZone
              ? cards
              : "ここへ";

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
