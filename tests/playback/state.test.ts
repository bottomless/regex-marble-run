import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack, type MatchResult } from '../../src/engine/backtrack.ts';
import { T, type Trace } from '../../src/engine/trace.ts';
import { TraceCursor, finalFlags, replayFinal, type MachineState } from '../../src/playback/state.ts';
import { PRESETS } from '../../src/presets.ts';

interface Case {
  name: string;
  pattern: string;
  flags: string;
  input: string;
}

const presetCases: Case[] = PRESETS.filter((p) => p.number <= 5).map((p) => ({
  name: `preset ${p.number}: ${p.id}`,
  pattern: p.pattern,
  flags: p.flags,
  input: p.input,
}));

const extraCases: Case[] = [
  { name: 'plain nomatch walks every start', pattern: 'x', flags: '', input: 'abc' },
  { name: 'sticky nomatch tries only index 0', pattern: 'x', flags: 'y', input: 'abc' },
  { name: 'capture reset inside repeat', pattern: '((a)|b)*', flags: '', input: 'ab' },
  { name: 'negative lookahead passes and fails', pattern: 'a(?!b)', flags: '', input: 'abac' },
  { name: 'lookbehind black box', pattern: '(?<=a)b', flags: '', input: 'ab' },
  { name: 'small exponential backtracker', pattern: '^(a+)+$', flags: '', input: 'aaaaaaaa!' },
  { name: 'multiline anchor', pattern: '^b', flags: 'm', input: 'a\nb' },
  { name: 'named group and named backref', pattern: '(?<n>a)\\k<n>', flags: '', input: 'aa' },
  { name: 'lazy loop bails out early', pattern: 'a+?b', flags: '', input: 'aaab' },
  { name: 'lookahead captures persist', pattern: '(?=(a+))a*b\\1', flags: '', input: 'aabaa' },
];

const cases = [...presetCases, ...extraCases];

