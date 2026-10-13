import type { MatchResult } from '../engine/backtrack.ts';
import { CHECKPOINT_EVERY, T, type Trace } from '../engine/trace.ts';
import type { MachineLayout, Piece, Vec3 } from '../layout/pieces.ts';
import type { FlagEntry } from './state.ts';

export const FLOOD_STEP_THRESHOLD = 3000;
export const FLOOD_MARBLE_CAP = 10_000;
export const TANK_MIN_EXPONENT = 2;
export const TANK_MAX_EXPONENT = 8;
export const COLUMN_VISIBLE_CAP = 24;

export interface FloodSample {
  step: number;
  depth: number;
  pos: number;
  backtracks: number;
}

export interface FloodGraduation {
  value: number;
  level: number;
}

export interface FloodModel {
  steps: number;
  backtracks: number;
  attempts: number;
  maxDepth: number;
  truncated: boolean;
  gaveUp: boolean;
  perMarble: number;
  marbles: number;
  level: number;
  graduations: FloodGraduation[];
  samples: FloodSample[];
}

export interface FloodFrame {
  step: number;
  depth: number;
  /** Highest sampled depth reached so far: the high-water mark the flag columns show. */
  peakDepth: number;
  pos: number;
  backtracks: number;
  marbles: number;
  level: number;
}

export interface FloodColumn {
  node: number;
  column: string;
  position: Vec3;
  role: Piece['role'];
  depth: number;
  visible: number;
}

