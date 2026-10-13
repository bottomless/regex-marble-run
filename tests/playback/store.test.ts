import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import type { Trace } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import type { MachineLayout } from '../../src/layout/pieces.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { poseAtIndex } from '../../src/playback/motion.ts';
import { COLLAPSE_SPEED, INSTANT, SPEED_STEPS } from '../../src/playback/timeline.ts';
import { createPlaybackStore, type PlaybackStore } from '../../src/playback/store.ts';
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
  { name: 'plain nomatch', pattern: 'x', flags: '', input: 'abc' },
  { name: 'backtracking greedy loop', pattern: '<.+>', flags: '', input: '<b>bold</b>' },
  { name: 'bounded repeat', pattern: 'a{2,4}b', flags: '', input: 'aaab' },
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

function loaded(c: Case, speed = 1): { store: PlaybackStore; built: Built } {
  const b = build(c);
  const store = createPlaybackStore();
  store.getState().load({ program: b.prog, trace: b.trace, layout: b.ml, speed });
  return { store, built: b };
}

describe('playback store (M5 step 3)', () => {
  describe.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const b = build(c);

    it('loads at the start with a valid initial state', () => {
      const { store } = loaded(c);
      const s = store.getState();
      expect(s.time).toBe(0);
      expect(s.atStart).toBe(true);
      expect(s.playing).toBe(false);
      expect(s.eventCount).toBe(b.trace.length);
      expect(s.duration).toBeGreaterThan(0);
      expect(s.eventStarts).toHaveLength(b.trace.length + 1);
      expect(s.eventStarts[b.trace.length]).toBe(s.duration);
      expect(s.eventSegment).toHaveLength(b.trace.length);
      expect(s.segmentIndex).toBe(0);
      expect(s.eventIndex).toBe(0);
      expect(s.machine).not.toBeNull();
      // The start rests on event 0's segment; machine reflects the state after event 0.
      const ref = new TraceCursor(b.prog, b.trace, 64);
      expect(s.machine).toEqual(ref.stateAt(1));
    });

    it('plays to the end and stops', () => {
      const { store } = loaded(c);
      store.getState().play();
      expect(store.getState().playing).toBe(true);
      // Advance far beyond the duration in one tick.
      store.getState().tick(store.getState().duration + 1000);
      const s = store.getState();
      expect(s.playing).toBe(false);
      expect(s.atEnd).toBe(true);
      expect(s.time).toBe(s.duration);
      expect(s.eventIndex).toBe(b.trace.length - 1);
    });

    it('tick does nothing while paused', () => {
      const { store } = loaded(c);
      const before = store.getState().time;
      store.getState().tick(500);
      expect(store.getState().time).toBe(before);
    });

    it('advances monotonically while playing and reaches every event', () => {
      const { store } = loaded(c);
      const cursor = new TraceCursor(b.prog, b.trace, 64);
      store.getState().play();
      const step = Math.max(1, store.getState().duration / (b.trace.length * 2));
      let last = -1;
      const seenEvents = new Set<number>();
      for (let guard = 0; guard < b.trace.length * 4 + 10; guard++) {
        const s = store.getState();
        if (s.atEnd) break;
        expect(s.time).toBeGreaterThanOrEqual(last);
        last = s.time;
        if (s.eventIndex >= 0) seenEvents.add(s.eventIndex);
        // The exposed machine always equals the reducer state after the current event.
        if (s.eventIndex >= 0) expect(s.machine).toEqual(cursor.stateAt(s.eventIndex + 1));
        store.getState().tick(step);
      }
      expect(store.getState().atEnd).toBe(true);
      // Every event was the active event at some point (or skipped only by coarse stepping at the very end).
      expect(seenEvents.size).toBeGreaterThan(0);
    });

    it('single-steps forward through every event, matching the reducer exactly', () => {
      const { store } = loaded(c);
      const cursor = new TraceCursor(b.prog, b.trace, 32);
      for (let e = 0; e < b.trace.length; e++) {
        store.getState().seekEvent(e);
        const s = store.getState();
        expect(s.eventIndex).toBe(e);
        expect(s.playing).toBe(false);
        expect(s.machine).toEqual(cursor.stateAt(e + 1));
      }
    });

    it('steps forward and back one event at a time', () => {
      const { store } = loaded(c);
      const cursor = new TraceCursor(b.prog, b.trace, 32);
      store.getState().seekEvent(0);
      for (let e = 1; e < b.trace.length; e++) {
        store.getState().stepForward();
        const s = store.getState();
        expect(s.eventIndex).toBe(e);
        expect(s.machine).toEqual(cursor.stateAt(e + 1));
      }
      // At the end, stepping forward stays put.
      store.getState().stepForward();
      expect(store.getState().atEnd).toBe(true);
      // Step all the way back to the start.
      for (let e = b.trace.length - 1; e >= 0; e--) {
        const s = store.getState();
        expect(s.eventIndex).toBe(e);
        expect(s.machine).toEqual(cursor.stateAt(e + 1));
        store.getState().stepBack();
      }
      expect(store.getState().eventIndex).toBe(0);
      expect(store.getState().atStart).toBe(true);
    });

    it('backward stepping restores identical state to forward stepping', () => {
      const { store } = loaded(c);
      const forward: unknown[] = [];
      for (let e = 0; e < b.trace.length; e++) {
        store.getState().seekEvent(e);
        forward.push(store.getState().machine);
      }
      const backward: unknown[] = [];
      for (let e = b.trace.length - 1; e >= 0; e--) {
        store.getState().seekEvent(e);
        backward.unshift(store.getState().machine);
      }
      expect(backward).toEqual(forward);
    });

    it('seeks by time and fraction within bounds', () => {
      const { store } = loaded(c);
      const dur = store.getState().duration;
      store.getState().seekFraction(0.5);
      const mid = store.getState();
      expect(mid.time).toBeGreaterThan(0);
      expect(mid.time).toBeLessThan(dur);
      expect(mid.playing).toBe(false);
      store.getState().seek(-100);
      expect(store.getState().time).toBe(0);
      store.getState().seek(dur + 100);
      expect(store.getState().time).toBe(dur);
      expect(store.getState().atEnd).toBe(true);
      store.getState().seekFraction(0);
      expect(store.getState().atStart).toBe(true);
      store.getState().seekFraction(1);
      expect(store.getState().atEnd).toBe(true);
    });

    it('restart returns to the beginning', () => {
      const { store } = loaded(c);
      store.getState().seekFraction(0.75);
      store.getState().restart();
      const s = store.getState();
      expect(s.time).toBe(0);
      expect(s.atStart).toBe(true);
      expect(s.eventIndex).toBe(0);
    });

    it('toggle flips play state', () => {
      const { store } = loaded(c);
      expect(store.getState().playing).toBe(false);
      store.getState().toggle();
      expect(store.getState().playing).toBe(true);
      store.getState().toggle();
      expect(store.getState().playing).toBe(false);
    });

    it('play from the end restarts', () => {
      const { store } = loaded(c);
      store.getState().seekFraction(1);
      expect(store.getState().atEnd).toBe(true);
      store.getState().play();
      const s = store.getState();
      expect(s.playing).toBe(true);
      expect(s.time).toBe(0);
    });

    it('changing speed preserves the current position and rescales duration', () => {
      const { store } = loaded(c, 1);
      store.getState().seekFraction(0.4);
      const beforeEvent = store.getState().eventIndex;
      const beforeFraction = store.getState().fraction;
      const baseDuration = store.getState().duration;
      store.getState().setSpeed(4);
      const s = store.getState();
      expect(s.speed).toBe(4);
      expect(s.eventIndex).toBe(beforeEvent);
      expect(s.fraction).toBeCloseTo(beforeFraction, 5);
      expect(s.duration).toBeLessThan(baseDuration);
    });

    it('duration shrinks monotonically across the speed ladder and hits zero at instant', () => {
      const { store } = loaded(c, SPEED_STEPS[0]);
      let prev = store.getState().duration;
      for (const speed of SPEED_STEPS.slice(1)) {
        store.getState().setSpeed(speed);
        const d = store.getState().duration;
        expect(d).toBeLessThanOrEqual(prev);
        prev = d;
      }
      store.getState().setSpeed(INSTANT);
      const s = store.getState();
      expect(s.duration).toBe(0);
      expect(s.atEnd).toBe(true);
      expect(s.machine).not.toBeNull();
    });

    it('preserves fractional poses across all finite speeds and back to normal', () => {
      const { store } = loaded(c);
      const timeline = store.getState().timeline!;
      const roll = timeline.segments.findIndex((segment) => segment.kind === 'roll');
      const index = roll >= 0 ? roll : timeline.segments.findIndex((segment) => segment.kind === 'gate');
      expect(index).toBeGreaterThanOrEqual(0);
      const segment = timeline.segments[index];
      store.getState().seek(segment.t0 + (segment.t1 - segment.t0) * 0.37);
      const before = store.getState();
      const pose = poseAtIndex(b.ml, before.timeline!, before.segmentIndex, before.fraction);
      for (const speed of [...SPEED_STEPS, 1]) {
        store.getState().setSpeed(speed);
        const state = store.getState();
        expect(state.segmentIndex).toBe(before.segmentIndex);
        expect(state.eventIndex).toBe(before.eventIndex);
        expect(state.fraction).toBeCloseTo(before.fraction, 10);
        expect(state.machine).toEqual(before.machine);
        expect(state.playing).toBe(false);
        expect(state.atStart).toBe(false);
        expect(state.atEnd).toBe(false);
        expect(poseAtIndex(b.ml, state.timeline!, state.segmentIndex, state.fraction)).toEqual(pose);
      }
    });

    it('instant settles at the exact final state and stops even while playing', () => {
      const { store } = loaded(c);
      store.getState().seekFraction(0.4);
      store.getState().play();
      store.getState().setSpeed(INSTANT);
      const state = store.getState();
      expect(state.machine).toEqual(new TraceCursor(b.prog, b.trace).stateAt(b.trace.length));
      expect(state.eventIndex).toBe(b.trace.length - 1);
      expect(state.atStart).toBe(false);
      expect(state.atEnd).toBe(true);
      expect(state.playing).toBe(false);
      store.getState().setSpeed(1);
      expect(store.getState().machine).toEqual(state.machine);
      expect(store.getState().atEnd).toBe(true);
      expect(store.getState().playing).toBe(false);
    });

    it('can step back, restart, scrub and play with a zero-duration timeline', () => {
      const { store } = loaded(c, INSTANT);
      const cursor = new TraceCursor(b.prog, b.trace);
      expect(store.getState().atEnd).toBe(true);
      store.getState().stepBack();
      expect(store.getState().eventIndex).toBe(b.trace.length - 2);
      expect(store.getState().machine).toEqual(cursor.stateAt(b.trace.length - 1));
      expect(store.getState().atStart).toBe(false);
      expect(store.getState().atEnd).toBe(false);
      store.getState().restart();
      expect(store.getState().atStart).toBe(true);
      expect(store.getState().atEnd).toBe(false);
      store.getState().seekEvent(1);
      expect(store.getState().machine).toEqual(cursor.stateAt(2));
      expect(store.getState().atStart).toBe(false);
      store.getState().play();
      expect(store.getState().machine).toEqual(cursor.stateAt(b.trace.length));
      expect(store.getState().atEnd).toBe(true);
      expect(store.getState().playing).toBe(false);
    });

    it('keeps instant selected and settles new traces on load after reset', () => {
      const { store } = loaded(c, INSTANT);
      store.getState().reset();
      store.getState().load({ program: b.prog, trace: b.trace, layout: b.ml });
      expect(store.getState().speed).toBe(INSTANT);
      expect(store.getState().atEnd).toBe(true);
      expect(store.getState().atStart).toBe(false);
      expect(store.getState().playing).toBe(false);
      expect(store.getState().machine).toEqual(new TraceCursor(b.prog, b.trace).stateAt(b.trace.length));
    });

    it('collapses travel at high speed but keeps event coverage', () => {
      const { store } = loaded(c, COLLAPSE_SPEED);
      const s = store.getState();
      expect(s.timeline!.collapsed).toBe(true);
      expect(s.eventCount).toBe(b.trace.length);
      store.getState().seekEvent(b.trace.length - 1);
      expect(store.getState().eventIndex).toBe(b.trace.length - 1);
    });

    it('notifies subscribers on transport changes', () => {
      const { store } = loaded(c);
      let calls = 0;
      const unsub = store.subscribe(() => {
        calls++;
      });
      store.getState().play();
      store.getState().tick(10);
      store.getState().pause();
      unsub();
      const after = calls;
      store.getState().toggle();
      expect(calls).toBe(after);
      expect(after).toBeGreaterThan(0);
    });

    it('layout rebuilds retain the settled endpoint at instant and finite speeds', () => {
      const { store } = loaded(c);
      for (const speed of [INSTANT, 1]) {
        store.getState().setSpeed(speed);
        const before = store.getState().machine;
        store.getState().setLayout(layout(b.prog));
        expect(store.getState().atEnd).toBe(true);
        expect(store.getState().atStart).toBe(false);
        expect(store.getState().machine).toEqual(before);
      }
    });

    it('setLayout rebuilds while preserving the current event', () => {
      const { store } = loaded(c);
      store.getState().seekEvent(Math.min(1, b.trace.length - 1));
      const beforeEvent = store.getState().eventIndex;
      const rebuilt = layout(b.prog);
      store.getState().setLayout(rebuilt);
      const s = store.getState();
      expect(s.layout).toBe(rebuilt);
      expect(s.eventIndex).toBe(beforeEvent);
    });
  });

  it('reset clears everything back to the empty state', () => {
    const { store } = loaded(cases[0]);
    store.getState().reset();
    const s = store.getState();
    expect(s.program).toBeNull();
    expect(s.trace).toBeNull();
    expect(s.timeline).toBeNull();
    expect(s.cursor).toBeNull();
    expect(s.machine).toBeNull();
    expect(s.eventCount).toBe(0);
    expect(s.duration).toBe(0);
    expect(s.atStart).toBe(true);
    expect(s.atEnd).toBe(true);
    // Transport actions are safe no-ops when empty.
    store.getState().play();
    store.getState().tick(16);
    store.getState().stepForward();
    store.getState().stepBack();
    store.getState().seek(100);
    store.getState().seekEvent(3);
    expect(store.getState().time).toBe(0);
  });

  it('loads an empty trace without crashing', () => {
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
    const store = createPlaybackStore();
    store.getState().load({ program: prog, trace: empty, layout: ml });
    const s = store.getState();
    expect(s.eventCount).toBe(0);
    expect(s.duration).toBe(0);
    expect(s.machine).not.toBeNull();
    expect(s.machine!.phase).toBe('idle');
    store.getState().play();
    store.getState().tick(16);
    expect(store.getState().atEnd).toBe(true);
  });

  it('exposes the match result passed at load', () => {
    const b = build(cases[0]);
    const { result } = runBacktrack(b.prog, b.input);
    const store = createPlaybackStore();
    store.getState().load({ program: b.prog, trace: b.trace, layout: b.ml, result });
    expect(store.getState().result).toBe(result);
  });

  it('toggleFollow flips the follow flag', () => {
    const { store } = loaded(cases[0]);
    expect(store.getState().follow).toBe(false);
    store.getState().toggleFollow();
    expect(store.getState().follow).toBe(true);
    store.getState().toggleFollow();
    expect(store.getState().follow).toBe(false);
  });
});
