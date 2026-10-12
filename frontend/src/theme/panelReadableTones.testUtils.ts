// Test-side contrast model, deliberately independent of the implementation: float channels, no rounding.
import { getPanelAppearanceEditorFallback } from "./appearance";
import { PANEL_TONE_TOKEN_MIRROR } from "./panelReadableTones";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`not hex: ${hex}`);
  return {
    r: parseInt(m[1].slice(0, 2), 16),
    g: parseInt(m[1].slice(2, 4), 16),
    b: parseInt(m[1].slice(4, 6), 16),
  };
}

export function lum(c: Rgb): number {
  const f = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function ratio(a: Rgb, b: Rgb): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mix(base: Rgb, tint: Rgb, s: number): Rgb {
  return {
    r: base.r * (1 - s) + tint.r * s,
    g: base.g * (1 - s) + tint.g * s,
    b: base.b * (1 - s) + tint.b * s,
  };
}

// Token values come from the theme.css-guarded mirror (panelReadableTones.css.test.ts), not a third copy.
const TOKENS = {
  dark: { ...PANEL_TONE_TOKEN_MIRROR.dark.tones, muted: PANEL_TONE_TOKEN_MIRROR.dark.muted },
  light: { ...PANEL_TONE_TOKEN_MIRROR.light.tones, muted: PANEL_TONE_TOKEN_MIRROR.light.muted },
};
const WASH = {
  dark: PANEL_TONE_TOKEN_MIRROR.dark.wash,
  light: PANEL_TONE_TOKEN_MIRROR.light.wash,
};

export type ThemeName = "dark" | "light";
export type ToneName = "success" | "warning" | "error";
export const TONES: ToneName[] = ["success", "warning", "error"];

export function surfaceOf(theme: ThemeName, bg: string): Rgb {
  const s = hexToRgb(getPanelAppearanceEditorFallback(theme));
  // buildPanelSurface rounds to integers when emitting the surface
  const m = mix(s, hexToRgb(bg), 0.24);
  return { r: Math.round(m.r), g: Math.round(m.g), b: Math.round(m.b) };
}

export function washOf(theme: ThemeName, bg: string, tone: ToneName): Rgb {
  return mix(surfaceOf(theme, bg), hexToRgb(TOKENS[theme][tone]), WASH[theme][tone]);
}

/** Every backdrop a tone text colour can land on (surface + all three washes). */
export function toneBackdrops(theme: ThemeName, bg: string): Rgb[] {
  return [surfaceOf(theme, bg), ...TONES.map((t) => washOf(theme, bg, t))];
}

export function tokenOf(theme: ThemeName, key: ToneName | "muted"): string {
  return TOKENS[theme][key];
}
