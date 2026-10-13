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

export type LoopChoice = 'again' | 'exit';

export type GateStatus = 'pass' | 'reject';

export interface ScoutRead {
  node: NodeId;
  event: number;
  pos: number;
  len: number;
  ok: boolean;
}

export interface ScoutFrame {
  node: NodeId;
  start: number;
  end: number | null;
  reads: ScoutRead[];
}

export interface MachineState {
  index: number;
  phase: PlaybackPhase;
  attempts: number;
  attemptStart: number;
  head: number;
  flags: FlagEntry[];
  counters: Map<NodeId, number>;
  selectedBranches: Map<NodeId, number>;
  loops: Map<NodeId, LoopChoice>;
  gates: Map<NodeId, GateStatus>;
  scouts: ScoutFrame[];
  scoutClosing: ScoutFrame | null;
  captures: (CaptureSpan | null)[];
  activeNode: NodeId | null;
  match: CaptureSpan | null;
}

interface Scope {
  caps: (CaptureSpan | null)[];
  counters: Map<NodeId, number>;
  selectedBranches: Map<NodeId, number>;
  loops: Map<NodeId, LoopChoice>;
  gates: Map<NodeId, GateStatus>;
}

interface FlagDraft extends FlagEntry, Scope {}

type LookDraft = Scope;

interface Draft {
  index: number;
  phase: PlaybackPhase;
  attempts: number;
  attemptStart: number;
  head: number;
  flags: FlagDraft[];
  counters: Map<NodeId, number>;
  selectedBranches: Map<NodeId, number>;
  loops: Map<NodeId, LoopChoice>;
  gates: Map<NodeId, GateStatus>;
  scouts: ScoutFrame[];
  scoutClosing: ScoutFrame | null;
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
    selectedBranches: new Map(),
    loops: new Map(),
    gates: new Map(),
    scouts: [],
    scoutClosing: null,
    captures: new Array<CaptureSpan | null>(groupCount + 1).fill(null),
    activeNode: null,
    match: null,
    looks: [],
  };
}

function cloneCaps(caps: (CaptureSpan | null)[]): (CaptureSpan | null)[] {
  return caps.map((c) => (c === null ? null : { ...c }));
}

function cloneScout(frame: ScoutFrame): ScoutFrame {
  return { ...frame, reads: frame.reads.map((read) => ({ ...read })) };
}

function cloneScope(s: Scope): Scope {
  return {
    caps: cloneCaps(s.caps),
    counters: new Map(s.counters),
    selectedBranches: new Map(s.selectedBranches),
    loops: new Map(s.loops),
    gates: new Map(s.gates),
  };
}

function saveScope(d: Draft): Scope {
  return cloneScope({
    caps: d.captures,
    counters: d.counters,
    selectedBranches: d.selectedBranches,
    loops: d.loops,
    gates: d.gates,
  });
}

function restoreScope(d: Draft, s: Scope, captures: boolean): void {
  if (captures) {
    d.captures = cloneCaps(s.caps);
    d.counters = new Map(s.counters);
  }
  d.selectedBranches = new Map(s.selectedBranches);
  d.loops = new Map(s.loops);
  d.gates = new Map(s.gates);
}

function cloneDraft(d: Draft): Draft {
  return {
    ...d,
    flags: d.flags.map((f) => ({ node: f.node, option: f.option, pos: f.pos, ...cloneScope(f) })),
    counters: new Map(d.counters),
    selectedBranches: new Map(d.selectedBranches),
    loops: new Map(d.loops),
    gates: new Map(d.gates),
    scouts: d.scouts.map(cloneScout),
    scoutClosing: d.scoutClosing === null ? null : cloneScout(d.scoutClosing),
    captures: cloneCaps(d.captures),
    match: d.match === null ? null : { ...d.match },
    looks: d.looks.map(cloneScope),
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
    selectedBranches: new Map(d.selectedBranches),
    loops: new Map(d.loops),
    gates: new Map(d.gates),
    scouts: d.scouts.map(cloneScout),
    scoutClosing: d.scoutClosing === null ? null : cloneScout(d.scoutClosing),
    captures: cloneCaps(d.captures),
    activeNode: d.activeNode,
    match: d.match === null ? null : { ...d.match },
  };
}

