import { describe, expect, it } from 'vitest';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { parsePattern } from '../../src/engine/parse.ts';
import { compilePike, PikeCompileError, runPike } from '../../src/engine/pikevm.ts';

type MatchCase = [pattern: string, flags: string, input: string, index: number, text: string | null];
type PikeResult = ReturnType<typeof runPike>['result'];

function run(pattern: string, input: string, flags = '', opts: Parameters<typeof runPike>[2] = {}) {
  return runPike(parsePattern(pattern, flags), input, { trace: false, ...opts }).result;
}

function matchOutcome(result: PikeResult) {
  return {
    matched: result.matched,
    index: result.index,
    end: result.end,
    text: result.matched ? result.groups[0] : null,
  };
}

function checkMatch(pattern: string, flags: string, input: string, index: number, text: string | null) {
  const result = run(pattern, input, flags);
  expect(result.gaveUp).toBe(false);
  expect(matchOutcome(result)).toEqual({
    matched: text !== null,
    index,
    end: text === null ? -1 : index + text.length,
    text,
  });
  if (text !== null) expect(input.slice(result.index, result.end)).toBe(text);
}

describe('Pike compilation', () => {
  it.each(['', 'abc', 'a|ab', '(?<x>a)(b)?', '^\\b[a-z]+\\b$', '(?i:a)', '(a*)*'])(
    'compiles regular /%s/',
    (pattern) => {
      const { code } = compilePike(parsePattern(pattern, ''));
      expect(code.length).toBeGreaterThan(0);
      expect(code.length).toBeLessThan(1_000);
    },
  );

  it.each(['a*', 'a+', 'a*?', 'a{2,}', '(?:ab|c)*', 'a{2,4}', '(?:a?){3}'])(
    'compiles repetitions into a finite instruction array for /%s/',
    (pattern) => {
      const program = parsePattern(pattern, '');
      const first = compilePike(program);
      expect(first.code.length).toBeGreaterThan(0);
      expect(first.code.length).toBeLessThan(1_000);
      runPike(program, 'a'.repeat(100), { trace: false });
      expect(compilePike(program).code.length).toBe(first.code.length);
    },
  );

  it.each([
    '(a)\\1',
    '(?<x>a)\\k<x>',
    'a(?=b)',
    'a(?!b)',
    '(?<=a)b',
    '(?<!a)b',
    '(?:(a)\\1){0}',
    '(?:(?=a)){0}',
  ])('rejects nonregular /%s/ with PikeCompileError', (pattern) => {
    const program = parsePattern(pattern, '');
    expect(() => compilePike(program)).toThrow(PikeCompileError);
    expect(() => compilePike(program)).toThrow(Error);
    expect(() => runPike(program, 'ab', { trace: false })).toThrow(PikeCompileError);
  });

  it('simplifies nested instruction-free repetitions before expanding their bounds', () => {
    const program = parsePattern('(?:(?:){50000}){50000}', '');
    expect(compilePike(program).code).toHaveLength(2);
    expect(runPike(program, '', { trace: false }).result).toMatchObject({
      matched: true,
      index: 0,
      end: 0,
      gaveUp: false,
    });
  });

  it('bounds compiler visits independently of emitted instruction count', () => {
    const wrapped = `${'(?:'.repeat(40)}a${')'.repeat(40)}{20000}`;
    expect(() => compilePike(parsePattern(wrapped, ''))).toThrow(PikeCompileError);
  });

  it.each(['a{1000000000}', 'a{0,1000000000}', 'a{1000000000,}', '(?:a{1000}){1000}'])(
    'rejects excessive compilation complexity for /%s/',
    (pattern) => {
      const program = parsePattern(pattern, '');
      expect(() => compilePike(program)).toThrow(PikeCompileError);
      expect(() => runPike(program, '', { trace: false })).toThrow(PikeCompileError);
    },
  );
});

