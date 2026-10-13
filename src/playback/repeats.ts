import type { NodeId, Program } from '../engine/ir.ts';
import type { MachineLayout, Vec3 } from '../layout/pieces.ts';
import type { LoopChoice, MachineState } from './state.ts';

export interface RepeatMarker {
  node: NodeId;
  position: Vec3;
  dial: Vec3;
  choice: LoopChoice | null;
  angle: number | null;
  count: number;
  greedy: boolean;
  min: number;
  max: number;
  saved: Record<LoopChoice, number>;
}

export const DIAL_SHIFT: Vec3 = { x: -1.1, y: 0.1, z: 0.55 };

function pointer(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, from.y - to.y);
}

export function repeatMarkers(
  program: Program,
  layout: MachineLayout,
  state: MachineState | null,
): RepeatMarker[] {
  const saved = new Map<NodeId, Record<LoopChoice, number>>();
  for (const flag of state?.flags ?? []) {
    if (program.nodes[flag.node]?.kind !== 'repeat') continue;
    const entry = saved.get(flag.node) ?? { again: 0, exit: 0 };
    entry[flag.option === 1 ? 'exit' : 'again']++;
    saved.set(flag.node, entry);
  }

  const markers: RepeatMarker[] = [];
  for (const node of program.nodes) {
    if (node.kind !== 'repeat') continue;
    const anchor = layout.anchors[node.id];
    const diverter = anchor?.diverter;
    if (!diverter) continue;
    const choice = state?.loops.get(node.id) ?? null;
    const again = layout.graph.points[layout.anchors[node.body.id]?.entry]?.position;
    const bypass = layout.pieces.find((piece) => piece.kind === 'bypassChute' && piece.node === node.id);
    const exit = bypass?.points?.[1] ?? layout.graph.points[anchor.exit]?.position;
    const target = choice === 'again' ? again : choice === 'exit' ? exit : undefined;
    markers.push({
      node: node.id,
      position: { ...diverter, z: diverter.z + 0.32 },
      dial: { x: diverter.x + DIAL_SHIFT.x, y: diverter.y + DIAL_SHIFT.y, z: diverter.z + DIAL_SHIFT.z },
      choice,
      angle: target ? pointer(diverter, target) : null,
      count: state?.counters.get(node.id) ?? 0,
      greedy: node.greedy,
      min: node.min,
      max: node.max,
      saved: saved.get(node.id) ?? { again: 0, exit: 0 },
    });
  }
  return markers;
}
