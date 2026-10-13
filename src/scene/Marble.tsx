import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { MachineLayout } from '../layout/pieces.ts';
import { carriageAtIndex, carriedMarblePosition } from '../playback/carriage.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { poseAtIndex } from '../playback/motion.ts';
import type { Materials } from './materials.ts';

const MARBLE_RADIUS = 0.15;

/**
 * The hero marble. Drives the playback clock (one `tick` per rendered frame) and positions itself from
 * the store's `(segmentIndex, fraction)` via the pure motion solver, so it never triggers React
 * re-renders at 60fps. Under `frameloop="demand"` it invalidates the canvas each playing frame and on
 * any external store change (play/pause/scrub/load) so a paused scrub still repaints.
 */
export default function Marble({
  store,
  machine,
  materials,
}: {
  store: PlaybackStore;
  machine: MachineLayout;
  materials: Materials;
}) {
  const ref = useRef<Mesh>(null);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => store.subscribe(() => invalidate()), [store, invalidate]);

  useFrame((state, delta) => {
    store.getState().tick(delta * 1000);
    const snapshot = store.getState();
    const mesh = ref.current;
    if (!mesh) return;
    const riding = snapshot.timeline
      ? carriageAtIndex(machine, snapshot.timeline, snapshot.segmentIndex, snapshot.fraction)
      : null;
    const pose = snapshot.timeline ? poseAtIndex(machine, snapshot.timeline, snapshot.segmentIndex, snapshot.fraction) : null;
    if (pose) {
      const carried = riding ? carriedMarblePosition(riding.rail) : pose.position;
      mesh.visible = true;
      mesh.position.set(carried.x, carried.y, carried.z);
    } else {
      mesh.visible = false;
    }
    if (snapshot.playing) state.invalidate();
  });

  return (
    <mesh ref={ref} castShadow visible={false}>
      <sphereGeometry args={[MARBLE_RADIUS, 24, 24]} />
      <primitive object={materials.marble} attach="material" />
    </mesh>
  );
}
