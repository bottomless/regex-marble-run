import { describe, expect, it } from 'vitest';
import { pace, travelFraction } from '../../src/scene/ride.ts';

describe('pace', () => {
  it('pins the ends and matches the requested endpoint speeds', () => {
    expect(pace(0, 0, 1)).toBe(0);
    expect(pace(1, 0, 1)).toBeCloseTo(1);
    expect(pace(1, 1.8, 0.25)).toBeCloseTo(1);
    expect(pace(0.5, 0, 0)).toBeCloseTo(0.5);
  });

  it('stays monotonic for the speeds the ride uses', () => {
    for (const [depart, arrive] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0.2, 0.35],
      [1.8, 0.25],
      [1.8, 1],
    ] as const) {
      let prev = -1;
      for (let i = 0; i <= 20; i++) {
        const value = pace(i / 20, depart, arrive);
        expect(value).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = value;
      }
    }
  });
});

describe('travelFraction', () => {
  it('keeps cruise speed when the marble is already moving through', () => {
    expect(travelFraction('roll', 0.4, false, false)).toBeCloseTo(0.4);
    expect(travelFraction('drop', 0.7, false, false)).toBeCloseTo(0.7);
  });

  it('accelerates out of rest and eases into a stop', () => {
    expect(travelFraction('roll', 0.25, true, false)).toBeLessThan(0.25);
    expect(travelFraction('roll', 0.75, false, true)).toBeGreaterThan(0.75);
    expect(travelFraction('drop', 0.2, true, true)).toBeLessThan(0.2);
    expect(travelFraction('lift', 0.15, true, false)).toBeGreaterThan(0.15);
  });

  it('still starts and ends on the segment', () => {
    for (const kind of ['roll', 'drop', 'lift'] as const) {
      expect(travelFraction(kind, 0, true, true)).toBe(0);
      expect(travelFraction(kind, 1, true, true)).toBeCloseTo(1);
    }
  });
});
