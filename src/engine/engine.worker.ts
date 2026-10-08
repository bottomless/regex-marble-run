import { parsePattern, PatternError } from './parse.ts';
import { runBacktrack } from './backtrack.ts';
import { transferables } from './trace.ts';

export interface EngineRequest {
  id: number;
  pattern: string;
  flags: string;
  input: string;
  maxSteps?: number;
  wallMs?: number;
  traceBudget?: number;
  trace?: boolean;
}

export interface EngineResponseSuccess {
  id: number;
  ok: true;
  result: ReturnType<typeof runBacktrack>['result'];
  trace: ReturnType<typeof runBacktrack>['trace'];
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

export type EngineResponse = EngineResponseSuccess | EngineResponseError;

let currentRequestId = -1;

self.onmessage = (event: MessageEvent<EngineRequest | { cancelId: number }>) => {
  const data = event.data;
  if ('cancelId' in data) {
    if (data.cancelId === currentRequestId) {
      currentRequestId = -1;
    }
    return;
  }

  const { id, pattern, flags, input, maxSteps, wallMs, traceBudget, trace } = data;
  currentRequestId = id;

  try {
    const prog = parsePattern(pattern, flags);
    const out = runBacktrack(prog, input, {
      maxSteps,
      wallMs,
      traceBudget,
      trace,
      shouldCancel: () => currentRequestId !== id,
    });

    if (currentRequestId !== id) return;

    const response: EngineResponseSuccess = {
      id,
      ok: true,
      result: out.result,
      trace: out.trace,
      ir: prog,
    };
    const t = transferables(out.trace);
    self.postMessage(response, { transfer: t });
  } catch (err) {
    if (currentRequestId !== id) return;
    const isPatErr = err instanceof PatternError;
    const response: EngineResponseError = {
      id,
      ok: false,
      error: {
        message: err instanceof Error ? err.message : String(err),
        index: isPatErr ? err.index : undefined,
        end: isPatErr ? err.end : undefined,
        unsupported: isPatErr ? err.unsupported : false,
      },
    };
    self.postMessage(response);
  }
};
