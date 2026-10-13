import { describe, expect, it } from 'vitest';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { T } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import { FLAG_PITCH, flagMarkers } from '../../src/playback/flags.ts';
import { TraceCursor } from '../../src/playback/state.ts';
import { createPlaybackStore } from '../../src/playback/store.ts';
import { PRESETS } from '../../src/presets.ts';

function build(pattern: string, input: string, flags = '') {
  const program = parsePattern(pattern, flags);
  const { trace, result } = runBacktrack(program, input);
  const machine = layout(program);
  const cursor = new TraceCursor(program, trace);
  return { program, trace, result, machine, cursor };
}

const cases = [
  ...PRESETS.filter((preset) => preset.number <= 5).map((preset) => ({
    name: preset.id,
    pattern: preset.pattern,
    input: preset.input,
    flags: preset.flags,
  })),
  { name: 'no match', pattern: 'a+b', input: 'aac', flags: '' },
  { name: 'lookahead cleanup', pattern: '(?=(a|aa)+b)a+b', input: 'aaab', flags: '' },
];

describe('saved choice flag markers', () => {
  it('renders no markers without saved choices, and skips unknown anchors', () => {
    const { machine } = build('a|b', 'a');
    expect(flagMarkers(machine, [])).toEqual([]);
    expect(flagMarkers(machine, [{ node: 999, pos: 0, option: 1 }])).toEqual([]);
  });

  it('stacks repeated choices at the node flag slot without deduplicating entries', () => {
    const { program, machine } = build('a+', 'aaa');
    const node = program.nodes.find((item) => item.kind === 'repeat')!.id;
    const flags = [{ node, pos: 1, option: 1 }, { node, pos: 1, option: 1 }, { node, pos: 2, option: 0 }];
    const original = structuredClone(flags);
    const markers = flagMarkers(machine, flags);
    const base = machine.anchors[node].flagSlot!;
    expect(markers).toHaveLength(flags.length);
    markers.forEach((marker, index) => {
      expect(marker).toMatchObject({ ...flags[index], stackIndex: index, level: index, role: 'repeat' });
      expect(marker.position).toEqual({ ...base, y: base.y + index * FLAG_PITCH });
      expect(marker.position).not.toBe(base);
    });
    expect(flags).toEqual(original);
    expect(machine.anchors[node].flagSlot).toEqual(base);
  });

  it('assigns independent column levels while preserving global stack order', () => {
    const { program, machine } = build('a+b+', 'aabb');
    const [a, b] = program.nodes.filter((item) => item.kind === 'repeat').map((item) => item.id);
    const flags = [{ node: a, pos: 1, option: 1 }, { node: b, pos: 3, option: 1 }, { node: a, pos: 2, option: 1 }];
    const markers = flagMarkers(machine, flags);
    expect(markers.map((marker) => marker.level)).toEqual([0, 0, 1]);
    expect(markers.map((marker) => marker.stackIndex)).toEqual([0, 1, 2]);
    expect(markers[0].column).toBe(markers[2].column);
    expect(markers[0].column).not.toBe(markers[1].column);
  });

  describe.each(cases)('$name', ({ pattern, input, flags }) => {
    const built = build(pattern, input, flags);

    it('maps every saved choice to a finite, non-overlapping marker at every event', () => {
      for (let event = 0; event <= built.trace.length; event++) {
        const choices = built.cursor.stateAt(event).flags;
        const markers = flagMarkers(built.machine, choices);
        expect(markers).toHaveLength(choices.length);
        expect(new Set(markers.map((marker) => JSON.stringify(marker.position))).size).toBe(markers.length);
        markers.forEach((marker, index) => {
          expect(marker).toMatchObject({ ...choices[index], stackIndex: index });
          expect(Object.values(marker.position).every(Number.isFinite)).toBe(true);
        });
      }
    });

    it('restores the exact rendered choices when scrubbing and stepping backward', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: built.program, trace: built.trace, layout: built.machine });
      const forward = Array.from({ length: built.trace.length }, (_, event) => {
        store.getState().seekEvent(event);
        return flagMarkers(built.machine, store.getState().machine!.flags);
      });
      for (let event = built.trace.length - 1; event >= 0; event--) {
        store.getState().seekEvent(event);
        expect(flagMarkers(built.machine, store.getState().machine!.flags)).toEqual(forward[event]);
        if (event > 0) {
          store.getState().stepBack();
          expect(flagMarkers(built.machine, store.getState().machine!.flags)).toEqual(forward[event - 1]);
          store.getState().stepForward();
          expect(flagMarkers(built.machine, store.getState().machine!.flags)).toEqual(forward[event]);
        }
      }
      store.getState().restart();
      expect(flagMarkers(built.machine, store.getState().machine!.flags)).toEqual([]);
      store.getState().reset();
      expect(store.getState().machine).toBeNull();
    });
  });

  it('plants on choose, pops on backtrack, and restores the popped flag when stepping back', () => {
    const built = build('c(a|o)t', 'the cot');
    const choose = built.trace.t.findIndex((type) => type === T.choose);
    const pop = built.trace.t.findIndex((type) => type === T.backtrack);
    expect(choose).toBeGreaterThan(0);
    expect(pop).toBeGreaterThan(choose);
    const store = createPlaybackStore();
    store.getState().load({ program: built.program, trace: built.trace, layout: built.machine });
    store.getState().seekEvent(choose);
    const planted = flagMarkers(built.machine, store.getState().machine!.flags);
    expect(planted).toHaveLength(1);
    expect(planted[0]).toMatchObject({
      node: built.trace.a[choose], option: built.trace.b[choose], pos: built.trace.c[choose],
    });
    store.getState().seekEvent(pop);
    expect(flagMarkers(built.machine, store.getState().machine!.flags)).toEqual([]);
    store.getState().stepBack();
    expect(flagMarkers(built.machine, store.getState().machine!.flags)).toEqual(planted);
    store.getState().stepForward();
    expect(flagMarkers(built.machine, store.getState().machine!.flags)).toEqual([]);
  });

  it('preserves outstanding choices on match and clears them on a failed search', () => {
    const matched = build('a|b', 'a');
    const end = matched.cursor.stateAt(matched.trace.length);
    expect(end.phase).toBe('matched');
    expect(flagMarkers(matched.machine, end.flags)).toHaveLength(1);
    const failed = build('a+b', 'aac');
    expect(failed.cursor.stateAt(failed.trace.length).phase).toBe('nomatch');
    expect(flagMarkers(failed.machine, failed.cursor.stateAt(failed.trace.length).flags)).toEqual([]);
  });

  it('removes scoped lookahead choices on look completion', () => {
    const built = build('(?=(a|aa)+b)a+b', 'aaab');
    const end = built.trace.t.findIndex((type, index) => type === T.look && built.trace.b[index] === 1);
    expect(end).toBeGreaterThan(0);
    expect(flagMarkers(built.machine, built.cursor.stateAt(end).flags).length).toBeGreaterThan(0);
    expect(flagMarkers(built.machine, built.cursor.stateAt(end + 1).flags)).toEqual([]);
  });

  it('shares a column for collapsed choices and relocates them on expansion without losing state', () => {
    const built = build(`(${'a?'.repeat(85)})`, 'a'.repeat(85));
    const module = built.machine.pieces.find((piece) => piece.kind === 'module')!;
    expect(module).toBeDefined();
    const state = built.cursor.stateAt(built.trace.length);
    expect(state.flags).toHaveLength(85);
    const collapsed = flagMarkers(built.machine, state.flags);
    expect(collapsed).toHaveLength(state.flags.length);
    expect(new Set(collapsed.map((marker) => marker.column)).size).toBe(1);
    expect(collapsed.map((marker) => marker.level)).toEqual(state.flags.map((_, index) => index));
    expect(collapsed[0].position.x).toBeGreaterThan(module.position.x + module.size.x / 2);
    const expanded = layout(built.program, { expandedModules: [module.node!] });
    const store = createPlaybackStore();
    store.getState().load({ program: built.program, trace: built.trace, layout: built.machine });
    store.getState().seekEvent(built.trace.length - 1);
    store.getState().setLayout(expanded);
    expect(store.getState().machine).toEqual(state);
    const markers = flagMarkers(expanded, store.getState().machine!.flags);
    expect(markers).toHaveLength(collapsed.length);
    expect(new Set(markers.map((marker) => marker.column)).size).toBe(85);
    markers.forEach((marker) => {
      expect(marker.level).toBe(0);
      expect(marker.position).toEqual(expanded.anchors[marker.node].flagSlot);
    });
  });
});