describe('Pike leftmost-first priority', () => {
  const cases: MatchCase[] = [
    ['a|ab|abc', '', 'abc', 0, 'a'],
    ['abc|ab|a', '', 'abc', 0, 'abc'],
    ['ab|a', '', 'ab', 0, 'ab'],
    ['(?:a|ab)c', '', 'abc', 0, 'abc'],
    ['(?:ab|a)b', '', 'ab', 0, 'ab'],
    ['|a', '', 'a', 0, ''],
    ['a|', '', 'a', 0, 'a'],
    ['b|a', '', 'ab', 0, 'a'],
    ['a.*z|b', '', `ab${'x'.repeat(40)}z`, 0, `ab${'x'.repeat(40)}z`],
    ['a.*?z|b', '', 'abxz', 0, 'abxz'],
    ['b|a.*z', '', 'abxz', 0, 'abxz'],
    ['ab.*z|b', '', 'abxz', 0, 'abxz'],
    ['a.*z|b', '', `ab${'x'.repeat(40)}`, 1, 'b'],
    ['a.*z|a', '', 'abxz', 0, 'abxz'],
    ['a.*z|a', '', 'abx', 0, 'a'],
    ['a.*z|a.*?', '', 'abx', 0, 'a'],
    ['(?:a.*z|b)c', '', 'abc', 1, 'bc'],
    ['.{2,}?a^|', 'sy', 'Acc a1ba  ', 0, ''],
    ['[\\s\\S]*?a^|', '', 'cabac ', 0, ''],
  ];

  it.each(cases)('/%s/%s on %j respects branch and start priority', checkMatch);
});

describe('Pike greedy, lazy, and bounded repetitions', () => {
  const cases: MatchCase[] = [
    ['<.+>', '', '<b>bold</b>', 0, '<b>bold</b>'],
    ['<.+?>', '', '<b>bold</b>', 0, '<b>'],
    ['a*', '', 'aaab', 0, 'aaa'],
    ['a*?', '', 'aaab', 0, ''],
    ['a+', '', 'aaab', 0, 'aaa'],
    ['a+?', '', 'aaab', 0, 'a'],
    ['a?', '', 'aa', 0, 'a'],
    ['a??', '', 'aa', 0, ''],
    ['a{2,4}', '', 'aaaaa', 0, 'aaaa'],
    ['a{2,4}?', '', 'aaaaa', 0, 'aa'],
    ['a{2,4}?a', '', 'aaaaa', 0, 'aaa'],
    ['a{2,4}a', '', 'aaaaa', 0, 'aaaaa'],
    ['a{2}', '', 'baaa', 1, 'aa'],
    ['a{2}', '', 'a', -1, null],
    ['a{2,}', '', 'aaaa', 0, 'aaaa'],
    ['a{2,}?', '', 'aaaa', 0, 'aa'],
    ['a{0}', '', 'a', 0, ''],
    ['a{0}b', '', 'ab', 1, 'b'],
    ['a{0,1}', '', 'aa', 0, 'a'],
    ['a{0,1}?', '', 'aa', 0, ''],
    ['a*a', '', 'aaa', 0, 'aaa'],
    ['a*?a', '', 'aaa', 0, 'a'],
    ['a*?b', '', 'aaab', 0, 'aaab'],
    ['(?:a|aa)*b', '', 'aaaab', 0, 'aaaab'],
    ['(?:aa|a)*?b', '', 'aaaab', 0, 'aaaab'],
    ['a{100,200}', '', 'a'.repeat(150), 0, 'a'.repeat(150)],
  ];

  it.each(cases)('/%s/%s on %j honors quantifier priority and bounds', checkMatch);
});

