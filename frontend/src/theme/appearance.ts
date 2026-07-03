import type { Theme } from "./theme";
import type { DashboardAppearance } from "../features/dashboards/types/dashboard";
import type { PanelAppearance } from "../features/panels/types/panel";
export const defaultDashboardAppearance: DashboardAppearance = {
  background: "transparent",
  gridBackground: "transparent",
};

export const defaultPanelAppearance: PanelAppearance = {
  background: "transparent",
  color: "inherit",
  transparency: 0,
};

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

  const resolvedBg = resolveTintedSurface(
    themeAppearancePalette[theme].appBackground,
    appearance.background,
    0.22,
  );
  const textColor = parseHexColor(themeAppearancePalette[theme].defaultText);

  if (textColor === null) {
    return null;
  }

  return getContrastRatio(resolvedBg, textColor);
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
  };
}

export function applyAccentTokens(hex: string): void {
  const tokens = buildAccentTokens(hex);
  for (const [key, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(key, value);
  }
}
