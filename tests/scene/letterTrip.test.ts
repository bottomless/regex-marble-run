import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { layout } from '../../src/layout/layout.ts';
import { inletRoute, letterLands, letterTripAt, placeOnTrip, riddenPieces, spinePoints } from '../../src/scene/letterTrip.ts';

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

  it('sends a miss to the reject tray and a hit only for accepted letters', () => {
    expect(letterLands(false, -1, -1, 0, 1)).toBe('rejectTray');
    expect(letterLands(true, 4, 7, 0, 1)).toBe('rejectTray');
    expect(letterLands(true, 4, 7, 4, 1)).toBe('cup');
    expect(letterLands(true, 4, 7, 6, 1)).toBe('cup');
    expect(letterLands(true, 4, 7, 7, 1)).toBe('rejectTray');

    const machine = layout(parsePattern('a+', ''));
    const ids = inletRoute(machine, 'rejectTray');
    expect(ids).not.toBeNull();
    const points = spinePoints(machine, ids!);
    const reject = machine.pieces.find((piece) => piece.kind === 'rejectTray')!.position;
    const cup = machine.pieces.find((piece) => piece.kind === 'cup')!.position;
    const kinds = new Set<string>();
    for (let i = 1; i < ids!.length; i++) {
      const edge = machine.graph.edges.find((item) => item.from === ids![i - 1] && item.to === ids![i]);
      if (edge) kinds.add(machine.pieces[edge.piece].kind);
    }
    expect(kinds.has('rejectTray')).toBe(true);
    expect(points.at(-1)!.x).toBeCloseTo(reject.x);
    expect(Math.hypot(points.at(-1)!.x - cup.x, points.at(-1)!.z - cup.z)).toBeGreaterThan(1);
    const end = placeOnTrip(points, 1, machine.pieces[0].position, reject, 0.16);
    expect(end.x).toBeCloseTo(reject.x);
    expect(end.y).toBeCloseTo(reject.y);
  });

  it('leaves the loop return and side chute off the letter ride', () => {
    const machine = layout(parsePattern('<.+>', ''));
    const ridden = riddenPieces(machine);
    expect(ridden).not.toBeNull();
    const kinds = new Set([...ridden!].map((index) => machine.pieces[index].kind));
    expect(kinds.has('gate')).toBe(true);
    expect(kinds.has('rejectTray')).toBe(true);
    expect(kinds.has('bypassChute')).toBe(false);
    expect(kinds.has('returnRail')).toBe(false);
    expect(kinds.has('loopLift')).toBe(false);
    expect(kinds.has('backLift')).toBe(false);
  });
});
