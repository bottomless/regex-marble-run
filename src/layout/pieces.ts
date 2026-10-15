import type { NodeId } from '../engine/ir.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PieceKind =
  | 'track'
  | 'gate'
  | 'sensor'
  | 'mirror'
  | 'opaque'
  | 'diverter'
  | 'funnel'
  | 'loopLift'
  | 'bypassChute'
  | 'rejectChute'
  | 'returnRail'
  | 'backLift'
  | 'groupFrame'
  | 'scout'
  | 'hopper'
  | 'cup'
  | 'rejectTray'
  | 'module';

export interface Piece {
  kind: PieceKind;
  node: NodeId | null;
  position: Vec3;
  size: Vec3;
  rotation?: number;
  label?: string;
  points?: Vec3[];
  containedNodes?: number[];
  role?: 'alternation' | 'repeat' | 'lazyRepeat' | 'capture' | 'assert' | 'look' | 'base';
}

export interface TrackPoint {
  id: number;
  position: Vec3;
  node: NodeId | null;
}

export interface TrackEdge {
  from: number;
  to: number;
  piece: number;
  length?: number;
}

export interface LayoutGraph {
  points: TrackPoint[];
  edges: TrackEdge[];
}

export interface NodeAnchor {
  entry: number;
  exit: number;
  gate?: Vec3;
  diverter?: Vec3;
  flagSlot?: Vec3;
  returnPort?: number;
  rejectionPort?: number;
}

export interface MachineLayout {
  bounds: { min: Vec3; max: Vec3 };
  pieces: Piece[];
  graph: LayoutGraph;
  anchors: Record<NodeId, NodeAnchor>;
}
