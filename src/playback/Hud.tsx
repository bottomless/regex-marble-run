import { useStore } from 'zustand';
import type { PlaybackStore } from './store.ts';
import { countersAt, waterlineAt } from './counters.ts';
import { shouldFlood } from './flood.ts';
import { syncLinear } from './linear.ts';
import { captureSpans } from './captures.ts';
import { copy } from '../copy.ts';
import { outcomeOf } from './outcome.ts';
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

  const outcome = outcomeOf({ result, trace, atEnd, flood: floodFrame, machine });
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
          <div className="hud-item hud-item--result" data-field="result" data-outcome={outcome.kind}>
            <dt>{copy.hud.labels.result}</dt>
            <dd aria-live="polite">
              <span
                className="hud-status-dot"
                data-status={playing || filling ? 'playing' : outcome.kind}
                aria-hidden="true"
              />
              <span className="hud-result-label">
                {outcome.kind === 'pending' ? status : copy.hud.result(outcome)}
              </span>
              {outcome.kind === 'match' && (
                <span className="hud-summary-match">
                  {copy.hud.matched(clip(input.slice(outcome.start, outcome.end)))}
                </span>
              )}
            </dd>
          </div>
        </dl>
        {outcome.kind === 'match' && groups.length > 0 && (
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
                  {span ? copy.hud.matched(clip(input.slice(span.start, span.end), 18)) : copy.hud.unset}
                </span>
              </li>
            ))}
          </ul>
        )}
        {reducedMotion && <p className="motion-status">{copy.reducedMotion}</p>}
        {onHelp && (
          <button type="button" className="hud-help" onClick={onHelp}>
            {copy.hud.help}
          </button>
        )}
      </div>
    </aside>
  );
}
