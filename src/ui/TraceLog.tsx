import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { PlaybackStore } from '../playback/store.ts';
import { copy } from '../copy.ts';
import { describeEvent, formatLog, LOG_WINDOW } from '../playback/traceLog.ts';

/**
 * The screen-reader-friendly view of the run: every engine step as a plain sentence, in a drawer.
 * Rows are windowed around the playhead; clicking a row seeks the transport to that step.
 */
export default function TraceLog({
  store,
  input,
  reducedMotion,
}: {
  store: PlaybackStore;
  input: string;
  reducedMotion: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [paged, setPaged] = useState<number | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const program = useStore(store, (s) => s.program);
  const trace = useStore(store, (s) => s.trace);
  const eventIndex = useStore(store, (s) => s.eventIndex);

  const length = trace?.length ?? 0;
  const maxFrom = Math.max(0, length - LOG_WINDOW);
  const followFrom = Math.max(0, Math.min(eventIndex - (LOG_WINDOW - 40), maxFrom));
  const from = paged === null ? followFrom : Math.max(0, Math.min(paged, maxFrom));
  const to = Math.min(length, from + LOG_WINDOW);
  const following = paged === null;

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (copied === 'idle') return;
    const timer = window.setTimeout(() => setCopied('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!open || !following) return;
    const current = listRef.current?.querySelector('[aria-current="true"]');
    current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [open, following, eventIndex, reducedMotion]);

  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  async function copyAll() {
    if (!program || !trace) return;
    try {
      await navigator.clipboard.writeText(formatLog(program, input, trace));
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <>
      <button
        type="button"
        ref={toggleRef}
        className="trace-log-toggle"
        aria-expanded={open}
        aria-controls="trace-log-drawer"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 5h12M4 10h12M4 15h8" />
        </svg>
        {copy.traceLog.toggle}
      </button>
      {open && (
        <section
          id="trace-log-drawer"
          className="trace-log-drawer"
          aria-label={copy.traceLog.label}
          data-testid="trace-log"
          data-from={from}
          data-to={to}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <header className="trace-log-header">
            <h2>{copy.traceLog.label}</h2>
            <div className="trace-log-actions">
              <button type="button" onClick={() => void copyAll()} disabled={!trace || length === 0}>
                {copy.traceLog.copyAll}
              </button>
              <button type="button" ref={closeRef} aria-label={copy.traceLog.close} onClick={close}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>
          </header>
          <p className="trace-log-status" role="status" aria-live="polite">
            {copied === 'done' ? copy.traceLog.copied : copied === 'failed' ? copy.traceLog.failed : ''}
          </p>
          {!trace || length === 0 ? (
            <p className="trace-log-empty">{copy.traceLog.empty}</p>
          ) : (
            <>
              {trace.truncated && <p className="trace-log-note">{copy.traceLog.truncated}</p>}
              <div className="trace-log-pager">
                <button
                  type="button"
                  disabled={from === 0}
                  onClick={() => setPaged(Math.max(0, from - LOG_WINDOW))}
                >
                  ↑ {copy.traceLog.earlier}
                </button>
                <button type="button" disabled={following} onClick={() => setPaged(null)}>
                  {copy.traceLog.jumpToPlayhead}
                </button>
                <button
                  type="button"
                  disabled={to >= length}
                  onClick={() => setPaged(Math.min(maxFrom, from + LOG_WINDOW))}
                >
                  ↓ {copy.traceLog.later}
                </button>
              </div>
              <ol ref={listRef} className="trace-log-list" start={from + 1}>
                {Array.from({ length: to - from }, (_, i) => {
                  const index = from + i;
                  const text = describeEvent(program!, input, trace, index);
                  return (
                    <li key={index}>
                      <button
                        type="button"
                        aria-current={index === eventIndex}
                        aria-label={copy.traceLog.seek(index, text)}
                        onClick={() => store.getState().seekEvent(index)}
                      >
                        <span className="trace-log-step">{index + 1}</span>
                        {text}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>
      )}
    </>
  );
}