describe('Pike nullable repetitions', () => {
  const cases: MatchCase[] = [
    ['(?:|a)?', '', 'a', 0, 'a'],
    ['(?:|a)??', '', 'a', 0, ''],
    ['(?:|a)*', '', 'aaa', 0, 'aaa'],
    ['(?:|a)*?', '', 'aaa', 0, ''],
    ['(?:|a)+', '', 'aaa', 0, 'aaa'],
    ['(?:|a)+?', '', 'aaa', 0, ''],
    ['(?:|a){2}', '', 'a', 0, ''],
    ['(?:|a){2,3}', '', 'aaa', 0, 'a'],
    ['(?:|a){2,3}?', '', 'aaa', 0, ''],
    ['(?:|a){2,3}b', '', 'aaab', 0, 'aaab'],
    ['(?:)+', '', '', 0, ''],
    ['(?:){3}', '', '', 0, ''],
    ['(?:){3,5}', '', 'a', 0, ''],
    ['(?:){3,5}?', '', 'a', 0, ''],
    ['(?:^){2}a', '', 'a', 0, 'a'],
    ['(?:\\b){2}a', '', 'a', 0, 'a'],
    ['(?:a?){3}b', '', 'b', 0, 'b'],
    ['(?:a?){2,4}?', '', 'aaa', 0, 'aa'],
    ['(?:a*){2,3}b', '', 'aaab', 0, 'aaab'],
    ['(a*)*', '', 'b', 0, ''],
    ['(a*)*', '', 'aaa', 0, 'aaa'],
    ['((a*)|b)*', '', 'a', 0, 'a'],
    ['(?:(?:|a)*)*', '', 'aaa', 0, 'aaa'],
    ['(?:(?:a?)*)+', '', 'aaa', 0, 'aaa'],
    ['(?:(?:a?)*)+?', '', 'aaa', 0, 'aaa'],
    ['^(?:(?:a?)*)*b$', '', 'aaaab', 0, 'aaaab'],
    ['^(?:(?:a?)*)*b$', '', 'aaaa!', -1, null],
    ['(?:a*)*?b', '', 'aaab', 0, 'aaab'],
    ['(?:(?:)*){2}b', '', 'b', 0, 'b'],
  ];

  it.each(cases)('/%s/%s on %j preserves required empty iterations and optional progress', checkMatch);

  it('terminates deeply nested nullable repetition within a small step budget', () => {
    const result = run('^(?:(?:(?:a?)*)*)*b$', 'aaaa!', '', { maxSteps: 10_000 });
    expect(result.matched).toBe(false);
    expect(result.gaveUp).toBe(false);
    expect(result.steps).toBeLessThan(10_000);
  });
});

describe('Pike search and exec flags', () => {
  const cases: MatchCase[] = [
    ['cat', '', 'the cat', 4, 'cat'],
    ['cat', '', 'cats cat', 0, 'cat'],
    ['cat', 'y', 'the cat', -1, null],
    ['cat', 'y', 'cat food', 0, 'cat'],
    ['cat', 'g', 'the cat cat', 4, 'cat'],
    ['cat', 'd', 'the cat cat', 4, 'cat'],
    ['cat', 'gd', 'the cat cat', 4, 'cat'],
    ['cat', 'gdy', 'the cat', -1, null],
    ['cat', 'gdy', 'cat cat', 0, 'cat'],
    ['', 'y', 'abc', 0, ''],
    ['a*', '', 'b', 0, ''],
    ['$', '', 'abc', 3, ''],
    ['$', '', '', 0, ''],
    ['$', 'y', 'abc', -1, null],
    ['a', '', '', -1, null],
    ['z', '', 'aaa', -1, null],
  ];

  it.each(cases)('/%s/%s on %j searches from zero with sticky semantics', checkMatch);

  it('uses a single attempt for sticky success and failure', () => {
    expect(run('cat', 'cat food', 'y').attempts).toBe(1);
    expect(run('cat', 'the cat', 'y').attempts).toBe(1);
  });

  it('does not retain global or sticky lastIndex between executions', () => {
    const program = parsePattern('a', 'gy');
    const first = runPike(program, 'aa', { trace: false }).result;
    const second = runPike(program, 'aa', { trace: false }).result;
    expect(matchOutcome(first)).toEqual({ matched: true, index: 0, end: 1, text: 'a' });
    expect(matchOutcome(second)).toEqual(matchOutcome(first));
  });
});

