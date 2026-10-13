import type { NodeId } from '../engine/ir.ts';
import type { MachineLayout, PieceKind, Vec3 } from '../layout/pieces.ts';
import type { GateStatus, MachineState } from './state.ts';

export type LampKind = Extract<PieceKind, 'gate' | 'sensor' | 'mirror' | 'opaque' | 'scout'>;

export interface GateMarker {
  node: NodeId;
  kind: LampKind;
  position: Vec3;
  status: GateStatus | null;
  active: boolean;
}

const LAMP_KINDS: ReadonlySet<PieceKind> = new Set<PieceKind>(['gate', 'sensor', 'mirror', 'opaque', 'scout']);

export function gateMarkers(layout: MachineLayout, state: MachineState | null): GateMarker[] {
  if (!state) return [];
  const markers: GateMarker[] = [];
  for (const piece of layout.pieces) {
    if (piece.node === null || !LAMP_KINDS.has(piece.kind)) continue;
    const status = state.gates.get(piece.node) ?? null;
    const active = state.activeNode === piece.node;
    if (status === null && !active) continue;
    markers.push({ node: piece.node, kind: piece.kind as LampKind, position: piece.position, status, active });
  }
  return markers;
}
