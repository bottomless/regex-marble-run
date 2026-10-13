import { useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useStore } from 'zustand';
import { copy } from '../copy.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import { matchSpan } from '../playback/captures.ts';
import type { PlaybackStore } from '../playback/store.ts';
import Glyph from './Glyph.tsx';
import type { Materials } from './materials.ts';

export default function Celebration({
  machine,
  store,
  materials,
}: {
  machine: MachineLayout;
  store: PlaybackStore;
  materials: Materials;
}) {
  const state = useStore(store, (snapshot) => snapshot.machine);
  const span = useMemo(() => matchSpan(state), [state]);
  const cup = useMemo(() => machine.pieces.find((piece) => piece.kind === 'cup'), [machine]);
  const canvas = useThree((snapshot) => snapshot.gl.domElement);
  const invalidate = useThree((snapshot) => snapshot.invalidate);
  useLayoutEffect(() => {
    canvas.setAttribute('data-match', JSON.stringify(span));
    invalidate();
    return () => canvas.removeAttribute('data-match');
  }, [canvas, span, invalidate]);
  if (!span || !cup) return null;
  const p = cup.position;
  return (
    <group position={[p.x, p.y, p.z]}>
      <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]} material={materials.brass}>
        <torusGeometry args={[0.95, 0.05, 10, 40]} />
      </mesh>
      <mesh position={[0, 0.72, 0]} rotation={[Math.PI / 2, 0, 0]} material={materials.brass}>
        <torusGeometry args={[0.7, 0.035, 10, 36]} />
      </mesh>
      <Glyph text={copy.scene.matchSpan(span.start, span.end)} position={[0, 1.05, 0.1]} size={0.16} width={1.4} />
    </group>
  );
}
