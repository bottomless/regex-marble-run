import type { MachineState } from './state.ts';

export type TileStatus = 'pending' | 'consumed' | 'head';

/**
 * Classify one input-rail tile for a given playback machine state.
 *
 * A tile counts as consumed once the current attempt's read head has passed it: tiles in
 * `[attemptStart, head)` are claimed by the live execution, and on `matched`/`nomatch` the terminal
 * `match` span (or the trailing head) keeps them lit. The tile under the head gets the 'head' marker
 * so the current read position is visible while stepping. Scrubbing backward or restarting re-derives
 * this from `(attemptStart, head)` only, so highlights rewind exactly with the state — no history.
 */
export function tileStatus(machine: MachineState | null, index: number): TileStatus {
  if (!machine || index < 0 || machine.attemptStart < 0) return 'pending';
  if (index < machine.attemptStart) return 'pending';
  if (machine.phase === 'matched' && machine.match) {
    if (index >= machine.match.start && index < machine.match.end) {
      return index === machine.head ? 'head' : 'consumed';
    }
    return 'pending';
  }
  if (index >= machine.head) return index === machine.head ? 'head' : 'pending';
  return 'consumed';
}
