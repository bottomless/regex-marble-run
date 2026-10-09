import type { IR, NodeId, Program } from '../engine/ir.ts';
import { walk } from '../engine/ir.ts';
import type { MachineLayout, Piece, PieceKind, Vec3 } from './pieces.ts';

export const SWITCHBACK_THRESHOLD = 6;
export const MODULE_COLLAPSE_LEAVES = 80;
export const HARD_LEAF_CAP = 160;

const LANE = 4;
const DROP = 3;
const LANE_MIN = 5;
type AnchorEntry = MachineLayout['anchors'][number];

export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutError';
  }
}

interface Builder {
  pieces: Piece[];
  points: MachineLayout['graph']['points'];
  edges: MachineLayout['graph']['edges'];
  anchors: [NodeId, AnchorEntry][];
}

interface Box {
  width: number;
  height: number;
  depth: number;
  entry: Vec3;
  exit: Vec3;
  startPieces?: number;
  startPoints?: number;
}

export function layout(program: Program): MachineLayout {
  if (program.leafCount > HARD_LEAF_CAP) {
    throw new LayoutError(
      `Pattern is too big to build (${program.leafCount} leaves; maximum ${HARD_LEAF_CAP})`,
    );
  }
  const builder: Builder = { pieces: [], points: [], edges: [], anchors: [] };
  const moduleCollapses =
    program.leafCount > MODULE_COLLAPSE_LEAVES ? collapsibleNodes(program) : new Set<number>();
  const box = place(program.root, builder, moduleCollapses, 0, { x: 0, y: 0, z: 0 });
  const anchors = Object.fromEntries(builder.anchors) as MachineLayout['anchors'];
  const graph = graphFromAnchors(builder, program.root);
  builder.pieces.unshift({
    kind: 'hopper',
    node: null,
    position: { x: box.entry.x, y: box.entry.y + 3, z: box.entry.z },
    size: { x: 1.5, y: 1, z: 1.5 },
  });
  builder.pieces.push({
    kind: 'cup',
    node: null,
    position: { x: box.exit.x, y: box.exit.y - 3, z: box.exit.z },
    size: { x: 1.5, y: 1, z: 1.5 },
  });
  builder.pieces.push({
    kind: 'rejectTray',
    node: null,
    position: { x: box.exit.x + 3, y: box.exit.y - 3, z: box.exit.z },
    size: { x: 2, y: 1, z: 2 },
  });
  const bounds = computeBounds(builder.pieces, graph);
  return { bounds, pieces: builder.pieces, graph, anchors };
}

function collapsibleNodes(program: Program): Set<number> {
  const collapsed = new Set<number>();
  const count = (node: IR): number => {
    let leaves = 0;
    for (const n of walk(node))
      if (n.kind === 'char' || n.kind === 'assert' || n.kind === 'opaque' || n.kind === 'backref') leaves++;
    if (node.kind === 'group' && leaves > 4) collapsed.add(node.id);
    return leaves;
  };
  count(program.root);
  return collapsed;
}

function place(node: IR, builder: Builder, collapsed: Set<number>, depth: number, at: Vec3): Box {
  const startPieces = builder.pieces.length;
  const startPoints = builder.points.length;
  let result: Box;
  if (collapsed.has(node.id) && node.kind === 'group') {
    result = modulePiece(node, builder, at);
  } else {
    switch (node.kind) {
      case 'empty':
        result = { width: 0, height: 0, depth: 0, entry: at, exit: at };
        break;
      case 'char':
      case 'assert':
      case 'opaque':
      case 'backref':
        result = leaf(node, builder, at);
        break;
      case 'seq':
        result = sequence(node, builder, collapsed, depth, at);
        break;
      case 'alt':
        result = alternation(node, builder, collapsed, depth, at);
        break;
      case 'repeat':
        result = repetition(node, builder, collapsed, depth, at);
        break;
      case 'group': {
        const body = place(node.body, builder, collapsed, depth + 1, at);
        piece(builder, 'groupFrame', node.id, center(body), size(body, 0.6), 'capture');
        builder.anchors.push([
          node.id,
          { entry: addPoint(builder, body.entry, node.id), exit: addPoint(builder, body.exit, node.id) },
        ]);
        result = grow(body, 0.6, 0.6, 0.4);
        break;
      }
      case 'look': {
        const scoutAt = { ...at, z: at.z - LANE * 3 };
        const body = place(node.body, builder, collapsed, depth + 1, scoutAt);
        piece(
          builder,
          'scout',
          node.id,
          { x: body.entry.x, y: body.entry.y + 1, z: scoutAt.z },
          { x: 1.4, y: 1, z: 1 },
          'look',
        );
        builder.anchors.push([
          node.id,
          { entry: addPoint(builder, body.entry, node.id), exit: addPoint(builder, body.exit, node.id) },
        ]);
        result = grow(body, 0, 0, LANE * 3);
        break;
      }
    }
  }
  result.startPieces = startPieces;
  result.startPoints = startPoints;
  return result;
}

