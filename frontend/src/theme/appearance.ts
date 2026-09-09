import type { Theme } from "./theme";
import type { DashboardAppearance } from "../features/dashboards/types/dashboard";
import type { ChartAppearance, PanelAppearance } from "../features/panels/types/panel";
export const defaultDashboardAppearance: DashboardAppearance = {
  background: "transparent",
  gridBackground: "transparent",
};

export const defaultPanelAppearance: PanelAppearance = {
  background: "transparent",
  color: "inherit",
  transparency: 0,
};

/** Shared default chart appearance — mirrors the backend `ChartAppearance.Default`
 *  (`domain/model.scala`). Kept here (not private to `PanelDetailModal.tsx`) so
 *  both the edit pane and the creation payload builder compose the same base
 *  instead of duplicating it (HEL-305 D3). */
export const defaultChartAppearance: ChartAppearance = {
  seriesColors: [
    "#5470c6",
    "#91cc75",
    "#fac858",
    "#ee6666",
    "#73c0de",
    "#3ba272",
    "#fc8452",
    "#9a60b4",
  ],
  legend: { show: true, position: "top" },
  tooltip: { enabled: true },
  axisLabels: {
    x: { show: true, label: "" },
    y: { show: true, label: "" },
  },
  chartType: "line",
};

// dashboardAppearanceEditorFallback / panelAppearanceEditorFallback /
// panelTextEditorFallback are literal copies of theme.css's dark-theme
// --app-surface-raised / --app-surface / --app-text (the editors' color
// inputs default to the dark palette regardless of the active theme) — if
// those theme.css values ever change, update these three too.
//
// dashboardGridAppearanceEditorFallback is a deliberately hand-tuned value
// (not derived from any single theme.css token) and doesn't need the same
// lockstep treatment.
export const dashboardAppearanceEditorFallback = "#232019";
export const dashboardGridAppearanceEditorFallback = "#2a2620";
export const panelAppearanceEditorFallback = "#1a1816";
export const panelTextEditorFallback = "#f2efe9";

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const readableLightText = "#fdfcfa";
const readableDarkText = "#181511";

// appBackground / panelSurface / defaultText (both theme entries below) are
// literal copies of theme.css's --app-bg / --app-surface / --app-text for
// that theme — the blend math here can't read CSS custom properties, so if
// theme.css's values for those tokens ever change, update the matching
// entries here too (values verified matching at time of writing).
//
// gridBackground (both entries) is a deliberately hand-tuned value, not
// derived from any single theme.css token — no sync obligation for it.
const themeAppearancePalette: Record<
  Theme,
  {
    appBackground: string;
    gridBackground: string;
    panelSurface: string;
    defaultText: string;
  }
> = {
  dark: {
    appBackground: "#121110",
    gridBackground: "#191715",
    panelSurface: "#1a1816",
    defaultText: "#f2efe9",
  },
  light: {
    appBackground: "#f4f2ed",
    gridBackground: "#fdfcfa",
    panelSurface: "#fdfcfa",
    defaultText: "#211d19",
  },
};

