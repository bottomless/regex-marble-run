import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { useStore } from 'zustand';
import { MeshStandardMaterial } from 'three';
import type { Group, PointLight } from 'three';
import { copy, type ResultReading } from '../copy.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import { outcomeOf } from '../playback/outcome.ts';
import type { PlaybackStore } from '../playback/store.ts';
import { SIGN_RISE, type DisplayMetrics } from './geometry.ts';
import { palette, type Materials } from './materials.ts';
import Glyph from './Glyph.tsx';

type Settled = Exclude<ResultReading['kind'], 'pending'>;

const PULSE_S = 0.9;
const SIGN_TEXT_MAX = 14;
const TONE: Record<Settled, string> = {
  match: palette.teal,
  nomatch: palette.vermilion,
  gaveUp: palette.brass,
};

function outcomeKey(reading: ResultReading): string {
  return reading.kind === 'match' ? `match:${reading.start}:${reading.end}` : reading.kind;
}

function parseKey(key: string): ResultReading {
  if (!key.startsWith('match:')) return { kind: key } as ResultReading;
  const [, start, end] = key.split(':');
  return { kind: 'match', start: Number(start), end: Number(end) };
}

function useVerdict(store: PlaybackStore): ResultReading {
  const key = useStore(store, (s) => outcomeKey(outcomeOf(s)));
  return useMemo(() => parseKey(key), [key]);
}

/** Drives a 0→1 pulse whenever `key` settles on a new verdict; returns a ref to the live value. */
function usePulse(key: string, active: boolean, reducedMotion: boolean) {
  const started = useRef<number | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    started.current = active && !reducedMotion ? performance.now() : null;
    invalidate();
  }, [key, active, reducedMotion, invalidate]);
  return started;
}

function pulseAt(started: number | null): number {
  if (started === null) return 0;
  const t = (performance.now() - started) / 1000 / PULSE_S;
  if (t >= 1) return 0;
  return Math.sin(Math.PI * t) * (1 - t);
}

function clip(text: string): string {
  const flat = text.replace(/\s/g, '·');
  return flat.length > SIGN_TEXT_MAX ? `${flat.slice(0, SIGN_TEXT_MAX)}…` : flat;
}

/**
 * The scoreboard on top of the backboard: an unlit "DOES IT MATCH?" plate while the marble rolls, which lights
 * up green with the matched text, red for no match or amber when the engine gave up.
 */
export function VerdictSign({
  store,
  metrics,
  materials,
  input,
  reducedMotion,
}: {
  store: PlaybackStore;
  metrics: DisplayMetrics;
  materials: Materials;
  input: string;
  reducedMotion: boolean;
}) {
  const verdict = useVerdict(store);
  const settled: Settled | null = verdict.kind === 'pending' ? null : verdict.kind;
  const key = outcomeKey(verdict);
  const started = usePulse(key, settled !== null, reducedMotion);
  const panel = useRef<Group>(null);
  const face = useMemo(
    () =>
      settled
        ? new MeshStandardMaterial({
            color: TONE[settled],
            emissive: TONE[settled],
            emissiveIntensity: 0.35,
            roughness: 0.5,
          })
        : null,
    [settled],
  );
  const faceRef = useRef<MeshStandardMaterial | null>(null);
  useEffect(() => {
    faceRef.current = face;
    return () => face?.dispose();
  }, [face]);
  const canvas = useThree((s) => s.gl.domElement);
  useLayoutEffect(() => {
    canvas.setAttribute('data-verdict', verdict.kind);
    return () => canvas.removeAttribute('data-verdict');
  }, [canvas, verdict.kind]);
  useFrame((state) => {
    const pulse = pulseAt(started.current);
    if (panel.current) panel.current.scale.setScalar(1 + pulse * 0.14);
    if (faceRef.current) faceRef.current.emissiveIntensity = 0.35 + pulse * 0.9;
    if (started.current !== null && pulse > 0) state.invalidate();
  });
  const width = Math.min(5.4, Math.max(3.2, metrics.boardWidth * 0.5));
  const top = metrics.height + 1.6;
  const z = -metrics.boardDepth / 2 + 0.45;
  const text =
    verdict.kind === 'pending'
      ? copy.verdict.sign.pending
      : verdict.kind === 'match'
        ? copy.verdict.signMatch(clip(input.slice(verdict.start, verdict.end)))
        : copy.verdict.sign[verdict.kind];
  const panelY = SIGN_RISE / 2 + 0.12;
  return (
    <group position={[0, top, z]}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (width / 2 - 0.4), 0.1, 0]} material={materials.brass} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.24, 10]} />
        </mesh>
      ))}
      <group ref={panel} position={[0, panelY, 0]}>
        <RoundedBox
          args={[width, 0.66, 0.14]}
          radius={0.06}
          smoothness={2}
          material={face ?? materials.tracks.birch}
          castShadow
        />
        <mesh position={[0, 0, -0.01]} material={materials.tracks.edge}>
          <boxGeometry args={[width + 0.1, 0.76, 0.1]} />
        </mesh>
        <Glyph
          text={text}
          position={[0, 0, 0.08]}
          size={settled ? 0.3 : 0.24}
          width={width - 0.3}
          color={settled ? '#fcfaf4' : '#5d5243'}
        />
      </group>
    </group>
  );
}

