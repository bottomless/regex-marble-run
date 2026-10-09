import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { type Trace } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import { routePath } from '../../src/layout/route.ts';
import type { MachineLayout } from '../../src/layout/pieces.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import {
  buildTimeline,
  segmentAt,
  COLLAPSE_SPEED,
  INSTANT,
  SPEED_STEPS,
  type Timeline,
} from '../../src/playback/timeline.ts';
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
  { name: 'backtracking greedy loop', pattern: '<.+>', flags: '', input: '<b>bold</b>' },
  { name: 'alternation with rejection', pattern: 'c(a|o)t', flags: '', input: 'cut' },
  { name: 'plain nomatch', pattern: 'x', flags: '', input: 'abc' },
  { name: 'repeat with counters', pattern: 'a{2,4}b', flags: '', input: 'aaab' },
  { name: 'lookahead scout', pattern: 'a(?=b)c', flags: '', input: 'abc' },
  { name: 'negative lookahead', pattern: 'a(?!b)', flags: '', input: 'abac' },
  { name: 'capture in repeat', pattern: '(a)+b', flags: '', input: 'aab' },
];

const cases = [...presetCases, ...extraCases];

interface Built {
  prog: ReturnType<typeof parsePattern>;
  trace: Trace;
  ml: MachineLayout;
  input: string;
}

const built = new Map<string, Built>();

function build(c: Case): Built {
  const cached = built.get(c.name);
  if (cached) return cached;
  const prog = parsePattern(c.pattern, c.flags);
  const { trace } = runBacktrack(prog, c.input);
  const ml = layout(prog);
  const value: Built = { prog, trace, ml, input: c.input };
  built.set(c.name, value);
  return value;
}

function primaries(tl: Timeline) {
  return tl.segments.filter((s) => s.primary);
}

