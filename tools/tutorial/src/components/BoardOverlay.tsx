import { useLayoutEffect, useState } from "react";
import type { Operation, Player, Zone } from "../types";
import { insideEdge, routeBetween, type Point } from "./boardRoutes";

type Route = { key: string; player: Player; from: Zone; to: Zone; d: string; start: Point };

function measure(board: HTMLElement, operations: Operation[]) {
  const boardRect = board.getBoundingClientRect();
  const routes: Route[] = [];
  const used = new Set<string>();
  for (const [index, operation] of operations.entries()) {
    if (operation.from === operation.to) continue;
    const half = board.querySelector<HTMLElement>(`.player-${operation.player}`);
    if (!half) continue;
    const zones = [...half.querySelectorAll<HTMLElement>(".table-zone")];
    const rects = new Map(zones.map((zone) => [
      zone.dataset.zone,
      zone.getBoundingClientRect(),
    ]));
    const from = rects.get(operation.from);
    const to = rects.get(operation.to);
    if (!from || !to) continue;
    const boxes = [...rects.values()].map((rect) => ({
      left: rect.left - boardRect.left,
      top: rect.top - boardRect.top,
      right: rect.right - boardRect.left,
      bottom: rect.bottom - boardRect.top,
    }));
    const fromBox = boxes[[...rects.keys()].indexOf(operation.from)];
    const toBox = boxes[[...rects.keys()].indexOf(operation.to)];
    const halfRect = half.getBoundingClientRect();
    const bounds = {
      left: Math.max(2, halfRect.left - boardRect.left + 2),
      right: Math.min(boardRect.width - 2, halfRect.right - boardRect.left - 2),
      top: Math.min(...boxes.map((box) => box.top)) - 6,
      bottom: Math.min(boardRect.height - 2, halfRect.bottom - boardRect.top - 2),
    };
    const points = routeBetween(fromBox, toBox, boxes, bounds, used);
    if (!points?.length) continue;
    const connected = [insideEdge(fromBox, points[0]), ...points,
      insideEdge(toBox, points[points.length - 1])];
    const d = connected.map((point, i) => `${i ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
    routes.push({ key: `${operation.player}-${index}`, player: operation.player,
      from: operation.from, to: operation.to, d, start: connected[0] });
  }
  return { width: boardRect.width, height: boardRect.height, routes };
}

export function BoardOverlay({ board, operations }: {
  board: HTMLElement;
  operations: Operation[];
}) {
  const [layout, setLayout] = useState({ width: 0, height: 0, routes: [] as Route[] });
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
      {layout.routes.map((route) => (
        <g key={route.key}>
          <path d={route.d} className="board-route"
            data-route-kind="zone" data-player={route.player}
            data-from={route.from} data-to={route.to}
            markerEnd="url(#board-arrowhead)" />
          <circle cx={route.start.x} cy={route.start.y} r="2.5" fill="#18181b" />
        </g>
      ))}
    </svg>
  );
}
