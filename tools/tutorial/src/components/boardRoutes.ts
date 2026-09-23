export type Point = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };

const pointKey = ({ x, y }: Point) => `${x},${y}`;
const edgeKey = (a: Point, b: Point) => [pointKey(a), pointKey(b)].sort().join("|");
const centerX = (box: Box) => (box.left + box.right) / 2;
const centerY = (box: Box) => (box.top + box.bottom) / 2;
const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
const anchors = (box: Box): Point[] => [
  { x: centerX(box), y: box.top - 1.5 },
  { x: box.right + 1.5, y: centerY(box) },
  { x: centerX(box), y: box.bottom + 1.5 },
  { x: box.left - 1.5, y: centerY(box) },
];

export function insideEdge(box: Box, anchor: Point): Point {
  if (anchor.y < box.top) return { x: anchor.x, y: box.top + 7 };
  if (anchor.y > box.bottom) return { x: anchor.x, y: box.bottom - 7 };
  if (anchor.x < box.left) return { x: box.left + 7, y: anchor.y };
  return { x: box.right - 7, y: anchor.y };
}

// ゾーンの外側を通る直交経路を、実測した矩形から共通計算する。
export function routeBetween(from: Box, to: Box, boxes: Box[], bounds: Box, used: Set<string>) {
  const allAnchors = boxes.flatMap(anchors);
  const xs = unique(allAnchors.map((point) => point.x));
  const ys = unique(allAnchors.map((point) => point.y));
  const points = xs.flatMap((x) => ys.map((y) => ({ x, y })));
  const valid = (point: Point) =>
    point.x >= bounds.left && point.x <= bounds.right &&
    point.y >= bounds.top && point.y <= bounds.bottom &&
    boxes.every((box) => point.x <= box.left - 0.2 || point.x >= box.right + 0.2 ||
      point.y <= box.top - 0.2 || point.y >= box.bottom + 0.2);
  const clear = (a: Point, b: Point) => boxes.every((box) => {
    if (a.y === b.y) {
      return a.y <= box.top - 0.2 || a.y >= box.bottom + 0.2 ||
        Math.max(a.x, b.x) <= box.left - 0.2 || Math.min(a.x, b.x) >= box.right + 0.2;
    }
    return a.x <= box.left - 0.2 || a.x >= box.right + 0.2 ||
      Math.max(a.y, b.y) <= box.top - 0.2 || Math.min(a.y, b.y) >= box.bottom + 0.2;
  });
  const index = new Map(points.map((point, i) => [pointKey(point), i]));
  const sources = anchors(from).map((point) => index.get(pointKey(point)))
    .filter((i): i is number => i !== undefined && valid(points[i]));
  const targets = new Set(anchors(to).map((point) => index.get(pointKey(point)))
    .filter((i): i is number => i !== undefined && valid(points[i])));
  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const queue: { id: string; node: number; direction: "h" | "v" | "start"; cost: number }[] = [];
  for (const node of sources) {
    const id = `${node}:start`;
    distances.set(id, 0);
    queue.push({ id, node, direction: "start", cost: 0 });
  }
  let finish: string | undefined;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if (current.cost !== distances.get(current.id)) continue;
    if (targets.has(current.node)) { finish = current.id; break; }
    const point = points[current.node];
    const xi = xs.indexOf(point.x);
    const yi = ys.indexOf(point.y);
    const neighbors = [
      xs[xi - 1] === undefined ? null : { x: xs[xi - 1], y: point.y },
      xs[xi + 1] === undefined ? null : { x: xs[xi + 1], y: point.y },
      ys[yi - 1] === undefined ? null : { x: point.x, y: ys[yi - 1] },
      ys[yi + 1] === undefined ? null : { x: point.x, y: ys[yi + 1] },
    ];
    for (const next of neighbors) {
      if (!next || !valid(next) || !clear(point, next)) continue;
      const node = index.get(pointKey(next))!;
      const direction = point.x === next.x ? "v" : "h";
      const bend = current.direction !== "start" && current.direction !== direction ? 9 : 0;
      const cost = current.cost + Math.abs(next.x - point.x) + Math.abs(next.y - point.y)
        + bend + (used.has(edgeKey(point, next)) ? 30 : 0);
      const id = `${node}:${direction}`;
      if (cost < (distances.get(id) ?? Infinity)) {
        distances.set(id, cost);
        previous.set(id, current.id);
        queue.push({ id, node, direction, cost });
      }
    }
  }
  if (!finish) return null;
  const result: Point[] = [];
  for (let id: string | undefined = finish; id; id = previous.get(id)) {
    result.push(points[Number(id.split(":")[0])]);
  }
  result.reverse();
  for (let i = 1; i < result.length; i++) used.add(edgeKey(result[i - 1], result[i]));
  return result.filter((point, i) =>
    i === 0 || i === result.length - 1 ||
    (result[i - 1].x !== point.x || result[i + 1].x !== point.x) &&
    (result[i - 1].y !== point.y || result[i + 1].y !== point.y));
}
