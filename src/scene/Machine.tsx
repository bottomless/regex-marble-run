import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useStore } from 'zustand';
import type { Group } from 'three';
import type { Program } from '../engine/ir.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { tileStatus } from '../playback/tiles.ts';
import { scoutTiles, scoutWindow } from '../playback/scout.ts';
import { captureBrackets, matchSpan } from '../playback/captures.ts';
import { copy } from '../copy.ts';
import { displayMetrics, visibleTiles } from './geometry.ts';
import type { DisplayMetrics } from './geometry.ts';
import type { Materials } from './materials.ts';
import Tracks from './Tracks.tsx';
import Gates from './Gates.tsx';
import Pieces from './Pieces.tsx';
import Glyph from './Glyph.tsx';
import Marble from './Marble.tsx';
import Flags from './Flags.tsx';
import Carriage from './Carriage.tsx';
import Alternations from './Alternations.tsx';
import Repeats from './Repeats.tsx';
import GateLamps from './GateLamps.tsx';
import Scout from './Scout.tsx';
import Mirrors from './Mirrors.tsx';
import Celebration from './Celebration.tsx';
import Flood from './Flood.tsx';
import type { FloodModel } from '../playback/flood.ts';
import type { FlagEntry } from '../playback/state.ts';

function letterGlyph(glyph: string) {
  return glyph === ' ' ? '·' : glyph === '\n' ? '↵' : glyph === '\t' ? '⇥' : glyph;
}

export function LetterMarble({
  glyph,
  index,
  radius,
  pitch,
  materials,
  tone,
}: {
  glyph: string;
  index: number;
  radius: number;
  pitch: number;
  materials: Materials;
  tone: 'pending' | 'consumed' | 'head' | 'match';
}) {
  const ring =
    tone === 'match'
      ? materials.brass
      : tone === 'head'
        ? materials.tracks.vermilion
        : materials.tracks.cobalt;
  return (
    <group>
      <mesh castShadow material={materials.marble}>
        <sphereGeometry args={[radius, 24, 24]} />
      </mesh>
      {tone !== 'pending' && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -radius + 0.015, 0]} material={ring}>
          <torusGeometry args={[radius * 0.78, 0.016, 8, 24]} />
        </mesh>
      )}
      <Glyph
        text={letterGlyph(glyph)}
        position={[0, 0.02, radius + 0.012]}
        size={radius * 1.35}
        width={Math.max(0.16, pitch - 0.08)}
        color="#30362d"
      />
      <Glyph text={String(index)} position={[0, -radius - 0.05, radius]} size={0.07} color="#82745e" />
    </group>
  );
}

