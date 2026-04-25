import { ACCENT_PRESETS } from "../theme/theme";
import "./AccentPicker.css";

interface AccentPickerProps {
  accentColor: string;
  setAccentColor: (hex: string) => void;
}

export function AccentPicker({ accentColor, setAccentColor }: AccentPickerProps) {
  return (
    <div className="accent-picker" role="group" aria-label="Accent color presets">
      {ACCENT_PRESETS.map((preset) => {
        const isSelected = accentColor === preset.hex;
        return (
          <button
            key={preset.hex}
            type="button"
            className={`accent-picker__swatch${isSelected ? " accent-picker__swatch--selected" : ""}`}
            style={{ backgroundColor: preset.hex }}
            aria-label={preset.label}
            aria-pressed={isSelected}
            onClick={() => setAccentColor(preset.hex)}
          />
        );
      })}
    </div>
  );
}
