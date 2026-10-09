import { describe, expect, it } from 'vitest';
import {
  buildDebugLayout,
  layoutViewBox,
  pieceColor,
  pieceShape,
  project,
} from '../../src/layout/DebugLayout.tsx';

describe('debug layout helpers', () => {
  it('projects top-down as (x, -y) ignoring z', () => {
    expect(project({ x: 2, y: 5, z: -3 })).toEqual({ x: 2, y: -5 });
  });

  it('returns a color for every piece kind', () => {
    const machine = buildDebugLayout('^(a+)+$');
    for (const piece of machine.pieces) {
      expect(pieceColor(piece.kind)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('builds a layout for the default pattern', () => {
    const machine = buildDebugLayout('^(a+)+$');
    expect(machine.pieces.length).toBeGreaterThan(0);
    expect(machine.graph.edges.length).toBeGreaterThan(0);
  });

  it('produces a positive-size viewBox from bounds', () => {
    const machine = buildDebugLayout('^(a+)+$');
    const [x, y, w, h] = layoutViewBox(machine).split(' ').map(Number);
    expect([x, y, w, h].every(Number.isFinite)).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it('shapes tracks as paths and gates as rects', () => {
    const machine = buildDebugLayout('ab');
    const track = machine.pieces.find((p) => p.kind === 'track' && p.points);
    const gate = machine.pieces.find((p) => p.kind === 'gate');
    if (track) expect(pieceShape(track).tag).toBe('path');
    if (gate) {
      const shape = pieceShape(gate);
      expect(shape.tag).toBe('rect');
      if (shape.tag === 'rect') {
        expect(shape.w).toBeGreaterThan(0);
        expect(shape.h).toBeGreaterThan(0);
      }
    }
  });

  it('throws on invalid patterns', () => {
    expect(() => buildDebugLayout('(')).toThrow();
  });
});
