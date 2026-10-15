import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from 'zustand';
import type { MachineLayout } from '../layout/pieces.ts';
import { flagColumns, floodAt, floodModel, type FloodModel } from '../playback/flood.ts';
import { finalFlags, type FlagEntry } from '../playback/state.ts';
import type { PlaybackStore } from '../playback/store.ts';
import type { DisplayMetrics } from './geometry.ts';
import type { Materials } from './materials.ts';

export const FLOOD_SETTLE_SECONDS = 3;
const PROGRESS_BUCKETS = 20;
const EMPTY_FLAGS: FlagEntry[] = [];

interface FloodClock {
  model: FloodModel | null;
  progress: number;
  bucket: number;
}

/** The flood model for the loaded run, or null while the run is small enough for normal playback. */
export function useFloodModel(store: PlaybackStore): { model: FloodModel | null; recorded: FlagEntry[] } {
  const result = useStore(store, (s) => s.result);
  const trace = useStore(store, (s) => s.trace);
  return useMemo(() => {
    const model = result && trace ? floodModel(result, trace) : null;
    const recorded = model && trace ? finalFlags(trace) : EMPTY_FLAGS;
    return { model, recorded };
  }, [result, trace]);
}

/**
 * Flood controller for catastrophic runs: drives the sampled settle clock for HUD counters and
 * canvas data attributes while live playback `<Flags>` and `<InputFlow>` animate the diverter
 * flags and letter marbles in sync with the transport.
 */
export default function Flood({
  store,
  machine,
  model,
  recorded,
  reducedMotion,
}: {
  store: PlaybackStore;
  machine: MachineLayout;
  model: FloodModel;
  recorded: FlagEntry[];
  metrics?: DisplayMetrics;
  materials?: Materials;
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
  const columns = useMemo(
    () => flagColumns(machine, recorded, frame.peakDepth),
    [machine, recorded, frame.peakDepth],
  );

  useFrame((state, delta) => {
    const c = clock.current;
    if (c.model !== model) {
      c.model = model;
      c.progress = reducedMotion ? 1 : 0;
      c.bucket = -1;
    }
    if (c.progress >= 1 && c.bucket >= PROGRESS_BUCKETS) return;
    c.progress = Math.min(1, c.progress + Math.min(delta, 0.05) / FLOOD_SETTLE_SECONDS);
    const next = Math.floor(c.progress * PROGRESS_BUCKETS);
    if (next !== c.bucket) {
      c.bucket = next;
      setFrameState({ model, frame: floodAt(model, c.progress) });
    }
    state.invalidate();
  });

  const settled = frame.step >= model.steps;
  useEffect(() => {
    store.getState().setFlood(frame);
  }, [store, frame]);
  useEffect(() => () => store.getState().setFlood(null), [store]);
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
    canvas.setAttribute('data-flood-columns', JSON.stringify(columns));
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
        'data-flood-columns',
      ]) {
        canvas.removeAttribute(name);
      }
      canvas.setAttribute('data-flood', 'false');
    };
  }, [canvas, invalidate, model, frame, settled, columns]);

  return null;
}
