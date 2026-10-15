import { useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import { STRING_MAX } from '../engine/parse.ts';
import { copy } from '../copy.ts';
import { segmentInput, useHighlight } from './highlight.ts';

const CAPTURE_COLORS = 4;

/**
 * The test-string textarea with a mirrored backdrop, like the pattern field: the textarea's own text
 * is transparent so the backdrop can paint what the playback has read, where the read head is, which
 * start positions already failed, the final match and the live capture groups. Once the run ends the
 * whole editor takes the verdict's colour and shows a Match / No match stamp.
 */
export default function StringField({
  value,
  onChange,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  const { reading, verdict } = useHighlight();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const segments = useMemo(() => segmentInput(value, reading), [value, reading]);

  function syncScroll() {
    const input = inputRef.current;
    const backdrop = backdropRef.current;
    if (!input || !backdrop) return;
    backdrop.scrollTop = input.scrollTop;
    backdrop.scrollLeft = input.scrollLeft;
  }

  useEffect(syncScroll, [value, segments]);

  const settled = verdict.kind === 'pending' ? null : verdict.kind;
  const matched = verdict.kind === 'match' ? value.slice(verdict.start, verdict.end) : '';

  return (
    <div className="string-editor" data-verdict={settled ?? 'pending'}>
      <label htmlFor="test-string" className="string-label">
        <span aria-hidden="true">STRING</span>
        <span className="sr-only">{copy.inputLabel}</span>
      </label>
      <div className="string-field">
        <div
          className="string-backdrop"
          aria-hidden="true"
          ref={backdropRef}
          data-phase={reading?.phase ?? 'idle'}
        >
          {segments.map((segment, i) =>
            segment.tone === null && segment.group === null ? (
              segment.text
            ) : (
              <mark
                key={i}
                data-tone={segment.tone ?? undefined}
                data-group={segment.group === null ? undefined : ((segment.group - 1) % CAPTURE_COLORS) + 1}
              >
                {segment.text}
              </mark>
            ),
          )}
        </div>
        <textarea
          ref={inputRef}
          id="test-string"
          rows={1}
          value={value}
          maxLength={STRING_MAX}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          onChange={onChange}
          onScroll={syncScroll}
        />
      </div>
      <span className="verdict-stamp" data-verdict={settled ?? 'pending'} aria-hidden={!settled}>
        {settled && (
          <>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {settled === 'match' ? (
                <path d="M3.5 8.5l3 3 6-7" />
              ) : settled === 'nomatch' ? (
                <path d="M4.5 4.5l7 7m0-7l-7 7" />
              ) : (
                <path d="M8 3.5v5.5m0 3v.5" />
              )}
            </svg>
            <span>{copy.verdict.stamp[settled]}</span>
            <span className="sr-only">{copy.verdict.describe(settled, matched)}</span>
          </>
        )}
      </span>
    </div>
  );
}
