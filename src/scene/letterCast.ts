import { T, type Trace } from '../engine/trace.ts';
import type { MachineLayout, PieceKind, Vec3 } from '../layout/pieces.ts';
import { routePath } from '../layout/route.ts';
import { pointAlongPolyline, polylineLength, poseForSegment } from '../playback/motion.ts';
import { ROLL_PER_UNIT_MS, type Segment, type Timeline } from '../playback/timeline.ts';
import { trackCurve, visibleTiles } from './geometry.ts';
import { gateOffset, holdOffset, restOffset } from './letterTrip.ts';
import { Ride } from './ride.ts';

const LIFT = 0.16;
const TILES = 36;
const LOOP: ReadonlySet<PieceKind> = new Set(['bypassChute', 'returnRail', 'loopLift', 'backLift']);

export type CastKind = 'hold' | 'follow' | 'approach' | 'park' | 'fall' | 'reject' | 'cup';

export interface CastSpan {
  t0: number;
  t1: number;
  kind: CastKind;
  from?: Vec3;
  to?: Vec3;
  via?: Vec3;
  at?: Vec3;
  points?: Vec3[];
  delay?: number;
}

export interface LetterCast {
  glyphs: string[];
  indices: number[];
  spans: CastSpan[][];
}

export interface Placement {
  position: Vec3;
  kind: CastKind;
  riding: boolean;
  visible: boolean;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function lifted(point: Vec3): Vec3 {
  return { x: point.x, y: point.y + LIFT, z: point.z };
}

function near(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.z - b.z) < 1e-4;
}

function dedupPoints(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const pt of points) {
    if (out.length === 0 || !near(out[out.length - 1], pt)) {
      out.push({ x: pt.x, y: pt.y, z: pt.z });
    }
  }
  return out;
}

function pieceAt(layout: MachineLayout, kind: PieceKind): Vec3 | null {
  return layout.pieces.find((piece) => piece.kind === kind)?.position ?? null;
}

function endpointStart(layout: MachineLayout, kind: PieceKind): number | null {
  const index = layout.pieces.findIndex((item) => item.kind === kind);
  if (index < 0) return null;
  return layout.graph.edges.find((edge) => edge.piece === index)?.from ?? null;
}

function endpoint(layout: MachineLayout, kind: PieceKind): number | null {
  const index = layout.pieces.findIndex((item) => item.kind === kind);
  if (index < 0) return null;
  return layout.graph.edges.find((edge) => edge.piece === index)?.to ?? null;
}

function edgeMap(layout: MachineLayout): Map<string, number> {
  const edges = new Map<string, number>();
  for (const edge of layout.graph.edges) edges.set(`${edge.from}:${edge.to}`, edge.piece);
  return edges;
}

export function hiddenLoopPieces(layout: MachineLayout, timeline: Timeline | null): Set<number> {
  const used = new Set<number>();
  const edges = edgeMap(layout);
  if (timeline) {
    for (const segment of timeline.segments) {
      const route = segment.route;
      if (!route) continue;
      for (let i = 1; i < route.length; i++) {
        const piece = edges.get(`${route[i - 1]}:${route[i]}`);
        if (piece !== undefined && LOOP.has(layout.pieces[piece]?.kind)) used.add(piece);
      }
    }
  }
  const hidden = new Set<number>();
  layout.pieces.forEach((piece, index) => {
    if (LOOP.has(piece.kind) && !used.has(index)) hidden.add(index);
  });
  return hidden;
}

function unitInterval(span: CastSpan, time: number): number {
  const spanTime = span.t1 - span.t0;
  if (spanTime <= 0) return 1;
  return Math.min(1, Math.max(0, (time - span.t0) / spanTime));
}

function beside(gate: Vec3, reject: Vec3): Vec3 {
  const sign = Math.sign(reject.x - gate.x) || 1;
  return { x: gate.x + sign * 1.15, y: gate.y + LIFT + 0.18, z: gate.z + 0.55 };
}

function fallAt(from: Vec3, via: Vec3, to: Vec3, u: number): Vec3 {
  if (u < 0.38) return lerp(from, via, u / 0.38);
  const v = (u - 0.38) / 0.62;
  const drop = lerp(via, to, v);
  return { x: drop.x, y: drop.y + Math.sin(v * Math.PI) * 0.22 * (1 - v), z: drop.z };
}

