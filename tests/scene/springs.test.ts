import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { layout } from '../../src/layout/layout.ts';
import { createPlaybackStore } from '../../src/playback/store.ts';
import { plungerTravel, SPRING_SQUASH, springLaunchers, type SpringLauncher } from '../../src/scene/geometry.ts';
import { Ride } from '../../src/scene/ride.ts';
import { coilLength, riderBeds } from '../../src/scene/Springs.tsx';

function load(pattern: string, input: string) {
  const program = parsePattern(pattern, '');
  const { trace } = runBacktrack(program, input);
  const machine = layout(program);
  const store = createPlaybackStore();
  store.getState().load({ program, trace, layout: machine });
  return { machine, store, ride: new Ride(machine) };
}

const launcher: SpringLauncher = {
  piece: 0,
  foot: { x: 0, y: 0, z: 0 },
  base: { x: 0, y: -0.55, z: 0.02 },
  rest: 0.51,
  stroke: 0.6,
  release: 1,
};

describe('spring plunger travel', () => {
  it('rests flush with the foot when no marble is near', () => {
    expect(plungerTravel(launcher, [])).toBeCloseTo(0);
    expect(plungerTravel(launcher, [{ x: 3, y: 0, z: 0 }])).toBeCloseTo(0);
    expect(plungerTravel(launcher, [{ x: 0, y: 5, z: 0 }])).toBeCloseTo(0);
  });

  it('loads the spring more as a marble rolls closer to the plate', () => {
    const far = plungerTravel(launcher, [{ x: 0.25, y: 0, z: 0 }]);
    const near = plungerTravel(launcher, [{ x: 0.05, y: 0, z: 0 }]);
    expect(far).toBeLessThan(0);
    expect(near).toBeLessThan(far);
    expect(near).toBeGreaterThanOrEqual(-SPRING_SQUASH);
  });

  it('rides up under the marble for the stroke, then sinks back over the release', () => {
    expect(plungerTravel(launcher, [{ x: 0, y: 0.3, z: 0 }])).toBeCloseTo(0.3);
    expect(plungerTravel(launcher, [{ x: 0, y: 0.6, z: 0 }])).toBeCloseTo(0.6);
    expect(plungerTravel(launcher, [{ x: 0, y: 1.1, z: 0 }])).toBeCloseTo(0.3);
    expect(plungerTravel(launcher, [{ x: 0, y: 1.6, z: 0 }])).toBeCloseTo(0);
  });

  it('follows the marble that lifts the plate highest', () => {
    const beds = [
      { x: 0.1, y: 0, z: 0 },
      { x: 0, y: 0.2, z: 0 },
      { x: 0, y: 0.5, z: 0 },
    ];
    expect(plungerTravel(launcher, beds)).toBeCloseTo(0.5);
  });

  it('never shrinks the coil below a solid stack, and stretches it under a lift', () => {
    expect(coilLength(launcher, 0)).toBeCloseTo(launcher.rest);
    expect(coilLength(launcher, 0.4)).toBeCloseTo(launcher.rest + 0.4);
    expect(coilLength(launcher, -SPRING_SQUASH)).toBeLessThan(launcher.rest);
    expect(coilLength(launcher, -10)).toBeCloseTo(launcher.rest * 0.4);
  });
});

describe('spring launchers in playback', () => {
  function travels(pattern: string, input: string, options: { hero: boolean; input: string }) {
    const { machine, store, ride } = load(pattern, input);
    const launchers = springLaunchers(machine);
    expect(launchers.length).toBeGreaterThan(0);
    const total = store.getState().duration;
    const seen = launchers.map(() => ({ up: 0, down: 0 }));
    for (let time = 0; time <= total; time += 10) {
      store.getState().seek(time);
      const beds = riderBeds(store, machine, ride, { ...options, unicode: false });
      launchers.forEach((spring, index) => {
        const travel = plungerTravel(spring, beds);
        seen[index].up = Math.max(seen[index].up, travel);
        seen[index].down = Math.min(seen[index].down, travel);
      });
    }
    return seen;
  }

  it('drives a backtracking letter marble up its lift', () => {
    const seen = travels('(a)+b', 'aab', { hero: false, input: 'aab' });
    expect(seen.some((spring) => spring.up > 0.05)).toBe(true);
    expect(seen.some((spring) => spring.down < 0)).toBe(true);
  });

  it('drives the hero marble up a loop lift on every repeat', () => {
    const seen = travels('(a)+', 'aaa', { hero: true, input: '' });
    expect(seen.some((spring) => spring.up > 0.05)).toBe(true);
  });

  it('leaves every spring at rest before playback starts', () => {
    const { machine, store, ride } = load('c(a|o)t', 'cut');
    store.getState().seek(0);
    const beds = riderBeds(store, machine, ride, { hero: false, input: 'cut', unicode: false });
    for (const spring of springLaunchers(machine)) expect(plungerTravel(spring, beds)).toBeCloseTo(0);
  });
});
