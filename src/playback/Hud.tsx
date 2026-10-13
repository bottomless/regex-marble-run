import { useStore } from 'zustand';
import type { PlaybackStore } from './store.ts';
import { countersAt, waterlineAt } from './counters.ts';
import { shouldFlood } from './flood.ts';
import { syncLinear } from './linear.ts';
import { copy, type ResultReading } from '../copy.ts';

export interface HudProps {
  store: PlaybackStore;
  reducedMotion: boolean;
}

/**
 * Small top-right readout of the run: steps and backtracks counted up to the current event, attempts,
 * flag stack depth, the browser's own RegExp time for the same input, and the final result once the
 * playhead reaches the end. Flooded runs show their engine totals directly.
 */
export default function Hud({ store, reducedMotion }: HudProps) {
  const counters = useStore(store, (s) => s.counters);
  const eventIndex = useStore(store, (s) => s.eventIndex);
  const attempts = useStore(store, (s) => s.machine?.attempts ?? 0);
  const depth = useStore(store, (s) => s.machine?.flags.length ?? 0);
  const result = useStore(store, (s) => s.result);
  const trace = useStore(store, (s) => s.trace);
  const atEnd = useStore(store, (s) => s.atEnd);
  const native = useStore(store, (s) => s.native);
  const linear = useStore(store, (s) => s.linear);

  const flood = Boolean(result && trace && shouldFlood(result, trace));
  const reading = counters ? countersAt(counters, eventIndex) : { steps: 0, backtracks: 0 };
  const steps = flood && result ? result.steps : reading.steps;
  const backtracks = flood && result ? result.backtracks : reading.backtracks;
  const shownAttempts = flood && result ? result.attempts : attempts;

  let rightTests: number | null = null;
  let rightFinished = false;
  if (linear.status === 'ready') {
    const sync = syncLinear(linear.run, counters ? waterlineAt(counters, eventIndex) : 0, atEnd || flood);
    rightFinished = sync.finished;
    rightTests = sync.tick ? sync.tick.cumulativeTests - (sync.finished ? 0 : sync.tick.tests) : 0;
  }

  let outcome: ResultReading = { kind: 'pending' };
  if (result && (atEnd || flood)) {
    if (result.gaveUp) outcome = { kind: 'gaveUp' };
    else if (result.matched) outcome = { kind: 'match', start: result.index, end: result.end };
    else outcome = { kind: 'nomatch' };
  }

  return (
    <aside
      className="hud"
      aria-label={copy.hud.label}
      data-testid="hud"
      data-steps={steps}
      data-backtracks={backtracks}
      data-attempts={shownAttempts}
      data-depth={depth}
      data-native={native?.status ?? 'idle'}
      data-native-ms={native?.status === 'success' ? native.elapsedMs.toFixed(3) : undefined}
      data-result={outcome.kind}
      data-split={linear.status}
      data-right-steps={rightTests ?? undefined}
      data-right-finished={rightTests === null ? undefined : rightFinished}
    >
      <dl>
        <div className="hud-item" data-field="steps">
          <dt>{copy.hud.labels.steps}</dt>
          <dd>{copy.hud.count(steps)}</dd>
        </div>
        <div className="hud-item" data-field="backtracks">
          <dt>{copy.hud.labels.backtracks}</dt>
          <dd>{copy.hud.count(backtracks)}</dd>
        </div>
        <div className="hud-item" data-field="attempts">
          <dt>{copy.hud.labels.attempts}</dt>
          <dd>{copy.hud.count(shownAttempts)}</dd>
        </div>
        <div className="hud-item" data-field="flags">
          <dt>{copy.hud.labels.flags}</dt>
          <dd>{copy.hud.count(depth)}</dd>
        </div>
        <div className="hud-item" data-field="native">
          <dt>{copy.hud.labels.native}</dt>
          <dd>{native ? copy.hud.nativeTime(native) : '—'}</dd>
        </div>
        <div className="hud-item hud-item--result" data-field="result">
          <dt>{copy.hud.labels.result}</dt>
          <dd aria-live="polite">{copy.hud.result(outcome)}</dd>
        </div>
      </dl>
      {linear.status !== 'off' && (
        <div className="hud-split" data-status={linear.status}>
          {linear.status === 'ready' && rightTests !== null ? (
            <>
              <div className="hud-side" data-side="left">
                <span className="hud-side-name">{copy.split.left}</span>
                <span className="hud-side-engines">{copy.split.leftEngines}</span>
                <span className="hud-side-count">{copy.split.sideSteps(steps)}</span>
              </div>
              <div className="hud-side" data-side="right">
                <span className="hud-side-name">{copy.split.right}</span>
                <span className="hud-side-engines">{copy.split.rightEngines}</span>
                <span className="hud-side-count">{copy.split.sideSteps(rightTests)}</span>
              </div>
              <p className="hud-ratio" title={copy.split.footnote}>
                {copy.split.ratio(steps, rightTests)}
              </p>
            </>
          ) : (
            <p className="hud-ratio" role="status">
              {linear.status === 'running'
                ? copy.split.running
                : linear.status === 'unavailable'
                  ? copy.split.unavailable(linear.message)
                  : linear.status === 'error'
                    ? copy.split.error(linear.message)
                    : null}
            </p>
          )}
        </div>
      )}
      {reducedMotion && <span className="motion-status">{copy.reducedMotion}</span>}
    </aside>
  );
}
