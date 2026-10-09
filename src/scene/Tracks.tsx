import { useEffect, useMemo } from 'react';
import type { MachineLayout } from '../layout/pieces.ts';
import { buildTrackBatches } from './geometry.ts';
import type { Materials } from './materials.ts';

export default function Tracks({ machine, materials }: { machine: MachineLayout; materials: Materials }) {
  const batches = useMemo(() => buildTrackBatches(machine), [machine]);
  useEffect(() => () => batches.forEach((batch) => batch.geometry.dispose()), [batches]);
  return (
    <group>
      {batches.map((batch) => (
        <mesh
          key={batch.finish}
          geometry={batch.geometry}
          material={materials.tracks[batch.finish]}
          castShadow={batch.finish !== 'scout'}
          receiveShadow
        />
      ))}
    </group>
  );
}
