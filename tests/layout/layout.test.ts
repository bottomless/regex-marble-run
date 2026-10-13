import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import { parsePattern, PatternError } from '../../src/engine/parse.ts';
import { isLeaf, walk, type IR, type Program } from '../../src/engine/ir.ts';
import { layout, LayoutError, HARD_LEAF_CAP, STAIR_STEP } from '../../src/layout/layout.ts';
import { routePath, anchorOrder } from '../../src/layout/route.ts';
import type { MachineLayout, Piece, PieceKind, Vec3 } from '../../src/layout/pieces.ts';
import { genCase, renderPattern } from '../engine/gen.ts';

const SOLID_KINDS: ReadonlySet<PieceKind> = new Set([
  'gate',
  'sensor',
  'mirror',
  'opaque',
  'module',
  'scout',
]);

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
  { name: 'unequal alternatives', pattern: 'abc|d+', flags: '' },
  { name: 'lookahead alternative', pattern: '(?=abc|d+)a|bc', flags: '' },
  { name: 'nested lookahead alternatives', pattern: '(?=(a|bc)(?=d|ef))g|h+', flags: '' },
  { name: 'empty pattern', pattern: '', flags: '' },
  { name: 'empty branches and groups', pattern: '(|(?:)|a?)(?=)', flags: '' },
];

function finite(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function overlaps(a: Piece, b: Piece): boolean {
  return (
    Math.abs(a.position.x - b.position.x) * 2 < a.size.x + b.size.x &&
    Math.abs(a.position.y - b.position.y) * 2 < a.size.y + b.size.y &&
    Math.abs(a.position.z - b.position.z) * 2 < a.size.z + b.size.z
  );
}

function contained(ml: MachineLayout, point: Vec3, radius = 0): void {
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(point[axis] - radius).toBeGreaterThanOrEqual(ml.bounds.min[axis] - 1e-8);
    expect(point[axis] + radius).toBeLessThanOrEqual(ml.bounds.max[axis] + 1e-8);
  }
}

function validPath(ml: MachineLayout, from: number, to: number): number[] {
  const path = routePath(ml.graph, from, to);
  expect(path, `route ${from}->${to}`).not.toBeNull();
  expect(path![0]).toBe(from);
  expect(path!.at(-1)).toBe(to);
  for (let i = 1; i < path!.length; i++) {
    expect(ml.graph.edges.some((edge) => edge.from === path![i - 1] && edge.to === path![i])).toBe(true);
  }
  return path!;
}

function returnGraph(ml: MachineLayout): MachineLayout['graph'] {
  return {
    points: ml.graph.points,
    edges: ml.graph.edges.filter((edge) => ['returnRail', 'backLift'].includes(ml.pieces[edge.piece].kind)),
  };
}

function moduleFor(ml: MachineLayout, node: IR): Piece | undefined {
  return ml.pieces.find((piece) => piece.kind === 'module' && piece.containedNodes?.includes(node.id));
}

