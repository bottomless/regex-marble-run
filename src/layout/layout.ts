import type { IR, NodeId, Program } from '../engine/ir.ts';
import { isLeaf, walk } from '../engine/ir.ts';
import type { MachineLayout, NodeAnchor, Piece, PieceKind, Vec3 } from './pieces.ts';

export const SWITCHBACK_THRESHOLD = 6;
export const MODULE_COLLAPSE_LEAVES = 80;
export const HARD_LEAF_CAP = 320;

const RADIUS = 0.36;
const GAP = 0.8;
const DROP = 2;
const BRANCH_GAP = 3.0;
/** Horizontal run between consecutive sequence items, so a sequence descends as a staircase. */
export const STAIR_STEP = 3.0;
type Bounds = MachineLayout['bounds'];
type Ref = number | { child: number; port: 'entry' | 'exit' };
interface Child {
  plan: Measured;
  offset: Vec3;
}
interface Curve {
  from: Ref;
  to: Ref;
  piece: Piece;
}
interface Measured {
  node: IR;
  points: Vec3[];
  children: Child[];
  curves: Curve[];
  decorations: Piece[];
  entry: Ref;
  exit: Ref;
  bounds: Bounds;
  gate?: Vec3;
  returnPort?: number;
  collapsed?: boolean;
}
interface Builder {
  pieces: Piece[];
  graph: MachineLayout['graph'];
  anchors: MachineLayout['anchors'];
}
interface Choice {
  port: number;
  node: number;
  role: Piece['role'];
}
interface Placed {
  anchor: NodeAnchor;
  choices: Choice[];
}

export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutError';
  }
}

export function layout(program: Program, options: { expandedModules?: number[] } = {}): MachineLayout {
  if (program.leafCount > HARD_LEAF_CAP) {
    throw new LayoutError(
      `Pattern is too big to build (${program.leafCount} leaves; maximum ${HARD_LEAF_CAP})`,
    );
  }
  const expanded = new Set(options.expandedModules);
  const counts = new Map<number, number>();
  const count = (node: IR): number => {
    const children = childrenOf(node);
    const leaves = isLeaf(node) ? 1 : children.reduce((sum, child) => sum + count(child), 0);
    counts.set(node.id, leaves);
    return leaves;
  };
  count(program.root);
  const collapsed = new Set<number>();
  if (program.leafCount > MODULE_COLLAPSE_LEAVES) {
    for (const node of walk(program.root)) {
      if (
        node.kind === 'group' &&
        node.id !== program.root.id &&
        counts.get(node.id)! > 12 &&
        !expanded.has(node.id)
      ) {
        collapsed.add(node.id);
      }
    }
  }
  const measured = measure(program.root, collapsed, 0, false);
  const builder: Builder = { pieces: [], graph: { points: [], edges: [] }, anchors: {} };
  const { anchor: root } = place(measured, builder, vec());
  const entry = builder.graph.points[root.entry].position;
  const exit = builder.graph.points[root.exit].position;
  const hopper = addPoint(builder, add(entry, vec(0, 2, 0)), null);
  const cup = addPoint(builder, add(exit, vec(0, -1.8, 0)), null);
  const reject = addPoint(builder, add(exit, vec(3.8, -1.8, 0)), null);
  connect(
    builder,
    'hopper',
    null,
    hopper,
    root.entry,
    [],
    'base',
    vec(1.5, 1, 1.5),
    builder.graph.points[hopper].position,
  );
  connect(
    builder,
    'cup',
    null,
    root.exit,
    cup,
    [],
    'base',
    vec(2.5, 1, 1.6),
    builder.graph.points[cup].position,
  );
  connect(
    builder,
    'rejectTray',
    null,
    root.exit,
    reject,
    [add(exit, vec(2.8, -1.1, 0))],
    'base',
    vec(2.2, 1, 2),
    builder.graph.points[reject].position,
  );
  return {
    bounds: boundsOf(
      builder.pieces,
      builder.graph.points.map((point) => point.position),
    ),
    pieces: builder.pieces,
    graph: builder.graph,
    anchors: builder.anchors,
  };
}

function childrenOf(node: IR): IR[] {
  if (node.kind === 'seq') return node.items;
  if (node.kind === 'alt') return node.branches;
  if (node.kind === 'group' || node.kind === 'look' || node.kind === 'repeat') return [node.body];
  return [];
}