describe('playback timeline (M5 step 2)', () => {
  describe.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { prog, trace, ml, input } = build(c);

    it('starts at zero with monotonic, gap-free times', () => {
      const tl = buildTimeline(trace, ml, { speed: 1 });
      expect(tl.segments.length).toBeGreaterThan(0);
      expect(tl.segments[0].t0).toBe(0);
      for (let k = 0; k < tl.segments.length; k++) {
        const s = tl.segments[k];
        expect(s.t1).toBeGreaterThanOrEqual(s.t0);
        expect(Number.isFinite(s.t0) && Number.isFinite(s.t1)).toBe(true);
        if (k > 0) expect(s.t0).toBe(tl.segments[k - 1].t1);
      }
      expect(tl.duration).toBe(tl.segments[tl.segments.length - 1].t1);
      expect(tl.eventCount).toBe(trace.length);
    });

    it('covers every event index exactly once via primary segments', () => {
      const tl = buildTimeline(trace, ml, { speed: 1 });
      const prim = primaries(tl);
      expect(prim).toHaveLength(trace.length);
      prim.forEach((s, i) => expect(s.event).toBe(i));
      // Every segment references a real event, and lead-ins precede their primary.
      for (const s of tl.segments) {
        expect(s.event).toBeGreaterThanOrEqual(0);
        expect(s.event).toBeLessThan(trace.length);
      }
    });

    it('aligns primary segments with the state reducer', () => {
      const tl = buildTimeline(trace, ml, { speed: 1 });
      const cursor = new TraceCursor(prog, trace, 64);
      for (const s of primaries(tl)) {
        const after = cursor.stateAt(s.event + 1);
        if (s.kind === 'gate') {
          expect(after.activeNode).toBe(s.node);
          expect(after.head).toBe(s.ok ? (s.pos ?? 0) + (s.len ?? 0) : (s.pos ?? 0));
        } else if (s.kind === 'flag' && s.action === 'pop') {
          expect(after.head).toBe(s.pos);
        } else if (s.kind === 'hop') {
          expect(after.attemptStart).toBe(s.pos);
          expect(after.head).toBe(s.pos);
        }
        expect(after.head).toBeGreaterThanOrEqual(0);
        expect(after.head).toBeLessThanOrEqual(input.length);
      }
    });

    it('produces valid routes that match the routing graph', () => {
      const tl = buildTimeline(trace, ml, { speed: 1 });
      const ids = new Set(ml.graph.points.map((p) => p.id));
      for (const s of tl.segments) {
        if (!s.route) continue;
        expect(['roll', 'drop', 'lift']).toContain(s.kind);
        expect(s.route.length).toBeGreaterThanOrEqual(2);
        for (const id of s.route) expect(ids.has(id)).toBe(true);
        // The stored route is a real path between its endpoints.
        const recomputed = routePath(ml.graph, s.route[0], s.route[s.route.length - 1]);
        expect(recomputed).toEqual(s.route);
      }
    });

    it('scales total duration monotonically with speed and reaches zero at instant', () => {
      const durations = SPEED_STEPS.map((speed) => buildTimeline(trace, ml, { speed }).duration);
      for (let k = 1; k < durations.length; k++) {
        expect(durations[k]).toBeLessThanOrEqual(durations[k - 1]);
      }
      expect(durations[0]).toBeGreaterThan(durations[durations.length - 1]);
      const instantTl = buildTimeline(trace, ml, { speed: INSTANT });
      expect(instantTl.instant).toBe(true);
      expect(instantTl.duration).toBe(0);
      for (const s of instantTl.segments) {
        expect(s.t0).toBe(0);
        expect(s.t1).toBe(0);
        expect(s.jump).toBe(true);
      }
      // Coverage still holds at instant.
      expect(primaries(instantTl)).toHaveLength(trace.length);
    });

    it('collapses travel segments into jumps at high speed', () => {
      const tl = buildTimeline(trace, ml, { speed: COLLAPSE_SPEED });
      expect(tl.collapsed).toBe(true);
      for (const s of tl.segments) {
        if (s.kind === 'roll' || s.kind === 'drop' || s.kind === 'lift') {
          expect(s.t1 - s.t0).toBe(0);
          expect(s.jump).toBe(true);
        }
      }
      const slow = buildTimeline(trace, ml, { speed: 1 });
      expect(slow.collapsed).toBe(false);
    });

    it('segmentAt finds the active segment and interpolates within it', () => {
      const tl = buildTimeline(trace, ml, { speed: 1 });
      expect(tl.duration).toBeGreaterThan(0);
      expect(segmentAt(tl, -5)?.segment).toBe(tl.segments[0]);
      expect(segmentAt(tl, 0)?.segment).toBe(tl.segments[0]);
      const mid = tl.duration / 2;
      const found = segmentAt(tl, mid);
      expect(found).not.toBeNull();
      expect(found!.segment.t0).toBeLessThanOrEqual(mid);
      expect(found!.segment.t1).toBeGreaterThanOrEqual(mid);
      expect(found!.fraction).toBeGreaterThanOrEqual(0);
      expect(found!.fraction).toBeLessThanOrEqual(1);
      const last = segmentAt(tl, tl.duration + 100)!;
      expect(last.segment).toBe(tl.segments[tl.segments.length - 1]);
      expect(last.fraction).toBe(1);
    });
  });

  it('emits lift and pop-flag segments for a pattern that backtracks', () => {
    const { trace, ml } = build({ name: 'backtracking greedy loop', pattern: '<.+>', flags: '', input: '<b>bold</b>' });
    const tl = buildTimeline(trace, ml, { speed: 1 });
    const kinds = new Set(tl.segments.map((s) => s.kind));
    expect(kinds.has('lift')).toBe(true);
    expect(tl.segments.some((s) => s.kind === 'flag' && s.action === 'pop')).toBe(true);
    expect(tl.segments.some((s) => s.kind === 'flag' && s.action === 'plant')).toBe(true);
    expect(tl.segments.some((s) => s.kind === 'finish' && s.result === 'match')).toBe(true);
  });

  it('emits iter segments for a bounded repeat', () => {
    const { trace, ml } = build({ name: 'repeat with counters', pattern: 'a{2,4}b', flags: '', input: 'aaab' });
    const tl = buildTimeline(trace, ml, { speed: 1 });
    expect(tl.segments.some((s) => s.kind === 'iter')).toBe(true);
  });

  it('emits scout segments for lookahead', () => {
    const { trace, ml } = build({ name: 'lookahead scout', pattern: 'a(?=b)c', flags: '', input: 'abc' });
    const tl = buildTimeline(trace, ml, { speed: 1 });
    const scouts = tl.segments.filter((s) => s.kind === 'scout');
    expect(scouts.some((s) => s.phase === 'start')).toBe(true);
    expect(scouts.some((s) => s.phase === 'end')).toBe(true);
  });

  it('emits a reject finish for a nomatch', () => {
    const { trace, ml } = build({ name: 'plain nomatch', pattern: 'x', flags: '', input: 'abc' });
    const tl = buildTimeline(trace, ml, { speed: 1 });
    const finish = tl.segments.filter((s) => s.kind === 'finish');
    expect(finish).toHaveLength(1);
    expect(finish[0].result).toBe('reject');
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
    const ml = layout(prog);
    const tl = buildTimeline(empty, ml, { speed: 1 });
    expect(tl.segments).toEqual([]);
    expect(tl.duration).toBe(0);
    expect(tl.eventCount).toBe(0);
    expect(segmentAt(tl, 0)).toBeNull();
  });

  it('builds a small preset timeline well within a frame budget', () => {
    const { trace, ml } = build(cases[0]);
    const t0 = performance.now();
    const tl = buildTimeline(trace, ml, { speed: 1 });
    const elapsed = performance.now() - t0;
    expect(tl.segments.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it('defaults to speed 1 when no options are given', () => {
    const { trace, ml } = build(cases[0]);
    const a = buildTimeline(trace, ml);
    const b = buildTimeline(trace, ml, { speed: 1 });
    expect(a.speed).toBe(1);
    expect(a.duration).toBe(b.duration);
  });
});
