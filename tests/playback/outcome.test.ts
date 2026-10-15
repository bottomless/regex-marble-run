import { describe, expect, it } from 'vitest';
import { outcomeOf, sameOutcome } from '../../src/playback/outcome.ts';
import type { PlaybackState } from '../../src/playback/store.ts';

type Source = Parameters<typeof outcomeOf>[0];

const trace = { truncated: false } as unknown as PlaybackState['trace'];
const result = (patch: Partial<NonNullable<PlaybackState['result']>>) =>
  ({
    matched: false,
    index: -1,
    end: -1,
    steps: 10,
    backtracks: 0,
    attempts: 1,
    gaveUp: false,
    ...patch,
  }) as NonNullable<PlaybackState['result']>;

describe('run verdict', () => {
  it('stays pending while the engine is still working', () => {
    const base: Source = {
      result: result({ matched: true, index: 1, end: 3 }),
      trace,
      atEnd: false,
      flood: null,
      machine: null,
    };
    expect(outcomeOf(base)).toEqual({ kind: 'pending' });
    expect(outcomeOf({ ...base, atEnd: true })).toEqual({ kind: 'match', start: 1, end: 3 });
    expect(outcomeOf({ ...base, result: null, atEnd: true })).toEqual({ kind: 'pending' });
  });

  it('settles as soon as the engine reaches its final event, before the closing roll ends', () => {
    const decided = (phase: 'running' | 'matched' | 'nomatch') =>
      ({ phase }) as unknown as PlaybackState['machine'];
    const base = { result: result({}), trace, atEnd: false, flood: null };
    expect(outcomeOf({ ...base, machine: decided('running') })).toEqual({ kind: 'pending' });
    expect(outcomeOf({ ...base, machine: decided('nomatch') })).toEqual({ kind: 'nomatch' });
    expect(
      outcomeOf({
        ...base,
        result: result({ matched: true, index: 0, end: 2 }),
        machine: decided('matched'),
      }),
    ).toEqual({ kind: 'match', start: 0, end: 2 });
  });

  it('reports no match and gave up', () => {
    expect(outcomeOf({ result: result({}), trace, atEnd: true, flood: null, machine: null })).toEqual({
      kind: 'nomatch',
    });
    expect(
      outcomeOf({ result: result({ gaveUp: true }), trace, atEnd: false, flood: null, machine: null }),
    ).toEqual({
      kind: 'gaveUp',
    });
  });

  it('holds a flooding verdict until the tank has filled', () => {
    const big = result({ steps: 1e9 });
    const filling = { step: 5, backtracks: 0 } as unknown as PlaybackState['flood'];
    expect(outcomeOf({ result: big, trace, atEnd: false, flood: filling, machine: null })).toEqual({
      kind: 'pending',
    });
    expect(outcomeOf({ result: big, trace, atEnd: false, flood: null, machine: null })).toEqual({
      kind: 'nomatch',
    });
  });

  it('compares verdicts by kind and span', () => {
    expect(sameOutcome({ kind: 'match', start: 0, end: 2 }, { kind: 'match', start: 0, end: 2 })).toBe(true);
    expect(sameOutcome({ kind: 'match', start: 0, end: 2 }, { kind: 'match', start: 0, end: 3 })).toBe(false);
    expect(sameOutcome({ kind: 'nomatch' }, { kind: 'gaveUp' })).toBe(false);
  });
});
