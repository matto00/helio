// Settings → Appearance (HEL-1572, board `Settings · Appearance`): accent, mode, type style, density, motion and the
// inert "Theme — later" row. Every control applies immediately and follows the user across devices (ThemeProvider
// persists it); nothing here writes DOM attributes itself.

import type { CSSProperties, KeyboardEvent } from "react";
import { useRef } from "react";
import { Moon, Sun } from "lucide-react";

import { AccentPicker } from "../../../shared/chrome/AccentPicker";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { SegmentedRadioGroup } from "../../../shared/ui/SegmentedRadioGroup";
import { StatusChip } from "../../../shared/ui/StatusChip";
import {
  DENSITIES,
  MOTION_LEVELS,
  TYPE_STYLES,
  type Density,
  type Motion,
  type TypeStyle,
} from "../../../theme/appearancePrefs";
import { useTheme } from "../../../theme/ThemeProvider";
import "./AppearanceSection.css";

const TYPE_STYLE_CARDS: Record<TypeStyle, { label: string; face: string }> = {
  sans: { label: "Sans + mono", face: "var(--font-face-sans)" },
  mono: { label: "Mono", face: "var(--font-face-mono)" },
  serif: { label: "Serif headings", face: "var(--font-face-serif)" },
};

const DENSITY_LABELS: Record<Density, string> = { comfortable: "Comfortable", compact: "Compact" };
const MOTION_LABELS: Record<Motion, string> = { full: "Full", subtle: "Subtle", off: "Off" };

function TypeStyleCards({
  value,
  onChange,
}: {
  value: TypeStyle;
  onChange: (value: TypeStyle) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + TYPE_STYLES.length) % TYPE_STYLES.length;
    onChange(TYPE_STYLES[next]);
    refs.current[next]?.focus();
  }

  return (
    <div className="appearance__type-cards" role="radiogroup" aria-label="Type style">
      {TYPE_STYLES.map((style, index) => {
        const selected = style === value;
        const card = TYPE_STYLE_CARDS[style];
        // Each card previews its OWN face whatever style is active: the raw face token goes in as this card's
        // --font-heading, never as a font-family declaration (DESIGN.md §3).
        const preview = { "--font-heading": card.face } as CSSProperties;
        return (
          <button
            key={style}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-type-style-option={style}
            className={`appearance__type-card${selected ? " appearance__type-card--selected" : ""}`}
            style={preview}
            onClick={() => onChange(style)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="appearance__type-card-title">Markets &amp; Business</span>
            <span className="appearance__type-card-number mono">140</span>
            <span className="appearance__type-card-label">{card.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function AppearanceSection() {
  const {
    accentColor,
    setAccentColor,
    theme,
    toggleTheme,
    typeStyle,
    setTypeStyle,
    density,
    setDensity,
    motion,
    setMotion,
    effectiveMotion,
  } = useTheme();

  return (
    <section className="settings-page__section appearance" aria-labelledby="appearance-heading">
      <div className="appearance__intro">
        <h2 id="appearance-heading" className="settings-page__section-heading">
          Appearance
        </h2>
        <p className="appearance__subtitle">
          Make Helio yours. Changes apply instantly and follow you across devices.
        </p>
      </div>

      <div className="appearance__row">
        <span className="eyebrow appearance__label">Accent</span>
        <div className="appearance__control">
          <AccentPicker accentColor={accentColor} setAccentColor={setAccentColor} />
        </div>
      </div>

      {/* The light/dark toggle is required in Appearance by the frontend-theme-system spec; unchanged behaviour. */}
      <div className="appearance__row">
        <span className="eyebrow appearance__label">Mode</span>
        <div className="appearance__control">
          <button
            type="button"
            className="settings-page__theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={ICON_SIZE.sm} /> : <Moon size={ICON_SIZE.sm} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </div>

      <div className="appearance__row">
        <span className="eyebrow appearance__label">Type style</span>
        <div className="appearance__control">
          <TypeStyleCards value={typeStyle} onChange={setTypeStyle} />
        </div>
      </div>

      <div className="appearance__row">
        <span className="eyebrow appearance__label">Density</span>
        <div className="appearance__control">
          <SegmentedRadioGroup
            label="Density"
            value={density}
            onChange={setDensity}
            options={DENSITIES.map((value) => ({ value, label: DENSITY_LABELS[value] }))}
          />
        </div>
      </div>

      <div className="appearance__row">
        <span className="eyebrow appearance__label">Motion</span>
        <div className="appearance__control">
          <SegmentedRadioGroup
            label="Motion"
            value={effectiveMotion}
            onChange={setMotion}
            options={MOTION_LEVELS.map((value) => ({ value, label: MOTION_LABELS[value] }))}
          />
          <p className="appearance__hint">
            Defaults to your system&apos;s reduce-motion setting.
            {motion !== null && (
              <>
                {" "}
                <button
                  type="button"
                  className="appearance__link-btn"
                  onClick={() => setMotion(null)}
                >
                  Use system setting
                </button>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="appearance__row">
        <span className="eyebrow appearance__label">Theme</span>
        <div className="appearance__control">
          <div className="appearance__theme-later" data-testid="theme-later-row">
            <span className="appearance__theme-swatches" aria-hidden="true">
              <span className="appearance__theme-swatch appearance__theme-swatch--dark" />
              <span className="appearance__theme-swatch appearance__theme-swatch--light" />
              <span className="appearance__theme-swatch appearance__theme-swatch--accent" />
            </span>
            <span className="appearance__theme-copy">
              Stone (default). Themes bundle accent, type style, surfaces and texture in one pick.
            </span>
            <StatusChip intent="neutral">Later</StatusChip>
          </div>
        </div>
      </div>
    </section>
  );
}
