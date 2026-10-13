import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, TubeGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MachineLayout, Piece, Vec3 } from '../layout/pieces.ts';

export interface TankPlacement {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  radius: number;
}

export interface DisplayMetrics {
  scale: number;
  offset: [number, number, number];
  width: number;
  height: number;
  depth: number;
  boardWidth: number;
  boardDepth: number;
  tank: TankPlacement | null;
}

export const TANK_SPAN = 2.1;
export const SPLIT_GAP = 1.4;

export interface SplitPlacement {
  /** X of the left (backtracking) board centre. */
  leftX: number;
  /** X of the right (linear-time) board centre. */
  rightX: number;
  /** Metrics describing the pair as one object, for camera framing and the ground shadow. */
  framing: DisplayMetrics;
}

/** Two boards side by side on X: the left one may carry a flood tank, the right one never does. */
export function splitPlacement(left: DisplayMetrics, right: DisplayMetrics): SplitPlacement {
  const total = left.boardWidth + SPLIT_GAP + right.boardWidth;
  const leftX = -total / 2 + left.boardWidth / 2;
  const rightX = total / 2 - right.boardWidth / 2;
  return {
    leftX,
    rightX,
    framing: {
      ...left,
      width: total - 2.4,
      boardWidth: total,
      height: Math.max(left.height, right.height),
      depth: Math.max(left.depth, right.depth),
      boardDepth: Math.max(left.boardDepth, right.boardDepth),
      tank: null,
    },
  };
}

export type TrackFinish = 'birch' | 'edge' | 'brass' | 'steel' | 'cobalt' | 'vermilion' | 'teal' | 'scout';

export interface TrackBatch {
  finish: TrackFinish;
  geometry: BufferGeometry;
}

export function displayMetrics(machine: MachineLayout, options: { flood?: boolean } = {}): DisplayMetrics {
  const { min, max } = machine.bounds;
  const width = Math.max(1, max.x - min.x);
  const height = Math.max(1, max.y - min.y);
  const depth = Math.max(1, max.z - min.z);
  const scale = 11 / Math.max(height, width * 0.85, depth);
  const scaledHeight = Math.min(11, height * scale);
  const baseBoardWidth = Math.max(6.5, width * scale + 2);
  const boardWidth = options.flood ? baseBoardWidth + TANK_SPAN : baseBoardWidth;
  return {
    scale,
    offset: [-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2],
    width: width * scale,
    height: scaledHeight,
    depth: depth * scale,
    boardWidth,
    boardDepth: Math.max(4, depth * scale + 2.6),
    tank: options.flood
      ? {
          x: boardWidth / 2 - TANK_SPAN / 2,
          z: 0,
          width: 1.6,
          depth: 1.6,
          height: Math.min(4.6, Math.max(2.8, scaledHeight * 0.5)),
          radius: 0.065,
        }
      : null,
  };
}

export function roleFinish(piece: Piece): TrackFinish {
  if (piece.role === 'alternation') return 'cobalt';
  if (piece.role === 'repeat') return 'vermilion';
  if (piece.role === 'lazyRepeat') return 'teal';
  if (piece.role === 'look') return 'scout';
  return 'brass';
}

export function trackCurve(points: Vec3[]): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    points.map((p) => new Vector3(p.x, p.y, p.z)),
    false,
    'centripetal',
  );
}

/** Half-open channel profile the marble rolls in: a flat bed with two low lips, in curve-local units. */
export const CHANNEL = {
  halfWidth: 0.34,
  lipWidth: 0.06,
  lipHeight: 0.16,
  bedDepth: 0.1,
} as const;

interface SweepFrame {
  p: Vector3;
  right: Vector3;
  up: Vector3;
}

/**
 * Gravity-aligned frames along a curve: `up` always leans toward world +Y so an open channel keeps
 * its mouth facing up, unlike Frenet frames (which twist with the curve). Vertical stretches reuse
 * the previous `right` so the profile never snaps.
 */
export function sweepFrames(curve: CatmullRomCurve3, segments: number): SweepFrame[] {
  const frames: SweepFrame[] = [];
  const worldUp = new Vector3(0, 1, 0);
  let previous = new Vector3(1, 0, 0);
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    let right = new Vector3().crossVectors(t, worldUp);
    if (right.lengthSq() < 1e-4) {
      right = previous.clone().addScaledVector(t, -previous.dot(t));
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    }
    right.normalize();
    const up = new Vector3().crossVectors(right, t).normalize();
    frames.push({ p, right, up });
    previous = right;
  }
  return frames;
}

