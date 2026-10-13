import { describe, expect, it } from 'vitest';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { T } from '../../src/engine/trace.ts';
import { layout } from '../../src/layout/layout.ts';
import {
  CARRIAGE_SHIFT,
  MARBLE_LIFT_SHIFT,
  carriageAtIndex,
  carriedMarblePosition,
  formatCarriage,
} from '../../src/playback/carriage.ts';
import { poseForSegment } from '../../src/playback/motion.ts';
import { createPlaybackStore } from '../../src/playback/store.ts';
import { buildTimeline } from '../../src/playback/timeline.ts';
import { PRESETS } from '../../src/presets.ts';

function build(pattern: string, input: string, flags = '', speed = 1) {
  const program = parsePattern(pattern, flags);
  const { trace } = runBacktrack(program, input);
  const machine = layout(program);
  const timeline = buildTimeline(trace, machine, { speed });
  return { program, trace, machine, timeline };
}

const cases = [
  ...PRESETS.filter((preset) => preset.number <= 5).map((preset) => ({
    name: preset.id,
    pattern: preset.pattern,
    input: preset.input,
    flags: preset.flags,
  })),
  { name: 'greedy retreat', pattern: 'a+b', input: 'aac', flags: '' },
  { name: 'alternation', pattern: 'a|b|c', input: 'c', flags: '' },
];

function finite(value: number): boolean {
  return Number.isFinite(value);
}

describe('backtracking lift carriage', () => {
  it('is hidden off the rear-lift ride and ignores out-of-range indexes', () => {
    const built = build('c(a|o)t', 'the cot');
    expect(carriageAtIndex(built.machine, built.timeline, -1, 0)).toBeNull();
    expect(carriageAtIndex(built.machine, built.timeline, built.timeline.segments.length, 0)).toBeNull();
    const gate = built.timeline.segments.findIndex((segment) => segment.kind === 'gate');
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(carriageAtIndex(built.machine, built.timeline, gate, 0.5)).toBeNull();
  });

  it('parks the marble in the cradle by a fixed offset from the rail', () => {
    const rail = { x: 1, y: 2, z: 3 };
    expect(carriedMarblePosition(rail)).toEqual({
      x: rail.x + MARBLE_LIFT_SHIFT.x,
      y: rail.y + MARBLE_LIFT_SHIFT.y,
      z: rail.z + MARBLE_LIFT_SHIFT.z,
    });
    expect(rail).toEqual({ x: 1, y: 2, z: 3 });
  });

  describe.each(cases)('$name', ({ pattern, input, flags }) => {
    const built = build(pattern, input, flags);
    const rides = built.timeline.segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ index }) => carriageAtIndex(built.machine, built.timeline, index, 0));

    it('rides every rear-lift segment on a fixed deck offset', () => {
      for (const ride of rides) {
        expect(ride.segment.kind === 'lift' || ride.segment.kind === 'drop').toBe(true);
        let previous = -1;
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
          const pose = carriageAtIndex(built.machine, built.timeline, ride.index, fraction);
          expect(pose, `${ride.segment.kind} @ ${fraction}`).not.toBeNull();
          const rail = poseForSegment(built.machine, ride.segment, fraction)!.position;
          expect(pose!.rail).toEqual(rail);
          expect(pose!.position).toEqual({
            x: rail.x + CARRIAGE_SHIFT.x,
            y: rail.y + CARRIAGE_SHIFT.y,
            z: rail.z + CARRIAGE_SHIFT.z,
          });
          expect(Object.values(pose!.position).every(finite)).toBe(true);
          expect(finite(pose!.yaw)).toBe(true);
          const along = poseForSegment(built.machine, ride.segment, 0)!.position;
          const travelled = Math.hypot(rail.x - along.x, rail.y - along.y, rail.z - along.z);
          expect(travelled).toBeGreaterThanOrEqual(previous - 1e-9);
          previous = travelled;
        }
      }
    });

    it('matches a forward time sweep when scrubbed backward, including jumps', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: built.program, trace: built.trace, layout: built.machine, speed: 1 });
      const samples = [0, 0.17, 0.5, 0.83, 1].map((fraction) => fraction * store.getState().duration);
      const forward = samples.map((time) => {
        store.getState().seek(time);
        const state = store.getState();
        return formatCarriage(carriageAtIndex(built.machine, state.timeline!, state.segmentIndex, state.fraction));
      });
      const backward = [...samples].reverse().map((time) => {
        store.getState().seek(time);
        const state = store.getState();
        return formatCarriage(carriageAtIndex(built.machine, state.timeline!, state.segmentIndex, state.fraction));
      });
      expect(backward.reverse()).toEqual(forward);
      store.getState().restart();
      expect(formatCarriage(carriageAtIndex(built.machine, store.getState().timeline!, 0, 0))).toBe('');
    });

    it('restores the same carriage when stepping back to an event', () => {
      const store = createPlaybackStore();
      store.getState().load({ program: built.program, trace: built.trace, layout: built.machine });
      const forward = Array.from({ length: built.trace.length }, (_, event) => {
        store.getState().seekEvent(event);
        const state = store.getState();
        return formatCarriage(carriageAtIndex(built.machine, state.timeline!, state.segmentIndex, state.fraction));
      });
      for (let event = built.trace.length - 1; event >= 0; event--) {
        store.getState().seekEvent(event);
        const state = store.getState();
        expect(formatCarriage(carriageAtIndex(built.machine, state.timeline!, state.segmentIndex, state.fraction))).toBe(
          forward[event],
        );
        if (event > 0) {
          store.getState().stepBack();
          const previous = store.getState();
          expect(
            formatCarriage(carriageAtIndex(built.machine, previous.timeline!, previous.segmentIndex, previous.fraction)),
          ).toBe(forward[event - 1]);
        }
      }
    });
  });

  it('still places the carriage when high speed collapses the ride to a jump', () => {
    const built = build('a|b', 'b', '', 64);
    const ride = built.timeline.segments.findIndex((segment) => segment.kind === 'lift' || segment.kind === 'drop');
    expect(ride).toBeGreaterThanOrEqual(0);
    expect(built.timeline.segments[ride].jump).toBe(true);
    const pose = carriageAtIndex(built.machine, built.timeline, ride, 0);
    expect(pose).not.toBeNull();
    expect(Object.values(pose!.position).every(finite)).toBe(true);
  });

  it('shows the carriage at the paused start of a backtrack and hides it after the ride', () => {
    const built = build('c(a|o)t', 'the cot');
    const backtrack = built.trace.t.findIndex((type) => type === T.backtrack);
    expect(backtrack).toBeGreaterThan(0);
    const store = createPlaybackStore();
    store.getState().load({ program: built.program, trace: built.trace, layout: built.machine });
    store.getState().seekEvent(backtrack);
    const riding = store.getState();
    const pose = carriageAtIndex(built.machine, riding.timeline!, riding.segmentIndex, riding.fraction);
    expect(pose).not.toBeNull();
    expect(riding.timeline!.segments[riding.segmentIndex].kind).toBe('drop');
    store.getState().seekEvent(backtrack + 1);
    const after = store.getState();
    expect(carriageAtIndex(built.machine, after.timeline!, after.segmentIndex, after.fraction)).toBeNull();
    store.getState().stepBack();
    const restored = store.getState();
    expect(formatCarriage(carriageAtIndex(built.machine, restored.timeline!, restored.segmentIndex, restored.fraction))).toBe(
      formatCarriage(pose),
    );
  });
});
