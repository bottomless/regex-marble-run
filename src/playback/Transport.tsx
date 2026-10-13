import { useStore } from 'zustand';
import type { PlaybackStore } from './store.ts';
import { copy } from '../copy.ts';
import { INSTANT, SPEED_STEPS } from './timeline.ts';

const SPEEDS = [...SPEED_STEPS, INSTANT];

export interface TransportProps {
  store: PlaybackStore;
}

export default function Transport({ store }: TransportProps) {
  const playing = useStore(store, (s) => s.playing);
  const atStart = useStore(store, (s) => s.atStart);
  const atEnd = useStore(store, (s) => s.atEnd);
  const speed = useStore(store, (s) => s.speed);
  const eventIndex = useStore(store, (s) => s.eventIndex);
  const eventCount = useStore(store, (s) => s.eventCount);
  const hasTimeline = useStore(store, (s) => Boolean(s.timeline));

  const disabled = !hasTimeline || eventCount === 0;
  const currentStep = eventCount === 0 ? 0 : Math.max(0, eventIndex + 1);

  return (
    <nav
      className="transport-bar"
      aria-label={copy.transport.label}
      data-testid="transport"
      data-playing={playing}
      data-at-start={atStart}
      data-at-end={atEnd}
      data-event-index={eventIndex}
      data-event-count={eventCount}
      data-speed={speed}
    >
      <div className="transport-group" role="group" aria-label={copy.transport.label}>
        <button
          type="button"
          className="transport-btn"
          aria-label={copy.transport.restart}
          title={copy.transport.restart}
          disabled={disabled || atStart}
          onClick={() => store.getState().restart()}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M5 10a5 5 0 1 0 1.5-3.5M5 5v5h5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          type="button"
          className="transport-btn"
          aria-label={copy.transport.stepBack}
          title={copy.transport.stepBack}
          disabled={disabled || atStart}
          onClick={() => store.getState().stepBack()}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 4.5v11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M15 4.5l-8 5.5 8 5.5z" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          className="transport-btn transport-btn--primary"
          aria-label={playing ? copy.transport.pause : copy.transport.play}
          title={playing ? copy.transport.pause : copy.transport.play}
          disabled={disabled}
          onClick={() => store.getState().toggle()}
        >
          {playing ? (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <rect x="5.5" y="4.5" width="3" height="11" rx="0.5" fill="currentColor" />
              <rect x="11.5" y="4.5" width="3" height="11" rx="0.5" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M6.5 4.5l9 5.5-9 5.5z" fill="currentColor" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="transport-btn"
          aria-label={copy.transport.stepForward}
          title={copy.transport.stepForward}
          disabled={disabled || atEnd}
          onClick={() => store.getState().stepForward()}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M16 4.5v11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M5 4.5l8 5.5-8 5.5z" fill="currentColor" />
          </svg>
        </button>
      </div>

      <div className="transport-divider" aria-hidden="true" />

      <div className="transport-scrubber">
        <input
          type="range"
          min={0}
          max={Math.max(1, eventCount - 1)}
          value={Math.max(0, eventIndex)}
          disabled={disabled}
          aria-label={copy.transport.scrubber}
          aria-valuetext={copy.transport.stepCount(currentStep, eventCount)}
          onChange={(e) => store.getState().seekEvent(Number(e.target.value))}
        />
        <span
          className="transport-counter"
          aria-label={copy.transport.stepCount(currentStep, eventCount)}
        >
          {currentStep}/{eventCount}
        </span>
      </div>

      <div className="transport-divider" aria-hidden="true" />

      <div className="transport-speeds" role="group" aria-label={copy.transport.speed}>
        {SPEEDS.map((s) => (
          <button
            type="button"
            key={s}
            className="transport-speed-btn"
            aria-pressed={speed === s}
            aria-label={`${copy.transport.speed} ${copy.transport.speedOption(s)}`}
            disabled={disabled}
            onClick={() => store.getState().setSpeed(s)}
          >
            {copy.transport.speedOption(s)}
          </button>
        ))}
      </div>
    </nav>
  );
}