/**
 * A pulse of light where the run ended: the success cup glows green on a match, the reject tray
 * glows red (with a NO MATCH plate) when nothing matched.
 */
export function VerdictGlow({
  store,
  machine,
  materials,
  reducedMotion,
}: {
  store: PlaybackStore;
  machine: MachineLayout;
  materials: Materials;
  reducedMotion: boolean;
}) {
  const verdict = useVerdict(store);
  const settled: Settled | null = verdict.kind === 'pending' ? null : verdict.kind;
  const key = outcomeKey(verdict);
  const started = usePulse(key, settled !== null, reducedMotion);
  const light = useRef<PointLight>(null);
  const target = useMemo(
    () =>
      settled === null
        ? null
        : (machine.pieces.find((piece) => piece.kind === (settled === 'match' ? 'cup' : 'rejectTray')) ??
          null),
    [machine, settled],
  );
  const rim = useMemo(
    () =>
      settled
        ? new MeshStandardMaterial({
            color: TONE[settled],
            emissive: TONE[settled],
            emissiveIntensity: 0.8,
            toneMapped: false,
          })
        : null,
    [settled],
  );
  const rimRef = useRef<MeshStandardMaterial | null>(null);
  useEffect(() => {
    rimRef.current = rim;
    return () => rim?.dispose();
  }, [rim]);
  useFrame((state) => {
    const pulse = pulseAt(started.current);
    if (light.current) light.current.intensity = 4 + pulse * 10;
    if (rimRef.current) rimRef.current.emissiveIntensity = 0.8 + pulse * 1.6;
    if (started.current !== null && pulse > 0) state.invalidate();
  });
  if (!settled || !target || !rim) return null;
  const p = target.position;
  const plate = settled === 'gaveUp' ? materials.brass : materials.tracks.vermilion;
  const cup = target.kind === 'cup';
  const w = cup ? 2.7 : 2.4;
  const d = cup ? 1.75 : 1.66;
  const y = cup ? -0.32 : -0.28;
  return (
    <group position={[p.x, p.y, p.z]}>
      <pointLight
        ref={light}
        color={TONE[settled]}
        intensity={4}
        distance={4}
        decay={2}
        position={[0, 1.1, 0.9]}
      />
      {[-1, 1].map((side) => (
        <mesh key={`gz-${side}`} position={[0, y, side * (d / 2)]} material={rim}>
          <boxGeometry args={[w + 0.08, 0.05, 0.08]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`gx-${side}`} position={[side * (w / 2), y, 0]} material={rim}>
          <boxGeometry args={[0.08, 0.05, d]} />
        </mesh>
      ))}
      {!cup && (
        <group position={[0, 1.15, 0.2]}>
          <mesh material={plate}>
            <boxGeometry args={[1.9, 0.36, 0.05]} />
          </mesh>
          <Glyph
            text={copy.verdict.sign[settled]}
            position={[0, 0, 0.04]}
            size={0.18}
            width={1.75}
            color="#fcfaf4"
          />
        </group>
      )}
    </group>
  );
}
