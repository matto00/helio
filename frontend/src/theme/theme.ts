export type Theme = "dark" | "light";

export const ThemeStorageKey = "helio-theme";

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
