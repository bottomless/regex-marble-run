import type { Program, Span } from '../engine/ir.ts';
import type { MachineLayout, Vec3 } from '../layout/pieces.ts';
import { compilePike, PikeCompileError, PikeEvent, type PikeResult, type PikeTrace } from '../engine/pikevm.ts';

/**
 * Pure model of a linear-time (Pike VM) run for the side-by-side view: the per-position trace is
 * folded into ticks, one per input position the engine visited. Every live thread at a tick is a
 * parallel marble standing on its gate; threads born at a split share their parent's position, merged
 * threads fold into the thread that reached the same state first, and dead threads leave the board.
 * The read head only ever moves forward.
 */

export type LinearEligibility =
  | { ok: true }
  | { ok: false; reason: 'feature' | 'complexity'; span: Span; message: string };

export interface LinearThread {
  id: number;
  node: number;
  pc: number;
  start: number;
  /** Thread this one was split from at birth; -1 for a fresh attempt. */
  parent: number;
  /** True when the thread sits on the accept instruction (a match ends here). */
  accepting: boolean;
}

export interface LinearMerge {
  id: number;
  into: number;
}

export interface LinearTick {
  index: number;
  /** UTF-16 input position the engine stands at; also the read head. */
  pos: number;
  /** Threads alive after the epsilon closure at this position, in priority order. */
  threads: LinearThread[];
  births: LinearThread[];
  merges: LinearMerge[];
  /** Thread ids that died at this position: failed assertions, failed character tests, or lower priority than a match. */
  deaths: number[];
  /** Fresh attempt started at this position (the first thread in `births` with parent -1). */
  attempt: boolean;
  /** Some thread accepts here, so the engine has a match candidate ending at `pos`. */
  accepting: boolean;
  /** Character tests performed when leaving this position (one per live non-accepting thread). */
  tests: number;
  cumulativeTests: number;
}

export interface LinearRun {
  ticks: LinearTick[];
  matched: boolean;
  index: number;
  end: number;
  /** Engine instruction steps, the figure compared against the backtracking side. */
  steps: number;
  attempts: number;
  maxThreads: number;
  truncated: boolean;
  gaveUp: boolean;
}

/** Whether the pattern can be shown on the linear-time side at all. */
export function linearEligibility(program: Program): LinearEligibility {
  try {
    compilePike(program);
    return { ok: true };
  } catch (error) {
    if (error instanceof PikeCompileError) {
      return { ok: false, reason: error.reason, span: error.span, message: error.message };
    }
    throw error;
  }
}

interface Row {
  t: PikeEvent;
  pos: number;
  thread: number;
  other: number;
  node: number;
  pc: number;
  start: number;
}

function row(trace: PikeTrace, i: number): Row {
  return {
    t: trace.t[i] as PikeEvent,
    pos: trace.positions[i],
    thread: trace.threads[i],
    other: trace.others[i],
    node: trace.nodes[i],
    pc: trace.pcs[i],
    start: trace.starts[i],
  };
}

export function buildLinearRun(program: Program, trace: PikeTrace, result: PikeResult): LinearRun {
  const { code } = compilePike(program);
  const ticks: LinearTick[] = [];
  let current: LinearTick | null = null;
  let cumulativeTests = 0;

  const open = (pos: number): LinearTick => {
    if (current && current.pos === pos) return current;
    if (current) close(current);
    current = {
      index: ticks.length,
      pos,
      threads: [],
      births: [],
      merges: [],
      deaths: [],
      attempt: false,
      accepting: false,
      tests: 0,
      cumulativeTests,
    };
    return current;
  };
  const close = (tick: LinearTick) => {
    tick.tests = tick.threads.filter((thread) => !thread.accepting).length;
    cumulativeTests += tick.tests;
    tick.cumulativeTests = cumulativeTests;
    ticks.push(tick);
  };

  for (let i = 0; i < trace.length; i++) {
    const r = row(trace, i);
    const tick = open(r.pos);
    const accepting = code[r.pc]?.op === 'match';
    switch (r.t) {
      case PikeEvent.birth: {
        const thread: LinearThread = {
          id: r.thread,
          node: r.node,
          pc: r.pc,
          start: r.start,
          parent: r.other,
          accepting,
        };
        tick.births.push(thread);
        if (r.other < 0) tick.attempt = true;
        break;
      }
      case PikeEvent.live:
        tick.threads.push({ id: r.thread, node: r.node, pc: r.pc, start: r.start, parent: -1, accepting });
        if (accepting) tick.accepting = true;
        break;
      case PikeEvent.merge:
        tick.merges.push({ id: r.thread, into: r.other });
        break;
      case PikeEvent.death:
        tick.deaths.push(r.thread);
        break;
    }
  }
  if (current) close(current);

  // Live rows carry no parent; recover it from the birth that introduced the thread.
  const parents = new Map<number, number>();
  for (const tick of ticks) for (const birth of tick.births) parents.set(birth.id, birth.parent);
  for (const tick of ticks) for (const thread of tick.threads) thread.parent = parents.get(thread.id) ?? -1;

  return {
    ticks,
    matched: result.matched,
    index: result.index,
    end: result.end,
    steps: result.steps,
    attempts: result.attempts,
    maxThreads: result.maxThreads,
    truncated: trace.truncated,
    gaveUp: result.gaveUp,
  };
}

