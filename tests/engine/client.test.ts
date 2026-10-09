import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineClient } from '../../src/engine/client.ts';
import type {
  EngineClient,
  EngineClientInput,
  EngineClientWorker,
  EngineWorkerFactory,
} from '../../src/engine/client.ts';
import type {
  EngineRequest,
  EngineResponse,
  EngineResponseError,
  EngineResponsePikeSuccess,
  EngineResponseSuccess,
} from '../../src/engine/engine.worker.ts';

class FakeWorker implements EngineClientWorker {
  onmessage: EngineClientWorker['onmessage'] = null;
  onerror: EngineClientWorker['onerror'] = null;
  onmessageerror: EngineClientWorker['onmessageerror'] = null;
  postMessage = vi.fn<(request: EngineRequest) => void>();
  terminate = vi.fn<() => void>();

  message(response: EngineResponse) {
    this.onmessage?.(messageEvent(response));
  }

  error(message: string) {
    const event = { message, preventDefault: vi.fn() };
    this.onerror?.(event as unknown as ErrorEvent);
    return event;
  }
}

function messageEvent<T>(data: T): MessageEvent<T> {
  return { data } as MessageEvent<T>;
}

function success(
  id: number,
  engine: 'backtrack' | 'pike' = 'backtrack',
): EngineResponseSuccess | EngineResponsePikeSuccess {
  const root: EngineResponseSuccess['ir']['root'] = { kind: 'empty', id: 0, span: [0, 0] };
  const base = {
    id,
    ok: true as const,
    ir: {
      source: '',
      flagsText: '',
      flags: {
        ignoreCase: false,
        multiline: false,
        dotAll: false,
        unicode: false,
        unicodeSets: false,
        global: false,
        sticky: false,
        hasIndices: false,
      },
      root,
      nodes: [root],
      groupCount: 0,
      groupNames: [null],
      testers: [],
      probes: [],
      hasBackrefs: false,
      hasLookaround: false,
      leafCount: 0,
    },
    result: {
      matched: true,
      index: 0,
      end: 0,
      groups: [''],
      namedGroups: null,
      steps: 1,
      attempts: 1,
      truncated: false,
      gaveUp: false,
      elapsedMs: 1.25,
    },
  };
  if (engine === 'pike') {
    return {
      ...base,
      engine,
      result: { ...base.result, maxThreads: 1 },
      trace: {
        length: 0,
        t: new Uint8Array(),
        positions: new Int32Array(),
        threads: new Int32Array(),
        others: new Int32Array(),
        nodes: new Int32Array(),
        pcs: new Int32Array(),
        starts: new Int32Array(),
        truncated: false,
      },
    };
  }
  return {
    ...base,
    engine,
    result: { ...base.result, backtracks: 0, maxDepth: 0 },
    trace: {
      length: 0,
      t: new Uint8Array(),
      a: new Int32Array(),
      b: new Int32Array(),
      c: new Int32Array(),
      d: new Int32Array(),
      checkpoints: new Int32Array(),
      checkpointCount: 0,
      truncated: false,
    },
  };
}

const input: EngineClientInput = { pattern: '', flags: '', input: '' };
let clients: EngineClient[];

function makeClient(factory?: EngineWorkerFactory) {
  const client = createEngineClient(factory);
  clients.push(client);
  return client;
}

function expectClean(worker: FakeWorker) {
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  clients = [];
});