function vec(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z);
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return vec((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

function localPoint(plan: Measured, position: Vec3): number {
  plan.points.push({ ...position });
  return plan.points.length - 1;
}

function position(plan: Measured, ref: Ref): Vec3 {
  if (typeof ref === 'number') return plan.points[ref];
  const child = plan.children[ref.child];
  return add(position(child.plan, child.plan[ref.port]), child.offset);
}

function childRef(child: number, port: 'entry' | 'exit'): Ref {
  return { child, port };
}

function curve(
  plan: Measured,
  kind: PieceKind,
  from: Ref,
  to: Ref,
  controls: Vec3[] = [],
  role: Piece['role'] = 'base',
  size?: Vec3,
  label?: string,
): void {
  const points = [position(plan, from), ...controls, position(plan, to)].map((point) => ({ ...point }));
  if (kind !== 'backLift' && kind !== 'loopLift' && !downhillSpline(points)) {
    let previous = from;
    for (let i = 1; i < points.length; i++) {
      const next = i === points.length - 1 ? to : localPoint(plan, points[i]);
      curve(plan, kind, previous, next, [], role, size, label);
      previous = next;
    }
    return;
  }
  const bounds = splineBounds(points);
  plan.curves.push({
    from,
    to,
    piece: {
      kind,
      node: plan.node.id,
      points,
      position: size ? midpoint(points[0], points[points.length - 1]) : midpoint(bounds.min, bounds.max),
      size:
        size ?? vec(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z),
      role,
      label,
    },
  });
}

function finish(plan: Measured): Measured {
  const pieces = [...plan.decorations, ...plan.curves.map((item) => item.piece)];
  const points = [...plan.points];
  for (const child of plan.children) {
    points.push(add(child.plan.bounds.min, child.offset), add(child.plan.bounds.max, child.offset));
  }
  plan.bounds = boundsOf(pieces, points);
  return plan;
}

function measure(node: IR, collapsed: Set<number>, depth: number, ghost: boolean, diagonal = 0): Measured {
  const plan: Measured = {
    node,
    points: [],
    children: [],
    curves: [],
    decorations: [],
    entry: 0,
    exit: 1,
    bounds: { min: vec(), max: vec() },
  };
  const role = ghost ? 'look' : 'base';
  if (collapsed.has(node.id)) {
    plan.collapsed = true;
    plan.entry = localPoint(plan, vec());
    plan.exit = localPoint(plan, vec(0, -2.6));
    plan.gate = vec(0, -1.3);
    curve(
      plan,
      'module',
      plan.entry,
      plan.exit,
      [],
      ghost ? 'look' : 'capture',
      vec(2.2, 2, 1.6),
      groupLabel(node),
    );
    plan.curves[0].piece.containedNodes = [...walk(node)].map((item) => item.id);
    return finish(plan);
  }
  if (isLeaf(node) || node.kind === 'empty') {
    plan.entry = localPoint(plan, vec());
    plan.exit = localPoint(
      plan,
      diagonal ? vec(diagonal * 1.4, -0.08) : vec(0, node.kind === 'empty' ? -0.7 : -1.6),
    );
    const kind: PieceKind =
      node.kind === 'char'
        ? 'gate'
        : node.kind === 'assert'
          ? 'sensor'
          : node.kind === 'opaque'
            ? 'opaque'
            : node.kind === 'backref'
              ? 'mirror'
              : 'track';
    const label =
      node.kind === 'char' || node.kind === 'opaque'
        ? node.label
        : node.kind === 'backref'
          ? `\\${node.groups.join('|')}`
          : node.kind === 'assert'
            ? assertLabel(node.what)
            : undefined;
    const size = node.kind === 'empty' ? undefined : vec(node.kind === 'assert' ? 1.4 : 1.2, 1.2, 1.2);
    curve(
      plan,
      kind,
      plan.entry,
      plan.exit,
      [],
      ghost ? 'look' : node.kind === 'assert' ? 'assert' : 'base',
      size,
      label,
    );
    if (node.kind !== 'empty') plan.gate = midpoint(position(plan, plan.entry), position(plan, plan.exit));
    return finish(plan);
  }
  switch (node.kind) {
    case 'seq': {
      if (node.items.length > SWITCHBACK_THRESHOLD && node.items.every(isLeaf)) {
        const columns = Math.max(SWITCHBACK_THRESHOLD, Math.ceil(Math.sqrt(node.items.length)));
        for (let i = 0; i < node.items.length; i++) {
          const row = Math.floor(i / columns);
          const column = i % columns;
          const direction = row % 2 === 0 ? 1 : -1;
          const x = (direction === 1 ? column : columns - 1 - column) * 2.4;
          const offset = vec(x - direction * 0.7 + 0.7, -row * (columns * 0.12 + 1.6) - column * 0.12);
          plan.children.push({ plan: measure(node.items[i], collapsed, depth, ghost, direction), offset });
        }
      } else {
        let at = vec();
        let direction = 1;
        const reach = STAIR_STEP * Math.max(1, Math.ceil(Math.sqrt(node.items.length)));
        for (const child of node.items) {
          const measured = measure(child, collapsed, depth, ghost);
          plan.children.push({ plan: measured, offset: at });
          const exit = add(position(measured, measured.exit), at);
          let x = exit.x + direction * STAIR_STEP;
          if (Math.abs(x) > reach + 1e-9) {
            direction = -direction;
            x = exit.x + direction * STAIR_STEP;
          }
          at = vec(x, Math.min(exit.y, measured.bounds.min.y + at.y) - GAP, exit.z);
        }
      }
      if (!plan.children.length) {
        plan.entry = localPoint(plan, vec());
        plan.exit = localPoint(plan, vec(0, -0.7));
        curve(plan, 'track', plan.entry, plan.exit, [], role);
      } else {
        plan.entry = childRef(0, 'entry');
        plan.exit = childRef(plan.children.length - 1, 'exit');
        for (let i = 1; i < plan.children.length; i++) {
          curve(plan, 'track', childRef(i - 1, 'exit'), childRef(i, 'entry'), [], role);
        }
      }
      break;
    }
    case 'group': {
      const body = measure(node.body, collapsed, depth + 1, ghost);
      plan.children.push({ plan: body, offset: vec() });
      plan.entry = childRef(0, 'entry');
      plan.exit = childRef(0, 'exit');
      if (node.capture !== null) {
        const bounds = body.bounds;
        plan.decorations.push({
          kind: 'groupFrame',
          node: node.id,
          position: vec(
            (bounds.min.x + bounds.max.x) / 2,
            (bounds.min.y + bounds.max.y) / 2,
            bounds.max.z + 0.35 + depth * 0.12,
          ),
          size: vec(bounds.max.x - bounds.min.x + 0.8, bounds.max.y - bounds.min.y + 0.8, 0.12),
          role: 'capture',
          label: groupLabel(node),
        });
      }
      break;
    }
    case 'alt': {
      const branches = node.branches.map((branch) => measure(branch, collapsed, depth, ghost));
      const width =
        branches.reduce((sum, branch) => sum + branch.bounds.max.x - branch.bounds.min.x, 0) +
        BRANCH_GAP * Math.max(0, branches.length - 1);
      let x = -width / 2;
      for (const branch of branches) {
        const offset = vec(x - branch.bounds.min.x, -DROP - Math.max(0, branch.bounds.max.y));
        plan.children.push({ plan: branch, offset });
        x += branch.bounds.max.x - branch.bounds.min.x + BRANCH_GAP;
      }
      plan.entry = localPoint(plan, vec());
      const bottom = Math.min(
        -DROP,
        ...plan.children.map((child) => child.plan.bounds.min.y + child.offset.y),
      );
      plan.exit = localPoint(plan, vec(0, bottom - DROP));
      decorateChoice(plan, ghost ? 'look' : 'alternation');
      for (let i = 0; i < branches.length; i++) {
        curve(plan, 'track', plan.entry, childRef(i, 'entry'), [], ghost ? 'look' : 'alternation');
        curve(plan, 'track', childRef(i, 'exit'), plan.exit, [], ghost ? 'look' : 'alternation');
      }
      plan.decorations.push({
        kind: 'funnel',
        node: node.id,
        position: { ...position(plan, plan.exit) },
        size: vec(1.4, 0.8, 1.2),
        role: ghost ? 'look' : 'alternation',
      });
      break;
    }
    case 'repeat': {
      const body = measure(node.body, collapsed, depth, ghost);
      const offset = vec(0, -DROP - Math.max(0, body.bounds.max.y));
      plan.children.push({ plan: body, offset });
      plan.entry = localPoint(plan, vec());
      plan.exit = localPoint(plan, vec(0, body.bounds.min.y + offset.y - DROP));
      const repeatRole = ghost ? 'look' : node.greedy ? 'repeat' : 'lazyRepeat';
      decorateChoice(plan, repeatRole);
      const bypassX = body.bounds.max.x + 2.4;
      const end = position(plan, plan.exit);
      const bypass = () =>
        curve(
          plan,
          'bypassChute',
          plan.entry,
          plan.exit,
          [vec(bypassX, -1.5), vec(bypassX, end.y + 1.5)],
          repeatRole,
        );
      if (!node.greedy) bypass();
      curve(plan, 'track', plan.entry, childRef(0, 'entry'), [], repeatRole);
      if (node.greedy) bypass();
      curve(plan, 'track', childRef(0, 'exit'), plan.exit, [], repeatRole);
      break;
    }
    case 'look': {
      const body = measure(node.body, collapsed, depth, true);
      const offset = vec(STAIR_STEP - body.bounds.min.x, -DROP - Math.max(0, body.bounds.max.y), -2.4);
      plan.children.push({ plan: body, offset });
      plan.entry = localPoint(plan, vec());
      const pass = localPoint(plan, vec(0, -1.4));
      plan.exit = localPoint(plan, vec(0, body.bounds.min.y + offset.y - DROP));
      curve(plan, 'scout', plan.entry, pass, [], 'look', vec(1.4, 1, 1.2), node.negate ? '?!' : '?=');
      plan.gate = vec(0, -0.7);
      curve(plan, 'track', pass, plan.exit, [], 'look');
      curve(plan, 'track', pass, childRef(0, 'entry'), [], 'look');
      const end = position(plan, childRef(0, 'exit'));
      const exit = position(plan, plan.exit);
      curve(
        plan,
        'returnRail',
        childRef(0, 'exit'),
        plan.exit,
        [vec(end.x, end.y - 0.6, offset.z - 1), vec(exit.x, exit.y + 0.6, offset.z - 1)],
        'look',
      );
      break;
    }
  }
  if (node.kind === 'repeat' || node.kind === 'alt') {
    const provisional = finish(plan).bounds;
    const rear = provisional.min.z - 1.8;
    plan.returnPort = localPoint(plan, vec(0, 0.8, rear));
    curve(
      plan,
      'returnRail',
      plan.returnPort,
      plan.entry,
      [vec(0, 0.4, rear / 2)],
      ghost ? 'look' : node.kind === 'alt' ? 'alternation' : node.greedy ? 'repeat' : 'lazyRepeat',
    );
    if (node.kind === 'repeat') {
      const end = position(plan, childRef(0, 'exit'));
      curve(
        plan,
        'loopLift',
        childRef(0, 'exit'),
        plan.returnPort,
        [vec(end.x, end.y + 0.3, rear), vec(0, 0.3, rear)],
        ghost ? 'look' : node.greedy ? 'repeat' : 'lazyRepeat',
      );
    }
  }
  return finish(plan);
}

function decorateChoice(plan: Measured, role: Piece['role']): void {
  plan.decorations.push({
    kind: 'diverter',
    node: plan.node.id,
    position: vec(0, -0.1),
    size: vec(1.4, 0.8, 1.2),
    role,
  });
}

function groupLabel(node: IR): string {
  return node.kind === 'group'
    ? node.capture === null
      ? 'module'
      : node.name
        ? `${node.capture}: ${node.name}`
        : `${node.capture}`
    : 'module';
}

function place(plan: Measured, builder: Builder, offset: Vec3, parents: Choice[] = []): Placed {
  const localIds = plan.points.map((point) => addPoint(builder, add(point, offset), plan.node.id));
  const ownChoice =
    plan.returnPort === undefined
      ? undefined
      : {
          port: localIds[plan.returnPort],
          node: plan.node.id,
          role: plan.decorations.find((piece) => piece.kind === 'diverter')!.role,
        };
  let choices = ownChoice ? [ownChoice] : parents;
  const children: Placed[] = [];
  for (const child of plan.children) {
    const placed = place(child.plan, builder, add(offset, child.offset), choices);
    children.push(placed);
    if (plan.node.kind === 'seq' || plan.node.kind === 'group') choices = placed.choices;
  }
  if (plan.node.kind === 'alt' || plan.node.kind === 'repeat') {
    const heads = children.flatMap((child) => child.choices);
    if (ownChoice && plan.node.kind === 'repeat') heads.push(ownChoice);
    choices = [...new Map(heads.map((choice) => [choice.port, choice])).values()];
  }
  const resolve = (ref: Ref): number =>
    typeof ref === 'number' ? localIds[ref] : children[ref.child].anchor[ref.port];
  const anchor: NodeAnchor = { entry: resolve(plan.entry), exit: resolve(plan.exit) };
  if (plan.gate) anchor.gate = add(plan.gate, offset);
  if (ownChoice) {
    anchor.diverter = add(vec(0, -0.1), offset);
    anchor.flagSlot = add(vec(1, 0.2, 0.7), offset);
    anchor.returnPort = ownChoice.port;
  }
  builder.anchors[plan.node.id] = anchor;
  for (const decoration of plan.decorations) {
    builder.pieces.push({
      ...decoration,
      position: add(decoration.position, offset),
      size: { ...decoration.size },
    });
  }
  for (const item of plan.curves) {
    const piece = item.piece;
    const points = piece.points!.map((point) => add(point, offset));
    points[0] = { ...builder.graph.points[resolve(item.from)].position };
    points[points.length - 1] = { ...builder.graph.points[resolve(item.to)].position };
    const id = builder.pieces.length;
    builder.pieces.push({
      ...piece,
      position: add(piece.position, offset),
      size: { ...piece.size },
      points,
      containedNodes: piece.containedNodes?.slice(),
    });
    builder.graph.edges.push({
      from: resolve(item.from),
      to: resolve(item.to),
      piece: id,
      length: polylineLength(points),
    });
  }
  if (plan.collapsed) {
    for (const node of walk(plan.node)) {
      builder.anchors[node.id] = { ...anchor, gate: { ...anchor.gate! } };
    }
  }
  if (plan.gate || ownChoice) {
    for (const parent of parents) {
      const from = ownChoice?.port ?? anchor.exit;
      const start = builder.graph.points[from].position;
      const port = builder.graph.points[parent.port].position;
      const rear = vec(start.x, start.y - 0.5, Math.min(start.z, port.z));
      const railEnd = addPoint(builder, rear, plan.node.id);
      const role = plan.curves[0]?.piece.role === 'look' ? 'look' : parent.role;
      connect(
        builder,
        'returnRail',
        plan.node.id,
        from,
        railEnd,
        [vec(start.x, start.y - 0.25, (start.z + rear.z) / 2)],
        role,
      );
      connect(
        builder,
        'backLift',
        parent.node,
        railEnd,
        parent.port,
        [
          vec(start.x, rear.y + (port.y - rear.y) * 0.25, rear.z),
          vec(port.x, rear.y + (port.y - rear.y) * 0.75, rear.z),
        ],
        role,
      );
    }
  }
  return { anchor, choices };
}

function addPoint(builder: Builder, position: Vec3, node: NodeId | null): number {
  const id = builder.graph.points.length;
  builder.graph.points.push({ id, position: { ...position }, node });
  return id;
}

function connect(
  builder: Builder,
  kind: PieceKind,
  node: NodeId | null,
  from: number,
  to: number,
  controls: Vec3[] = [],
  role: Piece['role'] = 'base',
  size?: Vec3,
  center?: Vec3,
): void {
  const points = [builder.graph.points[from].position, ...controls, builder.graph.points[to].position].map(
    (point) => ({ ...point }),
  );
  const bounds = splineBounds(points);
  const piece = builder.pieces.length;
  builder.pieces.push({
    kind,
    node,
    points,
    role,
    position: center ? { ...center } : midpoint(bounds.min, bounds.max),
    size: size ?? vec(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z),
  });
  builder.graph.edges.push({ from, to, piece, length: polylineLength(points) });
}

function polylineLength(points: Vec3[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    length += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  return length;
}

function downhillSpline(points: Vec3[]): boolean {
  if (points.length <= 2) return true;
  for (let i = 0; i + 1 < points.length; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = points[i - 1] ?? vec(2 * p1.x - p2.x, 2 * p1.y - p2.y, 2 * p1.z - p2.z);
    const p3 = points[i + 2] ?? vec(2 * p2.x - p1.x, 2 * p2.y - p1.y, 2 * p2.z - p1.z);
    const interval = (a: Vec3, b: Vec3): number => Math.sqrt(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    const dt1 = interval(p1, p2) || 1;
    const dt0 = interval(p0, p1) || dt1;
    const dt2 = interval(p2, p3) || dt1;
    const t1 = ((p1.y - p0.y) / dt0 - (p2.y - p0.y) / (dt0 + dt1) + (p2.y - p1.y) / dt1) * dt1;
    const t2 = ((p2.y - p1.y) / dt1 - (p3.y - p1.y) / (dt1 + dt2) + (p3.y - p2.y) / dt2) * dt1;
    const quadratic = -3 * p1.y + 3 * p2.y - 2 * t1 - t2;
    const cubic = 2 * p1.y - 2 * p2.y + t1 + t2;
    if (Math.max(t1, t2) > 1e-9) return false;
    const extremum = -quadratic / (3 * cubic);
    if (
      extremum > 0 &&
      extremum < 1 &&
      t1 + 2 * quadratic * extremum + 3 * cubic * extremum * extremum > 1e-9
    )
      return false;
  }
  return true;
}

function splineBounds(points: Vec3[]): Bounds {
  const bounds = boundsOf([], points);
  const axes = ['x', 'y', 'z'] as const;
  for (let i = 0; i + 1 < points.length; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = points[i - 1] ?? vec(2 * p1.x - p2.x, 2 * p1.y - p2.y, 2 * p1.z - p2.z);
    const p3 = points[i + 2] ?? vec(2 * p2.x - p1.x, 2 * p2.y - p1.y, 2 * p2.z - p1.z);
    const interval = (a: Vec3, b: Vec3): number => Math.sqrt(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    const dt1 = interval(p1, p2) || 1;
    const dt0 = interval(p0, p1) || dt1;
    const dt2 = interval(p2, p3) || dt1;
    for (const axis of axes) {
      const a = p0[axis];
      const b = p1[axis];
      const c = p2[axis];
      const d = p3[axis];
      const t1 = ((b - a) / dt0 - (c - a) / (dt0 + dt1) + (c - b) / dt1) * dt1;
      const t2 = ((c - b) / dt1 - (d - b) / (dt1 + dt2) + (d - c) / dt2) * dt1;
      const quadratic = -3 * b + 3 * c - 2 * t1 - t2;
      const cubic = 2 * b - 2 * c + t1 + t2;
      const discriminant = 4 * quadratic * quadratic - 12 * cubic * t1;
      const roots =
        Math.abs(cubic) < 1e-12
          ? Math.abs(quadratic) < 1e-12
            ? []
            : [-t1 / (2 * quadratic)]
          : discriminant < 0
            ? []
            : [
                (-2 * quadratic + Math.sqrt(discriminant)) / (6 * cubic),
                (-2 * quadratic - Math.sqrt(discriminant)) / (6 * cubic),
              ];
      for (const t of roots) {
        if (t <= 0 || t >= 1) continue;
        const value = b + t1 * t + quadratic * t * t + cubic * t * t * t;
        bounds.min[axis] = Math.min(bounds.min[axis], value);
        bounds.max[axis] = Math.max(bounds.max[axis], value);
      }
    }
  }
  for (const axis of axes) {
    bounds.min[axis] -= RADIUS;
    bounds.max[axis] += RADIUS;
  }
  return bounds;
}

function boundsOf(pieces: Piece[], points: Vec3[]): Bounds {
  const min = vec(Infinity, Infinity, Infinity);
  const max = vec(-Infinity, -Infinity, -Infinity);
  const include = (point: Vec3, radius = 0): void => {
    for (const axis of ['x', 'y', 'z'] as const) {
      min[axis] = Math.min(min[axis], point[axis] - radius);
      max[axis] = Math.max(max[axis], point[axis] + radius);
    }
  };
  for (const piece of pieces) {
    include(
      vec(
        piece.position.x - piece.size.x / 2,
        piece.position.y - piece.size.y / 2,
        piece.position.z - piece.size.z / 2,
      ),
    );
    include(
      vec(
        piece.position.x + piece.size.x / 2,
        piece.position.y + piece.size.y / 2,
        piece.position.z + piece.size.z / 2,
      ),
    );
    if (piece.points) {
      const curve = splineBounds(piece.points);
      include(curve.min);
      include(curve.max);
    }
  }
  for (const point of points) include(point);
  if (!Number.isFinite(min.x)) return { min: vec(), max: vec() };
  return { min, max };
}

function assertLabel(what: 'start' | 'end' | 'word' | 'notWord'): string {
  return what === 'start' ? '^' : what === 'end' ? '$' : what === 'word' ? '\\b' : '\\B';
}