/** Sweeps an axis-aligned rectangle (in the frame's right/up plane) along the frames, capped at both ends. */
export function sweepRect(frames: SweepFrame[], x0: number, x1: number, y0: number, y1: number): BufferGeometry {
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const positions: number[] = [];
  const at = (frame: SweepFrame, [x, y]: [number, number]) => {
    positions.push(
      frame.p.x + frame.right.x * x + frame.up.x * y,
      frame.p.y + frame.right.y * x + frame.up.y * y,
      frame.p.z + frame.right.z * x + frame.up.z * y,
    );
  };
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    for (let k = 0; k < 4; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % 4];
      at(f0, a);
      at(f1, b);
      at(f0, b);
      at(f0, a);
      at(f1, a);
      at(f1, b);
    }
  }
  const first = frames[0];
  const last = frames[frames.length - 1];
  at(first, corners[0]);
  at(first, corners[1]);
  at(first, corners[2]);
  at(first, corners[0]);
  at(first, corners[2]);
  at(first, corners[3]);
  at(last, corners[0]);
  at(last, corners[2]);
  at(last, corners[1]);
  at(last, corners[0]);
  at(last, corners[3]);
  at(last, corners[2]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildTrackBatches(machine: MachineLayout): TrackBatch[] {
  const buckets = new Map<TrackFinish, BufferGeometry[]>();
  function put(finish: TrackFinish, geometry: BufferGeometry) {
    const bucket = buckets.get(finish) ?? [];
    bucket.push(geometry);
    buckets.set(finish, bucket);
  }
  function segmentsFor(curve: CatmullRomCurve3): number {
    return Math.min(72, Math.max(8, Math.ceil(curve.getLength() * 5)));
  }
  function add(finish: TrackFinish, points: Vec3[], radius: number, zOffset = 0, yOffset = 0) {
    if (points.length < 2) return;
    const shifted = points.map((p) => ({ x: p.x, y: p.y + yOffset, z: p.z + zOffset }));
    const curve = trackCurve(shifted);
    const tube = new TubeGeometry(curve, segmentsFor(curve), radius, 8, false);
    put(finish, tube.toNonIndexed());
    tube.dispose();
  }
  function channel(points: Vec3[], lipFinish: TrackFinish) {
    if (points.length < 2) return;
    const curve = trackCurve(points);
    const frames = sweepFrames(curve, segmentsFor(curve));
    const { halfWidth, lipWidth, lipHeight, bedDepth } = CHANNEL;
    put('birch', sweepRect(frames, -halfWidth, halfWidth, -bedDepth, 0));
    put(lipFinish, sweepRect(frames, -halfWidth, -halfWidth + lipWidth, 0, lipHeight));
    put(lipFinish, sweepRect(frames, halfWidth - lipWidth, halfWidth, 0, lipHeight));
  }
  for (const piece of machine.pieces) {
    if (!piece.points) continue;
    const rear = piece.kind === 'returnRail' || piece.kind === 'backLift';
    const lift = piece.kind === 'loopLift';
    if (rear || lift) {
      add(piece.role === 'look' ? 'scout' : lift ? roleFinish(piece) : 'steel', piece.points, rear ? 0.065 : 0.11);
      if (lift) add('steel', piece.points, 0.03, 0.14);
    } else {
      channel(
        piece.points,
        piece.role === 'look' ? 'scout' : piece.kind === 'bypassChute' ? roleFinish(piece) : 'edge',
      );
    }
  }
  return [...buckets].map(([finish, parts]) => {
    const geometry = mergeGeometries(parts, false)!;
    for (const part of parts) part.dispose();
    return { finish, geometry };
  });
}

export function visibleTiles(
  input: string,
  unicode: boolean,
  limit = 24,
): { glyph: string; index: number }[] {
  const tiles: { glyph: string; index: number }[] = [];
  for (let index = 0; index < input.length && tiles.length < limit;) {
    const glyph = unicode ? String.fromCodePoint(input.codePointAt(index)!) : input[index];
    tiles.push({ glyph, index });
    index += glyph.length;
  }
  return tiles;
}
