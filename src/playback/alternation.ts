import type { NodeId, Program } from '../engine/ir.ts';
import type { MachineLayout, Vec3 } from '../layout/pieces.ts';
import type { MachineState } from './state.ts';

export interface BranchMarker {
  option: number;
  position: Vec3;
  selected: boolean;
  savedCount: number;
}

export interface AlternationMarker {
  node: NodeId;
  position: Vec3;
  activeBranch: number | null;
  angle: number | null;
  branches: BranchMarker[];
}

export function alternationMarkers(
  program: Program,
  layout: MachineLayout,
  state: MachineState | null,
): AlternationMarker[] {
  const saved = new Map<NodeId, Map<number, number>>();
  for (const flag of state?.flags ?? []) {
    if (program.nodes[flag.node]?.kind !== 'alt') continue;
    const options = saved.get(flag.node) ?? new Map<number, number>();
    options.set(flag.option, (options.get(flag.option) ?? 0) + 1);
    saved.set(flag.node, options);
  }

  const markers: AlternationMarker[] = [];
  for (const node of program.nodes) {
    if (node.kind !== 'alt') continue;
    const anchor = layout.anchors[node.id];
    const entry = layout.graph.points[anchor?.entry]?.position;
    if (!anchor?.diverter || !entry) continue;
    const activeBranch = state?.selectedBranches.get(node.id) ?? null;
    const branches: BranchMarker[] = [];
    let angle: number | null = null;
    node.branches.forEach((branch, option) => {
      const target = layout.graph.points[layout.anchors[branch.id]?.entry]?.position;
      if (!target) return;
      const selected = option === activeBranch;
      if (selected) angle = Math.atan2(target.x - anchor.diverter!.x, anchor.diverter!.y - target.y);
      branches.push({
        option,
        position: {
          x: entry.x + (target.x - entry.x) * 0.55,
          y: entry.y + (target.y - entry.y) * 0.55,
          z: entry.z + (target.z - entry.z) * 0.55 + 0.32,
        },
        selected,
        savedCount: saved.get(node.id)?.get(option) ?? 0,
      });
    });
    markers.push({
      node: node.id,
      position: { ...anchor.diverter, z: anchor.diverter.z + 0.32 },
      activeBranch,
      angle,
      branches,
    });
  }
  return markers;
}
