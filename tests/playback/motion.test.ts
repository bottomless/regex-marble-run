import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { layout } from '../../src/layout/layout.ts';
import type { MachineLayout, Vec3 } from '../../src/layout/pieces.ts';
import { buildTimeline, type Timeline } from '../../src/playback/timeline.ts';
import {
  pointAlongPolyline,
  polylineLength,
  poseAtIndex,
  poseAtTime,
  poseForSegment,
} from '../../src/playback/motion.ts';
import { PRESETS } from '../../src/presets.ts';

function v(x: number, y: number, z = 0): Vec3 {
  return { x, y, z };
}

function finite(p: Vec3): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

interface Built {
  ml: MachineLayout;
  timeline: Timeline;
  eventCount: number;
}

const built = new Map<string, Built>();

function build(pattern: string, flags: string, input: string): Built {
  const key = `${pattern}\u0000${flags}\u0000${input}`;
  const cached = built.get(key);
  if (cached) return cached;
  const prog = parsePattern(pattern, flags);
  const { trace } = runBacktrack(prog, input);
  const ml = layout(prog);
  const timeline = buildTimeline(trace, ml, { speed: 1 });
  const value = { ml, timeline, eventCount: trace.length };
  built.set(key, value);
  return value;
}

const presetBuilds = PRESETS.filter((p) => p.number <= 5).map((p) => [p.id, build(p.pattern, p.flags, p.input)] as const);
const extraBuilds = [
  ['nomatch', build('x', '', 'abc')],
  ['greedy-backtrack', build('<.+>', '', '<b>bold</b>')],
  ['lookahead', build('a(?=b)c', '', 'abc')],
  ['bounded-repeat', build('a{2,4}b', '', 'aaab')],
] as const;
const allBuilds = [...presetBuilds, ...extraBuilds];

describe('pointAlongPolyline', () => {
  it('returns endpoints at fraction 0 and 1', () => {
    const line = [v(0, 0), v(10, 0)];
    expect(pointAlongPolyline(line, 0)!.position).toEqual(v(0, 0));
    expect(pointAlongPolyline(line, 1)!.position).toEqual(v(10, 0));
  });

  it('interpolates by arc length, not by point index', () => {
    // First segment is 9 units, second is 1 unit; fraction 0.5 is 5 units in -> still on segment 1.
    const line = [v(0, 0), v(9, 0), v(10, 0)];
    const mid = pointAlongPolyline(line, 0.5)!;
    expect(mid.position.x).toBeCloseTo(5, 6);
    expect(polylineLength(line)).toBe(10);
  });

  it('gives the correct tangent direction', () => {
    const line = [v(0, 0, 0), v(0, -3, 0)];
    const dir = pointAlongPolyline(line, 0.5)!.direction!;
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.y).toBeCloseTo(-1, 6);
  });

  it('clamps out-of-range fractions', () => {
    const line = [v(0, 0), v(4, 0)];
    expect(pointAlongPolyline(line, -1)!.position).toEqual(v(0, 0));
    expect(pointAlongPolyline(line, 2)!.position).toEqual(v(4, 0));
  });

  it('handles single-point and empty polylines', () => {
    expect(pointAlongPolyline([], 0.5)).toBeNull();
    const single = pointAlongPolyline([v(2, 3)], 0.5)!;
    expect(single.position).toEqual(v(2, 3));
    expect(single.direction).toBeNull();
  });

  it('handles a zero-length (repeated point) polyline', () => {
    const line = [v(1, 1), v(1, 1)];
    const at = pointAlongPolyline(line, 0.5)!;
    expect(at.position).toEqual(v(1, 1));
    expect(at.direction).toBeNull();
  });

  it('traverses a multi-segment 3D path in order', () => {
    const path = [v(0, 0, 0), v(0, -2, 0), v(3, -2, 0), v(3, -2, 4)];
    expect(polylineLength(path)).toBeCloseTo(9, 6);
    const quarter = pointAlongPolyline(path, 2 / 9)!.position;
    expect(quarter.x).toBeCloseTo(0, 6);
    expect(quarter.y).toBeCloseTo(-2, 6);
    const last = pointAlongPolyline(path, 1)!.position;
    expect(last).toEqual(v(3, -2, 4));
  });
});

