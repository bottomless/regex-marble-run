import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeProbe, NATIVE_TIMEOUT_MS } from '../../src/engine/native.ts';
import type {
  NativeProbe,
  NativeProbeInput,
  NativeProbeWorker,
  NativeWorkerFactory,
} from '../../src/engine/native.ts';
import type { NativeRequest, NativeResponse, NativeResponseSuccess } from '../../src/engine/native.worker.ts';

class FakeWorker implements NativeProbeWorker {
  onmessage: NativeProbeWorker['onmessage'] = null;
  onerror: NativeProbeWorker['onerror'] = null;
  onmessageerror: NativeProbeWorker['onmessageerror'] = null;
  postMessage = vi.fn<(request: NativeRequest) => void>();
  terminate = vi.fn<() => void>();

  message(response: NativeResponse) {
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

function success(id: number, overrides: Partial<NativeResponseSuccess> = {}): NativeResponseSuccess {
  return { id, ok: true, matched: true, index: 4, length: 3, elapsedMs: 1.25, ...overrides };
}

const input: NativeProbeInput = { pattern: 'cat', flags: '', input: 'the cat' };
let probes: NativeProbe[];

function makeProbe(factory?: NativeWorkerFactory) {
  const probe = createNativeProbe(factory);
  probes.push(probe);
  return probe;
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
  probes = [];
});

afterEach(() => {
  for (const probe of probes) probe.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('native probe lifecycle', () => {
  it('creates a Vite module worker by default and sends an identified request', async () => {
    const worker = new FakeWorker();
    const constructor = vi.fn(function (_url: URL, _options: WorkerOptions) {
      return worker;
    });
    vi.stubGlobal('Worker', constructor);
    const probe = makeProbe();
    const result = probe.run(input);

    expect(constructor).toHaveBeenCalledExactlyOnceWith(
      new URL('../../src/engine/native.worker.ts', import.meta.url),
      { type: 'module' },
    );
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ ...input, id: 1 });
    worker.message(success(1));
    await expect(result).resolves.toEqual({ ...success(1), status: 'success' });
    expectClean(worker);
  });

  it.each([
    { matched: true, index: 4, length: 3 },
    { matched: false, index: -1, length: 0 },
    { matched: true, index: 0, length: 0 },
  ])('returns native timing and match span unchanged for %j', async (span) => {
    const worker = new FakeWorker();
    const probe = makeProbe(() => worker);
    const result = probe.run(input);
    const response = success(1, span);

    worker.message(response);

    await expect(result).resolves.toEqual({ ...response, status: 'success' });
    expectClean(worker);
    vi.advanceTimersByTime(10_000);
    expectClean(worker);
  });

  it('hard terminates at exactly 3000 ms, not at 2999 ms', async () => {
    const worker = new FakeWorker();
    const probe = makeProbe(() => worker);
    const result = probe.run(input);
    const settled = vi.fn();
    void result.then(settled);

    expect(NATIVE_TIMEOUT_MS).toBe(3000);
    await vi.advanceTimersByTimeAsync(2999);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ id: 1, ok: false, status: 'timeout', timeoutMs: 3000 });
    expect(settled).toHaveBeenCalledTimes(1);
    expectClean(worker);
  });

  it('clears the watchdog when a result arrives just before the deadline', async () => {
    const worker = new FakeWorker();
    const probe = makeProbe(() => worker);
    const result = probe.run(input);
    vi.advanceTimersByTime(2999);

    worker.message(success(1));
    vi.advanceTimersByTime(1);

    await expect(result).resolves.toEqual({ ...success(1), status: 'success' });
    expectClean(worker);
  });

  it('returns native regex errors and releases the worker', async () => {
    const worker = new FakeWorker();
    const probe = makeProbe(() => worker);
    const result = probe.run({ ...input, pattern: '[' });

    worker.message({ id: 1, ok: false, error: 'Invalid regular expression' });

    await expect(result).resolves.toEqual({
      id: 1,
      ok: false,
      status: 'error',
      error: 'Invalid regular expression',
    });
    expectClean(worker);
  });

