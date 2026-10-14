import { T, type Trace } from '../engine/trace.ts';
import type { MachineLayout, PieceKind, Vec3 } from '../layout/pieces.ts';
import { routePath } from '../layout/route.ts';
import { pointAlongPolyline, poseForSegment } from '../playback/motion.ts';
import type { Segment, Timeline } from '../playback/timeline.ts';
import { visibleTiles } from './geometry.ts';
import { holdOffset, restOffset } from './letterTrip.ts';

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

function pieceAt(layout: MachineLayout, kind: PieceKind): Vec3 | null {
  return layout.pieces.find((piece) => piece.kind === kind)?.position ?? null;
}

function endpoint(layout: MachineLayout, kind: PieceKind): number | null {
  const piece = layout.pieces.find((item) => item.kind === kind);
  if (!piece) return null;
  const points = piece.points;
  const position = points && points.length > 0 ? points[points.length - 1] : piece.position;
  const id = layout.graph.points.findIndex((point) => near(point.position, position));
  return id < 0 ? null : id;
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

function push(list: CastSpan[], span: CastSpan): void {
  let prev = list[list.length - 1];
  if (prev && prev.t1 > span.t0) prev.t1 = span.t0;
  if (prev && prev.t1 <= prev.t0) {
    list.pop();
    prev = list[list.length - 1];
  }
  if (span.t1 <= span.t0) return;
  if (prev && prev.t1 < span.t0) prev.t1 = span.t0;
  list.push(span);
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

function activeSpan(spans: CastSpan[], time: number): CastSpan {
  let chosen = spans[0];
  for (const span of spans) {
    if (span.t0 > time) break;
    chosen = span;
  }
  return chosen;
}

export function castAt(cast: LetterCast, time: number, pose: Vec3 | null): Placement[] {
  const live = pose ? lifted(pose) : null;
  let holds = 0;
  return cast.spans.map((spans) => {
    const span = activeSpan(spans, time);
    const riding = span.kind === 'follow' || span.kind === 'approach';
    const visible = span.kind !== 'hold' || holds++ < 8;
    let position = span.at ?? span.from ?? live ?? { x: 0, y: 0, z: 0 };
    if (span.kind === 'follow') position = live ?? span.at ?? position;
    else if (span.kind === 'approach' && span.from) {
      position = lerp(span.from, span.to ?? live ?? span.from, unitInterval(span, time));
    } else if (span.kind === 'fall' && span.from && span.via && span.to) {
      position = fallAt(span.from, span.via, span.to, unitInterval(span, time));
    } else if (span.kind === 'cup' && span.to) {
      const raw = unitInterval(span, time);
      const delay = span.delay ?? 0;
      const u = delay >= 1 ? 1 : Math.min(1, Math.max(0, (raw - delay) / (1 - delay)));
      if (span.points && span.points.length > 1) {
        position = pointAlongPolyline(span.points, u)?.position ?? lerp(span.from ?? span.to, span.to, u);
      } else position = lerp(span.from ?? span.to, span.to, u);
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
    if (kind === T.backtrack) return trace.c[j] <= pos;
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
  const cupEnd = endpoint(layout, 'cup');
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
  const parked: (Vec3 | null)[] = tiles.map(() => null);
  const lastAt: Vec3[] = [];
  const gateOrder = new Map<string, number>();
  let rejectOrder = 0;
  let cupOrder = 0;
  let rider: number | null = null;

  const holdAt = (tile: number): Vec3 => add(hopper, holdOffset(tile % 8));
  const rejectAt = (): Vec3 => add(reject, restOffset(rejectOrder++, 'rejectTray'));
  const cupAt = (): Vec3 => add(cup, restOffset(cupOrder++, 'cup'));
  const stackAt = (gate: Vec3): Vec3 => {
    const key = `${gate.x.toFixed(2)}:${gate.y.toFixed(2)}`;
    const order = gateOrder.get(key) ?? 0;
    gateOrder.set(key, order + 1);
    return add(lifted(gate), restOffset(order, 'cup'));
  };

  for (let i = 0; i < tiles.length; i++) {
    const at = holdAt(i);
    lastAt[i] = at;
    push(spans[i], { t0: 0, t1: Infinity, kind: 'hold', at });
  }

  const windowOf = (event: number): { t0: number; t1: number; gate: Segment | null; rolled: boolean } => {
    const segs = byEvent[event];
    if (segs.length === 0) return { t0: 0, t1: 0, gate: null, rolled: false };
    return {
      t0: segs[0].t0,
      t1: segs[segs.length - 1].t1,
      gate: segs.find((segment) => segment.kind === 'gate') ?? null,
      rolled: segs.some((segment) => segment.kind === 'roll' && (segment.t1 > segment.t0 || (segment.route?.length ?? 0) > 1)),
    };
  };

  const gatePoint = (segment: Segment | null): Vec3 | null => {
    if (!segment) return null;
    return poseForSegment(layout, segment, 0)?.position ?? null;
  };

  const ride = (tile: number, t0: number, t1: number, from: Vec3): void => {
    if (mode[tile] === 'reject') return;
    if (rider !== null && rider !== tile && mode[rider] === 'follow') {
      mode[rider] = 'hold';
      const back = holdAt(rider);
      lastAt[rider] = back;
      push(spans[rider], { t0, t1: Infinity, kind: 'hold', at: back });
    }
    mode[tile] = 'follow';
    rider = tile;
    lastAt[tile] = from;
    const join = t1 > t0 ? t0 + Math.min(t1 - t0, Math.max(90, (t1 - t0) * 0.45)) : t0;
    if (join > t0) push(spans[tile], { t0, t1: join, kind: 'approach', from, to: undefined });
    push(spans[tile], { t0: Math.max(t0, join), t1: Infinity, kind: 'follow' });
  };

  const sendReject = (tile: number, t0: number, t1: number, from: Vec3, via: Vec3): void => {
    const to = rejectAt();
    mode[tile] = 'reject';
    parked[tile] = null;
    if (rider === tile) rider = null;
    lastAt[tile] = to;
    if (t1 > t0) push(spans[tile], { t0, t1, kind: 'fall', from, via, to });
    push(spans[tile], { t0: t1, t1: Infinity, kind: 'reject', at: to });
  };

  const toCup = (tile: number, t0: number, t1: number, node: number | null): void => {
    const from = parked[tile] ?? lastAt[tile] ?? holdAt(tile);
    const to = cupAt();
    const points = cupRoute(layout, edges, cupEnd, node, from, to);
    mode[tile] = 'park';
    parked[tile] = to;
    if (rider === tile) rider = null;
    lastAt[tile] = to;
    const delay = Math.min(0.45, tile * 0.04);
    if (t1 > t0) push(spans[tile], { t0, t1, kind: 'cup', from, to, points: points ?? undefined, delay });
    push(spans[tile], { t0: t1, t1: Infinity, kind: 'park', at: to });
  };

  for (let event = 0; event < trace.length; event++) {
    const kind = trace.t[event] as T;
    const win = windowOf(event);
    if (kind === T.attempt) {
      const start = tileAt(tiles, trace.a[event]);
      for (let tile = 0; tile < tiles.length; tile++) {
        if (mode[tile] === 'hold' || mode[tile] === 'reject' || tile === start) continue;
        if (retestedAfter(tile, event)) {
          mode[tile] = 'hold';
          parked[tile] = null;
          const at = holdAt(tile);
          lastAt[tile] = at;
          if (rider === tile) rider = null;
          push(spans[tile], { t0: win.t0, t1: Infinity, kind: 'hold', at });
          continue;
        }
        if (inMatch(tile) && mode[tile] === 'park') continue;
        const from = parked[tile] ?? lastAt[tile] ?? holdAt(tile);
        sendReject(tile, win.t0, win.t1, from, beside(from, reject));
      }
      if (start !== null && mode[start] !== 'reject') {
        ride(start, win.t0, win.t1, parked[start] ?? holdAt(start));
        parked[start] = null;
      }
    } else if (kind === T.test) {
      const pos = trace.b[event];
      const ok = trace.c[event] === 1;
      const len = trace.d[event];
      const gate = gatePoint(win.gate);
      const gateT0 = win.gate?.t0 ?? win.t0;
      const gateT1 = win.gate?.t1 ?? win.t1;
      if (len <= 0 || !gate) continue;
      const kept = continues(trace, event, pos);
      const covered = coveredTiles(tiles, pos, len);
      const span = gateT1 - gateT0;
      const arrive = span > 0 ? gateT0 + Math.min(span, Math.max(70, span * 0.42)) : gateT0;
      for (const tile of covered) {
        if (mode[tile] === 'reject') continue;
        const depart = parked[tile] ?? lastAt[tile] ?? holdAt(tile);
        if (win.rolled) {
          if (mode[tile] !== 'follow') ride(tile, win.t0, gateT0, depart);
        } else if (arrive > gateT0) {
          push(spans[tile], { t0: gateT0, t1: arrive, kind: 'approach', from: depart, to: lifted(gate) });
          lastAt[tile] = lifted(gate);
        }
        if (!ok && !kept && retestedAfter(tile, event)) {
          mode[tile] = 'hold';
          parked[tile] = null;
          if (rider === tile) rider = null;
          const at = holdAt(tile);
          lastAt[tile] = at;
          push(spans[tile], { t0: gateT1, t1: Infinity, kind: 'hold', at });
          continue;
        }
        if (!ok && !kept) {
          sendReject(tile, win.rolled ? gateT0 : arrive, gateT1, lifted(gate), beside(gate, reject));
          continue;
        }
        if (!ok) {
          mode[tile] = 'follow';
          rider = tile;
          lastAt[tile] = lifted(gate);
          if (!win.rolled) push(spans[tile], { t0: arrive, t1: Infinity, kind: 'follow' });
          continue;
        }
        const at = stackAt(gate);
        mode[tile] = 'park';
        parked[tile] = at;
        lastAt[tile] = at;
        if (rider === tile) rider = null;
        push(spans[tile], { t0: gateT1, t1: Infinity, kind: 'park', at });
      }
    } else if (kind === T.choose) {
      const tile = tileAt(tiles, trace.c[event]);
      if (tile !== null && mode[tile] === 'hold') ride(tile, win.t0, win.t1, holdAt(tile));
    } else if (kind === T.backtrack) {
      const pos = trace.c[event];
      const tile = tileAt(tiles, pos);
      for (let other = 0; other < tiles.length; other++) {
        if (other === tile || tiles[other].index < pos) continue;
        if (mode[other] !== 'park' && mode[other] !== 'follow') continue;
        mode[other] = 'hold';
        parked[other] = null;
        if (rider === other) rider = null;
        const at = holdAt(other);
        lastAt[other] = at;
        push(spans[other], { t0: win.t0, t1: Infinity, kind: 'hold', at });
      }
      if (tile !== null && mode[tile] !== 'reject') {
        const from = parked[tile] ?? lastAt[tile] ?? holdAt(tile);
        parked[tile] = null;
        ride(tile, win.t0, win.t1, from);
      }
    } else if (kind === T.match) {
      const node = win.gate?.node ?? null;
      for (let tile = 0; tile < tiles.length; tile++) {
        if (inMatch(tile)) toCup(tile, win.t0, win.t1, parkedNode(layout, parked[tile]) ?? node);
        else if (mode[tile] === 'park' || mode[tile] === 'follow') {
          sendReject(tile, win.t0, win.t1, parked[tile] ?? lastAt[tile] ?? holdAt(tile), beside(parked[tile] ?? lastAt[tile], reject));
        }
      }
    } else if (kind === T.nomatch) {
      for (let tile = 0; tile < tiles.length; tile++) {
        if (mode[tile] === 'hold' || mode[tile] === 'reject') continue;
        sendReject(tile, win.t0, win.t1, parked[tile] ?? lastAt[tile] ?? holdAt(tile), beside(parked[tile] ?? hopper, reject));
      }
    }
  }

  return { glyphs: tiles.map((tile) => tile.glyph), indices: tiles.map((tile) => tile.index), spans };
}

function parkedNode(layout: MachineLayout, at: Vec3 | null): number | null {
  if (!at) return null;
  let best: number | null = null;
  let bestDist = 2.4;
  for (const [node, anchor] of Object.entries(layout.anchors)) {
    if (!anchor.gate) continue;
    const dist = Math.hypot(anchor.gate.x - at.x, anchor.gate.y - at.y, anchor.gate.z - at.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = Number(node);
    }
  }
  return best;
}

function cupRoute(
  layout: MachineLayout,
  edges: Map<string, number>,
  cupEnd: number | null,
  node: number | null,
  from: Vec3,
  to: Vec3,
): Vec3[] | null {
  if (node === null || cupEnd === null) return null;
  const anchor = layout.anchors[node];
  if (!anchor) return null;
  const ids = routePath(layout.graph, anchor.exit, cupEnd);
  if (!ids || ids.length < 2) return null;
  for (let i = 1; i < ids.length; i++) {
    const piece = edges.get(`${ids[i - 1]}:${ids[i]}`);
    if (piece !== undefined && layout.pieces[piece]?.kind === 'rejectTray') return null;
  }
  const points = ids.map((id) => lifted(layout.graph.points[id].position));
  points[0] = from;
  points.push(to);
  return points;
}
