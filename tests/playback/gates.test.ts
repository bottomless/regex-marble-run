import { describe, expect, it } from 'vitest';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { T, type Trace } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import { gateMarkers } from '../../src/playback/gates.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { createPlaybackStore } from '../../src/playback/store.ts';
import { PRESETS } from '../../src/presets.ts';

function build(pattern: string, input: string, flags = '') {
  const program = parsePattern(pattern, flags);
  const { trace, result } = runBacktrack(program, input);
  const machine = layout(program);
  const cursor = new TraceCursor(program, trace);
  const markers = (index: number) => gateMarkers(machine, cursor.stateAt(index));
  return { program, trace, result, machine, cursor, markers };
}

function events(trace: Trace, type: T, node?: number): number[] {
  return Array.from(trace.t).flatMap((t, i) => t === type && (node === undefined || trace.a[i] === node) ? [i] : []);
}

describe('gate and sensor lamps (Step 13)', () => {
  it('starts dark and lights each gate with the outcome of its test event', () => {
    const b = build('c(a|o)t', 'the cot');
    expect(gateMarkers(b.machine, null)).toEqual([]);
    expect(b.markers(0)).toEqual([]);
    for (const i of events(b.trace, T.test)) {
      const node = b.trace.a[i];
      const ok = b.trace.c[i] === 1;
      const state = b.cursor.stateAt(i + 1);
      expect(state.gates.get(node)).toBe(ok ? 'pass' : 'reject');
      const marker = b.markers(i + 1).find((m) => m.node === node)!;
      const piece = b.machine.pieces.find((piece) => piece.kind === 'gate' && piece.node === node)!;
      expect(marker).toEqual({ node, kind: 'gate', position: piece.position, status: ok ? 'pass' : 'reject', active: true });
      expect(b.markers(i + 1).filter((m) => m.active)).toEqual([marker]);
    }
  });

  it('clears every lamp on a new attempt so the next hopper release starts dark', () => {
    const b = build('c(a|o)t', 'the cot');
    const attempts = events(b.trace, T.attempt);
    expect(attempts.length).toBe(5);
    for (const attempt of attempts.slice(1)) {
      expect(b.cursor.stateAt(attempt).gates.size).toBeGreaterThan(0);
      expect(b.cursor.stateAt(attempt + 1).gates).toEqual(new Map());
      expect(b.markers(attempt + 1)).toEqual([]);
    }
  });

  it('rolls a rejecting gate back to its state at the choice point and keeps earlier passes lit', () => {
    const b = build('c(a|o)t', 'the cot');
    const c = b.program.nodes.find((node) => node.kind === 'char' && node.label === 'c')!.id;
    const a = b.program.nodes.find((node) => node.kind === 'char' && node.label === 'a')!.id;
    const o = b.program.nodes.find((node) => node.kind === 'char' && node.label === 'o')!.id;
    const [choose] = events(b.trace, T.choose);
    const [pop] = events(b.trace, T.backtrack);
    const reject = events(b.trace, T.test, a).find((i) => i > choose && b.trace.c[i] === 0)!;
    expect(reject).toBeLessThan(pop);
    expect(b.cursor.stateAt(reject + 1).gates).toEqual(new Map([[c, 'pass'], [a, 'reject']]));
    const after = b.cursor.stateAt(pop + 1);
    expect(after.gates).toEqual(b.cursor.stateAt(choose).gates);
    expect(after.gates).toEqual(new Map([[c, 'pass']]));
    expect(after.activeNode).toBe(b.trace.a[pop]);
    expect(b.markers(pop + 1).map((m) => [m.node, m.status, m.active])).toEqual([[c, 'pass', false]]);
    const [match] = events(b.trace, T.match);
    const final = b.cursor.stateAt(match + 1);
    expect(final.gates).toEqual(new Map([[c, 'pass'], [o, 'pass'], [b.program.nodes.find((node) => node.kind === 'char' && node.label === 't')!.id, 'pass']]));
    expect(final.gates).toEqual(b.cursor.stateAt(match).gates);
  });

  it('keeps the final rejection lit on nomatch', () => {
    const b = build('ab', 'ac', 'y');
    const [end] = events(b.trace, T.nomatch);
    const state = b.cursor.stateAt(end + 1);
    expect(state.phase).toBe('nomatch');
    const a = b.program.nodes.find((node) => node.kind === 'char' && node.label === 'a')!.id;
    const bb = b.program.nodes.find((node) => node.kind === 'char' && node.label === 'b')!.id;
    expect(state.gates).toEqual(new Map([[a, 'pass'], [bb, 'reject']]));
    expect(state.gates).toEqual(b.cursor.stateAt(end).gates);
  });

  it('lights anchor and word-boundary sensors green or red without moving the head', () => {
    const b = build(String.raw`^\bcat\b$`, 'cat');
    const sensors = b.machine.pieces.filter((piece) => piece.kind === 'sensor');
    expect(sensors).toHaveLength(4);
    for (const i of events(b.trace, T.test)) {
      const node = b.trace.a[i];
      if (b.program.nodes[node].kind !== 'assert') continue;
      const state = b.cursor.stateAt(i + 1);
      expect(state.head).toBe(b.trace.b[i]);
      const marker = b.markers(i + 1).find((m) => m.node === node)!;
      expect(marker).toMatchObject({ kind: 'sensor', status: 'pass', active: true });
    }
    expect(b.result.matched).toBe(true);
    const fail = build('^a', 'ba');
    const start = fail.program.nodes.find((node) => node.kind === 'assert')!.id;
    const tests = events(fail.trace, T.test, start);
    expect(tests.map((i) => fail.trace.c[i])).toEqual([1, 0, 0]);
    expect(fail.markers(tests[1] + 1)).toEqual([expect.objectContaining({ node: start, kind: 'sensor', status: 'reject', active: true })]);
  });

  it('shows the scout lamp on completion and restores the inner gates to their pre-look state', () => {
    for (const [pattern, input, ok] of [[String.raw`a(?=b)`, 'ab', 'pass'], [String.raw`a(?=b)`, 'ac', 'reject'], [String.raw`a(?!b)`, 'ac', 'pass'], [String.raw`a(?!b)`, 'ab', 'reject']] as const) {
      const b = build(pattern, input, 'y');
      const look = b.program.nodes.find((node) => node.kind === 'look')!.id;
      const inner = b.program.nodes.find((node) => node.kind === 'char' && node.label === 'b')!.id;
      const [start, end] = events(b.trace, T.look, look);
      const before = b.cursor.stateAt(start);
      expect(before.gates.has(look)).toBe(false);
      expect(b.cursor.stateAt(start + 1).gates.has(look)).toBe(false);
      expect(b.cursor.stateAt(end).gates.has(inner)).toBe(true);
      const after = b.cursor.stateAt(end + 1);
      expect(after.gates.get(look)).toBe(ok);
      expect(after.gates.has(inner)).toBe(false);
      expect(new Map([...after.gates].filter(([node]) => node !== look))).toEqual(before.gates);
      const scout = b.machine.pieces.find((piece) => piece.kind === 'scout' && piece.node === look)!;
      expect(b.markers(end + 1).find((m) => m.node === look)).toEqual({ node: look, kind: 'scout', position: scout.position, status: ok, active: true });
    }
  });

  it('lights mirror gates and sealed lookbehind gates from their test events', () => {
    const mirror = build(String.raw`(\w)\1`, 'hello');
    const backref = mirror.program.nodes.find((node) => node.kind === 'backref')!.id;
    const tests = events(mirror.trace, T.test, backref);
    expect(tests.length).toBeGreaterThan(1);
    expect(mirror.markers(tests[0] + 1).find((m) => m.node === backref)).toMatchObject({ kind: 'mirror', status: 'reject' });
    expect(mirror.markers(tests.at(-1)! + 1).find((m) => m.node === backref)).toMatchObject({ kind: 'mirror', status: 'pass' });
    expect(mirror.result.index).toBe(2);
    const opaque = build('(?<=a)b', 'ab');
    const node = opaque.program.nodes.find((n) => n.kind === 'opaque')!.id;
    const probes = events(opaque.trace, T.test, node);
    expect(probes.map((i) => opaque.trace.c[i])).toEqual([0, 1]);
    expect(opaque.markers(probes[0] + 1)).toEqual([expect.objectContaining({ node, kind: 'opaque', status: 'reject', active: true })]);
    expect(opaque.markers(probes[1] + 1)).toEqual([expect.objectContaining({ node, kind: 'opaque', status: 'pass', active: true })]);
  });

  it('marks only the most recent event node as active, including diverters without lamps', () => {
    const b = build('c(a|o)t', 'the cot');
    for (let i = 0; i < b.trace.length; i++) {
      const state = b.cursor.stateAt(i + 1);
      const active = b.markers(i + 1).filter((m) => m.active);
      const lamp = b.machine.pieces.some((piece) => piece.node === state.activeNode && ['gate', 'sensor', 'mirror', 'opaque', 'scout'].includes(piece.kind));
      expect(active.map((m) => m.node)).toEqual(lamp ? [state.activeNode] : []);
    }
  });

  it('reproduces forward lamp states exactly when stepping and scrubbing backward', () => {
    for (const preset of PRESETS.filter((preset) => preset.number <= 5)) {
      const b = build(preset.pattern, preset.input, preset.flags);
      const store = createPlaybackStore();
      store.getState().load({ program: b.program, trace: b.trace, layout: b.machine });
      const forward: string[] = [];
      for (let i = 0; i < b.trace.length; i++) {
        store.getState().seekEvent(i);
        forward.push(JSON.stringify(gateMarkers(b.machine, store.getState().machine)));
      }
      expect(new Set(forward).size).toBeGreaterThan(2);
      store.getState().seekEvent(b.trace.length - 1);
      for (let i = b.trace.length - 1; i >= 0; i--) {
        expect(store.getState().eventIndex).toBe(i);
        expect(JSON.stringify(gateMarkers(b.machine, store.getState().machine))).toBe(forward[i]);
        store.getState().stepBack();
      }
      store.getState().restart();
      expect(gateMarkers(b.machine, store.getState().machine)).toEqual(JSON.parse(forward[0]));
    }
  });

  it('keyframed cursors agree with full replay on gate results', () => {
    for (const preset of PRESETS.filter((preset) => preset.number <= 5)) {
      const program = parsePattern(preset.pattern, preset.flags);
      const { trace } = runBacktrack(program, preset.input);
      const dense = new TraceCursor(program, trace, 3);
      const plain = new TraceCursor(program, trace, Infinity);
      for (let i = 0; i <= trace.length; i++) {
        const a = dense.stateAt(i);
        const c = plain.stateAt(i);
        expect(a.gates).toEqual(c.gates);
        expect(a.activeNode).toBe(c.activeNode);
      }
    }
  });

  it('exposes isolated gate maps so callers cannot corrupt later seeks', () => {
    const b = build('c(a|o)t', 'the cot');
    const i = events(b.trace, T.test)[3] + 1;
    const first = b.cursor.stateAt(i);
    const sibling = b.cursor.stateAt(i);
    expect(first.gates).not.toBe(sibling.gates);
    first.gates.clear();
    first.gates.set(-1, 'reject');
    expect(b.cursor.stateAt(i).gates).toEqual(sibling.gates);
  });

  it('skips gates inside collapsed modules but keeps their results for expansion', () => {
    const pattern = `a+(${'b+c'.repeat(22)})(${'b+c'.repeat(22)})`;
    const input = `a${'bc'.repeat(44)}`;
    const program = parsePattern(pattern, '');
    const collapsed = layout(program);
    const modules = collapsed.pieces.filter((piece) => piece.kind === 'module');
    expect(modules).toHaveLength(2);
    const hidden = new Set(modules.flatMap((piece) => piece.containedNodes ?? []));
    const { trace, result } = runBacktrack(program, input);
    expect(result.matched).toBe(true);
    const final = new TraceCursor(program, trace).stateAt(trace.length);
    const visible = gateMarkers(collapsed, final);
    expect(visible.some((marker) => hidden.has(marker.node))).toBe(false);
    expect(visible).toHaveLength(1);
    const expanded = layout(program, { expandedModules: modules.map((piece) => piece.node!) });
    const all = gateMarkers(expanded, final);
    expect(all).toHaveLength(89);
    expect(all.filter((marker) => hidden.has(marker.node) && marker.status === 'pass')).toHaveLength(88);
  });
});