function fallPolyline(from: Vec3, via: Vec3, to: Vec3): Vec3[] {
  const steps = 16;
  const pts: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    pts.push(fallAt(from, via, to, i / steps));
  }
  return dedupPoints(pts);
}

function returnToHopperPolyline(layout: MachineLayout, from: Vec3, to: Vec3): Vec3[] {
  const total = Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);
  if (total < 1e-3) return [from, to];
  const rearZ = Math.min(layout.bounds.min.z - 0.8, from.z - 1.6, -2.0);
  const controls: Vec3[] = [
    from,
    { x: from.x, y: from.y - 0.15, z: rearZ },
    { x: from.x + (to.x - from.x) * 0.25, y: from.y + (to.y - from.y) * 0.3, z: rearZ },
    { x: from.x + (to.x - from.x) * 0.75, y: from.y + (to.y - from.y) * 0.75, z: rearZ },
    { x: to.x, y: to.y + 0.15, z: rearZ * 0.35 },
    to,
  ];
  const curve = trackCurve(controls);
  const steps = Math.max(16, Math.ceil((total + Math.abs(rearZ - from.z) * 2) * 3));
  const pts: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = curve.getPoint(i / steps);
    pts.push({ x: p.x, y: p.y, z: p.z });
  }
  return dedupPoints(pts);
}

function activeSpan(spans: CastSpan[], time: number): CastSpan {
  let chosen = spans[0];
  for (const span of spans) {
    if (span.t0 > time) break;
    chosen = span;
  }
  return chosen;
}

export function castAt(cast: LetterCast, time: number, _pose: Vec3 | null): Placement[] {
  let holds = 0;
  return cast.spans.map((spans) => {
    const span = activeSpan(spans, time);
    const riding = span.kind === 'follow' || span.kind === 'approach';
    const visible = span.kind !== 'hold' || holds++ < 8;
    let position = span.at ?? span.from ?? { x: 0, y: 0, z: 0 };
    if (span.points && span.points.length > 1) {
      const u = unitInterval(span, time);
      position = pointAlongPolyline(span.points, u)?.position ?? lerp(span.from ?? position, span.to ?? position, u);
    } else if (span.from && span.to) {
      position = lerp(span.from, span.to, unitInterval(span, time));
    }
    return { position, kind: span.kind, riding, visible };
  });
}

interface Tile {
  index: number;
  length: number;
  glyph: string;
}

function tilesOf(input: string, unicode: boolean): Tile[] {
  return visibleTiles(input, unicode, TILES).map((tile) => ({
    index: tile.index,
    length: tile.glyph.length,
    glyph: tile.glyph,
  }));
}

function tileAt(tiles: Tile[], pos: number): number | null {
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (pos >= tile.index && pos < tile.index + tile.length) return i;
  }
  return null;
}

function coveredTiles(tiles: Tile[], pos: number, len: number): number[] {
  if (len <= 0) return [];
  const found: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (pos < tile.index + tile.length && tile.index < pos + len) found.push(i);
  }
  return found;
}

function continues(trace: Trace, event: number, pos: number): boolean {
  for (let j = event + 1; j < trace.length; j++) {
    const kind = trace.t[j] as T;
    if (kind === T.iter || kind === T.look || kind === T.capture) continue;
    if (kind === T.backtrack) return trace.c[j] === pos;
    return false;
  }
  return false;
}