describe('Pike UTF-16 and Unicode', () => {
  const cases: MatchCase[] = [
    ['.', '', '\u{1f600}', 0, '\ud83d'],
    ['..', '', '\u{1f600}', 0, '\u{1f600}'],
    ['.', 'u', '\u{1f600}', 0, '\u{1f600}'],
    ['.', 'v', '\u{1f600}', 0, '\u{1f600}'],
    ['..', 'u', '\u{1f600}', -1, null],
    ['..', 'v', '\u{1f600}a', 0, '\u{1f600}a'],
    ['\u{1f600}+', 'u', 'x\u{1f600}\u{1f600}y', 1, '\u{1f600}\u{1f600}'],
    ['\u{1f600}+', 'v', 'x\u{1f600}\u{1f600}y', 1, '\u{1f600}\u{1f600}'],
    ['\\u{1F600}', 'u', 'x\u{1f600}', 1, '\u{1f600}'],
    ['[\u{1f600}]+', 'u', '\u{1f600}\u{1f600}', 0, '\u{1f600}\u{1f600}'],
    ['[^a]+', 'u', '\u{1f600}\ud800a', 0, '\u{1f600}\ud800'],
    ['y', 'u', '\u{1f600}y', 2, 'y'],
    ['y', 'v', '\u{1f600}y', 2, 'y'],
    ['$', 'u', '\u{1f600}', 2, ''],
    ['.', 'u', '\ud800', 0, '\ud800'],
    ['.', 'v', '\udc00', 0, '\udc00'],
    ['\\ud800', 'u', 'x\ud800', 1, '\ud800'],
    ['[\\uD800-\\uDFFF]+', 'u', '\ud800\ud800', 0, '\ud800\ud800'],
    ['\\ud83d', '', '\u{1f600}', 0, '\ud83d'],
    ['\\ud83d', 'u', '\u{1f600}', -1, null],
    ['\\ude00', 'v', '\u{1f600}', -1, null],
    ['[\\uD800-\\uDFFF]', 'u', '\u{1f600}', -1, null],
    ['a', 'uy', '\u{1f600}a', -1, null],
  ];

  it.each(cases)('/%s/%s on %j uses code-unit indices and the appropriate character width', checkMatch);
});

describe('Pike character testers and scoped modifiers', () => {
  const cases: MatchCase[] = [
    ['[a-c]+', '', 'zabc1', 1, 'abc'],
    ['[^a]+', '', 'ab1a', 1, 'b1'],
    ['\\d+', '', 'x123y', 1, '123'],
    ['\\D+', '', '12ab3', 2, 'ab'],
    ['\\w+', '', ' !ab_1-', 2, 'ab_1'],
    ['\\W+', '', 'a !b', 1, ' !'],
    ['\\s+', '', 'a \t\nb', 1, ' \t\n'],
    ['\\S+', '', ' \tabc ', 2, 'abc'],
    ['[a-z]+', 'i', 'ABC!', 0, 'ABC'],
    ['.', '', '\n', -1, null],
    ['.', 's', '\n', 0, '\n'],
    ['\\p{Script=Greek}+', 'u', '1αβ!', 1, 'αβ'],
    ['\\p{Letter}+', 'v', '1αβA!', 1, 'αβA'],
    ['\\P{ASCII}+', 'u', 'a\u{1f600}é!', 1, '\u{1f600}é'],
    ['[\\p{ASCII}&&\\p{Letter}]+', 'v', 'éABC1', 1, 'ABC'],
    ['[[a-z]--[aeiou]]+', 'v', 'aeiobcd!', 4, 'bcd'],
    ['[\\q{a|b}]+', 'v', 'abba!', 0, 'abba'],
    ['(?i:a)b', '', 'Ab', 0, 'Ab'],
    ['(?i:a)b', '', 'AB', -1, null],
    ['(?i:a(?-i:b))c', '', 'Abc', 0, 'Abc'],
    ['(?i:a(?-i:b))c', '', 'ABc', -1, null],
    ['(?-i:a)b', 'i', 'aB', 0, 'aB'],
    ['(?-i:a)b', 'i', 'AB', -1, null],
    ['(?s:.)', '', '\n', 0, '\n'],
    ['(?-s:.)', 's', '\n', -1, null],
    ['(?m:^a$)', '', 'x\na\ny', 2, 'a'],
    ['(?-m:^a$)', 'm', 'x\na\ny', -1, null],
    ['(?i:a)[b]', 'u', 'aB', -1, null],
    ['(?i:a)[b]', 'v', 'aB', -1, null],
    ['(?i:a)[b]', 'v', 'Ab', 0, 'Ab'],
    ['(?i:(?:\\Ba\\n|[ab]|A\\bc))*', 'sy', 'bbAaA', 0, 'bbAaA'],
    ['(?-i:)[^A]+', 'iu', 'aB', 1, 'B'],
    ['a(^| |$){2} |(?-i:\\b|)[^A]+\\b|c', 'imuy', ' \na', 0, ' \n'],
  ];

  it.each(cases)('/%s/%s on %j applies classes, properties, and effective flags', checkMatch);
});

