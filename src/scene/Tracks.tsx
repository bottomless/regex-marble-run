import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import type { MachineLayout } from '../layout/pieces.ts';
import type { PlaybackStore } from '../playback/store.ts';
import type { Timeline } from '../playback/timeline.ts';
import { buildTrackBatches } from './geometry.ts';
import { hiddenLoopPieces } from './letterCast.ts';
import type { Materials } from './materials.ts';

export default function Tracks({
  machine,
  materials,
  timeline,
}: {
  machine: MachineLayout;
  materials: Materials;
  timeline?: Timeline | null;
}) {
  const batches = useMemo(() => {
    if (timeline === undefined) return buildTrackBatches(machine);
    const hidden = hiddenLoopPieces(machine, timeline);
    if (hidden.size === 0) return buildTrackBatches(machine);
    return buildTrackBatches({
      ...machine,
      pieces: machine.pieces.map((piece, index) =>
        piece.points && hidden.has(index) ? { ...piece, points: undefined } : piece,
      ),
    });
  }, [timeline, machine]);
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

export function LetterTracks({
  store,
  machine,
  materials,
}: {
  store: PlaybackStore;
  machine: MachineLayout;
  materials: Materials;
}) {
  const timeline = useStore(store, (s) => s.timeline);
  return <Tracks machine={machine} materials={materials} timeline={timeline} />;
}
