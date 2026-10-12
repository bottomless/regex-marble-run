import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useStore } from 'zustand';
import type { Group } from 'three';
import type { Program } from '../engine/ir.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { tileStatus } from '../playback/tiles.ts';
import { copy } from '../copy.ts';
import { displayMetrics, visibleTiles } from './geometry.ts';
import type { DisplayMetrics } from './geometry.ts';
import type { Materials } from './materials.ts';
import Tracks from './Tracks.tsx';
import Gates from './Gates.tsx';
import Pieces from './Pieces.tsx';
import Glyph from './Glyph.tsx';
import Marble from './Marble.tsx';

function LiveTileRail({
  input,
  unicode,
  metrics,
  materials,
  store,
}: {
  input: string;
  unicode: boolean;
  metrics: DisplayMetrics;
  materials: Materials;
  store: PlaybackStore;
}) {
  const machineState = useStore(store, (s) => s.machine);
  const count = Math.min(24, Math.floor((metrics.boardWidth - 1) / 0.4));
  const tiles = visibleTiles(input, unicode, count);
  const pitch = Math.min(0.49, (metrics.boardWidth - 1) / Math.max(1, tiles.length));
  const front = metrics.boardDepth / 2 - 0.27;
  return (
    <group>
      <mesh position={[0, 0.57, front - 0.1]} material={materials.tracks.edge} receiveShadow>
        <boxGeometry args={[Math.max(1.2, tiles.length * pitch + 0.16), 0.06, 0.48]} />
      </mesh>
      {tiles.map((tile, i) => {
        const status = tileStatus(machineState, tile.index);
        const lit = status !== 'pending';
        const isHead = status === 'head';
        return (
          <group
            key={tile.index}
            position={[(i - (tiles.length - 1) / 2) * pitch, 0.69, front]}
          >
            <RoundedBox
              args={[pitch - 0.035, 0.24, 0.38]}
              radius={0.03}
              smoothness={2}
              material={lit ? materials.tracks.cobalt : materials.tracks.birch}
              castShadow
            />
            <Glyph
              text={
                tile.glyph === ' ' ? '·' : tile.glyph === '\n' ? '↵' : tile.glyph === '\t' ? '⇥' : tile.glyph
              }
              position={[0, 0.02, 0.2]}
              size={0.2}
              width={pitch - 0.06}
              color={lit ? '#f4efe2' : '#30362d'}
            />
            <Glyph text={String(tile.index)} position={[0, -0.12, 0.205]} size={0.065} color="#82745e" />
            {isHead && (
              <mesh position={[0, -0.19, 0]} material={materials.brass} castShadow>
                <boxGeometry args={[pitch - 0.06, 0.05, 0.06]} />
              </mesh>
            )}
          </group>
        );
      })}
      {input.length > (tiles.at(-1)?.index ?? 0) + (tiles.at(-1)?.glyph.length ?? 0) && (
        <Glyph text="…" position={[metrics.boardWidth / 2 - 0.4, 0.72, front + 0.19]} size={0.21} />
      )}
    </group>
  );
}

function TileRail({
  input,
  unicode,
  metrics,
  materials,
  store,
}: {
  input: string;
  unicode: boolean;
  metrics: DisplayMetrics;
  materials: Materials;
  store?: PlaybackStore;
}) {
  const count = Math.min(24, Math.floor((metrics.boardWidth - 1) / 0.4));
  const tiles = visibleTiles(input, unicode, count);
  const pitch = Math.min(0.49, (metrics.boardWidth - 1) / Math.max(1, tiles.length));
  const front = metrics.boardDepth / 2 - 0.27;
  if (store) {
    return (
      <LiveTileRail input={input} unicode={unicode} metrics={metrics} materials={materials} store={store} />
    );
  }
  return (
    <group>
      <mesh position={[0, 0.57, front - 0.1]} material={materials.tracks.edge} receiveShadow>
        <boxGeometry args={[Math.max(1.2, tiles.length * pitch + 0.16), 0.06, 0.48]} />
      </mesh>
      {tiles.map((tile, i) => (
        <group key={tile.index} position={[(i - (tiles.length - 1) / 2) * pitch, 0.69, front]}>
          <RoundedBox
            args={[pitch - 0.035, 0.24, 0.38]}
            radius={0.03}
            smoothness={2}
            material={materials.tracks.birch}
            castShadow
          />
          <Glyph
            text={
              tile.glyph === ' ' ? '·' : tile.glyph === '\n' ? '↵' : tile.glyph === '\t' ? '⇥' : tile.glyph
            }
            position={[0, 0.02, 0.2]}
            size={0.2}
            width={pitch - 0.06}
          />
          <Glyph text={String(tile.index)} position={[0, -0.12, 0.205]} size={0.065} color="#82745e" />
        </group>
      ))}
      {input.length > (tiles.at(-1)?.index ?? 0) + (tiles.at(-1)?.glyph.length ?? 0) && (
        <Glyph text="…" position={[metrics.boardWidth / 2 - 0.4, 0.72, front + 0.19]} size={0.21} />
      )}
    </group>
  );
}

