import type { NodeId, Program } from '../engine/ir.ts';
import { T, type Trace } from '../engine/trace.ts';

export interface CaptureSpan {
  start: number;
  end: number;
}

export interface FlagEntry {
  node: NodeId;
  option: number;
  pos: number;
}

export type PlaybackPhase = 'idle' | 'running' | 'matched' | 'nomatch';

export interface MachineState {
  index: number;
  phase: PlaybackPhase;
  attempts: number;
  attemptStart: number;
  head: number;
  flags: FlagEntry[];
  counters: Map<NodeId, number>;
  captures: (CaptureSpan | null)[];
  activeNode: NodeId | null;
  match: CaptureSpan | null;
}

interface FlagDraft extends FlagEntry {
  caps: (CaptureSpan | null)[];
  counters: Map<NodeId, number>;
}

interface LookDraft {
  caps: (CaptureSpan | null)[];
  counters: Map<NodeId, number>;
}

interface Draft {
  index: number;
  phase: PlaybackPhase;
  attempts: number;
  attemptStart: number;
  head: number;
  flags: FlagDraft[];
  counters: Map<NodeId, number>;
  captures: (CaptureSpan | null)[];
  activeNode: NodeId | null;
  match: CaptureSpan | null;
  looks: LookDraft[];
}

export const DEFAULT_KEYFRAME_EVERY = 512;

export function createDraft(groupCount: number): Draft {
  return {
    index: 0,
    phase: 'idle',
    attempts: 0,
    attemptStart: -1,
    head: 0,
    flags: [],
    counters: new Map(),
    captures: new Array<CaptureSpan | null>(groupCount + 1).fill(null),
    activeNode: null,
    match: null,
    looks: [],
  };
}

function cloneCaps(caps: (CaptureSpan | null)[]): (CaptureSpan | null)[] {
  return caps.map((c) => (c === null ? null : { ...c }));
}

function cloneDraft(d: Draft): Draft {
  return {
    ...d,
    flags: d.flags.map((f) => ({ ...f, caps: cloneCaps(f.caps), counters: new Map(f.counters) })),
    counters: new Map(d.counters),
    captures: cloneCaps(d.captures),
    match: d.match === null ? null : { ...d.match },
    looks: d.looks.map((l) => ({ caps: cloneCaps(l.caps), counters: new Map(l.counters) })),
  };
}

export function snapshot(d: Draft): MachineState {
  return {
    index: d.index,
    phase: d.phase,
    attempts: d.attempts,
    attemptStart: d.attemptStart,
    head: d.head,
    flags: d.flags.map((f) => ({ node: f.node, option: f.option, pos: f.pos })),
    counters: new Map(d.counters),
    captures: cloneCaps(d.captures),
    activeNode: d.activeNode,
    match: d.match === null ? null : { ...d.match },
  };
}

function applyTraceEvent(d: Draft, tr: Trace, i: number, isNegatedLook: (node: NodeId) => boolean): void {
  d.index++;
  const a = tr.a[i];
  const b = tr.b[i];
  const c = tr.c[i];
  const dd = tr.d[i];
  switch (tr.t[i] as T) {
    case T.attempt: {
      d.phase = 'running';
      d.attempts++;
      d.attemptStart = a;
      d.head = a;
      d.flags.length = 0;
      d.counters.clear();
      d.captures.fill(null);
      d.activeNode = null;
      d.match = null;
      d.looks.length = 0;
      break;
    }
    case T.test: {
      d.activeNode = a;
      d.head = c === 1 ? b + dd : b;
      break;
    }
    case T.choose: {
      d.flags.push({ node: a, option: b, pos: c, caps: cloneCaps(d.captures), counters: new Map(d.counters) });
      d.activeNode = a;
      break;
    }
    case T.backtrack: {
      const f = d.flags.pop();
      if (f) {
        d.captures = cloneCaps(f.caps);
        d.counters = new Map(f.counters);
      }
      d.head = c;
      d.activeNode = a;
      break;
    }
    case T.iter: {
      d.counters.set(a, b);
      d.activeNode = a;
      break;
    }
    case T.look: {
      if (b === 0) {
        d.looks.push({ caps: cloneCaps(d.captures), counters: new Map(d.counters) });
      } else {
        const lk = d.looks.pop();
        const ok = c === 1;
        if (lk && (isNegatedLook(a) || !ok)) {
          d.captures = cloneCaps(lk.caps);
          d.counters = new Map(lk.counters);
        }
        if (d.flags.length > dd) d.flags.length = dd;
      }
      d.activeNode = a;
      break;
    }
    case T.capture: {
      d.captures[a] = b < 0 ? null : { start: b, end: c };
      break;
    }
    case T.match: {
      d.phase = 'matched';
      d.match = { start: a, end: b };
      d.captures[0] = { start: a, end: b };
      d.head = b;
      break;
    }
    case T.nomatch: {
      d.phase = 'nomatch';
      d.flags.length = 0;
      d.looks.length = 0;
      break;
    }
  }
}

export class TraceCursor {
  private readonly negate: (node: NodeId) => boolean;
  private readonly keyframes = new Map<number, Draft>();
  private builtTo = 0;

  constructor(
    prog: Program,
    private readonly trace: Trace,
    private readonly keyframeEvery: number = DEFAULT_KEYFRAME_EVERY,
  ) {
    this.negate = (node) => {
      const n = prog.nodes[node];
      return n !== undefined && n.kind === 'look' && n.negate;
    };
    this.keyframes.set(0, createDraft(prog.groupCount));
  }

  get length(): number {
    return this.trace.length;
  }

  stateAt(index: number): MachineState {
    if (index < 0 || index > this.trace.length) {
      throw new RangeError(`stateAt(${index}) outside 0..${this.trace.length}`);
    }
    this.buildKeyframes(index);
    let base = 0;
    for (const k of this.keyframes.keys()) {
      if (k <= index && k > base) base = k;
    }
    const draft = cloneDraft(this.keyframes.get(base)!);
    for (let i = base; i < index; i++) applyTraceEvent(draft, this.trace, i, this.negate);
    return snapshot(draft);
  }

  private buildKeyframes(target: number): void {
    if (this.keyframeEvery === Infinity) return;
    while (this.builtTo + this.keyframeEvery <= target) {
      const next = this.builtTo + this.keyframeEvery;
      const draft = cloneDraft(this.keyframes.get(this.builtTo)!);
      for (let i = this.builtTo; i < next; i++) applyTraceEvent(draft, this.trace, i, this.negate);
      this.keyframes.set(next, draft);
      this.builtTo = next;
    }
  }
}

export function replayFinal(prog: Program, trace: Trace): MachineState {
  return new TraceCursor(prog, trace, Infinity).stateAt(trace.length);
}
