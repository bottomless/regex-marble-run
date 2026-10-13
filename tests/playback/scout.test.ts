import { describe, expect, it } from 'vitest';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { T, type Trace } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import { scoutHome, scoutPose, scoutStops, scoutTiles, scoutWindow } from '../../src/playback/scout.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { createPlaybackStore } from '../../src/playback/store.ts';
import { PRESETS } from '../../src/presets.ts';

function build(pattern: string, input: string, flags = '') {
  const program = parsePattern(pattern, flags);
  const { trace, result } = runBacktrack(program, input);
  const machine = layout(program);
  const cursor = new TraceCursor(program, trace);
  const windowAt = (index: number) => scoutWindow(cursor.stateAt(index));
  const look = program.nodes.find((node) => node.kind === 'look')!;
  return { program, trace, result, machine, cursor, windowAt, look };
}

function events(trace: Trace, type: T, node?: number): number[] {
  return Array.from(trace.t).flatMap((t, i) => t === type && (node === undefined || trace.a[i] === node) ? [i] : []);
}

describe('lookahead scout (Step 14)', () => {
  it('opens a window at the look start, records reads, and closes it after the return trip', () => {
    const b = build('c(?=o)ot', 'cot');
    const inner = b.look.body.id;
    const [start, end] = events(b.trace, T.look, b.look.id);
    const read = events(b.trace, T.test, inner)[0];
    expect(start).toBeLessThan(read);
    expect(read).toBeLessThan(end);
    expect(b.windowAt(start)).toBeNull();
    expect(b.windowAt(start + 1)).toEqual({ node: b.look.id, start, end: null, reads: [] });
    expect(b.windowAt(read + 1)).toEqual({
      node: b.look.id,
      start,
      end: null,
      reads: [{ node: inner, event: read, pos: 1, len: 1, ok: true }],
    });
    expect(b.windowAt(end)).toEqual(b.windowAt(read + 1));
    const closing = b.windowAt(end + 1)!;
    expect(closing).toMatchObject({
      node: b.look.id,
      start,
      end,
      reads: [{ node: inner, event: read, pos: 1, len: 1, ok: true }],
    });
    expect(b.windowAt(end + 2)).toBeNull();
    expect(b.result.matched).toBe(true);
  });

  it('records failed and zero-length reads and dedupes ghost tiles', () => {
    const b = build(String.raw`(?=aa\b)x?`, 'aa', 'y');
    const [, end] = events(b.trace, T.look, b.look.id);
    const closing = b.windowAt(end + 1)!;
    expect(closing.reads.map((read) => [read.pos, read.len, read.ok])).toEqual([
      [0, 1, true], [1, 1, true], [2, 0, true],
    ]);
    expect(scoutTiles(closing)).toEqual([0, 1]);
    const fail = build('(?=ac)b', 'ab', 'y');
    const [fend] = events(fail.trace, T.look).filter((i) => fail.trace.b[i] === 1);
    const fclosing = fail.windowAt(fend + 1)!;
    expect(fclosing.reads.map((read) => read.ok)).toEqual([true, false]);
    expect(scoutTiles(fclosing)).toEqual([0, 1]);
    expect(scoutTiles(null)).toEqual([]);
    expect(fail.windowAt(0)).toBeNull();
  });

  it('tracks only the innermost open look and unwinds nested scopes in order', () => {
    const b = build('^(?=a(?=b)b)ab', 'ab');
    const inner = b.program.nodes.find((node) => node.kind === 'look' && node.id !== b.look.id)!;
    const starts = events(b.trace, T.look).filter((i) => b.trace.b[i] === 0);
    const ends = events(b.trace, T.look).filter((i) => b.trace.b[i] === 1);
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    expect(b.trace.a[starts[0]]).toBe(b.look.id);
    expect(b.trace.a[starts[1]]).toBe(inner.id);
    expect(b.windowAt(starts[0] + 1)).toMatchObject({ node: b.look.id, end: null });
    expect(b.windowAt(starts[1] + 1)).toMatchObject({ node: inner.id, end: null });
    expect(b.windowAt(ends[0] + 1)).toMatchObject({ node: inner.id, end: ends[0] });
    expect(b.windowAt(ends[0] + 2)).toMatchObject({ node: b.look.id, end: null });
    expect(b.windowAt(ends[1] + 1)).toMatchObject({ node: b.look.id, end: ends[1] });
    expect(b.windowAt(ends[1] + 2)).toBeNull();
    expect(b.result.matched).toBe(true);
  });

  it('keeps negative-look reads and reports the assertion outcome on the closing frame', () => {
    const b = build('a(?!b)c', 'ac');
    const [start, end] = events(b.trace, T.look, b.look.id);
    const closing = b.windowAt(end + 1)!;
    expect(closing).toMatchObject({ node: b.look.id, start, end });
    expect(closing.reads.map((read) => read.ok)).toEqual([false]);
    expect(b.cursor.stateAt(end + 1).gates.get(b.look.id)).toBe('pass');
    const failing = build('a(?!b)c', 'ab');
    const [fend] = events(failing.trace, T.look).filter((i) => failing.trace.b[i] === 1);
    expect(failing.windowAt(fend + 1)!.reads.map((read) => read.ok)).toEqual([true]);
    expect(failing.cursor.stateAt(fend + 1).gates.get(failing.look.id)).toBe('reject');
  });

  it('clears open scouts on every new attempt and on nomatch', () => {
    const b = build('x(?=y)', 'yx');
    const attempts = events(b.trace, T.attempt);
    expect(attempts.length).toBeGreaterThan(1);
    const [open] = events(b.trace, T.look).filter((i) => b.trace.b[i] === 0);
    expect(b.windowAt(open + 1)).not.toBeNull();
    for (const attempt of attempts.slice(1)) {
      expect(b.cursor.stateAt(attempt + 1).scouts).toEqual([]);
      expect(b.cursor.stateAt(attempt + 1).scoutClosing).toBeNull();
    }
    const none = build('(?=z)a', 'a', 'y');
    const [end] = events(none.trace, T.nomatch);
    expect(none.cursor.stateAt(end + 1).scouts).toEqual([]);
    expect(none.cursor.stateAt(end + 1).scoutClosing).toBeNull();
  });

  it('poses the scout from home through each inner gate and back on the closing event', () => {
    const b = build('c(?=o)ot', 'cot');
    const inner = b.look.body.id;
    const [start, end] = events(b.trace, T.look, b.look.id);
    const read = events(b.trace, T.test, inner)[0];
    const closing = b.windowAt(end + 1)!;
    const home = scoutHome(b.machine, b.look.id)!;
    const gate = b.machine.anchors[inner].gate!;
    expect(scoutStops(b.machine, closing).map((stop) => stop.event)).toEqual([start, read, end, end + 1]);
    expect(scoutPose(b.machine, closing, start)).toEqual({ position: home, direction: null });
    const midway = scoutPose(b.machine, closing, (start + read) / 2)!;
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(midway.position[axis]).toBeCloseTo((home[axis] + gate[axis]) / 2);
    }
    expect(scoutPose(b.machine, closing, read)!.position).toEqual(gate);
    expect(scoutPose(b.machine, closing, end)).toEqual({ position: gate, direction: null });
    const returning = scoutPose(b.machine, closing, end + 0.5)!;
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(returning.position[axis]).toBeCloseTo((gate[axis] + home[axis]) / 2);
    }
    expect(scoutPose(b.machine, closing, end + 1)!.position).toEqual(home);
    expect(scoutPose(b.machine, closing, end + 5)).toEqual({ position: home, direction: null });
    const open = b.windowAt(read + 1)!;
    expect(scoutPose(b.machine, open, read + 0.75)).toEqual({ position: gate, direction: null });
  });

  it('keeps every scout pose finite and inside the machine bounds for presets 1-5', () => {
    for (const preset of PRESETS.filter((p) => p.number <= 5)) {
      const program = parsePattern(preset.pattern, preset.flags);
      const { trace } = runBacktrack(program, preset.input);
      const machine = layout(program);
      const cursor = new TraceCursor(program, trace);
      let seen = 0;
      for (let i = 0; i <= trace.length; i++) {
        const frame = scoutWindow(cursor.stateAt(i));
        if (!frame) continue;
        seen++;
        for (const fraction of [0, 0.25, 0.5, 1]) {
          const pose = scoutPose(machine, frame, i - 1 + fraction);
          expect(pose).not.toBeNull();
          for (const axis of ['x', 'y', 'z'] as const) {
            expect(Number.isFinite(pose!.position[axis])).toBe(true);
            expect(pose!.position[axis]).toBeGreaterThanOrEqual(machine.bounds.min[axis] - 4);
            expect(pose!.position[axis]).toBeLessThanOrEqual(machine.bounds.max[axis] + 4);
          }
        }
      }
      expect(seen).toBeGreaterThanOrEqual(0);
    }
  });

  it('reproduces scout windows and tiles exactly when stepping and scrubbing backward', () => {
    const b = build('(?=(a|b)+c)abc', 'abc');
    expect(b.result.matched).toBe(true);
    const store = createPlaybackStore();
    store.getState().load({ program: b.program, trace: b.trace, layout: b.machine });
    const forward: string[] = [];
    const tiles: string[] = [];
    for (let i = 0; i < b.trace.length; i++) {
      store.getState().seekEvent(i);
      const frame = scoutWindow(store.getState().machine);
      forward.push(JSON.stringify(frame));
      tiles.push(scoutTiles(frame).join(','));
    }
    expect(forward.filter((entry) => entry !== 'null').length).toBeGreaterThan(2);
    store.getState().seekEvent(b.trace.length - 1);
    for (let i = b.trace.length - 1; i >= 0; i--) {
      expect(store.getState().eventIndex).toBe(i);
      const frame = scoutWindow(store.getState().machine);
      expect(JSON.stringify(frame)).toBe(forward[i]);
      expect(scoutTiles(frame).join(',')).toBe(tiles[i]);
      store.getState().stepBack();
    }
    store.getState().restart();
    expect(scoutWindow(store.getState().machine)).toBeNull();
  });

  it('keyframed and unkeyframed cursors agree on scout frames', () => {
    const cases: [string, string][] = [
      ['(?=(a|b)+c)abc', 'abc'],
      ['^(?=.*\\d)(?=.*[a-z]).{8,}$', 'hunter22x'],
      ['^(?=a(?=b)b)ab', 'ab'],
    ];
    for (const [pattern, input] of cases) {
      const program = parsePattern(pattern, '');
      const { trace } = runBacktrack(program, input);
      const dense = new TraceCursor(program, trace, 2);
      const plain = new TraceCursor(program, trace, Infinity);
      for (let i = 0; i <= trace.length; i++) {
        expect(dense.stateAt(i).scouts).toEqual(plain.stateAt(i).scouts);
        expect(dense.stateAt(i).scoutClosing).toEqual(plain.stateAt(i).scoutClosing);
      }
    }
  });

  it('exposes isolated scout frames so callers cannot corrupt later seeks', () => {
    const b = build('c(?=o)ot', 'cot');
    const [, end] = events(b.trace, T.look);
    const first = b.cursor.stateAt(end + 1);
    const sibling = b.cursor.stateAt(end + 1);
    expect(first.scoutClosing).not.toBe(sibling.scoutClosing);
    first.scoutClosing!.reads.push({ node: -1, event: -1, pos: 99, len: 1, ok: true });
    first.scouts.push({ node: -2, start: 0, end: null, reads: [] });
    expect(b.cursor.stateAt(end + 1).scoutClosing!.reads).toHaveLength(sibling.scoutClosing!.reads.length);
    expect(b.cursor.stateAt(end + 1).scouts).toEqual(sibling.scouts);
  });
});
