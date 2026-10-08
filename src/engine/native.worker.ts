export interface NativeRequest {
  id: number;
  pattern: string;
  flags: string;
  input: string;
}

export interface NativeResponseSuccess {
  id: number;
  ok: true;
  matched: boolean;
  index: number;
  elapsedMs: number;
  length: number;
}

export interface NativeResponseError {
  id: number;
  ok: false;
  error: string;
}

export type NativeResponse = NativeResponseSuccess | NativeResponseError;

self.onmessage = (event: MessageEvent<NativeRequest>) => {
  const { id, pattern, flags, input } = event.data;
  const cleanFlags = flags.replace(/[gd]/g, '');
  const t0 = performance.now();
  try {
    const re = new RegExp(pattern, cleanFlags);
    re.lastIndex = 0;
    const match = re.exec(input);
    const elapsedMs = performance.now() - t0;
    const response: NativeResponseSuccess = {
      id,
      ok: true,
      matched: match !== null,
      index: match ? match.index : -1,
      length: match ? match[0].length : 0,
      elapsedMs,
    };
    self.postMessage(response);
  } catch (err) {
    const response: NativeResponseError = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
