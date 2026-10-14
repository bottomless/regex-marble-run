import type { NodeId } from '../engine/ir.ts';
import { T, type Trace } from '../engine/trace.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import { routePath } from '../layout/route.ts';

export type SegmentKind =
  | 'hop'
  | 'roll'
  | 'gate'
  | 'drop'
  | 'lift'
  | 'flag'
  | 'iter'
  | 'scout'
  | 'capture'
  | 'finish';

const MOTION_KINDS: ReadonlySet<SegmentKind> = new Set<SegmentKind>(['roll', 'drop', 'lift']);

export interface Segment {
  kind: SegmentKind;
  /** Trace event index this segment animates. */
  event: number;
  /** The single segment that owns `event` for coverage; motion lead-ins are false. */
  primary: boolean;
  /** Milliseconds at the timeline's speed. t0 <= t1. */
  t0: number;
  t1: number;
  /** True when the segment was collapsed to zero duration by a high speed. */
  jump: boolean;
  node: NodeId | null;
  /** Graph point ids the marble travels along (roll/drop/lift). */
  route?: number[];
  pos?: number;
  len?: number;
  ok?: boolean;
  option?: number;
  depth?: number;
  count?: number;
  action?: 'plant' | 'pop';
  phase?: 'start' | 'end';
  result?: 'match' | 'reject';
}

export interface Timeline {
  segments: Segment[];
  duration: number;
  speed: number;
  eventCount: number;
  /** True when speed is high enough that travel collapses into jumps. */
  collapsed: boolean;
  /** True when speed is Infinity ("instant"). */
  instant: boolean;
}

export interface TimelineOptions {
  speed?: number;
}

export const INSTANT = Infinity;
export const SPEED_STEPS = [0.25, 0.5, 1, 2, 4, 16, 64] as const;
export const COLLAPSE_SPEED = 16;

const BASE_MS: Record<SegmentKind, number> = {
  hop: 320,
  roll: 240,
  gate: 240,
  drop: 240,
  lift: 320,
  flag: 180,
  iter: 120,
  scout: 260,
  capture: 0,
  finish: 520,
};

export const ROLL_PER_UNIT_MS = 95;

