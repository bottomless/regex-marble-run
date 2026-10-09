import type { LayoutGraph, NodeAnchor, TrackEdge } from './pieces.ts';

export function routePath(graph: LayoutGraph, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const outgoing = new Map<number, TrackEdge[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from);
    if (list) list.push(edge);
    else outgoing.set(edge.from, [edge]);
  }
  const distance = new Map<number, number>([[from, 0]]);
  const previous = new Map<number, number>();
  const pending = new Set([from]);
  while (pending.size) {
    let current = -1;
    let best = Infinity;
    for (const point of pending) {
      const d = distance.get(point)!;
      if (d < best) {
        current = point;
        best = d;
      }
    }
    pending.delete(current);
    if (current === to) break;
    for (const edge of outgoing.get(current) ?? []) {
      const candidate = best + edgeLength(graph, edge);
      if (candidate < (distance.get(edge.to) ?? Infinity)) {
        distance.set(edge.to, candidate);
        previous.set(edge.to, current);
        pending.add(edge.to);
      }
    }
  }
  if (!previous.has(to)) return null;
  const path = [to];
  let point = to;
  while (point !== from) {
    point = previous.get(point)!;
    path.unshift(point);
  }
  return path;
}

function edgeLength(graph: LayoutGraph, edge: TrackEdge): number {
  const a = graph.points[edge.from].position;
  const b = graph.points[edge.to].position;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function anchorOrder(anchors: Record<number, NodeAnchor>): number[] {
  return Object.keys(anchors)
    .map(Number)
    .sort((a, b) => a - b)
    .map((node) => anchors[node].entry);
}
