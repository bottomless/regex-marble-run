import { useEffect, useRef, useState } from 'react';
import type { Program } from '../engine/ir.ts';
import { createEngineClient } from '../engine/client.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import { createPlaybackStore } from './store.ts';
import type { PlaybackStore } from './store.ts';

export type PlaybackStatus = 'idle' | 'running' | 'ready' | 'partial' | 'error';

/** Budgets for the interactive run: bounded so an evil regex fails fast instead of grinding the worker. */
const RUN_BUDGET = { engine: 'backtrack', trace: true, wallMs: 2500, maxSteps: 20_000_000 } as const;

export interface PlaybackController {
  store: PlaybackStore;
  status: PlaybackStatus;
}

interface UsePlaybackOptions {
  pattern: string;
  flags: string;
  input: string;
  program: Program;
  layout: MachineLayout | null;
  reducedMotion: boolean;
}

interface Latest {
  program: Program;
  layout: MachineLayout | null;
  reducedMotion: boolean;
}

/**
 * Owns a single playback store for the workshop: runs the backtrack engine in a worker whenever the
 * pattern/flags/input change, loads the resulting trace into the store, and autoplays unless the user
 * prefers reduced motion. Layout changes (module expansion) rebuild the timeline in place via
 * `setLayout` without re-running the engine.
 *
 * The engine client is created per run inside the effect and disposed in its cleanup, which is both
 * StrictMode-safe (each mount gets a live client) and leak-free (an in-flight worker is cancelled and
 * terminated when the input changes or the workshop unmounts).
 */
export function usePlaybackController(options: UsePlaybackOptions): PlaybackController {
  const { pattern, flags, input, program, layout, reducedMotion } = options;

  const [store] = useState(createPlaybackStore);
  const [status, setStatus] = useState<PlaybackStatus>('idle');

  // Latest props for the async completion, without retriggering the engine run on layout/expansion changes.
  const latest = useRef<Latest>({ program, layout, reducedMotion });
  useEffect(() => {
    latest.current = { program, layout, reducedMotion };
  });

  useEffect(() => {
    const client = createEngineClient();
    let live = true;
    void client.run({ pattern, flags, input, ...RUN_BUDGET }).then((response) => {
      if (!live) return;
      if (!response.ok) {
        setStatus('cancelled' in response ? 'idle' : 'error');
        return;
      }
      if (response.engine !== 'backtrack') {
        setStatus('error');
        return;
      }
      const { program: prog, layout: currentLayout, reducedMotion: reduced } = latest.current;
      if (!currentLayout) {
        setStatus('idle');
        return;
      }
      store.getState().load({
        program: prog,
        trace: response.trace,
        layout: currentLayout,
        result: response.result,
      });
      if (!reduced) store.getState().play();
      setStatus(response.result.gaveUp || response.trace.truncated ? 'partial' : 'ready');
    });
    return () => {
      live = false;
      client.dispose();
    };
  }, [store, pattern, flags, input]);

  useEffect(() => {
    if (layout && store.getState().trace) store.getState().setLayout(layout);
  }, [store, layout]);

  return { store, status };
}
