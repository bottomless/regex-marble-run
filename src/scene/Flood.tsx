import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BoxGeometry, CylinderGeometry, DoubleSide, MeshPhysicalMaterial, Object3D, SphereGeometry } from 'three';
import type { InstancedMesh } from 'three';
import { useStore } from 'zustand';
import { copy } from '../copy.ts';
import type { MachineLayout, Piece } from '../layout/pieces.ts';
import { FLAG_PITCH } from '../playback/flags.ts';
import { flagColumns, floodAt, floodModel, tankMarblePositions, type FloodFrame, type FloodModel } from '../playback/flood.ts';
import type { FlagEntry } from '../playback/state.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { Hardware } from './Gates.tsx';
import Glyph from './Glyph.tsx';
import { roleFinish, type DisplayMetrics, type TrackFinish } from './geometry.ts';
import type { Materials } from './materials.ts';

export const FLOOD_SETTLE_SECONDS = 3;
const PROGRESS_BUCKETS = 20;
const EMPTY_FLAGS: FlagEntry[] = [];

interface FloodClock {
  model: FloodModel | null;
  progress: number;
  bucket: number;
}

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

function powerLabel(value: number): string {
  const exponent = Math.round(Math.log10(value));
  return `10${String(exponent).split('').map((d) => SUPERSCRIPT[Number(d)]).join('')}`;
}

/** The flood model for the loaded run, or null while the run is small enough for normal playback. */
export function useFloodModel(store: PlaybackStore): { model: FloodModel | null; recorded: FlagEntry[] } {
  const result = useStore(store, (s) => s.result);
  const trace = useStore(store, (s) => s.trace);
  const cursor = useStore(store, (s) => s.cursor);
  return useMemo(() => {
    const model = result && trace ? floodModel(result, trace) : null;
    const recorded = model && cursor && trace ? cursor.stateAt(trace.length).flags : EMPTY_FLAGS;
    return { model, recorded };
  }, [result, trace, cursor]);
}

