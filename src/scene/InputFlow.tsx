import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from 'zustand';
import type { Group } from 'three';
import type { MachineLayout } from '../layout/pieces.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { letterGlyph, visibleTiles } from './geometry.ts';
import type { Materials } from './materials.ts';
import Glyph from './Glyph.tsx';

const CAP = 16;
const RADIUS = 0.16;

type Role = 'waiting' | 'passed' | 'skipped';

function pieceAt(machine: MachineLayout, kind: string) {
  return machine.pieces.find((piece) => piece.kind === kind)?.position ?? null;
}

function FlowMarble({
  glyph,
  target,
  materials,
}: {
  glyph: string;
  target: { x: number; y: number; z: number };
  materials: Materials;
}) {
  const ref = useRef<Group>(null);
  const placed = useRef(false);
  useFrame((_, delta) => {
    const group = ref.current;
    if (!group) return;
    if (!placed.current) {
      group.position.set(target.x, target.y, target.z);
      placed.current = true;
      return;
    }
    const step = Math.min(1, delta * 6);
    group.position.x += (target.x - group.position.x) * step;
    group.position.y += (target.y - group.position.y) * step;
    group.position.z += (target.z - group.position.z) * step;
  });
  return (
    <group ref={ref}>
      <mesh castShadow material={materials.marble}>
        <sphereGeometry args={[RADIUS, 20, 20]} />
      </mesh>
      <Glyph
        text={letterGlyph(glyph)}
        position={[0, 0.02, RADIUS + 0.01]}
        size={0.16}
        width={0.28}
        color="#30362d"
      />
    </group>
  );
}

/** Letters of the test string, waiting at the inlet and collecting once the runner accepts them. */
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
  const head = useStore(store, (s) => s.machine?.head ?? 0);
  const attemptStart = useStore(store, (s) => s.machine?.attemptStart ?? 0);
  const tiles = useMemo(() => visibleTiles(input, unicode, 64), [input, unicode]);
  const hopper = pieceAt(machine, 'hopper');
  const cup = pieceAt(machine, 'cup');
  const reject = pieceAt(machine, 'rejectTray');
  if (!hopper || !cup || !reject) return null;

  const active = tiles.find((tile) => tile.index <= head && head < tile.index + tile.glyph.length);
  const around = tiles.filter((tile) => Math.abs(tile.index - (active?.index ?? head)) <= 12).slice(0, CAP);
  let waiting = 0;
  let passed = 0;
  let skipped = 0;
  const placed = around.flatMap((tile) => {
    if (active && tile.index === active.index) return [];
    let role: Role = 'waiting';
    if (attemptStart >= 0 && tile.index < attemptStart) role = 'skipped';
    else if (tile.index < head) role = 'passed';
    const slot = role === 'waiting' ? waiting++ : role === 'passed' ? passed++ : skipped++;
    const base = role === 'waiting' ? hopper : role === 'passed' ? cup : reject;
    const target =
      role === 'waiting'
        ? { x: base.x - 0.7 - slot * 0.4, y: base.y + 0.62, z: base.z + 0.2 }
        : {
            x: base.x - 0.42 + (slot % 6) * 0.28,
            y: base.y + 0.32 + Math.floor(slot / 6) * 0.3,
            z: base.z,
          };
    return [{ index: tile.index, glyph: tile.glyph, target }];
  });

  return (
    <group>
      {placed.map((marble) => (
        <FlowMarble key={marble.index} glyph={marble.glyph} target={marble.target} materials={materials} />
      ))}
    </group>
  );
}
