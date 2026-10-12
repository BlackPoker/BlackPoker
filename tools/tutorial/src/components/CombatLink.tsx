import type { BoardState, CombatExample } from "../types";
import { cardName } from "../lib/cards";

/** 戦闘の対応を示す接続。カード移動のBoardOverlayとは独立し、矢印を使わない。 */
export function CombatLink({ combat, board }: { combat: CombatExample; board: BoardState }) {
  if (!combat.blocker) return null;
  const blocker = board[combat.blocker.player][combat.blocker.zone].find((c) => c.card === combat.blocker!.card);
  const blockerName = blocker?.face === "down" ? "裏向きの防壁" : cardName(combat.blocker.card);
  return <div className="combat-link" role="group" aria-label={`この戦闘の対応：${blockerName}が${cardName(combat.attacker.card)}をブロック`}>
    <span>相手 {cardName(combat.attacker.card)}<small>アタッカー</small></span>
    <strong className="combat-connection">BLOCK</strong>
    <span>あなた {blockerName}<small>ブロッカー</small></span>
  </div>;
}
