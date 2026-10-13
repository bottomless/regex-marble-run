import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
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

export const TANK_SPAN = 2.6;
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
  const scaledHeight = height * scale;
  const baseBoardWidth = Math.max(6.5, width * scale + 2.4);
  const boardWidth = options.flood ? baseBoardWidth + TANK_SPAN : baseBoardWidth;
  return {
    scale,
    offset: [-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2],
    width: width * scale,
    height: scaledHeight,
    depth: depth * scale,
    boardWidth,
    boardDepth: Math.max(4.4, depth * scale + 2.8),
    tank: options.flood
      ? {
          x: boardWidth / 2 - TANK_SPAN / 2,
          z: 0,
          width: 2,
          depth: 2,
          height: Math.min(5.5, Math.max(3, scaledHeight * 0.55)),
          radius: 0.07,
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

export function buildTrackBatches(machine: MachineLayout): TrackBatch[] {
  const buckets = new Map<TrackFinish, BufferGeometry[]>();
  function add(finish: TrackFinish, points: Vec3[], radius: number, zOffset = 0, yOffset = 0) {
    if (points.length < 2) return;
    const shifted = points.map((p) => ({ x: p.x, y: p.y + yOffset, z: p.z + zOffset }));
    const curve = trackCurve(shifted);
    const segments = Math.min(72, Math.max(8, Math.ceil(curve.getLength() * 5)));
    const geometry = new TubeGeometry(curve, segments, radius, 8, false);
    const bucket = buckets.get(finish) ?? [];
    bucket.push(geometry);
    buckets.set(finish, bucket);
  }
  for (const piece of machine.pieces) {
    if (!piece.points) continue;
    const rear = piece.kind === 'returnRail' || piece.kind === 'backLift';
    const lift = piece.kind === 'loopLift';
    if (rear || lift) {
      add(piece.role === 'look' ? 'scout' : 'steel', piece.points, rear ? 0.065 : 0.1);
      if (lift) add(roleFinish(piece), piece.points, 0.035, 0.13);
    } else {
      add('edge', piece.points, 0.215, -0.025);
      add('birch', piece.points, 0.19, 0.03);
      add(piece.role === 'look' ? 'scout' : 'brass', piece.points, 0.032, 0.21);
      add(piece.kind === 'bypassChute' ? roleFinish(piece) : 'edge', piece.points, 0.032, -0.21);
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
