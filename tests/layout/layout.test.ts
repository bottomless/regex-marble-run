import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parsePattern, PatternError } from '../../src/engine/parse.ts';
import { isLeaf, walk, type IR, type Program } from '../../src/engine/ir.ts';
import { layout, LayoutError } from '../../src/layout/layout.ts';
import { routePath, anchorOrder } from '../../src/layout/route.ts';
import type { MachineLayout, Piece, PieceKind } from '../../src/layout/pieces.ts';
import { genCase, renderPattern } from '../engine/gen.ts';

const SOLID_KINDS: ReadonlySet<PieceKind> = new Set(['gate', 'sensor', 'mirror', 'opaque']);

const PRESETS: { name: string; pattern: string; flags: string }[] = [
  { name: 'first ride', pattern: 'c(a|o)t', flags: '' },
  { name: 'greedy', pattern: '<.+>', flags: '' },
  { name: 'lazy', pattern: '<.+?>', flags: '' },
  { name: 'optional letter', pattern: 'colou?r', flags: '' },
  { name: 'backreference', pattern: '(\\w)\\1', flags: '' },
  { name: 'lookahead password', pattern: '^(?=.*\\d)(?=.*[a-z]).{8,}$', flags: '' },
  { name: 'evil regex', pattern: '^(a+)+$', flags: '' },
  { name: 'another classic', pattern: '^([a-zA-Z]+)*$', flags: '' },
  { name: 'stack overflow 2016', pattern: '^[\\s]+|[\\s]+$', flags: '' },
  { name: 'cloudflare 2019', pattern: '.*(?:.*=.*)', flags: '' },
];

function hasLeaf(node: IR): boolean {
  for (const n of walk(node)) if (isLeaf(n)) return true;
  return false;
}

function finite(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function overlaps(a: Piece, b: Piece): boolean {
  return (
    Math.abs(a.position.x - b.position.x) * 2 < a.size.x + b.size.x &&
    Math.abs(a.position.y - b.position.y) * 2 < a.size.y + b.size.y &&
    Math.abs(a.position.z - b.position.z) * 2 < a.size.z + b.size.z
  );
}

function checkInvariants(program: Program): MachineLayout {
  const ml = layout(program);
  const { bounds, pieces, graph, anchors } = ml;

  expect(finite(bounds.min)).toBe(true);
  expect(finite(bounds.max)).toBe(true);
  expect(bounds.min.x).toBeLessThanOrEqual(bounds.max.x);
  expect(bounds.min.y).toBeLessThanOrEqual(bounds.max.y);
  expect(bounds.min.z).toBeLessThanOrEqual(bounds.max.z);

  const pointIds = new Set(graph.points.map((p) => p.id));
  expect(pointIds.size).toBe(graph.points.length);
  for (const p of graph.points) expect(finite(p.position), `point ${p.id} finite`).toBe(true);
  for (const e of graph.edges) {
    expect(pointIds.has(e.from), `edge from ${e.from} exists`).toBe(true);
    expect(pointIds.has(e.to), `edge to ${e.to} exists`).toBe(true);
    expect(e.piece).toBeGreaterThanOrEqual(0);
    expect(e.piece).toBeLessThan(pieces.length);
  }

  for (const piece of pieces) {
    expect(finite(piece.position)).toBe(true);
    expect(finite(piece.size)).toBe(true);
  }

  for (const node of walk(program.root)) {
    const anchor = anchors[node.id];
    if (hasLeaf(node)) {
      expect(anchor, `anchor for node ${node.id} (${node.kind})`).toBeDefined();
      expect(pointIds.has(anchor.entry), `entry point for node ${node.id}`).toBe(true);
      expect(pointIds.has(anchor.exit), `exit point for node ${node.id}`).toBe(true);
    }
    if (isLeaf(node)) {
      const piece = pieces.find((p) => p.node === node.id && SOLID_KINDS.has(p.kind) && p.kind !== 'module');
      expect(piece, `gate-like piece for leaf ${node.id} (${node.kind})`).toBeDefined();
    }
  }

  for (const key of Object.keys(anchors)) {
    const anchor = anchors[Number(key)];
    expect(routePath(graph, anchor.entry, anchor.exit), `route entry->exit for node ${key}`).not.toBeNull();
  }

  for (const entry of anchorOrder(anchors)) {
    expect(pointIds.has(entry), `anchorOrder entry ${entry} exists`).toBe(true);
  }

  const rootAnchor = anchors[program.root.id];
  const hopperIdx = pieces.findIndex((p) => p.kind === 'hopper');
  if (rootAnchor) {
    if (hopperIdx >= 0) {
      const starts = graph.edges.filter((e) => e.piece === 0).map((e) => e.from);
      if (starts.length > 0) {
        expect(routePath(graph, starts[0], rootAnchor.entry), 'route hopper->root').not.toBeNull();
      }
    }
    const cupIdx = pieces.findIndex((p) => p.kind === 'cup');
    if (cupIdx >= 0) {
      const ends = graph.edges.filter((e) => e.piece === 1).map((e) => e.to);
      if (ends.length > 0) {
        expect(routePath(graph, rootAnchor.exit, ends[0]), 'route root->cup').not.toBeNull();
      }
    }
  }

  const solid = pieces.filter((p) => SOLID_KINDS.has(p.kind));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      expect(
        overlaps(solid[i], solid[j]),
        `pieces ${i} (${solid[i].kind}@${JSON.stringify(solid[i].position)}) and ${j} (${solid[j].kind}@${JSON.stringify(solid[j].position)}) overlap ${JSON.stringify(program.source)}`,
      ).toBe(false);
    }
  }

  return ml;
}

describe('layout: preset invariants', () => {
  for (const preset of PRESETS) {
    it(`preset ${preset.name} (${preset.pattern})`, () => {
      const program = parsePattern(preset.pattern, preset.flags);
      checkInvariants(program);
    });
  }
});

describe('layout: fuzzed invariants', () => {
  it('300 fixed-seed generated layouts satisfy invariants', () => {
    let built = 0;
    let skipped = 0;
    fc.assert(
      fc.property(genCase, ({ pattern, flags }) => {
        const { source } = renderPattern(pattern);
        let program: Program;
        try {
          program = parsePattern(source, flags);
        } catch (e) {
          if (e instanceof PatternError || e instanceof SyntaxError) {
            skipped++;
            return;
          }
          throw e;
        }
        try {
          checkInvariants(program);
          built++;
        } catch (e) {
          if (e instanceof LayoutError) {
            skipped++;
            return;
          }
          throw e;
        }
      }),
      { numRuns: 300, seed: 20260709, endOnFailure: true },
    );
    console.log(`layout fuzz: built=${built} skipped=${skipped}`);
    expect(built).toBeGreaterThan(100);
  });
});

describe('layout: performance', () => {
  it('largest allowed 300-char pattern lays out in under 50ms', () => {
    const pattern = '[ab]'.repeat(75);
    expect(pattern.length).toBe(300);
    const program = parsePattern(pattern, '');
    layout(program);
    let best = Infinity;
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      layout(program);
      best = Math.min(best, performance.now() - t0);
    }
    console.log(`layout 300-char pattern: best=${best.toFixed(2)}ms`);
    expect(best).toBeLessThan(50);
  });
});