export function compileCast(
  trace: Trace,
  timeline: Timeline,
  layout: MachineLayout,
  input: string,
  unicode: boolean,
): LetterCast {
  const tiles = tilesOf(input, unicode);
  const hopper = pieceAt(layout, 'hopper') ?? { x: 0, y: 2, z: 0 };
  const cup = pieceAt(layout, 'cup') ?? { x: 0, y: -8, z: 0 };
  const reject = pieceAt(layout, 'rejectTray') ?? { x: 3, y: -8, z: 0 };
  const edges = edgeMap(layout);
  const rideSpline = new Ride(layout);
  const hopperStart = endpointStart(layout, 'hopper');
  const cupEnd = endpoint(layout, 'cup');
  const speed = Number.isFinite(timeline.speed) && timeline.speed > 0 ? timeline.speed : 1;
  const msPerUnit = timeline.collapsed ? 0 : ROLL_PER_UNIT_MS / speed;
  const releaseStaggerMs = timeline.collapsed ? 0 : 135 / speed;

  const byEvent: Segment[][] = Array.from({ length: trace.length }, () => []);
  for (const segment of timeline.segments) {
    if (segment.event >= 0 && segment.event < trace.length) byEvent[segment.event].push(segment);
  }
  const tests: number[][] = tiles.map(() => []);
  let matchStart = -1;
  let matchEnd = -1;
  for (let i = 0; i < trace.length; i++) {
    const kind = trace.t[i] as T;
    if (kind === T.test && trace.d[i] > 0) {
      for (const tile of coveredTiles(tiles, trace.b[i], trace.d[i])) tests[tile].push(i);
    } else if (kind === T.match) {
      matchStart = trace.a[i];
      matchEnd = trace.b[i];
    }
  }
  const retestedAfter = (tile: number, event: number): boolean => {
    const list = tests[tile];
    return list.length > 0 && list[list.length - 1] > event;
  };
  const inMatch = (tile: number): boolean =>
    matchStart >= 0 && tiles[tile].index < matchEnd && tiles[tile].index + tiles[tile].length > matchStart;

  const spans: CastSpan[][] = tiles.map(() => []);
  const mode: Array<'hold' | 'follow' | 'park' | 'reject'> = tiles.map(() => 'hold');
  const lastAt: Vec3[] = [];
  const lastTime: number[] = tiles.map(() => 0);
  const tilePoint: (number | null)[] = tiles.map(() => hopperStart);
  const tileGateNode: (number | null)[] = tiles.map(() => null);
  const tileGateSlot: (number | null)[] = tiles.map(() => null);
  const gateSlots = new Map<number, Set<number>>();
  let rejectOrder = 0;
  let cupOrder = 0;

  const holdAt = (tile: number): Vec3 => add(hopper, holdOffset(tile % 8));
  const rejectAt = (): Vec3 => add(reject, restOffset(rejectOrder++, 'rejectTray'));
  const cupAt = (): Vec3 => add(cup, restOffset(cupOrder++, 'cup'));

  const releaseGateSlot = (tile: number): void => {
    const node = tileGateNode[tile];
    const slot = tileGateSlot[tile];
    if (node !== null && slot !== null) {
      gateSlots.get(node)?.delete(slot);
    }
    tileGateNode[tile] = null;
    tileGateSlot[tile] = null;
  };

  const claimGateSlot = (tile: number, node: number, gatePos: Vec3): Vec3 => {
    releaseGateSlot(tile);
    let used = gateSlots.get(node);
    if (!used) {
      used = new Set<number>();
      gateSlots.set(node, used);
    }
    let slot = 0;
    while (used.has(slot)) slot++;
    used.add(slot);
    tileGateNode[tile] = node;
    tileGateSlot[tile] = slot;
    return add(gatePos, gateOffset(slot));
  };

  for (let i = 0; i < tiles.length; i++) {
    const at = holdAt(i);
    lastAt[i] = at;
    spans[i].push({ t0: 0, t1: Infinity, kind: 'hold', at });
  }

  const moveTile = (
    tile: number,
    startAnchor: number | null,
    endAnchor: number | null,
    moveKind: CastKind,
    rawPoints: Vec3[],
    afterKind: CastKind,
  ): number => {
    const from = lastAt[tile];
    const points = dedupPoints([from, ...rawPoints]);
    const target = points[points.length - 1] ?? from;
    const dist = polylineLength(points);
    const duration = dist < 1e-4 ? 0 : dist * msPerUnit;
    let t0: number;
    if (startAnchor !== null) {
      t0 = Math.max(lastTime[tile], startAnchor);
    } else if (endAnchor !== null) {
      t0 = Math.max(lastTime[tile], endAnchor - duration);
    } else {
      t0 = lastTime[tile];
    }
    const t1 = t0 + duration;
    const list = spans[tile];
    const prev = list[list.length - 1];
    if (prev) {
      prev.t1 = t0;
      if (prev.t1 <= prev.t0) list.pop();
    }
    if (duration > 0) {
      list.push({ t0, t1, kind: moveKind, from, to: target, points });
    }
    list.push({ t0: t1, t1: Infinity, kind: afterKind, at: target });
    lastAt[tile] = target;
    lastTime[tile] = t1;
    return t1;
  };

  const attemptChain: number[] = hopperStart !== null ? [hopperStart] : [];
  const extendChain = (pt: number | undefined): void => {
    if (pt === undefined) return;
    const idx = attemptChain.indexOf(pt);
    if (idx >= 0) attemptChain.length = idx + 1;
    else attemptChain.push(pt);
  };
  const extendChainRoute = (route: number[] | undefined): void => {
    if (!route) return;
    for (const pt of route) extendChain(pt);
  };

  const routeForTile = (tile: number, toPoint: number | undefined): number[] => {
    if (toPoint === undefined) return [];
    const fromPoint = tilePoint[tile];
    if (fromPoint === null) return [];
    const fromIdx = attemptChain.indexOf(fromPoint);
    const toIdx = attemptChain.indexOf(toPoint);
    if (fromIdx >= 0 && toIdx >= fromIdx) {
      return attemptChain.slice(fromIdx, toIdx + 1);
    }
    return routePath(layout.graph, fromPoint, toPoint) ?? [];
  };

  const windowOf = (event: number): { t0: number; t1: number; gate: Segment | null } => {
    const segs = byEvent[event];
    if (segs.length === 0) return { t0: 0, t1: 0, gate: null };
    return {
      t0: segs[0].t0,
      t1: segs[segs.length - 1].t1,
      gate: segs.find((segment) => segment.kind === 'gate') ?? null,
    };
  };

  const gatePoint = (segment: Segment | null): Vec3 | null => {
    if (!segment) return null;
    return poseForSegment(layout, segment, 0)?.position ?? null;
  };

  const nextTestInAttempt = (tile: number, afterEvent: number): number | null => {
    for (let j = afterEvent + 1; j < trace.length; j++) {
      const k = trace.t[j] as T;
      if (k === T.attempt || k === T.match || k === T.nomatch) return null;
      if (k === T.test && trace.d[j] > 0) {
        if (coveredTiles(tiles, trace.b[j], trace.d[j]).includes(tile)) return trace.a[j];
      }
    }
    return null;
  };

  const forwardRouteToNode = (fromPt: number | null, toNode: number): number[] | null => {
    if (fromPt === null) return null;
    const toPt = layout.anchors[toNode]?.entry;
    if (toPt === undefined) return null;
    const path = routePath(layout.graph, fromPt, toPt);
    if (!path || path.length < 2) return null;
    for (let i = 1; i < path.length; i++) {
      const pieceIdx = edges.get(`${path[i - 1]}:${path[i]}`);
      const pieceKind = pieceIdx !== undefined ? layout.pieces[pieceIdx]?.kind : undefined;
      if (pieceKind === 'backLift' || pieceKind === 'loopLift') return null;
    }
    return path;
  };

  for (let event = 0; event < trace.length; event++) {
    const kind = trace.t[event] as T;
    const win = windowOf(event);
    const segs = byEvent[event];

    if (kind === T.attempt) {
      attemptChain.length = 0;
      if (hopperStart !== null) attemptChain.push(hopperStart);
      let releaseIndex = 0;
      for (let tile = 0; tile < tiles.length; tile++) {
        if (mode[tile] === 'hold' || mode[tile] === 'reject') continue;
        releaseGateSlot(tile);
        const startT = win.t0 + releaseIndex++ * releaseStaggerMs;
        if (retestedAfter(tile, event)) {
          const back = holdAt(tile);
          moveTile(
            tile,
            startT,
            null,
            'approach',
            returnToHopperPolyline(layout, lastAt[tile], back),
            'hold',
          );
          mode[tile] = 'hold';
          tilePoint[tile] = hopperStart;
          continue;
        }
        if (inMatch(tile) && mode[tile] === 'park') continue;
        const to = rejectAt();
        moveTile(
          tile,
          startT,
          null,
          'fall',
          fallPolyline(lastAt[tile], beside(lastAt[tile], reject), to),
          'reject',
        );
        mode[tile] = 'reject';
        tilePoint[tile] = null;
      }
    } else if (kind === T.choose) {
      for (const seg of segs) {
        if (seg.route) extendChainRoute(seg.route);
      }
      extendChain(layout.anchors[trace.a[event]]?.entry);
    } else if (kind === T.test) {
      for (const seg of segs) {
        if (seg.route) extendChainRoute(seg.route);
      }
      const node = trace.a[event];
      const pos = trace.b[event];
      const ok = trace.c[event] === 1;
      const len = trace.d[event];
      const anchor = layout.anchors[node];
      extendChain(anchor?.entry);
      const gate = gatePoint(win.gate) ?? anchor?.gate ?? null;
      const gateT0 = win.gate?.t0 ?? win.t0;
      const gateT1 = win.gate?.t1 ?? win.t1;
      if (len <= 0 || !gate || !anchor) {
        extendChain(anchor?.exit);
        continue;
      }
      const kept = continues(trace, event, pos);
      const covered = coveredTiles(tiles, pos, len);
      for (const tile of covered) {
        if (mode[tile] === 'reject') continue;
        releaseGateSlot(tile);
        const r = routeForTile(tile, anchor.entry);
        const entrySpline =
          r.length >= 2
            ? rideSpline.points(r).map(lifted)
            : [lifted(layout.graph.points[anchor.entry].position)];
        if (ok) {
          const slotPos = claimGateSlot(tile, node, gate);
          moveTile(tile, null, gateT1, 'follow', [...entrySpline, lifted(gate), slotPos], 'park');
          mode[tile] = 'park';
          tilePoint[tile] = anchor.exit;
          continue;
        }
        const nextNode = retestedAfter(tile, event) ? nextTestInAttempt(tile, event) : null;
        if (kept || (nextNode !== null && forwardRouteToNode(anchor.exit, nextNode) !== null)) {
          const exitPos = lifted(layout.graph.points[anchor.exit].position);
          moveTile(tile, null, gateT1, 'follow', [...entrySpline, lifted(gate), exitPos], 'follow');
          mode[tile] = 'follow';
          tilePoint[tile] = anchor.exit;
          continue;
        }
        const arrivedT = moveTile(tile, null, gateT0, 'follow', [...entrySpline, lifted(gate)], 'follow');
        if (retestedAfter(tile, event)) {
          const back = holdAt(tile);
          moveTile(
            tile,
            arrivedT,
            null,
            'approach',
            returnToHopperPolyline(layout, lastAt[tile], back),
            'hold',
          );
          mode[tile] = 'hold';
          tilePoint[tile] = hopperStart;
          continue;
        }
        const to = rejectAt();
        moveTile(
          tile,
          arrivedT,
          null,
          'fall',
          fallPolyline(lastAt[tile], beside(gate, reject), to),
          'reject',
        );
        mode[tile] = 'reject';
        tilePoint[tile] = null;
      }
      extendChain(anchor.exit);
    } else if (kind === T.backtrack) {
      const backRoute: number[] = [];
      for (const seg of segs) {
        if (!seg.route) continue;
        for (const pt of seg.route) {
          if (backRoute.length === 0 || backRoute[backRoute.length - 1] !== pt) backRoute.push(pt);
        }
      }
      const pos = trace.c[event];
      const tile = tileAt(tiles, pos);
      let releaseIndex = 0;
      for (let other = 0; other < tiles.length; other++) {
        if (other === tile || tiles[other].index < pos) continue;
        if (mode[other] !== 'park' && mode[other] !== 'follow') continue;
        if (retestedAfter(other, event)) {
          const nextNode = nextTestInAttempt(other, event);
          if (nextNode !== null && forwardRouteToNode(tilePoint[other], nextNode) !== null) {
            continue;
          }
          releaseGateSlot(other);
          const startT = win.t0 + releaseIndex++ * releaseStaggerMs;
          const back = holdAt(other);
          moveTile(
            other,
            startT,
            null,
            'approach',
            returnToHopperPolyline(layout, lastAt[other], back),
            'hold',
          );
          mode[other] = 'hold';
          tilePoint[other] = hopperStart;
        } else {
          releaseGateSlot(other);
          const startT = win.t0 + releaseIndex++ * releaseStaggerMs;
          const to = rejectAt();
          moveTile(
            other,
            startT,
            null,
            'fall',
            fallPolyline(lastAt[other], beside(lastAt[other], reject), to),
            'reject',
          );
          mode[other] = 'reject';
          tilePoint[other] = null;
        }
      }
      if (tile !== null && mode[tile] !== 'reject' && mode[tile] !== 'hold') {
        const nextNode = nextTestInAttempt(tile, event);
        const stayParkedAtGate =
          mode[tile] === 'park' &&
          (nextNode === null || forwardRouteToNode(tilePoint[tile], nextNode) !== null);
        if (!stayParkedAtGate) {
          releaseGateSlot(tile);
          const anchorEntry = layout.anchors[trace.a[event]]?.entry;
          const route =
            backRoute.length >= 2 && backRoute[0] === tilePoint[tile]
              ? backRoute
              : tilePoint[tile] !== null && anchorEntry !== undefined
                ? (routePath(layout.graph, tilePoint[tile]!, anchorEntry) ?? [])
                : [];
          if (route.length >= 2) {
            const endPt = route[route.length - 1];
            const spline = rideSpline.points(route).map(lifted);
            moveTile(tile, win.t0, null, 'follow', spline, 'follow');
            mode[tile] = 'follow';
            tilePoint[tile] = endPt;
          }
        }
      }
      extendChainRoute(backRoute);
      extendChain(layout.anchors[trace.a[event]]?.entry);
    } else if (kind === T.match) {
      const fallbackNode = win.gate?.node ?? null;
      let matchReleaseIndex = 0;
      let rejectReleaseIndex = 0;
      for (let tile = 0; tile < tiles.length; tile++) {
        if (inMatch(tile)) {
          const fromNode = tileGateNode[tile] ?? fallbackNode;
          releaseGateSlot(tile);
          const to = cupAt();
          const points = cupRoute(
            layout,
            rideSpline,
            edges,
            attemptChain,
            cupEnd,
            fromNode,
            tilePoint[tile],
            lastAt[tile],
            to,
          );
          const startT = win.t0 + matchReleaseIndex++ * releaseStaggerMs;
          moveTile(tile, startT, null, 'cup', points, 'park');
          mode[tile] = 'park';
          tilePoint[tile] = cupEnd;
        } else if (mode[tile] === 'park' || mode[tile] === 'follow') {
          releaseGateSlot(tile);
          const to = rejectAt();
          const startT = win.t0 + rejectReleaseIndex++ * releaseStaggerMs;
          moveTile(
            tile,
            startT,
            null,
            'fall',
            fallPolyline(lastAt[tile], beside(lastAt[tile], reject), to),
            'reject',
          );
          mode[tile] = 'reject';
          tilePoint[tile] = null;
        }
      }
    } else if (kind === T.nomatch) {
      let releaseIndex = 0;
      for (let tile = 0; tile < tiles.length; tile++) {
        if (mode[tile] === 'hold' || mode[tile] === 'reject') continue;
        releaseGateSlot(tile);
        const to = rejectAt();
        const startT = win.t0 + releaseIndex++ * releaseStaggerMs;
        moveTile(
          tile,
          startT,
          null,
          'fall',
          fallPolyline(lastAt[tile], beside(lastAt[tile], reject), to),
          'reject',
        );
        mode[tile] = 'reject';
        tilePoint[tile] = null;
      }
    }
  }

  return { glyphs: tiles.map((tile) => tile.glyph), indices: tiles.map((tile) => tile.index), spans };
}

