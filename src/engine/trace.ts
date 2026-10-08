import type { NodeId } from './ir.ts';

export type TraceEvent =
  | { t: 'attempt'; start: number }
  | { t: 'test'; node: NodeId; pos: number; ok: boolean; len: number }
  | { t: 'choose'; node: NodeId; option: number; pos: number; depth: number }
  | { t: 'backtrack'; node: NodeId; option: number; pos: number; depth: number }
  | { t: 'iter'; node: NodeId; count: number }
  | { t: 'look'; node: NodeId; phase: 'start' | 'end'; ok?: boolean; depth: number }
  | { t: 'capture'; group: number; start: number; end: number }
  | { t: 'match'; start: number; end: number }
  | { t: 'nomatch' };

export const enum T {
  attempt = 0,
  test = 1,
  choose = 2,
  backtrack = 3,
  iter = 4,
  look = 5,
  capture = 6,
  match = 7,
  nomatch = 8,
}

export const TRACE_EVENT_BUDGET = 250_000;
export const CHECKPOINT_EVERY = 1000;

/** Struct-of-arrays trace. Column meaning depends on `t[i]`; see TraceEvent. */
export interface Trace {
  length: number;
  t: Uint8Array;
  a: Int32Array;
  b: Int32Array;
  c: Int32Array;
  d: Int32Array;
  /** Sampled (step, depth, pos) triples while in count-only mode. */
  checkpoints: Int32Array;
  checkpointCount: number;
  truncated: boolean;
}

export class TraceBuilder {
  length = 0;
  t = new Uint8Array(1024);
  a = new Int32Array(1024);
  b = new Int32Array(1024);
  c = new Int32Array(1024);
  d = new Int32Array(1024);
  truncated = false;
  checkpoints = new Int32Array(3 * 256);
  checkpointCount = 0;

  constructor(private readonly budget = TRACE_EVENT_BUDGET) {}

  get recording(): boolean {
    return !this.truncated;
  }

  private grow(): void {
    const n = this.t.length * 2;
    const t = new Uint8Array(n);
    t.set(this.t);
    this.t = t;
    const a = new Int32Array(n);
    a.set(this.a);
    this.a = a;
    const b = new Int32Array(n);
    b.set(this.b);
    this.b = b;
    const c = new Int32Array(n);
    c.set(this.c);
    this.c = c;
    const d = new Int32Array(n);
    d.set(this.d);
    this.d = d;
  }

  push(t: T, a = 0, b = 0, c = 0, d = 0): void {
    if (this.truncated) return;
    if (this.length >= this.budget) {
      this.truncated = true;
      return;
    }
    if (this.length >= this.t.length) this.grow();
    const i = this.length++;
    this.t[i] = t;
    this.a[i] = a;
    this.b[i] = b;
    this.c[i] = c;
    this.d[i] = d;
  }

  checkpoint(step: number, depth: number, pos: number): void {
    if (this.checkpointCount * 3 + 3 > this.checkpoints.length) {
      const n = new Int32Array(this.checkpoints.length * 2);
      n.set(this.checkpoints);
      this.checkpoints = n;
    }
    const i = this.checkpointCount++ * 3;
    this.checkpoints[i] = step;
    this.checkpoints[i + 1] = depth;
    this.checkpoints[i + 2] = pos;
  }

  finish(): Trace {
    const n = this.length;
    return {
      length: n,
      t: this.t.slice(0, n),
      a: this.a.slice(0, n),
      b: this.b.slice(0, n),
      c: this.c.slice(0, n),
      d: this.d.slice(0, n),
      checkpoints: this.checkpoints.slice(0, this.checkpointCount * 3),
      checkpointCount: this.checkpointCount,
      truncated: this.truncated,
    };
  }
}

export function traceEvent(tr: Trace, i: number): TraceEvent {
  const a = tr.a[i],
    b = tr.b[i],
    c = tr.c[i],
    d = tr.d[i];
  switch (tr.t[i] as T) {
    case T.attempt:
      return { t: 'attempt', start: a };
    case T.test:
      return { t: 'test', node: a, pos: b, ok: c === 1, len: d };
    case T.choose:
      return { t: 'choose', node: a, option: b, pos: c, depth: d };
    case T.backtrack:
      return { t: 'backtrack', node: a, option: b, pos: c, depth: d };
    case T.iter:
      return { t: 'iter', node: a, count: b };
    case T.look:
      return { t: 'look', node: a, phase: b === 0 ? 'start' : 'end', ok: c < 0 ? undefined : c === 1, depth: d };
    case T.capture:
      return { t: 'capture', group: a, start: b, end: c };
    case T.match:
      return { t: 'match', start: a, end: b };
    case T.nomatch:
      return { t: 'nomatch' };
  }
}

export function* traceEvents(tr: Trace): Generator<TraceEvent> {
  for (let i = 0; i < tr.length; i++) yield traceEvent(tr, i);
}

export function transferables(tr: Trace): ArrayBuffer[] {
  return [tr.t.buffer, tr.a.buffer, tr.b.buffer, tr.c.buffer, tr.d.buffer, tr.checkpoints.buffer] as ArrayBuffer[];
}
