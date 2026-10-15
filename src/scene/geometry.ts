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

/** Height the verdict sign adds above the backboard's top rail; the camera frames it too. */
export const SIGN_RISE = 0.95;

export function displayMetrics(machine: MachineLayout, _options: { flood?: boolean } = {}): DisplayMetrics {
  const { min, max } = machine.bounds;
  const width = Math.max(1, max.x - min.x);
  const height = Math.max(1, max.y - min.y);
  const depth = Math.max(1, max.z - min.z);
  const scale = 11 / Math.max(height, width * 0.72, depth);
  const scaledHeight = Math.min(11, height * scale);
  const boardWidth = Math.max(8.2, width * scale + 2.8);
  return {
    scale,
    offset: [-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2],
    width: width * scale,
    height: scaledHeight,
    depth: depth * scale,
    boardWidth,
    boardDepth: Math.max(4, depth * scale + 2.6),
    tank: null,
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

export const MARBLE_LIFT = 0.16;

export const REJECTION_CHANNEL = {
  halfWidth: 0.24,
  lipWidth: 0.04,
  lipHeight: 0.12,
  bedDepth: 0.06,
} as const;

interface SweepFrame {
  p: Vector3;
  right: Vector3;
  up: Vector3;
}

/**
 * Gravity-aligned frames along a curve: `up` always leans toward world +Y so an open channel keeps
 * its mouth facing up, unlike Frenet frames (which twist with the curve). Vertical stretches reuse
 * the previous `right` so the profile never snaps. With `face`, steep stretches instead turn their
 * mouth toward `face` and blend smoothly back to gravity as the curve levels out, so a vertical
 * shaft becomes a wall-backed channel open toward the viewer.
 */
export function sweepFrames(
  curve: CatmullRomCurve3,
  segments: number,
  options: { from?: number; until?: number; face?: Vec3 } = {},
): SweepFrame[] {
  const frames: SweepFrame[] = [];
  const worldUp = new Vector3(0, 1, 0);
  const from = options.from ?? 0;
  const until = options.until ?? 1;
  const face = options.face ? new Vector3(options.face.x, options.face.y, options.face.z) : null;
  let previous = new Vector3(1, 0, 0);
  for (let i = 0; i <= segments; i++) {
    const u = from + ((until - from) * i) / segments;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    if (face) {
      const gravity = worldUp.clone().addScaledVector(t, -t.y);
      const facing = face.clone().addScaledVector(t, -t.dot(face));
      const steep = Math.min(1, Math.max(0, (Math.abs(t.y) - 0.8) / 0.18));
      const w = steep * steep * (3 - 2 * steep);
      const up = new Vector3();
      if (gravity.lengthSq() > 1e-8) up.addScaledVector(gravity.normalize(), 1 - w);
      if (facing.lengthSq() > 1e-8) up.addScaledVector(facing.normalize(), w);
      if (up.lengthSq() > 1e-8) {
        up.normalize();
        const right = new Vector3().crossVectors(t, up).normalize();
        frames.push({ p, right, up });
        previous = right;
        continue;
      }
    }
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
export function sweepRect(
  frames: SweepFrame[],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): BufferGeometry {
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

const LOOP_KINDS: ReadonlySet<Piece['kind']> = new Set(['returnRail', 'backLift', 'loopLift']);
const LIFT_KINDS: ReadonlySet<Piece['kind']> = new Set(['backLift', 'loopLift']);
const SHAFT_FACE: Vec3 = { x: 0, y: 0, z: 1 };

function samePoint(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
}

export function buildTrackBatches(machine: MachineLayout): TrackBatch[] {
  const buckets = new Map<TrackFinish, BufferGeometry[]>();
  function put(finish: TrackFinish, geometry: BufferGeometry) {
    const bucket = buckets.get(finish) ?? [];
    bucket.push(geometry);
    buckets.set(finish, bucket);
  }
  function segmentsFor(length: number): number {
    return Math.min(180, Math.max(12, Math.ceil(length * 14)));
  }
  const feet = machine.pieces
    .filter((piece) => LIFT_KINDS.has(piece.kind) && piece.points && piece.points.length >= 2)
    .map((piece) => piece.points![0]);
  function channel(
    points: Vec3[],
    lipFinish: TrackFinish,
    options: { rejection?: boolean; loop?: boolean; trimEnd?: number } = {},
  ) {
    if (points.length < 2) return;
    const curve = trackCurve(points);
    const length = curve.getLength();
    const until = options.trimEnd ? Math.max(0.4, 1 - options.trimEnd / Math.max(length, 1e-6)) : 1;
    const frames = sweepFrames(curve, segmentsFor(length * until), {
      until,
      face: options.loop ? SHAFT_FACE : undefined,
    });
    if (options.rejection || options.loop) {
      for (const frame of frames) {
        frame.p.addScaledVector(frame.up, MARBLE_LIFT * (frame.up.y - 1));
      }
    }
    const { halfWidth, lipWidth, lipHeight, bedDepth } = options.rejection ? REJECTION_CHANNEL : CHANNEL;
    put(options.rejection ? 'edge' : 'birch', sweepRect(frames, -halfWidth, halfWidth, -bedDepth, 0));
    put(lipFinish, sweepRect(frames, -halfWidth, -halfWidth + lipWidth, 0, lipHeight));
    put(lipFinish, sweepRect(frames, halfWidth - lipWidth, halfWidth, 0, lipHeight));
  }
  for (const piece of machine.pieces) {
    if (!piece.points) continue;
    if (LOOP_KINDS.has(piece.kind)) {
      const finish = piece.role === 'look' ? 'scout' : roleFinish(piece);
      if (LIFT_KINDS.has(piece.kind)) {
        const foot = piece.points[0];
        const well = { x: foot.x, y: foot.y - SPRING_WELL - SPRING_BASE_DEPTH, z: foot.z };
        channel([well, ...piece.points], finish, { loop: true });
      } else {
        const end = piece.points[piece.points.length - 1];
        const feeds = feet.some((foot) => samePoint(foot, end));
        channel(piece.points, finish, { loop: true, trimEnd: feeds ? SPRING_FEED_GAP : 0 });
      }
    } else if (piece.kind === 'rejectChute' || piece.kind === 'rejectTray') {
      channel(piece.points, 'edge', { rejection: true });
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

/**
 * A spring launcher at the foot of a lift shaft. The coil stands on the floor of a short well
 * below the foot; at rest its plate sits flush with the foot, where the return feed drops the
 * marble. The plate then rides up under the marble for `stroke` and sinks back over `release`.
 */
export interface SpringLauncher {
  piece: number;
  /** Track point at the bottom of the shaft, where the marble lands on the plate. */
  foot: Vec3;
  /** Centre of the well floor the coil stands on. */
  base: Vec3;
  /** Coil length at rest. */
  rest: number;
  stroke: number;
  release: number;
}

export const SPRING_WELL = 0.4;
export const SPRING_BASE_DEPTH = 0.06;
export const SPRING_FEED_GAP = 0;
export const SPRING_COIL_RADIUS = 0.13;
export const SPRING_TUBE_RADIUS = 0.022;
export const SPRING_PLATE_RADIUS = 0.17;
export const SPRING_PLATE_DEPTH = 0.04;
export const SPRING_SQUASH = 0.09;
const SPRING_REACH = 0.32;
const SHAFT_TOLERANCE = 0.08;

export function springLaunchers(machine: MachineLayout): SpringLauncher[] {
  const launchers: SpringLauncher[] = [];
  machine.pieces.forEach((piece, index) => {
    if (!LIFT_KINDS.has(piece.kind) || !piece.points || piece.points.length < 2) return;
    const foot = piece.points[0];
    const curve = trackCurve(piece.points);
    const samples = curve.getSpacedPoints(Math.max(8, Math.ceil(curve.getLength() * 10)));
    let straight = 0;
    for (const point of samples) {
      if (Math.hypot(point.x - foot.x, point.z - foot.z) > SHAFT_TOLERANCE / 2) break;
      straight = Math.max(straight, point.y - foot.y);
    }
    const stroke = Math.min(0.7, straight * 0.35);
    launchers.push({
      piece: index,
      foot: { ...foot },
      base: { x: foot.x, y: foot.y - SPRING_WELL, z: foot.z + 0.02 },
      rest: SPRING_WELL - SPRING_PLATE_DEPTH,
      stroke,
      release: Math.max(0.05, Math.min(1.2, straight - stroke)),
    });
  });
  return launchers;
}

/**
 * Plate travel relative to rest for marbles at the given bed positions: negative while a marble
 * rolls onto the plate and loads the spring, positive while the plate drives a marble up the shaft.
 * Pure in the marble positions, so scrubbing and stepping show the same plunger as playback.
 */
export function plungerTravel(launcher: SpringLauncher, beds: readonly Vec3[]): number {
  const { foot, stroke, release } = launcher;
  let lift = 0;
  let squash = 0;
  for (const bed of beds) {
    const reach = Math.hypot(bed.x - foot.x, bed.z - foot.z);
    const height = bed.y - foot.y;
    if (reach < SHAFT_TOLERANCE && height > 1e-4 && height <= stroke + release) {
      lift = Math.max(lift, height <= stroke ? height : stroke * (1 - (height - stroke) / release));
    } else if (reach < SPRING_REACH && Math.abs(height) < 0.3) {
      squash = Math.max(squash, SPRING_SQUASH * (1 - reach / SPRING_REACH));
    }
  }
  return lift > 0 ? lift : -squash;
}

export function springCoilGeometry(length: number): BufferGeometry {
  const coils = Math.max(4, Math.round(length / 0.09));
  const steps = coils * 14;
  const points: Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * coils * Math.PI * 2;
    points.push(new Vector3(Math.cos(angle) * SPRING_COIL_RADIUS, t * length, Math.sin(angle) * SPRING_COIL_RADIUS));
  }
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  return new TubeGeometry(curve, steps * 2, SPRING_TUBE_RADIUS, 8, false);
}

export function letterGlyph(glyph: string): string {
  return glyph === ' ' ? '·' : glyph === '\n' ? '↵' : glyph === '\t' ? '⇥' : glyph;
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
