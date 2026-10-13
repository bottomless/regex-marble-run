import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from 'zustand';
import type { Mesh } from 'three';
import type { MachineLayout } from '../layout/pieces.ts';
import { scoutPose, scoutTiles, scoutWindow } from '../playback/scout.ts';
import type { PlaybackStore } from '../playback/store.ts';
import type { Materials } from './materials.ts';

const SCOUT_RADIUS = 0.1;

export default function Scout({
  machine,
  store,
  materials,
}: {
  machine: MachineLayout;
  store: PlaybackStore;
  materials: Materials;
}) {
  const state = useStore(store, (snapshot) => snapshot.machine);
  const active = useMemo(() => scoutWindow(state), [state]);
  const tiles = useMemo(() => scoutTiles(active), [active]);
  const ref = useRef<Mesh>(null);
  const canvas = useThree((snapshot) => snapshot.gl.domElement);
  const invalidate = useThree((snapshot) => snapshot.invalidate);
  useLayoutEffect(() => {
    canvas.setAttribute('data-scout', JSON.stringify(active));
    canvas.setAttribute('data-scout-tiles', tiles.join(','));
    invalidate();
    return () => {
      canvas.removeAttribute('data-scout');
      canvas.removeAttribute('data-scout-tiles');
    };
  }, [canvas, active, tiles, invalidate]);

  useFrame((frameState) => {
    const snapshot = store.getState();
    const mesh = ref.current;
    if (!mesh) return;
    const current = scoutWindow(snapshot.machine);
    const pose = current ? scoutPose(machine, current, snapshot.eventIndex + snapshot.fraction) : null;
    if (pose) {
      mesh.visible = true;
      mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
    } else {
      mesh.visible = false;
    }
    if (snapshot.playing) frameState.invalidate();
  });

  return (
    <mesh ref={ref} castShadow visible={false}>
      <sphereGeometry args={[SCOUT_RADIUS, 20, 16]} />
      <primitive object={materials.tracks.scout} attach="material" />
    </mesh>
  );
}
