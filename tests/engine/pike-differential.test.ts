import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { parsePattern, PatternError } from '../../src/engine/parse.ts';
import { runPike } from '../../src/engine/pikevm.ts';
import { genCase, hasNativeEngineBug, isRegular, renderPattern } from './gen.ts';

const NUM_RUNS = process.env.DIFF_LONG ? 1_000_000 : 20_000;
const MAX_BACKTRACK_STEPS = 100_000;
const regularCase = genCase.filter(({ pattern }) => isRegular(pattern));

type Outcome = { matched: boolean; index: number; end: number; text: string | null };

function outcome(result: {
  matched: boolean;
  index: number;
  end: number;
  groups: (string | undefined)[];
}): Outcome {
  return {
    matched: result.matched,
    index: result.index,
    end: result.end,
    text: result.matched ? (result.groups[0] ?? null) : null,
  };
}

function compareOne(source: string, flags: string, input: string) {
  if (hasNativeEngineBug(source, flags)) return null;

  let program;
  try {
    program = parsePattern(source, flags);
  } catch (error) {
    if (error instanceof PatternError || error instanceof SyntaxError) return null;
    throw error;
  }

  let backtrack;
  try {
    backtrack = runBacktrack(program, input, {
      maxSteps: MAX_BACKTRACK_STEPS,
      wallMs: 60_000,
      trace: false,
    }).result;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (backtrack.gaveUp || backtrack.steps >= MAX_BACKTRACK_STEPS) return null;

  let native;
  try {
    native = new RegExp(source, flags);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  native.lastIndex = 0;
  const match = native.exec(input);
  const expected: Outcome = match
    ? { matched: true, index: match.index, end: match.index + match[0].length, text: match[0] }
    : { matched: false, index: -1, end: -1, text: null };
  const pike = runPike(program, input, { maxSteps: 1_000_000, wallMs: 60_000, trace: false }).result;
  return { expected, backtrack: outcome(backtrack), pike: outcome(pike), gaveUp: pike.gaveUp };
}

const regressions: [pattern: string, flags: string, input: string][] = [
  ['a|ab|abc', '', 'abc'],
  ['abc|ab|a', '', 'abc'],
  ['(?:a|ab)c', '', 'abc'],
  ['a.*z|b', '', `ab${'x'.repeat(40)}z`],
  ['a.*z|b', '', `ab${'x'.repeat(40)}`],
  ['ab.*z|b', '', 'abxz'],
  ['(?:|a)?', '', 'a'],
  ['(?:|a)??', '', 'a'],
  ['(?:|a)*', '', 'aaa'],
  ['(?:|a)+', '', 'aaa'],
  ['(?:|a){2}', '', 'a'],
  ['(?:|a){2,3}', '', 'aaa'],
  ['(?:|a){2,3}?', '', 'aaa'],
  ['(?:|a){2,3}b', '', 'aaab'],
  ['(?:){3}', '', ''],
  ['(?:^){2}a', '', 'a'],
  ['(a*)*', '', 'b'],
  ['((a*)|b)*', '', 'a'],
  ['(?:(?:|a)*)*', '', 'aaa'],
  ['(?:(?:a?)*)+', '', 'aaa'],
  ['(?:(?:a?)*)+?', '', 'aaa'],
  ['(?:a?){2,4}?', '', 'aaa'],
  ['(?:a*){2,3}b', '', 'aaab'],
  ['(a|(b))*', '', 'aba'],
  ['(z)((a+)?(b+)?(c))*', '', 'zaacbbbcac'],
  ['(?<x>a)|(?<x>b)', '', 'b'],
  ['(a|aa)*', '', 'aaaa'],
  ['(aa|a)*?', '', 'aaaa'],
  ['a{2,4}?a', '', 'aaaaa'],
  ['^a+$', '', 'aaaa!'],
  ['a+b', '', 'aaaa!'],
  ['cat', 'y', 'the cat'],
  ['cat', 'gdy', 'cat cat'],
  ['cat', 'gd', 'the cat cat'],
  ['.', '', '\u{1f600}'],
  ['.', 'u', '\u{1f600}'],
  ['\u{1f600}+', 'v', 'x\u{1f600}\u{1f600}y'],
  ['y', 'u', '\u{1f600}y'],
  ['\\ud83d', 'u', '\u{1f600}'],
  ['[\\uD800-\\uDFFF]', 'u', '\ud800'],
  ['[^a]+', 'u', '\u{1f600}\ud800a'],
  ['\\p{Script=Greek}+', 'u', '1αβ!'],
  ['[[a-z]--[aeiou]]+', 'v', 'aeiobcd!'],
  ['[\\p{ASCII}&&\\p{Letter}]+', 'v', 'éABC1'],
  ['(?i:a(?-i:b))c', '', 'Abc'],
  ['(?i:a)[b]', 'u', 'aB'],
  ['(?m:^a$)', '', 'x\na\ny'],
  ['(?s:.)', '', '\n'],
  ['\\bK\\b', 'iu', ' K '],
  ['\\B', '', ''],
  ['^$', 'm', 'a\n\nb'],
];

describe('differential: Pike vs backtracking and native RegExp.exec', () => {
  it.each(regressions)('regression /%s/%s on %j', (source, flags, input) => {
    const compared = compareOne(source, flags, input);
    expect(compared).not.toBeNull();
    if (!compared) throw new Error(`Skipped regression /${source}/${flags} on ${JSON.stringify(input)}`);
    expect(compared.gaveUp).toBe(false);
    expect(compared.backtrack).toEqual(compared.expected);
    expect(compared.pike).toEqual(compared.expected);
  });

  it(`${NUM_RUNS} seeded accepted regular cases, zero match mismatches`, () => {
    let accepted = 0;
    fc.assert(
      fc.property(regularCase, ({ pattern, flags, input }) => {
        const { source } = renderPattern(pattern);
        const compared = compareOne(source, flags, input);
        fc.pre(compared !== null);
        if (!compared) return;
        const context = `/${source}/${flags} on ${JSON.stringify(input)}`;
        expect(compared.gaveUp, context).toBe(false);
        expect(compared.backtrack, context).toEqual(compared.expected);
        expect(compared.pike, context).toEqual(compared.expected);
        accepted++;
      }),
      { numRuns: NUM_RUNS, seed: 20240607, endOnFailure: true, maxSkipsPerRun: 1_000 },
    );
    expect(accepted).toBe(NUM_RUNS);
  });
});