function leaf(node: IR, builder: Builder, at: Vec3): Box {
  const kind: PieceKind =
    node.kind === 'char'
      ? 'gate'
      : node.kind === 'assert'
        ? 'sensor'
        : node.kind === 'opaque'
          ? 'opaque'
          : 'mirror';
  const label =
    node.kind === 'char' || node.kind === 'opaque'
      ? node.label
      : node.kind === 'backref'
        ? `\\${node.groups.join('|')}`
        : node.kind === 'assert'
          ? assertLabel(node.what)
          : '';
  const position = { x: at.x, y: at.y - 1, z: at.z };
  piece(
    builder,
    kind,
    node.id,
    position,
    { x: 1.2, y: 1.2, z: 1 },
    node.kind === 'assert' ? 'assert' : 'base',
    label,
  );
  const box: Box = {
    width: 1.2,
    height: 2,
    depth: 1,
    entry: { x: at.x, y: at.y, z: at.z },
    exit: { x: at.x, y: at.y - 2, z: at.z },
  };
  builder.anchors.push([
    node.id,
    { entry: addPoint(builder, box.entry, node.id), exit: addPoint(builder, box.exit, node.id) },
  ]);
  return box;
}

function sequence(
  node: Extract<IR, { kind: 'seq' }>,
  builder: Builder,
  collapsed: Set<number>,
  depth: number,
  at: Vec3,
): Box {
  const box: Box = { width: 0, height: 0, depth: 0, entry: at, exit: at };
  let run = 0;
  let direction = 1;
  let column = 0;
  let top = at.y;
  const children = node.items.filter((item) => item.kind !== 'empty');
  for (const child of children) {
    const long = children.length > SWITCHBACK_THRESHOLD;
    if (long && run >= SWITCHBACK_THRESHOLD) {
      direction *= -1;
      run = 0;
      column = direction === 1 ? 0 : column;
      top = box.exit.y;
    }
    const x = long ? direction * column * (LANE + 1.5) : 0;
    const childBox = place(child, builder, collapsed, depth, { x: at.x + x, y: top, z: at.z });
    box.width = Math.max(box.width, childBox.width + Math.abs(x));
    box.height += childBox.height + (long ? 0.4 : 1);
    box.depth = Math.max(box.depth, childBox.depth);
    box.exit = childBox.exit;
    top = childBox.exit.y;
    run++;
    column++;
  }
  builder.anchors.push([
    node.id,
    { entry: addPoint(builder, box.entry, node.id), exit: addPoint(builder, box.exit, node.id) },
  ]);
  return box;
}

