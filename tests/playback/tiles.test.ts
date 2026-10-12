import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { tileStatus } from '../../src/playback/tiles.ts';
import { PRESETS } from '../../src/presets.ts';

/** Lit tiles (consumed or head) for a state's full input: the visual "claimed" range. */
function litRange(head: number, attemptStart: number, length: number): number[] {
  const out: number[] = [];
  if (attemptStart < 0) return out;
  for (let i = Math.max(0, attemptStart); i < Math.min(head + 1, length); i++) out.push(i);
  return out;
}

describe('playback tile statuses', () => {
  it('idle state lights nothing', () => {
    const prog = parsePattern('c(a|o)t', '');
    const { trace } = runBacktrack(prog, 'the cot');
    const idle = new TraceCursor(prog, trace).stateAt(0);
    expect(idle.attemptStart).toBe(-1);
    for (let i = 0; i < 7; i++) expect(tileStatus(idle, i)).toBe('pending');
  });

  it('consumed span is exactly [attemptStart, head) on every event of presets 1-5', () => {
    for (const preset of PRESETS.filter((p) => p.number <= 5)) {
      const prog = parsePattern(preset.pattern, preset.flags);
      const { trace } = runBacktrack(prog, preset.input);
      const cursor = new TraceCursor(prog, trace);
      for (let e = 0; e <= trace.length; e++) {
        const m = cursor.stateAt(e);
        if (m.phase === 'matched' && m.match) {
          for (let i = 0; i < preset.input.length; i++) {
            const inMatch = i >= m.match.start && i < m.match.end;
            expect(tileStatus(m, i), `${preset.id} e=${e} i=${i}`).toBe(inMatch ? (i === m.head ? 'head' : 'consumed') : 'pending');
          }
          continue;
        }
        for (let i = 0; i < preset.input.length; i++) {
          const lit = litRange(m.head, m.attemptStart, preset.input.length);
          const want = lit.includes(i) ? (i === m.head ? 'head' : 'consumed') : 'pending';
          expect(tileStatus(m, i), `${preset.id} e=${e} i=${i}`).toBe(want);
        }
      }
    }
  });

  it('head marker sits on the read head, never past the input end', () => {
    const prog = parsePattern('ab', '');
    const { trace } = runBacktrack(prog, 'xab');
    const cursor = new TraceCursor(prog, trace);
    for (let e = 0; e <= trace.length; e++) {
      const m = cursor.stateAt(e);
      expect(m.head).toBeLessThanOrEqual(3);
      for (let i = 0; i < 3; i++) {
        if (tileStatus(m, i) === 'head') expect(i).toBe(Math.min(m.head, 2));
      }
    }
  });

  it('backtracking un-lights tiles that the head retreats past', () => {
    // 'a+b' on 'aac': the greedy loop claims both a's (tile 1 consumed), then unwinds so the
    // head retreats to 1 — tile 1 drops from consumed to the live head marker — before the
    // attempt restarts at 1. Later attempts reset attemptStart, clearing stale highlights.
    const prog = parsePattern('a+b', '');
    const { trace } = runBacktrack(prog, 'aac');
    const cursor = new TraceCursor(prog, trace);
    const states: ReturnType<typeof cursor.stateAt>[] = [];
    for (let e = 0; e <= trace.length; e++) states.push(cursor.stateAt(e));
    const claimed = states.findIndex((m) => m.head >= 2 && tileStatus(m, 1) === 'consumed');
    expect(claimed).toBeGreaterThanOrEqual(0);
    const unwound = states.findIndex(
      (m, i) => i > claimed && m.attemptStart === 0 && m.head <= 1 && tileStatus(m, 1) === 'head',
    );
    expect(unwound).toBeGreaterThan(claimed);
    expect(states[unwound].phase).toBe('running');
  });

  it('scrubbing backward through every event reproduces forward statuses (no drift)', () => {
    for (const preset of PRESETS.filter((p) => p.number <= 5)) {
      const prog = parsePattern(preset.pattern, preset.flags);
      const { trace } = runBacktrack(prog, preset.input);
      const cursor = new TraceCursor(prog, trace);
      const forward: string[] = [];
      for (let e = 0; e <= trace.length; e++) {
        const m = cursor.stateAt(e);
        forward.push(Array.from({ length: preset.input.length }, (_, i) => tileStatus(m, i)[0]).join(''));
      }
      const backward: string[] = new Array(forward.length);
      for (let e = trace.length; e >= 0; e--) {
        const m = cursor.stateAt(e);
        backward[e] = Array.from({ length: preset.input.length }, (_, i) => tileStatus(m, i)[0]).join('');
      }
      expect(backward, preset.id).toEqual(forward);
    }
  });

  it('match span stays lit after matched (head marks the span end)', () => {
    const prog = parsePattern('ab', '');
    const { trace } = runBacktrack(prog, 'xab');
    const cursor = new TraceCursor(prog, trace);
    const end = cursor.stateAt(trace.length);
    expect(end.phase).toBe('matched');
    expect(end.match).toEqual({ start: 1, end: 3 });
    expect(tileStatus(end, 0)).toBe('pending');
    // head sits one past the last matched char; the span stays consumed.
    expect(tileStatus(end, 1)).toBe('consumed');
    expect(tileStatus(end, 2)).toBe('consumed');
    expect(end.head).toBe(3);
  });
});