/** The tick whose position is the greatest one not after `pos`; null before the first tick. */
export function tickAtPosition(run: LinearRun, pos: number): LinearTick | null {
  let found: LinearTick | null = null;
  for (const tick of run.ticks) {
    if (tick.pos > pos) break;
    found = tick;
  }
  return found;
}

/** Threads alive at the tick, after merges and deaths recorded at the same position. */
export function liveThreadIds(tick: LinearTick): number[] {
  return tick.threads.map((thread) => thread.id);
}

export interface LinearSync {
  /** Tick the right side shows; null when the run has no ticks. */
  tick: LinearTick | null;
  /** True once the right side has processed its last position. */
  finished: boolean;
}

/**
 * Picks the right-hand tick for the left-hand playhead. Both sides are synchronised by input position:
 * the linear side stands at the highest position the backtracking head has read so far, so it never
 * moves backward when the left side does. Once the left side has finished (or floods), the right side
 * shows its final tick.
 */
export function syncLinear(run: LinearRun, waterline: number, leftFinished: boolean): LinearSync {
  if (run.ticks.length === 0) return { tick: null, finished: true };
  const last = run.ticks[run.ticks.length - 1];
  if (leftFinished) return { tick: last, finished: true };
  const tick = tickAtPosition(run, waterline) ?? run.ticks[0];
  return { tick, finished: tick === last };
}

export interface ParallelMarble {
  id: number;
  parent: number;
  position: Vec3;
  accepting: boolean;
}

/**
 * Where each live thread stands on the machine: on its gate when it waits at a character test, in the
 * cup when it has accepted, else on the node's entry point. Threads sharing a spot fan out on X so
 * they read as several marbles, not one.
 */
export function parallelMarbles(machine: MachineLayout, tick: LinearTick | null, spread = 0.26): ParallelMarble[] {
  if (!tick) return [];
  const cup = machine.pieces.find((piece) => piece.kind === 'cup');
  const groups = new Map<string, ParallelMarble[]>();
  const out: ParallelMarble[] = [];
  for (const thread of tick.threads) {
    let base: Vec3 | null = null;
    if (thread.accepting && cup) base = { x: cup.position.x, y: cup.position.y + 0.3, z: cup.position.z };
    else {
      const anchor = machine.anchors[thread.node];
      if (anchor?.gate) base = anchor.gate;
      else if (anchor) base = machine.graph.points[anchor.entry]?.position ?? null;
    }
    if (!base) continue;
    const marble = { id: thread.id, parent: thread.parent, position: { x: base.x, y: base.y + 0.3, z: base.z }, accepting: thread.accepting };
    const key = `${base.x},${base.y},${base.z}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(marble);
    groups.set(key, bucket);
    out.push(marble);
  }
  for (const bucket of groups.values()) {
    if (bucket.length === 1) continue;
    bucket.forEach((marble, i) => {
      marble.position = { ...marble.position, x: marble.position.x + (i - (bucket.length - 1) / 2) * spread };
    });
  }
  return out;
}
