import type { MachineLayout, PieceKind, Vec3 } from '../layout/pieces.ts';
import { routePath } from '../layout/route.ts';
import { pointAlongPolyline } from '../playback/motion.ts';

const ENTER = 0.07;
const EXIT = 0.93;

const RANK: Partial<Record<PieceKind, number>> = {
  gate: 100,
  sensor: 90,
  mirror: 85,
  opaque: 80,
  track: 70,
  module: 60,
  scout: 40,
  hopper: 30,
  cup: 30,
  rejectTray: 30,
  funnel: 20,
  bypassChute: 8,
  returnRail: 1,
  loopLift: 0,
  backLift: 0,
};

export interface LetterTrip {
  index: number;
  fraction: number;
  done: boolean;
}

export function letterLands(
  matched: boolean,
  start: number,
  end: number,
  index: number,
  length: number,
): 'cup' | 'rejectTray' {
  if (matched && start >= 0 && index < end && index + length > start) return 'cup';
  return 'rejectTray';
}

export function letterTripAt(time: number, duration: number, count: number): LetterTrip {
  if (count <= 0) return { index: 0, fraction: 0, done: true };
  if (!(duration > 0)) return { index: 0, fraction: 0, done: false };
  const t = Math.min(1, Math.max(0, time / duration));
  if (t >= 1) return { index: count, fraction: 1, done: true };
  const scaled = t * count;
  const index = Math.min(count - 1, Math.floor(scaled));
  return { index, fraction: scaled - index, done: false };
}

export function holdOffset(slot: number): Vec3 {
  const col = slot % 3;
  const row = Math.floor(slot / 3);
  return { x: (col - 1) * 0.34, y: 0.58 + row * 0.32, z: 0.08 };
}

export function restOffset(order: number, destination: 'cup' | 'rejectTray' = 'cup'): Vec3 {
  const slot = Math.min(Math.max(0, order), 17);
  if (destination === 'rejectTray') {
    const col = slot % 5;
    const row = Math.floor(slot / 5);
    return { x: (col - 2) * 0.32, y: 0.16 + row * 0.28, z: (row % 2) * 0.08 - 0.04 };
  }
  const col = slot % 3;
  const row = Math.floor(slot / 3);
  return { x: (col - 1) * 0.3, y: 0.26 + row * 0.3, z: (slot % 2) * 0.06 - 0.03 };
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function placeOnTrip(points: Vec3[], fraction: number, hold: Vec3, rest: Vec3, lift: number): Vec3 {
  const t = Math.min(1, Math.max(0, fraction));
  const raised = (point: Vec3): Vec3 => ({ x: point.x, y: point.y + lift, z: point.z });
  const start = points.length > 0 ? raised(points[0]) : hold;
  const end = points.length > 0 ? raised(points[points.length - 1]) : rest;
  if (t <= ENTER) return lerp(hold, start, t / ENTER);
  if (t >= EXIT) return lerp(end, rest, (t - EXIT) / (1 - EXIT));
  const at = pointAlongPolyline(points, (t - ENTER) / (EXIT - ENTER));
  return at ? raised(at.position) : start;
}

function near(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.z - b.z) < 1e-4;
}

function pointId(layout: MachineLayout, position: Vec3): number | null {
  const id = layout.graph.points.findIndex((point) => near(point.position, position));
  return id < 0 ? null : id;
}

function endpoint(layout: MachineLayout, kind: string, end: 'start' | 'end'): number | null {
  const piece = layout.pieces.find((item) => item.kind === kind);
  if (!piece) return null;
  const points = piece.points;
  const position =
    points && points.length > 0 ? points[end === 'start' ? 0 : points.length - 1] : piece.position;
  return pointId(layout, position);
}