function alternation(
  node: Extract<IR, { kind: 'alt' }>,
  builder: Builder,
  collapsed: Set<number>,
  depth: number,
  at: Vec3,
): Box {
  const branchBoxes: Box[] = [];
  let totalWidth = 0;
  let maxHeight = 0;
  let maxDepth = 0;
  for (const branch of node.branches) {
    const box = place(branch, builder, collapsed, depth, at);
    branchBoxes.push(box);
    totalWidth += Math.max(LANE, box.width, LANE_MIN, box.depth) + LANE;
    maxHeight = Math.max(maxHeight, box.height);
    maxDepth = Math.max(maxDepth, box.depth);
  }
  totalWidth -= LANE;
  let x = at.x - totalWidth / 2;
  piece(builder, 'diverter', node.id, at, { x: 1.2, y: 1, z: 1 }, 'alternation');
  for (const box of branchBoxes) {
    const laneWidth = Math.max(LANE, box.width, LANE_MIN, box.depth);
    const centerX = x + laneWidth / 2;
    const dx = centerX - box.entry.x;
    translateRange(builder, box.startPieces!, box.startPoints!, dx, -2, 0);
    if (Math.abs(dx) < LANE_MIN)
      translateRange(
        builder,
        box.startPieces!,
        box.startPoints!,
        (LANE_MIN - Math.abs(dx)) * Math.sign(dx || 1),
        0,
        0,
      );
    box.entry = { ...box.entry, x: centerX, y: box.entry.y - 2 };
    box.exit = { ...box.exit, x: centerX, y: box.exit.y - 2 };
    piece(
      builder,
      'funnel',
      node.id,
      { x: centerX, y: at.y - 2 - box.height - 1, z: at.z },
      { x: laneWidth, y: 0.6, z: 1 },
      'alternation',
    );
    x += laneWidth + LANE;
  }
  const box: Box = {
    width: totalWidth,
    height: maxHeight + 4,
    depth: maxDepth,
    entry: at,
    exit: { x: at.x, y: at.y - maxHeight - 4, z: at.z },
  };
  builder.anchors.push([
    node.id,
    {
      entry: addPoint(builder, box.entry, node.id),
      exit: addPoint(builder, box.exit, node.id),
      diverter: at,
      flagSlot: { x: at.x + 0.8, y: at.y, z: at.z },
    },
  ]);
  return box;
}

function repetition(
  node: Extract<IR, { kind: 'repeat' }>,
  builder: Builder,
  collapsed: Set<number>,
  depth: number,
  at: Vec3,
): Box {
  const body = place(node.body, builder, collapsed, depth, { x: at.x, y: at.y - DROP, z: at.z });
  const role = node.greedy ? 'repeat' : 'lazyRepeat';
  piece(builder, 'diverter', node.id, at, { x: 1.2, y: 1, z: 1 }, role);
  piece(
    builder,
    'loopLift',
    node.id,
    { x: body.exit.x + 2, y: body.exit.y + body.height / 2, z: at.z - 2 },
    { x: 0.8, y: body.height + 2, z: 0.8 },
    role,
  );
  piece(
    builder,
    'bypassChute',
    node.id,
    { x: body.exit.x + 4, y: body.exit.y + body.height / 2, z: at.z },
    { x: 0.8, y: body.height + 2, z: 0.8 },
    role,
  );
  const box: Box = {
    width: body.width + 4,
    height: body.height + DROP,
    depth: body.depth + 2,
    entry: at,
    exit: { x: body.exit.x, y: body.exit.y - 1, z: at.z },
  };
  builder.anchors.push([
    node.id,
    {
      entry: addPoint(builder, box.entry, node.id),
      exit: addPoint(builder, box.exit, node.id),
      diverter: at,
      flagSlot: { x: at.x + 0.8, y: at.y, z: at.z },
      returnPort: 0,
    },
  ]);
  return box;
}

function modulePiece(node: IR, builder: Builder, at: Vec3): Box {
  const position = { x: at.x, y: at.y - 1, z: at.z };
  piece(builder, 'module', node.id, position, { x: 2, y: 2, z: 1.5 }, 'capture', 'module');
  const box: Box = {
    width: 2,
    height: 2,
    depth: 1.5,
    entry: { x: at.x, y: at.y, z: at.z },
    exit: { x: at.x, y: at.y - 2, z: at.z },
  };
  builder.anchors.push([
    node.id,
    { entry: addPoint(builder, box.entry, node.id), exit: addPoint(builder, box.exit, node.id) },
  ]);
  return box;
}

function graphFromAnchors(builder: Builder, root: IR): MachineLayout['graph'] {
  const points = builder.points;
  const edges: MachineLayout['graph']['edges'] = [];
  const byNode = [...builder.anchors].sort((a, b) => a[0] - b[0]);
  for (const [, anchor] of byNode) {
    if (anchor.entry !== anchor.exit) edges.push({ from: anchor.entry, to: anchor.exit, piece: 0 });
  }
  for (let i = 1; i < byNode.length; i++) {
    edges.push({ from: byNode[i - 1][1].exit, to: byNode[i][1].entry, piece: 0 });
  }
  const rootAnchor = builder.anchors.find(([node]) => node === root.id)?.[1];
  if (rootAnchor) {
    const hopperPoint = points.length;
    points.push({ id: hopperPoint, position: { x: 0, y: 3, z: 0 }, node: null });
    const cupPoint = points.length;
    points.push({ id: cupPoint, position: { x: 0, y: -1000, z: 0 }, node: null });
    edges.unshift({ from: hopperPoint, to: rootAnchor.entry, piece: 0 });
    edges.push({ from: rootAnchor.exit, to: cupPoint, piece: 1 });
  }
  return { points, edges };
}