function routeLength(layout: MachineLayout, route: number[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = layout.graph.points[route[i - 1]]?.position;
    const b = layout.graph.points[route[i]]?.position;
    if (!a || !b) continue;
    total += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  return total;
}

function rollBase(layout: MachineLayout, route: number[] | null | undefined, extraUnits = 0): number {
  if (!route || route.length < 2) return extraUnits > 0 ? extraUnits * ROLL_PER_UNIT_MS : BASE_MS.roll;
  return (routeLength(layout, route) + extraUnits) * ROLL_PER_UNIT_MS;
}

function scale(kind: SegmentKind, base: number, speed: number, collapsed: boolean): number {
  if (!Number.isFinite(speed)) return 0;
  if (collapsed && MOTION_KINDS.has(kind)) return 0;
  return base / speed;
}

export function buildTimeline(trace: Trace, layout: MachineLayout, opts: TimelineOptions = {}): Timeline {
  const speed = opts.speed ?? 1;
  const instant = !Number.isFinite(speed);
  const collapsed = instant || speed >= COLLAPSE_SPEED;
  const { graph, anchors } = layout;
  const hopperPiece = layout.pieces.findIndex((piece) => piece.kind === 'hopper');
  const hopperPoint = layout.graph.edges.find((edge) => edge.piece === hopperPiece)?.from ?? null;
  const cupPiece = layout.pieces.findIndex((piece) => piece.kind === 'cup');
  const cupPoint = layout.graph.edges.find((edge) => edge.piece === cupPiece)?.to ?? null;
  const segments: Segment[] = [];
  let t = 0;
  let currentPoint: number | null = null;
  let attemptMaxPos = 0;
  let attemptStartBase = 0;
  let totalBase = 0;

  const emit = (kind: SegmentKind, event: number, primary: boolean, base: number, node: NodeId | null, extra: Partial<Segment> = {}): void => {
    const d = scale(kind, base, speed, collapsed);
    segments.push({ kind, event, primary, t0: t, t1: t + d, jump: d === 0, node, ...extra });
    t += d;
    totalBase += base;
  };

  const route = (from: number | null | undefined, to: number | undefined): number[] | undefined => {
    if (from === null || from === undefined || to === undefined) return undefined;
    const path = routePath(graph, from, to);
    return path && path.length >= 2 ? path : undefined;
  };

  for (let i = 0; i < trace.length; i++) {
    const a = trace.a[i];
    const b = trace.b[i];
    const c = trace.c[i];
    const d = trace.d[i];
    switch (trace.t[i] as T) {
      case T.attempt: {
        const curPos = currentPoint !== null ? layout.graph.points[currentPoint]?.position : null;
        const hopPos = hopperPoint !== null ? layout.graph.points[hopperPoint]?.position : null;
        const rearZ = Math.min(layout.bounds.min.z - 0.8, -2.0);
        const returnUnits =
          a > 0 && curPos && hopPos
            ? Math.hypot(curPos.x - hopPos.x, curPos.y - hopPos.y) + 2 * Math.abs(rearZ - curPos.z) + 3.2
            : 0;
        const hopBase = Math.max(BASE_MS.hop, returnUnits * ROLL_PER_UNIT_MS);
        currentPoint = hopperPoint;
        attemptMaxPos = a;
        emit('hop', i, true, hopBase, null, { pos: a });
        attemptStartBase = totalBase;
        break;
      }
      case T.test: {
        const node = a;
        const anchor = anchors[node];
        const freshFromHopper = d > 0 && b >= attemptMaxPos;
        const r = route(currentPoint, anchor?.entry) ?? (freshFromHopper ? route(hopperPoint, anchor?.entry) : undefined);
        const hopperRoute = freshFromHopper ? route(hopperPoint, anchor?.entry) : undefined;
        if (r) {
          const elapsedSinceAttempt = totalBase - attemptStartBase;
          const neededFromHopper = hopperRoute
            ? Math.max(0, rollBase(layout, hopperRoute, 2.4) - elapsedSinceAttempt)
            : 0;
          const base = Math.max(
            rollBase(layout, r, currentPoint === hopperPoint ? 2.2 : 0.4),
            neededFromHopper,
          );
          emit('roll', i, false, base, node, { route: r });
        }
        emit('gate', i, true, BASE_MS.gate, node, { pos: b, len: d, ok: c === 1 });
        if (c === 1 && d > 0 && b + d > attemptMaxPos) attemptMaxPos = b + d;
        currentPoint = anchor?.exit ?? currentPoint;
        break;
      }
      case T.choose: {
        const node = a;
        const anchor = anchors[node];
        const r = route(currentPoint, anchor?.entry);
        if (r) emit('roll', i, false, rollBase(layout, r, currentPoint === hopperPoint ? 2.0 : 0.2), node, { route: r });
        emit('flag', i, true, BASE_MS.flag, node, { action: 'plant', option: b, pos: c, depth: d });
        currentPoint = anchor?.entry ?? currentPoint;
        break;
      }
      case T.backtrack: {
        const node = a;
        const anchor = anchors[node];
        const drop = route(currentPoint, anchor?.returnPort);
        if (drop) emit('drop', i, false, rollBase(layout, drop, 0.3), node, { route: drop });
        const lift = route(anchor?.returnPort, anchor?.entry);
        if (lift) emit('lift', i, false, rollBase(layout, lift, 0.3), node, { route: lift });
        emit('flag', i, true, BASE_MS.flag, node, { action: 'pop', option: b, pos: c, depth: d });
        currentPoint = anchor?.entry ?? currentPoint;
        break;
      }
      case T.iter: {
        emit('iter', i, true, BASE_MS.iter, a, { count: b });
        break;
      }
      case T.look: {
        emit('scout', i, true, BASE_MS.scout, a, { phase: b === 0 ? 'start' : 'end', ok: c < 0 ? undefined : c === 1, depth: d });
        break;
      }
      case T.capture: {
        emit('capture', i, true, BASE_MS.capture, null, { pos: b, len: c });
        break;
      }
      case T.match: {
        const toCup = route(hopperPoint, cupPoint ?? undefined);
        const matchCount = Math.max(0, b - a);
        const finishMs = Math.max(BASE_MS.finish, rollBase(layout, toCup, 2.0) + matchCount * 135);
        emit('finish', i, true, finishMs, null, { result: 'match', pos: a, len: b - a });
        break;
      }
      case T.nomatch: {
        const toCup = route(hopperPoint, cupPoint ?? undefined);
        const finishMs = Math.max(BASE_MS.finish, rollBase(layout, toCup, 2.0));
        emit('finish', i, true, finishMs, null, { result: 'reject' });
        break;
      }
    }
  }

  return { segments, duration: t, speed, eventCount: trace.length, collapsed, instant };
}

export interface SegmentAt {
  /** Index into `timeline.segments`. */
  index: number;
  segment: Segment;
  /** 0..1 progress through the segment; 1 for zero-duration (jump) segments. */
  fraction: number;
}

/** Segment active at time `t` (ms). Clamps to the first/last segment. */
export function segmentAt(timeline: Timeline, time: number): SegmentAt | null {
  const { segments } = timeline;
  if (segments.length === 0) return null;
  if (time <= segments[0].t0) return { index: 0, segment: segments[0], fraction: 0 };
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].t0 <= time) lo = mid;
    else hi = mid - 1;
  }
  const seg = segments[lo];
  const span = seg.t1 - seg.t0;
  const fraction = span <= 0 ? 1 : Math.min(1, Math.max(0, (time - seg.t0) / span));
  return { index: lo, segment: seg, fraction };
}