function checkInvariants(program: Program, options?: { expandedModules?: number[] }): MachineLayout {
  const ml = layout(program, options);
  const { bounds, pieces, graph, anchors } = ml;
  expect(finite(bounds.min)).toBe(true);
  expect(finite(bounds.max)).toBe(true);
  for (const axis of ['x', 'y', 'z'] as const) expect(bounds.min[axis]).toBeLessThanOrEqual(bounds.max[axis]);
  expect(
    Object.keys(anchors)
      .map(Number)
      .sort((a, b) => a - b),
  ).toEqual([...walk(program.root)].map((node) => node.id).sort((a, b) => a - b));
  expect(
    Object.keys(anchors)
      .map(Number)
      .sort((a, b) => a - b),
  ).toEqual(program.nodes.map((node) => node.id).sort((a, b) => a - b));
  const pointIds = new Set(graph.points.map((point) => point.id));
  expect(pointIds.size).toBe(graph.points.length);
  for (const point of graph.points) {
    expect(finite(point.position), `point ${point.id} finite`).toBe(true);
    expect(graph.points[point.id]).toBe(point);
    contained(ml, point.position);
  }
  for (const edge of graph.edges) {
    expect(pointIds.has(edge.from), `edge from ${edge.from} exists`).toBe(true);
    expect(pointIds.has(edge.to), `edge to ${edge.to} exists`).toBe(true);
    expect(edge.piece).toBeGreaterThanOrEqual(0);
    expect(edge.piece).toBeLessThan(pieces.length);
    const piece = pieces[edge.piece];
    expect(piece.points?.length).toBeGreaterThanOrEqual(2);
    expect(piece.points![0]).toEqual(graph.points[edge.from].position);
    expect(piece.points!.at(-1)).toEqual(graph.points[edge.to].position);
    let length = 0;
    for (let i = 1; i < piece.points!.length; i++) {
      const a = piece.points![i - 1];
      const b = piece.points![i];
      length += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (b.y > a.y + 1e-8) expect(['backLift', 'loopLift']).toContain(piece.kind);
      if (!['backLift', 'loopLift'].includes(piece.kind)) expect(b.y).toBeLessThan(a.y);
    }
    expect(edge.length).toBeCloseTo(length, 8);
  }
  for (const piece of pieces) {
    expect(finite(piece.position)).toBe(true);
    expect(finite(piece.size)).toBe(true);
    contained(ml, {
      x: piece.position.x - piece.size.x / 2,
      y: piece.position.y - piece.size.y / 2,
      z: piece.position.z - piece.size.z / 2,
    });
    contained(ml, {
      x: piece.position.x + piece.size.x / 2,
      y: piece.position.y + piece.size.y / 2,
      z: piece.position.z + piece.size.z / 2,
    });
    for (const point of piece.points ?? []) {
      expect(finite(point)).toBe(true);
      contained(ml, point, 0.25);
    }
    if (piece.points && piece.points.length > 2) {
      const samples = new CatmullRomCurve3(
        piece.points.map((point) => new Vector3(point.x, point.y, point.z)),
      ).getPoints(16);
      expect(
        samples.every(
          (point) =>
            finite(point) &&
            (['x', 'y', 'z'] as const).every(
              (axis) =>
                point[axis] - 0.25 >= bounds.min[axis] - 1e-8 &&
                point[axis] + 0.25 <= bounds.max[axis] + 1e-8,
            ),
        ),
      ).toBe(true);
      if (!['backLift', 'loopLift'].includes(piece.kind)) {
        expect(samples.every((point, index) => index === 0 || point.y <= samples[index - 1].y + 1e-8)).toBe(
          true,
        );
      }
    }
  }
  const root = anchors[program.root.id];
  for (const node of walk(program.root)) {
    const anchor = anchors[node.id];
    expect(anchor, `anchor for node ${node.id} (${node.kind})`).toBeDefined();
    expect(pointIds.has(anchor.entry)).toBe(true);
    expect(pointIds.has(anchor.exit)).toBe(true);
    validPath(ml, anchor.entry, anchor.exit);
    validPath(ml, root.entry, anchor.entry);
    validPath(ml, anchor.exit, root.exit);
    const module = moduleFor(ml, node);
    if (isLeaf(node)) {
      const piece = pieces.find((item) => item.node === node.id && SOLID_KINDS.has(item.kind));
      expect(piece ?? module, `gate-like piece or real module for leaf ${node.id}`).toBeDefined();
      expect(anchor.gate).toEqual((piece ?? module)!.position);
      if (module) {
        expect(anchor.entry).toBe(anchors[module.node!].entry);
        expect(anchor.exit).toBe(anchors[module.node!].exit);
      }
    }
    if ((node.kind === 'alt' || node.kind === 'repeat') && !module) {
      expect(anchor.diverter).toEqual(
        pieces.find((piece) => piece.node === node.id && piece.kind === 'diverter')!.position,
      );
      expect(anchor.flagSlot).toBeDefined();
      expect(anchor.returnPort).toBeDefined();
      expect(graph.points[anchor.returnPort!].position.z).toBeLessThan(anchor.diverter!.z);
      validPath(ml, anchor.returnPort!, anchor.entry);
      for (const descendant of walk(node)) {
        if (isLeaf(descendant)) validPath(ml, anchors[descendant.id].exit, anchor.returnPort!);
      }
    }
    if (module) continue;
    if (node.kind === 'seq' && node.items.length > 1) {
      expect(graph.edges.some((edge) => edge.from === anchor.entry && edge.to === anchor.exit)).toBe(false);
      for (let i = 1; i < node.items.length; i++) {
        expect(
          graph.edges.some(
            (edge) =>
              edge.from === anchors[node.items[i - 1].id].exit &&
              edge.to === anchors[node.items[i].id].entry &&
              pieces[edge.piece].kind === 'track',
          ),
        ).toBe(true);
      }
    }
    if (node.kind === 'alt') {
      expect(graph.edges.some((edge) => edge.from === anchor.entry && edge.to === anchor.exit)).toBe(false);
      for (const branch of node.branches) {
        expect(
          graph.edges.some((edge) => edge.from === anchor.entry && edge.to === anchors[branch.id].entry),
        ).toBe(true);
        expect(
          graph.edges.some((edge) => edge.from === anchors[branch.id].exit && edge.to === anchor.exit),
        ).toBe(true);
      }
    }
  }
  for (const entry of anchorOrder(anchors)) expect(pointIds.has(entry)).toBe(true);
  for (const kind of ['hopper', 'cup', 'rejectTray'] as const) {
    const index = pieces.findIndex((piece) => piece.kind === kind);
    expect(index).toBeGreaterThanOrEqual(0);
    const edge = graph.edges.find((item) => item.piece === index)!;
    expect(edge).toBeDefined();
    const endpoint = kind === 'hopper' ? edge.from : edge.to;
    expect(graph.points[endpoint].position).toEqual(pieces[index].position);
    if (kind === 'hopper') {
      expect(edge.to).toBe(root.entry);
      validPath(ml, endpoint, root.exit);
    } else {
      expect(edge.from).toBe(root.exit);
      validPath(ml, root.entry, endpoint);
    }
  }
  const solid = pieces.filter((piece) => SOLID_KINDS.has(piece.kind));
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

function nodeOf<K extends IR['kind']>(program: Program, kind: K): Extract<IR, { kind: K }> {
  return [...walk(program.root)].find((node) => node.kind === kind) as Extract<IR, { kind: K }>;
}

describe('layout: preset invariants', () => {
  for (const preset of PRESETS) {
    it(`preset ${preset.name} (${preset.pattern})`, () =>
      checkInvariants(parsePattern(preset.pattern, preset.flags)));
  }
});

describe('layout: geometry and structure', () => {
  it('is deterministic, pure, unaliased, and has tight finite geometry bounds', () => {
    const program = parsePattern('abc|d+', '');
    const original = structuredClone(program);
    const ml = checkInvariants(program);
    expect(program).toEqual(original);
    expect(layout(program)).toEqual(ml);
    expect(ml.bounds.min.y).toBeGreaterThan(-30);
    const edge = ml.graph.edges[0];
    const point = { ...ml.graph.points[edge.from].position };
    ml.pieces[edge.piece].points![0].x += 100;
    expect(ml.graph.points[edge.from].position).toEqual(point);
    expect(layout(program)).not.toEqual(ml);
  });

  it('bounds actual centripetal CatmullRom tubes, including corner overshoot', () => {
    for (const source of [
      'abc|d+',
      '(?=abc|d+)e',
      `(${'a'.repeat(75)}|b)+`,
      `(?=${'a'.repeat(75)}|b)c`,
      '(a+)+',
    ]) {
      const ml = layout(parsePattern(source, ''));
      for (const piece of ml.pieces) {
        if (!piece.points) continue;
        const curve = new CatmullRomCurve3(
          piece.points.map((point) => new Vector3(point.x, point.y, point.z)),
        );
        const samples = curve.getPoints(80);
        for (const point of samples) contained(ml, point, 0.25);
        if (!['backLift', 'loopLift'].includes(piece.kind)) {
          expect(
            samples.every((point, index) => index === 0 || point.y <= samples[index - 1].y + 1e-8),
            `${piece.kind} rolls downhill in ${source}`,
          ).toBe(true);
        }
        const tube = new TubeGeometry(curve, 32, 0.25, 6, false);
        expect(Array.from(tube.getAttribute('position').array).every(Number.isFinite)).toBe(true);
        tube.computeBoundingBox();
        for (const point of [tube.boundingBox!.min, tube.boundingBox!.max]) {
          for (const axis of ['x', 'y', 'z'] as const) {
            expect(point[axis]).toBeGreaterThanOrEqual(ml.bounds.min[axis] - 1e-5);
            expect(point[axis]).toBeLessThanOrEqual(ml.bounds.max[axis] + 1e-5);
          }
        }
        tube.dispose();
      }
    }
  });

  it('places unequal alternatives using measured extents, not shared translations', () => {
    const program = parsePattern('abcdefghijklmnop|(?=abc|d+)e+|((f|gh)+)', '');
    const ml = checkInvariants(program);
    const alt = nodeOf(program, 'alt');
    const leaves = alt.branches.map((branch) =>
      [...walk(branch)]
        .filter(isLeaf)
        .map((leaf) => ml.pieces.find((piece) => piece.node === leaf.id && SOLID_KINDS.has(piece.kind))!),
    );
    for (let i = 1; i < leaves.length; i++) {
      const left = Math.max(...leaves[i - 1].map((piece) => piece.position.x + piece.size.x / 2));
      const right = Math.min(...leaves[i].map((piece) => piece.position.x - piece.size.x / 2));
      expect(right - left).toBeGreaterThanOrEqual(2.4 - 1e-8);
    }
  });

  it.each(['a+', 'a+?', '(ab|c)*', '(ab|c)*?'])(
    'builds body, side bypass, and rear loop curves for %s',
    (source) => {
      const program = parsePattern(source, '');
      const ml = checkInvariants(program);
      const repeat = nodeOf(program, 'repeat');
      const anchor = ml.anchors[repeat.id];
      const body = ml.anchors[repeat.body.id];
      const outgoing = ml.graph.edges.filter((edge) => edge.from === anchor.entry);
      expect(ml.pieces[outgoing[0].piece].kind).toBe(repeat.greedy ? 'track' : 'bypassChute');
      const bypass = ml.pieces.find((piece) => piece.node === repeat.id && piece.kind === 'bypassChute')!;
      expect(bypass.role).toBe(repeat.greedy ? 'repeat' : 'lazyRepeat');
      expect(bypass.points!.slice(1, -1).every((point) => point.x > 1.4)).toBe(true);
      const loopEdge = ml.graph.edges.find(
        (edge) => edge.from === body.exit && ml.pieces[edge.piece].kind === 'loopLift',
      )!;
      expect(loopEdge.to).toBe(anchor.returnPort);
      expect(ml.pieces[loopEdge.piece].points!.slice(1).every((point) => point.z < 0)).toBe(true);
      validPath(ml, body.exit, anchor.entry);
    },
  );

  it('uses only capture frames, with capture labels and nested depth separation', () => {
    const ml = checkInvariants(parsePattern('(?<outer>(a))(?:b)', ''));
    const frames = ml.pieces.filter((piece) => piece.kind === 'groupFrame');
    expect(frames).toHaveLength(2);
    expect(frames.map((piece) => piece.label).sort()).toEqual(['1: outer', '2']);
    expect(frames[0].position.z).not.toBe(frames[1].position.z);
  });

  it('provides a nonconsuming main lookahead path and connected ghost scout alternatives', () => {
    const program = parsePattern('(?=abc|d+)e', '');
    const ml = checkInvariants(program);
    const look = nodeOf(program, 'look');
    const body = ml.anchors[look.body.id];
    const anchor = ml.anchors[look.id];
    const main = validPath(ml, anchor.entry, anchor.exit);
    expect(main).not.toContain(body.entry);
    validPath(ml, anchor.entry, body.entry);
    validPath(ml, body.exit, anchor.exit);
    for (const leaf of walk(look.body)) {
      if (!isLeaf(leaf)) continue;
      const gate = ml.pieces.find((piece) => piece.node === leaf.id && SOLID_KINDS.has(piece.kind))!;
      expect(gate.role).toBe('look');
      expect(gate.position.z).toBeLessThan(0);
    }
    expect(ml.pieces.some((piece) => piece.kind === 'returnRail' && piece.node === look.id)).toBe(true);
  });

  it('descends short sequences as a bounded staircase and folds long simple ones into compact grids', () => {
    const short = checkInvariants(parsePattern('abcdef', ''));
    const shortGates = short.pieces.filter((piece) => piece.kind === 'gate');
    expect(new Set(shortGates.map((piece) => piece.position.x)).size).toBeGreaterThan(1);
    expect(Math.max(...shortGates.map((piece) => piece.position.x))).toBeLessThanOrEqual(
      STAIR_STEP * Math.ceil(Math.sqrt(6)) + 1e-8,
    );
    for (let i = 1; i < shortGates.length; i++) {
      expect(shortGates[i].position.y).toBeLessThan(shortGates[i - 1].position.y);
    }
    for (const length of [7, 75, 300]) {
      const ml = checkInvariants(parsePattern('a'.repeat(length), ''));
      expect(ml.bounds.max.x - ml.bounds.min.x).toBeLessThan(50);
      expect(ml.bounds.max.y - ml.bounds.min.y).toBeLessThan(80);
      const gates = ml.pieces.filter((piece) => piece.kind === 'gate');
      expect(new Set(gates.map((piece) => piece.position.x)).size).toBeGreaterThan(1);
      expect(gates.every((piece) => piece.points![1].y < piece.points![0].y)).toBe(true);
    }
    const program = parsePattern('a+b+c+d+e+f+g+', '');
    const ml = checkInvariants(program);
    const repeats = [...walk(program.root)].filter((node) => node.kind === 'repeat');
    const entries = repeats.map((node) => ml.graph.points[ml.anchors[node.id].entry].position);
    expect(new Set(entries.map((point) => point.x)).size).toBeGreaterThan(1);
    expect(Math.max(...entries.map((point) => Math.abs(point.x)))).toBeLessThanOrEqual(
      STAIR_STEP * Math.ceil(Math.sqrt(7)) + 1e-8,
    );
  });
});

describe('layout: continuation returns', () => {
  it.each([
    'c(a|o)t',
    '^(a+)+$',
    '(a|b)(c|d)e',
    '(?:a(b|c)|d)e',
    '(?:a+|b?)c',
    '(a+)+b?c',
    '(?:a(b|c)d)?e',
    '(?:|a(b|c))d',
  ])('connects the continuation to every earlier outstanding choice in %s', (source) => {
    const program = parsePattern(source, '');
    const ml = checkInvariants(program);
    const rear = { ...ml, graph: returnGraph(ml) };
    const continuation = program.nodes.findLast(isLeaf)!;
    const from = ml.anchors[continuation.id].exit;
    const choices = program.nodes.filter((node) => node.kind === 'alt' || node.kind === 'repeat');
    for (const choice of choices) {
      const port = ml.anchors[choice.id].returnPort!;
      const path = validPath(rear, from, port);
      const edges = path
        .slice(1)
        .map((to, i) => rear.graph.edges.find((edge) => edge.from === path[i] && edge.to === to)!);
      expect(edges.some((edge) => ml.pieces[edge.piece].kind === 'backLift')).toBe(true);
      for (const edge of edges) {
        const piece = ml.pieces[edge.piece];
        if (piece.kind === 'backLift') expect(piece.points!.every((point) => point.z < 0)).toBe(true);
      }
    }
  });

  it('unwinds nested branch choices before earlier sequence choices', () => {
    const program = parsePattern('(a|b)(?:c(d|e)|f)g', '');
    const ml = checkInvariants(program);
    const rear = { ...ml, graph: returnGraph(ml) };
    const choices = [...walk(program.root)].filter((node) => node.kind === 'alt');
    const [earlier, outer, inner] = choices.map((node) => ml.anchors[node.id].returnPort!);
    const continuation = program.nodes.find((node) => node.kind === 'char' && node.label === 'g')!;
    const from = ml.anchors[continuation.id].exit;
    validPath(rear, from, inner);
    validPath(rear, from, outer);
    validPath(rear, inner, earlier);
    expect(validPath(rear, inner, earlier)).toContain(outer);
    expect(routePath(rear.graph, earlier, inner)).toBeNull();
    const starts = rear.graph.edges.filter((edge) => edge.from === from);
    expect(starts).toHaveLength(2);
    for (const edge of starts) {
      const lift = rear.graph.edges.find((item) => item.from === edge.to)!;
      expect([inner, outer]).toContain(lift.to);
      expect(lift.to).not.toBe(earlier);
    }
  });

  it('keeps mutually exclusive branch choices separate while joining their continuation', () => {
    const program = parsePattern('((a|b)c|(d|e)f)g', '');
    const ml = checkInvariants(program);
    const rear = { ...ml, graph: returnGraph(ml) };
    const [outer, left, right] = [...walk(program.root)]
      .filter((node) => node.kind === 'alt')
      .map((node) => ml.anchors[node.id].returnPort!);
    for (const [label, own, other] of [
      ['c', left, right],
      ['f', right, left],
    ] as const) {
      const leaf = program.nodes.find((node) => node.kind === 'char' && node.label === label)!;
      const from = ml.anchors[leaf.id].exit;
      validPath(rear, from, own);
      validPath(rear, from, outer);
      expect(routePath(rear.graph, from, other)).toBeNull();
      expect(routePath(rear.graph, own, other)).toBeNull();
    }
    const continuation = program.nodes.find((node) => node.kind === 'char' && node.label === 'g')!;
    for (const port of [outer, left, right]) validPath(rear, ml.anchors[continuation.id].exit, port);
  });

  it('does not return from a prefix to a future choice or invent choices for plain sequences', () => {
    const program = parsePattern('a(b|c)d', '');
    const ml = checkInvariants(program);
    const prefix = program.nodes.find((node) => node.kind === 'char' && node.label === 'a')!;
    const alt = nodeOf(program, 'alt');
    expect(routePath(returnGraph(ml), ml.anchors[prefix.id].exit, ml.anchors[alt.id].returnPort!)).toBeNull();
    const plain = checkInvariants(parsePattern('abcdefghi', ''));
    expect(returnGraph(plain).edges).toHaveLength(0);
  });

  it.each(['(a|b)(?=(c|d)e)f', '(a|b)(?!(c|d)e)f'])(
    'keeps scout choices inside their assertion in %s',
    (source) => {
      const program = parsePattern(source, '');
      const ml = checkInvariants(program);
      const rear = { ...ml, graph: returnGraph(ml) };
      const look = nodeOf(program, 'look');
      const outer = nodeOf(program, 'alt');
      const inner = [...walk(look.body)].find((node) => node.kind === 'alt')!;
      const continuation = program.nodes.find((node) => node.kind === 'char' && node.label === 'f')!;
      const from = ml.anchors[continuation.id].exit;
      validPath(rear, from, ml.anchors[outer.id].returnPort!);
      expect(routePath(rear.graph, from, ml.anchors[inner.id].returnPort!)).toBeNull();
      const scoutContinuation = program.nodes.find((node) => node.kind === 'char' && node.label === 'e')!;
      validPath(rear, ml.anchors[scoutContinuation.id].exit, ml.anchors[inner.id].returnPort!);
    },
  );
});

describe('layout: modules and supported cap', () => {
  const source = `(?<block>${'a'.repeat(30)})(?:${'b'.repeat(30)})${'c'.repeat(30)}`;
  it('collapses substantial inner capture/noncapture groups only above the complexity threshold', () => {
    const program = parsePattern(source, '');
    const ml = checkInvariants(program);
    const modules = ml.pieces.filter((piece) => piece.kind === 'module');
    expect(modules).toHaveLength(2);
    for (const module of modules) {
      const group = program.nodes[module.node!];
      expect(group.kind).toBe('group');
      expect(module.containedNodes).toEqual([...walk(group)].map((node) => node.id));
      expect(module.containedNodes!.length).toBeGreaterThan(12);
      expect(
        ml.pieces.some((piece) => piece.kind === 'gate' && module.containedNodes!.includes(piece.node!)),
      ).toBe(false);
    }
    expect(
      checkInvariants(parsePattern(`(${'a'.repeat(30)})`, '')).pieces.some(
        (piece) => piece.kind === 'module',
      ),
    ).toBe(false);
  });

  it('does not collapse groups of twelve leaves, but collapses thirteen-leaf groups in complex programs', () => {
    const small = checkInvariants(parsePattern(`(${'a'.repeat(12)})${'b'.repeat(75)}`, ''));
    expect(small.pieces.some((piece) => piece.kind === 'module')).toBe(false);
    const large = checkInvariants(parsePattern(`(?:${'a'.repeat(13)})${'b'.repeat(75)}`, ''));
    expect(large.pieces.filter((piece) => piece.kind === 'module')).toHaveLength(1);
  });

  it('preserves all descendant anchors through nested module collapse and expansion', () => {
    const program = parsePattern(`((?:${'a'.repeat(20)})${'b'.repeat(20)})${'c'.repeat(45)}`, '');
    const initial = checkInvariants(program);
    const outer = initial.pieces.find((piece) => piece.kind === 'module')!;
    expect(initial.pieces.filter((piece) => piece.kind === 'module')).toHaveLength(1);
    const expanded = checkInvariants(program, { expandedModules: [outer.node!] });
    const inner = expanded.pieces.find((piece) => piece.kind === 'module')!;
    expect(inner.node).not.toBe(outer.node);
    expect(outer.containedNodes).toEqual(expect.arrayContaining(inner.containedNodes!));
    expect(
      checkInvariants(program, { expandedModules: [outer.node!, inner.node!] }).pieces.some(
        (piece) => piece.kind === 'module',
      ),
    ).toBe(false);
  });

  it('expands requested module IDs and supports full expansion without mutating options', () => {
    const program = parsePattern(source, '');
    const collapsed = layout(program);
    const ids = collapsed.pieces.filter((piece) => piece.kind === 'module').map((piece) => piece.node!);
    const options = { expandedModules: [ids[0]] };
    expect(checkInvariants(program, options).pieces.filter((piece) => piece.kind === 'module')).toHaveLength(
      1,
    );
    expect(options).toEqual({ expandedModules: [ids[0]] });
    const expanded = checkInvariants(program, { expandedModules: ids });
    expect(expanded.pieces.some((piece) => piece.kind === 'module')).toBe(false);
    expect(expanded.pieces.filter((piece) => piece.kind === 'gate')).toHaveLength(90);
    expect(layout(program)).toEqual(collapsed);
  });

  it('supports 300 literal leaves and gives a clear error above the hard cap', () => {
    expect(HARD_LEAF_CAP).toBe(320);
    expect(
      layout(parsePattern('a'.repeat(300), '')).pieces.filter((piece) => piece.kind === 'gate'),
    ).toHaveLength(300);
    const program = parsePattern('a', '');
    program.leafCount = HARD_LEAF_CAP + 1;
    expect(() => layout(program)).toThrow(LayoutError);
    expect(() => layout(program)).toThrow('321 leaves; maximum 320');
  });
});

describe('layout: fuzzed invariants', () => {
  it('1000 accepted fixed-seed generated layouts satisfy physical invariants', () => {
    let built = 0;
    fc.assert(
      fc.property(genCase, ({ pattern, flags }) => {
        const { source } = renderPattern(pattern);
        let program: Program;
        try {
          program = parsePattern(source, flags);
        } catch (error) {
          if (error instanceof PatternError || error instanceof SyntaxError) {
            fc.pre(false);
            return;
          }
          throw error;
        }
        fc.pre(program.leafCount <= HARD_LEAF_CAP);
        checkInvariants(program);
        built++;
      }),
      { numRuns: 1000, seed: 20260709, endOnFailure: true },
    );
    expect(built).toBe(1000);
  }, 120000);
});

describe('layout: performance', () => {
  it.each(['[ab]'.repeat(75), 'a'.repeat(300)])('300-char patterns lay out in under 50ms', (source) => {
    expect(source.length).toBe(300);
    const program = parsePattern(source, '');
    layout(program);
    const times = Array.from({ length: 10 }, () => {
      const start = performance.now();
      layout(program);
      return performance.now() - start;
    });
    expect(Math.max(...times)).toBeLessThan(50);
  });
});
