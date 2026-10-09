import type {
  NativeRequest,
  NativeResponse,
  NativeResponseError,
  NativeResponseSuccess,
} from './native.worker.ts';

export const NATIVE_TIMEOUT_MS = 3000;

export type NativeProbeInput = Omit<NativeRequest, 'id'>;

export type NativeProbeResult =
  | (NativeResponseSuccess & { status: 'success' })
  | (NativeResponseError & { status: 'error' })
  | { id: number; ok: false; status: 'timeout'; timeoutMs: number }
  | { id: number; ok: false; status: 'cancelled' };

export interface NativeProbeWorker {
  onmessage: ((event: MessageEvent<NativeResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(request: NativeRequest): void;
  terminate(): void;
}

export type NativeWorkerFactory = () => NativeProbeWorker;

export interface NativeProbe {
  run(input: NativeProbeInput): Promise<NativeProbeResult>;
  cancel(): void;
  dispose(): void;
}

interface PendingRequest {
  id: number;
  worker: NativeProbeWorker;
  timer: ReturnType<typeof setTimeout>;
  resolve(result: NativeProbeResult): void;
}

function createNativeWorker(): NativeProbeWorker {
  return new Worker(new URL('./native.worker.ts', import.meta.url), { type: 'module' });
}

function errorResult(id: number, error: unknown): NativeProbeResult {
  return { id, ok: false, status: 'error', error: error instanceof Error ? error.message : String(error) };
}

export function createNativeProbe(workerFactory: NativeWorkerFactory = createNativeWorker): NativeProbe {
  let nextId = 0;
  let active: PendingRequest | null = null;
  let disposed = false;

  function finish(pending: PendingRequest, result: NativeProbeResult) {
    if (active !== pending) return;
    active = null;
    clearTimeout(pending.timer);
    pending.worker.onmessage = null;
    pending.worker.onerror = null;
    pending.worker.onmessageerror = null;
    pending.worker.terminate();
    pending.resolve(result);
  }

  function cancel() {
    if (active) finish(active, { id: active.id, ok: false, status: 'cancelled' });
  }

  return {
    run(input) {
      cancel();
      const id = ++nextId;
      if (disposed) return Promise.resolve(errorResult(id, 'Native probe has been disposed'));

      return new Promise<NativeProbeResult>((resolve) => {
        let worker: NativeProbeWorker;
        try {
          worker = workerFactory();
        } catch (error) {
          resolve(errorResult(id, error));
          return;
        }

        const pending: PendingRequest = {
          id,
          worker,
          resolve,
          timer: setTimeout(() => {
            finish(pending, { id, ok: false, status: 'timeout', timeoutMs: NATIVE_TIMEOUT_MS });
          }, NATIVE_TIMEOUT_MS),
        };
        active = pending;

        worker.onmessage = ({ data }) => {
          if (data.id !== id) return;
          finish(pending, data.ok ? { ...data, status: 'success' } : { ...data, status: 'error' });
        };
        worker.onerror = (event) => {
          if (active !== pending) return;
          event.preventDefault();
          finish(pending, errorResult(id, event.message || 'Native worker failed'));
        };
        worker.onmessageerror = () => {
          finish(pending, errorResult(id, 'Native worker response could not be deserialized'));
        };

        try {
          worker.postMessage({ ...input, id });
        } catch (error) {
          finish(pending, errorResult(id, error));
        }
      });
    },
    cancel,
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
