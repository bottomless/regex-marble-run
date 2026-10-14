import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from 'zustand';
import { Vector3 } from 'three';
import type { Group, Mesh } from 'three';
import type { MachineLayout, Vec3 } from '../layout/pieces.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { letterGlyph, visibleTiles } from './geometry.ts';
import type { Materials } from './materials.ts';
import Glyph from './Glyph.tsx';
import { Ride } from './ride.ts';
import {
  holdOffset,
  inletRoute,
  letterLands,
  letterTripAt,
  placeOnTrip,
  restOffset,
  spinePoints,
} from './letterTrip.ts';

const RADIUS = 0.18;
const LIFT = RADIUS - 0.02;
const HOLD = 8;
const REST = 18;
const WORLD_UP = new Vector3(0, 1, 0);

function pieceAt(machine: MachineLayout, kind: string): Vec3 | null {
  return machine.pieces.find((piece) => piece.kind === kind)?.position ?? null;
}

function spineFor(machine: MachineLayout, ride: Ride, destination: 'cup' | 'rejectTray'): Vec3[] {
  const ids = inletRoute(machine, destination);
  if (!ids || ids.length < 2) return ids ? spinePoints(machine, ids) : [];
  const curved = ride.points(ids);
  return curved.length >= 2 ? curved : spinePoints(machine, ids);
}

function shift(base: Vec3, offset: Vec3): Vec3 {
  return { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z };
}

function LetterMarble({
  glyph,
  materials,
  position,
}: {
  glyph: string;
  materials: Materials;
  position: [number, number, number];
}) {
  return (
    <group position={position}>
      <mesh castShadow material={materials.marble}>
        <sphereGeometry args={[RADIUS, 20, 20]} />
      </mesh>
      <Glyph
        text={letterGlyph(glyph)}
        position={[0, 0.02, RADIUS + 0.01]}
        size={0.15}
        width={0.28}
        color="#30362d"
      />
    </group>
  );
}

function Rider({
  store,
  count,
  index,
  glyph,
  spine,
  hold,
  rest,
  materials,
}: {
  store: PlaybackStore;
  count: number;
  index: number;
  glyph: string;
  spine: Vec3[];
  hold: Vec3;
  rest: Vec3;
  materials: Materials;
}) {
  const ref = useRef<Group>(null);
  const ball = useRef<Mesh>(null);
  const last = useRef<Vector3 | null>(null);
  useFrame(() => {
    const group = ref.current;
    if (!group) return;
    const { time, duration } = store.getState();
    const trip = letterTripAt(time, duration, count);
    if (trip.done || trip.index !== index) {
      group.visible = false;
      last.current = null;
      return;
    }
    const at = placeOnTrip(spine, trip.fraction, hold, rest, LIFT);
    group.visible = true;
    group.position.set(at.x, at.y, at.z);
    const sphere = ball.current;
    const previous = last.current;
    if (sphere && previous) {
      const step = new Vector3(at.x, at.y, at.z).sub(previous);
      const distance = step.length();
      if (distance > 1e-5 && distance < 2) {
        const axis = new Vector3().crossVectors(WORLD_UP, step.normalize());
        if (axis.lengthSq() > 1e-8) sphere.rotateOnWorldAxis(axis.normalize(), distance / RADIUS);
      }
    }
    last.current = previous ? previous.set(at.x, at.y, at.z) : new Vector3(at.x, at.y, at.z);
  });
  return (
    <group ref={ref} position={[hold.x, hold.y, hold.z]}>
      <mesh ref={ball} castShadow material={materials.marble}>
        <sphereGeometry args={[RADIUS, 24, 24]} />
      </mesh>
      <Glyph
        text={letterGlyph(glyph)}
        position={[0, 0.02, RADIUS + 0.01]}
        size={0.16}
        width={0.3}
        color="#30362d"
      />
      <pointLight color="#ffd9a8" intensity={3.4} distance={3.2} decay={2} position={[0, 0.55, 0.7]} />
    </group>
  );
}

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
  const tiles = useMemo(() => visibleTiles(input, unicode, input.length), [input, unicode]);
  const ride = useMemo(() => new Ride(machine), [machine]);
  const spines = useMemo(
    () => ({ cup: spineFor(machine, ride, 'cup'), rejectTray: spineFor(machine, ride, 'rejectTray') }),
    [machine, ride],
  );
  const hopper = pieceAt(machine, 'hopper');
  const cup = pieceAt(machine, 'cup');
  const reject = pieceAt(machine, 'rejectTray');
  const matched = useStore(store, (s) => s.result?.matched ?? false);
  const matchStart = useStore(store, (s) => (s.result?.matched ? s.result.index : -1));
  const matchEnd = useStore(store, (s) => (s.result?.matched ? s.result.end : -1));
  const lands = (index: number, length: number) => letterLands(matched, matchStart, matchEnd, index, length);
  const count = tiles.length;
  const opened = letterTripAt(store.getState().time, store.getState().duration, count);
  const openedActive = opened.done ? count : opened.index;
  const [active, setActive] = useState(openedActive);
  const [done, setDone] = useState(opened.done);
  const [tracked, setTracked] = useState(count);
  const seen = useRef({ active: openedActive, done: opened.done, count });
  if (tracked !== count) {
    setTracked(count);
    setActive(openedActive);
    setDone(opened.done);
  }
  useFrame(() => {
    if (seen.current.count !== count) seen.current = { active: -1, done: false, count };
    const { time, duration } = store.getState();
    const trip = letterTripAt(time, duration, count);
    const next = trip.done ? count : trip.index;
    if (next === seen.current.active && trip.done === seen.current.done) return;
    seen.current = { active: next, done: trip.done, count };
    setActive(next);
    setDone(trip.done);
  });
  if (!hopper || !cup || !reject || tiles.length === 0) return null;
  const head = done ? tiles.length : active;
  const waiting = tiles.slice(head + 1, head + 1 + HOLD);
  const finished = tiles.slice(0, Math.min(head, REST));
  const riding = done ? undefined : tiles[head];
  const ridingLands = riding ? lands(riding.index, riding.glyph.length) : 'rejectTray';
  let cupOrder = 0;
  let rejectOrder = 0;
  const ridingOrder = tiles.slice(0, head).reduce((order, tile) => {
    return lands(tile.index, tile.glyph.length) === ridingLands ? order + 1 : order;
  }, 0);
  const restAt = ridingLands === 'cup' ? cup : reject;

  return (
    <group>
      {waiting.map((tile, slot) => {
        const at = shift(hopper, holdOffset(slot + 1));
        return (
          <LetterMarble
            key={tile.index}
            glyph={tile.glyph}
            materials={materials}
            position={[at.x, at.y, at.z]}
          />
        );
      })}
      {finished.map((tile) => {
        const destination = lands(tile.index, tile.glyph.length);
        const order = destination === 'cup' ? cupOrder++ : rejectOrder++;
        const at = shift(destination === 'cup' ? cup : reject, restOffset(order, destination));
        return (
          <LetterMarble
            key={tile.index}
            glyph={tile.glyph}
            materials={materials}
            position={[at.x, at.y, at.z]}
          />
        );
      })}
      {riding && (
        <Rider
          key={`${riding.index}:${ridingLands}`}
          store={store}
          count={tiles.length}
          index={head}
          glyph={riding.glyph}
          spine={spines[ridingLands]}
          hold={shift(hopper, holdOffset(0))}
          rest={shift(restAt, restOffset(ridingOrder, ridingLands))}
          materials={materials}
        />
      )}
    </group>
  );
}