function LiveTileRail({
  input,
  unicode,
  metrics,
  materials,
  store,
  program,
}: {
  input: string;
  unicode: boolean;
  metrics: DisplayMetrics;
  materials: Materials;
  store: PlaybackStore;
  program: Program;
}) {
  const machineState = useStore(store, (s) => s.machine);
  const count = Math.min(24, Math.floor((metrics.boardWidth - 1) / 0.4));
  const tiles = visibleTiles(input, unicode, count);
  const pitch = Math.min(0.62, (metrics.boardWidth - 1) / Math.max(1, tiles.length));
  const radius = Math.min(0.17, Math.max(0.1, pitch * 0.36));
  const front = metrics.boardDepth / 2 - 0.27;
  const ghosts = useMemo(() => new Set(scoutTiles(scoutWindow(machineState))), [machineState]);
  const brackets = useMemo(() => captureBrackets(program, machineState), [program, machineState]);
  const span = useMemo(() => matchSpan(machineState), [machineState]);
  const xAt = (pos: number): number | null => {
    const i = tiles.findIndex((tile) => pos >= tile.index && pos < tile.index + tile.glyph.length);
    if (i < 0) return null;
    const frac = (pos - tiles[i].index) / tiles[i].glyph.length;
    return (i - (tiles.length - 1) / 2 - 0.5 + frac) * pitch;
  };
  return (
    <group>
      <mesh position={[0, 0.57, front - 0.1]} material={materials.tracks.edge} receiveShadow>
        <boxGeometry args={[Math.max(1.2, tiles.length * pitch + 0.16), 0.06, 0.54]} />
      </mesh>
      {tiles.map((tile, i) => {
        const status = tileStatus(machineState, tile.index);
        const lit = status !== 'pending';
        const isHead = status === 'head';
        const gold = span !== null && tile.index >= span.start && tile.index < span.end;
        return (
          <group key={tile.index} position={[(i - (tiles.length - 1) / 2) * pitch, 0.6 + radius, front]}>
            <LetterMarble
              glyph={tile.glyph}
              index={tile.index}
              radius={radius}
              pitch={pitch}
              materials={materials}
              tone={gold ? 'match' : isHead ? 'head' : lit ? 'consumed' : 'pending'}
            />
            {isHead && (
              <group position={[0, 0.2, 0.08]}>
                <mesh position={[0, 0.26, 0]} material={materials.brass} castShadow>
                  <cylinderGeometry args={[0.025, 0.025, 0.52, 8]} />
                </mesh>
                <mesh position={[0.14, 0.42, 0]} material={materials.tracks.vermilion} castShadow>
                  <boxGeometry args={[0.28, 0.16, 0.03]} />
                </mesh>
                <mesh
                  position={[0, 0.06, 0]}
                  rotation={[0, 0, Math.PI]}
                  material={materials.tracks.vermilion}
                >
                  <coneGeometry args={[0.1, 0.14, 4]} />
                </mesh>
              </group>
            )}
            {ghosts.has(tile.index) && (
              <mesh position={[0, 0.21, 0]} material={materials.tracks.scout}>
                <boxGeometry args={[pitch - 0.05, 0.07, 0.48]} />
              </mesh>
            )}
          </group>
        );
      })}
      {brackets.map((bracket) => {
        const start = xAt(bracket.start);
        const end = xAt(bracket.end);
        if (start === null || end === null || end <= start) return null;
        const center = (start + end) / 2;
        const length = end - start;
        return (
          <group key={bracket.group} position={[center, 1.1, front]}>
            <mesh material={materials.brass}>
              <boxGeometry args={[length, 0.035, 0.05]} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * (length / 2), -0.09, 0]}>
                <boxGeometry args={[0.035, 0.22, 0.05]} />
                <meshStandardMaterial color={bracket.color} roughness={0.45} metalness={0.25} />
              </mesh>
            ))}
            <Glyph
              text={bracket.name ?? String(bracket.group)}
              position={[0, 0.16, 0.02]}
              size={0.11}
              width={0.5}
              color={bracket.color}
            />
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
  program,
}: {
  input: string;
  unicode: boolean;
  metrics: DisplayMetrics;
  materials: Materials;
  store?: PlaybackStore;
  program: Program;
}) {
  const count = Math.min(24, Math.floor((metrics.boardWidth - 1) / 0.4));
  const tiles = visibleTiles(input, unicode, count);
  const pitch = Math.min(0.62, (metrics.boardWidth - 1) / Math.max(1, tiles.length));
  const radius = Math.min(0.17, Math.max(0.1, pitch * 0.36));
  const front = metrics.boardDepth / 2 - 0.27;
  if (store) {
    return (
      <LiveTileRail
        input={input}
        unicode={unicode}
        metrics={metrics}
        materials={materials}
        store={store}
        program={program}
      />
    );
  }
  return (
    <group>
      <mesh position={[0, 0.57, front - 0.1]} material={materials.tracks.edge} receiveShadow>
        <boxGeometry args={[Math.max(1.2, tiles.length * pitch + 0.16), 0.06, 0.54]} />
      </mesh>
      {tiles.map((tile, i) => (
        <group key={tile.index} position={[(i - (tiles.length - 1) / 2) * pitch, 0.6 + radius, front]}>
          <LetterMarble
            glyph={tile.glyph}
            index={tile.index}
            radius={radius}
            pitch={pitch}
            materials={materials}
            tone="pending"
          />
        </group>
      ))}
      {input.length > (tiles.at(-1)?.index ?? 0) + (tiles.at(-1)?.glyph.length ?? 0) && (
        <Glyph text="…" position={[metrics.boardWidth / 2 - 0.4, 0.72, front + 0.19]} size={0.21} />
      )}
    </group>
  );
}