describe('Pike anchors and word assertions', () => {
  const cases: MatchCase[] = [
    ['^a', '', 'ba', -1, null],
    ['^a', '', 'ab', 0, 'a'],
    ['a$', '', 'ba', 1, 'a'],
    ['a$', '', 'a\n', -1, null],
    ['^$', '', '', 0, ''],
    ['^$', '', 'a', -1, null],
    ['^$', 'm', 'a\n\nb', 2, ''],
    ['^b$', 'm', 'a\r\nb\r\nc', 3, 'b'],
    ['\\bcat\\b', '', 'a cat!', 2, 'cat'],
    ['\\bcat\\b', '', 'scatter', -1, null],
    ['\\Bcat\\B', '', 'scatter', 1, 'cat'],
    ['\\b', '', '', -1, null],
    ['\\B', '', '', 0, ''],
    ['\\b', '', 'a', 0, ''],
    ['a\\b', '', 'a', 0, 'a'],
    ['\\bK\\b', 'iu', ' K ', 1, 'K'],
    ['\\bK\\b', 'iv', ' K ', 1, 'K'],
    ['\\bK\\b', 'u', ' K ', -1, null],
    ['(?i:\\bK\\b)', 'u', ' K ', 1, 'K'],
    ['\\B\u{1f600}\\B', 'u', '\u{1f600}', 0, '\u{1f600}'],
  ];

  it.each(cases)('/%s/%s on %j evaluates zero-width assertions', checkMatch);

  it.each(['\n', '\r', '\u2028', '\u2029'])(
    'recognizes line terminator %j for multiline anchors and dot',
    (terminator) => {
      checkMatch('^b', 'm', `a${terminator}b`, 2, 'b');
      checkMatch('a$', 'm', `a${terminator}b`, 0, 'a');
      checkMatch('.', '', terminator, -1, null);
      checkMatch('.', 's', terminator, 0, terminator);
    },
  );
});

describe('Pike capture-independent match semantics', () => {
  const cases: MatchCase[] = [
    ['(a)(b)?', '', 'a', 0, 'a'],
    ['(?<x>a)(?<y>b)?', '', 'ab', 0, 'ab'],
    ['(?<x>a)|(?<x>b)', '', 'b', 0, 'b'],
    ['(a|(b))*', '', 'aba', 0, 'aba'],
    ['(z)((a+)?(b+)?(c))*', '', 'zaacbbbcac', 0, 'zaacbbbcac'],
    ['(a|aa)*', '', 'aaaa', 0, 'aaaa'],
    ['(aa|a)*?', '', 'aaaa', 0, ''],
    ['((a?)*)*', '', 'aaa', 0, 'aaa'],
    ['(?<empty>)*', '', 'a', 0, ''],
  ];

  it.each(cases)('/%s/%s on %j agrees on the whole match without requiring capture parity', checkMatch);
});