afterEach(() => {
  for (const client of clients) client.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('engine client lifecycle', () => {
  it('does not import the worker runtime on the main thread', async () => {
    const scope = { onmessage: vi.fn() };
    const handler = scope.onmessage;
    vi.stubGlobal('self', scope);
    vi.resetModules();

    await import('../../src/engine/client.ts');

    expect(scope.onmessage).toBe(handler);
  });

  it('creates a module worker by default and sends an identified request', async () => {
    const worker = new FakeWorker();
    const constructor = vi.fn(function (_url: URL, _options: WorkerOptions) {
      return worker;
    });
    vi.stubGlobal('Worker', constructor);
    const client = makeClient();
    const result = client.run(input);
    const response = success(1);

    expect(constructor).toHaveBeenCalledExactlyOnceWith(
      new URL('../../src/engine/engine.worker.ts', import.meta.url),
      { type: 'module' },
    );
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ ...input, id: 1 });
    worker.message(response);
    await expect(result).resolves.toBe(response);
    expectClean(worker);
  });

  it.each(['backtrack', 'pike'] as const)(
    'returns %s results unchanged and terminates completed workers',
    async (engine) => {
      const worker = new FakeWorker();
      const client = makeClient(() => worker);
      const request: EngineClientInput = {
        ...input,
        engine,
        maxSteps: 50,
        wallMs: 100,
        traceBudget: 10,
        trace: false,
      };
      const result = client.run(request);
      const response = success(1, engine);

      expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ ...request, id: 1 });
      worker.message(response);

      await expect(result).resolves.toBe(response);
      expectClean(worker);
    },
  );

  it('relies on engine budgets without scheduling a main-thread watchdog', async () => {
    const worker = new FakeWorker();
    const client = makeClient(() => worker);
    const result = client.run({ ...input, maxSteps: 50, wallMs: 1 });
    const settled = vi.fn();
    void result.then(settled);

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();

    client.cancel();
    await expect(result).resolves.toEqual({ id: 1, ok: false, cancelled: true });
    expectClean(worker);
  });

  it('preserves engine error details and cleans up', async () => {
    const worker = new FakeWorker();
    const client = makeClient(() => worker);
    const result = client.run({ ...input, pattern: '(?=a)', engine: 'pike' });
    const response: EngineResponseError = {
      id: 1,
      ok: false,
      error: { message: 'Unsupported lookaround', index: 0, end: 6, unsupported: true },
    };

    worker.message(response);

    await expect(result).resolves.toBe(response);
    expectClean(worker);
  });

  it.each(['Worker crashed', ''])('handles worker runtime errors %j', async (message) => {
    const worker = new FakeWorker();
    const client = makeClient(() => worker);
    const result = client.run(input);

    const event = worker.error(message);

    await expect(result).resolves.toEqual({
      id: 1,
      ok: false,
      error: { message: message || 'Engine worker failed' },
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expectClean(worker);
  });

  it('handles response deserialization errors and cleans up', async () => {
    const worker = new FakeWorker();
    const client = makeClient(() => worker);
    const result = client.run(input);

    worker.onmessageerror?.(messageEvent(null));

    await expect(result).resolves.toEqual({
      id: 1,
      ok: false,
      error: { message: 'Engine worker response could not be deserialized' },
    });
    expectClean(worker);
  });

  it.each([new Error('Worker unavailable'), 'Worker unavailable'])(
    'reports construction failures %j and can retry with the next id',
    async (error) => {
      const worker = new FakeWorker();
      const factory = vi.fn<EngineWorkerFactory>();
      factory.mockImplementationOnce(() => {
        throw error;
      });
      factory.mockReturnValueOnce(worker);
      const client = makeClient(factory);

      await expect(client.run(input)).resolves.toEqual({
        id: 1,
        ok: false,
        error: { message: 'Worker unavailable' },
      });
      expect(vi.getTimerCount()).toBe(0);
      const result = client.run(input);
      expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ ...input, id: 2 });
      worker.message(success(2));
      await expect(result).resolves.toEqual(success(2));
      expectClean(worker);
    },
  );

  it.each([new Error('Cannot post request'), 'Cannot post request'])(
    'cleans up when postMessage throws %j and permits another run',
    async (error) => {
      const first = new FakeWorker();
      const second = new FakeWorker();
      first.postMessage.mockImplementation(() => {
        throw error;
      });
      const factory = vi.fn<EngineWorkerFactory>().mockReturnValueOnce(first).mockReturnValueOnce(second);
      const client = makeClient(factory);

      await expect(client.run(input)).resolves.toEqual({
        id: 1,
        ok: false,
        error: { message: 'Cannot post request' },
      });
      expectClean(first);
      const result = client.run(input);
      second.message(success(2));
      await expect(result).resolves.toEqual(success(2));
      expectClean(second);
    },
  );

  it('cancels synchronously by termination, is idempotent, and permits another run', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const factory = vi.fn<EngineWorkerFactory>().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const client = makeClient(factory);
    client.cancel();
    const cancelled = client.run(input);

    client.cancel();
    client.cancel();

    expectClean(first);
    expect(first.postMessage).toHaveBeenCalledExactlyOnceWith({ ...input, id: 1 });
    await expect(cancelled).resolves.toEqual({ id: 1, ok: false, cancelled: true });
    const result = client.run(input);
    expect(second.postMessage).toHaveBeenCalledExactlyOnceWith({ ...input, id: 2 });
    second.message(success(2));
    await expect(result).resolves.toEqual(success(2));
    expectClean(second);
  });

  it.each([
    { ...input, input: 'new input' },
    { ...input, pattern: 'dog' },
    { ...input, flags: 'i' },
    { ...input, engine: 'pike' as const },
    input,
  ])('terminates the prior worker before calling the replacement factory for %j', async (nextInput) => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const factory = vi
      .fn<EngineWorkerFactory>()
      .mockReturnValueOnce(first)
      .mockImplementationOnce(() => {
        expectClean(first);
        expect(first.postMessage).toHaveBeenCalledExactlyOnceWith({ ...input, id: 1 });
        return second;
      });
    const client = makeClient(factory);
    const cancelled = client.run(input);

    const result = client.run(nextInput);

    await expect(cancelled).resolves.toEqual({ id: 1, ok: false, cancelled: true });
    expect(second.postMessage).toHaveBeenCalledExactlyOnceWith({ ...nextInput, id: 2 });
    second.message(success(2, nextInput.engine));
    await expect(result).resolves.toEqual(success(2, nextInput.engine));
    expectClean(second);
  });

  it('still cancels the previous run when the replacement factory throws', async () => {
    const worker = new FakeWorker();
    const factory = vi
      .fn<EngineWorkerFactory>()
      .mockReturnValueOnce(worker)
      .mockImplementationOnce(() => {
        expectClean(worker);
        throw new Error('Replacement unavailable');
      });
    const client = makeClient(factory);
    const cancelled = client.run(input);

    await expect(client.run(input)).resolves.toEqual({
      id: 2,
      ok: false,
      error: { message: 'Replacement unavailable' },
    });
    await expect(cancelled).resolves.toEqual({ id: 1, ok: false, cancelled: true });
    expectClean(worker);
  });

  it('ignores mismatched response ids until the matching response arrives', async () => {
    const worker = new FakeWorker();
    const client = makeClient(() => worker);
    const result = client.run(input);
    const settled = vi.fn();
    void result.then(settled);

    worker.message(success(0));
    worker.message({ id: 2, ok: false, error: { message: 'Stale error' } });
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.message(success(1));
    await expect(result).resolves.toEqual(success(1));
    expectClean(worker);
  });

  it('ignores queued messages and errors from a replaced worker, including the new id', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const factory = vi.fn<EngineWorkerFactory>().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const client = makeClient(factory);
    const cancelled = client.run(input);
    const staleMessage = first.onmessage;
    const staleError = first.onerror;
    const staleMessageError = first.onmessageerror;
    const result = client.run(input);
    const settled = vi.fn();
    void result.then(settled);
    const error = { message: 'Stale crash', preventDefault: vi.fn() };

    staleMessage?.(messageEvent(success(1)));
    staleMessage?.(messageEvent(success(2)));
    staleError?.(error as unknown as ErrorEvent);
    staleMessageError?.(messageEvent(null));
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    expect(error.preventDefault).not.toHaveBeenCalled();
    expectClean(first);
    expect(second.terminate).not.toHaveBeenCalled();
    await expect(cancelled).resolves.toEqual({ id: 1, ok: false, cancelled: true });
    second.message(success(2));
    await expect(result).resolves.toEqual(success(2));
    expectClean(second);
  });

  it('uses fresh workers on repeated runs and ignores duplicate callbacks after completion', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const factory = vi.fn<EngineWorkerFactory>().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const client = makeClient(factory);
    const completed = client.run(input);
    const lateMessage = first.onmessage;
    first.message(success(1));
    await expect(completed).resolves.toEqual(success(1));
    expectClean(first);
    const result = client.run(input);
    const settled = vi.fn();
    void result.then(settled);

    lateMessage?.(messageEvent(success(1)));
    lateMessage?.(messageEvent(success(2)));
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    expectClean(first);
    expect(second.postMessage).toHaveBeenCalledExactlyOnceWith({ ...input, id: 2 });
    expect(second.terminate).not.toHaveBeenCalled();
    second.message(success(2));
    await expect(result).resolves.toEqual(success(2));
    client.cancel();
    client.dispose();
    expectClean(second);
  });

  it('handles a response delivered synchronously during postMessage', async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(({ id }) => worker.message(success(id)));
    const client = makeClient(() => worker);

    await expect(client.run(input)).resolves.toEqual(success(1));
    expectClean(worker);
  });

  it('disposes an active request, ignores queued completion, and prevents future workers', async () => {
    const worker = new FakeWorker();
    const factory = vi.fn<EngineWorkerFactory>().mockReturnValue(worker);
    const client = makeClient(factory);
    const result = client.run(input);
    const lateMessage = worker.onmessage;

    client.dispose();
    client.dispose();
    client.cancel();
    lateMessage?.(messageEvent(success(1)));

    await expect(result).resolves.toEqual({ id: 1, ok: false, cancelled: true });
    expectClean(worker);
    for (const id of [2, 3]) {
      await expect(client.run(input)).resolves.toEqual({
        id,
        ok: false,
        error: { message: 'Engine client has been disposed' },
      });
    }
    expect(factory).toHaveBeenCalledTimes(1);
    expectClean(worker);
  });

  it('disposes before any run without creating workers', async () => {
    const factory = vi.fn<EngineWorkerFactory>();
    const client = makeClient(factory);

    client.dispose();

    await expect(client.run(input)).resolves.toEqual({
      id: 1,
      ok: false,
      error: { message: 'Engine client has been disposed' },
    });
    expect(factory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
