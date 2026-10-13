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
import { linearEligibility } from './playback/linear.ts';
import type { ViewMode } from './playback/usePlayback.ts';
import type { Program } from './engine/ir.ts';
import { parsePattern, PatternError, PATTERN_MAX, STRING_MAX } from './engine/parse.ts';
import DebugLayout from './layout/DebugLayout.tsx';
import { DEFAULT_PRESET, PRESETS, type Preset } from './presets.ts';
import PatternField from './ui/PatternField.tsx';
import PresetSheet from './ui/PresetSheet.tsx';

const Workshop = lazy(() => import('./scene/Workshop.tsx'));
const LegendSheet = lazy(() => import('./ui/LegendSheet.tsx'));
const HowItWorks = lazy(() => import('./ui/HowItWorks.tsx'));
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
  const [expanded, setExpanded] = useState(() => !window.matchMedia('(max-width: 640px)').matches);
  const [resetKey, setResetKey] = useState(0);
  const [mode, setMode] = useState<ViewMode>(initial.mode);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [sheet, setSheet] = useState<'legend' | 'how' | null>(null);
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
  const eligibility = useMemo(() => (parsed.program ? linearEligibility(parsed.program) : null), [parsed.program]);
  const splitAvailable = eligibility?.ok ?? false;
  const effectiveMode: ViewMode = mode === 'split' && splitAvailable ? 'split' : 'single';
  const preset = PRESETS.find(
    (item) => item.pattern === draft.pattern && item.flags === draft.flags && item.input === input,
  );

  const share = useMemo<ShareState>(
    () => ({ pattern: draft.pattern, flags: draft.flags, input, mode }),
    [draft.pattern, draft.flags, input, mode],
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
      setMode(next.mode);
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

  async function copyLink() {
    const url = shareUrl(share, window.location);
    if (window.location.hash !== encodeShare(share)) window.history.replaceState(null, '', encodeShare(share));
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
              mode={effectiveMode}
              onHelp={() => setSheet('how')}
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
          <div className="preset-picker">
            <span className="preset-picker-label" id="presets-label">
              {copy.presetsLabel}
            </span>
            <button
              type="button"
              className="preset-open"
              aria-labelledby="presets-label"
              aria-expanded={presetsOpen}
              data-current-preset={preset?.id}
              onClick={() => setPresetsOpen(true)}
            >
              <span>{preset ? copy.presetOption(preset.number, preset.label) : copy.customPreset}</span>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6 8l4 4 4-4" />
              </svg>
            </button>
          </div>
          {presetsOpen && (
            <PresetSheet current={preset} onSelect={selectPreset} onClose={() => setPresetsOpen(false)} />
          )}
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
          <div className="field-row field-row--pattern">
            <div className="field-heading">
              <label htmlFor="pattern">{copy.patternLabel}</label>
              <span className="field-count">{copy.characterCount(draft.pattern.length, PATTERN_MAX)}</span>
            </div>
            <PatternField
              value={draft.pattern}
              flags={draft.flags}
              program={parsed.program}
              error={error}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  pattern: event.target.value.slice(0, PATTERN_MAX),
                }))
              }
            />
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
            <div className="field-heading">
              <label htmlFor="test-string">{copy.inputLabel}</label>
              <span className="field-count">{copy.characterCount(input.length, STRING_MAX)}</span>
            </div>
            <textarea
              id="test-string"
              rows={1}
              value={input}
              maxLength={STRING_MAX}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              onChange={(event) => setInput(event.target.value.slice(0, STRING_MAX))}
            />
          </div>

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

      <section className="tool-rail" aria-label={copy.toolsLabel}>
        <fieldset className="mode-toggle" aria-describedby={splitAvailable ? undefined : 'mode-note'} data-mode={effectiveMode}>
          <legend className="sr-only">{copy.split.label}</legend>
          {(['single', 'split'] as const).map((option) => (
            <button
              type="button"
              key={option}
              className="mode-option"
              aria-pressed={effectiveMode === option}
              disabled={option === 'split' && !splitAvailable}
              onClick={() => setMode(option)}
            >
              {option === 'single' ? copy.split.single : copy.split.sideBySide}
            </button>
          ))}
        </fieldset>
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
        {eligibility && !eligibility.ok && (
          <p id="mode-note" className="mode-note" role="status">
            {copy.split.unavailable(eligibility.message)}
          </p>
        )}
      </section>

      <footer className="workshop-footer">
        <div className="learn-row">
          <button type="button" onClick={() => setSheet('legend')}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 5h9M3 10h14M3 15h6" />
            </svg>
            {copy.legendTitle}
          </button>
          <button type="button" onClick={() => setSheet('how')}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 4h12v12H4zM7.5 8.5h5M7.5 11.5h5" />
            </svg>
            {copy.howItWorksTitle}
          </button>
        </div>
        <button type="button" className="reset-view" onClick={() => setResetKey((key) => key + 1)}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 7a6 6 0 1 1 0 7M4 2v5h5" />
          </svg>
          {copy.resetView}
        </button>
      </footer>
      {sheet !== null && (
        <Suspense fallback={null}>
          {sheet === 'legend' ? (
            <LegendSheet onClose={() => setSheet(null)} />
          ) : (
            <HowItWorks onClose={() => setSheet(null)} />
          )}
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
