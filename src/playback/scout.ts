import type { NodeId } from '../engine/ir.ts';
import type { MachineLayout, Vec3 } from '../layout/pieces.ts';
import type { MachineState, ScoutFrame } from './state.ts';

export interface ScoutStop {
  event: number;
  position: Vec3;
}

export interface ScoutPose {
  position: Vec3;
  direction: Vec3 | null;
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

function gatePosition(layout: MachineLayout, node: NodeId): Vec3 | null {
  const anchor = layout.anchors[node];
  if (!anchor) return null;
  if (anchor.gate) return { ...anchor.gate };
  const entry = layout.graph.points[anchor.entry]?.position;
  const exit = layout.graph.points[anchor.exit]?.position;
  if (entry && exit) return lerp(entry, exit, 0.5);
  return entry ? { ...entry } : exit ? { ...exit } : null;
}

/** The scout's home: start of its side track, falling back to the assertion gate. */
export function scoutHome(layout: MachineLayout, node: NodeId): Vec3 | null {
  const piece = layout.pieces.find((p) => p.kind === 'scout' && p.node === node);
  const start = piece?.points?.[0];
  if (start) return { ...start };
  return gatePosition(layout, node);
}

/** The innermost open lookahead, or the one whose return trip is still animating. */
export function scoutWindow(state: MachineState | null): ScoutFrame | null {
  if (!state) return null;
  const closing = state.scoutClosing;
  if (closing && closing.end !== null && state.index === closing.end + 1) return closing;
  return state.scouts.at(-1) ?? null;
}

/** Sorted unique tile indices the scout has read so far (character-consuming tests only). */
export function scoutTiles(frame: ScoutFrame | null): number[] {
  if (!frame) return [];
  const tiles = new Set<number>();
  for (const read of frame.reads) {
    for (let i = read.pos; i < read.pos + read.len; i++) tiles.add(i);
  }
  return [...tiles].sort((a, b) => a - b);
}

/** Event-indexed stops: home, one per inner test, then the return trip during the closing event. */
export function scoutStops(layout: MachineLayout, frame: ScoutFrame): ScoutStop[] {
  const home = scoutHome(layout, frame.node);
  if (!home) return [];
  const stops: ScoutStop[] = [{ event: frame.start, position: home }];
  for (const read of frame.reads) {
    const position = gatePosition(layout, read.node);
    if (position) stops.push({ event: read.event, position });
  }
  if (frame.end !== null) {
    const last = { ...stops.at(-1)!.position };
    stops.push({ event: frame.end, position: last });
    stops.push({ event: frame.end + 1, position: home });
  }
  return stops;
}

/**
 * Scout pose at continuous event coordinate `u` (eventIndex + fraction). The scout leaves home when
 * the look starts, reaches each inner gate one event after its test, waits at the last gate while
 * the assertion is open, and rides home during the closing event.
 */
export function scoutPose(layout: MachineLayout, frame: ScoutFrame, u: number): ScoutPose | null {
  const stops = scoutStops(layout, frame);
  if (stops.length === 0) return null;
  if (u <= stops[0].event) return { position: { ...stops[0].position }, direction: null };
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    if (u <= to.event) {
      const span = to.event - from.event;
      const t = span <= 0 ? 1 : (u - from.event) / span;
      return { position: lerp(from.position, to.position, t), direction: unit(from.position, to.position) };
    }
  }
  const last = stops.at(-1)!;
  return { position: { ...last.position }, direction: null };
}
