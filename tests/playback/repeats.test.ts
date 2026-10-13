import { describe, expect, it } from 'vitest';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { T, type Trace } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import { DIAL_SHIFT, repeatMarkers } from '../../src/playback/repeats.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { createPlaybackStore } from '../../src/playback/store.ts';
import { PRESETS } from '../../src/presets.ts';

function build(pattern: string, input: string, flags = '') {
  const program = parsePattern(pattern, flags);
  const { trace, result } = runBacktrack(program, input);
  const machine = layout(program);
  const cursor = new TraceCursor(program, trace);
  const repeats = program.nodes.filter((node) => node.kind === 'repeat');
  const markers = (index: number) => repeatMarkers(program, machine, cursor.stateAt(index));
  return { program, trace, result, machine, cursor, repeats, markers };
}

function events(trace: Trace, type: T, node?: number): number[] {
  return Array.from(trace.t).flatMap((t, i) => t === type && (node === undefined || trace.a[i] === node) ? [i] : []);
}

describe('repeat playback (Step 12)', () => {
  it('describes idle visible loops without a choice, with a dial beside the diverter', () => {
    const b = build('<.+>', '<b>bold</b>');
    const [rep] = b.repeats;
    const markers = repeatMarkers(b.program, b.machine, null);
    expect(markers).toHaveLength(1);
    const diverter = b.machine.anchors[rep.id].diverter!;
    expect(markers[0]).toEqual({
      node: rep.id,
      position: { ...diverter, z: diverter.z + 0.32 },
      dial: { x: diverter.x + DIAL_SHIFT.x, y: diverter.y + DIAL_SHIFT.y, z: diverter.z + DIAL_SHIFT.z },
      choice: null,
      angle: null,
      count: 0,
      greedy: true,
      min: 1,
      max: Infinity,
      saved: { again: 0, exit: 0 },
    });
    expect(b.markers(0)).toEqual(markers);
    expect(repeatMarkers(b.program, b.machine, b.cursor.stateAt(0))).toEqual(markers);
    const plain = build('a|b', 'a');
    expect(plain.markers(plain.trace.length)).toEqual([]);
  });

  it('greedy loop chooses again, counts iterations and flips to exit on each backtrack', () => {
    const b = build('<.+>', '<b>bold</b>');
    const rep = b.repeats[0].id;
    const chooses = events(b.trace, T.choose, rep);
    const iters = events(b.trace, T.iter, rep);
    const pops = events(b.trace, T.backtrack, rep);
    expect(chooses.length).toBeGreaterThan(1);
    expect(pops.length).toBeGreaterThan(0);
    expect(iters[0]).toBeLessThan(chooses[0]);
    expect(b.cursor.stateAt(iters[0]).loops.has(rep)).toBe(false);
    expect(b.markers(iters[0])[0]).toMatchObject({ choice: null, angle: null, count: 0 });
    for (const i of chooses) {
      expect(b.trace.b[i]).toBe(1);
      expect(b.cursor.stateAt(i + 1).loops.get(rep)).toBe('again');
      expect(b.markers(i + 1)[0]).toMatchObject({ choice: 'again', saved: { again: 0, exit: expect.any(Number) } });
      expect(b.markers(i + 1)[0].saved.exit).toBeGreaterThan(0);
    }
    iters.forEach((i, n) => {
      expect(b.trace.b[i]).toBe(n + 1);
      const state = b.cursor.stateAt(i + 1);
      expect(state.loops.get(rep)).toBe('again');
      expect(state.counters.get(rep)).toBe(n + 1);
      expect(b.markers(i + 1)[0].count).toBe(n + 1);
    });
    for (const i of pops) {
      expect(b.trace.b[i]).toBe(1);
      const state = b.cursor.stateAt(i + 1);
      expect(state.loops.get(rep)).toBe('exit');
      const choose = chooses.find((c) => b.trace.c[c] === b.trace.c[i])!;
      expect(state.counters).toEqual(b.cursor.stateAt(choose).counters);
      expect(b.markers(i + 1)[0]).toMatchObject({ choice: 'exit', count: b.cursor.stateAt(choose).counters.get(rep) });
    }
    const first = b.markers(chooses[0] + 1)[0];
    const retreat = b.markers(pops[0] + 1)[0];
    expect(first.angle).not.toBeNull();
    expect(retreat.angle).not.toBeNull();
    expect(first.angle).not.toBe(retreat.angle);
    expect(b.result.matched).toBe(true);
    expect(b.result.end).toBe('<b>bold</b>'.length);
  });

  it('lazy loop chooses exit first and swings to again when the continuation fails', () => {
    const b = build('<.+?>', '<bb>bold</b>');
    const rep = b.repeats[0].id;
    const [choose] = events(b.trace, T.choose, rep);
    const [pop] = events(b.trace, T.backtrack, rep);
    expect(b.trace.b[choose]).toBe(0);
    expect(b.trace.b[pop]).toBe(0);
    expect(pop).toBeGreaterThan(choose);
    expect(b.markers(choose + 1)[0]).toMatchObject({ choice: 'exit', count: 1, greedy: false, saved: { again: 1, exit: 0 } });
    expect(b.markers(pop + 1)[0]).toMatchObject({ choice: 'again', count: 1, saved: { again: 0, exit: 0 } });
    const iter = events(b.trace, T.iter, rep).find((i) => i > pop)!;
    expect(b.markers(iter + 1)[0]).toMatchObject({ choice: 'again', count: 2 });
    expect(b.markers(choose + 1)[0].angle).not.toBe(b.markers(pop + 1)[0].angle);
    expect(b.markers(b.trace.length)[0]).toMatchObject({ choice: 'exit', count: 2, saved: { again: 1, exit: 0 } });
    expect(b.result.end).toBe(4);
  });

  it('exit pointer uses the bypass chute direction and again pointer the body entry', () => {
    for (const pattern of ['<.+>', '<.+?>']) {
      const b = build(pattern, '<bb>bold</b>');
      const rep = b.repeats[0];
      const anchor = b.machine.anchors[rep.id];
      const diverter = anchor.diverter!;
      const body = b.machine.graph.points[b.machine.anchors[rep.body.id].entry].position;
      const bypass = b.machine.pieces.find((piece) => piece.kind === 'bypassChute' && piece.node === rep.id)!;
      const target = bypass.points![1];
      const again = Math.atan2(body.x - diverter.x, diverter.y - body.y);
      const exit = Math.atan2(target.x - diverter.x, diverter.y - target.y);
      const chooses = events(b.trace, T.choose, rep.id);
      const pops = events(b.trace, T.backtrack, rep.id);
      const greedy = rep.greedy;
      expect(b.markers(chooses[0] + 1)[0].angle).toBeCloseTo(greedy ? again : exit);
      expect(b.markers(pops[0] + 1)[0].angle).toBeCloseTo(greedy ? exit : again);
      expect(Math.abs(exit)).toBeGreaterThan(Math.abs(again));
    }
  });

  it('optional quantifier keeps its last choice after a silent forced exit', () => {
    const b = build('colou?r', 'my color');
    const rep = b.repeats[0].id;
    const [choose] = events(b.trace, T.choose, rep);
    const [pop] = events(b.trace, T.backtrack, rep);
    expect(b.trace.b[choose]).toBe(1);
    expect(b.markers(choose + 1)[0]).toMatchObject({ choice: 'again', count: 0, min: 0, max: 1 });
    const iter = events(b.trace, T.iter, rep)[0];
    expect(iter).toBeGreaterThan(choose);
    expect(b.markers(iter + 1)[0]).toMatchObject({ choice: 'again', count: 1 });
    expect(b.markers(pop + 1)[0]).toMatchObject({ choice: 'exit', count: 0, saved: { again: 0, exit: 0 } });
    expect(b.markers(b.trace.length)[0]).toMatchObject({ choice: 'exit', count: 0 });
    expect(b.result.matched).toBe(true);
  });

  it('bounded loops without choice points still turn the dial via iteration events', () => {
    const b = build('a{3}', 'aaa');
    const rep = b.repeats[0].id;
    expect(events(b.trace, T.choose, rep)).toEqual([]);
    const iters = events(b.trace, T.iter, rep);
    expect(iters.map((i) => b.trace.b[i])).toEqual([1, 2, 3]);
    expect(b.markers(iters[0]).at(0)).toMatchObject({ choice: null, angle: null, count: 0 });
    iters.forEach((i, n) => expect(b.markers(i + 1)[0]).toMatchObject({ choice: 'again', count: n + 1, saved: { again: 0, exit: 0 } }));
    expect(b.markers(b.trace.length)[0]).toMatchObject({ choice: 'again', count: 3, min: 3, max: 3 });
  });

  it('nested catastrophic loops roll inner choice and count back to the saved snapshot', () => {
    const b = build('^(a+)+$', 'aaa!');
    const [outer, inner] = b.repeats;
    expect(b.result.matched).toBe(false);
    for (const node of [outer.id, inner.id]) {
      const pops = events(b.trace, T.backtrack, node);
      expect(pops.length).toBeGreaterThan(0);
      for (const pop of pops) {
        const state = b.cursor.stateAt(pop + 1);
        const before = b.cursor.stateAt(pop);
        const popped = before.flags.at(-1)!;
        expect(popped.node).toBe(node);
        const choose = events(b.trace, T.choose, node).filter((c) => c < pop).reverse()
          .find((c) => b.cursor.stateAt(c + 1).flags.length === before.flags.length && b.trace.c[c] === popped.pos)!;
        const saved = b.cursor.stateAt(choose);
        expect(state.counters).toEqual(saved.counters);
        expect(state.loops).toEqual(new Map([...saved.loops, [node, 'exit']]));
        expect(state.flags).toEqual(saved.flags);
      }
    }
    const final = b.cursor.stateAt(b.trace.length);
    expect(final.phase).toBe('nomatch');
    expect(final.loops).toEqual(new Map());
    expect(b.markers(b.trace.length).every((marker) => marker.choice === null && marker.saved.exit === 0)).toBe(true);
  });

  it('counts saved loop fallbacks per direction from the flag stack', () => {
    const b = build('^(a+)+$', 'aaa!');
    const [outer, inner] = b.repeats;
    const deepest = Array.from({ length: b.trace.length + 1 }, (_, i) => i)
      .reduce((best, i) => (b.cursor.stateAt(i).flags.length > b.cursor.stateAt(best).flags.length ? i : best), 0);
    const state = b.cursor.stateAt(deepest);
    const markers = b.markers(deepest);
    for (const node of [outer.id, inner.id]) {
      const flags = state.flags.filter((flag) => flag.node === node);
      expect(markers.find((marker) => marker.node === node)!.saved).toEqual({
        again: flags.filter((flag) => flag.option === 0).length,
        exit: flags.filter((flag) => flag.option === 1).length,
      });
    }
    expect(markers.reduce((sum, marker) => sum + marker.saved.again + marker.saved.exit, 0)).toBe(state.flags.length);
  });

  it('clears loop choices on each new attempt and keeps them on match', () => {
    const b = build('a+b', 'xaab');
    const rep = b.repeats[0].id;
    const attempts = events(b.trace, T.attempt);
    expect(attempts.length).toBeGreaterThan(1);
    for (const attempt of attempts) {
      expect(b.cursor.stateAt(attempt + 1).loops).toEqual(new Map());
      expect(b.cursor.stateAt(attempt + 1).counters).toEqual(new Map());
      expect(b.markers(attempt + 1)[0]).toMatchObject({ choice: null, count: 0 });
    }
    const [match] = events(b.trace, T.match);
    expect(match).toBe(b.trace.length - 1);
    expect(b.cursor.stateAt(match + 1).loops).toEqual(b.cursor.stateAt(match).loops);
    expect(b.cursor.stateAt(match + 1).loops.get(rep)).toBe('exit');
    expect(b.markers(match + 1)[0]).toMatchObject({ choice: 'exit', count: 2 });
  });

  it.each([
    { assertion: '=', input: 'aab', ok: 1 },
    { assertion: '=', input: 'xb', ok: 0 },
    { assertion: '!', input: 'xb', ok: 1 },
    { assertion: '!', input: 'aab', ok: 0 },
  ])('restores pre-look loop choices when (?$assertion a+) completes on $input', ({ assertion, input, ok }) => {
    const b = build(`b*(?${assertion}a+)`, input, 'y');
    const [prefix, scout] = b.repeats;
    const [start, end] = events(b.trace, T.look);
    expect(b.trace.c[end]).toBe(ok);
    const before = b.cursor.stateAt(start);
    const during = b.cursor.stateAt(end);
    const after = b.cursor.stateAt(end + 1);
    expect(before.loops.has(scout.id)).toBe(false);
    expect(during.loops.get(scout.id)).toBe(input.startsWith('a') ? 'exit' : 'again');
    expect(after.loops).toEqual(before.loops);
    expect(after.loops.get(prefix.id)).toBe(before.loops.get(prefix.id));
    expect(b.markers(end + 1).find((marker) => marker.node === scout.id)).toMatchObject({ choice: null, angle: null });
  });

  it('skips loops hidden inside collapsed modules and reveals their retained state on expansion', () => {
    const pattern = `a+(${'b+c'.repeat(22)})(${'b+c'.repeat(22)})`;
    const input = `a${'bc'.repeat(44)}`;
    const program = parsePattern(pattern, '');
    expect(program.leafCount).toBeGreaterThanOrEqual(85);
    const collapsed = layout(program);
    const modules = collapsed.pieces.filter((piece) => piece.kind === 'module');
    expect(modules).toHaveLength(2);
    const hidden = new Set(modules.flatMap((piece) => piece.containedNodes ?? []));
    const { trace, result } = runBacktrack(program, input);
    expect(result.matched).toBe(true);
    const cursor = new TraceCursor(program, trace);
    const final = cursor.stateAt(trace.length);
    const visible = repeatMarkers(program, collapsed, final);
    expect(visible.some((marker) => hidden.has(marker.node))).toBe(false);
    expect(visible.map((marker) => marker.node)).toEqual([program.nodes.find((node) => node.kind === 'repeat')!.id]);
    const expanded = layout(program, { expandedModules: modules.map((piece) => piece.node!) });
    const all = repeatMarkers(program, expanded, final);
    expect(all).toHaveLength(45);
    const inner = all.filter((marker) => hidden.has(marker.node));
    expect(inner).toHaveLength(44);
    expect(inner.every((marker) => marker.count === 1 && marker.choice === 'exit')).toBe(true);
  });

  it('keyframed and unkeyframed cursors agree on loops and counters for presets 1-5 and evil loops', () => {
    const cases = [...PRESETS.filter((preset) => preset.number <= 5).map((preset) => [preset.pattern, preset.input, preset.flags] as const), ['^(a+)+$', 'aaaa!', ''] as const];
    for (const [pattern, input, flags] of cases) {
      const program = parsePattern(pattern, flags);
      const { trace } = runBacktrack(program, input);
      const dense = new TraceCursor(program, trace, 2);
      const plain = new TraceCursor(program, trace, Infinity);
      for (let i = 0; i <= trace.length; i++) {
        const a = dense.stateAt(i);
        const c = plain.stateAt(i);
        expect(a.loops).toEqual(c.loops);
        expect(a.gates).toEqual(c.gates);
        expect(a.counters).toEqual(c.counters);
      }
    }
  });

  it('exposes isolated loop maps so callers cannot corrupt later seeks', () => {
    const b = build('<.+>', '<b>bold</b>');
    const i = events(b.trace, T.iter, b.repeats[0].id)[1] + 1;
    const first = b.cursor.stateAt(i);
    const sibling = b.cursor.stateAt(i);
    expect(first.loops).not.toBe(sibling.loops);
    first.loops.clear();
    first.loops.set(-1, 'exit');
    expect(b.cursor.stateAt(i).loops).toEqual(sibling.loops);
    const store = createPlaybackStore();
    store.getState().load({ program: b.program, trace: b.trace, layout: b.machine });
    store.getState().seekEvent(i - 1);
    store.getState().machine!.loops.clear();
    store.getState().stepForward();
    store.getState().stepBack();
    expect(store.getState().machine!.loops).toEqual(sibling.loops);
  });

  it('stepping backward through the store reproduces every forward repeat marker', () => {
    const b = build('<.+>', '<b>bold</b>');
    const store = createPlaybackStore();
    store.getState().load({ program: b.program, trace: b.trace, layout: b.machine });
    const forward: string[] = [];
    for (let i = 0; i < b.trace.length; i++) {
      store.getState().seekEvent(i);
      forward.push(JSON.stringify(repeatMarkers(b.program, b.machine, store.getState().machine)));
    }
    expect(new Set(forward).size).toBeGreaterThan(3);
    for (let i = b.trace.length - 1; i >= 0; i--) {
      store.getState().seekEvent(i);
      expect(JSON.stringify(repeatMarkers(b.program, b.machine, store.getState().machine))).toBe(forward[i]);
    }
  });
});
