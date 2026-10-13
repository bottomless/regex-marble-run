import { T, type Trace } from '../engine/trace.ts';

/**
 * Prefix counts over the recorded trace: entry `e` holds the totals after the first `e` events have
 * been applied, so entry 0 is zero and entry `trace.length` matches the engine's recorded totals.
 * A step is one gate test or one backtrack, the same definition the engine uses for `result.steps`.
 */
export interface RunCounters {
  steps: Int32Array;
  backtracks: Int32Array;
  /** Highest input position the read head has reached after the first `e` events (the linear side follows this). */
  waterline: Int32Array;
}

export interface CounterReading {
  steps: number;
  backtracks: number;
}

export function buildCounters(trace: Trace): RunCounters {
  const steps = new Int32Array(trace.length + 1);
  const backtracks = new Int32Array(trace.length + 1);
  const waterline = new Int32Array(trace.length + 1);
  let s = 0;
  let b = 0;
  let head = 0;
  let high = 0;
  for (let i = 0; i < trace.length; i++) {
    const t = trace.t[i] as T;
    switch (t) {
      case T.attempt:
        head = trace.a[i];
        break;
      case T.test:
        s++;
        head = trace.c[i] === 1 ? trace.b[i] + trace.d[i] : trace.b[i];
        break;
      case T.backtrack:
        s++;
        b++;
        head = trace.c[i];
        break;
      case T.match:
        head = trace.b[i];
        break;
      default:
        break;
    }
    if (head > high) high = head;
    steps[i + 1] = s;
    backtracks[i + 1] = b;
    waterline[i + 1] = high;
  }
  return { steps, backtracks, waterline };
}

/** Totals once event `eventIndex` has been applied (-1 = before the first event). */
export function countersAt(counters: RunCounters, eventIndex: number): CounterReading {
  const last = counters.steps.length - 1;
  const i = eventIndex + 1 < 0 ? 0 : eventIndex + 1 > last ? last : eventIndex + 1;
  return { steps: counters.steps[i], backtracks: counters.backtracks[i] };
}

/** Highest input position read so far (-1 = before the first event, which reads nothing). */
export function waterlineAt(counters: RunCounters, eventIndex: number): number {
  const last = counters.waterline.length - 1;
  const i = eventIndex + 1 < 0 ? 0 : eventIndex + 1 > last ? last : eventIndex + 1;
  return counters.waterline[i];
}

export type NativeTiming =
  | { status: 'running' }
  | { status: 'success'; elapsedMs: number; matched: boolean }
  | { status: 'timeout'; timeoutMs: number }
  | { status: 'error'; error: string };
