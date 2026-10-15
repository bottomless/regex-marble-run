import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import type { Group } from 'three';
import type { Program } from '../engine/ir.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { copy } from '../copy.ts';
import { displayMetrics } from './geometry.ts';
import type { DisplayMetrics } from './geometry.ts';
import type { Materials } from './materials.ts';
import Tracks, { LetterTracks } from './Tracks.tsx';
import Gates from './Gates.tsx';
import Pieces from './Pieces.tsx';
import Glyph from './Glyph.tsx';
import Marble from './Marble.tsx';
import InputFlow from './InputFlow.tsx';
import Flags from './Flags.tsx';
import Springs from './Springs.tsx';
import Alternations from './Alternations.tsx';
import Repeats from './Repeats.tsx';
import GateLamps from './GateLamps.tsx';
import Scout from './Scout.tsx';
import Mirrors from './Mirrors.tsx';
import Celebration from './Celebration.tsx';
import Flood from './Flood.tsx';
import { VerdictGlow, VerdictSign } from './Verdict.tsx';
import type { FloodModel } from '../playback/flood.ts';
import type { FlagEntry } from '../playback/state.ts';

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
      {store && (
        <VerdictSign
          store={store}
          metrics={metrics}
          materials={materials}
          input={input}
          reducedMotion={reducedMotion}
        />
      )}
      <group ref={building} position={[0, 0.6, 0]} scale={metrics.scale}>
        <group position={metrics.offset}>
          {input.length > 0 && !flood ? (
            store ? (
              <LetterTracks store={store} machine={machine} materials={materials} />
            ) : (
              <Tracks machine={machine} materials={materials} timeline={null} />
            )
          ) : (
            <Tracks machine={machine} materials={materials} />
          )}
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
            hideSample={input.length > 0}
          />
          {store && (
            <>
              <Marble
                store={store}
                machine={machine}
                materials={materials}
                emphasis={Math.min(1.3, Math.max(1, 0.75 / metrics.scale))}
                input={input}
                unicode={program.flags.unicode || program.flags.unicodeSets}
                showBody={Boolean(flood) || input.length === 0}
              />
              {!flood && (
                <InputFlow
                  store={store}
                  machine={machine}
                  input={input}
                  unicode={program.flags.unicode || program.flags.unicodeSets}
                  materials={materials}
                />
              )}
              <Springs
                store={store}
                machine={machine}
                materials={materials}
                hero={Boolean(flood) || input.length === 0}
                input={flood ? '' : input}
                unicode={program.flags.unicode || program.flags.unicodeSets}
                usedOnly={input.length > 0 && !flood}
              />
              {!flood && <Flags store={store} machine={machine} materials={materials} />}
              <Alternations program={program} store={store} machine={machine} materials={materials} />
              <Repeats program={program} store={store} machine={machine} materials={materials} />
              <GateLamps store={store} machine={machine} />
              <Scout store={store} machine={machine} materials={materials} />
              <Mirrors program={program} machine={machine} input={input} store={store} />
              <Celebration store={store} machine={machine} materials={materials} />
              <VerdictGlow
                store={store}
                machine={machine}
                materials={materials}
                reducedMotion={reducedMotion}
              />
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
    </group>
  );
}