type Kind = (node: NodeId) => 'alt' | 'repeat' | 'negLook' | 'other';

function applyTraceEvent(d: Draft, tr: Trace, i: number, kindOf: Kind): void {
  d.index++;
  d.scoutClosing = null;
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
      d.selectedBranches.clear();
      d.loops.clear();
      d.gates.clear();
      d.scouts.length = 0;
      d.captures.fill(null);
      d.activeNode = null;
      d.match = null;
      d.looks.length = 0;
      break;
    }
    case T.test: {
      d.activeNode = a;
      d.head = c === 1 ? b + dd : b;
      d.gates.set(a, c === 1 ? 'pass' : 'reject');
      const scout = d.scouts.at(-1);
      if (scout) scout.reads.push({ node: a, event: i, pos: b, len: dd, ok: c === 1 });
      break;
    }
    case T.choose: {
      d.flags.push({ node: a, option: b, pos: c, ...saveScope(d) });
      const kind = kindOf(a);
      if (kind === 'alt') d.selectedBranches.set(a, b - 1);
      else if (kind === 'repeat') d.loops.set(a, b === 1 ? 'again' : 'exit');
      d.activeNode = a;
      break;
    }
    case T.backtrack: {
      const f = d.flags.pop();
      if (f) restoreScope(d, f, true);
      const kind = kindOf(a);
      if (kind === 'alt') d.selectedBranches.set(a, b);
      else if (kind === 'repeat') d.loops.set(a, b === 1 ? 'exit' : 'again');
      d.head = c;
      d.activeNode = a;
      break;
    }
    case T.iter: {
      d.counters.set(a, b);
      d.loops.set(a, 'again');
      d.activeNode = a;
      break;
    }
    case T.look: {
      if (b === 0) {
        d.looks.push(saveScope(d));
        d.scouts.push({ node: a, start: i, end: null, reads: [] });
        d.gates.delete(a);
      } else {
        const lk = d.looks.pop();
        const frame = d.scouts.pop();
        const ok = c === 1;
        if (frame) d.scoutClosing = { ...frame, end: i };
        if (lk) restoreScope(d, lk, kindOf(a) === 'negLook' || !ok);
        if (d.flags.length > dd) d.flags.length = dd;
        d.gates.set(a, ok ? 'pass' : 'reject');
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
      d.selectedBranches.clear();
      d.loops.clear();
      d.captures.fill(null);
      d.flags.length = 0;
      d.looks.length = 0;
      d.scouts.length = 0;
      break;
    }
  }
}

export class TraceCursor {
  private readonly kindOf: Kind;
  private readonly keyframes = new Map<number, Draft>();
  private builtTo = 0;

  constructor(
    prog: Program,
    private readonly trace: Trace,
    private readonly keyframeEvery: number = DEFAULT_KEYFRAME_EVERY,
  ) {
    this.kindOf = (node) => {
      const n = prog.nodes[node];
      if (n === undefined) return 'other';
      if (n.kind === 'alt' || n.kind === 'repeat') return n.kind;
      return n.kind === 'look' && n.negate ? 'negLook' : 'other';
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
    for (let i = base; i < index; i++) applyTraceEvent(draft, this.trace, i, this.kindOf);
    return snapshot(draft);
  }

  private buildKeyframes(target: number): void {
    if (this.keyframeEvery === Infinity) return;
    while (this.builtTo + this.keyframeEvery <= target) {
      const next = this.builtTo + this.keyframeEvery;
      const draft = cloneDraft(this.keyframes.get(this.builtTo)!);
      for (let i = this.builtTo; i < next; i++) applyTraceEvent(draft, this.trace, i, this.kindOf);
      this.keyframes.set(next, draft);
      this.builtTo = next;
    }
  }
}

export function replayFinal(prog: Program, trace: Trace): MachineState {
  return new TraceCursor(prog, trace, Infinity).stateAt(trace.length);
}
