import { useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useStore } from 'zustand';
import { copy } from '../copy.ts';
import type { Program } from '../engine/ir.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import { alternationMarkers } from '../playback/alternation.ts';
import type { PlaybackStore } from '../playback/store.ts';
import Glyph from './Glyph.tsx';
import type { Materials } from './materials.ts';
import Pointer from './Pointer.tsx';

export default function Alternations({
  program,
  machine,
  store,
  materials,
  reducedMotion = false,
}: {
  program: Program;
  machine: MachineLayout;
  store: PlaybackStore;
  materials: Materials;
  reducedMotion?: boolean;
}) {
  const state = useStore(store, (snapshot) => snapshot.machine);
  const markers = useMemo(() => alternationMarkers(program, machine, state), [program, machine, state]);
  const canvas = useThree((snapshot) => snapshot.gl.domElement);
  const invalidate = useThree((snapshot) => snapshot.invalidate);
  useLayoutEffect(() => {
    canvas.setAttribute('data-alternations', JSON.stringify(markers));
    invalidate();
    return () => canvas.removeAttribute('data-alternations');
  }, [canvas, markers, invalidate]);

  return (
    <group>
      {markers.map((marker) => (
        <group key={marker.node}>
          {marker.angle !== null && (
              <Pointer position={marker.position} angle={marker.angle} materials={materials} reducedMotion={reducedMotion} />
          )}
          {marker.branches.map((branch) => (
            <group key={branch.option} position={[branch.position.x, branch.position.y, branch.position.z]}>
              <mesh
                rotation={[Math.PI / 2, 0, 0]}
                material={branch.selected ? materials.tracks.teal : materials.steel}
              >
                <cylinderGeometry args={[0.23, 0.23, 0.06, 20]} />
              </mesh>
              <Glyph
                text={String(branch.option + 1)}
                position={[0, 0, 0.045]}
                size={0.2}
                width={0.38}
                color={branch.selected ? '#f6f0e5' : '#30362d'}
              />
              {branch.selected && (
                <Glyph text={copy.scene.activeBranch} position={[0, 0.4, 0.05]} size={0.11} width={0.65} />
              )}
              {branch.savedCount > 0 && (
                <>
                  <mesh material={materials.brass}>
                    <torusGeometry args={[0.31, 0.035, 8, 24]} />
                  </mesh>
                  <Glyph
                    text={copy.scene.savedBranch(branch.savedCount)}
                    position={[0, -0.43, 0.05]}
                    size={0.11}
                    width={0.9}
                  />
                </>
              )}
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}
