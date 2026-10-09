import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { copy } from './copy.ts';
import type { Program } from './engine/ir.ts';
import { parsePattern, PatternError, PATTERN_MAX, STRING_MAX } from './engine/parse.ts';
import DebugLayout from './layout/DebugLayout.tsx';
import { DEFAULT_PRESET, PRESETS, type Preset } from './presets.ts';

const Workshop = lazy(() => import('./scene/Workshop.tsx'));
const FLAG_OPTIONS = ['i', 'm', 's', 'u', 'v', 'y'] as const;
const DEFAULT_DEBUG_PATTERN = '^(a+)+$';

type Parsed =
  { program: Program; error: null } | { program: null; error: { message: string; index: number } };

function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    [query],
  );
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

function PieceIcon({ kind }: { kind: (typeof copy.legend)[number]['kind'] }) {
  return (
    <svg className={`piece-icon piece-icon--${kind}`} viewBox="0 0 20 20" aria-hidden="true">
      {kind === 'gate' && <path d="M4 17V9a6 6 0 0 1 12 0v8M2 17h5m6 0h5" />}
      {kind === 'fork' && <path d="M10 3v5m0 0-6 6v3m6-9 6 6v3" />}
      {kind === 'loop' && <path d="M15 6a6 6 0 1 0 1 7M15 2v5h-5" />}
      {kind === 'capture' && <path d="M7 3H3v14h4m6-14h4v14h-4M7 10h6" />}
      {kind === 'sensor' && (
        <>
          <circle cx="10" cy="8" r="4" />
          <path d="M10 12v5M6 17h8" />
        </>
      )}
    </svg>
  );
}

