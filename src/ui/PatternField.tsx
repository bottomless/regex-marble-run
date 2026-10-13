import { useEffect, useMemo, useRef, type ChangeEvent, type MouseEvent } from 'react';
import type { Program } from '../engine/ir.ts';
import { PATTERN_MAX } from '../engine/parse.ts';
import { copy } from '../copy.ts';
import { highlightStore, nodeAtIndex, segmentPattern, spanForNode, useHighlight } from './highlight.ts';

const charWidths = new Map<string, number>();

function charWidth(input: HTMLInputElement): number {
  const style = window.getComputedStyle(input);
  const font = `${style.fontSize} ${style.fontFamily}`;
  const cached = charWidths.get(font);
  if (cached) return cached;
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = font;
  const width = context.measureText('0').width;
  charWidths.set(font, width);
  return width;
}

/**
 * The pattern input with a mirrored text layer underneath: the input's own text is transparent so the
 * backdrop can paint the hovered and currently-playing source spans. Hovering a character asks the
 * scene to light the pieces built from that part of the pattern (and backdrops the innermost node's
 * span); the scene answers with the inverse direction through the same store.
 */
export default function PatternField({
  value,
  flags,
  program,
  error,
  onChange,
}: {
  value: string;
  flags: string;
  program: Program | null;
  error: { message: string; index: number } | null;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { hover, active } = useHighlight();
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const segments = useMemo(() => segmentPattern(value, hover, active), [value, hover, active]);

  function syncScroll() {
    const input = inputRef.current;
    const backdrop = backdropRef.current;
    if (input && backdrop) backdrop.scrollLeft = input.scrollLeft;
  }

  useEffect(() => {
    syncScroll();
    return () => highlightStore.getState().setHover(null);
  }, [value]);

  function pick(event: MouseEvent<HTMLInputElement>) {
    const input = inputRef.current;
    if (!input || !program || value.length === 0) return;
    const rect = input.getBoundingClientRect();
    const paddingLeft = Number.parseFloat(window.getComputedStyle(input).paddingLeft) || 0;
    const x = event.clientX - rect.left - paddingLeft + input.scrollLeft;
    const index = Math.max(0, Math.min(value.length - 1, Math.floor(x / charWidth(input))));
    const node = nodeAtIndex(program, index);
    const span = spanForNode(program, node);
    const current = highlightStore.getState().hover;
    if (span && current && span[0] === current[0] && span[1] === current[1]) return;
    highlightStore.getState().setHover(span);
  }

  return (
    <div className={`pattern-capsule${error ? ' pattern-capsule--invalid' : ''}`}>
      <span className="pattern-delimiter" aria-hidden="true">
        {copy.syntax.slash}
      </span>
      <div className="pattern-field">
        <div className="pattern-backdrop" aria-hidden="true" ref={backdropRef}>
          {segments.map((segment, i) =>
            segment.tone === null ? (
              segment.text.replace(/[\r\n]/g, '␤')
            ) : (
              <mark key={i} data-tone={segment.tone}>
                {segment.text.replace(/[\r\n]/g, '␤')}
              </mark>
            ),
          )}
          {' '}
        </div>
        <input
          ref={inputRef}
          id="pattern"
          type="text"
          value={value}
          maxLength={PATTERN_MAX}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'pattern-hint pattern-error' : 'pattern-hint'}
          onChange={onChange}
          onScroll={syncScroll}
          onMouseMove={pick}
          onMouseLeave={() => highlightStore.getState().setHover(null)}
        />
      </div>
      <span className="pattern-delimiter" aria-hidden="true">
        {copy.syntax.slash}
      </span>
      {flags && (
        <span className="pattern-flags" aria-hidden="true">
          {flags}
        </span>
      )}
    </div>
  );
}