function Base({ metrics, materials }: { metrics: DisplayMetrics; materials: Materials }) {
  const { boardWidth: w, boardDepth: d, height: h } = metrics;
  return (
    <group>
      <RoundedBox
        args={[w, 0.44, d]}
        radius={0.12}
        smoothness={3}
        position={[0, 0.3, 0]}
        material={materials.board}
        castShadow
        receiveShadow
      />
      {[0.14, 0.23, 0.33].map((y) => (
        <mesh key={y} position={[0, y, 0]} material={materials.tracks.edge}>
          <boxGeometry args={[w - 0.04, 0.018, d - 0.04]} />
        </mesh>
      ))}
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <group key={`${x},${z}`} position={[x * (w / 2 - 0.3), 0.54, z * (d / 2 - 0.3)]}>
            <mesh material={materials.brass}>
              <cylinderGeometry args={[0.075, 0.075, 0.025, 16]} />
            </mesh>
            <mesh position={[0, 0.018, 0]} material={materials.ink}>
              <boxGeometry args={[0.08, 0.007, 0.012]} />
            </mesh>
          </group>
        )),
      )}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * (w / 2 - 0.55), 0.6 + h / 2, -d / 2 + 0.6]}>
          <mesh material={materials.tracks.edge} castShadow>
            <boxGeometry args={[0.2, h + 0.2, 0.28]} />
          </mesh>
          <mesh position={[0, -h / 2 + 0.04, 0.08]} material={materials.brass}>
            <boxGeometry args={[0.45, 0.22, 0.45]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, h + 0.65, -d / 2 + 0.6]} material={materials.tracks.edge} castShadow>
        <boxGeometry args={[w - 0.9, 0.16, 0.24]} />
      </mesh>
      <mesh position={[0, 0.28, d / 2 + 0.018]} material={materials.brass}>
        <boxGeometry args={[Math.min(3.2, w * 0.5), 0.24, 0.03]} />
      </mesh>
      <Glyph text={copy.scene.base} position={[0, 0.29, d / 2 + 0.045]} size={0.115} width={3} />
    </group>
  );
}

export default function Machine({
  machine,
  program,
  input,
  materials,
  reducedMotion,
  onExpand,
  store,
}: {
  machine: MachineLayout;
  program: Program;
  input: string;
  materials: Materials;
  reducedMotion: boolean;
  onExpand: (id: number) => void;
  store?: PlaybackStore;
}) {
  const metrics = displayMetrics(machine);
  const building = useRef<Group>(null);
  const elapsed = useRef(0);
  useFrame((state, delta) => {
    if (!building.current || reducedMotion || elapsed.current >= 0.25) return;
    elapsed.current = Math.min(0.25, elapsed.current + delta);
    const t = 1 - Math.pow(1 - elapsed.current / 0.25, 3);
    building.current.position.y = 0.6 - (1 - t) * 0.2;
    state.invalidate();
  });
  return (
    <group>
      <Base metrics={metrics} materials={materials} />
      <group ref={building} position={[0, 0.6, 0]} scale={metrics.scale}>
        <group position={metrics.offset}>
          <Tracks machine={machine} materials={materials} />
          <Gates machine={machine} materials={materials} program={program} />
          <Pieces machine={machine} program={program} materials={materials} onExpand={onExpand} />
          {store && <Marble store={store} machine={machine} materials={materials} />}
        </group>
      </group>
      <TileRail
        input={input}
        unicode={program.flags.unicode || program.flags.unicodeSets}
        metrics={metrics}
        materials={materials}
        store={store}
      />
    </group>
  );
}
