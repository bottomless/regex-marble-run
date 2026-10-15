import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { layout, STAIR_STEP } from '../../src/layout/layout.ts';
import { rejectionPath } from '../../src/layout/route.ts';
import { Ride } from '../../src/scene/ride.ts';
import type { MachineLayout, PieceKind, Vec3 } from '../../src/layout/pieces.ts';
import { polylineLength } from '../../src/playback/motion.ts';
import { buildTimeline, ROLL_PER_UNIT_MS } from '../../src/playback/timeline.ts';
import { copy } from '../../src/copy.ts';
import { castAt, compileCast, hiddenLoopPieces, type LetterCast } from '../../src/scene/letterCast.ts';

const LOOP: PieceKind[] = ['bypassChute', 'returnRail', 'loopLift', 'backLift'];

function ride(pattern: string, input: string) {
  const program = parsePattern(pattern, '');
  const { trace } = runBacktrack(program, input);
  const machine = layout(program);
  const timeline = buildTimeline(trace, machine);
  const cast = compileCast(trace, timeline, machine, input, false);
  return { machine, timeline, cast };
}

function pieceAt(machine: MachineLayout, kind: PieceKind): Vec3 {
  const piece = machine.pieces.find((item) => item.kind === kind);
  if (!piece) throw new Error(kind);
  return piece.position;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function near(a: Vec3, b: Vec3, limit = 1.6): boolean {
  return dist(a, b) < limit;
}

function endAt(cast: LetterCast) {
  return castAt(cast, Number.MAX_SAFE_INTEGER, null);
}

describe('letter cast', () => {
  it('diverts a miss from its gate onto the rejection channel instead of flying to the tray', () => {
    const { machine, timeline, cast } = ride('<.+>', 'foo');
    const reject = pieceAt(machine, 'rejectTray');
    const cup = pieceAt(machine, 'cup');
    const gate = timeline.segments.find((segment) => segment.kind === 'gate' && segment.ok === false);
    expect(gate).toBeTruthy();
    const mid = castAt(cast, (gate!.t0 + gate!.t1) / 2, null);
    expect(mid[0].kind).toBe('discard');
    expect(mid[0].riding).toBe(true);
    const outlet = machine.anchors[gate!.node!].exit;
    const rejected = cast.spans[0].find((span) => span.kind === 'discard')!;
    expect(rejected.route).toEqual(rejectionPath(machine, outlet));
    expect(mid[0].position.y).toBeLessThan(machine.anchors[gate!.node!].gate!.y);
    expect(mid[0].position.y).toBeGreaterThan(cup.y + 4);
    const done = endAt(cast);
    expect(cast.glyphs).toEqual(['f', 'o', 'o']);
    for (const place of done) {
      expect(place.kind).toBe('reject');
      expect(near(place.position, reject)).toBe(true);
      expect(near(place.position, cup, 1.2)).toBe(false);
    }
  });

  it.each([
    ['<.+>', 'foo'],
    ['ab', 'ac'],
    ['a+b', 'aaac'],
    ['c(a|o)t', 'cut'],
    ['a(?=b)c', 'abc'],
    ['^ab$', 'abx'],
    ['^a(?!b)', 'ab'],
    ['(\\w)\\1', 'hello'],
  ])('keeps discarded marbles on rendered rejection tracks for %s on %s', (pattern, input) => {
    const { machine, timeline, cast } = ride(pattern, input);
    const spline = new Ride(machine);
    const tray = machine.graph.edges.find((edge) => machine.pieces[edge.piece].kind === 'rejectTray')!;
    const hidden = hiddenLoopPieces(machine, timeline);
    const discarded = cast.spans.flat().filter((span) => span.kind === 'discard');
    expect(discarded.length).toBeGreaterThan(0);
    for (const span of discarded) {
      expect(span.route!.at(-1)).toBe(tray.to);
      for (let i = 1; i < span.route!.length; i++) {
        const edge = machine.graph.edges.find(
          (item) => item.from === span.route![i - 1] && item.to === span.route![i],
        )!;
        expect(edge).toBeDefined();
        expect(['rejectChute', 'rejectTray']).toContain(machine.pieces[edge.piece].kind);
        expect(hidden.has(edge.piece)).toBe(false);
      }
      const rail = spline.points(span.route!).map((point) => ({ ...point, y: point.y + 0.16 }));
      const first = span.points!.findIndex((point) => dist(point, rail[0]) < 1e-8);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThanOrEqual(1);
      expect(span.points!.slice(first, first + rail.length)).toEqual(rail);
      expect(span.points!.length).toBe(first + rail.length + 1);
      expect(dist(span.points!.at(-1)!, rail.at(-1)!)).toBeLessThan(1.3);
      expect(span.t1).toBeLessThanOrEqual(timeline.duration);
    }
    const done = castAt(cast, timeline.duration, null);
    for (let tile = 0; tile < cast.spans.length; tile++) {
      if (cast.spans[tile].some((span) => span.kind === 'discard')) {
        expect(done[tile].kind).toBe('reject');
        expect(near(done[tile].position, pieceAt(machine, 'rejectTray'))).toBe(true);
      }
    }
  });

  it.each([
    ['abcdefgh', 'abcdefgx'],
    ['abcdefghijklm', 'abcdefghijklx'],
    ['^ab$', 'abx'],
    ['^a+b$', 'aaaaaaaaax'],
    [`^(${'a'.repeat(13)})${'b'.repeat(68)}$`, `${'a'.repeat(13)}x`],
    ['c(a|o)t', 'cut'],
    ['^a(?=b)', 'ab'],
  ])('drains held marbles downhill onto rendered rejection tracks for %s on %s', (pattern, input) => {
    const { machine, timeline, cast } = ride(pattern, input);
    const spline = new Ride(machine);
    const tray = machine.graph.edges.find((edge) => machine.pieces[edge.piece].kind === 'rejectTray')!;
    let drained = 0;
    cast.spans.forEach((spans, tile) => {
      spans.forEach((span, index) => {
        const held = spans[index - 1];
        if (span.kind !== 'discard' || held?.kind !== 'park') return;
        drained++;
        const anchor = Object.values(machine.anchors).find((item) => item.rejectionPort === span.route![0]);
        expect(anchor).toBeDefined();
        expect(span.route).toEqual(rejectionPath(machine, anchor!.rejectionPort!));
        expect(span.route).not.toContain(anchor!.exit);
        expect(span.route!.at(-1)).toBe(tray.to);
        expect(span.from).toEqual(held.at);
        expect(span.t0).toBe(held.t1);
        const rail = spline.points(span.route!).map((point) => ({ ...point, y: point.y + 0.16 }));
        expect(span.points![1]).toEqual(rail[0]);
        expect(dist(span.from!, rail[0])).toBeLessThan(0.8);
        const drain = [span.from!, ...rail];
        for (let i = 1; i < drain.length; i++) {
          expect(drain[i].y).toBeLessThanOrEqual(drain[i - 1].y + 1e-8);
        }
        for (let i = 1; i < span.route!.length; i++) {
          const edge = machine.graph.edges.find(
            (item) => item.from === span.route![i - 1] && item.to === span.route![i],
          )!;
          expect(['rejectChute', 'rejectTray']).toContain(machine.pieces[edge.piece].kind);
          expect(machine.pieces[edge.piece].points![0]).toEqual(machine.graph.points[edge.from].position);
          expect(machine.pieces[edge.piece].points!.at(-1)).toEqual(machine.graph.points[edge.to].position);
        }
        expect(dist(castAt(cast, span.t0 - 0.01, null)[tile].position, castAt(cast, span.t0 + 0.01, null)[tile].position)).toBeLessThan(0.001);
        expect(span.t1).toBeLessThanOrEqual(timeline.duration);
        expect(castAt(cast, timeline.duration, null)[tile].kind).toBe('reject');
      });
    });
    expect(drained).toBeGreaterThan(0);
  });

  it('keeps a failed branch on the lift, then sends only the match to the cup', () => {
    const { machine, timeline, cast } = ride('c(a|o)t', 'the cot');
    const cup = pieceAt(machine, 'cup');
    const reject = pieceAt(machine, 'rejectTray');
    const hopper = pieceAt(machine, 'hopper');
    const failed = timeline.segments.find((segment) => segment.kind === 'gate' && segment.pos === 5 && segment.ok === false);
    expect(failed).toBeTruthy();
    const during = castAt(cast, (failed!.t0 + failed!.t1) / 2, { x: 0.6, y: -5.9, z: 0 });
    expect(during[5].kind === 'follow' || during[5].kind === 'approach').toBe(true);
    expect(during[5].kind).not.toBe('discard');
    const passed = timeline.segments.find((segment) => segment.kind === 'gate' && segment.pos === 4 && segment.ok === true);
    expect(passed).toBeTruthy();
    const parked = castAt(cast, passed!.t1 + 1, null);
    expect(parked[4].kind).toBe('park');
    expect(dist(parked[4].position, cup)).toBeGreaterThan(dist(parked[4].position, hopper) * 0.2);
    expect(near(parked[4].position, cup, 2)).toBe(false);
    const done = endAt(cast);
    expect(cast.glyphs).toEqual(['t', 'h', 'e', ' ', 'c', 'o', 't']);
    for (let i = 0; i < 4; i++) {
      expect(done[i].kind).toBe('reject');
      expect(near(done[i].position, reject)).toBe(true);
    }
    for (let i = 4; i < 7; i++) {
      expect(done[i].kind).toBe('park');
      expect(near(done[i].position, cup)).toBe(true);
      expect(near(done[i].position, reject, 1.2)).toBe(false);
    }
  });

  it('rolls a loop match to the cup and leaves an untested tail in the hopper', () => {
    const matched = ride('<.+>', '<b>');
    const cup = pieceAt(matched.machine, 'cup');
    const reject = pieceAt(matched.machine, 'rejectTray');
    for (const place of endAt(matched.cast)) {
      expect(place.kind).toBe('park');
      expect(near(place.position, cup)).toBe(true);
      expect(near(place.position, reject, 1.2)).toBe(false);
    }
    const tail = ride('a', 'ab');
    const hopper = pieceAt(tail.machine, 'hopper');
    const done = endAt(tail.cast);
    expect(done[0].kind).toBe('park');
    expect(near(done[0].position, pieceAt(tail.machine, 'cup'))).toBe(true);
    expect(done[1].kind).toBe('hold');
    expect(near(done[1].position, hopper, 1.2)).toBe(true);
    expect(done[1].kind).not.toBe('reject');
  });

  it('shows loop rails only when a timeline route uses them', () => {
    const miss = ride('<.+>', 'foo');
    const hit = ride('<.+>', '<b>');
    const hiddenMiss = hiddenLoopPieces(miss.machine, miss.timeline);
    const hiddenHit = hiddenLoopPieces(hit.machine, hit.timeline);
    const loopIndexes = (machine: MachineLayout) =>
      machine.pieces.flatMap((piece, index) => (LOOP.includes(piece.kind) ? [index] : []));
    expect(loopIndexes(miss.machine).every((index) => hiddenMiss.has(index))).toBe(true);
    expect(loopIndexes(hit.machine).some((index) => !hiddenHit.has(index))).toBe(true);
    expect(hiddenLoopPieces(hit.machine, null).size).toBe(loopIndexes(hit.machine).length);
  });

  it('caps the hopper and the number of letter marbles', () => {
    const long = ride('a', 'a'.repeat(40));
    expect(long.cast.glyphs).toHaveLength(36);
    const waiting = castAt(long.cast, 0, null);
    expect(waiting.filter((place) => place.kind === 'hold' && place.visible)).toHaveLength(8);
    expect(waiting.some((place) => place.kind === 'hold' && !place.visible)).toBe(true);
  });

  it('moves every marble continuously without jumping across presets and backtracking', () => {
    const cases: [string, string][] = [
      ['c(a|o)t', 'the cot'],
      ['<.+>', '<b>bold</b>'],
      ['<.+?>', '<b>bold</b>'],
      ['colou?r', 'my color'],
      ['(\\w)\\1', 'hello'],
      ['a+b', 'aaac'],
    ];
    const dt = 10;
    const expectedSpeed = 1 / ROLL_PER_UNIT_MS;
    const maxStep = expectedSpeed * dt * 1.05 + 1e-4;
    for (const [pattern, input] of cases) {
      const { timeline, cast } = ride(pattern, input);
      let prev = castAt(cast, 0, null);
      for (let t = dt; t <= timeline.duration + 400; t += dt) {
        const curr = castAt(cast, t, null);
        for (let i = 0; i < curr.length; i++) {
          const step = dist(prev[i].position, curr[i].position);
          expect(step, `${pattern} on ${input} tile ${i} at t=${t}`).toBeLessThanOrEqual(maxStep);
        }
        prev = curr;
      }
    }
  });

  it('maintains identical constant marble speed regardless of marble count or machine complexity', () => {
    const expectedSpeed = 1 / ROLL_PER_UNIT_MS;
    const runs = [
      ride('a', 'a'),
      ride('a', 'a'.repeat(24)),
      ride('c(a|o)t', 'the cot'),
      ride('<.+>', '<b>bold</b>'),
      ride('^(?=.*\\d)(?=.*[a-z]).{8,}$', 'hunter22x'),
    ];
    for (const { cast } of runs) {
      for (const tileSpans of cast.spans) {
        for (const span of tileSpans) {
          if (!span.points || span.points.length < 2) continue;
          const length = polylineLength(span.points);
          const duration = span.t1 - span.t0;
          expect(duration).toBeGreaterThan(0);
          expect(length / duration).toBeCloseTo(expectedSpeed, 5);
        }
      }
    }
  });

  it('gathers accepted marbles in gate holding containers and settles matches in the wide success container', () => {
    expect(STAIR_STEP).toBeGreaterThan(2.4);
    expect(copy.scene.match).toBe('SUCCESS');
    expect(copy.scene.hold).toBe('HOLD');
    const { machine, timeline, cast } = ride('c(a|o)t', 'the cot');
    const cGate = machine.pieces.find((piece) => piece.kind === 'gate' && piece.label === 'c')!;
    const passedC = timeline.segments.find((segment) => segment.kind === 'gate' && segment.pos === 4 && segment.ok === true)!;
    const heldAtC = castAt(cast, passedC.t1 + 1, null)[4];
    expect(heldAtC.kind).toBe('park');
    expect(heldAtC.position.y).toBeLessThan(cGate.position.y);
    expect(heldAtC.position.z).toBeGreaterThan(cGate.position.z);
  });

  it('releases multiple gathered marbles from a gate as a separated rolling train instead of overlapping as one', () => {
    const { timeline, cast } = ride('<.+>', '<b>bold</b>');
    const finish = timeline.segments.find((segment) => segment.kind === 'finish')!;
    expect(finish).toBeTruthy();
    const midCup = castAt(cast, finish.t0 + 450, null);
    const rolling = midCup.filter((place) => place.kind === 'cup');
    expect(rolling.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < rolling.length; i++) {
      for (let j = i + 1; j < rolling.length; j++) {
        expect(dist(rolling[i].position, rolling[j].position)).toBeGreaterThan(0.35);
      }
    }
  });

  it('routes every marble along connected spline tracks without straight-line shortcuts across components', () => {
    const cases: [string, string][] = [
      ['<.+>', '<b>bold</b>'],
      ['<.+?>', '<b>bold</b>'],
      ['c(a|o)t', 'the cot'],
      ['colou?r', 'my color'],
      ['(\\w)\\1', 'hello'],
      ['^(?=.*\\d)(?=.*[a-z]).{8,}$', 'hunter22x'],
      ['a+b', 'aaac'],
      ['a{2,4}b', 'aaab'],
      ['a(?=b)c', 'abc'],
      ['a(?!b)', 'abac'],
      ['(a)+b', 'aab'],
    ];
    for (const [pattern, input] of cases) {
      const { cast } = ride(pattern, input);
      cast.spans.forEach((spans, tile) => {
        spans.forEach((span, spanIdx) => {
          if (!span.points) return;
          for (let k = 1; k < span.points.length; k++) {
            const step = dist(span.points[k - 1], span.points[k]);
            expect(
              step,
              `${pattern} on "${input}" tile ${tile} (${cast.glyphs[tile]}) span ${spanIdx} (${span.kind})`,
            ).toBeLessThanOrEqual(1.4);
          }
        });
      });
    }
    const greedy = ride('<.+>', '<b>bold</b>');
    const lastTileMoving = greedy.cast.spans[10].filter((span) => span.points && span.points.length >= 2);
    expect(lastTileMoving.map((span) => span.kind)).toEqual(['follow', 'follow', 'cup']);
    for (const pt of lastTileMoving[1].points!) {
      expect(pt.y).toBeLessThanOrEqual(-5.5);
    }
  });
});
