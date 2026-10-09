import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MachineLayout, Piece, Vec3 } from '../layout/pieces.ts';

export interface DisplayMetrics {
  scale: number;
  offset: [number, number, number];
  width: number;
  height: number;
  depth: number;
  boardWidth: number;
  boardDepth: number;
}

export type TrackFinish = 'birch' | 'edge' | 'brass' | 'steel' | 'cobalt' | 'vermilion' | 'teal' | 'scout';

export interface TrackBatch {
  finish: TrackFinish;
  geometry: BufferGeometry;
}

export function displayMetrics(machine: MachineLayout): DisplayMetrics {
  const { min, max } = machine.bounds;
  const width = Math.max(1, max.x - min.x);
  const height = Math.max(1, max.y - min.y);
  const depth = Math.max(1, max.z - min.z);
  const scale = 11 / Math.max(height, width * 0.85, depth);
  return {
    scale,
    offset: [-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2],
    width: width * scale,
    height: height * scale,
    depth: depth * scale,
    boardWidth: Math.max(6.5, width * scale + 2.4),
    boardDepth: Math.max(4.4, depth * scale + 2.8),
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
