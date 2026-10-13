import { useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useStore } from 'zustand';
import type { Program } from '../engine/ir.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import { mirrorFaces } from '../playback/captures.ts';
import type { PlaybackStore } from '../playback/store.ts';
import Glyph from './Glyph.tsx';

export default function Mirrors({
  program,
  machine,
  input,
  store,
}: {
  program: Program;
  machine: MachineLayout;
  input: string;
  store: PlaybackStore;
}) {
  const state = useStore(store, (snapshot) => snapshot.machine);
  const pieces = useMemo(() => machine.pieces.filter((piece) => piece.kind === 'mirror'), [machine]);
  const faces = useMemo(
    () => mirrorFaces(program, state, input, pieces.map((piece) => piece.node!)),
    [program, state, input, pieces],
  );
  const canvas = useThree((snapshot) => snapshot.gl.domElement);
  const invalidate = useThree((snapshot) => snapshot.invalidate);
  useLayoutEffect(() => {
    canvas.setAttribute('data-mirrors', JSON.stringify(faces));
    invalidate();
    return () => canvas.removeAttribute('data-mirrors');
  }, [canvas, faces, invalidate]);

  return (
    <group>
      {pieces.map((piece, i) => (
        <group key={piece.node ?? i} position={[piece.position.x, piece.position.y - 0.22, piece.position.z + 0.26]}>
          <mesh>
            <boxGeometry args={[0.76, 0.24, 0.02]} />
            <meshStandardMaterial color={faces[i]?.text ? '#f4efe2' : '#c9d6d4'} roughness={0.5} metalness={0.05} />
          </mesh>
          <Glyph text={faces[i]?.text ?? ''} position={[0, 0, 0.015]} size={0.17} width={0.72} color="#2b2e27" />
        </group>
      ))}
    </group>
  );
}
