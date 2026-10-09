import { parsePattern, PatternError } from './parse.ts';
import { runBacktrack } from './backtrack.ts';
import { transferables } from './trace.ts';
import { PikeCompileError, pikeTransferables, runPike } from './pikevm.ts';

export interface EngineRequest {
  id: number;
  pattern: string;
  flags: string;
  input: string;
  engine?: 'backtrack' | 'pike';
  maxSteps?: number;
  wallMs?: number;
  traceBudget?: number;
  trace?: boolean;
}

export interface EngineResponseSuccess {
  id: number;
  ok: true;
  engine: 'backtrack';
  result: ReturnType<typeof runBacktrack>['result'];
  trace: ReturnType<typeof runBacktrack>['trace'];
  ir: ReturnType<typeof parsePattern>;
}

export interface EngineResponsePikeSuccess {
  id: number;
  ok: true;
  engine: 'pike';
  result: ReturnType<typeof runPike>['result'];
  trace: ReturnType<typeof runPike>['trace'];
  ir: ReturnType<typeof parsePattern>;
}

export interface EngineResponseError {
  id: number;
  ok: false;
  error: {
    message: string;
    index?: number;
    end?: number;
    unsupported?: boolean;
  };
}

export type EngineResponse = EngineResponseSuccess | EngineResponsePikeSuccess | EngineResponseError;

let currentRequestId = -1;

self.onmessage = (event: MessageEvent<EngineRequest | { cancelId: number }>) => {
  const data = event.data;
  if ('cancelId' in data) {
    if (data.cancelId === currentRequestId) {
      currentRequestId = -1;
    }
    return;
  }

  const { id, pattern, flags, input, engine, maxSteps, wallMs, traceBudget, trace } = data;
  currentRequestId = id;

  try {
    const prog = parsePattern(pattern, flags);
    const options = {
      maxSteps,
      wallMs,
      traceBudget,
      trace,
      shouldCancel: () => currentRequestId !== id,
    };
    if (engine === 'pike') {
      const out = runPike(prog, input, options);
      if (currentRequestId !== id) return;
      const response: EngineResponsePikeSuccess = {
        id,
        ok: true,
        engine: 'pike',
        result: out.result,
        trace: out.trace,
        ir: prog,
      };
      self.postMessage(response, { transfer: pikeTransferables(out.trace) });
      return;
    }
    const out = runBacktrack(prog, input, options);

    if (currentRequestId !== id) return;

    const response: EngineResponseSuccess = {
      id,
      ok: true,
      engine: 'backtrack',
      result: out.result,
      trace: out.trace,
      ir: prog,
    };
    const t = transferables(out.trace);
    self.postMessage(response, { transfer: t });
  } catch (err) {
    if (currentRequestId !== id) return;
    const isPatErr = err instanceof PatternError;
    const isPikeErr = err instanceof PikeCompileError;
    const response: EngineResponseError = {
      id,
      ok: false,
      error: {
        message: err instanceof Error ? err.message : String(err),
        index: isPatErr ? err.index : isPikeErr ? err.span[0] : undefined,
        end: isPatErr ? err.end : isPikeErr ? err.span[1] : undefined,
        unsupported: isPatErr ? err.unsupported : isPikeErr,
      },
    };
    self.postMessage(response);
  }
};
