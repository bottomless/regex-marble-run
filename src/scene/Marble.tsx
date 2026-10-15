import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, MeshBasicMaterial, Vector3 } from 'three';
import type { Group, Mesh } from 'three';
import type { MachineLayout } from '../layout/pieces.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { useStore } from 'zustand';
import { letterGlyph, visibleTiles } from './geometry.ts';
import Glyph from './Glyph.tsx';
import type { Materials } from './materials.ts';
import { palette } from './materials.ts';
import { Ride, FRAME_STEP_CAP_MS, carriedPosition } from './ride.ts';

export const MARBLE_RADIUS = 0.26;
/** Marble centre above the channel bed (the track spline), sunk a hair so it reads as resting on wood. */
const MARBLE_LIFT = MARBLE_RADIUS - 0.02;
const WORLD_UP = new Vector3(0, 1, 0);

/**
 * The hero marble. Drives the playback clock (one `tick` per rendered frame) and positions itself from
 * the store's `(segmentIndex, fraction)` via the pure motion solver, so it never triggers React
 * re-renders at 60fps. Under `frameloop="demand"` it invalidates the canvas each playing frame and on
 * any external store change (play/pause/scrub/load) so a paused scrub still repaints.
 *
 * A soft warm halo and a small point light travel with it so the eye can always find the marble
 * against the birch tracks, even on a dense machine where the marble itself is small on screen.
 * Travel segments follow the track spline with gravity easing (see `ride.ts`) and the sphere spins
 * about its contact axis by the distance covered, so it visibly rolls rather than slides.
 */
export default function Marble({
  store,
  machine,
  materials,
  emphasis = 1,
  input = '',
  unicode = false,
  showBody = true,
}: {
  store: PlaybackStore;
  machine: MachineLayout;
  materials: Materials;
  emphasis?: number;
  input?: string;
  unicode?: boolean;
  showBody?: boolean;
}) {
  const ref = useRef<Group>(null);
  const ball = useRef<Mesh>(null);
  const last = useRef<Vector3 | null>(null);
  const ride = useMemo(() => new Ride(machine), [machine]);
  const head = useStore(store, (s) => s.machine?.head ?? -1);
  const glyph = useMemo(() => {
    const tile = visibleTiles(input, unicode, 64).find(
      (item) => item.index <= head && head < item.index + item.glyph.length,
    );
    return tile ? letterGlyph(tile.glyph) : '';
  }, [input, unicode, head]);
  const invalidate = useThree((state) => state.invalidate);
  const halo = useMemo(
    () =>
      new MeshBasicMaterial({
        color: palette.vermilion,
        transparent: true,
        opacity: 0.16,
        side: BackSide,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => halo.dispose(), [halo]);

  useEffect(() => store.subscribe(() => invalidate()), [store, invalidate]);

  useFrame((state, delta) => {
    store.getState().tick(Math.min(FRAME_STEP_CAP_MS, delta * 1000));
    const snapshot = store.getState();
    if (snapshot.playing) state.invalidate();
    const group = ref.current;
    if (!group || !showBody) {
      if (group) group.visible = false;
      return;
    }
    const carried = snapshot.timeline
      ? carriedPosition(ride, machine, snapshot.timeline, snapshot.segmentIndex, snapshot.fraction)
      : null;
    if (carried) {
      group.visible = true;
      group.position.set(carried.x, carried.y + MARBLE_LIFT * emphasis, carried.z);
      const sphere = ball.current;
      const previous = last.current;
      if (sphere && previous) {
        const step = new Vector3().subVectors(group.position, previous);
        const distance = step.length();
        if (distance > 1e-5 && distance < 1.25) {
          const axis = new Vector3().crossVectors(WORLD_UP, step.normalize());
          if (axis.lengthSq() > 1e-8)
            sphere.rotateOnWorldAxis(axis.normalize(), distance / (MARBLE_RADIUS * emphasis));
        }
      }
      last.current = previous ? previous.copy(group.position) : group.position.clone();
    } else {
      group.visible = false;
      last.current = null;
    }
  });

  return (
    <group ref={ref} visible={false} scale={emphasis}>
      <mesh ref={ball} castShadow>
        <sphereGeometry args={[MARBLE_RADIUS, 32, 32]} />
        <primitive object={materials.marble} attach="material" />
      </mesh>
      {glyph && (
        <Glyph
          text={glyph}
          position={[0, 0.02, MARBLE_RADIUS + 0.02]}
          size={0.22}
          width={0.36}
          color="#30362d"
        />
      )}
      <mesh material={halo} renderOrder={-1}>
        <sphereGeometry args={[MARBLE_RADIUS * 1.4, 24, 24]} />
      </mesh>
      <pointLight color="#ffd9a8" intensity={4} distance={3.4} decay={2} position={[0, 0.7, 0.9]} />
    </group>
  );
}
