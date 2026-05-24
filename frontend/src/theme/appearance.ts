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

export const dashboardAppearanceEditorFallback = "#0b1220";
export const dashboardGridAppearanceEditorFallback = "#111d35";
export const panelAppearanceEditorFallback = "#111827";
export const panelTextEditorFallback = "#f8fafc";

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const readableLightText = "#f8fafc";
const readableDarkText = "#0f172a";

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
    appBackground: "#070b14",
    gridBackground: "#121b31",
    panelSurface: "#0f172a",
    defaultText: "#edf2ff",
  },
  light: {
    appBackground: "#f3f6fb",
    gridBackground: "#ffffff",
    panelSurface: "#ffffff",
    defaultText: "#101828",
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

  // Tint strength 0.22 — 22% of the user-chosen color blended into the theme's
  // app-background base. Keeps strong override colors muted enough to stay within
  // the "glass" aesthetic while still being clearly visible. Evaluated across
  // dark/light × dark-bg/light-bg combinations; value is intentionally conservative.
  const resolved = resolveTintedSurface(
    themeAppearancePalette[theme].appBackground,
    appearance.background,
    0.22,
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

  const resolved = resolveTintedSurface(
    themeAppearancePalette[theme].gridBackground,
    appearance.gridBackground,
    0.28,
  );

  // Alpha values: 0.94 (dark) / 0.97 (light). Chosen to keep the grid surface
  // subtly distinguishable from the full-bleed shell background in both themes
  // without making the grid area look like an opaque inset box. Delta from 1.0
  // is intentionally small (±0.03–0.06) to stay in the "glass" range.
  return toRgbString(resolved, theme === "dark" ? 0.94 : 0.97);
}

export function buildPanelSurface(theme: Theme, background: string, transparency: number): string {
  // Panel tint strength 0.24 — slightly stronger than the dashboard (0.22) so
  // panel color overrides read more distinctly on top of the blended shell backdrop.
  const resolved = resolveTintedSurface(
    themeAppearancePalette[theme].panelSurface,
    background,
    0.24,
  );
  // Alpha formula: 0.9 at transparency=0 (solid glass floor) → 0.18 at transparency=1.0
  // (near-invisible). The 0.72 slope is intentional: 0.9 - 1.0 * 0.72 = 0.18 exactly.
  // The 0.9 floor preserves the glass-panel aesthetic even when transparency=0.
  const alpha = 0.9 - clampTransparency(transparency) * 0.72;

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

export function buildAccentTokens(hex: string): Record<string, string> {
  const rgb = parseHexColor(hex);
  if (rgb === null) {
    return {};
  }

  const white = { r: 255, g: 255, b: 255 };
  const strong = blendColors(rgb, white, 0.15);

  return {
    "--app-accent": hex,
    "--app-accent-strong": toRgbString(strong),
    "--app-accent-surface": toRgbString(rgb, 0.12),
    "--app-accent-dim": toRgbString(rgb, 0.12),
    "--app-accent-mid": toRgbString(rgb, 0.25),
    "--app-bg-accent": toRgbString(rgb, 0.06),
    "--app-bg-secondary": toRgbString(rgb, 0.03),
    // Borders were previously baked to orange in theme.css; derive them
    // from the user's accent so non-orange palettes carry through.
    "--app-border-strong": toRgbString(rgb, 0.3),
    "--app-border-subtle": toRgbString(rgb, 0.1),
  };
}

export function applyAccentTokens(hex: string): void {
  const tokens = buildAccentTokens(hex);
  for (const [key, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(key, value);
  }
}