function build(c: Case) {
  const prog = parsePattern(c.pattern, c.flags);
  const { result, trace } = runBacktrack(prog, c.input);
  return { prog, result, trace };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkFinalState(state: MachineState, result: MatchResult, input: string): void {
  expect(state.phase).toBe(result.matched ? 'matched' : 'nomatch');
  expect(state.attempts).toBe(result.attempts);
  if (result.matched) {
    expect(state.match).toEqual({ start: result.index, end: result.end });
    expect(state.head).toBe(result.end);
    expect(state.captures[0]).toEqual({ start: result.index, end: result.end });
    for (let g = 1; g < result.groups.length; g++) {
      const span = state.captures[g];
      const text = span === null ? undefined : input.slice(span.start, span.end);
      expect(text, `group ${g}`).toBe(result.groups[g]);
    }
  } else {
    expect(state.match).toBeNull();
    expect(state.flags).toHaveLength(0);
  }
}

function depthAfterEvents(trace: Trace): (number | null)[] {
  const depths: (number | null)[] = [0];
  let depth = 0;
  for (let i = 0; i < trace.length; i++) {
    const t = trace.t[i] as T;
    if (t === T.choose || t === T.backtrack || (t === T.look && trace.b[i] === 1)) {
      depth = trace.d[i];
    } else if (t === T.attempt) {
      depth = 0;
    }
    depths.push(depth);
  }
  return depths;
}

describe('playback state reducer (M5 step 1)', () => {
  describe.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { prog, result, trace } = build(c);

    it('final state agrees with the engine result', () => {
      checkFinalState(replayFinal(prog, trace), result, c.input);
    });

    it('keyframed seeks match a full forward replay at every index', () => {
      const fast = new TraceCursor(prog, trace, 3);
      const slow = new TraceCursor(prog, trace, Infinity);
      let backtracks = 0;
      let maxFlags = 0;
      for (let i = 0; i <= trace.length; i++) {
        const got = fast.stateAt(i);
        expect(got).toEqual(slow.stateAt(i));
        if (i > 0 && trace.t[i - 1] === (T.backtrack as number)) backtracks++;
        maxFlags = Math.max(maxFlags, got.flags.length);
        expect(got.head).toBeGreaterThanOrEqual(0);
        expect(got.head).toBeLessThanOrEqual(c.input.length);
        if (got.phase === 'running' || got.phase === 'matched') {
          expect(got.head).toBeGreaterThanOrEqual(got.attemptStart);
        }
        if (i > 0 && trace.t[i - 1] === (T.backtrack as number)) {
          expect(got.head).toBe(trace.c[i - 1]);
        }
        if (i > 0 && trace.t[i - 1] === (T.test as number) && trace.c[i - 1] === 1) {
          expect(got.head).toBe(trace.b[i - 1] + trace.d[i - 1]);
        }
      }
      expect(backtracks).toBe(result.backtracks);
      expect(maxFlags).toBe(result.maxDepth);
    });

    it('flag stack depth matches engine depth after every event', () => {
      const cursor = new TraceCursor(prog, trace, Infinity);
      const depths = depthAfterEvents(trace);
      for (let i = 0; i <= trace.length; i++) {
        const depth = depths[i];
        if (depth === null) continue;
        expect(cursor.stateAt(i).flags.length, `event index ${i}`).toBe(depth);
      }
    });

    it('random and backward seeks reproduce forward states', () => {
      const forward: MachineState[] = [];
      const ref = new TraceCursor(prog, trace, Infinity);
      for (let i = 0; i <= trace.length; i++) forward.push(ref.stateAt(i));

      const cursor = new TraceCursor(prog, trace, 7);
      const rand = mulberry32(0x5eed);
      for (let k = 0; k < 200; k++) {
        const i = Math.floor(rand() * (trace.length + 1));
        expect(cursor.stateAt(i)).toEqual(forward[i]);
      }
      for (let i = trace.length; i >= 0; i--) {
        expect(cursor.stateAt(i)).toEqual(forward[i]);
      }
    });

    it('returned states are immutable snapshots', () => {
      if (trace.length === 0) return;
      const cursor = new TraceCursor(prog, trace, 4);
      const i = trace.length;
      const first = cursor.stateAt(i);
      first.head = -999;
      first.flags.push({ node: 0, option: 0, pos: 0 });
      first.counters.set(0, 123);
      first.captures[0] = { start: 1, end: 2 };
      const second = cursor.stateAt(i);
      expect(second.head).not.toBe(-999);
      expect(second.counters.get(0)).not.toBe(123);
    });
  });

  it('rejects out-of-range indices', () => {
    const { prog, trace } = build(cases[0]);
    const cursor = new TraceCursor(prog, trace);
    expect(() => cursor.stateAt(-1)).toThrow(RangeError);
    expect(() => cursor.stateAt(trace.length + 1)).toThrow(RangeError);
  });

  it('handles an empty trace', () => {
    const empty: Trace = {
      length: 0,
      t: new Uint8Array(0),
      a: new Int32Array(0),
      b: new Int32Array(0),
      c: new Int32Array(0),
      d: new Int32Array(0),
      checkpoints: new Int32Array(0),
      checkpointCount: 0,
      truncated: false,
    };
    const prog = parsePattern('a', '');
    const state = replayFinal(prog, empty);
    expect(state.phase).toBe('idle');
    expect(state.attempts).toBe(0);
    expect(state.head).toBe(0);
  });

  it('finalFlags matches the full replay, including truncated flood presets', () => {
    const floodCases: Case[] = PRESETS.filter((p) => p.number > 5).map((p) => ({
      name: p.id,
      pattern: p.pattern,
      flags: p.flags,
      input: p.input,
    }));
    for (const c of [...cases, ...floodCases]) {
      const { prog, trace } = build(c);
      expect(finalFlags(trace), c.name).toEqual(replayFinal(prog, trace).flags);
    }
  });
});
