import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../src/engine/parse.ts';
import { runBacktrack, nativeExec } from '../../src/engine/backtrack.ts';

function run(pattern: string, flags: string, input: string) {
  const prog = parsePattern(pattern, flags);
  const { result, trace } = runBacktrack(prog, input);
  const native = nativeExec(pattern, flags, input);
  return { result, trace, native };
}

describe('semantics checklist (section 4.2)', () => {
  // 1. Unanchored search tries start positions 0..len in order;
  // the y flag means only lastIndex = 0; g is ignored; d is ignored.
  describe('1. Unanchored search & sticky / global flags', () => {
    it('unanchored search advances start position 0..len until match', () => {
      const { result, native } = run('cat', '', 'the cat');
      expect(result.matched).toBe(true);
      expect(result.index).toBe(4);
      expect(result.attempts).toBe(5); // tries index 0, 1, 2, 3, 4
      expect(result.index).toBe(native?.index);
    });

    it('sticky y flag only tries start index 0', () => {
      const matchAtZero = run('cat', 'y', 'cat food');
      expect(matchAtZero.result.matched).toBe(true);
      expect(matchAtZero.result.attempts).toBe(1);

      const failNotZero = run('cat', 'y', 'the cat');
      expect(failNotZero.result.matched).toBe(false);
      expect(failNotZero.result.attempts).toBe(1);
    });

    it('g and d flags are ignored for single exec', () => {
      const withG = run('a', 'g', 'ba');
      const withoutG = run('a', '', 'ba');
      expect(withG.result.matched).toBe(true);
      expect(withG.result.index).toBe(1);
      expect(withG.result.index).toBe(withoutG.result.index);

      const withD = run('a', 'd', 'ba');
      expect(withD.result.matched).toBe(true);
      expect(withD.result.index).toBe(1);
    });
  });

  // 2. Positions are UTF-16 code-unit indices, matching native index.
  // With u or v, a character is a code point (advance 2 units for surrogate pairs).
  describe('2. UTF-16 code units vs unicode code points', () => {
    it('in non-unicode mode, . matches a single surrogate half', () => {
      const str = '😀'; // 2 UTF-16 code units (\ud83d\ude00)
      const { result, native } = run('.', '', str);
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('\ud83d');
      expect(native?.[0]).toBe('\ud83d');
      expect(result.end).toBe(1);
    });

    it('in unicode mode (u or v), . and literal match full surrogate pair', () => {
      const str = 'x😀y';
      const uRes = run('.', 'u', '😀');
      expect(uRes.result.groups[0]).toBe('😀');
      expect(uRes.result.end).toBe(2);

      const vRes = run('😀', 'v', str);
      expect(vRes.result.matched).toBe(true);
      expect(vRes.result.index).toBe(1);
      expect(vRes.result.end).toBe(3);
    });

    it('unanchored step advances by code point under u flag', () => {
      const { result } = run('y', 'u', '😀y');
      expect(result.matched).toBe(true);
      expect(result.index).toBe(2);
      expect(result.attempts).toBe(2); // index 0 (😀), index 2 (y)
    });
  });

  // 3. Alternation tries branches left to right.
  describe('3. Alternation branch order', () => {
    it('tries branches left to right and picks leftmost match', () => {
      const { result, native } = run('a|ab|abc', '', 'abc');
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('a');
      expect(result.groups[0]).toBe(native?.[0]);
    });

    it('backtracks into later branches when earlier branch fails downstream', () => {
      const { result, native } = run('(?:a|ab)c', '', 'abc');
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('abc');
      expect(result.groups[0]).toBe(native?.[0]);
      expect(result.backtracks).toBeGreaterThan(0);
    });
  });

  // 4. Greedy: body first, then continuation. Lazy: continuation first.
  describe('4. Greedy vs Lazy quantifiers', () => {
    it('greedy quantifier matches as much as possible first', () => {
      const { result, native } = run('<.+>', '', '<b>bold</b>');
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('<b>bold</b>');
      expect(result.groups[0]).toBe(native?.[0]);
    });

    it('lazy quantifier matches as little as possible first', () => {
      const { result, native } = run('<.+?>', '', '<b>bold</b>');
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('<b>');
      expect(result.groups[0]).toBe(native?.[0]);
    });

    it('lazy with bounds a{2,4}? on aaaa matches aa', () => {
      const { result, native } = run('a{2,4}?', '', 'aaaa');
      expect(result.groups[0]).toBe('aa');
      expect(result.groups[0]).toBe(native?.[0]);
    });
  });

  // 5. Empty-iteration rule: once min is satisfied, an iteration that consumes nothing fails.
  // Without it, (a*)* loops forever.
  describe('5. Empty-iteration guard (RepeatMatcher)', () => {
    it('prevents infinite loops on (a*)* and matches empty string without looping', () => {
      const { result, native } = run('(a*)*', '', 'b');
      expect(result.matched).toBe(true);
      expect(result.index).toBe(0);
      expect(result.groups[0]).toBe('');
      expect(result.groups[1]).toBe(undefined);
      expect(result.groups[0]).toBe(native?.[0]);
      expect(result.steps).toBeLessThan(100);
    });

    it('handles ((a*)|b)* correctly on empty and non-empty inputs', () => {
      const { result, native } = run('((a*)|b)*', '', 'a');
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('a');
      expect(result.groups[0]).toBe(native?.[0]);
    });
  });

  // 6. Capture reset: captures inside a quantified atom reset to undefined at the start of each iteration.
  describe('6. Capture reset per iteration', () => {
    it('resets group to undefined when next iteration begins and does not match it', () => {
      const { result, native } = run('(z)((a+)?(b+)?(c))*', '', 'zaacbbbcac');
      expect(result.matched).toBe(true);
      // In last iteration 'ac', group 3 (a+) matches 'a', group 4 (b+) is skipped => undefined
      expect(result.groups[3]).toBe('a');
      expect(result.groups[4]).toBe(undefined);
      expect(result.groups).toEqual(Array.from(native!));
    });

    it('resets optional captures in simple loop', () => {
      const { result, native } = run('(a|(b))*', '', 'ab');
      expect(result.groups[2]).toBe('b');
      expect(result.groups).toEqual(Array.from(native!));

      const { result: r2, native: n2 } = run('(a|(b))*', '', 'aba');
      // In iteration 3 with 'a', group 2 (b) must be undefined
      expect(r2.groups[2]).toBe(undefined);
      expect(r2.groups).toEqual(Array.from(n2!));
    });
  });

  // 7. A backreference to an unset group matches the empty string.
  // With i, compare case-insensitively via the native tester approach.
  describe('7. Backreferences (unset and case-insensitive)', () => {
    it('backreference to an unset group matches the empty string', () => {
      const { result, native } = run('(a)?\\1b', '', 'b');
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('b');
      expect(result.groups[1]).toBe(undefined);
      expect(result.groups).toEqual(Array.from(native!));
    });

    it('case-insensitive backreference compares case-insensitively', () => {
      const { result, native } = run('(\\w)\\1', 'i', 'aA');
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('aA');
      expect(result.groups[1]).toBe('a');
      expect(result.groups).toEqual(Array.from(native!));

      const fail = run('(\\w)\\1', '', 'aA');
      expect(fail.result.matched).toBe(false);
    });

    it('named duplicate backreferences resolve correctly', () => {
      const { result, native } = run('(?<x>a)|(?<x>b)\\k<x>', '', 'bb');
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('bb');
      expect(result.namedGroups?.x).toBe('b');
      expect(result.groups).toEqual(Array.from(native!));
    });
  });

  // 8. Lookahead is atomic: after it succeeds, its internal choice points are discarded.
  // Captures from a positive lookahead persist; a negative lookahead leaves them undefined.
  describe('8. Lookahead atomicity and capture persistence', () => {
    it('lookahead is atomic: choice points inside lookahead are not backtracked into from outside', () => {
      // (?=(a|ab))ac: inside lookahead, 'a' matches. Then outside 'ac' tests 'abc'.
      // If lookahead were not atomic, backtracking from 'ac' might try 'ab' in lookahead.
      // But lookahead is atomic: once satisfied, it does not re-open.
      const { result, native } = run('^(?=(a|ab))ac', '', 'abc');
      expect(result.matched).toBe(false);
      expect(native).toBe(null);
    });

    it('captures from positive lookahead persist on match', () => {
      const { result, native } = run('^(?=(a))a', '', 'a');
      expect(result.matched).toBe(true);
      expect(result.groups[1]).toBe('a');
      expect(result.groups).toEqual(Array.from(native!));
    });

    it('captures from negative lookahead are undefined on match', () => {
      const { result, native } = run('^(?!(b))a', '', 'a');
      expect(result.matched).toBe(true);
      expect(result.groups[1]).toBe(undefined);
      expect(result.groups).toEqual(Array.from(native!));
    });
  });

  // 9. ^ and $ respect m (line terminators \n, \r, \u2028, \u2029).
  describe('9. ^ and $ under multiline flag m', () => {
    const terminators = ['\n', '\r', '\u2028', '\u2029'];

    it.each(terminators)('^ matches immediately after terminator %j under m', (t) => {
      const input = `first${t}second`;
      const { result, native } = run('^second', 'm', input);
      expect(result.matched).toBe(true);
      expect(result.index).toBe(5 + t.length);
      expect(result.index).toBe(native?.index);
    });

    it.each(terminators)('$ matches immediately before terminator %j under m', (t) => {
      const input = `first${t}second`;
      const { result, native } = run('first$', 'm', input);
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('first');
      expect(result.groups[0]).toBe(native?.[0]);
    });

    it('^ and $ match empty line in between terminators', () => {
      const { result, native } = run('^$', 'm', 'a\n\nb');
      expect(result.matched).toBe(true);
      expect(result.index).toBe(2);
      expect(result.index).toBe(native?.index);
    });
  });

  describe('scoped flags are restored after modifier groups', () => {
    it.each([
      ['(?-i:)[^A]+', 'iu', 'aB', 'B'],
      ['(?i:(?:\\Ba\\n|[ab]|A\\bc))*', 'sy', 'bbAaA', 'bbAaA'],
      ['(?i:[^A]{0,1}?(?<n1>\\Ba\\n|[ab]|A\\bc))*\\B|(\\B$..$)c[^a1]{0}', 'sy', '1bbAaA\nbc', '1bbAaA\nb'],
      ['(?:(?ms-i:(([^^])\\1))[^a]*)?b*?(?:(?!.1{2}a{2})){2}', 'imuy', 'cc111c\n Aa', 'cc111c\n '],
      ['a(^| |$){2} |(?-i:\\b|)[^A]+\\b|c', 'imuy', ' \na', ' \n'],
    ])('/%s/%s preserves outer case folding on subsequent classes', (pattern, flags, input, text) => {
      const { result } = runBacktrack(parsePattern(pattern, flags), input);
      expect(result.gaveUp).toBe(false);
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe(text);
    });
  });

  it.each([
    ['.{2,}?a^|', 'sy', 'Acc a1ba  '],
    [' ??(.{2,}?^(c\\B)|[b-c1]*?)^', 'sy', 'cabac '],
    ['[\\s\\S]*?a^|', '', 'cabac '],
  ])(
    '/%s/%s retains alternatives when an unbounded lazy scan fails a start assertion',
    (pattern, flags, input) => {
      const { result } = runBacktrack(parsePattern(pattern, flags), input);
      expect(result.gaveUp).toBe(false);
      expect(result.matched).toBe(true);
      expect(result.groups[0]).toBe('');
    },
  );

  describe('10. Bounded repeat with large numbers', () => {
    it('executes {1000,2000} without allocating per iteration', () => {
      const str = 'a'.repeat(1500);
      const { result, native } = run('a{1000,2000}', '', str);
      expect(result.matched).toBe(true);
      expect(result.groups[0]?.length).toBe(1500);
      expect(result.groups[0]?.length).toBe(native?.[0].length);
    });
  });

  // 11. Lookbehind (opaque node) evaluated natively with sticky probe, counts as 1 step.
  describe('11. Lookbehind evaluation via sticky probe', () => {
    it('positive lookbehind (?<=a)b matches only after a', () => {
      const { result, native } = run('(?<=a)b', '', 'cab');
      expect(result.matched).toBe(true);
      expect(result.index).toBe(2);
      expect(result.groups[0]).toBe('b');
      expect(result.index).toBe(native?.index);
    });

    it('negative lookbehind (?<!a)b matches b not preceded by a', () => {
      const { result, native } = run('(?<!a)b', '', 'ab xb');
      expect(result.matched).toBe(true);
      expect(result.index).toBe(4);
      expect(result.index).toBe(native?.index);
    });
  });
});
