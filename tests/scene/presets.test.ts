import { describe, expect, it } from 'vitest';
import { copy } from '../../src/copy.ts';
import { parsePattern, PATTERN_MAX, STRING_MAX } from '../../src/engine/parse.ts';
import { DEFAULT_PRESET, PRESETS } from '../../src/presets.ts';

const expectedOptions = [
  ['greedy', 1, '<.+>', '<b>bold</b>'],
  ['lazy', 1, '<.+?>', '<b>bold</b>'],
  ['first-ride', 2, 'c(a|o)t', 'the cot'],
  ['optional-letter', 3, 'colou?r', 'my color'],
  ['backreference', 4, String.raw`(\w)\1`, 'hello'],
  ['lookahead-password', 5, String.raw`^(?=.*\d)(?=.*[a-z]).{8,}$`, 'hunter22x'],
  ['evil-regex', 6, '^(a+)+$', `${'a'.repeat(16)}!`],
  ['another-classic', 7, '^([a-zA-Z]+)*$', `${'a'.repeat(16)}1`],
  ['stackoverflow-whitespace', 8, String.raw`^[\s\u200c]+|[\s\u200c]+$`, `x${' '.repeat(1998)}x`],
  ['cloudflare-core', 9, '.*(?:.*=.*)', 'x'.repeat(1200)],
] as const;

describe('workshop presets', () => {
  it.each(PRESETS)('parses $id into a complete Program', (preset) => {
    const program = parsePattern(preset.pattern, preset.flags);
    expect(program.source).toBe(preset.pattern);
    expect(program.flagsText).toBe(preset.flags);
    expect(program.nodes.length).toBeGreaterThan(0);
    expect(program.root).toBeDefined();
    expect(program.leafCount).toBeGreaterThan(0);
  });

  it('provides all nine examples and both greedy/lazy options', () => {
    expect(PRESETS.map((preset) => [preset.id, preset.number, preset.pattern, preset.input])).toEqual(
      expectedOptions,
    );
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(10);
    expect([...new Set(PRESETS.map((preset) => preset.number))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const preset of PRESETS) {
      expect(preset.flags).toBe('');
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.caption.length).toBeGreaterThan(0);
      expect(copy.presetOption(preset.number, preset.label)).toContain(preset.label);
    }
  });

  it('keeps every input and pattern within the app limits', () => {
    for (const preset of PRESETS) {
      expect(preset.input.length).toBeLessThanOrEqual(STRING_MAX);
      expect(preset.pattern.length).toBeLessThanOrEqual(PATTERN_MAX);
    }
  });

  it('defaults to the greedy loop ride with no flags', () => {
    expect(DEFAULT_PRESET).toBe(PRESETS[0]);
    expect(DEFAULT_PRESET).toMatchObject({
      id: 'greedy',
      pattern: '<.+>',
      flags: '',
      input: '<b>bold</b>',
      label: copy.presets.greedy.label,
      caption: copy.presets.greedy.caption,
    });
  });

  it('gives greedy and lazy variants distinct captions and loop preferences', () => {
    const variants = PRESETS.filter((preset) => preset.number === 1);
    expect(variants.map((preset) => preset.variant)).toEqual(['greedy', 'lazy']);
    expect(variants[0].caption).not.toBe(variants[1].caption);
    expect(
      variants.map((preset) => {
        const loop = parsePattern(preset.pattern, preset.flags).nodes.find((node) => node.kind === 'repeat');
        return loop?.kind === 'repeat' ? loop.greedy : undefined;
      }),
    ).toEqual([true, false]);
    expect(variants.map((preset) => new RegExp(preset.pattern).exec(preset.input)?.[0])).toEqual([
      '<b>bold</b>',
      '<b>',
    ]);
  });

  it('keeps evil inputs short for the static milestone', () => {
    expect(PRESETS.find((preset) => preset.id === 'evil-regex')?.input).toBe(`${'a'.repeat(16)}!`);
    expect(PRESETS.find((preset) => preset.id === 'another-classic')?.input).toBe(`${'a'.repeat(16)}1`);
  });

  it('includes zero-width non-joiners in both whitespace classes', () => {
    const preset = PRESETS.find((item) => item.id === 'stackoverflow-whitespace')!;
    expect(preset.pattern).toBe(String.raw`^[\s\u200c]+|[\s\u200c]+$`);
    const pattern = new RegExp(preset.pattern);
    expect(pattern.exec('\u200cx')?.[0]).toBe('\u200c');
    expect(pattern.exec('x\u200c')?.[0]).toBe('\u200c');
    expect(pattern.exec('x \u200c x')).toBeNull();
    expect(preset.input).toHaveLength(STRING_MAX);
    expect(preset.input[0]).toBe('x');
    expect(preset.input.at(-1)).toBe('x');
    expect(preset.input.slice(1, -1)).toBe(' '.repeat(1998));
  });

  it('uses the Cloudflare core on a long no-equals run from the postmortem family', () => {
    const preset = PRESETS.find((item) => item.id === 'cloudflare-core')!;
    expect(preset).toMatchObject({
      pattern: '.*(?:.*=.*)',
      source: 'https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/',
    });
    expect(preset.input).toBe('x'.repeat(1200));
    expect(preset.input.length).toBeLessThanOrEqual(STRING_MAX);
    expect(preset.input).not.toContain('=');
  });
});
