import type { MachineLayout, Piece, Vec3 } from '../layout/pieces.ts';
import type { FlagEntry } from './state.ts';

export const FLAG_PITCH = 0.32;

export interface FlagMarker extends FlagEntry {
  stackIndex: number;
  column: string;
  level: number;
  position: Vec3;
  role: Piece['role'];
}

export function flagMarkers(layout: MachineLayout, flags: readonly FlagEntry[]): FlagMarker[] {
  const modules = new Map<number, Piece>();
  const roles = new Map<number, Piece['role']>();
  for (const piece of layout.pieces) {
    if (piece.kind === 'module') {
      for (const node of piece.containedNodes ?? []) modules.set(node, piece);
    } else if (piece.kind === 'diverter' && piece.node !== null) {
      roles.set(piece.node, piece.role);
    }
  }

  const levels = new Map<string, number>();
  const markers: FlagMarker[] = [];
  flags.forEach((flag, stackIndex) => {
    const slot = layout.anchors[flag.node]?.flagSlot;
    const module = modules.get(flag.node);
    if (!slot && !module) return;
    const column = slot ? `node:${flag.node}` : `module:${module!.node}`;
    const base = slot ?? {
      x: module!.position.x + module!.size.x / 2 + 0.2,
      y: module!.position.y,
      z: module!.position.z + module!.size.z / 2 + 0.1,
    };
    const level = levels.get(column) ?? 0;
    levels.set(column, level + 1);
    markers.push({
      ...flag,
      stackIndex,
      column,
      level,
      position: { x: base.x, y: base.y + level * FLAG_PITCH, z: base.z },
      role: slot ? roles.get(flag.node) : module!.role,
    });
  });
  return markers;
}
