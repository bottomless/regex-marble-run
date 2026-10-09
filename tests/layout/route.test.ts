import { describe, expect, it } from 'vitest';
import { routePath, anchorOrder } from '../../src/layout/route.ts';
import type { LayoutGraph, NodeAnchor, TrackPoint } from '../../src/layout/pieces.ts';

function pt(id: number, x: number, y: number, z = 0): TrackPoint {
  return { id, position: { x, y, z }, node: null };
}

function graph(points: TrackPoint[], edges: [number, number][]): LayoutGraph {
  return { points, edges: edges.map(([from, to], piece) => ({ from, to, piece })) };
}

function anchor(entry: number, exit = entry + 100): NodeAnchor {
  return { entry, exit };
}

describe('routePath', () => {
  it('returns the trivial path when from === to', () => {
    const g = graph([pt(0, 0, 0)], []);
    expect(routePath(g, 0, 0)).toEqual([0]);
  });

  it('follows a single directed edge', () => {
    const g = graph([pt(0, 0, 0), pt(1, 1, 0)], [[0, 1]]);
    expect(routePath(g, 0, 1)).toEqual([0, 1]);
  });

  it('returns a path that starts at from and ends at to', () => {
    const g = graph(
      [pt(0, 0, 0), pt(1, 1, 0), pt(2, 2, 0), pt(3, 3, 0)],
      [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );
    const path = routePath(g, 0, 3);
    expect(path).not.toBeNull();
    expect(path![0]).toBe(0);
    expect(path![path!.length - 1]).toBe(3);
  });

  it('prefers the geometrically shortest path, not the fewest hops', () => {
    const g = graph(
      [pt(0, 0, 0), pt(1, 1, 0), pt(2, 2, 0), pt(3, 3, 0), pt(4, 10, 10)],
      [
        [0, 4],
        [4, 3],
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );
    expect(routePath(g, 0, 3)).toEqual([0, 1, 2, 3]);
  });

  it('uses the direct edge when it is the shortest', () => {
    const g = graph(
      [pt(0, 0, 0), pt(1, 50, 0), pt(2, 100, 0), pt(3, 2, 0)],
      [
        [0, 3],
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    );
    expect(routePath(g, 0, 3)).toEqual([0, 3]);
  });

  it('respects edge direction', () => {
    const g = graph([pt(0, 0, 0), pt(1, 1, 0)], [[0, 1]]);
    expect(routePath(g, 1, 0)).toBeNull();
  });

  it('returns null for an unreachable target', () => {
    const g = graph(
      [pt(0, 0, 0), pt(1, 1, 0), pt(2, 5, 5), pt(3, 6, 5)],
      [
        [0, 1],
        [2, 3],
      ],
    );
    expect(routePath(g, 0, 3)).toBeNull();
  });

  it('returns null when the target point does not exist', () => {
    const g = graph([pt(0, 0, 0)], []);
    expect(routePath(g, 0, 7)).toBeNull();
  });

  it.each([-1, 2, 0.5, NaN, Infinity])(
    'rejects invalid source/target indices %s, including trivial routes',
    (index) => {
      const g = graph([pt(0, 0, 0), pt(1, 1, 0)], [[0, 1]]);
      expect(routePath(g, index, 0)).toBeNull();
      expect(routePath(g, 0, index)).toBeNull();
      expect(routePath(g, index, index)).toBeNull();
    },
  );

  it('ignores invalid graph edges safely', () => {
    const g = graph(
      [pt(0, 0, 0), pt(1, 1, 0)],
      [
        [0, -1],
        [9, 1],
        [0, 0.5],
        [0, 1],
      ],
    );
    expect(routePath(g, 0, 1)).toEqual([0, 1]);
  });

  it('prefers actual polyline length over endpoint chord length', () => {
    const g = graph(
      [pt(0, 0, 0), pt(1, 1, 0), pt(2, 2, 0)],
      [
        [0, 2],
        [0, 1],
        [1, 2],
      ],
    );
    g.edges[0].length = 20;
    g.edges[1].length = 1.5;
    g.edges[2].length = 1.5;
    expect(routePath(g, 0, 2)).toEqual([0, 1, 2]);
  });

  it('does not expose cached arrays and scopes caches to each graph', () => {
    const g = graph(
      [pt(0, 0, 0), pt(1, 1, 0), pt(2, 2, 0)],
      [
        [0, 1],
        [1, 2],
      ],
    );
    const first = routePath(g, 0, 2)!;
    first[0] = 999;
    first.push(999);
    expect(routePath(g, 0, 2)).toEqual([0, 1, 2]);
    const next = routePath(g, 0, 2)!;
    next.length = 0;
    expect(routePath(g, 0, 2)).toEqual([0, 1, 2]);
    const different = graph(g.points, [[0, 2]]);
    expect(routePath(different, 0, 2)).toEqual([0, 2]);
    expect(routePath(g, 0, 2)).toEqual([0, 1, 2]);
  });

  it('invalidates structural caches when graph arrays or their sizes change', () => {
    const g = graph([pt(0, 0, 0), pt(1, 1, 0), pt(2, 2, 0)], [[0, 1]]);
    expect(routePath(g, 0, 2)).toBeNull();
    g.edges.push({ from: 1, to: 2, piece: 1 });
    expect(routePath(g, 0, 2)).toEqual([0, 1, 2]);
    g.edges = [{ from: 0, to: 2, piece: 0 }];
    expect(routePath(g, 0, 2)).toEqual([0, 2]);
  });

  it('handles zero-length cycles and ignores invalid length weights', () => {
    const g = graph(
      [pt(0, 0, 0), pt(1, 0, 0), pt(2, 1, 0)],
      [
        [0, 1],
        [1, 0],
        [1, 2],
        [0, 2],
        [0, 2],
      ],
    );
    g.edges[3].length = -1;
    g.edges[4].length = NaN;
    expect(routePath(g, 0, 2)).toEqual([0, 1, 2]);
  });

  it('routes around a dead end', () => {
    const g = graph(
      [pt(0, 0, 0), pt(1, 1, 0), pt(2, 0, 2), pt(3, 2, 1)],
      [
        [0, 1],
        [0, 2],
        [2, 3],
      ],
    );
    expect(routePath(g, 0, 3)).toEqual([0, 2, 3]);
  });
});

describe('anchorOrder', () => {
  it('returns entry points sorted by node id', () => {
    const anchors: Record<number, NodeAnchor> = {
      5: anchor(50),
      2: anchor(20),
      9: anchor(99),
      0: anchor(7),
    };
    expect(anchorOrder(anchors)).toEqual([7, 20, 50, 99]);
  });

  it('handles a single anchor', () => {
    expect(anchorOrder({ 3: anchor(42) })).toEqual([42]);
  });

  it('handles an empty anchor map', () => {
    expect(anchorOrder({})).toEqual([]);
  });
});
