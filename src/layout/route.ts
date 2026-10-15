import type { LayoutGraph, MachineLayout, NodeAnchor, TrackEdge } from './pieces.ts';

interface SourceRoutes {
  previous: number[];
  distances: number[];
  paths: Map<number, number[] | null>;
}

interface Routes {
  points: LayoutGraph['points'];
  edges: LayoutGraph['edges'];
  pointCount: number;
  edgeCount: number;
  outgoing: { to: number; length: number }[][];
  sources: Map<number, SourceRoutes>;
}

const cache = new WeakMap<LayoutGraph, Routes>();

function validPoint(graph: LayoutGraph, index: number): boolean {
  return (
    Number.isInteger(index) && index >= 0 && index < graph.points.length && graph.points[index] !== undefined
  );
}

function routesFor(graph: LayoutGraph): Routes {
  const cached = cache.get(graph);
  if (
    cached &&
    cached.points === graph.points &&
    cached.edges === graph.edges &&
    cached.pointCount === graph.points.length &&
    cached.edgeCount === graph.edges.length
  )
    return cached;
  const outgoing: Routes['outgoing'] = Array.from({ length: graph.points.length }, () => []);
  for (const edge of graph.edges) {
    if (!validPoint(graph, edge.from) || !validPoint(graph, edge.to)) continue;
    const length = edgeLength(graph, edge);
    if (Number.isFinite(length) && length >= 0) outgoing[edge.from].push({ to: edge.to, length });
  }
  const routes: Routes = {
    points: graph.points,
    edges: graph.edges,
    pointCount: graph.points.length,
    edgeCount: graph.edges.length,
    outgoing,
    sources: new Map(),
  };
  cache.set(graph, routes);
  return routes;
}

function shortestPaths(routes: Routes, from: number): SourceRoutes {
  const cached = routes.sources.get(from);
  if (cached) return cached;
  const distances = Array<number>(routes.pointCount).fill(Infinity);
  const previous = Array<number>(routes.pointCount).fill(-1);
  const heap: { point: number; distance: number }[] = [];
  const push = (point: number, distance: number): void => {
    let index = heap.length;
    heap.push({ point, distance });
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent].distance <= distance) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = { point, distance };
  };
  const pop = (): { point: number; distance: number } => {
    const first = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].distance < heap[child].distance) child++;
        if (heap[child].distance >= last.distance) break;
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = last;
    }
    return first;
  };
  distances[from] = 0;
  push(from, 0);
  while (heap.length) {
    const current = pop();
    if (current.distance !== distances[current.point]) continue;
    for (const edge of routes.outgoing[current.point]) {
      const distance = current.distance + edge.length;
      if (distance < distances[edge.to]) {
        distances[edge.to] = distance;
        previous[edge.to] = current.point;
        push(edge.to, distance);
      }
    }
  }
  const source = { previous, distances, paths: new Map<number, number[] | null>() };
  routes.sources.set(from, source);
  return source;
}

export function routePath(graph: LayoutGraph, from: number, to: number): number[] | null {
  if (!validPoint(graph, from) || !validPoint(graph, to)) return null;
  if (from === to) return [from];
  const source = shortestPaths(routesFor(graph), from);
  if (source.paths.has(to)) return source.paths.get(to)?.slice() ?? null;
  if (!Number.isFinite(source.distances[to])) {
    source.paths.set(to, null);
    return null;
  }
  const path = [to];
  let point = to;
  while (point !== from) {
    point = source.previous[point];
    path.push(point);
  }
  path.reverse();
  source.paths.set(to, path);
  return path.slice();
}

export function rejectionPath(layout: MachineLayout, from: number): number[] | null {
  const { graph, pieces } = layout;
  const tray = graph.edges.find((edge) => pieces[edge.piece]?.kind === 'rejectTray');
  if (!tray) return null;
  if (from === tray.to) return [from];
  const outlet = graph.edges.find(
    (edge) => edge.from === from && pieces[edge.piece]?.kind === 'rejectChute',
  );
  if (!outlet) return null;
  const tail = routePath(graph, outlet.to, tray.to);
  return tail ? [from, ...tail] : null;
}

function edgeLength(graph: LayoutGraph, edge: TrackEdge): number {
  if (edge.length !== undefined) return edge.length;
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