function Tank({
  store,
  model,
  frame,
  metrics,
  materials,
  clock,
}: {
  store: PlaybackStore;
  model: FloodModel;
  frame: FloodFrame;
  metrics: DisplayMetrics;
  materials: Materials;
  clock: RefObject<FloodClock>;
}) {
  const tank = metrics.tank!;
  const native = useStore(store, (s) => s.native);
  const marblesRef = useRef<InstancedMesh>(null);
  const positions = useMemo(
    () => tankMarblePositions(model.marbles, model.level, tank),
    [model.marbles, model.level, tank],
  );
  const glass = useMemo(
    () =>
      new MeshPhysicalMaterial({
        color: '#dfe9ea',
        transparent: true,
        opacity: 0.22,
        roughness: 0.08,
        metalness: 0,
        side: DoubleSide,
        depthWrite: false,
      }),
    [],
  );
  const geometry = useMemo(() => new SphereGeometry(tank.radius, 8, 6), [tank.radius]);
  useEffect(() => () => glass.dispose(), [glass]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const mesh = marblesRef.current;
    if (!mesh) return;
    const object = new Object3D();
    for (let i = 0; i < model.marbles; i++) {
      object.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [positions, model.marbles]);

  useFrame(() => {
    const mesh = marblesRef.current;
    if (!mesh) return;
    mesh.count = clock.current.model === model ? floodAt(model, clock.current.progress).marbles : 0;
  });

  const wall = 0.03;
  const rim = tank.height + 0.04;
  return (
    <group position={[tank.x, 0.6, tank.z]}>
      <mesh position={[0, 0.02, 0]} material={materials.ink} receiveShadow>
        <boxGeometry args={[tank.width + 0.12, 0.04, tank.depth + 0.12]} />
      </mesh>
      <mesh position={[0, tank.height / 2, 0]} material={glass} renderOrder={3}>
        <boxGeometry args={[tank.width, tank.height, tank.depth]} />
      </mesh>
      <mesh position={[0, rim, 0]} material={materials.brass}>
        <boxGeometry args={[tank.width + 0.1, wall * 2, tank.depth + 0.1]} />
      </mesh>
      {model.graduations.map((mark) => (
        <group key={mark.value} position={[tank.width / 2 + 0.02, mark.level * tank.height, tank.depth / 2 + 0.02]}>
          <mesh material={materials.brass}>
            <boxGeometry args={[0.18, 0.016, 0.016]} />
          </mesh>
          <Glyph text={powerLabel(mark.value)} position={[0.34, 0.01, 0]} size={0.14} width={0.6} color="#5c5446" />
        </group>
      ))}
      <instancedMesh
        ref={marblesRef}
        key={model.marbles}
        args={[geometry, materials.marble, Math.max(1, model.marbles)]}
        castShadow={false}
        receiveShadow={false}
        frustumCulled={false}
      />
      <Glyph
        text={copy.flood.perMarble(model.perMarble)}
        position={[0, rim + 0.2, tank.depth / 2 + 0.12]}
        size={0.13}
        width={tank.width + 0.2}
        color="#34372f"
      />
      <Glyph
        text={copy.flood.backtracks(frame.backtracks)}
        position={[0, rim + 0.5, tank.depth / 2 + 0.12]}
        size={0.2}
        width={tank.width + 0.2}
        color="#b74730"
      />
      <Glyph
        text={copy.flood.steps(frame.step, model.gaveUp)}
        position={[0, rim + 0.8, tank.depth / 2 + 0.12]}
        size={0.13}
        width={tank.width + 0.2}
        color="#5c5446"
      />
      <Glyph
        text={copy.flood.native(native ?? { status: 'running' })}
        position={[0, rim + 1.06, tank.depth / 2 + 0.12]}
        size={0.13}
        width={tank.width + 0.2}
        color="#5c5446"
      />
    </group>
  );
}

function Columns({
  machine,
  recorded,
  depth,
  materials,
}: {
  machine: MachineLayout;
  recorded: FlagEntry[];
  depth: number;
  materials: Materials;
}) {
  const columns = useMemo(() => flagColumns(machine, recorded, depth), [machine, recorded, depth]);
  const canvas = useThree((state) => state.gl.domElement);
  const hardware = useMemo(() => {
    const pieces: Piece[] = [];
    for (const column of columns) {
      for (let level = 0; level < column.visible; level++) {
        pieces.push({
          kind: 'diverter',
          node: column.node,
          position: { x: column.position.x, y: column.position.y + level * FLAG_PITCH, z: column.position.z },
          size: { x: 0.4, y: 0.3, z: 0.06 },
          role: column.role,
        });
      }
    }
    const batches = new Map<TrackFinish, Piece[]>();
    for (const piece of pieces) {
      const finish = roleFinish(piece);
      const batch = batches.get(finish) ?? [];
      batch.push(piece);
      batches.set(finish, batch);
    }
    return { pieces, batches: [...batches] };
  }, [columns]);
  const geometry = useMemo(
    () => ({
      pole: new CylinderGeometry(0.025, 0.025, 0.3, 8),
      pennant: new BoxGeometry(0.4, 0.2, 0.06),
    }),
    [],
  );
  useEffect(() => () => Object.values(geometry).forEach((item) => item.dispose()), [geometry]);
  useLayoutEffect(() => {
    canvas.setAttribute('data-flood-columns', JSON.stringify(columns));
    return () => canvas.removeAttribute('data-flood-columns');
  }, [canvas, columns]);
  return (
    <group>
      <Hardware pieces={hardware.pieces} geometry={geometry.pole} material={materials.brass} offset={[0, 0.15, 0]} receiveShadow={false} />
      {hardware.batches.map(([finish, pieces]) => (
        <Hardware
          key={finish}
          pieces={pieces}
          geometry={geometry.pennant}
          material={materials.tracks[finish]}
          offset={[0.22, 0.18, 0]}
          receiveShadow={false}
        />
      ))}
      {columns.map((column) => (
        <Glyph
          key={column.column}
          text={copy.flood.column(column.depth)}
          position={[column.position.x + 0.22, column.position.y + column.visible * FLAG_PITCH + 0.12, column.position.z + 0.04]}
          size={0.2}
          width={1.2}
          color="#b74730"
        />
      ))}
    </group>
  );
}

/**
 * Flood presentation for catastrophic runs: a glass tank beside the machine collects sampled
 * backtrack marbles ("1 marble = N backtracks") against log-scaled graduations, and flag columns
 * grow on the diverters from the sampled stack depth. A short settle clock plays the run forward
 * once; reduced motion shows the settled state immediately.
 */
export default function Flood({
  store,
  machine,
  model,
  recorded,
  metrics,
  materials,
  reducedMotion,
}: {
  store: PlaybackStore;
  machine: MachineLayout;
  model: FloodModel;
  recorded: FlagEntry[];
  metrics: DisplayMetrics;
  materials: Materials;
  reducedMotion: boolean;
}) {
  const canvas = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const clock = useRef<FloodClock>({ model: null, progress: 0, bucket: -1 });
  const [frameState, setFrameState] = useState(() => ({ model, frame: floodAt(model, reducedMotion ? 1 : 0) }));
  let frame = frameState.frame;
  if (frameState.model !== model) {
    frame = floodAt(model, reducedMotion ? 1 : 0);
    setFrameState({ model, frame });
  }

  useFrame((state, delta) => {
    const c = clock.current;
    if (c.model !== model) {
      c.model = model;
      c.progress = reducedMotion ? 1 : 0;
      c.bucket = -1;
    }
    if (c.progress >= 1 && c.bucket >= PROGRESS_BUCKETS) return;
    c.progress = Math.min(1, c.progress + delta / FLOOD_SETTLE_SECONDS);
    const next = Math.floor(c.progress * PROGRESS_BUCKETS);
    if (next !== c.bucket) {
      c.bucket = next;
      setFrameState({ model, frame: floodAt(model, c.progress) });
    }
    state.invalidate();
  });

  const settled = frame.step >= model.steps;
  useLayoutEffect(() => {
    canvas.setAttribute('data-flood', 'true');
    canvas.setAttribute('data-flood-settled', String(settled));
    canvas.setAttribute('data-flood-per-marble', String(model.perMarble));
    canvas.setAttribute('data-flood-marbles', String(frame.marbles));
    canvas.setAttribute('data-flood-marble-cap', String(model.marbles));
    canvas.setAttribute('data-flood-backtracks', String(frame.backtracks));
    canvas.setAttribute('data-flood-steps', String(frame.step));
    canvas.setAttribute('data-flood-depth', String(frame.depth));
    canvas.setAttribute('data-flood-peak-depth', String(frame.peakDepth));
    canvas.setAttribute('data-flood-level', frame.level.toFixed(4));
    invalidate();
    return () => {
      for (const name of [
        'data-flood-settled',
        'data-flood-per-marble',
        'data-flood-marbles',
        'data-flood-marble-cap',
        'data-flood-backtracks',
        'data-flood-steps',
        'data-flood-depth',
        'data-flood-peak-depth',
        'data-flood-level',
      ]) {
        canvas.removeAttribute(name);
      }
      canvas.setAttribute('data-flood', 'false');
    };
  }, [canvas, invalidate, model, frame, settled]);

  if (!metrics.tank) return null;
  return (
    <group>
      <Tank store={store} model={model} frame={frame} metrics={metrics} materials={materials} clock={clock} />
      <group position={[0, 0.6, 0]} scale={metrics.scale}>
        <group position={metrics.offset}>
          <Columns machine={machine} recorded={recorded} depth={frame.peakDepth} materials={materials} />
        </group>
      </group>
    </group>
  );
}