  it.each(['Worker crashed', ''])('handles worker runtime errors %j', async (message) => {
    const worker = new FakeWorker();
    const probe = makeProbe(() => worker);
    const result = probe.run(input);

    const event = worker.error(message);

    await expect(result).resolves.toEqual({
      id: 1,
      ok: false,
      status: 'error',
      error: message || 'Native worker failed',
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expectClean(worker);
  });

  it('handles deserialization errors and releases the worker', async () => {
    const worker = new FakeWorker();
    const probe = makeProbe(() => worker);
    const result = probe.run(input);

    worker.onmessageerror?.(messageEvent(null));

    await expect(result).resolves.toEqual({
      id: 1,
      ok: false,
      status: 'error',
      error: 'Native worker response could not be deserialized',
    });
    expectClean(worker);
  });

  it('reports worker creation failures without leaving a watchdog and can retry', async () => {
    const worker = new FakeWorker();
    const factory = vi.fn<NativeWorkerFactory>();
    factory.mockImplementationOnce(() => {
      throw new Error('Worker unavailable');
    });
    factory.mockReturnValueOnce(worker);
    const probe = makeProbe(factory);

    await expect(probe.run(input)).resolves.toEqual({
      id: 1,
      ok: false,
      status: 'error',
      error: 'Worker unavailable',
    });
    expect(vi.getTimerCount()).toBe(0);
    const result = probe.run(input);
    worker.message(success(2));
    await expect(result).resolves.toEqual({ ...success(2), status: 'success' });
    expectClean(worker);
  });

  it.each([new Error('Cannot post request'), 'Cannot post request'])(
    'cleans up when postMessage throws %j',
    async (error) => {
      const worker = new FakeWorker();
      worker.postMessage.mockImplementation(() => {
        throw error;
      });
      const probe = makeProbe(() => worker);

      await expect(probe.run(input)).resolves.toEqual({
        id: 1,
        ok: false,
        status: 'error',
        error: 'Cannot post request',
      });
      expectClean(worker);
    },
  );

  it('cancels synchronously, is idempotent, and allows another run', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const factory = vi.fn<NativeWorkerFactory>().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const probe = makeProbe(factory);
    probe.cancel();
    const cancelled = probe.run(input);

    probe.cancel();
    probe.cancel();

    expectClean(first);
    await expect(cancelled).resolves.toEqual({ id: 1, ok: false, status: 'cancelled' });
    const result = probe.run(input);
    expect(second.postMessage).toHaveBeenCalledExactlyOnceWith({ ...input, id: 2 });
    second.message(success(2));
    await expect(result).resolves.toEqual({ ...success(2), status: 'success' });
    expectClean(second);
  });

  it.each([{ ...input, input: 'new input' }, { ...input, pattern: 'dog' }, { ...input, flags: 'i' }, input])(
    'cancels the prior worker before starting a replacement request %j',
    async (nextInput) => {
      const first = new FakeWorker();
      const second = new FakeWorker();
      const factory = vi
        .fn<NativeWorkerFactory>()
        .mockReturnValueOnce(first)
        .mockImplementationOnce(() => {
          expectClean(first);
          return second;
        });
      const probe = makeProbe(factory);
      const cancelled = probe.run(input);
      vi.advanceTimersByTime(2000);

      const result = probe.run(nextInput);

      await expect(cancelled).resolves.toEqual({ id: 1, ok: false, status: 'cancelled' });
      expect(second.postMessage).toHaveBeenCalledExactlyOnceWith({ ...nextInput, id: 2 });
      vi.advanceTimersByTime(1000);
      expect(second.terminate).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      second.message(success(2));
      await expect(result).resolves.toEqual({ ...success(2), status: 'success' });
      expectClean(second);
    },
  );

  it('ignores mismatched response ids until the matching response arrives', async () => {
    const worker = new FakeWorker();
    const probe = makeProbe(() => worker);
    const result = probe.run(input);

    worker.message(success(0));
    worker.message({ id: 2, ok: false, error: 'Stale error' });

    expect(worker.terminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    worker.message(success(1));
    await expect(result).resolves.toEqual({ ...success(1), status: 'success' });
    expectClean(worker);
  });

  it('ignores queued messages and errors from a replaced worker, even with the new id', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const factory = vi.fn<NativeWorkerFactory>().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const probe = makeProbe(factory);
    const cancelled = probe.run(input);
    const staleMessage = first.onmessage;
    const staleError = first.onerror;
    const staleMessageError = first.onmessageerror;
    const result = probe.run({ ...input, input: 'new input' });
    const settled = vi.fn();
    void result.then(settled);

    staleMessage?.(messageEvent(success(1)));
    staleMessage?.(messageEvent(success(2)));
    staleError?.({ message: 'Stale crash', preventDefault: vi.fn() } as unknown as ErrorEvent);
    staleMessageError?.(messageEvent(null));
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(second.terminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await expect(cancelled).resolves.toEqual({ id: 1, ok: false, status: 'cancelled' });
    second.message(success(2));
    await expect(result).resolves.toEqual({ ...success(2), status: 'success' });
    expectClean(second);
  });

  it('ignores late completion after timeout and starts the next run with a fresh worker', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const factory = vi.fn<NativeWorkerFactory>().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const probe = makeProbe(factory);
    const timedOut = probe.run(input);
    const lateMessage = first.onmessage;
    const settled = vi.fn();
    void timedOut.then(settled);
    await vi.advanceTimersByTimeAsync(3000);
    expectClean(first);
    const result = probe.run(input);

    lateMessage?.(messageEvent(success(1)));
    lateMessage?.(messageEvent(success(2)));

    await expect(timedOut).resolves.toEqual({ id: 1, ok: false, status: 'timeout', timeoutMs: 3000 });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(second.terminate).not.toHaveBeenCalled();
    second.message(success(2));
    await expect(result).resolves.toEqual({ ...success(2), status: 'success' });
    expectClean(second);
  });

  it('disposes an active request, ignores queued completion, and prevents future workers', async () => {
    const worker = new FakeWorker();
    const factory = vi.fn<NativeWorkerFactory>().mockReturnValue(worker);
    const probe = makeProbe(factory);
    const result = probe.run(input);
    const lateMessage = worker.onmessage;

    probe.dispose();
    probe.dispose();
    probe.cancel();
    lateMessage?.(messageEvent(success(1)));

    await expect(result).resolves.toEqual({ id: 1, ok: false, status: 'cancelled' });
    expectClean(worker);
    await expect(probe.run(input)).resolves.toEqual({
      id: 2,
      ok: false,
      status: 'error',
      error: 'Native probe has been disposed',
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expectClean(worker);
  });

  it('disposes before any run without creating resources', async () => {
    const factory = vi.fn<NativeWorkerFactory>();
    const probe = makeProbe(factory);

    probe.dispose();

    await expect(probe.run(input)).resolves.toEqual({
      id: 1,
      ok: false,
      status: 'error',
      error: 'Native probe has been disposed',
    });
    expect(factory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('native worker protocol', () => {
  let scope: {
    onmessage: ((event: MessageEvent<NativeRequest>) => void) | null;
    postMessage: ReturnType<typeof vi.fn<(response: NativeResponse) => void>>;
  };

  beforeEach(async () => {
    scope = { onmessage: null, postMessage: vi.fn<(response: NativeResponse) => void>() };
    vi.stubGlobal('self', scope);
    vi.resetModules();
    await import('../../src/engine/native.worker.ts');
  });

  it.each([
    { pattern: 'cat', flags: '', input: 'the cat', matched: true, index: 4, length: 3 },
    { pattern: 'cat', flags: 'gd', input: 'the cat', matched: true, index: 4, length: 3 },
    { pattern: 'cat', flags: 'y', input: 'the cat', matched: false, index: -1, length: 0 },
    { pattern: 'cat', flags: 'gdy', input: 'cat cat', matched: true, index: 0, length: 3 },
    { pattern: '^', flags: '', input: 'the cat', matched: true, index: 0, length: 0 },
    { pattern: 'dog', flags: '', input: 'the cat', matched: false, index: -1, length: 0 },
    { pattern: '\\u{1f600}', flags: 'u', input: 'x\ud83d\ude00y', matched: true, index: 1, length: 2 },
    { pattern: 'cat', flags: 'i', input: 'the CAT', matched: true, index: 4, length: 3 },
  ])('returns an identified UTF-16 span and exec timing for %j', (testCase) => {
    const { pattern, flags, input, matched, index, length } = testCase;
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(101.25);

    scope.onmessage?.(messageEvent({ id: 42, pattern, flags, input }));

    expect(scope.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 42,
      ok: true,
      matched,
      index,
      length,
      elapsedMs: 1.25,
    });
  });

  it.each([
    { pattern: '[', flags: '' },
    { pattern: 'cat', flags: 'z' },
  ])('returns identified native syntax errors for %j', (invalid) => {
    scope.onmessage?.(messageEvent({ ...input, ...invalid, id: 7 }));

    expect(scope.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 7,
      ok: false,
      error: expect.any(String),
    });
  });
});
