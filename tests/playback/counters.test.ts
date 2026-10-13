import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { T } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import { buildCounters, countersAt } from '../../src/playback/counters.ts';
import { createPlaybackStore } from '../../src/playback/store.ts';
import { PRESETS } from '../../src/presets.ts';

const CALM = PRESETS.filter((p) => p.number <= 5);

describe('run counters (M6 HUD)', () => {
  it('prefix totals end on the engine totals for every untruncated preset', () => {
    for (const preset of CALM) {
      const program = parsePattern(preset.pattern, preset.flags);
      const { trace, result } = runBacktrack(program, preset.input);
      expect(trace.truncated, preset.id).toBe(false);
      const counters = buildCounters(trace);
      expect(counters.steps.length).toBe(trace.length + 1);
      expect(countersAt(counters, -1)).toEqual({ steps: 0, backtracks: 0 });
      expect(countersAt(counters, trace.length - 1), preset.id).toEqual({
        steps: result.steps,
        backtracks: result.backtracks,
      });
      expect(countersAt(counters, trace.length + 50)).toEqual(countersAt(counters, trace.length - 1));
      expect(countersAt(counters, -7)).toEqual({ steps: 0, backtracks: 0 });
    }
  });

  it('counts a step per gate test and per backtrack, and never decreases', () => {
    const program = parsePattern('<.+>', '');
    const { trace } = runBacktrack(program, '<b>bold</b>');
    const counters = buildCounters(trace);
    let steps = 0;
    let backtracks = 0;
    for (let i = 0; i < trace.length; i++) {
      const t = trace.t[i] as T;
      const before = countersAt(counters, i - 1);
      const after = countersAt(counters, i);
      expect(after.steps - before.steps).toBe(t === T.test || t === T.backtrack ? 1 : 0);
      expect(after.backtracks - before.backtracks).toBe(t === T.backtrack ? 1 : 0);
      steps = after.steps;
      backtracks = after.backtracks;
    }
    expect(backtracks).toBeGreaterThan(0);
    expect(steps).toBeGreaterThan(backtracks);
  });

  it('the store exposes counters on load and keeps the native reading across loads and resets', () => {
    const store = createPlaybackStore();
    expect(store.getState().counters).toBeNull();
    expect(store.getState().native).toBeNull();
    store.getState().setNative({ status: 'running' });
    const program = parsePattern('c(a|o)t', '');
    const { trace, result } = runBacktrack(program, 'the cot');
    store.getState().load({ program, trace, layout: layout(program), result });
    expect(store.getState().counters?.steps.length).toBe(trace.length + 1);
    expect(store.getState().native).toEqual({ status: 'running' });
    store.getState().setNative({ status: 'success', elapsedMs: 0.42, matched: true });
    store.getState().reset();
    expect(store.getState().counters).toBeNull();
    expect(store.getState().native).toEqual({ status: 'success', elapsedMs: 0.42, matched: true });
    store.getState().setNative(null);
    expect(store.getState().native).toBeNull();
  });
});
