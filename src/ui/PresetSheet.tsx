import { copy } from '../copy.ts';
import { PRESETS, type Preset } from '../presets.ts';

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
    <div className="preset-panel" role="dialog" aria-label={copy.presetsLabel}>
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
                <span className="preset-heading">
                  <span className="preset-name">{preset.label}</span>
                  <code className="preset-pattern">
                    /{preset.pattern}/{preset.flags}
                  </code>
                </span>
                <span className="preset-caption">{preset.caption}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
