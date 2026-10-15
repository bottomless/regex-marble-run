import type { ResultReading } from '../copy.ts';
import { shouldFlood } from './flood.ts';
import type { PlaybackState } from './store.ts';

type OutcomeSource = Pick<PlaybackState, 'result' | 'trace' | 'atEnd' | 'flood' | 'machine'>;

/** Whether a flooding run is still filling its tank (the verdict is held back until it settles). */
export function isFilling(state: OutcomeSource): boolean {
  const { result, trace, flood } = state;
  if (!result || !trace || !shouldFlood(result, trace)) return false;
  return flood !== null && flood.step < result.steps;
}

/**
 * The run's verdict as the visitor should see it: pending while the engine is still working (or the
 * flood is still filling), then match / no match / gave up as soon as playback reaches the engine's
 * final event. That is the start of the closing roll into the cup, not the end of the timeline: the
 * closing segment is padded for the marble cascade and would otherwise hold the answer back for
 * seconds after the machine has visibly settled.
 */
export function outcomeOf(state: OutcomeSource): ResultReading {
  const { result, trace, atEnd, machine } = state;
  if (!result || !trace) return { kind: 'pending' };
  const flood = shouldFlood(result, trace);
  const decided = machine?.phase === 'matched' || machine?.phase === 'nomatch';
  if (isFilling(state) || !(atEnd || flood || decided)) return { kind: 'pending' };
  if (result.gaveUp) return { kind: 'gaveUp' };
  if (result.matched) return { kind: 'match', start: result.index, end: result.end };
  return { kind: 'nomatch' };
}

export function sameOutcome(a: ResultReading, b: ResultReading): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'match' && b.kind === 'match') return a.start === b.start && a.end === b.end;
  return true;
}
