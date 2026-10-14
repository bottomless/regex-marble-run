import { useState } from 'react';
import { copy } from '../copy.ts';
import Sheet from './Sheet.tsx';
import HowItWorks from './HowItWorks.tsx';

type LegendKind = (typeof copy.legendSheet)[number]['kind'];

/** A small stylised illustration of each machine piece, drawn in the track palette. */
function LegendArt({ kind }: { kind: LegendKind }) {
  return (
    <svg className={`legend-art legend-art--${kind}`} viewBox="0 0 64 44" aria-hidden="true">
      {kind === 'marble' && (
        <>
          <path className="track" d="M6 34h52" />
          <circle className="steel" cx="26" cy="29" r="6" />
          <path className="brass" d="M46 34v-9" />
        </>
      )}
      {kind === 'gate' && (
        <>
          <path className="track" d="M6 34h52" />
          <path className="brass" d="M24 34V22a8 8 0 0 1 16 0v12" />
          <path className="ink" d="M29 12h6" />
        </>
      )}
      {kind === 'fork' && (
        <>
          <path className="track" d="M6 36h16m4 0 14-14m0 0h18M26 36l14 0h18" transform="translate(0 -6)" />
          <circle className="cobalt" cx="22" cy="30" r="5" />
          <path className="brass" d="M22 30l9-7" />
        </>
      )}
      {kind === 'loop' && (
        <>
          <path className="track" d="M8 34h48" />
          <path className="vermilion" d="M20 34v-12a12 12 0 0 1 24 0v4" />
          <path className="vermilion" d="M40 30l4-6 4 6" />
        </>
      )}
      {kind === 'capture' && (
        <>
          <path className="track" d="M6 34h52" />
          <path className="teal" d="M18 12v22m28-22v22M18 12h6m16 0h6M18 34h6m16 0h6" />
        </>
      )}
      {kind === 'sensor' && (
        <>
          <path className="track" d="M6 34h52" />
          <ellipse className="brass" cx="32" cy="22" rx="10" ry="4" />
          <path className="brass" d="M32 26v8" />
          <circle className="lamp" cx="32" cy="14" r="2.5" />
        </>
      )}
      {kind === 'mirror' && (
        <>
          <path className="track" d="M6 34h52" />
          <rect className="brass" x="24" y="12" width="16" height="22" />
          <rect className="mirror-face" x="27" y="15" width="10" height="16" />
        </>
      )}
      {kind === 'scout' && (
        <>
          <path className="track" d="M6 34h52" />
          <path className="scout-line" d="M22 34v-14h20v14" />
          <circle className="scout-dot" cx="32" cy="20" r="4" />
        </>
      )}
      {kind === 'flag' && (
        <>
          <path className="track" d="M6 34h52" />
          <path className="brass" d="M28 34V10" />
          <path className="vermilion" d="M28 10h14l-5 6 5 6H28" />
        </>
      )}
    </svg>
  );
}

export default function LegendSheet({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<'pieces' | 'how'>('pieces');
  return (
    <Sheet label={copy.guide} onClose={onClose} className="legend-sheet">
      <header className="sheet-header">
        <h2>{copy.guide}</h2>
        <button type="button" className="sheet-close" aria-label={copy.sheetClose} onClick={onClose}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </header>
      <div className="guide-tabs" role="group" aria-label={copy.guide}>
        <button type="button" aria-pressed={section === 'pieces'} onClick={() => setSection('pieces')}>
          {copy.legendLabel}
        </button>
        <button type="button" aria-pressed={section === 'how'} onClick={() => setSection('how')}>
          {copy.howItWorksTitle}
        </button>
      </div>
      <div className="guide-content">
        {section === 'how' ? (
          <HowItWorks />
        ) : (
          <ul className="legend-list">
            {copy.legendSheet.map((piece) => (
              <li key={piece.kind}>
                <LegendArt kind={piece.kind} />
                <div>
                  <h3>{piece.label}</h3>
                  <p>{piece.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
