import type { CatmullRomCurve3 } from 'three';
import type { MachineLayout, Vec3 } from '../layout/pieces.ts';
import { pointAlongPolyline } from '../playback/motion.ts';
import type { Segment, SegmentKind, Timeline } from '../playback/timeline.ts';
import { trackCurve } from './geometry.ts';

const SUBSAMPLES = 6;
const MOTION: ReadonlySet<SegmentKind> = new Set<SegmentKind>(['roll', 'drop', 'lift']);

function near(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Time → distance easing for one travel segment. A marble released at a gate accelerates under
 * gravity (distance ∝ t²), so when the segment starts from rest the front half is slow and the back
 * half quick. A segment that continues a previous travel segment keeps its pace instead.
 */
export function travelFraction(_kind: SegmentKind, fraction: number, _fromRest: boolean): number {
  return clamp(fraction, 0, 1);
}

export function startsFromRest(timeline: Timeline, segmentIndex: number): boolean {
  const previous = timeline.segments[segmentIndex - 1];
  return !previous || !MOTION.has(previous.kind) || previous.jump;
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
        const chord = Math.hypot(
          a.position.x - b.position.x,
          a.position.y - b.position.y,
          a.position.z - b.position.z,
        );
        const samples = Math.max(SUBSAMPLES, Math.ceil(chord * 3));
        for (let s = 1; s < samples; s++) {
          const u = (ia + ((ib - ia) * s) / samples) / n;
          const p = curve.getPoint(u);
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
    const eased = travelFraction(segment.kind, fraction, startsFromRest(timeline, segmentIndex));
    return pointAlongPolyline(this.points(segment.route), eased)?.position ?? null;
  }
}
