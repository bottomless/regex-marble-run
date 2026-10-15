import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { copy } from './copy.ts';
import { decodeShare, encodeShare, shareUrl, type ShareState } from './share.ts';
import type { Program } from './engine/ir.ts';
import { parsePattern, PatternError, PATTERN_MAX, STRING_MAX } from './engine/parse.ts';
import DebugLayout from './layout/DebugLayout.tsx';
import { DEFAULT_PRESET, PRESETS, type Preset } from './presets.ts';
import PatternField from './ui/PatternField.tsx';
import PresetSheet from './ui/PresetSheet.tsx';
import StringField from './ui/StringField.tsx';

const Workshop = lazy(() => import('./scene/Workshop.tsx'));
const LegendSheet = lazy(() => import('./ui/LegendSheet.tsx'));
const OgView = lazy(() => import('./ui/OgView.tsx'));
const FLAG_OPTIONS = ['i', 'm', 's', 'u', 'v', 'y'] as const;
const DEFAULT_DEBUG_PATTERN = '^(a+)+$';
const SHARE_DEBOUNCE_MS = 250;
const DEFAULT_SHARE: ShareState = {
  pattern: DEFAULT_PRESET.pattern,
  flags: DEFAULT_PRESET.flags,
  input: DEFAULT_PRESET.input,
  mode: 'single',
};

function initialShare(): ShareState {
  return decodeShare(window.location.hash, DEFAULT_SHARE) ?? DEFAULT_SHARE;
}

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

