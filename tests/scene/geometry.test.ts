import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { parsePattern } from '../../src/engine/parse.ts';
import { layout } from '../../src/layout/layout.ts';
import { PRESETS } from '../../src/presets.ts';
import { buildTrackBatches, CHANNEL, displayMetrics, MARBLE_LIFT, REJECTION_CHANNEL, SPRING_COIL_RADIUS, SPRING_PLATE_DEPTH, SPRING_PLATE_RADIUS, SPRING_TUBE_RADIUS, SPRING_WELL, springCoilGeometry, springLaunchers, sweepFrames, trackCurve, visibleTiles } from '../../src/scene/geometry.ts';
import { cameraPose } from '../../src/scene/Camera.tsx';

for (const preset of PRESETS) {
  describe(`scene geometry: ${preset.id}`, () => {
    const machine = layout(parsePattern(preset.pattern, preset.flags));
    it('builds merged, finite track geometry in bounds for every preset', () => {
      const batches = buildTrackBatches(machine);
      expect(batches.length).toBeGreaterThan(0);
      expect(batches.length).toBeLessThanOrEqual(8);
      expect(new Set(batches.map((batch) => batch.finish)).size).toBe(batches.length);
      for (const batch of batches) {
        batch.geometry.computeBoundingBox();
        const box = batch.geometry.boundingBox!;
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(Number.isFinite(box.min[axis])).toBe(true);
          expect(Number.isFinite(box.max[axis])).toBe(true);
          expect(box.min[axis]).toBeGreaterThanOrEqual(machine.bounds.min[axis] - 0.01);
          expect(box.max[axis]).toBeLessThanOrEqual(machine.bounds.max[axis] + 0.01);
        }
        batch.geometry.dispose();
      }
    });

    it('frames both the machine and base at desktop and mobile aspect ratios', () => {
      const metrics = displayMetrics(machine);
      const floodMetrics = displayMetrics(machine, { flood: true });
      expect(metrics.tank).toBeNull();
      expect(floodMetrics.tank).toBeNull();
      expect(floodMetrics.boardWidth).toBe(metrics.boardWidth);
      expect(metrics.height).toBeLessThanOrEqual(11);
      expect(metrics.offset.every(Number.isFinite)).toBe(true);
      for (const aspect of [390 / 520, 844 / 390, (1440 - 344) / 900]) {
        const pose = cameraPose(metrics, aspect);
        expect(pose.distance).toBeGreaterThan(0);
        const direction = pose.position.clone().sub(pose.target).normalize();
        const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
        const up = new Vector3().crossVectors(direction, right);
        const slope = Math.tan((42 * Math.PI) / 360);
        for (const [width, depth, top, bottom] of [
          [metrics.width, metrics.depth, metrics.height + 0.6, 0.6],
          [metrics.boardWidth, metrics.boardDepth, 0.6, 0],
        ]) {
          for (const x of [-width / 2, width / 2])
            for (const y of [bottom, top])
              for (const z of [-depth / 2, depth / 2]) {
                const corner = new Vector3(x, y, z).sub(pose.target);
                const distance = pose.distance - corner.dot(direction);
                expect(Math.abs(corner.dot(right)) / distance / slope / aspect).toBeLessThan(1);
                expect(Math.abs(corner.dot(up)) / distance / slope).toBeLessThan(1);
              }
        }
      }
    });
  });
}

