import { describe, expect, it, afterEach, vi } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { compilePike, PikeEvent, pikeTransferables, runPike } from '../../src/engine/pikevm.ts';
import type { EngineRequest, EngineResponse } from '../../src/engine/engine.worker.ts';

const program = parsePattern('(?:a|a)*b', '');

function matchSpan(result: ReturnType<typeof runPike>['result']) {
  return [result.matched, result.index, result.end, result.groups[0]];
}

describe('Pike per-position thread trace', () => {
  it('records ordered live sets, births, merges, and deaths with IR nodes', () => {
    const { trace, result } = runPike(program, 'aaab');
    const { code } = compilePike(program);
    expect(result.gaveUp).toBe(false);
    expect(trace.truncated).toBe(false);
    const kinds = new Set(trace.t);
    for (const kind of [PikeEvent.live, PikeEvent.birth, PikeEvent.merge, PikeEvent.death]) {
      expect(kinds.has(kind)).toBe(true);
    }
    const live = new Map<number, Set<number>>();
    for (let i = 0; i < trace.length; i++) {
      expect(trace.positions[i]).toBeGreaterThanOrEqual(i === 0 ? 0 : trace.positions[i - 1]);
      expect(program.nodes[trace.nodes[i]]).toBeDefined();
      expect(code[trace.pcs[i]].node).toBe(trace.nodes[i]);
      if (trace.t[i] === PikeEvent.live) {
        const pcs = live.get(trace.positions[i]) ?? new Set<number>();
        expect(pcs.has(trace.pcs[i])).toBe(false);
        pcs.add(trace.pcs[i]);
        live.set(trace.positions[i], pcs);
      }
      if (trace.t[i] === PikeEvent.merge) expect(trace.others[i]).toBeGreaterThanOrEqual(0);
    }
    expect([...live.keys()]).toEqual([0, 1, 2, 3, 4]);
    expect(result.maxThreads).toBe(Math.max(...[...live.values()].map((pcs) => pcs.size)));
  });

  it('bounds every column and retains exact results in count-only mode', () => {
    const expected = runPike(program, 'aaab', { trace: false });
    expect(expected.trace.length).toBe(0);
    expect(expected.result.truncated).toBe(false);
    for (const budget of [0, 1, 5, 20]) {
      const out = runPike(program, 'aaab', { traceBudget: budget });
      expect(matchSpan(out.result)).toEqual(matchSpan(expected.result));
      expect(out.result.steps).toBe(expected.result.steps);
      expect(out.trace.length).toBe(budget);
      expect(out.trace.truncated).toBe(true);
      expect(out.result.truncated).toBe(true);
      for (const buffer of pikeTransferables(out.trace)) {
        expect(buffer.byteLength).toBeLessThanOrEqual(budget * 4);
      }
    }
  });

  it('uses UTF-16 positions even when a thread consumes a whole code point', () => {
    const { trace } = runPike(parsePattern('.+', 'u'), '😀a');
    expect([...new Set(trace.positions)]).toEqual([0, 2, 3]);
  });

  it('transfers all columns without sharing buffers', () => {
    const { trace } = runPike(program, 'aaab');
    const buffers = pikeTransferables(trace);
    expect(buffers).toHaveLength(7);
    expect(new Set(buffers).size).toBe(7);
    const transferred = structuredClone(trace, { transfer: buffers });
    expect(transferred.length).toBe(trace.length);
    expect(transferred.positions).toHaveLength(trace.length);
    expect(buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
  });
});

describe('engine worker Pike protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function request(data: EngineRequest) {
    const scope = {
      onmessage: null as ((event: MessageEvent<EngineRequest>) => void) | null,
      postMessage: vi.fn<(response: EngineResponse, options?: StructuredSerializeOptions) => void>(),
    };
    vi.stubGlobal('self', scope);
    vi.resetModules();
    await import('../../src/engine/engine.worker.ts');
    scope.onmessage?.({ data } as MessageEvent<EngineRequest>);
    expect(scope.postMessage).toHaveBeenCalledOnce();
    return scope.postMessage.mock.calls[0];
  }

  it('runs Pike in the worker and transfers the typed trace', async () => {
    const [response, options] = await request({
      id: 7,
      pattern: 'a+b',
      flags: '',
      input: 'xaaab',
      engine: 'pike',
    });
    expect(response).toMatchObject({
      id: 7,
      ok: true,
      engine: 'pike',
      result: { matched: true, index: 1, end: 5 },
    });
    if (!response.ok || response.engine !== 'pike') throw new Error('Expected Pike success');
    expect(options?.transfer).toEqual(pikeTransferables(response.trace));
  });

  it('retains the backtracking default and its worker response', async () => {
    const [response, options] = await request({ id: 8, pattern: '(a)\\1', flags: '', input: 'aa' });
    expect(response).toMatchObject({
      id: 8,
      ok: true,
      engine: 'backtrack',
      result: { matched: true, end: 2 },
    });
    expect(options?.transfer).toHaveLength(6);
  });

  it.each(['a(?=b)', '(a)\\1', '(?<=a)b', 'a{1000000000}'])(
    'returns a clear span-bearing error for unsupported Pike /%s/',
    async (pattern) => {
      const [response] = await request({ id: 9, pattern, flags: '', input: 'ab', engine: 'pike' });
      expect(response).toMatchObject({
        id: 9,
        ok: false,
        error: {
          message: expect.any(String),
          index: expect.any(Number),
          end: expect.any(Number),
          unsupported: true,
        },
      });
    },
  );

  it('honors worker trace and execution budgets', async () => {
    const [response] = await request({
      id: 10,
      pattern: 'a+b',
      flags: '',
      input: 'a'.repeat(100),
      engine: 'pike',
      traceBudget: 1,
      maxSteps: 10,
    });
    expect(response).toMatchObject({
      ok: true,
      engine: 'pike',
      result: { gaveUp: true, matched: false, steps: 10, truncated: true },
      trace: { length: 1, truncated: true },
    });
  });
});
