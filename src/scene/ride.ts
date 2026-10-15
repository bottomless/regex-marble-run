import type { CatmullRomCurve3 } from 'three';
import type { MachineLayout, Vec3 } from '../layout/pieces.ts';
import { pointAlongPolyline, poseAtIndex } from '../playback/motion.ts';
import type { Segment, SegmentKind, Timeline } from '../playback/timeline.ts';
import { trackCurve } from './geometry.ts';

const SUBSAMPLES = 10;
const MOTION: ReadonlySet<SegmentKind> = new Set<SegmentKind>(['roll', 'drop', 'lift']);
/** A hitch longer than this is slowed, not teleported. Three frames at 60fps. */
export const FRAME_STEP_CAP_MS = 48;

function near(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Cubic Hermite on [0,1] with f(0)=0, f(1)=1, f'(0)=depart, f'(1)=arrive.
 * Endpoint speeds in [0, 2] stay monotonic, so a segment can leave at the speed the previous one
 * arrived and hand the same speed to the next one. That is what removes the stop-start hitch.
 */
export function pace(fraction: number, depart: number, arrive: number): number {
  const t = clamp(fraction, 0, 1);
  const a = depart + arrive - 2;
  const b = 3 - 2 * depart - arrive;
  return ((a * t + b) * t + depart) * t;
}

/**
 * Time → distance for one travel segment.
 * A marble released from rest accelerates (front half slow). One that must stop eases out so it
 * does not slam into the next dwell. A segment that continues a previous travel segment keeps
 * unit pace, and arrives at unit pace if another travel segment follows — so speed is continuous
 * across the join instead of dropping to zero and starting over.
 * Lifts leave with a spring impulse. Drops accelerate under gravity.
 */
export function travelFraction(
  kind: SegmentKind,
  fraction: number,
  fromRest: boolean,
  toRest = false,
): number {
  const t = clamp(fraction, 0, 1);
  if (!fromRest && !toRest) return t;
  if (kind === 'lift') return pace(t, fromRest ? 1.8 : 1, toRest ? 0.25 : 1);
  if (kind === 'drop') return pace(t, fromRest ? 0.2 : 1, toRest ? 0.35 : 1);
  return pace(t, fromRest ? 0 : 1, toRest ? 0 : 1);
}

export function startsFromRest(timeline: Timeline, segmentIndex: number): boolean {
  const previous = timeline.segments[segmentIndex - 1];
  return !previous || !MOTION.has(previous.kind) || previous.jump;
}

export function endsAtRest(timeline: Timeline, segmentIndex: number): boolean {
  const next = timeline.segments[segmentIndex + 1];
  return !next || !MOTION.has(next.kind) || next.jump;
}

/** Arc-length fraction at parameter t. Catmull-Rom's parameter is not distance, so sampling it directly pumps speed through bends. */
function parameterToArc(curve: CatmullRomCurve3, t: number): number {
  const lengths = curve.getLengths();
  const divisions = lengths.length - 1;
  const total = divisions > 0 ? lengths[divisions] : 0;
  if (divisions <= 0 || total <= 0) return clamp(t, 0, 1);
  const x = clamp(t, 0, 1) * divisions;
  const i = Math.min(divisions - 1, Math.floor(x));
  const length = lengths[i] + (lengths[i + 1] - lengths[i]) * (x - i);
  return length / total;
}

/**
 * Resolves hero-marble routes onto the actual spline the tracks are built from, so the marble hugs
 * the channel bed through bends instead of cutting straight chords between graph points.
 */
export class Ride {
  private readonly edgePiece = new Map<string, number>();
  private readonly curves = new Map<number, CatmullRomCurve3 | null>();
  private readonly routes = new Map<string, Vec3[]>();

  constructor(private readonly layout: MachineLayout) {
    for (const edge of layout.graph.edges) {
      this.edgePiece.set(`${edge.from}:${edge.to}`, edge.piece);
      this.edgePiece.set(`${edge.to}:${edge.from}`, edge.piece);
    }
  }

  private curveFor(pieceIndex: number): CatmullRomCurve3 | null {
    if (!this.curves.has(pieceIndex)) {
      const piece = this.layout.pieces[pieceIndex];
      this.curves.set(pieceIndex, piece?.points && piece.points.length >= 2 ? trackCurve(piece.points) : null);
    }
    return this.curves.get(pieceIndex) ?? null;
  }

  points(route: number[]): Vec3[] {
    const key = route.join(',');
    const cached = this.routes.get(key);
    if (cached) return cached;
    const { points } = this.layout.graph;
    const out: Vec3[] = [];
    const first = points[route[0]];
    if (first) out.push(first.position);
    for (let i = 1; i < route.length; i++) {
      const a = points[route[i - 1]];
      const b = points[route[i]];
      if (!a || !b) continue;
      const pieceIndex = this.edgePiece.get(`${a.id}:${b.id}`);
      const piece = pieceIndex === undefined ? undefined : this.layout.pieces[pieceIndex];
      const curve = pieceIndex === undefined ? null : this.curveFor(pieceIndex);
      const ia = piece?.points?.findIndex((p) => near(p, a.position)) ?? -1;
      const ib = piece?.points?.findIndex((p) => near(p, b.position)) ?? -1;
      if (curve && piece?.points && ia >= 0 && ib >= 0 && ia !== ib) {
        const n = piece.points.length - 1;
        const u0 = parameterToArc(curve, ia / n);
        const u1 = parameterToArc(curve, ib / n);
        const chord = Math.abs(u1 - u0) * curve.getLength();
        const samples = Math.max(SUBSAMPLES, Math.ceil(chord * 6));
        for (let s = 1; s < samples; s++) {
          const p = curve.getPointAt(u0 + (u1 - u0) * (s / samples));
          out.push({ x: p.x, y: p.y, z: p.z });
        }
      }
      out.push(b.position);
    }
    this.routes.set(key, out);
    return out;
  }

  /** Position along a travel segment, or null when the segment carries no route. */
  along(timeline: Timeline, segmentIndex: number, fraction: number): Vec3 | null {
    const segment: Segment | undefined = timeline.segments[segmentIndex];
    if (!segment || !MOTION.has(segment.kind) || !segment.route) return null;
    const eased = travelFraction(
      segment.kind,
      fraction,
      startsFromRest(timeline, segmentIndex),
      endsAtRest(timeline, segmentIndex),
    );
    return pointAlongPolyline(this.points(segment.route), eased)?.position ?? null;
  }
}

/**
 * Marble centre for playback. Travel follows the spline with matched endpoint speeds. A short dwell
 * after a travel segment eases from the track end onto the gate instead of popping sideways.
 */
export function carriedPosition(
  ride: Ride,
  layout: MachineLayout,
  timeline: Timeline,
  segmentIndex: number,
  fraction: number,
): Vec3 | null {
  const along = ride.along(timeline, segmentIndex, fraction);
  if (along) return along;
  const pose = poseAtIndex(layout, timeline, segmentIndex, fraction);
  if (!pose) return null;
  const previous = segmentIndex > 0 ? segmentIndex - 1 : -1;
  const prev = previous >= 0 ? timeline.segments[previous] : undefined;
  if (!prev || !MOTION.has(prev.kind) || prev.jump) return pose.position;
  const from = ride.along(timeline, previous, 1);
  if (!from) return pose.position;
  const gap = Math.hypot(pose.position.x - from.x, pose.position.y - from.y, pose.position.z - from.z);
  if (gap < 1e-4 || gap > 1.2) return pose.position;
  const t = pace(clamp(fraction, 0, 1), 0, 0);
  return {
    x: from.x + (pose.position.x - from.x) * t,
    y: from.y + (pose.position.y - from.y) * t,
    z: from.z + (pose.position.z - from.z) * t,
  };
}
