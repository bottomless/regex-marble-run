import { lazy, Suspense, useMemo } from 'react';
import { parsePattern } from '../engine/parse.ts';
import { copy } from '../copy.ts';

const Workshop = lazy(() => import('../scene/Workshop.tsx'));

const EVIL_PATTERN = '^(a+)+$';
const EVIL_INPUT = `${'a'.repeat(16)}!`;

export default function OgView() {
  const program = useMemo(() => parsePattern(EVIL_PATTERN, ''), []);

  return (
    <div className="og-view" data-theme="light">
      <div className="og-stage">
        <Suspense fallback={null}>
          <Workshop
            program={program}
            input={EVIL_INPUT}
            dark={false}
            reducedMotion={false}
            resetKey={0}
            mode="single"
          />
        </Suspense>
      </div>

      <div className="og-overlay">
        <div className="og-card">
          <p className="og-edition">{copy.edition}</p>
          <div className="og-brand">
            <svg className="og-mark" viewBox="0 0 28 28" aria-hidden="true">
              <path d="M7 5v7l14 7v5M7 12l-3 8" />
              <circle cx="7" cy="5" r="3" />
              <circle cx="21" cy="23" r="3" />
            </svg>
            <h1>{copy.brand}</h1>
          </div>
          <p className="og-descriptor">{copy.descriptor}</p>

          <div className="og-pattern-row">
            <span className="og-pattern-pill">
              <code>/{EVIL_PATTERN}/</code>
            </span>
            <span className="og-string-pill">
              <code>{EVIL_INPUT}</code>
            </span>
          </div>

          <div className="og-badge">
            <span className="og-badge-dot" />
            <span>Catastrophic backtracking · 65,536 backtracks mid-flood</span>
          </div>
        </div>
      </div>
    </div>
  );
}
