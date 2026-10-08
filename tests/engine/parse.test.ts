import { describe, expect, it } from 'vitest';
import { parsePattern, PatternError } from '../../src/engine/parse.ts';
import { walk } from '../../src/engine/ir.ts';

describe('parser and IR', () => {
  it('parses literals, classes, dot, escapes into char nodes with exact spans', () => {
    const src = 'a[0-9].\\d';
    const prog = parsePattern(src, '');
    expect(prog.source).toBe(src);
    expect(prog.flagsText).toBe('');
    expect(prog.leafCount).toBe(4);

    const spans = prog.nodes.filter((n) => n.kind === 'char').map((n) => n.span);
    expect(spans).toEqual([
      [0, 1], // a
      [1, 6], // [0-9]
      [6, 7], // .
      [7, 9], // \d
    ]);
  });

  it('parses alternation and captures branch spans', () => {
    const src = 'cat|dog|fish';
    const prog = parsePattern(src, '');
    const alt = prog.nodes.find((n) => n.kind === 'alt');
    expect(alt).toBeDefined();
    if (alt && alt.kind === 'alt') {
      expect(alt.branches.length).toBe(3);
      expect(alt.span).toEqual([0, 12]);
    }
  });

  it('parses quantifiers: greedy, lazy, bounded, open-ended', () => {
    const src = 'a*b+?c{2,5}d{3,}?e?';
    const prog = parsePattern(src, '');
    const reps = prog.nodes.filter((n) => n.kind === 'repeat');
    expect(reps.length).toBe(5);

    if (reps[0].kind === 'repeat') {
      expect(reps[0].min).toBe(0);
      expect(reps[0].max).toBe(Infinity);
      expect(reps[0].greedy).toBe(true);
    }
    if (reps[1].kind === 'repeat') {
      expect(reps[1].min).toBe(1);
      expect(reps[1].max).toBe(Infinity);
      expect(reps[1].greedy).toBe(false);
    }
    if (reps[2].kind === 'repeat') {
      expect(reps[2].min).toBe(2);
      expect(reps[2].max).toBe(5);
      expect(reps[2].greedy).toBe(true);
    }
    if (reps[3].kind === 'repeat') {
      expect(reps[3].min).toBe(3);
      expect(reps[3].max).toBe(Infinity);
      expect(reps[3].greedy).toBe(false);
    }
  });

  it('numbers capturing groups in source order and records names', () => {
    const src = '(a)(?<foo>b)(?:c)(d)';
    const prog = parsePattern(src, '');
    expect(prog.groupCount).toBe(3);
    expect(prog.groupNames).toEqual([null, null, 'foo', null]);

    const groups = prog.nodes.filter((n) => n.kind === 'group');
    expect(groups.length).toBe(4);
    const cap1 = groups.find((g) => g.kind === 'group' && g.capture === 1);
    const cap2 = groups.find((g) => g.kind === 'group' && g.capture === 2);
    const nonCap = groups.find((g) => g.kind === 'group' && g.capture === null);
    const cap3 = groups.find((g) => g.kind === 'group' && g.capture === 3);

    expect(cap1?.span).toEqual([0, 3]);
    expect(cap2?.span).toEqual([3, 12]);
    expect(nonCap?.span).toEqual([12, 17]);
    expect(cap3?.span).toEqual([17, 20]);
  });

  it('supports inline modifiers and tracks effective flags down the tree', () => {
    const src = '(?i:a(?-i:b))';
    const prog = parsePattern(src, '');
    const chars = prog.nodes.filter((n) => n.kind === 'char');
    expect(chars.length).toBe(2);

    const aTester = prog.testers[(chars[0] as { tester: number }).tester];
    const bTester = prog.testers[(chars[1] as { tester: number }).tester];
    expect(aTester.flags).toContain('i');
    expect(bTester.flags).not.toContain('i');
  });

  it('parses assertions (^, $, \\b, \\B) and lookaheads', () => {
    const src = '^\\bfoo(?=bar)(?!baz)\\B$';
    const prog = parsePattern(src, 'm');
    const asserts = prog.nodes.filter((n) => n.kind === 'assert');
    const looks = prog.nodes.filter((n) => n.kind === 'look');

    expect(asserts.length).toBe(4);
    expect(looks.length).toBe(2);
    expect(looks[0].kind === 'look' && !looks[0].negate).toBe(true);
    expect(looks[1].kind === 'look' && looks[1].negate).toBe(true);
    expect(prog.hasLookaround).toBe(true);
  });

  it('creates opaque probe nodes for lookbehind in v1', () => {
    const src = '(?<=foo)(?<!bar)';
    const prog = parsePattern(src, 'i');
    const opaques = prog.nodes.filter((n) => n.kind === 'opaque');
    expect(opaques.length).toBe(2);
    expect(prog.probes.length).toBe(2);
    expect(prog.probes[0].flags).toContain('y');
    expect(prog.probes[0].flags).toContain('i');
  });

  it('rejects unsupported constructs with friendly inline message and span', () => {
    // 1. Lookbehind with capturing group
    expect(() => parsePattern('(?<=(a))b', '')).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('Lookbehind containing a capturing group'),
        index: 4,
        unsupported: true,
      }),
    );

    // 2. Lookbehind with backreference
    expect(() => parsePattern('(x)(?<=\\1)b', '')).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('Lookbehind containing a backreference'),
        index: 7,
        unsupported: true,
      }),
    );

    // 3. String disjunction under v flag
    expect(() => parsePattern('[\\q{abc}]', 'v')).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('String alternatives'),
        unsupported: true,
      }),
    );
  });

  it('enforces mutual exclusivity between u and v flags', () => {
    expect(() => parsePattern('a', 'uv')).toThrowError(/Flags u and v cannot be combined/);
  });

  it('enforces pattern length limit of 300 characters', () => {
    const long = 'a'.repeat(301);
    expect(() => parsePattern(long, '')).toThrowError(PatternError);
  });

  it('walk visitor covers all nodes', () => {
    const prog = parsePattern('a(b|c)*(?i:d)', '');
    const walked = Array.from(walk(prog.root));
    expect(walked.length).toBeGreaterThan(5);
  });
});
