import { copy } from '../copy.ts';
import { PRESETS, type Preset } from '../presets.ts';
import Sheet from './Sheet.tsx';

/** The preset browser: every preset with its pattern and caption, one tap to ride. */
export default function PresetSheet({
  current,
  onSelect,
  onClose,
}: {
  current: Preset | undefined;
  onSelect: (preset: Preset) => void;
  onClose: () => void;
}) {
  return (
    <Sheet label={copy.presetsLabel} onClose={onClose} className="preset-sheet">
      <header className="sheet-header">
        <h2>{copy.presetsLabel}</h2>
        <button type="button" className="sheet-close" aria-label={copy.sheetClose} onClick={onClose}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </header>
      <ul className="preset-list">
        {PRESETS.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              data-preset-id={preset.id}
              aria-current={preset.id === current?.id}
              onClick={() => {
                onSelect(preset);
                onClose();
              }}
            >
              <span className="preset-number">{String(preset.number).padStart(2, '0')}</span>
              <span className="preset-body">
                <span className="preset-name">{preset.label}</span>
                <code className="preset-pattern">
                  /{preset.pattern}/{preset.flags}
                </code>
                <span className="preset-caption">{preset.caption}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
