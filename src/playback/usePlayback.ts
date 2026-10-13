import { useEffect, useRef, useState } from 'react';
import type { Program } from '../engine/ir.ts';
import { createEngineClient } from '../engine/client.ts';
import { copy } from '../copy.ts';
import { createNativeProbe } from '../engine/native.ts';
import type { MachineLayout } from '../layout/pieces.ts';
import { createPlaybackStore } from './store.ts';
import type { PlaybackStore } from './store.ts';
import { buildLinearRun, linearEligibility } from './linear.ts';

export type PlaybackStatus = 'idle' | 'running' | 'ready' | 'partial' | 'error';
export type ViewMode = 'single' | 'split';

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
  mode?: ViewMode;
}

interface Latest {
  program: Program;
  layout: MachineLayout | null;
  reducedMotion: boolean;
}

/**
 * Owns a single playback store for the workshop: runs the backtrack engine in a worker whenever the
 * pattern/flags/input change, loads the resulting trace into the store, and autoplays unless the user
 * prefers reduced motion. A separate native worker times the browser's own RegExp on the same input
 * and publishes the reading through `setNative`; a cancelled probe leaves the reading as `running`
 * until its replacement reports. Layout changes (module expansion) rebuild the timeline in place via
 * `setLayout` without re-running the engine.
 *
 * The engine client is created per run inside the effect and disposed in its cleanup, which is both
 * StrictMode-safe (each mount gets a live client) and leak-free (an in-flight worker is cancelled and
 * terminated when the input changes or the workshop unmounts).
 */
export function usePlaybackController(options: UsePlaybackOptions): PlaybackController {
  const { pattern, flags, input, program, layout, reducedMotion, mode = 'single' } = options;

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
    const probe = createNativeProbe();
    let live = true;
    store.getState().setNative({ status: 'running' });
    void probe.run({ pattern, flags, input }).then((result) => {
      if (!live) return;
      const { setNative } = store.getState();
      if (result.status === 'success') setNative({ status: 'success', elapsedMs: result.elapsedMs, matched: result.matched });
      else if (result.status === 'timeout') setNative({ status: 'timeout', timeoutMs: result.timeoutMs });
      else if (result.status === 'error') setNative({ status: 'error', error: result.error });
    });
    return () => {
      live = false;
      probe.dispose();
    };
  }, [store, pattern, flags, input]);

  useEffect(() => {
    const { setLinear } = store.getState();
    if (mode !== 'split') {
      setLinear({ status: 'off' });
      return;
    }
    const verdict = linearEligibility(program);
    if (!verdict.ok) {
      setLinear({ status: 'unavailable', message: verdict.message });
      return;
    }
    const client = createEngineClient();
    let live = true;
    setLinear({ status: 'running' });
    void client.run({ pattern, flags, input, engine: 'pike', trace: true, wallMs: RUN_BUDGET.wallMs, maxSteps: RUN_BUDGET.maxSteps }).then((response) => {
      if (!live) return;
      if (!response.ok) {
        if (!('cancelled' in response)) setLinear({ status: 'error', message: response.error.message });
        return;
      }
      if (response.engine !== 'pike') {
        setLinear({ status: 'error', message: copy.split.engineMismatch });
        return;
      }
      setLinear({ status: 'ready', run: buildLinearRun(program, response.trace, response.result) });
    });
    return () => {
      live = false;
      client.dispose();
    };
  }, [store, mode, program, pattern, flags, input]);

  useEffect(() => {
    if (layout && store.getState().trace) store.getState().setLayout(layout);
  }, [store, layout]);

  return { store, status };
}
