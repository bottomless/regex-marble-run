import { PATTERN_MAX, STRING_MAX } from './engine/parse.ts';
import { PRESETS } from './presets.ts';

/**
 * Shareable state lives in the URL hash (PLAN §8):
 *   #p=<base64url pattern>&f=<flags>&s=<base64url string>&m=<single|split>&preset=<id>
 * Pattern and string are base64url over UTF-8 so Unicode and newlines round-trip exactly and the
 * hash never needs percent-encoding. `preset` is only written when the three fields match a preset;
 * when reading, explicit fields win over the preset id so an edited link still shows the edits.
 */

export type ShareMode = 'single' | 'split';

export interface ShareState {
  pattern: string;
  flags: string;
  input: string;
  mode: ShareMode;
}

const VALID_FLAGS = /^[imsuvy]*$/;

export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function normaliseFlags(flags: string): string {
  const set = new Set(flags.split(''));
  if (set.has('u') && set.has('v')) set.delete('u');
  return ['i', 'm', 's', 'u', 'v', 'y'].filter((flag) => set.has(flag)).join('');
}

export function presetFor(state: Pick<ShareState, 'pattern' | 'flags' | 'input'>): string | null {
  const preset = PRESETS.find(
    (item) => item.pattern === state.pattern && item.flags === state.flags && item.input === state.input,
  );
  return preset?.id ?? null;
}

export function encodeShare(state: ShareState): string {
  const params = new URLSearchParams();
  params.set('p', encodeBase64Url(state.pattern));
  params.set('f', state.flags);
  params.set('s', encodeBase64Url(state.input));
  if (state.mode !== 'single') params.set('m', state.mode);
  const preset = presetFor(state);
  if (preset) params.set('preset', preset);
  return `#${params.toString()}`;
}

/** Parses a hash; returns null when it carries no recognisable state. Partial hashes fill from a preset or defaults. */
export function decodeShare(hash: string, fallback: ShareState): ShareState | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const presetId = params.get('preset');
  const preset = presetId ? PRESETS.find((item) => item.id === presetId) : undefined;
  const hasAny = ['p', 'f', 's', 'm'].some((key) => params.has(key)) || Boolean(preset);
  if (!hasAny) return null;

  const base = preset ? { pattern: preset.pattern, flags: preset.flags, input: preset.input } : fallback;
  const pattern = params.has('p') ? decodeBase64Url(params.get('p')!) : base.pattern;
  const input = params.has('s') ? decodeBase64Url(params.get('s')!) : base.input;
  const flagsRaw = params.has('f') ? params.get('f')! : base.flags;
  const modeRaw = params.get('m');
  return {
    pattern: (pattern ?? base.pattern).slice(0, PATTERN_MAX),
    flags: VALID_FLAGS.test(flagsRaw) ? normaliseFlags(flagsRaw) : base.flags,
    input: (input ?? base.input).slice(0, STRING_MAX),
    mode: modeRaw === 'split' ? 'split' : modeRaw === 'single' ? 'single' : fallback.mode,
  };
}

export function shareUrl(state: ShareState, location: { origin: string; pathname: string }): string {
  return `${location.origin}${location.pathname}${encodeShare(state)}`;
}