function piece(
  builder: Builder,
  kind: PieceKind,
  node: NodeId | null,
  position: Vec3,
  size: Vec3,
  role: Piece['role'] = 'base',
  label?: string,
): number {
  builder.pieces.push({ kind, node, position, size, role, label });
  return builder.pieces.length - 1;
}

function addPoint(builder: Builder, position: Vec3, node: NodeId | null): number {
  const id = builder.points.length;
  builder.points.push({ id, position: { ...position }, node });
  return id;
}

function translateRange(
  builder: Builder,
  startPieces: number,
  startPoints: number,
  dx: number,
  dy: number,
  dz: number,
): void {
  for (let i = startPoints; i < builder.points.length; i++) {
    builder.points[i].position.x += dx;
    builder.points[i].position.y += dy;
    builder.points[i].position.z += dz;
  }
  for (let i = startPieces; i < builder.pieces.length; i++) {
    builder.pieces[i].position.x += dx;
    builder.pieces[i].position.y += dy;
    builder.pieces[i].position.z += dz;
  }
  for (let i = 0; i < builder.anchors.length; i++) {
    const [node, anchor] = builder.anchors[i];
    if (anchor.entry >= startPoints && anchor.exit <= builder.points.length - 1) {
      const moved: typeof anchor = { ...anchor };
      if (moved.gate)
        moved.gate = { ...moved.gate, x: moved.gate.x + dx, y: moved.gate.y + dy, z: moved.gate.z + dz };
      if (moved.diverter)
        moved.diverter = {
          ...moved.diverter,
          x: moved.diverter.x + dx,
          y: moved.diverter.y + dy,
          z: moved.diverter.z + dz,
        };
      if (moved.flagSlot)
        moved.flagSlot = {
          ...moved.flagSlot,
          x: moved.flagSlot.x + dx,
          y: moved.flagSlot.y + dy,
          z: moved.flagSlot.z + dz,
        };
      builder.anchors[i] = [node, moved];
    }
  }
}

function center(box: Box): Vec3 {
  return { x: box.entry.x, y: (box.entry.y + box.exit.y) / 2, z: box.entry.z };
}

function size(box: Box, pad: number): Vec3 {
  return { x: box.width + pad, y: box.height + pad, z: box.depth + pad };
}

function grow(box: Box, width: number, height: number, depth: number): Box {
  return { ...box, width: box.width + width, height: box.height + height, depth: box.depth + depth };
}

function computeBounds(pieces: Piece[], graph: MachineLayout['graph']): MachineLayout['bounds'] {
  const min = { x: -LANE, y: Infinity, z: -LANE * 2 };
  const max = { x: LANE, y: 2, z: LANE * 2 };
  for (const p of pieces) {
    min.x = Math.min(min.x, p.position.x - p.size.x / 2);
    min.y = Math.min(min.y, p.position.y - p.size.y / 2);
    min.z = Math.min(min.z, p.position.z - p.size.z / 2);
    max.x = Math.max(max.x, p.position.x + p.size.x / 2);
    max.y = Math.max(max.y, p.position.y + p.size.y / 2);
    max.z = Math.max(max.z, p.position.z + p.size.z / 2);
  }
  for (const point of graph.points) {
    min.x = Math.min(min.x, point.position.x);
    min.y = Math.min(min.y, point.position.y);
    min.z = Math.min(min.z, point.position.z);
    max.x = Math.max(max.x, point.position.x);
    max.y = Math.max(max.y, point.position.y);
    max.z = Math.max(max.z, point.position.z);
  }
  return { min, max };
}

function assertLabel(what: 'start' | 'end' | 'word' | 'notWord'): string {
  switch (what) {
    case 'start':
      return '^';
    case 'end':
      return '$';
    case 'word':
      return '\\b';
    case 'notWord':
      return '\\B';
  }
}
