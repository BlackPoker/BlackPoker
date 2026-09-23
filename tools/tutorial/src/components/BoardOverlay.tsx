import { useLayoutEffect, useState } from "react";
import type { Operation, Player, Zone } from "../types";

type Line = { key: string; player: Player; from: Zone; to: Zone; x1: number; y1: number; x2: number; y2: number; card: boolean };

function measure(board: HTMLElement, operations: Operation[]) {
  const boardRect = board.getBoundingClientRect();
  const lines: Line[] = [];
  for (const [index, operation] of operations.entries()) {
    if (operation.from === operation.to) continue;
    const half = board.querySelector<HTMLElement>(`.player-${operation.player}`);
    if (!half) continue;
    const sourceZone = half.querySelector<HTMLElement>(`.table-zone[data-zone="${operation.from}"]`);
    const targetZone = half.querySelector<HTMLElement>(`.table-zone[data-zone="${operation.to}"]`);
    if (!sourceZone || !targetZone) continue;
    const card = operation.cards[0] && sourceZone.querySelector<HTMLElement>(`[data-card="${operation.cards[0]}"]`);
    const source = (card || sourceZone).getBoundingClientRect();
    const target = targetZone.getBoundingClientRect();
    const sourceX = source.left + source.width / 2;
    const sourceY = source.top + source.height / 2;
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    const angle = Math.atan2(targetY - sourceY, targetX - sourceX);
    const offset = lines.filter((line) => line.player === operation.player &&
      line.from === operation.from && line.to === operation.to).length * 5;
    const perpendicularX = -Math.sin(angle) * offset;
    const perpendicularY = Math.cos(angle) * offset;
    const endInset = Math.min(20, Math.max(12, Math.min(target.width, target.height) / 3));
    lines.push({ key: `${operation.player}-${index}`, player: operation.player,
      from: operation.from, to: operation.to, card: !!card,
      x1: sourceX - boardRect.left + perpendicularX, y1: sourceY - boardRect.top + perpendicularY,
      x2: targetX - Math.cos(angle) * endInset - boardRect.left + perpendicularX,
      y2: targetY - Math.sin(angle) * endInset - boardRect.top + perpendicularY });
  }
  return { width: boardRect.width, height: boardRect.height, lines };
}

export function BoardOverlay({ board, operations }: {
  board: HTMLElement;
  operations: Operation[];
}) {
  const [layout, setLayout] = useState({ width: 0, height: 0, lines: [] as Line[] });
  useLayoutEffect(() => {
    const update = () => setLayout(measure(board, operations));
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (observer) {
      observer.observe(board);
      board.querySelectorAll(".table-zone").forEach((zone) => observer.observe(zone));
    }
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [board, operations]);
  return (
    <svg className="board-overlay" aria-hidden="true"
      viewBox={`0 0 ${layout.width || 1} ${layout.height || 1}`}
      preserveAspectRatio="none">
      <defs>
        <marker id="board-arrowhead" markerWidth="8" markerHeight="8"
          refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#18181b" />
        </marker>
      </defs>
      {layout.lines.map((line) => <line key={line.key} className="board-route"
        data-route-kind="zone" data-player={line.player}
        data-from={line.from} data-to={line.to} data-source={line.card ? "card" : "zone"}
        x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
        markerEnd="url(#board-arrowhead)" />)}
    </svg>
  );
}