function WorkshopApp() {
  const [draft, setDraft] = useState({ pattern: DEFAULT_PRESET.pattern, flags: DEFAULT_PRESET.flags });
  const [input, setInput] = useState(DEFAULT_PRESET.input);
  const [expanded, setExpanded] = useState(() => !window.matchMedia('(max-width: 640px)').matches);
  const [resetKey, setResetKey] = useState(0);
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const deferredDraft = useDeferredValue(draft);
  const pending = deferredDraft !== draft;
  const parsed = useMemo<Parsed>(() => {
    try {
      return { program: parsePattern(deferredDraft.pattern, deferredDraft.flags), error: null };
    } catch (error) {
      return {
        program: null,
        error: {
          message: error instanceof Error ? error.message : copy.unknownError,
          index: error instanceof PatternError ? error.index : 0,
        },
      };
    }
  }, [deferredDraft]);
  const error = pending ? null : parsed.error;
  const preset = PRESETS.find(
    (item) => item.pattern === draft.pattern && item.flags === draft.flags && item.input === input,
  );

  function selectPreset(next: Preset) {
    setDraft({ pattern: next.pattern, flags: next.flags });
    setInput(next.input.slice(0, STRING_MAX));
    setResetKey((key) => key + 1);
  }

  function toggleFlag(flag: (typeof FLAG_OPTIONS)[number]) {
    setDraft((current) => {
      const flags = new Set(current.flags);
      if (flags.has(flag)) {
        flags.delete(flag);
      } else {
        flags.add(flag);
        if (flag === 'u') flags.delete('v');
        if (flag === 'v') flags.delete('u');
      }
      return { ...current, flags: FLAG_OPTIONS.filter((option) => flags.has(option)).join('') };
    });
  }

  return (
    <main id="app-root" className="workshop-shell" data-theme={dark ? 'dark' : 'light'}>
      <section className="workshop-stage" aria-label={copy.machine} aria-busy={pending}>
        {parsed.program ? (
          <Suspense
            fallback={
              <p className="stage-message" role="status">
                {copy.building}
              </p>
            }
          >
            <Workshop
              program={parsed.program}
              input={input}
              dark={dark}
              reducedMotion={reducedMotion}
              resetKey={resetKey}
            />
          </Suspense>
        ) : (
          <p className="stage-message">{copy.editToBuild}</p>
        )}
      </section>

      <section className="control-island" aria-label={copy.controls} data-expanded={expanded}>
        <header className="brand-header">
          <p className="edition">{copy.edition}</p>
          <div className="brand-line">
            <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true">
              <path d="M7 5v7l14 7v5M7 12l-3 8" />
              <circle cx="7" cy="5" r="3" />
              <circle cx="21" cy="23" r="3" />
            </svg>
            <h1>{copy.brand}</h1>
          </div>
          <p className="descriptor">{copy.descriptor}</p>
          <div className="collapsed-preview">
            <span>
              <span className="sr-only">
                {copy.patternLabel}
                {': '}
              </span>
              <code>
                {draft.pattern}
                {draft.flags && ` / ${draft.flags}`}
              </code>
            </span>
            <span>
              <span className="sr-only">
                {copy.inputLabel}
                {': '}
              </span>
              <code>{input}</code>
            </span>
          </div>
          <button
            type="button"
            className="controls-toggle"
            aria-expanded={expanded}
            aria-controls="control-fields"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? copy.collapseControls : copy.expandControls}
            <span aria-hidden="true">{expanded ? '−' : '+'}</span>
          </button>
        </header>

        <div id="control-fields" className="control-fields">
          <div className="preset-picker">
            <label htmlFor="preset">{copy.presetsLabel}</label>
            <select
              id="preset"
              value={preset?.id ?? ''}
              onChange={(event) => {
                const next = PRESETS.find((item) => item.id === event.target.value);
                if (next) selectPreset(next);
              }}
            >
              <option value="" disabled>
                {copy.customPreset}
              </option>
              {PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {copy.presetOption(item.number, item.label)}
                </option>
              ))}
            </select>
          </div>

          <div className="field-heading">
            <label htmlFor="pattern">{copy.patternLabel}</label>
            <span className="field-count">{copy.characterCount(draft.pattern.length, PATTERN_MAX)}</span>
          </div>
          <div className={`pattern-capsule${error ? ' pattern-capsule--invalid' : ''}`}>
            <span className="pattern-delimiter" aria-hidden="true">
              {copy.syntax.slash}
            </span>
            <input
              id="pattern"
              type="text"
              value={draft.pattern}
              maxLength={PATTERN_MAX}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'pattern-hint pattern-error' : 'pattern-hint'}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  pattern: event.target.value.slice(0, PATTERN_MAX),
                }))
              }
            />
            <span className="pattern-delimiter" aria-hidden="true">
              {copy.syntax.slash}
            </span>
            {draft.flags && (
              <span className="pattern-flags" aria-hidden="true">
                {draft.flags}
              </span>
            )}
          </div>
          <p id="pattern-hint" className="sr-only">
            {copy.patternHint}
          </p>

          <fieldset className="flag-controls" aria-describedby="unicode-hint">
            <legend className="sr-only">{copy.flagsLabel}</legend>
            <span className="flags-label" aria-hidden="true">
              {copy.flagsLabel}
            </span>
            {FLAG_OPTIONS.map((flag) => (
              <button
                type="button"
                key={flag}
                className="flag-chip"
                aria-pressed={draft.flags.includes(flag)}
                aria-label={copy.flagLabel(flag, copy.flags[flag])}
                title={copy.flags[flag]}
                onClick={() => toggleFlag(flag)}
              >
                {flag}
              </button>
            ))}
            {(['g', 'd'] as const).map((flag) => (
              <button
                type="button"
                key={flag}
                className="flag-chip flag-chip--unavailable"
                disabled
                title={copy.unavailableFlags[flag]}
                aria-label={copy.flagLabel(flag, copy.unavailableFlags[flag])}
              >
                {flag}
              </button>
            ))}
          </fieldset>
          <p id="unicode-hint" className="sr-only">
            {copy.unicodeHint}
          </p>

          {error && (
            <div id="pattern-error" className="pattern-error" role="status">
              <p>
                <strong>{copy.parserError(error.index)}</strong>
                {': '}
                {error.message}
              </p>
              <pre aria-hidden="true">
                {draft.pattern}
                {'\n'}
                {' '.repeat(Math.min(error.index, PATTERN_MAX))}
                {copy.syntax.caret}
              </pre>
            </div>
          )}

          <div className="field-heading">
            <label htmlFor="test-string">{copy.inputLabel}</label>
            <span className="field-count">{copy.characterCount(input.length, STRING_MAX)}</span>
          </div>
          <textarea
            id="test-string"
            rows={2}
            value={input}
            maxLength={STRING_MAX}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            onChange={(event) => setInput(event.target.value.slice(0, STRING_MAX))}
          />

          <div className="preset-note">
            <p>{preset?.caption ?? copy.customCaption}</p>
            {preset?.source && (
              <a href={preset.source} target="_blank" rel="noopener noreferrer">
                {copy.source}
              </a>
            )}
          </div>
        </div>
      </section>

      <aside className="stage-status" aria-label={copy.stageStatus}>
        <span className="status-pin" aria-hidden="true" />
        <span>{copy.stageStatus}</span>
        {reducedMotion && <span className="motion-status">{copy.reducedMotion}</span>}
      </aside>

      <footer className="workshop-footer">
        <ul className="piece-legend" aria-label={copy.legendLabel}>
          {copy.legend.map((piece) => (
            <li key={piece.kind} title={piece.detail}>
              <PieceIcon kind={piece.kind} />
              <span>{piece.label}</span>
              <span className="sr-only">
                {': '}
                {piece.detail}
              </span>
            </li>
          ))}
        </ul>
        <div className="view-tools">
          <div className="orbit-hints">
            <p>{copy.orbitPointer}</p>
            <p>{copy.orbitKeyboard}</p>
          </div>
          <button type="button" className="reset-view" onClick={() => setResetKey((key) => key + 1)}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 7a6 6 0 1 1 0 7M4 2v5h5" />
            </svg>
            {copy.resetView}
          </button>
        </div>
      </footer>
    </main>
  );
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === 'layout') {
    return (
      <DebugLayout
        pattern={params.get('p') ?? DEFAULT_DEBUG_PATTERN}
        flags={params.get('flags') ?? params.get('f') ?? ''}
      />
    );
  }
  return <WorkshopApp />;
}
