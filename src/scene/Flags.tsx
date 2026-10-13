import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { BoxGeometry, CylinderGeometry, SphereGeometry } from 'three';
import { useStore } from 'zustand';
import type { MachineLayout, Piece } from '../layout/pieces.ts';
import { flagMarkers } from '../playback/flags.ts';
import type { FlagEntry } from '../playback/state.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { Hardware } from './Gates.tsx';
import Glyph from './Glyph.tsx';
import { roleFinish, type TrackFinish } from './geometry.ts';
import type { Materials } from './materials.ts';

const EMPTY_FLAGS: FlagEntry[] = [];

export default function Flags({
  machine,
  store,
  materials,
}: {
  machine: MachineLayout;
  store: PlaybackStore;
  materials: Materials;
}) {
  const flags = useStore(store, (state) => state.machine?.flags ?? EMPTY_FLAGS);
  const markers = useMemo(() => flagMarkers(machine, flags), [machine, flags]);
  const canvas = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const hardware = useMemo(() => {
    const pieces: Piece[] = markers.map((marker) => ({
      kind: 'diverter',
      node: marker.node,
      position: marker.position,
      size: { x: 0.4, y: 0.3, z: 0.06 },
      role: marker.role,
    }));
    const batches = new Map<TrackFinish, Piece[]>();
    for (const piece of pieces) {
      const finish = roleFinish(piece);
      const batch = batches.get(finish) ?? [];
      batch.push(piece);
      batches.set(finish, batch);
    }
    const tops = new Map<string, (typeof markers)[number]>();
    for (const marker of markers) tops.set(marker.column, marker);
    return { pieces, batches: [...batches], tops: [...tops.values()] };
  }, [markers]);
  const geometry = useMemo(
    () => ({
      pole: new CylinderGeometry(0.025, 0.025, 0.3, 8),
      pennant: new BoxGeometry(0.4, 0.2, 0.06),
      finial: new SphereGeometry(0.04, 8, 6),
    }),
    [],
  );
  useEffect(() => () => Object.values(geometry).forEach((item) => item.dispose()), [geometry]);
  useLayoutEffect(() => {
    canvas.setAttribute('data-flag-count', String(markers.length));
    canvas.setAttribute('data-flags', JSON.stringify(markers));
    invalidate();
  }, [canvas, markers, invalidate]);

  return (
    <group>
      <Hardware
        pieces={hardware.pieces}
        geometry={geometry.pole}
        material={materials.brass}
        offset={[0, 0.15, 0]}
        receiveShadow={false}
      />
      <Hardware
        pieces={hardware.pieces}
        geometry={geometry.finial}
        material={materials.brass}
        offset={[0, 0.3, 0]}
        receiveShadow={false}
      />
      {hardware.batches.map(([finish, pieces]) => (
        <Hardware
          key={finish}
          pieces={pieces}
          geometry={geometry.pennant}
          material={materials.tracks[finish]}
          offset={[0.22, 0.18, 0]}
          receiveShadow={false}
        />
      ))}
      {hardware.tops.map((marker) => (
        <Glyph
          key={marker.column}
          text={`@${marker.pos}`}
          position={[marker.position.x + 0.22, marker.position.y + 0.18, marker.position.z + 0.04]}
          size={0.1}
          width={0.37}
          color="#f6f0e5"
        />
      ))}
    </group>
  );
}
