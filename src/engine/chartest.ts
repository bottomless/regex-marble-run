import type { ProbeSpec, TesterSpec } from './ir.ts';

const testerCache = new Map<string, RegExp>();

/** Compile (and cache) a native single-character tester for `raw` under `flags`. */
export function getTester(raw: string, flags: string): RegExp {
  const key = flags + '/' + raw;
  let re = testerCache.get(key);
  if (!re) {
    re = new RegExp('^(?:' + raw + ')$', flags);
    testerCache.set(key, re);
  }
  return re;
}

export function compileTesters(specs: TesterSpec[]): RegExp[] {
  return specs.map((s) => getTester(s.raw, s.flags));
}

export function compileProbes(specs: ProbeSpec[]): RegExp[] {
  return specs.map((s) => new RegExp(s.raw, s.flags));
}

/** Word-character tester per spec IsWordChar, which depends on `i` and `u`/`v`. */
export function wordTester(ignoreCase: boolean, unicode: boolean, unicodeSets: boolean): RegExp {
  let f = '';
  if (ignoreCase) f += 'i';
  if (unicode) f += 'u';
  if (unicodeSets) f += 'v';
  return getTester('\\w', f);
}

const eqCache = new Map<string, RegExp>();

function escapeChar(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (cp > 0xffff) return `\\u{${cp.toString(16)}}`;
  return `\\u${cp.toString(16).padStart(4, '0')}`;
}

/**
 * Case-insensitive single-character equality using the native engine's Canonicalize.
 * `a` and `b` are single characters (code point strings in unicode mode, code units otherwise).
 */
export function charEqIgnoreCase(a: string, b: string, unicode: boolean, unicodeSets: boolean): boolean {
  if (a === b) return true;
  const f = 'i' + (unicode ? 'u' : '') + (unicodeSets ? 'v' : '');
  const key = f + '/' + a;
  let re = eqCache.get(key);
  if (!re) {
    if (eqCache.size > 4096) eqCache.clear();
    re = new RegExp('^' + escapeChar(a) + '$', f);
    eqCache.set(key, re);
  }
  return re.test(b);
}

export function isLineTerminator(code: number): boolean {
  return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
}

/** Read the character (code point in unicode mode) at `pos`; returns its length in code units (0 at end). */
export function charLenAt(input: string, pos: number, unicode: boolean): number {
  if (pos >= input.length) return 0;
  if (!unicode) return 1;
  const c = input.charCodeAt(pos);
  if (c >= 0xd800 && c <= 0xdbff && pos + 1 < input.length) {
    const d = input.charCodeAt(pos + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return 2;
  }
  return 1;
}
