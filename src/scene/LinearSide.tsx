import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useStore } from 'zustand';
import { InstancedMesh, Object3D, SphereGeometry } from 'three';
import type { Program } from '../engine/ir.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import { copy } from '../copy.ts';
import { waterlineAt } from '../playback/counters.ts';
import { shouldFlood } from '../playback/flood.ts';
import { parallelMarbles, syncLinear, type LinearRun, type LinearSync } from '../playback/linear.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { visibleTiles, type DisplayMetrics } from './geometry.ts';
import type { Materials } from './materials.ts';
import { Base } from './Machine.tsx';
import Tracks from './Tracks.tsx';
import Gates from './Gates.tsx';
import Pieces from './Pieces.tsx';
import Glyph from './Glyph.tsx';

const MARBLE_RADIUS = 0.15;
const MARBLE_CAP = 256;
const SMOOTHING = 14;
const EMPTY_SYNC: LinearSync = { tick: null, finished: false };

/** The right-hand tick for the current left-hand playhead (store-driven, pure selection). */
export function useLinearSync(store: PlaybackStore, run: LinearRun | null): LinearSync {
  const eventIndex = useStore(store, (s) => s.eventIndex);
  const atEnd = useStore(store, (s) => s.atEnd);
  const counters = useStore(store, (s) => s.counters);
  const result = useStore(store, (s) => s.result);
  const trace = useStore(store, (s) => s.trace);
  return useMemo(() => {
    if (!run) return EMPTY_SYNC;
    const flooded = Boolean(result && trace && shouldFlood(result, trace));
    const waterline = counters ? waterlineAt(counters, eventIndex) : 0;
    return syncLinear(run, waterline, atEnd || flooded);
  }, [run, counters, eventIndex, atEnd, result, trace]);
}

interface Mover {
  x: number;
  y: number;
  z: number;
}

function ParallelMarbles({
  machine,
  sync,
  materials,
  reducedMotion,
}: {
  machine: MachineLayout;
  sync: LinearSync;
  materials: Materials;
  reducedMotion: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const canvas = useThree((state) => state.gl.domElement);
  const geometry = useMemo(() => new SphereGeometry(MARBLE_RADIUS, 20, 20), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const targets = useMemo(() => parallelMarbles(machine, sync.tick).slice(0, MARBLE_CAP), [machine, sync.tick]);
  const movers = useRef(new Map<number, Mover>());
  const dummy = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    const live = new Set(targets.map((t) => t.id));
    for (const id of [...movers.current.keys()]) if (!live.has(id)) movers.current.delete(id);
    for (const target of targets) {
      if (movers.current.has(target.id)) continue;
      const origin = movers.current.get(target.parent) ?? target.position;
      movers.current.set(target.id, reducedMotion ? { ...target.position } : { x: origin.x, y: origin.y, z: origin.z });
    }
    canvas.setAttribute('data-linear-marbles', String(targets.length));
    canvas.setAttribute('data-linear-pos', String(sync.tick?.pos ?? -1));
    canvas.setAttribute('data-linear-tick', String(sync.tick?.index ?? -1));
    canvas.setAttribute('data-linear-finished', String(sync.finished));
    invalidate();
    return () => {
      for (const name of ['data-linear-marbles', 'data-linear-pos', 'data-linear-tick', 'data-linear-finished']) {
        canvas.removeAttribute(name);
      }
    };
  }, [targets, sync, canvas, invalidate, reducedMotion]);

  useFrame((state, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const k = reducedMotion ? 1 : Math.min(1, delta * SMOOTHING);
    let moving = false;
    targets.forEach((target, i) => {
      const mover = movers.current.get(target.id)!;
      const dx = target.position.x - mover.x;
      const dy = target.position.y - mover.y;
      const dz = target.position.z - mover.z;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.002) {
        moving = true;
        mover.x += dx * k;
        mover.y += dy * k;
        mover.z += dz * k;
      } else {
        mover.x = target.position.x;
        mover.y = target.position.y;
        mover.z = target.position.z;
      }
      dummy.position.set(mover.x, mover.y, mover.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = targets.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (moving) state.invalidate();
  });

  return (
    <instancedMesh ref={ref} args={[geometry, materials.marble, MARBLE_CAP]} castShadow frustumCulled={false} />
  );
}

function LinearTileRail({
  input,
  unicode,
  metrics,
  materials,
  sync,
}: {
  input: string;
  unicode: boolean;
  metrics: DisplayMetrics;
  materials: Materials;
  sync: LinearSync;
}) {
  const count = Math.min(24, Math.floor((metrics.boardWidth - 1) / 0.4));
  const tiles = visibleTiles(input, unicode, count);
  const pitch = Math.min(0.49, (metrics.boardWidth - 1) / Math.max(1, tiles.length));
  const front = metrics.boardDepth / 2 - 0.27;
  const head = sync.tick?.pos ?? -1;
  return (
    <group>
      <mesh position={[0, 0.57, front - 0.1]} material={materials.tracks.edge} receiveShadow>
        <boxGeometry args={[Math.max(1.2, tiles.length * pitch + 0.16), 0.06, 0.48]} />
      </mesh>
      {tiles.map((tile, i) => {
        const consumed = head >= 0 && tile.index < head;
        const isHead = head >= 0 && tile.index <= head && head < tile.index + tile.glyph.length;
        return (
          <group key={tile.index} position={[(i - (tiles.length - 1) / 2) * pitch, 0.69, front]}>
            <RoundedBox
              args={[pitch - 0.035, 0.24, 0.38]}
              radius={0.03}
              smoothness={2}
              material={consumed ? materials.tracks.teal : materials.tracks.birch}
              castShadow
            />
            <Glyph
              text={tile.glyph === ' ' ? '·' : tile.glyph === '\n' ? '↵' : tile.glyph === '\t' ? '⇥' : tile.glyph}
              position={[0, 0.02, 0.2]}
              size={0.2}
              width={pitch - 0.06}
              color={consumed ? '#f4efe2' : '#30362d'}
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

/**
 * The linear-time half of the side-by-side view: the same machine, a tile rail whose head only moves
 * forward, and one instanced marble per live Pike thread. Threads born at a split start from their
 * parent's marble and glide to their own gate; merged and dead threads simply leave.
 */
export default function LinearSide({
  machine,
  program,
  input,
  materials,
  metrics,
  store,
  run,
  reducedMotion,
  onExpand,
}: {
  machine: MachineLayout;
  program: Program;
  input: string;
  materials: Materials;
  metrics: DisplayMetrics;
  store: PlaybackStore;
  run: LinearRun;
  reducedMotion: boolean;
  onExpand: (id: number) => void;
}) {
  const sync = useLinearSync(store, run);
  const [label] = useState(() => `${copy.split.right.toUpperCase()} · ${copy.split.rightEngines}`);
  return (
    <group>
      <Base metrics={metrics} materials={materials} label={label} />
      <group position={[0, 0.6, 0]} scale={metrics.scale}>
        <group position={metrics.offset}>
          <Tracks machine={machine} materials={materials} />
          <Gates machine={machine} materials={materials} program={program} />
          <Pieces machine={machine} program={program} materials={materials} onExpand={onExpand} />
          <ParallelMarbles machine={machine} sync={sync} materials={materials} reducedMotion={reducedMotion} />
        </group>
      </group>
      <LinearTileRail
        input={input}
        unicode={program.flags.unicode || program.flags.unicodeSets}
        metrics={metrics}
        materials={materials}
        sync={sync}
      />
    </group>
  );
}
