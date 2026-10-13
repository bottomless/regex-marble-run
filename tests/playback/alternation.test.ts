import { describe, expect, it } from 'vitest';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { walk } from '../../src/engine/ir.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { T, type Trace } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import { alternationMarkers } from '../../src/playback/alternation.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { createPlaybackStore } from '../../src/playback/store.ts';

function build(pattern: string, input: string, flags = '') {
  const program = parsePattern(pattern, flags);
  const { trace, result } = runBacktrack(program, input);
  const machine = layout(program);
  const cursor = new TraceCursor(program, trace);
  const alts = [...walk(program.root)].filter((node) => node.kind === 'alt');
  const markers = (index: number) => alternationMarkers(program, machine, cursor.stateAt(index));
  return { program, trace, result, machine, cursor, alts, markers };
}

function events(trace: Trace, type: T, node?: number): number[] {
  return Array.from(trace.t).flatMap((t, i) => t === type && (node === undefined || trace.a[i] === node) ? [i] : []);
}

function loaded(built: ReturnType<typeof build>) {
  const store = createPlaybackStore();
  store.getState().load({ program: built.program, trace: built.trace, layout: built.machine });
  return store;
}

describe('alternation playback (Step11)', () => {
  it('shows inactive visible alternatives without state and excludes repeat diverters', () => {
    const b = build('(a|b)+(c|d)', 'ac');
    const idle = b.cursor.stateAt(0);
    expect(idle.selectedBranches).toEqual(new Map());
    const markers = alternationMarkers(b.program, b.machine, null);
    expect(markers.map((marker) => marker.node).sort()).toEqual(b.alts.map((node) => node.id).sort());
    expect(b.markers(0)).toEqual(markers);
    for (const marker of markers) {
      const diverter = b.machine.anchors[marker.node].diverter!;
      expect(marker).toMatchObject({ position: { ...diverter, z: diverter.z + 0.32 }, activeBranch: null, angle: null });
      expect(marker.branches.map(({ option, selected, savedCount }) => ({ option, selected, savedCount }))).toEqual([
        { option: 0, selected: false, savedCount: 0 },
        { option: 1, selected: false, savedCount: 0 },
      ]);
    }
    const plain = build('a+', 'aa');
    expect(plain.markers(plain.trace.length)).toEqual([]);
  });

  it.each(['a', 'b'])('selects the binary branch for %s independently of the saved fallback', (input) => {
    const b = build('a|b', input);
    const node = b.alts[0].id;
    const [choose] = events(b.trace, T.choose, node);
    expect(choose).toBeGreaterThan(0);
    expect(b.cursor.stateAt(choose).selectedBranches.has(node)).toBe(false);
    expect(b.cursor.stateAt(choose + 1).selectedBranches).toEqual(new Map([[node, 0]]));
    expect(b.markers(choose + 1)[0].branches).toMatchObject([
      { selected: true, savedCount: 0 }, { selected: false, savedCount: 1 },
    ]);
    const pops = events(b.trace, T.backtrack, node);
    expect(pops).toHaveLength(input === 'a' ? 0 : 1);
    if (input === 'b') {
      expect(b.cursor.stateAt(pops[0] + 1).selectedBranches).toEqual(new Map([[node, 1]]));
      expect(b.markers(pops[0] + 1)[0].branches).toMatchObject([
        { selected: false, savedCount: 0 }, { selected: true, savedCount: 0 },
      ]);
    }
    expect(b.result.matched).toBe(true);
    expect(b.markers(b.trace.length)[0].activeBranch).toBe(input === 'a' ? 0 : 1);
  });

  it('selects 0, 1, 1, 2 for ternary choose/pop transitions without a duplicate flip', () => {
    const b = build('a|b|c', 'c');
    const node = b.alts[0].id;
    const transitions = Array.from(b.trace.t).flatMap((type, i) =>
      type === T.choose || type === T.backtrack ? [i] : [],
    );
    expect(transitions.map((i) => [b.trace.t[i], b.trace.a[i], b.trace.b[i]])).toEqual([
      [T.choose, node, 1], [T.backtrack, node, 1], [T.choose, node, 2], [T.backtrack, node, 2],
    ]);
    expect(transitions.map((i) => {
      const state = b.cursor.stateAt(i + 1);
      const marker = b.markers(i + 1)[0];
      expect(marker.activeBranch).toBe(state.selectedBranches.get(node));
      expect(marker.branches.filter((branch) => branch.selected).map((branch) => branch.option)).toEqual([marker.activeBranch]);
      return [marker.activeBranch, state.flags.map((flag) => flag.option), marker.branches.map((branch) => branch.savedCount)];
    })).toEqual([
      [0, [1], [0, 1, 0]], [1, [], [0, 0, 0]], [1, [2], [0, 0, 1]], [2, [], [0, 0, 0]],
    ]);
    const angles = transitions.map((i) => b.markers(i + 1)[0].angle);
    expect(angles.every((angle) => angle !== null && Number.isFinite(angle))).toBe(true);
    expect(angles[1]).toBe(angles[2]);
    expect(new Set(angles).size).toBe(3);
    for (let i = 0; i < b.trace.length; i++) {
      if (b.trace.t[i] !== T.choose && b.trace.t[i] !== T.backtrack) {
        expect(b.cursor.stateAt(i + 1).selectedBranches).toEqual(b.cursor.stateAt(i).selectedBranches);
      }
    }
  });

  it('positions markers along layout branches for empty and unequal multiway alternatives', () => {
    for (const pattern of ['|a|bb', 'a||bb', 'a|bb|ccc|']) {
      const b = build(pattern, '');
      const alt = b.alts[0];
      const marker = b.markers(b.trace.length)[0];
      const anchor = b.machine.anchors[alt.id];
      const diverter = anchor.diverter!;
      const entry = b.machine.graph.points[anchor.entry].position;
      expect(b.result.matched).toBe(true);
      expect(marker.position).toEqual({ ...diverter, z: diverter.z + 0.32 });
      expect(marker.branches).toHaveLength(alt.branches.length);
      marker.branches.forEach((branch, option) => {
        const target = b.machine.graph.points[b.machine.anchors[alt.branches[option].id].entry].position;
        expect(branch.option).toBe(option);
        for (const axis of ['x', 'y', 'z'] as const) {
          const offset = axis === 'z' ? 0.32 : 0;
          expect(branch.position[axis]).toBeCloseTo(entry[axis] + (target[axis] - entry[axis]) * 0.55 + offset);
          expect(branch.position[axis] - offset).toBeGreaterThanOrEqual(Math.min(entry[axis], target[axis]) - 1e-8);
          expect(branch.position[axis] - offset).toBeLessThanOrEqual(Math.max(entry[axis], target[axis]) + 1e-8);
        }
        expect(Object.values(branch.position).every(Number.isFinite)).toBe(true);
        expect(branch.selected).toBe(option === marker.activeBranch);
      });
      expect(marker.activeBranch).toBe(alt.branches.findIndex((branch) => branch.kind === 'empty'));
      expect(marker.angle).not.toBeNull();
      expect(Number.isFinite(marker.angle)).toBe(true);
    }
  });

  it('outer rollback removes the abandoned inner selection while preserving an earlier alternative', () => {
    const b = build('(p|q)((a|b)c|bd)', 'pbd');
    const [prefix, outer, inner] = b.alts;
    const [pop] = events(b.trace, T.backtrack, outer.id);
    expect(pop).toBeGreaterThan(0);
    expect(b.cursor.stateAt(pop).selectedBranches).toEqual(new Map([[prefix.id, 0], [outer.id, 0], [inner.id, 1]]));
    const after = b.cursor.stateAt(pop + 1);
    expect(after.selectedBranches).toEqual(new Map([[prefix.id, 0], [outer.id, 1]]));
    expect(after.flags).toEqual([{ node: prefix.id, option: 1, pos: 0 }]);
    expect(b.markers(pop + 1).find((marker) => marker.node === inner.id)).toMatchObject({ activeBranch: null, angle: null });
    expect(b.result.matched).toBe(true);
    expect(b.cursor.stateAt(b.trace.length).selectedBranches).toEqual(after.selectedBranches);
  });

  it('greedy repeat rollback restores the prior iteration selection rather than the failed iteration', () => {
    const b = build('^(a|b)+b$', 'ab');
    const alt = b.alts[0].id;
    const repeat = b.program.nodes.find((node) => node.kind === 'repeat')!.id;
    const pops = events(b.trace, T.backtrack, repeat);
    expect(pops.map((i) => b.trace.c[i])).toEqual([2, 1]);
    expect(pops.map((i) => b.cursor.stateAt(i + 1).selectedBranches)).toEqual([
      new Map([[alt, 1]]), new Map([[alt, 0]]),
    ]);
    for (const pop of pops) {
      const choose = events(b.trace, T.choose, repeat).find((i) => b.trace.c[i] === b.trace.c[pop])!;
      expect(choose).toBeLessThan(pop);
      const saved = b.cursor.stateAt(choose);
      const restored = b.cursor.stateAt(pop + 1);
      expect(restored.selectedBranches).toEqual(saved.selectedBranches);
      expect(restored.flags).toEqual(saved.flags);
      expect(restored.counters).toEqual(saved.counters);
    }
    expect(b.result.matched).toBe(true);
    expect(b.cursor.stateAt(b.trace.length).selectedBranches).toEqual(new Map([[alt, 0]]));
  });

  it('lazy repeat rollback restores its snapshot and removes abandoned continuation selections', () => {
    const b = build('^(a|b)+?(c|d)$', 'abd');
    const [body, continuation] = b.alts;
    const repeat = b.program.nodes.find((node) => node.kind === 'repeat')!.id;
    const [pop] = events(b.trace, T.backtrack, repeat);
    const [choose] = events(b.trace, T.choose, repeat);
    expect(pop).toBeGreaterThan(choose);
    expect(b.trace.b[pop]).toBe(0);
    expect(b.cursor.stateAt(pop).selectedBranches).toEqual(new Map([[body.id, 0], [continuation.id, 1]]));
    expect(b.cursor.stateAt(pop + 1).selectedBranches).toEqual(b.cursor.stateAt(choose).selectedBranches);
    expect(b.cursor.stateAt(pop + 1).selectedBranches).toEqual(new Map([[body.id, 0]]));
    expect(b.result.matched).toBe(true);
  });

  it('clears selections at every new search attempt', () => {
    const b = build('a|b', 'xb');
    const attempts = events(b.trace, T.attempt);
    expect(attempts.map((i) => b.trace.a[i])).toEqual([0, 1]);
    expect(b.cursor.stateAt(attempts[1]).selectedBranches).toEqual(new Map([[b.alts[0].id, 1]]));
    for (const attempt of attempts) {
      expect(b.cursor.stateAt(attempt + 1).selectedBranches).toEqual(new Map());
      expect(b.markers(attempt + 1)[0]).toMatchObject({ activeBranch: null, angle: null });
    }
    expect(b.result.index).toBe(1);
  });

  it('clears selections on nomatch even after the final branch was selected', () => {
    const b = build('a|b', 'x', 'y');
    const [end] = events(b.trace, T.nomatch);
    expect(end).toBe(b.trace.length - 1);
    expect(b.cursor.stateAt(end).selectedBranches).toEqual(new Map([[b.alts[0].id, 1]]));
    const state = b.cursor.stateAt(end + 1);
    expect(state.phase).toBe('nomatch');
    expect(state.selectedBranches).toEqual(new Map());
    expect(state.flags).toEqual([]);
    expect(b.markers(end + 1)).toEqual(alternationMarkers(b.program, b.machine, null));
  });

  it('retains selected branches and outstanding fallbacks on match', () => {
    const b = build('(a|b)(c|d)', 'ac');
    const [end] = events(b.trace, T.match);
    expect(end).toBe(b.trace.length - 1);
    const before = b.cursor.stateAt(end);
    const after = b.cursor.stateAt(end + 1);
    expect(after.phase).toBe('matched');
    expect(after.selectedBranches).toEqual(new Map(b.alts.map((node) => [node.id, 0])));
    expect(after.selectedBranches).toEqual(before.selectedBranches);
    expect(after.flags).toHaveLength(2);
    expect(after.flags).toEqual(before.flags);
    expect(b.markers(end + 1)).toEqual(b.markers(end));
  });

  it.each([
    { label: 'positive success', assertion: '=', input: 'ab', ok: 1, inner: 0 },
    { label: 'positive failure', assertion: '=', input: 'ac', ok: 0, inner: 1 },
    { label: 'negative success', assertion: '!', input: 'ac', ok: 1, inner: 1 },
    { label: 'negative failure', assertion: '!', input: 'ab', ok: 0, inner: 0 },
  ])('restores pre-look selections and cleans scoped flags on $label', ({ assertion, input, ok, inner }) => {
    const b = build(`(a|z)(?${assertion}(b|x)).`, input, 'y');
    const [prefix, scout] = b.alts;
    const [start, end] = events(b.trace, T.look);
    expect(b.trace.b[start]).toBe(0);
    expect(b.trace.b[end]).toBe(1);
    expect(b.trace.c[end]).toBe(ok);
    const before = b.cursor.stateAt(start);
    expect(before.selectedBranches).toEqual(new Map([[prefix.id, 0]]));
    expect(b.cursor.stateAt(end).selectedBranches).toEqual(new Map([[prefix.id, 0], [scout.id, inner]]));
    const after = b.cursor.stateAt(end + 1);
    expect(after.selectedBranches).toEqual(before.selectedBranches);
    expect(after.flags).toEqual(before.flags);
    expect(after.flags).toHaveLength(b.trace.d[end]);
    expect(after.captures[2]).toEqual(assertion === '=' && ok === 1 ? { start: 1, end: 2 } : null);
    expect(b.markers(end + 1).find((marker) => marker.node === scout.id)).toMatchObject({ activeBranch: null, angle: null });
  });

  it('nested look completion restores each enclosing scope, not just the outermost map', () => {
    const b = build('(a|z)(?=(b|x)(?=(c|y))c)bc', 'abc');
    const [prefix, outer, inner] = b.alts;
    const looks = events(b.trace, T.look);
    expect(looks.map((i) => b.trace.b[i])).toEqual([0, 0, 1, 1]);
    expect(b.cursor.stateAt(looks[2]).selectedBranches).toEqual(new Map([[prefix.id, 0], [outer.id, 0], [inner.id, 0]]));
    for (const [start, end] of [[looks[1], looks[2]], [looks[0], looks[3]]]) {
      expect(b.trace.a[start]).toBe(b.trace.a[end]);
      expect(b.cursor.stateAt(end + 1).selectedBranches).toEqual(b.cursor.stateAt(start).selectedBranches);
      expect(b.cursor.stateAt(end + 1).flags).toEqual(b.cursor.stateAt(start).flags);
    }
    expect(b.cursor.stateAt(looks[2] + 1).selectedBranches).toEqual(new Map([[prefix.id, 0], [outer.id, 0]]));
    expect(b.cursor.stateAt(looks[3] + 1).selectedBranches).toEqual(new Map([[prefix.id, 0]]));
    expect(b.result.matched).toBe(true);
  });

  it('counts repeated saved choices by node and option independently of the active branch', () => {
    const b = build('^(a|b|c){3}(x|y)$', 'abax');
    const [repeated, other] = b.alts;
    const middle = events(b.trace, T.choose, repeated.id).find((i) => b.trace.b[i] === 2 && b.trace.c[i] === 1)!;
    expect(middle).toBeGreaterThan(0);
    const activeAndSaved = b.markers(middle + 1).find((marker) => marker.node === repeated.id)!;
    expect(activeAndSaved.activeBranch).toBe(1);
    expect(activeAndSaved.branches).toMatchObject([
      { selected: false, savedCount: 0 }, { selected: true, savedCount: 1 }, { selected: false, savedCount: 1 },
    ]);
    const final = b.markers(b.trace.length);
    expect(b.result.matched).toBe(true);
    expect(final.find((marker) => marker.node === repeated.id)!.branches).toMatchObject([
      { selected: true, savedCount: 0 }, { selected: false, savedCount: 2 }, { selected: false, savedCount: 1 },
    ]);
    expect(final.find((marker) => marker.node === other.id)!.branches).toMatchObject([
      { selected: true, savedCount: 0 }, { selected: false, savedCount: 1 },
    ]);
    const inactive = b.cursor.stateAt(b.trace.length);
    inactive.selectedBranches.clear();
    const markers = alternationMarkers(b.program, b.machine, inactive);
    expect(markers.map((marker) => marker.branches.map((branch) => branch.savedCount))).toEqual(
      final.map((marker) => marker.branches.map((branch) => branch.savedCount)),
    );
    expect(markers.every((marker) => marker.activeBranch === null && marker.angle === null && marker.branches.every((branch) => !branch.selected))).toBe(true);
  });

  it('keyframes and backwards seeks reproduce full replay across choice, repeat and look snapshots', () => {
    for (const [pattern, input] of [
      ['(p|q)((a|b)c|bd)', 'pbd'],
      ['^(a|b)+b$', 'ab'],
      ['(a|z)(?=(b|x)(?=(c|y))c)bc', 'abc'],
    ]) {
      const b = build(pattern, input);
      const reference = new TraceCursor(b.program, b.trace, Infinity);
      const forward = Array.from({ length: b.trace.length + 1 }, (_, i) => reference.stateAt(i));
      for (const interval of [1, 3, 7]) {
        const cursor = new TraceCursor(b.program, b.trace, interval);
        expect(cursor.stateAt(b.trace.length)).toEqual(forward.at(-1));
        for (let i = b.trace.length; i >= 0; i--) {
          expect(cursor.stateAt(i)).toEqual(forward[i]);
          expect(alternationMarkers(b.program, b.machine, cursor.stateAt(i))).toEqual(
            alternationMarkers(b.program, b.machine, forward[i]),
          );
        }
        for (let i = 0; i <= b.trace.length; i++) expect(cursor.stateAt(i)).toEqual(forward[i]);
      }
    }
  });

  it('isolates selected maps in public cursor and store snapshots from keyframes and future rollback', () => {
    const b = build('(z|a)(?=(x|b)(?=(y|c))c)bc', 'abc');
    const reference = new TraceCursor(b.program, b.trace, Infinity);
    const expected = Array.from({ length: b.trace.length + 1 }, (_, i) => reference.stateAt(i));
    const cursor = new TraceCursor(b.program, b.trace, 1);
    const store = loaded(b);
    cursor.stateAt(b.trace.length);
    for (let i = b.trace.length; i > 0; i--) {
      const state = cursor.stateAt(i);
      const sibling = cursor.stateAt(i);
      expect(state.selectedBranches).not.toBe(sibling.selectedBranches);
      state.selectedBranches.clear();
      state.selectedBranches.set(-999, 999);
      expect(sibling).toEqual(expected[i]);
      expect(cursor.stateAt(i)).toEqual(expected[i]);
      store.getState().seekEvent(i - 1);
      store.getState().machine!.selectedBranches.clear();
      store.getState().machine!.selectedBranches.set(-999, 999);
      store.getState().seekEvent(i - 1);
      expect(store.getState().machine).toEqual(expected[i]);
    }
    for (let i = 0; i <= b.trace.length; i++) expect(cursor.stateAt(i)).toEqual(expected[i]);
  });

  it('derives markers deterministically without mutating state, layout or program', () => {
    const b = build('(a|b|c)+', 'aba');
    const state = b.cursor.stateAt(b.trace.length);
    const before = structuredClone({ state, machine: b.machine, program: b.program });
    const first = alternationMarkers(b.program, b.machine, state);
    expect(alternationMarkers(b.program, b.machine, state)).toEqual(first);
    expect({ state, machine: b.machine, program: b.program }).toEqual(before);
  });

  it('store stepForward and stepBack preserve exact selections and saved branch markers', () => {
    const b = build('(a|b|c)+c', 'abc');
    const store = loaded(b);
    const forward = Array.from({ length: b.trace.length }, (_, i) => b.cursor.stateAt(i + 1));
    for (let i = 0; i < b.trace.length; i++) {
      expect(store.getState().eventIndex).toBe(i);
      expect(store.getState().machine).toEqual(forward[i]);
      expect(alternationMarkers(b.program, b.machine, store.getState().machine)).toEqual(b.markers(i + 1));
      store.getState().stepForward();
    }
    for (let i = b.trace.length - 1; i >= 0; i--) {
      expect(store.getState().eventIndex).toBe(i);
      expect(store.getState().machine).toEqual(forward[i]);
      expect(alternationMarkers(b.program, b.machine, store.getState().machine)).toEqual(b.markers(i + 1));
      store.getState().stepBack();
    }
    expect(store.getState().machine!.selectedBranches).toEqual(new Map());
  });

  it('seekEvent, time seeks and fractional seeks agree within every event', () => {
    const b = build('(?:a|b|c)+(?=(?:d|e))d', 'abcd');
    const store = loaded(b);
    for (let i = b.trace.length - 1; i >= 0; i--) {
      store.getState().seekEvent(i);
      const state = store.getState().machine;
      const markers = alternationMarkers(b.program, b.machine, state);
      const { eventStarts, duration } = store.getState();
      const time = (eventStarts[i] + eventStarts[i + 1]) / 2;
      expect(state).toEqual(b.cursor.stateAt(i + 1));
      store.getState().seek(time);
      expect(store.getState().eventIndex).toBe(i);
      expect(store.getState().machine).toEqual(state);
      store.getState().seekFraction(time / duration);
      expect(store.getState().eventIndex).toBe(i);
      expect(store.getState().machine).toEqual(state);
      expect(alternationMarkers(b.program, b.machine, store.getState().machine)).toEqual(markers);
    }
    store.getState().seekFraction(1);
    expect(store.getState().machine).toEqual(b.cursor.stateAt(b.trace.length));
    store.getState().restart();
    expect(store.getState().machine!.selectedBranches).toEqual(new Map());
  });

  it('reveals collapsed alternatives on module expansion without changing playback state', () => {
    const pattern = `(a|b)(${'(c|d)'.repeat(43)})`;
    expect(pattern.length).toBeLessThanOrEqual(300);
    const b = build(pattern, `a${'c'.repeat(43)}`);
    expect(b.result.matched).toBe(true);
    expect(b.program.leafCount).toBeGreaterThanOrEqual(85);
    const module = b.machine.pieces.find((piece) => piece.kind === 'module')!;
    expect(module).toBeDefined();
    const hidden = b.alts.filter((alt) => module.containedNodes!.includes(alt.id));
    expect(hidden).toHaveLength(43);
    expect(hidden.every((alt) => b.machine.anchors[alt.id] && !b.machine.anchors[alt.id].diverter)).toBe(true);
    const store = loaded(b);
    store.getState().seekEvent(b.trace.length - 1);
    const before = structuredClone(store.getState().machine!);
    expect(before.selectedBranches.size).toBe(44);
    expect(before.flags).toHaveLength(44);
    expect(alternationMarkers(b.program, b.machine, before).map((marker) => marker.node)).toEqual([b.alts[0].id]);
    expect(alternationMarkers(b.program, b.machine, null)).toHaveLength(1);
    const expanded = layout(b.program, { expandedModules: [module.node!] });
    store.getState().setLayout(expanded);
    expect(store.getState().eventIndex).toBe(b.trace.length - 1);
    expect(store.getState().machine).toEqual(before);
    const markers = alternationMarkers(b.program, expanded, store.getState().machine);
    expect(markers).toHaveLength(44);
    expect(alternationMarkers(b.program, expanded, null)).toHaveLength(44);
    for (const marker of markers) {
      const diverter = expanded.anchors[marker.node].diverter!;
      expect(marker).toMatchObject({ position: { ...diverter, z: diverter.z + 0.32 }, activeBranch: 0 });
      expect(marker.branches).toMatchObject([{ selected: true, savedCount: 0 }, { selected: false, savedCount: 1 }]);
    }
    store.getState().setLayout(b.machine);
    expect(store.getState().machine).toEqual(before);
    expect(alternationMarkers(b.program, b.machine, store.getState().machine)).toHaveLength(1);
  });
});
