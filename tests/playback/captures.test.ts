import { describe, expect, it } from 'vitest';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { T, type Trace } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import { captureBrackets, captureSpans, matchSpan, mirrorFaces, mirrorText } from '../../src/playback/captures.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { createPlaybackStore } from '../../src/playback/store.ts';
import { palette } from '../../src/scene/materials.ts';
import { PRESETS } from '../../src/presets.ts';

function build(pattern: string, input: string, flags = '') {
  const program = parsePattern(pattern, flags);
  const { trace, result } = runBacktrack(program, input);
  const machine = layout(program);
  const cursor = new TraceCursor(program, trace);
  return { program, trace, result, machine, cursor };
}

function events(trace: Trace, type: T, node?: number): number[] {
  return Array.from(trace.t).flatMap((t, i) => t === type && (node === undefined || trace.a[i] === node) ? [i] : []);
}

describe('captures, mirrors and celebration (Step 15)', () => {
  it('brackets appear when groups close and use the palette cycle with names', () => {
    const b = build(String.raw`(?<who>a)(b)`, 'ab');
    const closes = events(b.trace, T.capture);
    expect(closes.length).toBeGreaterThanOrEqual(2);
    expect(captureBrackets(b.program, b.cursor.stateAt(0))).toEqual([]);
    const first = events(b.trace, T.capture).find((i) => b.trace.a[i] === 1)!;
    expect(captureBrackets(b.program, b.cursor.stateAt(first + 1))).toEqual([
      { group: 1, name: 'who', start: 0, end: 1, color: palette.captures[0] },
    ]);
    const final = captureBrackets(b.program, b.cursor.stateAt(b.trace.length));
    expect(final).toEqual([
      { group: 1, name: 'who', start: 0, end: 1, color: palette.captures[0] },
      { group: 2, name: null, start: 1, end: 2, color: palette.captures[1] },
    ]);
    expect(captureSpans(b.cursor.stateAt(b.trace.length))).toEqual([
      { start: 0, end: 2 }, { start: 0, end: 1 }, { start: 1, end: 2 },
    ]);
    expect(captureSpans(null)).toEqual([]);
  });

  it('unsets brackets for groups reset by a new iteration and restores them on backtrack', () => {
    const b = build('(a)+', 'aa');
    const group = 1;
    const resets = events(b.trace, T.capture).filter((i) => b.trace.b[i] === -1);
    expect(resets.length).toBeGreaterThan(0);
    const before = b.cursor.stateAt(resets[0]);
    expect(before.captures[group]).toEqual({ start: 0, end: 1 });
    expect(captureBrackets(b.program, before)).toHaveLength(1);
    const after = b.cursor.stateAt(resets[0] + 1);
    expect(after.captures[group]).toBeNull();
    expect(captureBrackets(b.program, after)).toEqual([]);
    const pop = events(b.trace, T.backtrack)[0];
    expect(b.cursor.stateAt(pop + 1).captures[group]).toEqual({ start: 1, end: 2 });
    const final = captureBrackets(b.program, b.cursor.stateAt(b.trace.length));
    expect(final).toEqual([{ group: 1, name: null, start: 1, end: 2, color: palette.captures[0] }]);
  });

  it('clears brackets on each attempt and keeps the match span for the celebration only', () => {
    const b = build('a(b)', 'xab', '');
    const attempts = events(b.trace, T.attempt);
    expect(attempts.length).toBeGreaterThan(1);
    for (const attempt of attempts.slice(1)) {
      expect(captureBrackets(b.program, b.cursor.stateAt(attempt + 1))).toEqual([]);
      expect(matchSpan(b.cursor.stateAt(attempt + 1))).toBeNull();
    }
    const [match] = events(b.trace, T.match);
    expect(matchSpan(b.cursor.stateAt(match))).toBeNull();
    expect(matchSpan(b.cursor.stateAt(match + 1))).toEqual({ start: 1, end: 3 });
    const none = build('a(b)', 'x', 'y');
    const [end] = events(none.trace, T.nomatch);
    expect(matchSpan(none.cursor.stateAt(end + 1))).toBeNull();
    expect(captureBrackets(none.program, none.cursor.stateAt(end + 1))).toEqual([]);
  });

  it('mirror gates show the captured text live and empty before the group is set', () => {
    const b = build(String.raw`(\w)\1`, 'hello');
    const backref = b.program.nodes.find((node) => node.kind === 'backref')!.id;
    const mirror = b.machine.pieces.find((piece) => piece.kind === 'mirror')!;
    expect(mirror.node).toBe(backref);
    const open = events(b.trace, T.capture).find((i) => b.trace.a[i] === 1 && b.trace.b[i] >= 0)!;
    expect(mirrorText(b.program, b.cursor.stateAt(open), 'hello', backref)).toBe('');
    expect(mirrorText(b.program, b.cursor.stateAt(open + 1), 'hello', backref)).toBe('h');
    const faces = mirrorFaces(b.program, b.cursor.stateAt(open + 1), 'hello', [backref]);
    expect(faces).toEqual([{ node: backref, text: 'h' }]);
    const second = events(b.trace, T.capture).filter((i) => i > open && b.trace.a[i] === 1 && b.trace.b[i] >= 0).at(-1)!;
    expect(mirrorText(b.program, b.cursor.stateAt(second + 1), 'hello', backref)).toBe('l');
    expect(mirrorText(b.program, null, 'hello', backref)).toBe('');
    expect(mirrorText(b.program, b.cursor.stateAt(open + 1), 'hello', b.program.nodes.find((n) => n.kind === 'char')!.id)).toBe('');
  });

  it('resolves ambiguous duplicate names to the first set group and truncates long text', () => {
    const pattern = String.raw`^(?:(?<x>a)|(?<x>b{18}))\k<x>$`;
    const long = build(pattern, 'b'.repeat(36));
    const backref = long.program.nodes.find((node) => node.kind === 'backref')!.id;
    expect(long.result.matched).toBe(true);
    expect(mirrorText(long.program, long.cursor.stateAt(long.trace.length), 'b'.repeat(36), backref))
      .toBe('bbbbbbbbbbbb…');
    const short = build(pattern, 'aa');
    expect(short.result.matched).toBe(true);
    expect(mirrorText(short.program, short.cursor.stateAt(short.trace.length), 'aa', backref)).toBe('a');
  });

  it('keeps celebration and brackets stable through backward stepping for presets 1-5', () => {
    for (const preset of PRESETS.filter((p) => p.number <= 5)) {
      const b = build(preset.pattern, preset.input, preset.flags);
      const store = createPlaybackStore();
      store.getState().load({ program: b.program, trace: b.trace, layout: b.machine });
      const forward: string[] = [];
      const spans: string[] = [];
      const matches: string[] = [];
      for (let i = 0; i < b.trace.length; i++) {
        store.getState().seekEvent(i);
        const state = store.getState().machine;
        forward.push(JSON.stringify(captureBrackets(b.program, state)));
        spans.push(JSON.stringify(captureSpans(state)));
        matches.push(JSON.stringify(matchSpan(state)));
      }
      store.getState().seekEvent(b.trace.length - 1);
      for (let i = b.trace.length - 1; i >= 0; i--) {
        const state = store.getState().machine;
        expect(JSON.stringify(captureBrackets(b.program, state))).toBe(forward[i]);
        expect(JSON.stringify(captureSpans(state))).toBe(spans[i]);
        expect(JSON.stringify(matchSpan(state))).toBe(matches[i]);
        store.getState().stepBack();
      }
    }
  });

  it('exposes isolated capture arrays so callers cannot corrupt later seeks', () => {
    const b = build('(a)(b)', 'ab');
    const state = b.cursor.stateAt(b.trace.length);
    const sibling = b.cursor.stateAt(b.trace.length);
    expect(state.captures).not.toBe(sibling.captures);
    state.captures[1] = { start: 9, end: 9 };
    state.match!.end = 99;
    expect(b.cursor.stateAt(b.trace.length).captures[1]).toEqual(sibling.captures[1]);
    expect(matchSpan(b.cursor.stateAt(b.trace.length))).toEqual(sibling.match);
  });
});
