import { describe, expect, it } from 'vitest';
import { decodeBase64Url, decodeShare, encodeBase64Url, encodeShare, presetFor, shareUrl, type ShareState } from '../../src/share.ts';
import { PATTERN_MAX, STRING_MAX } from '../../src/engine/parse.ts';
import { PRESETS } from '../../src/presets.ts';

const fallback: ShareState = { pattern: 'c(a|o)t', flags: '', input: 'the cot', mode: 'single' };

const samples: ShareState[] = [
  fallback,
  { pattern: '^(a+)+$', flags: 'i', input: `${'a'.repeat(16)}!`, mode: 'split' },
  { pattern: String.raw`(?<dup>\p{L})\k<dup>`, flags: 'u', input: 'ßß', mode: 'single' },
  { pattern: '[😀-🙏]+', flags: 'v', input: '😀😁\n😂\r\n\ttab & =?#%+/', mode: 'split' },
  { pattern: '', flags: '', input: '', mode: 'single' },
  { pattern: 'a b', flags: 'msy', input: '  leading and trailing  ', mode: 'single' },
  { pattern: '.*(?:.*=.*)', flags: '', input: 'x'.repeat(STRING_MAX), mode: 'split' },
];

describe('share hash (M8)', () => {
  it('base64url round-trips UTF-8 without padding or URL-hostile characters', () => {
    for (const text of ['', 'a', 'ab', 'abc', '😀\n\r\t', 'ß', '\u0000\uffff', '?#&=+/ ']) {
      const encoded = encodeBase64Url(text);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(decodeBase64Url(encoded)).toBe(text);
    }
    expect(decodeBase64Url('not valid!')).toBeNull();
    expect(decodeBase64Url('gA')).toBeNull();
  });

  it('encodes and decodes every sample exactly, including Unicode, newlines and the mode', () => {
    for (const sample of samples) {
      const hash = encodeShare(sample);
      expect(hash.startsWith('#')).toBe(true);
      expect(hash).not.toMatch(/%/);
      expect(decodeShare(hash, { pattern: 'zzz', flags: 'i', input: 'zzz', mode: 'single' })).toEqual(sample);
      const url = shareUrl(sample, { origin: 'https://example.test', pathname: '/' });
      expect(url.startsWith('https://example.test/#')).toBe(true);
      expect(decodeShare(new URL(url).hash, fallback)).toEqual(sample);
    }
  });

  it('writes the preset id only when all three fields match a preset and lets explicit fields win', () => {
    for (const preset of PRESETS) {
      const state: ShareState = { pattern: preset.pattern, flags: preset.flags, input: preset.input, mode: 'single' };
      expect(presetFor(state)).toBe(preset.id);
      expect(new URLSearchParams(encodeShare(state).slice(1)).get('preset')).toBe(preset.id);
    }
    expect(presetFor({ pattern: 'c(a|o)t', flags: '', input: 'the dog' })).toBeNull();
    expect(decodeShare('#preset=evil-regex', fallback)).toEqual({
      pattern: '^(a+)+$', flags: '', input: `${'a'.repeat(16)}!`, mode: 'single',
    });
    expect(decodeShare(`#preset=evil-regex&s=${encodeBase64Url('aaa!')}&m=split`, fallback)).toEqual({
      pattern: '^(a+)+$', flags: '', input: 'aaa!', mode: 'split',
    });
  });

  it('ignores empty, foreign or corrupt hashes and clamps oversized fields', () => {
    expect(decodeShare('', fallback)).toBeNull();
    expect(decodeShare('#', fallback)).toBeNull();
    expect(decodeShare('#section-2', fallback)).toBeNull();
    expect(decodeShare('#preset=nope', fallback)).toBeNull();
    expect(decodeShare('#p=%%%&s=!!!', fallback)).toEqual(fallback);
    expect(decodeShare('#f=gxi', fallback)).toEqual(fallback);
    expect(decodeShare('#f=uv', fallback)).toEqual({ ...fallback, flags: 'v' });
    expect(decodeShare('#f=yi', fallback)).toEqual({ ...fallback, flags: 'iy' });
    expect(decodeShare('#m=weird', { ...fallback, mode: 'split' })?.mode).toBe('split');
    expect(decodeShare('#m=single', { ...fallback, mode: 'split' })?.mode).toBe('single');
    const long = decodeShare(`#p=${encodeBase64Url('a'.repeat(PATTERN_MAX + 50))}&s=${encodeBase64Url('b'.repeat(STRING_MAX + 50))}`, fallback)!;
    expect(long.pattern).toHaveLength(PATTERN_MAX);
    expect(long.input).toHaveLength(STRING_MAX);
  });
});
