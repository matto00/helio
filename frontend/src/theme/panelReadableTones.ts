import type { Theme } from "./theme";
import {
  getContrastRatio,
  parseHexColor,
  resolvePanelTextColor,
  resolvePanelSurfaceRgb,
  toHexColor,
  type RgbColor,
} from "./appearance";

// HEL-1490 -- readable variants of the conditional-format tone colours, the delta colours and the
// metric unit/label mix on a panel with a custom background. Computed at render time in TS
// (CSS cannot compare luminance); emitted as inline custom properties only when the theme token
// would fail. Lives apart from appearance.ts to honour the file-size budget.

type ToneName = "success" | "warning" | "error";
const TONE_NAMES: readonly ToneName[] = ["success", "warning", "error"];

/** Contract is 4.5:1; the picker aims 0.05 higher to absorb final-hex rounding and browser compositing. */
const CONTRACT_RATIO = 4.5;
const RATIO_MARGIN = 0.05;

// Literal copies of theme.css (`--app-success/-warning/-error`, `--app-text-muted`, the `-surface`
// wash shares, `--panel-secondary-text-mix`) per theme -- CSS variables are unreadable on this pure
// path. `panelReadableTones.css.test.ts` re-parses theme.css and fails on drift.
export const PANEL_TONE_TOKEN_MIRROR: Record<
  Theme,
  {
    tones: Record<ToneName, string>;
    muted: string;
    wash: Record<ToneName, number>;
    secondaryMixDefault: number;
  }
> = {
  dark: {
    tones: { success: "#4cc38a", warning: "#f5b944", error: "#f17b67" },
    muted: "#aaa49c",
    wash: { success: 0.14, warning: 0.14, error: 0.14 },
    secondaryMixDefault: 60,
  },
  light: {
    tones: { success: "#166d43", warning: "#85551a", error: "#af3325" },
    muted: "#645e56",
    wash: { success: 0.11, warning: 0.11, error: 0.1 },
    secondaryMixDefault: 62,
  },
};

/** Unrounded blend: matches the browser's `color-mix(... transparent)` compositing. */
function blendFloat(base: RgbColor, tint: RgbColor, strength: number): RgbColor {
  return {
    r: base.r * (1 - strength) + tint.r * strength,
    g: base.g * (1 - strength) + tint.g * strength,
    b: base.b * (1 - strength) + tint.b * strength,
  };
}

function worstRatio(color: RgbColor, backdrops: readonly RgbColor[]): number {
  return Math.min(...backdrops.map((backdrop) => getContrastRatio(color, backdrop)));
}

/**
 * Returns `preferred` unchanged when it clears `minRatio` (+ the internal margin) on EVERY backdrop;
 * otherwise the smallest step of the same colour toward black or white that does (`#rrggbb`, so it is
 * ECharts-safe). If no step passes, whichever extreme scores the higher worst-case ratio.
 */
export function pickReadableColor(
  preferred: string,
  backdrops: readonly RgbColor[],
  minRatio: number = CONTRACT_RATIO,
): string {
  const color = parseHexColor(preferred);
  if (color === null || backdrops.length === 0) {
    return preferred;
  }
  const target = minRatio + RATIO_MARGIN;
  if (worstRatio(color, backdrops) >= target) {
    return preferred;
  }
  const black: RgbColor = { r: 0, g: 0, b: 0 };
  const white: RgbColor = { r: 255, g: 255, b: 255 };
  const worst = backdrops.reduce((lowest, backdrop) =>
    getContrastRatio(color, backdrop) < getContrastRatio(color, lowest) ? backdrop : lowest,
  );
  const extreme = getContrastRatio(black, worst) >= getContrastRatio(white, worst) ? black : white;
  for (let step = 1; step <= 25; step++) {
    const stepped = blendFloat(color, extreme, step * 0.04);
    const rounded = {
      r: Math.round(stepped.r),
      g: Math.round(stepped.g),
      b: Math.round(stepped.b),
    };
    if (worstRatio(rounded, backdrops) >= target) {
      return toHexColor(rounded);
    }
  }
  return worstRatio(black, backdrops) >= worstRatio(white, backdrops) ? "#000000" : "#ffffff";
}

/**
 * Smallest whole-percent share of the panel text colour (>= the theme default) whose blend over the
 * surface clears the target; capped at 100 (which renders `currentColor` exactly).
 */
function resolveSecondaryMix(surface: RgbColor, text: RgbColor, defaultMix: number): number {
  const target = CONTRACT_RATIO + RATIO_MARGIN;
  for (let percent = defaultMix; percent < 100; percent++) {
    if (getContrastRatio(blendFloat(surface, text, percent / 100), surface) >= target) {
      return percent;
    }
  }
  return 100;
}

/**
 * Per-panel inline custom properties that keep tone text, delta colours and the metric unit/label
 * readable on a custom panel background. Empty for a default (transparent) panel and for any value
 * whose theme token already passes.
 */
export function resolvePanelReadableTones(
  theme: Theme,
  appearance: { background: string; color: string; transparency: number },
): Record<string, string> {
  if (appearance.background === "transparent") {
    return {};
  }
  const mirror = PANEL_TONE_TOKEN_MIRROR[theme];
  const surface = resolvePanelSurfaceRgb(theme, appearance.background);
  const backdrops = [surface];
  for (const tone of TONE_NAMES) {
    const token = parseHexColor(mirror.tones[tone]);
    if (token !== null) {
      backdrops.push(blendFloat(surface, token, mirror.wash[tone]));
    }
  }

  const out: Record<string, string> = {};
  for (const tone of TONE_NAMES) {
    const picked = pickReadableColor(mirror.tones[tone], backdrops);
    if (picked !== mirror.tones[tone]) {
      out[`--panel-tone-${tone}`] = picked;
    }
  }
  const muted = pickReadableColor(mirror.muted, [surface]);
  if (muted !== mirror.muted) {
    out["--panel-tone-muted"] = muted;
  }

  const text = parseHexColor(
    resolvePanelTextColor(theme, appearance.background, appearance.transparency, appearance.color),
  );
  if (text !== null) {
    const mix = resolveSecondaryMix(surface, text, mirror.secondaryMixDefault);
    if (mix > mirror.secondaryMixDefault) {
      out["--panel-secondary-text-mix"] = `${mix}%`;
    }
  }
  return out;
}