export interface TankShape {
  width: number;
  depth: number;
  height: number;
  radius: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Flood presentation replaces normal playback for truncated, abandoned or long (> 3,000 step) runs. */
export function shouldFlood(result: Pick<MatchResult, 'steps' | 'gaveUp'>, trace: Pick<Trace, 'truncated'>): boolean {
  return trace.truncated || result.gaveUp || result.steps > FLOOD_STEP_THRESHOLD;
}

/** Smallest power of ten so that the sampled marble count stays within the instance cap. */
export function marblesPerSample(backtracks: number, cap = FLOOD_MARBLE_CAP): number {
  let per = 1;
  while (Math.ceil(backtracks / per) > cap) per *= 10;
  return per;
}

/** Log-scaled tank fill: 10^(min-1) sits at the bottom, 10^max at the brim. */
export function tankLevel(value: number): number {
  const exponent = Math.log10(Math.max(1, value));
  return clamp01((exponent - (TANK_MIN_EXPONENT - 1)) / (TANK_MAX_EXPONENT - TANK_MIN_EXPONENT + 1));
}

export function tankGraduations(): FloodGraduation[] {
  const marks: FloodGraduation[] = [];
  for (let exponent = TANK_MIN_EXPONENT; exponent <= TANK_MAX_EXPONENT; exponent++) {
    const value = 10 ** exponent;
    marks.push({ value, level: tankLevel(value) });
  }
  return marks;
}

function recordedSamples(trace: Trace): FloodSample[] {
  const samples: FloodSample[] = [];
  let steps = 0;
  let depth = 0;
  let pos = 0;
  let backtracks = 0;
  let nextSample = CHECKPOINT_EVERY;
  for (let i = 0; i < trace.length; i++) {
    switch (trace.t[i] as T) {
      case T.attempt:
        depth = 0;
        pos = trace.a[i];
        break;
      case T.test:
        steps++;
        pos = trace.c[i] === 1 ? trace.b[i] + trace.d[i] : trace.b[i];
        break;
      case T.choose:
        depth = trace.d[i];
        break;
      case T.backtrack:
        steps++;
        backtracks++;
        depth = trace.d[i];
        pos = trace.c[i];
        break;
      default:
        break;
    }
    if (steps >= nextSample) {
      samples.push({ step: steps, depth, pos, backtracks });
      nextSample += CHECKPOINT_EVERY;
    }
  }
  return samples;
}

/**
 * Builds the flood model from the engine result and its trace. Recorded events are sampled every
 * `CHECKPOINT_EVERY` steps; count-only checkpoints continue from where recording stopped. Backtracks
 * during the count-only phase are not recorded per checkpoint, so they are interpolated linearly
 * between the last recorded total and the final engine total.
 */
export function floodModel(result: MatchResult, trace: Trace): FloodModel | null {
  if (!shouldFlood(result, trace)) return null;
  const samples: FloodSample[] = [{ step: 0, depth: 0, pos: 0, backtracks: 0 }, ...recordedSamples(trace)];
  const recordedEnd = samples[samples.length - 1];
  const remainingSteps = Math.max(1, result.steps - recordedEnd.step);
  const remainingBacktracks = Math.max(0, result.backtracks - recordedEnd.backtracks);
  const rate = remainingBacktracks / remainingSteps;
  for (let i = 0; i < trace.checkpointCount; i++) {
    const step = trace.checkpoints[i * 3];
    if (step <= recordedEnd.step) continue;
    samples.push({
      step,
      depth: trace.checkpoints[i * 3 + 1],
      pos: trace.checkpoints[i * 3 + 2],
      backtracks: Math.round(recordedEnd.backtracks + (step - recordedEnd.step) * rate),
    });
  }
  const last = samples[samples.length - 1];
  if (last.step < result.steps) {
    samples.push({ step: result.steps, depth: last.depth, pos: last.pos, backtracks: result.backtracks });
  } else {
    last.backtracks = result.backtracks;
  }
  const perMarble = marblesPerSample(result.backtracks);
  return {
    steps: result.steps,
    backtracks: result.backtracks,
    attempts: result.attempts,
    maxDepth: result.maxDepth,
    truncated: trace.truncated,
    gaveUp: result.gaveUp,
    perMarble,
    marbles: Math.min(FLOOD_MARBLE_CAP, Math.ceil(result.backtracks / perMarble)),
    level: tankLevel(result.backtracks),
    graduations: tankGraduations(),
    samples,
  };
}

/** Flood state at `progress` (0..1 of the whole run), interpolating between samples by step. */
export function floodAt(model: FloodModel, progress: number): FloodFrame {
  const step = clamp01(progress) * model.steps;
  const samples = model.samples;
  let hi = 1;
  while (hi < samples.length - 1 && samples[hi].step < step) hi++;
  const a = samples[Math.max(0, hi - 1)];
  const b = samples[Math.min(samples.length - 1, hi)];
  const span = b.step - a.step;
  const t = span <= 0 ? 1 : clamp01((step - a.step) / span);
  const backtracks = Math.round(a.backtracks + (b.backtracks - a.backtracks) * t);
  const depth = Math.round(a.depth + (b.depth - a.depth) * t);
  let peakDepth = depth;
  for (let i = 0; i < hi; i++) if (samples[i].depth > peakDepth) peakDepth = samples[i].depth;
  return {
    step: Math.round(step),
    depth,
    peakDepth,
    pos: t < 1 ? a.pos : b.pos,
    backtracks,
    marbles: Math.min(model.marbles, Math.ceil(backtracks / model.perMarble)),
    level: tankLevel(backtracks),
  };
}

/**
 * Distributes a sampled stack depth across the diverters that held flags when recording stopped,
 * proportionally to their recorded share, so columns grow where the choice points actually pile up.
 * Without recorded flags every diverter with a flag slot shares the depth equally.
 */
export function flagColumns(layout: MachineLayout, recorded: readonly FlagEntry[], depth: number): FloodColumn[] {
  const roles = new Map<number, Piece['role']>();
  for (const piece of layout.pieces) {
    if (piece.kind === 'diverter' && piece.node !== null) roles.set(piece.node, piece.role);
  }
  const slots = Object.entries(layout.anchors)
    .filter(([, anchor]) => anchor.flagSlot)
    .map(([node]) => Number(node));
  if (slots.length === 0 || depth <= 0) return [];
  const counts = new Map<number, number>();
  for (const flag of recorded) {
    if (layout.anchors[flag.node]?.flagSlot) counts.set(flag.node, (counts.get(flag.node) ?? 0) + 1);
  }
  const nodes = counts.size > 0 ? [...counts.keys()] : slots;
  const total = counts.size > 0 ? [...counts.values()].reduce((sum, n) => sum + n, 0) : nodes.length;
  let assigned = 0;
  return nodes
    .map((node, index) => {
      const share = counts.size > 0 ? counts.get(node)! / total : 1 / nodes.length;
      const exact = index === nodes.length - 1 ? depth - assigned : Math.round(depth * share);
      assigned += exact;
      const slot = layout.anchors[node].flagSlot!;
      return {
        node,
        column: `node:${node}`,
        position: { ...slot },
        role: roles.get(node),
        depth: exact,
        visible: Math.min(COLUMN_VISIBLE_CAP, exact),
      };
    })
    .filter((column) => column.depth > 0);
}

/**
 * Deterministic pile of `count` marbles filling a box tank up to `level` of its height. Marbles are
 * laid in staggered layers with a small hash jitter, so density reads as count and height as the
 * log-scaled graduation. Returns interleaved x, y, z triples in tank-local space (origin at the base).
 */
export function tankMarblePositions(count: number, level: number, tank: TankShape): Float32Array {
  const out = new Float32Array(count * 3);
  if (count <= 0) return out;
  const r = tank.radius;
  const innerW = Math.max(r * 2, tank.width - r * 2);
  const innerD = Math.max(r * 2, tank.depth - r * 2);
  const fillHeight = Math.max(r * 2, level * tank.height);
  const layerPitch = r * 1.74;
  const layers = Math.max(1, Math.floor((fillHeight - r) / layerPitch) + 1);
  const perLayer = Math.ceil(count / layers);
  const cols = Math.max(1, Math.ceil(Math.sqrt(perLayer * (innerW / innerD))));
  const rows = Math.max(1, Math.ceil(perLayer / cols));
  const dx = innerW / cols;
  const dz = innerD / rows;
  let i = 0;
  for (let layer = 0; layer < layers && i < count; layer++) {
    const stagger = layer % 2 === 0 ? 0 : 0.5;
    for (let row = 0; row < rows && i < count; row++) {
      for (let col = 0; col < cols && i < count; col++) {
        const seed = Math.sin((i + 1) * 12.9898 + layer * 78.233) * 43758.5453;
        const jitter = seed - Math.floor(seed) - 0.5;
        const x = -innerW / 2 + (col + 0.5 + stagger) * dx + jitter * dx * 0.3;
        const z = -innerD / 2 + (row + 0.5) * dz + jitter * dz * 0.3;
        out[i * 3] = Math.max(-innerW / 2, Math.min(innerW / 2, x));
        out[i * 3 + 1] = r + layer * layerPitch;
        out[i * 3 + 2] = Math.max(-innerD / 2, Math.min(innerD / 2, z));
        i++;
      }
    }
  }
  return out;
}
