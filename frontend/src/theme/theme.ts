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
