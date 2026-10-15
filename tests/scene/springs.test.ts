import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { layout } from '../../src/layout/layout.ts';
import { buildTimeline } from '../../src/playback/timeline.ts';
import { springLaunchers } from '../../src/scene/geometry.ts';
import { launchWindow, springScale } from '../../src/scene/Springs.tsx';

function build(pattern: string, input: string) {
  const program = parsePattern(pattern, '');
  const { trace } = runBacktrack(program, input);
  const machine = layout(program);
  const timeline = buildTimeline(trace, machine);
  return { machine, timeline };
}

describe('spring launchers', () => {
  it('compresses while the marble enters the lift and releases it as it climbs', () => {
    expect(springScale(null)).toBe(1);
    expect(springScale(0)).toBe(1);
    expect(springScale(1)).toBe(1);
    const compressed = springScale(0.15);
    expect(compressed).toBeLessThan(0.85);
    expect(springScale(0.3)).toBeLessThan(compressed + 1e-9);
    expect(springScale(0.6)).toBeGreaterThan(compressed);
    expect(springScale(0.85)).toBeGreaterThan(1);
  });

  it('fires each launcher exactly on the segments that ride its lift', () => {
    const { machine, timeline } = build('(a)+b', 'aab');
    const launchers = springLaunchers(machine);
    expect(launchers.length).toBeGreaterThan(0);
    let windows = 0;
    for (const launcher of launchers) {
      for (const segment of timeline.segments) {
        const window = launchWindow(machine, launcher, segment);
        if (!window) continue;
        windows++;
        expect(['roll', 'drop', 'lift']).toContain(segment.kind);
        expect(window[0]).toBeGreaterThanOrEqual(0);
        expect(window[1]).toBeLessThanOrEqual(1);
        expect(window[0]).toBeLessThan(window[1]);
        const span = window[1] - window[0];
        expect(springScale((window[0] + 0.15 * span - window[0]) / span)).toBeLessThan(0.85);
        expect(springScale((window[1] - window[0]) / span)).toBe(1);
      }
    }
    expect(windows).toBeGreaterThan(0);
  });

  it('covers the backtracking lift of a failed repeat', () => {
    const { machine, timeline } = build('<.+>', 'foo');
    const launchers = springLaunchers(machine);
    const fired = launchers.filter((launcher) =>
      timeline.segments.some((segment) => launchWindow(machine, launcher, segment)),
    );
    expect(fired.length).toBeGreaterThan(0);
  });
});
