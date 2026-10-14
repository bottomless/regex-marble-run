import { useEffect, useMemo } from 'react';
import type { MachineLayout } from '../layout/pieces.ts';
import { buildTrackBatches } from './geometry.ts';
import { riddenPieces } from './letterTrip.ts';
import type { Materials } from './materials.ts';

export default function Tracks({
  machine,
  materials,
  letters = false,
}: {
  machine: MachineLayout;
  materials: Materials;
  letters?: boolean;
}) {
  const batches = useMemo(() => {
    if (!letters) return buildTrackBatches(machine);
    const ridden = riddenPieces(machine);
    if (!ridden) return buildTrackBatches(machine);
    return buildTrackBatches({
      ...machine,
      pieces: machine.pieces.map((piece, index) =>
        piece.points && !ridden.has(index) ? { ...piece, points: undefined } : piece,
      ),
    });
  }, [letters, machine]);
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
