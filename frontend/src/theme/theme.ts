export type Theme = "dark" | "light";

export const ThemeStorageKey = "helio-theme";
export const AccentStorageKey = "helio-accent";
export const DefaultAccentColor = "#f97316";

export interface AccentPreset {
  label: string;
  hex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { label: "Orange", hex: "#f97316" },
  { label: "Red", hex: "#ef4444" },
  { label: "Pink", hex: "#ec4899" },
  { label: "Purple", hex: "#a855f7" },
  { label: "Blue", hex: "#3b82f6" },
  { label: "Cyan", hex: "#06b6d4" },
  { label: "Green", hex: "#22c55e" },
  { label: "Yellow", hex: "#eab308" },
];

export interface DashboardAppearancePreset {
  label: string;
  background: string;
  gridBackground: string;
}

// Hand-tuned background + grid-background pairs. Values are raw picker hexes that
// feed into the 55 % / 62 % tint blend in `appearance.ts`, so the visible result
// stays close to the raw colors shown here in both themes. Dark presets read well
// on the dark app theme; the light presets below give the light theme options
// that don't wash out. Any preset works in either theme.
export const DASHBOARD_APPEARANCE_PRESETS: DashboardAppearancePreset[] = [
  // Dark
  { label: "Twilight", background: "#1a2035", gridBackground: "#1c2e4a" },
  { label: "Forest", background: "#0d2115", gridBackground: "#132a1e" },
  { label: "Plum", background: "#1e1035", gridBackground: "#261540" },
  { label: "Ember", background: "#2a1005", gridBackground: "#331508" },
  { label: "Storm", background: "#141824", gridBackground: "#1a2030" },
  { label: "Teal", background: "#061e20", gridBackground: "#0a2a2e" },
  { label: "Rose", background: "#250e15", gridBackground: "#301220" },
  { label: "Gold", background: "#1e1804", gridBackground: "#2a2208" },
  // Light
  { label: "Paper", background: "#ece4d3", gridBackground: "#f6efe1" },
  { label: "Mist", background: "#e0e6ef", gridBackground: "#eef2f8" },
  { label: "Sage", background: "#e2eadd", gridBackground: "#eef3ea" },
  { label: "Blush", background: "#f0e2e5", gridBackground: "#f9edef" },
];

export function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light";
}

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const storedTheme = window.localStorage.getItem(ThemeStorageKey);
  return isTheme(storedTheme) ? storedTheme : "dark";
}

export function getInitialAccentColor(): string {
  if (typeof window === "undefined") {
    return DefaultAccentColor;
  }

  const stored = window.localStorage.getItem(AccentStorageKey);
  return stored !== null ? stored : DefaultAccentColor;
}
