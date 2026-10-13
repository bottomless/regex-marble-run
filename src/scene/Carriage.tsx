import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import type { MachineLayout } from '../layout/pieces.ts';
import { carriageAtIndex, formatCarriage } from '../playback/carriage.ts';
import type { PlaybackStore } from '../playback/store.ts';
import type { Materials } from './materials.ts';

/**
 * Rear-lift carriage. Position comes only from the current lift segment and fraction, so a paused
 * scrub or backward step shows the same deck the playhead would. Hidden off the ride.
 */
export default function Carriage({
  store,
  machine,
  materials,
}: {
  store: PlaybackStore;
  machine: MachineLayout;
  materials: Materials;
}) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const canvas = useThree((state) => state.gl.domElement);

  useEffect(() => {
    const write = () => {
      const snapshot = store.getState();
      const pose = snapshot.timeline
        ? carriageAtIndex(machine, snapshot.timeline, snapshot.segmentIndex, snapshot.fraction)
        : null;
      canvas.setAttribute('data-carriage', formatCarriage(pose));
      canvas.setAttribute('data-carriage-riding', pose ? 'true' : 'false');
      invalidate();
    };
    write();
    return store.subscribe(write);
  }, [store, machine, canvas, invalidate]);

  useFrame(() => {
    const snapshot = store.getState();
    const group = ref.current;
    if (!group) return;
    const pose = snapshot.timeline
      ? carriageAtIndex(machine, snapshot.timeline, snapshot.segmentIndex, snapshot.fraction)
      : null;
    if (!pose) {
      group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(pose.position.x, pose.position.y, pose.position.z);
    group.rotation.set(0, pose.yaw, 0);
  });

  return (
    <group ref={ref} visible={false}>
      <mesh position={[0, 0.035, 0]} material={materials.brass} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.07, 0.3]} />
      </mesh>
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.16, 0]} material={materials.steel} castShadow>
          <boxGeometry args={[0.035, 0.22, 0.26]} />
        </mesh>
      ))}
      <mesh position={[0, 0.28, 0]} material={materials.brass} castShadow>
        <boxGeometry args={[0.42, 0.03, 0.26]} />
      </mesh>
      <mesh position={[0, 0.4, 0]} material={materials.steel}>
        <cylinderGeometry args={[0.025, 0.025, 0.2, 8]} />
      </mesh>
    </group>
  );
}
