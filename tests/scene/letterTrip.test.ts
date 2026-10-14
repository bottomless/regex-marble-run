import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { layout } from '../../src/layout/layout.ts';
import { inletRoute, letterTripAt, placeOnTrip, spinePoints } from '../../src/scene/letterTrip.ts';

describe('letter trips', () => {
  it('releases the next letter only after the previous one finishes', () => {
    const count = 4;
    expect(letterTripAt(0, 1000, count)).toEqual({ index: 0, fraction: 0, done: false });
    expect(letterTripAt(249, 1000, count).index).toBe(0);
    expect(letterTripAt(250, 1000, count)).toEqual({ index: 1, fraction: 0, done: false });
    expect(letterTripAt(1000, 1000, count)).toEqual({ index: 4, fraction: 1, done: true });
    for (let step = 0; step < 20; step++) {
      const trip = letterTripAt(step * 50, 1000, count);
      const riding = [...Array(count).keys()].filter((index) => !trip.done && index === trip.index);
      expect(riding).toHaveLength(trip.done ? 0 : 1);
      if (!trip.done) expect(trip.fraction).toBeGreaterThanOrEqual(0);
      if (!trip.done) expect(trip.fraction).toBeLessThan(1);
    }
  });

  it('rides a spine from the inlet down through a gate to the cup', () => {
    const machine = layout(parsePattern('a+', ''));
    const ids = inletRoute(machine, 'cup');
    expect(ids).not.toBeNull();
    const points = spinePoints(machine, ids!);
    expect(points.length).toBeGreaterThan(2);
    expect(points[0].y).toBeGreaterThan(points[points.length - 1].y);
    const kinds = new Set<string>();
    for (let i = 1; i < ids!.length; i++) {
      const edge = machine.graph.edges.find((item) => item.from === ids![i - 1] && item.to === ids![i]);
      if (edge) kinds.add(machine.pieces[edge.piece].kind);
    }
    expect(kinds.has('gate')).toBe(true);
    const hopper = machine.pieces.find((piece) => piece.kind === 'hopper')!.position;
    const cup = machine.pieces.find((piece) => piece.kind === 'cup')!.position;
    const start = placeOnTrip(points, 0, hopper, cup, 0.16);
    const end = placeOnTrip(points, 1, hopper, cup, 0.16);
    expect(start.y).toBeGreaterThan(end.y);
    expect(end.x).toBeCloseTo(cup.x);
    expect(end.y).toBeCloseTo(cup.y);
  });

  it('reaches the cup on preset machines', () => {
    for (const pattern of ['c(a|o)t', '<.+>', 'colou?r', '^(a+)+$', '(?=a)b']) {
      const machine = layout(parsePattern(pattern, ''));
      const ids = inletRoute(machine, 'cup');
      expect(ids, pattern).not.toBeNull();
      expect(ids![0]).not.toBe(ids!.at(-1));
      const points = spinePoints(machine, ids!);
      expect(points[0].y).toBeGreaterThan(points.at(-1)!.y);
    }
  });
});
