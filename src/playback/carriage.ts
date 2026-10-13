import type { MachineLayout, Vec3 } from '../layout/pieces.ts';
import { pointAlongPolyline } from './motion.ts';
import type { Segment, Timeline } from './timeline.ts';

/** Deck sits just under the rail centerline and slightly toward the viewer. */
export const CARRIAGE_SHIFT: Vec3 = { x: 0, y: -0.12, z: 0.08 };
/** Marble rides in the cradle, sharing the carriage's viewer offset. */
export const MARBLE_LIFT_SHIFT: Vec3 = { x: 0, y: 0.04, z: 0.08 };

export interface CarriagePose {
  position: Vec3;
  rail: Vec3;
  direction: Vec3 | null;
  yaw: number;
  fraction: number;
  segmentIndex: number;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function routePoints(layout: MachineLayout, route: number[]): Vec3[] {
  const points: Vec3[] = [];
  for (const id of route) {
    const point = layout.graph.points[id];
    if (point) points.push(point.position);
  }
  return points;
}

function ridesRearLift(layout: MachineLayout, segment: Segment): boolean {
  if (!segment.route || segment.route.length < 2) return false;
  if (segment.kind === 'lift') return true;
  if (segment.kind !== 'drop') return false;
  for (let i = 1; i < segment.route.length; i++) {
    const from = segment.route[i - 1];
    const to = segment.route[i];
    const edge = layout.graph.edges.find((item) => item.from === from && item.to === to);
    if (edge && layout.pieces[edge.piece]?.kind === 'backLift') return true;
  }
  return false;
}

/** Yaw in the XZ plane. Vertical shafts keep a stable facing instead of spinning. */
export function carriageYaw(direction: Vec3 | null): number {
  if (!direction) return 0;
  const horizontal = Math.hypot(direction.x, direction.z);
  if (horizontal < 1e-4) return 0;
  return Math.atan2(direction.x, direction.z);
}

/**
 * Carriage pose for the current segment only. Hidden off the rear-lift ride, so pause, scrub and
 * step-back recompute the same deck from `(segmentIndex, fraction)` with no motion history.
 */
export function carriageAtIndex(
  layout: MachineLayout,
  timeline: Timeline,
  segmentIndex: number,
  fraction: number,
): CarriagePose | null {
  if (segmentIndex < 0 || segmentIndex >= timeline.segments.length) return null;
  const segment = timeline.segments[segmentIndex];
  if (!ridesRearLift(layout, segment)) return null;
  const at = pointAlongPolyline(routePoints(layout, segment.route!), fraction);
  if (!at) return null;
  return {
    position: add(at.position, CARRIAGE_SHIFT),
    rail: at.position,
    direction: at.direction,
    yaw: carriageYaw(at.direction),
    fraction: Math.min(1, Math.max(0, fraction)),
    segmentIndex,
  };
}

/** Where the hero marble sits while the carriage is carrying it. */
export function carriedMarblePosition(rail: Vec3): Vec3 {
  return add(rail, MARBLE_LIFT_SHIFT);
}

export function formatCarriage(pose: CarriagePose | null): string {
  if (!pose) return '';
  return [pose.position.x, pose.position.y, pose.position.z].map((value) => value.toFixed(3)).join(',');
}
