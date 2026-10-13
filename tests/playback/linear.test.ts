import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { PikeEvent, runPike } from '../../src/engine/pikevm.ts';
import { buildLinearRun, linearEligibility, liveThreadIds, tickAtPosition } from '../../src/playback/linear.ts';
import { PRESETS } from '../../src/presets.ts';

function run(pattern: string, input: string, flags = '') {
  const program = parsePattern(pattern, flags);
  const { trace, result } = runPike(program, input);
  return { program, trace, result, linear: buildLinearRun(program, trace, result) };
}

const REGULAR = PRESETS.filter((p) => ![4, 5].includes(p.number));

describe('linear-time playback model (M7)', () => {
  it('accepts regular presets and rejects backreferences and lookarounds with a span', () => {
    for (const preset of REGULAR) {
      expect(linearEligibility(parsePattern(preset.pattern, preset.flags)), preset.id).toEqual({ ok: true });
    }
    for (const preset of PRESETS.filter((p) => [4, 5].includes(p.number))) {
      const program = parsePattern(preset.pattern, preset.flags);
      const verdict = linearEligibility(program);
      expect(verdict.ok, preset.id).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason).toBe('feature');
        expect(verdict.span[1]).toBeGreaterThan(verdict.span[0]);
        expect(preset.pattern.slice(verdict.span[0], verdict.span[1])).toMatch(/^(\\1|\(\?=)/);
        expect(verdict.message).toContain('RE2');
      }
    }
    const huge = linearEligibility(parsePattern('a{60000}', ''));
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.reason).toBe('complexity');
  });

  it('folds the trace into one tick per visited position with a forward-only head', () => {
    const { linear, trace } = run('c(a|o)t', 'the cot');
    const positions = [...new Set(trace.positions)];
    expect(linear.ticks.map((t) => t.pos)).toEqual(positions);
    expect(linear.ticks.map((t) => t.index)).toEqual(positions.map((_, i) => i));
    for (let i = 1; i < linear.ticks.length; i++) expect(linear.ticks[i].pos).toBeGreaterThan(linear.ticks[i - 1].pos);
    expect(linear.matched).toBe(true);
    expect(linear.index).toBe(4);
    expect(linear.end).toBe(7);
    expect(linear.ticks.filter((t) => t.attempt).length).toBe(linear.attempts);
  });

  it('threads split at a fork, carry their parent, and merge or die so the count never exceeds maxThreads', () => {
    const { linear, result } = run('(?:a|a)*b', 'aaab');
    const widest = Math.max(...linear.ticks.map((t) => t.threads.length));
    expect(widest).toBe(result.maxThreads);
    const births = linear.ticks.flatMap((t) => t.births);
    expect(births.some((b) => b.parent >= 0)).toBe(true);
    expect(linear.ticks.some((t) => t.merges.length > 0)).toBe(true);
    const ids = new Set(births.map((b) => b.id));
    for (const tick of linear.ticks) {
      for (const thread of tick.threads) {
        expect(ids.has(thread.id)).toBe(true);
        expect(thread.parent).toBe(births.find((b) => b.id === thread.id)!.parent);
      }
      for (const merge of tick.merges) expect(ids.has(merge.into)).toBe(true);
      for (const id of tick.deaths) expect(ids.has(id)).toBe(true);
      expect(new Set(liveThreadIds(tick)).size).toBe(tick.threads.length);
    }
  });

  it('marks accepting ticks and counts one character test per live non-accepting thread', () => {
    const { linear, trace } = run('a+', 'aaa');
    const accepting = linear.ticks.filter((t) => t.accepting);
    expect(accepting.length).toBeGreaterThan(0);
    expect(accepting.at(-1)!.pos).toBe(linear.end);
    let running = 0;
    for (const tick of linear.ticks) {
      expect(tick.tests).toBe(tick.threads.filter((t) => !t.accepting).length);
      running += tick.tests;
      expect(tick.cumulativeTests).toBe(running);
    }
    const liveRows = Array.from(trace.t).filter((t) => t === PikeEvent.live).length;
    expect(linear.ticks.reduce((sum, t) => sum + t.threads.length, 0)).toBe(liveRows);
  });

  it('the linear side takes far fewer steps than backtracking on the evil regex', () => {
    const evil = PRESETS.find((p) => p.number === 6)!;
    const program = parsePattern(evil.pattern, evil.flags);
    const pike = runPike(program, evil.input);
    const linear = buildLinearRun(program, pike.trace, pike.result);
    const back = runBacktrack(program, evil.input, { wallMs: 2500, maxSteps: 20_000_000 });
    expect(linear.matched).toBe(false);
    expect(linear.gaveUp).toBe(false);
    expect(linear.truncated).toBe(false);
    expect(linear.ticks.at(-1)!.pos).toBe(evil.input.length);
    expect(back.result.steps / linear.steps).toBeGreaterThan(1000);
    const head = linear.ticks.map((t) => t.pos);
    expect(head).toEqual([...head].sort((a, b) => a - b));
  });

  it('looks up the tick for an input position, including positions skipped by surrogate pairs', () => {
    const { linear } = run('.+', '😀a', 'u');
    expect(linear.ticks.map((t) => t.pos)).toEqual([0, 2, 3]);
    expect(tickAtPosition(linear, -1)).toBeNull();
    expect(tickAtPosition(linear, 0)!.pos).toBe(0);
    expect(tickAtPosition(linear, 1)!.pos).toBe(0);
    expect(tickAtPosition(linear, 2)!.pos).toBe(2);
    expect(tickAtPosition(linear, 99)!.pos).toBe(3);
  });

  it('keeps a truncated trace usable and reports engine totals from the result', () => {
    const program = parsePattern('(?:a|a)*b', '');
    const { trace, result } = runPike(program, 'aaab', { traceBudget: 6 });
    const linear = buildLinearRun(program, trace, result);
    expect(linear.truncated).toBe(true);
    expect(linear.steps).toBe(result.steps);
    expect(linear.ticks.length).toBeGreaterThan(0);
    expect(linear.ticks.length).toBeLessThanOrEqual(6);
  });
});

