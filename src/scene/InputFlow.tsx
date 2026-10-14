import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from 'zustand';
import { Vector3 } from 'three';
import type { Group, Mesh, PointLight } from 'three';
import type { MachineLayout } from '../layout/pieces.ts';
import { carriageAtIndex } from '../playback/carriage.ts';
import { poseAtIndex } from '../playback/motion.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { letterGlyph } from './geometry.ts';
import type { Materials } from './materials.ts';
import Glyph from './Glyph.tsx';
import { castAt, compileCast, type LetterCast } from './letterCast.ts';
import { Ride } from './ride.ts';

const RADIUS = 0.18;
const WORLD_UP = new Vector3(0, 1, 0);

function bedAt(
  ride: Ride,
  machine: MachineLayout,
  store: PlaybackStore,
): { x: number; y: number; z: number } | null {
  const snapshot = store.getState();
  if (!snapshot.timeline) return null;
  const carriage = carriageAtIndex(machine, snapshot.timeline, snapshot.segmentIndex, snapshot.fraction);
  if (carriage) return carriage.rail;
  return (
    ride.along(snapshot.timeline, snapshot.segmentIndex, snapshot.fraction) ??
    poseAtIndex(machine, snapshot.timeline, snapshot.segmentIndex, snapshot.fraction)?.position ??
    null
  );
}

function CastMarbles({
  cast,
  store,
  machine,
  materials,
}: {
  cast: LetterCast;
  store: PlaybackStore;
  machine: MachineLayout;
  materials: Materials;
}) {
  const groups = useRef<Array<Group | null>>([]);
  const balls = useRef<Array<Mesh | null>>([]);
  const lasts = useRef<Array<Vector3 | null>>([]);
  const light = useRef<PointLight>(null);
  const ride = useMemo(() => new Ride(machine), [machine]);
  useFrame(() => {
    const places = castAt(cast, store.getState().time, bedAt(ride, machine, store));
    let rider = -1;
    for (let i = 0; i < places.length; i++) {
      const group = groups.current[i];
      if (!group) continue;
      const place = places[i];
      group.visible = place.visible;
      if (!place.visible) continue;
      const at = place.position;
      group.position.set(at.x, at.y, at.z);
      if (place.riding) rider = i;
      const sphere = balls.current[i];
      const previous = lasts.current[i];
      if (sphere && previous && (place.riding || place.kind === 'fall' || place.kind === 'cup')) {
        const step = new Vector3(at.x, at.y, at.z).sub(previous);
        const distance = step.length();
        if (distance > 1e-5 && distance < 2) {
          const axis = new Vector3().crossVectors(WORLD_UP, step.normalize());
          if (axis.lengthSq() > 1e-8) sphere.rotateOnWorldAxis(axis.normalize(), distance / RADIUS);
        }
      }
      lasts.current[i] = previous ? previous.set(at.x, at.y, at.z) : new Vector3(at.x, at.y, at.z);
    }
    const lamp = light.current;
    const followed = rider >= 0 ? groups.current[rider] : null;
    if (lamp) {
      lamp.visible = Boolean(followed);
      if (followed) lamp.position.set(followed.position.x, followed.position.y + 0.55, followed.position.z + 0.7);
    }
  });
  return (
    <group>
      <pointLight ref={light} color="#ffd9a8" intensity={3.4} distance={3.2} decay={2} visible={false} />
      {cast.glyphs.map((glyph, index) => {
        const at = cast.spans[index][0]?.at ?? { x: 0, y: 0, z: 0 };
        return (
          <group
            key={cast.indices[index]}
            ref={(node) => {
              groups.current[index] = node;
            }}
            position={[at.x, at.y, at.z]}
            visible={index < 8}
          >
            <mesh
              ref={(node) => {
                balls.current[index] = node;
              }}
              castShadow
              material={materials.marble}
            >
              <sphereGeometry args={[RADIUS, 20, 20]} />
            </mesh>
            <Glyph
              text={letterGlyph(glyph)}
              position={[0, 0.02, RADIUS + 0.01]}
              size={0.15}
              width={0.28}
              color="#30362d"
            />
          </group>
        );
      })}
    </group>
  );
}

export default function InputFlow({
  store,
  machine,
  input,
  unicode,
  materials,
}: {
  store: PlaybackStore;
  machine: MachineLayout;
  input: string;
  unicode: boolean;
  materials: Materials;
}) {
  const trace = useStore(store, (s) => s.trace);
  const timeline = useStore(store, (s) => s.timeline);
  const cast = useMemo(() => {
    if (!trace || !timeline || input.length === 0) return null;
    return compileCast(trace, timeline, machine, input, unicode);
  }, [trace, timeline, machine, input, unicode]);
  if (!cast || cast.glyphs.length === 0) return null;
  return <CastMarbles cast={cast} store={store} machine={machine} materials={materials} />;
}
