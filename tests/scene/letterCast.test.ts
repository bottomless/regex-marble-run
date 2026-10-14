import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { layout } from '../../src/layout/layout.ts';
import type { MachineLayout, PieceKind, Vec3 } from '../../src/layout/pieces.ts';
import { buildTimeline } from '../../src/playback/timeline.ts';
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
  it('drops a miss sideways at the gate instead of riding the match to the cup', () => {
    const { machine, timeline, cast } = ride('<.+>', 'foo');
    const reject = pieceAt(machine, 'rejectTray');
    const cup = pieceAt(machine, 'cup');
    const gate = timeline.segments.find((segment) => segment.kind === 'gate' && segment.ok === false);
    expect(gate).toBeTruthy();
    const mid = castAt(cast, (gate!.t0 + gate!.t1) / 2, null);
    expect(mid[0].kind).toBe('fall');
    expect(Math.abs(mid[0].position.x - reject.x)).toBeLessThan(Math.abs(0 - reject.x));
    expect(mid[0].position.y).toBeGreaterThan(cup.y + 4);
    const done = endAt(cast);
    expect(cast.glyphs).toEqual(['f', 'o', 'o']);
    for (const place of done) {
      expect(place.kind).toBe('reject');
      expect(near(place.position, reject)).toBe(true);
      expect(near(place.position, cup, 1.2)).toBe(false);
    }
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
    expect(during[5].kind).not.toBe('fall');
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
});
