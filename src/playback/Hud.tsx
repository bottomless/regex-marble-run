import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { PlaybackStore } from './store.ts';
import { countersAt, waterlineAt } from './counters.ts';
import { shouldFlood } from './flood.ts';
import { syncLinear } from './linear.ts';
import { captureSpans } from './captures.ts';
import { copy, type ResultReading } from '../copy.ts';
import type { Program } from '../engine/ir.ts';
import { palette } from '../scene/materials.ts';

export interface HudProps {
  store: PlaybackStore;
  reducedMotion: boolean;
  program?: Program;
  input?: string;
  onHelp?: () => void;
}

function clip(text: string, max = 28): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function Hud({ store, reducedMotion, program, input = '', onHelp }: HudProps) {
  const hudRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const hud = hudRef.current;
    if (!hud) return;
    const measure = () => {
      const top = hud.querySelector('.hud-summary')?.getBoundingClientRect().top ?? 0;
      hud.style.setProperty('--details-height', `${Math.max(80, top - 32)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(hud);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, []);
  const counters = useStore(store, (s) => s.counters);
  const eventIndex = useStore(store, (s) => s.eventIndex);
  const attempts = useStore(store, (s) => s.machine?.attempts ?? 0);
  const depth = useStore(store, (s) => s.machine?.flags.length ?? 0);
  const machine = useStore(store, (s) => s.machine);
  const result = useStore(store, (s) => s.result);
  const trace = useStore(store, (s) => s.trace);
  const atEnd = useStore(store, (s) => s.atEnd);
  const playing = useStore(store, (s) => s.playing);
  const native = useStore(store, (s) => s.native);
  const linear = useStore(store, (s) => s.linear);

  const flood = Boolean(result && trace && shouldFlood(result, trace));
  const floodFrame = useStore(store, (s) => s.flood);
  const filling = flood && floodFrame !== null && result !== null && floodFrame.step < result.steps;
  const reading = counters ? countersAt(counters, eventIndex) : { steps: 0, backtracks: 0 };
  const steps = filling ? floodFrame.step : flood && result ? result.steps : reading.steps;
  const backtracks = filling
    ? floodFrame.backtracks
    : flood && result
      ? result.backtracks
      : reading.backtracks;
  const shownAttempts = flood && result ? result.attempts : attempts;

  let rightTests: number | null = null;
  let rightFinished = false;
  if (linear.status === 'ready') {
    const sync = syncLinear(linear.run, counters ? waterlineAt(counters, eventIndex) : 0, atEnd || flood);
    rightFinished = sync.finished;
    rightTests = sync.tick ? sync.tick.cumulativeTests - (sync.finished ? 0 : sync.tick.tests) : 0;
  }

  let outcome: ResultReading = { kind: 'pending' };
  if (result && !filling && (atEnd || flood)) {
    if (result.gaveUp) outcome = { kind: 'gaveUp' };
    else if (result.matched) outcome = { kind: 'match', start: result.index, end: result.end };
    else outcome = { kind: 'nomatch' };
  }
  const status = !trace
    ? copy.hud.status.loading
    : filling
      ? copy.hud.status.playing
      : atEnd || flood
        ? copy.hud.status.finished
        : playing
          ? copy.hud.status.playing
          : copy.hud.status.paused;
  const groups = outcome.kind === 'match' && program ? captureSpans(machine).slice(1) : [];

  return (
    <aside
      ref={hudRef}
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
      <div className="hud-card">
        <div className="hud-summary">
          <dl>
            <div className="hud-item hud-item--result" data-field="result" data-outcome={outcome.kind}>
              <dt>{copy.hud.labels.result}</dt>
              <dd aria-live="polite">
                {outcome.kind === 'pending' ? status : copy.hud.result(outcome)}
                {outcome.kind === 'match' && (
                  <span className="hud-summary-match">
                    {copy.hud.matched(clip(input.slice(outcome.start, outcome.end)))}
                  </span>
                )}
              </dd>
            </div>
            <div className="hud-item" data-field="steps">
              <dt>{copy.hud.labels.steps}</dt>
              <dd>{copy.hud.count(steps)}</dd>
            </div>
            <div className="hud-item" data-field="backtracks">
              <dt>{copy.hud.labels.backtracks}</dt>
              <dd>{copy.hud.count(backtracks)}</dd>
            </div>
          </dl>
          <details className="hud-details">
            <summary>{copy.hud.details}</summary>
            <div className="hud-detail-panel">
              <dl>
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
              </dl>
              <p className="hud-status" data-status={playing || filling ? 'playing' : 'paused'}>
                <span className="hud-status-dot" aria-hidden="true" />
                {status}
                {reducedMotion && <span className="motion-status"> · {copy.reducedMotion}</span>}
              </p>
              {outcome.kind === 'match' && (
                <div className="hud-match">
                  <p className="hud-match-text">
                    {copy.hud.matched(input.slice(outcome.start, outcome.end))}
                  </p>
                  {groups.length > 0 && (
                    <ul className="hud-groups">
                      {groups.map((span, i) => (
                        <li key={i}>
                          <span
                            className="hud-group-swatch"
                            style={{ background: palette.captures[i % palette.captures.length] }}
                            aria-hidden="true"
                          />
                          <span className="hud-group-name">
                            {copy.hud.group(i + 1, program?.groupNames[i + 1] ?? null)}
                          </span>
                          <span className="hud-group-value">
                            {span ? copy.hud.matched(input.slice(span.start, span.end)) : copy.hud.unset}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {onHelp && (
                <button type="button" className="hud-help" onClick={onHelp}>
                  {copy.hud.help}
                </button>
              )}
            </div>
          </details>
        </div>
      </div>
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
    </aside>
  );
}
