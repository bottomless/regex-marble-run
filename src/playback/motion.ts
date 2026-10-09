import type { MachineLayout, NodeAnchor, PieceKind, Vec3 } from '../layout/pieces.ts';
import { segmentAt, type Segment, type Timeline } from './timeline.ts';

export interface MarblePose {
  position: Vec3;
  /** Unit travel direction for orienting the marble / follow camera; null when stationary. */
  direction: Vec3 | null;
  /** True for travel segments (roll/drop/lift) so the renderer can spin or trail the marble. */
  moving: boolean;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function unit(a: Vec3, b: Vec3): Vec3 | null {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len = Math.hypot(d.x, d.y, d.z);
  if (len === 0) return null;
  return { x: d.x / len, y: d.y / len, z: d.z / len };
}

export function polylineLength(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/** Position and tangent at an arc-length `fraction` (0..1) along a polyline. */
export function pointAlongPolyline(
  points: Vec3[],
  fraction: number,
): { position: Vec3; direction: Vec3 | null } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { position: { ...points[0] }, direction: null };
  const t = clamp(fraction, 0, 1);
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1], points[i]);
    lengths.push(d);
    total += d;
  }
  if (total <= 0) return { position: { ...points[0] }, direction: null };
  let remaining = t * total;
  for (let i = 0; i < lengths.length; i++) {
    const segLen = lengths[i];
    if (remaining <= segLen || i === lengths.length - 1) {
      const a = points[i];
      const b = points[i + 1];
      const f = segLen <= 0 ? 0 : clamp(remaining / segLen, 0, 1);
      return { position: lerp(a, b, f), direction: unit(a, b) };
    }
    remaining -= segLen;
  }
  return { position: { ...points[points.length - 1] }, direction: null };
}

function routePoints(layout: MachineLayout, route: number[]): Vec3[] {
  const points: Vec3[] = [];
  for (const id of route) {
    const point = layout.graph.points[id];
    if (point) points.push(point.position);
  }
  return points;
}

function anchorOf(layout: MachineLayout, node: number | null): NodeAnchor | null {
  return node === null ? null : (layout.anchors[node] ?? null);
}

function pointPos(layout: MachineLayout, id: number | undefined): Vec3 | null {
  if (id === undefined) return null;
  const point = layout.graph.points[id];
  return point ? { ...point.position } : null;
}

function piecePos(layout: MachineLayout, kind: PieceKind): Vec3 | null {
  const piece = layout.pieces.find((p) => p.kind === kind);
  return piece ? { ...piece.position } : null;
}

function gatePosition(layout: MachineLayout, anchor: NodeAnchor | null): Vec3 | null {
  if (!anchor) return null;
  if (anchor.gate) return { ...anchor.gate };
  const entry = pointPos(layout, anchor.entry);
  const exit = pointPos(layout, anchor.exit);
  if (entry && exit) return lerp(entry, exit, 0.5);
  return entry ?? exit;
}

function gateDirection(layout: MachineLayout, anchor: NodeAnchor | null): Vec3 | null {
  if (!anchor) return null;
  const entry = pointPos(layout, anchor.entry);
  const exit = pointPos(layout, anchor.exit);
  if (entry && exit) return unit(entry, exit);
  return null;
}

/**
 * Hero-marble pose for a single segment at `fraction` (0..1) through it.
 * Returns null for segments that carry no positional information (e.g. `capture`);
 * callers should hold the previous pose, or use `poseAtIndex` which does so.
 */
export function poseForSegment(layout: MachineLayout, segment: Segment, fraction: number): MarblePose | null {
  switch (segment.kind) {
    case 'roll':
    case 'drop':
    case 'lift': {
      if (segment.route) {
        const at = pointAlongPolyline(routePoints(layout, segment.route), fraction);
        if (at) return { position: at.position, direction: at.direction, moving: true };
      }
      const anchor = anchorOf(layout, segment.node);
      const pos = gatePosition(layout, anchor) ?? pointPos(layout, anchor?.entry);
      return pos ? { position: pos, direction: null, moving: false } : null;
    }
    case 'gate': {
      const anchor = anchorOf(layout, segment.node);
      const pos = gatePosition(layout, anchor);
      return pos ? { position: pos, direction: gateDirection(layout, anchor), moving: false } : null;
    }
    case 'flag':
    case 'iter': {
      const anchor = anchorOf(layout, segment.node);
      const pos = anchor?.diverter
        ? { ...anchor.diverter }
        : (anchor?.gate ? { ...anchor.gate } : pointPos(layout, anchor?.entry));
      return pos ? { position: pos, direction: null, moving: false } : null;
    }
    case 'scout': {
      const anchor = anchorOf(layout, segment.node);
      const pos = anchor?.gate ? { ...anchor.gate } : pointPos(layout, anchor?.entry);
      return pos ? { position: pos, direction: null, moving: false } : null;
    }
    case 'hop': {
      const pos = piecePos(layout, 'hopper');
      return pos ? { position: pos, direction: null, moving: false } : null;
    }
    case 'finish': {
      const pos = piecePos(layout, segment.result === 'reject' ? 'rejectTray' : 'cup');
      return pos ? { position: pos, direction: null, moving: false } : null;
    }
    case 'capture':
      return null;
  }
}

/**
 * Robust pose at a segment index: walks backward past position-less segments
 * (e.g. `capture`) to the last resolvable pose, holding it at that segment's end.
 */
export function poseAtIndex(
  layout: MachineLayout,
  timeline: Timeline,
  segmentIndex: number,
  fraction: number,
): MarblePose | null {
  const start = clamp(segmentIndex, 0, timeline.segments.length - 1);
  for (let i = start; i >= 0; i--) {
    const f = i === start ? fraction : 1;
    const pose = poseForSegment(layout, timeline.segments[i], f);
    if (pose) return pose;
  }
  return null;
}

/** Convenience: pose at a timeline time (ms), holding through position-less segments. */
export function poseAtTime(layout: MachineLayout, timeline: Timeline, time: number): MarblePose | null {
  const at = segmentAt(timeline, time);
  if (!at) return null;
  return poseAtIndex(layout, timeline, at.index, at.fraction);
}