export function clampTransparency(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getColorInputValue(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

// F-124 — theme-aware counterparts of `panelAppearanceEditorFallback` /
// `panelTextEditorFallback` above. Those two constants are frozen to the dark
// theme's values, so a panel's Background/Text `<input type="color">`
// swatches showed the wrong "current" color for a panel that has never had
// an override set while viewing in light theme (e.g. a near-black Background
// swatch on a light-theme panel that actually renders near-white). Callers
// that need the fallback to track the active theme (`PanelDetailModal.tsx`)
// should use these instead of the raw constants.
export function getPanelAppearanceEditorFallback(theme: Theme): string {
  return themeAppearancePalette[theme].panelSurface;
}

export function getPanelTextEditorFallback(theme: Theme): string {
  return themeAppearancePalette[theme].defaultText;
}

function parseHexColor(value: string): RgbColor | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (match === null) {
    return null;
  }

  const [, hex] = match;

  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function blendColors(base: RgbColor, tint: RgbColor, tintStrength: number): RgbColor {
  const strength = Math.max(0, Math.min(1, tintStrength));
  const baseStrength = 1 - strength;

  return {
    r: Math.round(base.r * baseStrength + tint.r * strength),
    g: Math.round(base.g * baseStrength + tint.g * strength),
    b: Math.round(base.b * baseStrength + tint.b * strength),
  };
}

function toRgbString(color: RgbColor, alpha = 1): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function toHexColor(color: RgbColor): string {
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function getRelativeLuminance(color: RgbColor): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function getContrastRatio(first: RgbColor, second: RgbColor): number {
  const lighter = Math.max(getRelativeLuminance(first), getRelativeLuminance(second));
  const darker = Math.min(getRelativeLuminance(first), getRelativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function resolveTintedSurface(
  baseColor: string,
  overrideColor: string,
  tintStrength: number,
): RgbColor {
  const base = parseHexColor(baseColor);
  const tint = parseHexColor(overrideColor);

  if (base === null) {
    return { r: 0, g: 0, b: 0 };
  }

  if (overrideColor === "transparent" || tint === null) {
    return base;
  }

  return blendColors(base, tint, tintStrength);
}

export function resolveDashboardBackground(
  theme: Theme,
  appearance: DashboardAppearance,
): string | undefined {
  if (appearance.background === "transparent") {
    return undefined;
  }

  // Tint strength 0.55 — the user-chosen color dominates the blend so a preset
  // reads as its intended color in both themes (e.g. a dark "Twilight" preset
  // renders dark even over the light theme's near-white base, instead of washing
  // out to pale gray). Still blended (not raw) so the result harmonizes slightly
  // with the theme base and stays opaque.
  const resolved = resolveTintedSurface(
    themeAppearancePalette[theme].appBackground,
    appearance.background,
    0.55,
  );

  return toRgbString(resolved);
}

export function resolveDashboardGridBackground(
  theme: Theme,
  appearance: DashboardAppearance,
): string | undefined {
  if (appearance.gridBackground === "transparent") {
    return undefined;
  }

  // Slightly stronger than the window background (0.55) so the grid reads as a
  // distinct step within the same preset color.
  const resolved = resolveTintedSurface(
    themeAppearancePalette[theme].gridBackground,
    appearance.gridBackground,
    0.62,
  );

  // Opaque by design: surfaces must read identically regardless of what sits
  // behind them, so the grid override never lets the shell bleed through.
  return toRgbString(resolved);
}

export function buildPanelSurface(theme: Theme, background: string, transparency: number): string {
  // Panel tint strength 0.24 — slightly stronger than the dashboard (0.22) so
  // panel color overrides read more distinctly on top of the blended shell backdrop.
  const resolved = resolveTintedSurface(
    themeAppearancePalette[theme].panelSurface,
    background,
    0.24,
  );
  // Alpha formula: fully opaque at transparency=0 → 0.15 at transparency=1.0.
  // Opaque-by-default is intentional: panels must not tint through when the
  // dashboard background changes. Translucency is strictly user-opted-in.
  const alpha = 1 - clampTransparency(transparency) * 0.85;

  return toRgbString(resolved, alpha);
}

export function resolvePanelTextColor(
  theme: Theme,
  background: string,
  transparency: number,
  color: string,
): string {
  const surface = resolveTintedSurface(
    themeAppearancePalette[theme].panelSurface,
    background,
    0.24,
  );
  const preferred =
    color !== "inherit"
      ? parseHexColor(color)
      : parseHexColor(themeAppearancePalette[theme].defaultText);
  const lightCandidate = parseHexColor(readableLightText);
  const darkCandidate = parseHexColor(readableDarkText);

  if (preferred !== null && getContrastRatio(preferred, surface) >= 4.5) {
    return color === "inherit" ? themeAppearancePalette[theme].defaultText : color;
  }

  if (lightCandidate !== null && darkCandidate !== null) {
    return getContrastRatio(lightCandidate, surface) >= getContrastRatio(darkCandidate, surface)
      ? readableLightText
      : readableDarkText;
  }

  return themeAppearancePalette[theme].defaultText;
}

/**
 * Returns the WCAG contrast ratio between the resolved dashboard background
 * and the theme's default text color. Returns `null` when `appearance.background`
 * is "transparent" (the theme's own background is used, which is always legible).
 */
export function getDashboardBgContrastRatio(
  theme: Theme,
  appearance: DashboardAppearance,
): number | null {
  if (appearance.background === "transparent") {
    return null;
  }

  // F-013 — tint strength must match `resolveDashboardBackground`'s blend
  // (0.55) exactly, not a separate, much weaker 0.22 tint. The mismatch meant
  // this check was scored against a color the user never actually sees (a
  // near-white wash), so real low-contrast backgrounds (the user-chosen color
  // dominates at 0.55) never tripped the warning. Kept as two call sites
  // rather than parsing `resolveDashboardBackground`'s rgba string back into
  // an `RgbColor` — same blend, no string round-trip.
  const resolvedBg = resolveTintedSurface(
    themeAppearancePalette[theme].appBackground,
    appearance.background,
    0.55,
  );
  const textColor = parseHexColor(themeAppearancePalette[theme].defaultText);

  if (textColor === null) {
    return null;
  }

  return getContrastRatio(resolvedBg, textColor);
}

// HEL-1046 — the literal-hex surfaces a `:focus-visible` ring can land on,
// copied from theme.css's two `:root[data-theme=...]` blocks (dark
// `--app-bg`/`--app-surface`/`--app-surface-soft`/`--app-surface-raised`/
// `--app-surface-strong`, then the light equivalents in the same order).
// SYNC OBLIGATION: if theme.css changes any of these five tokens in either
// theme block, update this list too — `focusRingTokenGuard.css.test.ts`
// re-parses theme.css directly and will go red if this list drifts from it.
// Deliberately excludes `--app-bg-accent`/`--app-bg-secondary` (those are
// themselves `color-mix(... var(--app-accent) ...)` outputs, so scoring the
// ring against them would make the derivation circular on its own accent).
const FOCUS_RING_SURFACES: readonly string[] = [
  // dark theme (:root[data-theme="dark"])
  "#121110",
  "#1a1816",
  "#161514",
  "#232019",
  "#262320",
  // light theme (:root[data-theme="light"])
  "#f4f2ed",
  "#fdfcfa",
  "#efece6",
  "#ffffff",
  "#ffffff",
];

const FOCUS_RING_CONTRAST_TARGET = 3.0;

function minContrastAgainstFocusRingSurfaces(color: RgbColor): number {
  let min = Number.POSITIVE_INFINITY;
  for (const hex of FOCUS_RING_SURFACES) {
    const surface = parseHexColor(hex);
    if (surface === null) {
      continue;
    }
    const ratio = getContrastRatio(color, surface);
    if (ratio < min) {
      min = ratio;
    }
  }
  return min;
}

function darkenTowardBlack(color: RgbColor, percent: number): RgbColor {
  const factor = 1 - percent / 100;
  return {
    r: Math.round(color.r * factor),
    g: Math.round(color.g * factor),
    b: Math.round(color.b * factor),
  };
}

/**
 * Derives the MINIMUM darkening of `hex` (toward black, in TypeScript — not
 * CSS `color-mix`, so the result is an exact 8-bit hex with no rounding path
 * back below the 3:1 floor) that clears `FOCUS_RING_CONTRAST_TARGET` against
 * every surface in `FOCUS_RING_SURFACES` (both themes). Theme-independent by
 * construction (design.md D3): one value serves both themes because the
 * search takes the minimum contrast over ALL surfaces, not a per-theme pair.
 *
 * Returns `null` only for an unparseable hex — callers fall back to the
 * static `:root` default in that case (same contract as `buildAccentTokens`
 * returning `{}`), never to a thrown error or an unsafe value.
 *
 * HEL-1050 D7 — carrying the corrected derivation rationale here, not only
 * in a run artifact that dies with the worktree: `FOCUS_RING_SURFACES` is
 * deliberately the ten literal theme hexes CLOSEST IN LUMINANCE to a
 * mid-luminance accent (`--app-surface-soft` #efece6 in light,
 * `--app-surface-strong` #262320 in dark), not the palette extremes
 * (`#ffffff`/`#121110`). For a mid-luminance colour the extremes are the
 * EASIEST surfaces to clear, not the hardest — HEL-1046 derived against the
 * extremes once and would have shipped a ring scoring 2.58-2.99 against the
 * real binding surfaces, its own accessibility defect passing its own
 * proof. Any caller of this function that substitutes a different surface
 * set must re-derive against the actual rendering surface, not assume the
 * extremes are conservative.
 *
 * The same reasoning is why a colour derived here is NOT a universal
 * guarantee: this function's 3:1 floor holds against exactly the ten
 * literal theme surfaces in `FOCUS_RING_SURFACES` — a border/box-shadow
 * indicator rendered against a surface OUTSIDE that set (e.g. a
 * user-chosen panel background, `PanelGrid.css`'s title input — HEL-1050
 * D8, HEL-1051) is not covered, and no single derived colour can be, since
 * the user's chosen background can be arbitrarily close to whatever colour
 * is chosen.
 */
export function deriveFocusRingColor(hex: string): string | null {
  const rgb = parseHexColor(hex);
  if (rgb === null) {
    return null;
  }

  if (minContrastAgainstFocusRingSurfaces(rgb) >= FOCUS_RING_CONTRAST_TARGET) {
    return hex.toLowerCase();
  }

  for (let percent = 1; percent <= 100; percent++) {
    const darkened = darkenTowardBlack(rgb, percent);
    if (minContrastAgainstFocusRingSurfaces(darkened) >= FOCUS_RING_CONTRAST_TARGET) {
      return toHexColor(darkened);
    }
  }

  // Unreachable for any real accent — design.md D1 proves the 3:1 window is
  // non-empty (width 0.0953), and black (`#000000`) trivially clears every
  // surface here. Kept as an explicit, safe last resort rather than a thrown
  // error, so the derivation stays total (task 1.2).
  return "#000000";
}

export function buildAccentTokens(hex: string): Record<string, string> {
  const rgb = parseHexColor(hex);
  if (rgb === null) {
    return {};
  }

  // Every other accent token (-strong, -surface, -dim, -mid, …) is derived in
  // theme.css with color-mix, so a two-token write is enough to re-theme the
  // whole app. Borders and backgrounds are neutral by design and are never
  // rewritten from the accent.
  const light = parseHexColor(readableLightText);
  const dark = parseHexColor(readableDarkText);
  const ink =
    light !== null && dark !== null && getContrastRatio(dark, rgb) >= getContrastRatio(light, rgb)
      ? readableDarkText
      : readableLightText;

  return {
    "--app-accent": hex,
    "--app-accent-ink": ink,
    "--app-focus-ring-color": deriveFocusRingColor(hex) ?? hex,
  };
}

export function applyAccentTokens(hex: string): void {
  const tokens = buildAccentTokens(hex);
  for (const [key, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(key, value);
  }
}