function WorkshopApp() {
  const [initial] = useState(initialShare);
  const [draft, setDraft] = useState({ pattern: initial.pattern, flags: initial.flags });
  const [input, setInput] = useState(initial.input);
  const [resetKey, setResetKey] = useState(0);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const presetsRef = useRef<HTMLDivElement>(null);
  const flagsRef = useRef<HTMLDetailsElement>(null);
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const mobile = useMediaQuery('(max-width: 760px)');
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

  const share = useMemo<ShareState>(
    () => ({ pattern: draft.pattern, flags: draft.flags, input, mode: 'single' }),
    [draft.pattern, draft.flags, input],
  );
  const shareRef = useRef(share);
  useEffect(() => {
    shareRef.current = share;
    const hash = encodeShare(share);
    if (window.location.hash === hash) return;
    const timer = window.setTimeout(() => {
      if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
    }, SHARE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [share]);
  useEffect(() => {
    function onHashChange() {
      const next = decodeShare(window.location.hash, shareRef.current);
      if (!next || encodeShare(next) === encodeShare(shareRef.current)) return;
      setDraft({ pattern: next.pattern, flags: next.flags });
      setInput(next.input);
      setResetKey((key) => key + 1);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (copied === 'idle') return;
    const timer = window.setTimeout(() => setCopied('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    function closePopovers(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const presets = presetsRef.current;
      if (presets && !presets.contains(target)) {
        setPresetsOpen(false);
      }
      const details = flagsRef.current;
      if (details && !details.contains(target)) {
        details.open = false;
      }
    }
    document.addEventListener('pointerdown', closePopovers);
    return () => document.removeEventListener('pointerdown', closePopovers);
  }, []);

  async function copyLink() {
    const url = shareUrl(share, window.location);
    if (window.location.hash !== encodeShare(share))
      window.history.replaceState(null, '', encodeShare(share));
    try {
      await navigator.clipboard.writeText(url);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  }

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

  const resetButton = (
    <button
      type="button"
      className="reset-view"
      aria-label={copy.resetView}
      title={copy.resetView}
      onClick={() => setResetKey((key) => key + 1)}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 7a6 6 0 1 1 0 7M4 2v5h5" />
      </svg>
    </button>
  );

  return (
    <main id="app-root" className="workshop-shell" data-theme={dark ? 'dark' : 'light'}>
      <section className="workshop-stage" aria-label={copy.machine} aria-busy={pending}>
        {mobile && resetButton}
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
              onHelp={() => setGuideOpen(true)}
            />
          </Suspense>
        ) : (
          <p className="stage-message">{copy.editToBuild}</p>
        )}
      </section>

      <header className="brand-header">
        <h1>{copy.brand}</h1>
        <a
          className="brand-repo"
          href={copy.repo.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={copy.repo.label}
        >
          <svg className="github-mark" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span>{copy.repo.text}</span>
        </a>
      </header>

      <section className="control-island" aria-label={copy.controls}>
        <div id="control-fields" className="control-fields">
          <div className="field-row field-row--pattern">
            <label htmlFor="pattern" className="sr-only">
              {copy.patternLabel}
            </label>
            <div className={`pattern-editor${error ? ' pattern-editor--invalid' : ''}`}>
              <div
                ref={presetsRef}
                className="preset-picker"
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && presetsOpen) {
                    event.preventDefault();
                    setPresetsOpen(false);
                    event.currentTarget.querySelector<HTMLButtonElement>('.preset-open')?.focus();
                  }
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setPresetsOpen(false);
                }}
              >
                <button
                  type="button"
                  className="preset-open"
                  aria-label={copy.presetsLabel}
                  aria-expanded={presetsOpen}
                  data-current-preset={preset?.id}
                  onClick={() => setPresetsOpen((open) => !open)}
                >
                  <svg className="preset-grid-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="5" cy="4.5" r="1.2" />
                    <circle cx="11" cy="4.5" r="1.2" />
                    <circle cx="5" cy="8" r="1.2" />
                    <circle cx="11" cy="8" r="1.2" />
                    <circle cx="5" cy="11.5" r="1.2" />
                    <circle cx="11" cy="11.5" r="1.2" />
                  </svg>
                  <span>{copy.presetsLabel}</span>
                  <svg className="preset-chevron" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M6 8l4 4 4-4" />
                  </svg>
                </button>
                {presetsOpen && (
                  <PresetSheet
                    current={preset}
                    onSelect={selectPreset}
                    onClose={() => setPresetsOpen(false)}
                  />
                )}
              </div>
              <PatternField
                value={draft.pattern}
                program={parsed.program}
                error={error}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    pattern: event.target.value.slice(0, PATTERN_MAX),
                  }))
                }
              />
              <details
                ref={flagsRef}
                className="pattern-options"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector('summary')?.focus();
                  }
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
                }}
              >
                <summary
                  aria-label={`${copy.flagsLabel}: ${draft.flags || copy.noFlags}`}
                  title={copy.flagsLabel}
                >
                  <span className="active-flags" data-active={Boolean(draft.flags)}>
                    {draft.flags || (
                      <svg className="flags-icon" viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M5 17V3m0 1c3-3 7 3 11 0v8c-4 3-8-3-11 0" />
                      </svg>
                    )}
                  </span>
                </summary>
                <div className="flag-panel">
                  <fieldset className="flag-controls" aria-describedby="unicode-hint">
                    <legend className="sr-only">{copy.flagsLabel}</legend>
                    {FLAG_OPTIONS.map((flag) => (
                      <button
                        type="button"
                        key={flag}
                        className="flag-chip"
                        aria-pressed={draft.flags.includes(flag)}
                        aria-label={copy.flagLabel(flag, copy.flags[flag])}
                        onClick={() => toggleFlag(flag)}
                      >
                        <code>{flag}</code>
                        <span>{copy.flags[flag]}</span>
                      </button>
                    ))}
                  </fieldset>
                  <p id="unicode-hint" className="options-hint">
                    {copy.unicodeHint}
                  </p>
                </div>
              </details>
            </div>
            <p id="pattern-hint" className="sr-only">
              {copy.patternHint}
            </p>
          </div>

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

          <div className="field-row field-row--input">
            <StringField
              value={input}
              onChange={(event) => setInput(event.target.value.slice(0, STRING_MAX))}
            />
          </div>
        </div>
      </section>

      <section className="tool-rail" aria-label={copy.toolsLabel}>
        <div className="share-row">
          <button type="button" className="copy-link" onClick={() => void copyLink()} data-copied={copied}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8.5 11.5a3 3 0 0 0 4.2 0l3-3a3 3 0 0 0-4.2-4.2l-1 1" />
              <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-3 3a3 3 0 0 0 4.2 4.2l1-1" />
            </svg>
            {copy.share.copyLink}
          </button>
          <span className="share-status" role="status" aria-live="polite">
            {copied === 'done' ? copy.share.copied : copied === 'failed' ? copy.share.failed : ''}
          </span>
        </div>
      </section>

      <footer className="workshop-footer">
        <button type="button" className="guide-button" onClick={() => setGuideOpen(true)}>
          <span className="guide-icon" aria-hidden="true">
            ?
          </span>
          {copy.guide}
        </button>
        {!mobile && resetButton}
      </footer>
      {guideOpen && (
        <Suspense fallback={null}>
          <LegendSheet onClose={() => setGuideOpen(false)} />
        </Suspense>
      )}
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
  if (params.get('og') === '1') {
    return (
      <Suspense fallback={null}>
        <OgView />
      </Suspense>
    );
  }
  return <WorkshopApp />;
}
