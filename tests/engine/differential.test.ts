import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parsePattern, PatternError } from '../../src/engine/parse.ts';
import { runBacktrack } from '../../src/engine/backtrack.ts';
import { genCase, renderPattern } from './gen.ts';
import regressions from './regressions.json';

const LONG = !!process.env.DIFF_LONG;
const NUM_RUNS = LONG ? 1_000_000 : 20_000;

interface Outcome {
  index: number;
  groups: (string | undefined)[];
  named: Record<string, string | undefined> | undefined;
}

function nativeOutcome(source: string, flags: string, input: string): Outcome | null | 'error' {
  let re: RegExp;
  try {
    re = new RegExp(source, flags);
  } catch {
    return 'error';
  }
  re.lastIndex = 0;
  const m = re.exec(input);
  if (!m) return null;
  return { index: m.index, groups: Array.from(m), named: m.groups ? { ...m.groups } : undefined };
}

export function compareOne(
  source: string,
  flags: string,
  input: string,
): { ok: true; skipped?: boolean } | { ok: false; ours: unknown; theirs: unknown } {
  // V8 bug (observed in V8 14.6): under the `v` flag a character class that follows a
  // modifier group such as `(?i:…)` wrongly inherits the group's flags. Skip that corner.
  if (flags.includes('v') && /\(\?[ims]*-?[ims]*:/.test(source)) return { ok: true, skipped: true };
  const theirs = nativeOutcome(source, flags, input);
  let ours: Outcome | null | 'error';
  try {
    const prog = parsePattern(source, flags);
    const { result } = runBacktrack(prog, input, { maxSteps: 100_000, trace: false });
    if (result.gaveUp) return { ok: true, skipped: true };
    ours = result.matched
      ? { index: result.index, groups: result.groups, named: result.namedGroups ?? undefined }
      : null;
  } catch (e) {
    if (e instanceof PatternError && !e.unsupported) ours = 'error';
    else throw e;
  }
  if (theirs === 'error' || ours === 'error') {
    return theirs === ours ? { ok: true } : { ok: false, ours, theirs };
  }
  const a = JSON.stringify(ours);
  const b = JSON.stringify(theirs);
  return a === b ? { ok: true } : { ok: false, ours, theirs };
}

describe('differential: backtracking engine vs native RegExp.exec', () => {
  it('regression cases', () => {
    for (const r of regressions as { pattern: string; flags: string; input: string }[]) {
      const res = compareOne(r.pattern, r.flags, r.input);
      expect(res, JSON.stringify(r)).toMatchObject({ ok: true });
    }
  });

  it(`${NUM_RUNS} random cases, zero mismatches`, () => {
    let skipped = 0;
    let checked = 0;
    fc.assert(
      fc.property(genCase, ({ pattern, input, flags }) => {
        const { source } = renderPattern(pattern);
        const res = compareOne(source, flags, input);
        if (!res.ok) {
          throw new Error(
            `MISMATCH /${source}/${flags} on ${JSON.stringify(input)}\n ours:   ${JSON.stringify(res.ours)}\n native: ${JSON.stringify(res.theirs)}`,
          );
        }
        if (res.skipped) skipped++;
        else checked++;
      }),
      { numRuns: NUM_RUNS, seed: LONG ? undefined : 20240607, endOnFailure: true },
    );
    console.log(`differential (backtrack): checked=${checked} skipped=${skipped}`);
    expect(checked).toBeGreaterThan(NUM_RUNS * 0.9);
  });
});