export function Base({
  metrics,
  materials,
  label = copy.scene.base,
}: {
  metrics: DisplayMetrics;
  materials: Materials;
  label?: string;
}) {
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
        <mesh
          key={side}
          position={[side * (w / 2 - 0.5), 0.6, -d / 2 + 0.45]}
          material={materials.tracks.edge}
          castShadow
        >
          <boxGeometry args={[0.5, 0.2, 0.5]} />
        </mesh>
      ))}
      <RoundedBox
        args={[w - 0.7, h + 0.9, 0.16]}
        radius={0.06}
        smoothness={2}
        position={[0, 0.6 + (h + 0.9) / 2, -d / 2 + 0.45]}
        material={materials.backboard}
        castShadow
        receiveShadow
      />
      <mesh position={[0, h + 1.54, -d / 2 + 0.45]} material={materials.tracks.edge} castShadow>
        <boxGeometry args={[w - 0.6, 0.1, 0.26]} />
      </mesh>
      <mesh position={[0, 0.28, d / 2 + 0.018]} material={materials.brass}>
        <boxGeometry args={[Math.min(4.6, w * 0.7), 0.24, 0.03]} />
      </mesh>
      <Glyph text={label} position={[0, 0.29, d / 2 + 0.045]} size={0.115} width={Math.min(4.4, w * 0.68)} />
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
  metrics: given,
  flood = null,
  label,
}: {
  machine: MachineLayout;
  program: Program;
  input: string;
  materials: Materials;
  reducedMotion: boolean;
  onExpand: (id: number) => void;
  store?: PlaybackStore;
  metrics?: DisplayMetrics;
  flood?: { model: FloodModel; recorded: FlagEntry[] } | null;
  label?: string;
}) {
  const metrics = given ?? displayMetrics(machine, { flood: flood !== null });
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
      <Base metrics={metrics} materials={materials} label={label} />
      <group ref={building} position={[0, 0.6, 0]} scale={metrics.scale}>
        <group position={metrics.offset}>
          <Tracks machine={machine} materials={materials} />
          <Gates
            machine={machine}
            materials={materials}
            program={program}
            emphasis={Math.min(1.3, Math.max(1, 0.75 / metrics.scale))}
          />
          <Pieces
            machine={machine}
            program={program}
            materials={materials}
            onExpand={onExpand}
            animatedChoices={Boolean(store)}
          />
          {store && (
            <>
              <Marble
                store={store}
                machine={machine}
                materials={materials}
                emphasis={Math.min(1.3, Math.max(1, 0.75 / metrics.scale))}
              />
              <Carriage store={store} machine={machine} materials={materials} />
              {!flood && <Flags store={store} machine={machine} materials={materials} />}
              <Alternations program={program} store={store} machine={machine} materials={materials} />
              <Repeats program={program} store={store} machine={machine} materials={materials} />
              <GateLamps store={store} machine={machine} />
              <Scout store={store} machine={machine} materials={materials} />
              <Mirrors program={program} machine={machine} input={input} store={store} />
              <Celebration store={store} machine={machine} materials={materials} />
            </>
          )}
        </group>
      </group>
      {store && flood && (
        <Flood
          store={store}
          machine={machine}
          model={flood.model}
          recorded={flood.recorded}
          metrics={metrics}
          materials={materials}
          reducedMotion={reducedMotion}
        />
      )}
      <TileRail
        input={input}
        unicode={program.flags.unicode || program.flags.unicodeSets}
        metrics={metrics}
        materials={materials}
        store={store}
        program={program}
      />
    </group>
  );
}