describe('Pike execution limits and result statistics', () => {
  it('reports finite nonnegative execution statistics', () => {
    const result = run('a+b', 'xaaab');
    expect(matchOutcome(result)).toEqual({ matched: true, index: 1, end: 5, text: 'aaab' });
    expect(result.gaveUp).toBe(false);
    for (const value of [result.steps, result.attempts, result.maxThreads]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
    expect(Number.isFinite(result.elapsedMs)).toBe(true);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.truncated).toBe('boolean');
  });

  it.each([1, 16, 128])('stops at a %i-step budget', (maxSteps) => {
    const result = run('a+b', 'a'.repeat(10_000), '', { maxSteps, wallMs: 60_000 });
    expect(result.gaveUp).toBe(true);
    expect(result.matched).toBe(false);
    expect(result.steps).toBeLessThanOrEqual(maxSteps);
  });

  it('completes the same failure when the step budget is sufficient', () => {
    const result = run('a+b', 'a'.repeat(400), '', { maxSteps: 1_000_000, wallMs: 60_000 });
    expect(result.gaveUp).toBe(false);
    expect(result.matched).toBe(false);
  });

  it('honors a wall-clock deadline without timing assertions', () => {
    const result = run('a+b', 'a'.repeat(100_000), '', { maxSteps: 10_000_000, wallMs: 0 });
    expect(result.gaveUp).toBe(true);
    expect(result.matched).toBe(false);
    expect(result.steps).toBeLessThan(10_000_000);
  });

  it('polls cancellation and stops unfinished work', () => {
    let polls = 0;
    const result = run('a+b', 'a'.repeat(100_000), '', {
      maxSteps: 10_000_000,
      wallMs: 60_000,
      shouldCancel: () => {
        polls++;
        return true;
      },
    });
    expect(polls).toBeGreaterThan(0);
    expect(result.matched).toBe(false);
    expect(result.steps).toBeLessThan(100_000);
  });

  it('continues normally when cancellation polling returns false', () => {
    let polls = 0;
    const result = run('a+b', 'a'.repeat(5_000), '', {
      maxSteps: 1_000_000,
      wallMs: 60_000,
      shouldCancel: () => {
        polls++;
        return false;
      },
    });
    expect(polls).toBeGreaterThan(0);
    expect(result.matched).toBe(false);
    expect(result.gaveUp).toBe(false);
  });

  it('trace switches and tiny trace budgets do not affect the selected match', () => {
    const pattern = 'a.*z|b';
    const input = `ab${'x'.repeat(20)}z`;
    const expected = matchOutcome(run(pattern, input));
    for (const traceBudget of [0, 1, 10]) {
      const result = run(pattern, input, '', { trace: true, traceBudget });
      expect(result.gaveUp).toBe(false);
      expect(matchOutcome(result)).toEqual(expected);
    }
  });
});

describe('Pike complexity', () => {
  it('has linear growth while nested-plus backtracking grows exponentially for n=10..20', () => {
    const program = parsePattern('^(a+)+$', '');
    const codeLength = compilePike(program).code.length;
    const backtrackSteps: number[] = [];
    const pikeSteps: number[] = [];
    for (let n = 10; n <= 20; n++) {
      const input = `${'a'.repeat(n)}!`;
      const backtrack = runBacktrack(program, input, {
        maxSteps: 50_000_000,
        wallMs: 120_000,
        trace: false,
      }).result;
      const pike = runPike(program, input, { maxSteps: 1_000_000, wallMs: 120_000, trace: false }).result;
      expect(backtrack.gaveUp, `backtracking n=${n}`).toBe(false);
      expect(pike.gaveUp, `Pike n=${n}`).toBe(false);
      expect(backtrack.matched).toBe(false);
      expect(pike.matched).toBe(false);
      expect(pike.maxThreads).toBeGreaterThan(0);
      expect(pike.maxThreads).toBeLessThanOrEqual(codeLength * 2);
      backtrackSteps.push(backtrack.steps);
      pikeSteps.push(pike.steps);
    }
    for (let i = 1; i < backtrackSteps.length; i++) {
      const exponentialRatio = backtrackSteps[i] / backtrackSteps[i - 1];
      const linearRatio = pikeSteps[i] / pikeSteps[i - 1];
      expect(exponentialRatio, `backtracking n=${i + 10}`).toBeGreaterThan(1.8);
      expect(exponentialRatio, `backtracking n=${i + 10}`).toBeLessThan(2.2);
      expect(linearRatio, `Pike n=${i + 10}`).toBeGreaterThan(1);
      expect(linearRatio, `Pike n=${i + 10}`).toBeLessThan(1.2);
    }
    expect(pikeSteps[10] / pikeSteps[0]).toBeLessThan(2.2);
    expect(backtrackSteps[10] / pikeSteps[10]).toBeGreaterThan(1_000);
  });

  it('searches unanchored failing a+b simultaneously rather than rerunning per start', () => {
    const program = parsePattern('a+b', '');
    const steps = [100, 200, 400].map((n) => {
      const result = runPike(program, 'a'.repeat(n), {
        maxSteps: 1_000_000,
        wallMs: 60_000,
        trace: false,
      }).result;
      expect(result.matched).toBe(false);
      expect(result.gaveUp).toBe(false);
      expect(result.steps).toBeGreaterThan(0);
      return result.steps;
    });
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
      expect(steps[i] / steps[i - 1]).toBeLessThan(2.2);
    }
  });
});
