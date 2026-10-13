import { useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useStore } from 'zustand';
import { copy } from '../copy.ts';
import type { Program } from '../engine/ir.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import { repeatMarkers } from '../playback/repeats.ts';
import type { PlaybackStore } from '../playback/store.ts';
import Glyph from './Glyph.tsx';
import type { Materials } from './materials.ts';
import Pointer from './Pointer.tsx';

export default function Repeats({
  program,
  machine,
  store,
  materials,
}: {
  program: Program;
  machine: MachineLayout;
  store: PlaybackStore;
  materials: Materials;
}) {
  const state = useStore(store, (snapshot) => snapshot.machine);
  const markers = useMemo(() => repeatMarkers(program, machine, state), [program, machine, state]);
  const canvas = useThree((snapshot) => snapshot.gl.domElement);
  const invalidate = useThree((snapshot) => snapshot.invalidate);
  useLayoutEffect(() => {
    canvas.setAttribute('data-repeats', JSON.stringify(markers));
    invalidate();
    return () => canvas.removeAttribute('data-repeats');
  }, [canvas, markers, invalidate]);

  return (
    <group>
      {markers.map((marker) => {
        const saved = (['exit', 'again'] as const).find((choice) => marker.saved[choice] > 0);
        return (
          <group key={marker.node}>
            {marker.angle !== null && (
              <Pointer position={marker.position} angle={marker.angle} materials={materials} />
            )}
            <group position={[marker.dial.x, marker.dial.y, marker.dial.z]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} material={materials.brass}>
                <cylinderGeometry args={[0.34, 0.34, 0.06, 24]} />
              </mesh>
              <mesh
                rotation={[Math.PI / 2, 0, 0]}
                position={[0, 0, 0.035]}
                material={marker.choice === null ? materials.ink : materials.tracks.teal}
              >
                <cylinderGeometry args={[0.27, 0.27, 0.02, 24]} />
              </mesh>
              <Glyph
                text={String(marker.count)}
                position={[0, 0, 0.06]}
                size={0.22}
                width={0.46}
                color="#f6f0e5"
              />
              {marker.choice !== null && (
                <Glyph
                  text={marker.choice === 'again' ? copy.scene.loopAgain : copy.scene.loopExit}
                  position={[0, 0.5, 0.05]}
                  size={0.11}
                  width={0.7}
                />
              )}
              {saved && (
                <>
                  <mesh material={materials.brass}>
                    <torusGeometry args={[0.42, 0.035, 8, 24]} />
                  </mesh>
                  <Glyph
                    text={copy.scene.savedLoop(saved, marker.saved[saved])}
                    position={[0, -0.55, 0.05]}
                    size={0.1}
                    width={1.1}
                  />
                </>
              )}
            </group>
          </group>
        );
      })}
    </group>
  );
}
