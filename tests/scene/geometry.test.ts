import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { parsePattern } from '../../src/engine/parse.ts';
import { layout } from '../../src/layout/layout.ts';
import { PRESETS } from '../../src/presets.ts';
import { buildTrackBatches, displayMetrics, visibleTiles } from '../../src/scene/geometry.ts';
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
