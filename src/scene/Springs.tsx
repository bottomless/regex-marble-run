import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from 'zustand';
import type { Group } from 'three';
import type { MachineLayout, Vec3 } from '../layout/pieces.ts';
import type { PlaybackStore } from '../playback/store.ts';
import {
  MARBLE_LIFT,
  plungerTravel,
  SPRING_BASE_DEPTH,
  SPRING_COIL_RADIUS,
  SPRING_PLATE_DEPTH,
  SPRING_PLATE_RADIUS,
  SPRING_WELL,
  springCoilGeometry,
  springLaunchers,
  type SpringLauncher,
} from './geometry.ts';
import { castAt, hiddenLoopPieces, sharedCast } from './letterCast.ts';
import type { Materials } from './materials.ts';
import { Ride } from './ride.ts';

/** Bed positions of every marble that can ride a lift right now. */
export function riderBeds(
  store: PlaybackStore,
  machine: MachineLayout,
  ride: Ride,
  options: { hero: boolean; input: string; unicode: boolean },
): Vec3[] {
  const snapshot = store.getState();
  const { timeline, trace } = snapshot;
  if (!timeline) return [];
  const beds: Vec3[] = [];
  if (options.hero) {
    const at = ride.along(timeline, snapshot.segmentIndex, snapshot.fraction);
    if (at) beds.push(at);
  }
  if (trace && options.input.length > 0) {
    const cast = sharedCast(trace, timeline, machine, options.input, options.unicode);
    for (const place of castAt(cast, snapshot.time, null)) {
      if (place.visible && place.riding) {
        beds.push({ x: place.position.x, y: place.position.y - MARBLE_LIFT, z: place.position.z });
      }
    }
  }
  return beds;
}

/** Coil length for a plate travel: loaded below rest, stretched while driving the marble up. */
export function coilLength(launcher: SpringLauncher, travel: number): number {
  return Math.max(launcher.rest * 0.4, launcher.rest + travel);
}

export default function Springs({
  store,
  machine,
  materials,
  hero,
  input,
  unicode,
  usedOnly,
}: {
  store: PlaybackStore;
  machine: MachineLayout;
  materials: Materials;
  hero: boolean;
  input: string;
  unicode: boolean;
  usedOnly: boolean;
}) {
  const timeline = useStore(store, (s) => s.timeline);
  const invalidate = useThree((state) => state.invalidate);
  const launchers = useMemo(() => {
    const all = springLaunchers(machine);
    if (!usedOnly) return all;
    const hidden = hiddenLoopPieces(machine, timeline);
    return all.filter((launcher) => !hidden.has(launcher.piece));
  }, [machine, timeline, usedOnly]);
  const ride = useMemo(() => new Ride(machine), [machine]);
  const coil = useMemo(() => springCoilGeometry(SPRING_WELL - SPRING_PLATE_DEPTH), []);
  useEffect(() => () => coil.dispose(), [coil]);
  const coils = useRef<Array<Group | null>>([]);
  const plates = useRef<Array<Group | null>>([]);
  useEffect(() => store.subscribe(() => invalidate()), [store, invalidate]);
  useFrame(() => {
    const beds = launchers.length ? riderBeds(store, machine, ride, { hero, input, unicode }) : [];
    launchers.forEach((launcher, index) => {
      const length = coilLength(launcher, plungerTravel(launcher, beds));
      coils.current[index]?.scale.set(1, length / launcher.rest, 1);
      plates.current[index]?.position.set(0, length, 0);
    });
  });
  return (
    <group>
      {launchers.map((launcher, index) => (
        <group key={launcher.piece} position={[launcher.base.x, launcher.base.y, launcher.base.z]}>
          <mesh position={[0, -SPRING_BASE_DEPTH / 2, 0]} material={materials.steel} castShadow receiveShadow>
            <cylinderGeometry args={[SPRING_PLATE_RADIUS, SPRING_PLATE_RADIUS + 0.02, SPRING_BASE_DEPTH, 20]} />
          </mesh>
          <group
            ref={(node) => {
              coils.current[index] = node;
            }}
          >
            <mesh geometry={coil} material={materials.steel} castShadow />
          </group>
          <group
            ref={(node) => {
              plates.current[index] = node;
            }}
            position={[0, launcher.rest, 0]}
          >
            <mesh position={[0, SPRING_PLATE_DEPTH / 2, 0]} material={materials.brass} castShadow receiveShadow>
              <cylinderGeometry args={[SPRING_PLATE_RADIUS, SPRING_PLATE_RADIUS, SPRING_PLATE_DEPTH, 24]} />
            </mesh>
            <mesh position={[0, -0.03, 0]} material={materials.steel}>
              <cylinderGeometry args={[SPRING_COIL_RADIUS * 0.45, SPRING_COIL_RADIUS * 0.45, 0.06, 12]} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}
