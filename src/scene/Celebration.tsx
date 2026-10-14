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
      {[-1, 1].map((side) => (
        <mesh key={`cz-${side}`} position={[0, 0.38, side * 0.72]} material={materials.brass}>
          <boxGeometry args={[2.5, 0.06, 0.06]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`cx-${side}`} position={[side * 1.22, 0.38, 0]} material={materials.brass}>
          <boxGeometry args={[0.06, 0.06, 1.5]} />
        </mesh>
      ))}
      <mesh position={[0, 0.88, 0.1]} material={materials.brass}>
        <boxGeometry args={[1.9, 0.3, 0.05]} />
      </mesh>
      <Glyph
        text={copy.scene.matchSpan(span.start, span.end)}
        position={[0, 0.88, 0.14]}
        size={0.15}
        width={1.75}
        color="#2a2520"
      />
    </group>
  );
}