function cupRoute(
  layout: MachineLayout,
  rideSpline: Ride,
  edges: Map<string, number>,
  attemptChain: number[],
  cupEnd: number | null,
  node: number | null,
  fromPoint: number | null,
  from: Vec3,
  to: Vec3,
): Vec3[] {
  const startId = (node !== null ? layout.anchors[node]?.exit : undefined) ?? fromPoint;
  if (startId === null || startId === undefined || cupEnd === null) return [from, to];
  let ids: number[] | null = null;
  const chainIdx = attemptChain.indexOf(startId);
  if (chainIdx >= 0 && attemptChain.length > 0) {
    const tail = routePath(layout.graph, attemptChain[attemptChain.length - 1], cupEnd);
    if (tail && tail.length >= 1) {
      ids = [...attemptChain.slice(chainIdx), ...tail.slice(1)];
    }
  }
  if (!ids || ids.length < 2) {
    ids = routePath(layout.graph, startId, cupEnd);
  }
  if (!ids || ids.length < 2) return [from, to];
  for (let i = 1; i < ids.length; i++) {
    const piece = edges.get(`${ids[i - 1]}:${ids[i]}`);
    if (piece !== undefined && layout.pieces[piece]?.kind === 'rejectTray') return [from, to];
  }
  const spline = rideSpline.points(ids).map(lifted);
  return [from, ...spline, to];
}