describe('side-by-side synchronisation (M7 steps 4-7)', () => {
  it('the head waterline never decreases and equals the running max of the reconstructed head', async () => {
    const { buildCounters, waterlineAt } = await import('../../src/playback/counters.ts');
    const { TraceCursor } = await import('../../src/playback/state.ts');
    for (const preset of PRESETS.filter((p) => p.number <= 5)) {
      const program = parsePattern(preset.pattern, preset.flags);
      const { trace } = runBacktrack(program, preset.input);
      const counters = buildCounters(trace);
      const cursor = new TraceCursor(program, trace);
      let high = 0;
      expect(waterlineAt(counters, -1)).toBe(0);
      for (let i = 0; i < trace.length; i++) {
        high = Math.max(high, cursor.stateAt(i + 1).head);
        expect(waterlineAt(counters, i), `${preset.id} @${i}`).toBe(high);
        if (i > 0) expect(waterlineAt(counters, i)).toBeGreaterThanOrEqual(waterlineAt(counters, i - 1));
      }
    }
  });

  it('the linear side follows the waterline forward only and snaps to its last tick when the left finishes', async () => {
    const { syncLinear } = await import('../../src/playback/linear.ts');
    const { buildCounters, waterlineAt } = await import('../../src/playback/counters.ts');
    const greedy = PRESETS.find((p) => p.id === 'greedy')!;
    const program = parsePattern(greedy.pattern, greedy.flags);
    const back = runBacktrack(program, greedy.input);
    const counters = buildCounters(back.trace);
    const { linear } = run(greedy.pattern, greedy.input);
    let previous = -1;
    for (let i = -1; i < back.trace.length; i++) {
      const sync = syncLinear(linear, waterlineAt(counters, i), false);
      expect(sync.tick).not.toBeNull();
      expect(sync.tick!.pos).toBeGreaterThanOrEqual(previous);
      expect(sync.tick!.pos).toBeLessThanOrEqual(Math.max(0, waterlineAt(counters, i)));
      previous = sync.tick!.pos;
    }
    const end = syncLinear(linear, 0, true);
    expect(end.finished).toBe(true);
    expect(end.tick).toBe(linear.ticks.at(-1));
    expect(syncLinear({ ...linear, ticks: [] }, 3, false)).toEqual({ tick: null, finished: true });
  });

  it('places one marble per live thread on its gate, accepting threads in the cup, and fans out shared spots', async () => {
    const { parallelMarbles } = await import('../../src/playback/linear.ts');
    const { layout } = await import('../../src/layout/layout.ts');
    const { program, linear } = run('(?:a|a)*b', 'aaab');
    const machine = layout(program);
    for (const tick of linear.ticks) {
      const marbles = parallelMarbles(machine, tick);
      expect(marbles.length).toBe(tick.threads.length);
      expect(new Set(marbles.map((m) => `${m.position.x},${m.position.y},${m.position.z}`)).size).toBe(marbles.length);
      for (const marble of marbles) {
        const thread = tick.threads.find((t) => t.id === marble.id)!;
        expect(marble.parent).toBe(thread.parent);
        expect(marble.accepting).toBe(thread.accepting);
      }
    }
    const last = linear.ticks.at(-1)!;
    const cup = machine.pieces.find((p) => p.kind === 'cup')!;
    const accepted = parallelMarbles(machine, last).filter((m) => m.accepting);
    expect(accepted.length).toBeGreaterThan(0);
    for (const marble of accepted) expect(marble.position.z).toBe(cup.position.z);
    expect(parallelMarbles(machine, null)).toEqual([]);
  });

  it('split placement puts the boards apart with a shared framing that spans both', async () => {
    const { displayMetrics, splitPlacement, SPLIT_GAP } = await import('../../src/scene/geometry.ts');
    const { layout } = await import('../../src/layout/layout.ts');
    const machine = layout(parsePattern('^(a+)+$', ''));
    const left = displayMetrics(machine, { flood: true });
    const right = displayMetrics(machine);
    const placement = splitPlacement(left, right);
    expect(placement.rightX - placement.leftX).toBeCloseTo(left.boardWidth / 2 + SPLIT_GAP + right.boardWidth / 2);
    expect(placement.leftX - left.boardWidth / 2).toBeCloseTo(-(placement.rightX + right.boardWidth / 2));
    expect(placement.framing.boardWidth).toBeCloseTo(left.boardWidth + SPLIT_GAP + right.boardWidth);
    expect(placement.framing.tank).toBeNull();
    expect(placement.framing.height).toBe(left.height);
  });
});