describe('poseForSegment (synthetic)', () => {
  it('returns null for capture segments', () => {
    const { ml, timeline } = build('(a)b', '', 'ab');
    const capture = timeline.segments.find((s) => s.kind === 'capture');
    expect(capture).toBeTruthy();
    expect(poseForSegment(ml, capture!, 0.5)).toBeNull();
  });

  it('places a gate pose at the anchor gate with a downward direction', () => {
    const { ml, timeline } = build('ab', '', 'ab');
    const gate = timeline.segments.find((s) => s.kind === 'gate' && s.node !== null)!;
    const pose = poseForSegment(ml, gate, 0)!;
    const anchor = ml.anchors[gate.node!];
    expect(pose.position).toEqual(anchor.gate!);
    expect(pose.moving).toBe(false);
    expect(pose.direction).not.toBeNull();
    expect(pose.direction!.y).toBeLessThan(0);
  });

  it('marks travel segments as moving and pins endpoints to the route', () => {
    const { ml, timeline } = build('<.+>', '', '<b>bold</b>');
    const travel = timeline.segments.find((s) => (s.kind === 'roll' || s.kind === 'lift') && s.route)!;
    const start = poseForSegment(ml, travel, 0)!;
    const end = poseForSegment(ml, travel, 1)!;
    expect(start.moving).toBe(true);
    expect(end.moving).toBe(true);
    expect(start.position).toEqual(ml.graph.points[travel.route![0]].position);
    expect(end.position).toEqual(ml.graph.points[travel.route![travel.route!.length - 1]].position);
  });

  it('places hop at the hopper and finish at the cup or reject tray', () => {
    const match = build('ab', '', 'ab');
    const hop = match.timeline.segments.find((s) => s.kind === 'hop')!;
    const hopper = match.ml.pieces.find((p) => p.kind === 'hopper')!;
    expect(poseForSegment(match.ml, hop, 0)!.position).toEqual(hopper.position);

    const finish = match.timeline.segments.find((s) => s.kind === 'finish')!;
    const cup = match.ml.pieces.find((p) => p.kind === 'cup')!;
    expect(finish.result).toBe('match');
    expect(poseForSegment(match.ml, finish, 0)!.position).toEqual(cup.position);

    const reject = build('x', '', 'abc');
    const rfinish = reject.timeline.segments.find((s) => s.kind === 'finish')!;
    const tray = reject.ml.pieces.find((p) => p.kind === 'rejectTray')!;
    expect(rfinish.result).toBe('reject');
    expect(poseForSegment(reject.ml, rfinish, 0)!.position).toEqual(tray.position);
  });
});

describe.each(allBuilds)('pose over %s', (_id, b) => {
  it('produces a finite pose for every segment at both ends', () => {
    for (let i = 0; i < b.timeline.segments.length; i++) {
      for (const f of [0, 0.5, 1]) {
        const pose = poseAtIndex(b.ml, b.timeline, i, f);
        expect(pose, `segment ${i} fraction ${f}`).not.toBeNull();
        expect(finite(pose!.position), `segment ${i} fraction ${f}`).toBe(true);
        if (pose!.direction) {
          const len = Math.hypot(pose!.direction!.x, pose!.direction!.y, pose!.direction!.z);
          expect(len).toBeCloseTo(1, 5);
        }
      }
    }
  });

  it('poseAtIndex holds the previous pose across position-less segments', () => {
    // Walk forward; a capture (null pose) must inherit a real pose, never null.
    for (let i = 0; i < b.timeline.segments.length; i++) {
      const seg = b.timeline.segments[i];
      if (seg.kind !== 'capture') continue;
      const held = poseAtIndex(b.ml, b.timeline, i, 0.5);
      expect(held).not.toBeNull();
      // It equals the pose at the end of the nearest preceding resolvable segment.
      let j = i - 1;
      while (j >= 0 && poseForSegment(b.ml, b.timeline.segments[j], 1) === null) j--;
      if (j >= 0) expect(held!.position).toEqual(poseForSegment(b.ml, b.timeline.segments[j], 1)!.position);
    }
  });

  it('poseAtTime is finite across the whole duration and monotonic in coverage', () => {
    const steps = 50;
    for (let k = 0; k <= steps; k++) {
      const time = (k / steps) * b.timeline.duration;
      const pose = poseAtTime(b.ml, b.timeline, time);
      expect(pose, `time ${time}`).not.toBeNull();
      expect(finite(pose!.position), `time ${time}`).toBe(true);
    }
    // Before the start and after the end clamp safely.
    expect(poseAtTime(b.ml, b.timeline, -100)).not.toBeNull();
    expect(poseAtTime(b.ml, b.timeline, b.timeline.duration + 100)).not.toBeNull();
  });

  it('travel poses stay within the route bounding box', () => {
    for (const seg of b.timeline.segments) {
      if (!seg.route || seg.route.length < 2) continue;
      const pts = seg.route.map((id) => b.ml.graph.points[id].position);
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const p of pts) {
        min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
      }
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const p = poseForSegment(b.ml, seg, f)!.position;
        const e = 1e-6;
        expect(p.x).toBeGreaterThanOrEqual(min.x - e);
        expect(p.x).toBeLessThanOrEqual(max.x + e);
        expect(p.y).toBeGreaterThanOrEqual(min.y - e);
        expect(p.y).toBeLessThanOrEqual(max.y + e);
        expect(p.z).toBeGreaterThanOrEqual(min.z - e);
        expect(p.z).toBeLessThanOrEqual(max.z + e);
      }
    }
  });
});

describe('poseAtIndex edge cases', () => {
  it('clamps out-of-range segment indices', () => {
    const { ml, timeline } = build('ab', '', 'ab');
    const first = poseAtIndex(ml, timeline, 0, 0)!;
    expect(poseAtIndex(ml, timeline, -5, 0)!.position).toEqual(first.position);
    const last = poseAtIndex(ml, timeline, timeline.segments.length - 1, 1)!;
    expect(poseAtIndex(ml, timeline, timeline.segments.length + 99, 1)!.position).toEqual(last.position);
  });

  it('returns null for an empty timeline', () => {
    const prog = parsePattern('a', '');
    const ml = layout(prog);
    const empty = buildTimeline(
      {
        length: 0,
        t: new Uint8Array(0),
        a: new Int32Array(0),
        b: new Int32Array(0),
        c: new Int32Array(0),
        d: new Int32Array(0),
        checkpoints: new Int32Array(0),
        checkpointCount: 0,
        truncated: false,
      },
      ml,
      { speed: 1 },
    );
    expect(poseAtIndex(ml, empty, 0, 0)).toBeNull();
    expect(poseAtTime(ml, empty, 0)).toBeNull();
  });
});