function scenic(layout: MachineLayout, from: number, to: number): number[] | null {
  const count = layout.graph.points.length;
  const outgoing: { to: number; piece: number; length: number }[][] = Array.from({ length: count }, () => []);
  for (const edge of layout.graph.edges) {
    if (edge.from < 0 || edge.from >= count || edge.to < 0 || edge.to >= count) continue;
    outgoing[edge.from].push({ to: edge.to, piece: edge.piece, length: edge.length ?? 1 });
  }
  const reaches = new Uint8Array(count);
  const reverse: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < count; i++) for (const edge of outgoing[i]) reverse[edge.to].push(i);
  const stack = [to];
  reaches[to] = 1;
  while (stack.length) {
    const current = stack.pop()!;
    for (const prev of reverse[current]) {
      if (reaches[prev]) continue;
      reaches[prev] = 1;
      stack.push(prev);
    }
  }
  if (!reaches[from]) return null;
  const path = [from];
  const used = new Set<string>();
  const visits = new Uint16Array(count);
  let current = from;
  visits[current] = 1;
  for (let guard = 0; guard < count * 3 && current !== to; guard++) {
    const options = outgoing[current].filter(
      (edge) => !used.has(`${current}:${edge.to}`) && reaches[edge.to],
    );
    if (options.length === 0) break;
    options.sort((a, b) => {
      const score = (edge: (typeof options)[number]) => {
        const dy = layout.graph.points[edge.to].position.y - layout.graph.points[current].position.y;
        return (
          (RANK[layout.pieces[edge.piece]?.kind] ?? 10) * 1000 - edge.length - visits[edge.to] * 40 - dy * 25
        );
      };
      return score(b) - score(a);
    });
    const kind = layout.pieces[options[0].piece]?.kind;
    if (kind === 'loopLift' || kind === 'backLift' || kind === 'returnRail') break;
    used.add(`${current}:${options[0].to}`);
    current = options[0].to;
    visits[current] += 1;
    path.push(current);
    if (visits[current] > 2) break;
  }
  if (current !== to) {
    const rest = routePath(layout.graph, current, to);
    if (!rest) return null;
    path.push(...rest.slice(1));
  }
  return path[0] === from && path[path.length - 1] === to ? path : null;
}

export function inletRoute(
  layout: MachineLayout,
  destination: 'cup' | 'rejectTray' = 'cup',
): number[] | null {
  const from = endpoint(layout, 'hopper', 'start');
  const to = endpoint(layout, destination, 'end') ?? endpoint(layout, 'cup', 'end');
  if (from === null || to === null) return null;
  return scenic(layout, from, to) ?? routePath(layout.graph, from, to);
}

export function riddenPieces(layout: MachineLayout): Set<number> | null {
  const ids = new Set<number>();
  for (const destination of ['cup', 'rejectTray'] as const) {
    const route = inletRoute(layout, destination);
    if (!route || route.length < 2) continue;
    for (let i = 1; i < route.length; i++) {
      const edge = layout.graph.edges.find((item) => item.from === route[i - 1] && item.to === route[i]);
      if (edge) ids.add(edge.piece);
    }
  }
  return ids.size > 0 ? ids : null;
}

export function spinePoints(layout: MachineLayout, ids: number[]): Vec3[] {
  if (ids.length === 0) return [];
  const points: Vec3[] = [];
  const push = (point: Vec3) => {
    const last = points[points.length - 1];
    if (!last || !near(last, point)) points.push({ x: point.x, y: point.y, z: point.z });
  };
  const first = layout.graph.points[ids[0]];
  if (!first) return [];
  push(first.position);
  for (let i = 1; i < ids.length; i++) {
    const edge = layout.graph.edges.find((item) => item.from === ids[i - 1] && item.to === ids[i]);
    const piece = edge === undefined ? undefined : layout.pieces[edge.piece];
    const next = layout.graph.points[ids[i]];
    if (piece?.points && piece.points.length > 0 && next) {
      const forward = near(piece.points[0], layout.graph.points[ids[i - 1]].position);
      const seq = forward ? piece.points : [...piece.points].reverse();
      for (const point of seq) push(point);
    } else if (next) push(next.position);
  }
  return points;
}
