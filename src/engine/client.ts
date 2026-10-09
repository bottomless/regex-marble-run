import type { EngineRequest, EngineResponse, EngineResponseError } from './engine.worker.ts';

export type EngineClientInput = Omit<EngineRequest, 'id'>;

export interface EngineResponseCancelled {
  id: number;
  ok: false;
  cancelled: true;
}

export interface EngineClientWorker {
  onmessage: ((event: MessageEvent<EngineResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(request: EngineRequest): void;
  terminate(): void;
}

export type EngineWorkerFactory = () => EngineClientWorker;

export interface EngineClient {
  run(input: EngineClientInput): Promise<EngineResponse | EngineResponseCancelled>;
  cancel(): void;
  dispose(): void;
}

interface PendingRequest {
  id: number;
  worker: EngineClientWorker;
  resolve(result: EngineResponse | EngineResponseCancelled): void;
}

function createEngineWorker(): EngineClientWorker {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
}

function errorResult(id: number, error: unknown): EngineResponseError {
  return { id, ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
}

export function createEngineClient(workerFactory: EngineWorkerFactory = createEngineWorker): EngineClient {
  let nextId = 0;
  let active: PendingRequest | null = null;
  let disposed = false;

  function finish(pending: PendingRequest, result: EngineResponse | EngineResponseCancelled) {
    if (active !== pending) return;
    active = null;
    pending.worker.onmessage = null;
    pending.worker.onerror = null;
    pending.worker.onmessageerror = null;
    pending.worker.terminate();
    pending.resolve(result);
  }

  function cancel() {
    if (active) finish(active, { id: active.id, ok: false, cancelled: true });
  }

  return {
    run(input) {
      cancel();
      const id = ++nextId;
      if (disposed) return Promise.resolve(errorResult(id, 'Engine client has been disposed'));

      return new Promise<EngineResponse | EngineResponseCancelled>((resolve) => {
        let worker: EngineClientWorker;
        try {
          worker = workerFactory();
        } catch (error) {
          resolve(errorResult(id, error));
          return;
        }

        const pending: PendingRequest = { id, worker, resolve };
        active = pending;

        worker.onmessage = ({ data }) => {
          if (active !== pending || data.id !== id) return;
          finish(pending, data);
        };
        worker.onerror = (event) => {
          if (active !== pending) return;
          event.preventDefault();
          finish(pending, errorResult(id, event.message || 'Engine worker failed'));
        };
        worker.onmessageerror = () => {
          finish(pending, errorResult(id, 'Engine worker response could not be deserialized'));
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