describe('rejection channels', () => {
  it('uses muted wood for rejection beds and lips, including scout feeders and the tray inlet', () => {
    const machine = layout(parsePattern('(?=(a|b)+)c', ''));
    const chutes = machine.pieces.filter((piece) => piece.kind === 'rejectChute' || piece.kind === 'rejectTray');
    expect(chutes.length).toBeGreaterThan(0);
    const batches = buildTrackBatches({
      ...machine,
      pieces: chutes.map((piece) => ({ ...piece, role: 'look' })),
    });
    expect(batches.map((batch) => batch.finish)).toEqual(['edge']);
    for (const batch of batches) {
      expect(Array.from(batch.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      batch.geometry.dispose();
    }
  });

  it('keeps the rejection bed clear of the marble on sloped feeders and vertical collectors', () => {
    const machine = layout(parsePattern('abcdefgh', ''));
    const chutes = machine.pieces.filter((piece) => piece.kind === 'rejectChute' || piece.kind === 'rejectTray');
    expect(chutes.some((piece) => piece.points![0].x === piece.points![1].x &&
      piece.points![0].z === piece.points![1].z)).toBe(true);
    for (const piece of chutes) {
      const curve = trackCurve(piece.points!);
      const normal = sweepFrames(curve, 1)[0].up;
      const marble = curve.getPointAt(0.5).add(new Vector3(0, MARBLE_LIFT, 0));
      const [batch] = buildTrackBatches({ ...machine, pieces: [piece] });
      const positions = batch.geometry.getAttribute('position');
      let bedSurface = -Infinity;
      for (let i = 0; i < positions.count / 3; i++) {
        bedSurface = Math.max(bedSurface, new Vector3().fromBufferAttribute(positions, i).dot(normal));
      }
      expect(marble.dot(normal) - bedSurface).toBeCloseTo(MARBLE_LIFT, 5);
      batch.geometry.dispose();
    }
  });

  it('makes the rear channels narrower while keeping room for a letter marble', () => {
    expect(REJECTION_CHANNEL.halfWidth - REJECTION_CHANNEL.lipWidth).toBeGreaterThan(0.18);
    expect(REJECTION_CHANNEL.halfWidth).toBeLessThan(CHANNEL.halfWidth);
    expect(REJECTION_CHANNEL.lipHeight).toBeLessThan(CHANNEL.lipHeight);
    const machine = layout(parsePattern('ab', ''));
    const spine = machine.pieces.find((piece) => piece.kind === 'rejectChute' &&
      piece.points![0].x === piece.points![1].x && piece.points![0].z === piece.points![1].z)!;
    const [batch] = buildTrackBatches({ ...machine, pieces: [spine] });
    batch.geometry.computeBoundingBox();
    const bounds = batch.geometry.boundingBox!;
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(REJECTION_CHANNEL.halfWidth * 2, 6);
    batch.geometry.dispose();
  });
});

describe('loop return routes', () => {
  const machine = layout(parsePattern('(a)+b', ''));

  it('builds backtracking rails and lifts as open channels like the forward routes', () => {
    const loops = machine.pieces.filter((piece) =>
      ['returnRail', 'backLift', 'loopLift'].includes(piece.kind),
    );
    expect(loops.map((piece) => piece.kind)).toEqual(expect.arrayContaining(['returnRail', 'loopLift']));
    const batches = buildTrackBatches({ ...machine, pieces: loops });
    expect(batches.length).toBeGreaterThan(0);
    for (const batch of batches) {
      expect(batch.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(Array.from(batch.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      batch.geometry.dispose();
    }
  });

  it('opens lift shafts toward the viewer so the climbing marble stays visible', () => {
    const lift = machine.pieces.find((piece) => piece.kind === 'loopLift')!;
    const curve = trackCurve(lift.points!);
    const frames = sweepFrames(curve, 24, { face: new Vector3(0, 0, 1) });
    const shaft = frames.slice(1).filter((frame, i) => {
      const step = frame.p.clone().sub(frames[i].p).normalize();
      return Math.abs(step.y) > 0.95;
    });
    expect(shaft.length).toBeGreaterThan(0);
    for (const frame of shaft) expect(frame.up.z).toBeGreaterThan(0.9);
  });

  it('places one spring launcher at the foot of every lift, below the plate', () => {
    for (const preset of [machine, layout(parsePattern('c(a|o)t', '')), layout(parsePattern('(?:ab|a)+c', ''))]) {
      const lifts = preset.pieces.flatMap((piece, index) => (['backLift', 'loopLift'].includes(piece.kind) ? [index] : []));
      const launchers = springLaunchers(preset);
      expect(launchers.map((launcher) => launcher.piece)).toEqual(lifts);
      for (const launcher of launchers) {
        expect(launcher.foot).toEqual(preset.pieces[launcher.piece].points![0]);
        expect(launcher.base.y).toBeCloseTo(launcher.foot.y - SPRING_WELL);
        expect(launcher.base.y + launcher.rest + SPRING_PLATE_DEPTH).toBeCloseTo(launcher.foot.y);
        expect(launcher.stroke).toBeGreaterThan(0);
        expect(launcher.release).toBeGreaterThan(0);
      }
    }
  });

  it('builds a finite coil that fits inside the plate', () => {
    for (const length of [0.2, 0.51, 1.1]) {
      const geometry = springCoilGeometry(length);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      expect(box.min.y).toBeGreaterThanOrEqual(-SPRING_TUBE_RADIUS - 1e-6);
      expect(box.max.y).toBeLessThanOrEqual(length + SPRING_TUBE_RADIUS + 1e-6);
      const position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        expect(Math.hypot(position.getX(i), position.getZ(i))).toBeLessThanOrEqual(SPRING_COIL_RADIUS + SPRING_TUBE_RADIUS + 1e-6);
      }
      expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      geometry.dispose();
    }
    expect(SPRING_COIL_RADIUS + SPRING_TUBE_RADIUS).toBeLessThanOrEqual(SPRING_PLATE_RADIUS);
    expect(SPRING_PLATE_RADIUS).toBeLessThan(CHANNEL.halfWidth);
  });
});

describe('static input rail', () => {
  it('retains UTF-16 indices with Unicode code points', () => {
    expect(visibleTiles('😀a', true)).toEqual([
      { glyph: '😀', index: 0 },
      { glyph: 'a', index: 2 },
    ]);
    expect(visibleTiles('😀a', false)).toEqual([
      { glyph: '\ud83d', index: 0 },
      { glyph: '\ude00', index: 1 },
      { glyph: 'a', index: 2 },
    ]);
  });
  it('caps long strings, preserves whitespace, and supports empty input', () => {
    expect(visibleTiles(' '.repeat(2000), false)).toHaveLength(24);
    expect(visibleTiles('a\n\t', false)).toEqual([
      { glyph: 'a', index: 0 },
      { glyph: '\n', index: 1 },
      { glyph: '\t', index: 2 },
    ]);
    expect(visibleTiles('', true)).toEqual([]);
  });
});
