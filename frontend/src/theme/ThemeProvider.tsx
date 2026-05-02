import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
} from "react";

import { applyAccentTokens } from "./appearance";
import {
  AccentStorageKey,
  getInitialAccentColor,
  getInitialTheme,
  ThemeStorageKey,
  type Theme,
} from "./theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: Dispatch<SetStateAction<Theme>>;
  toggleTheme: () => void;
  accentColor: string;
  setAccentColor: Dispatch<SetStateAction<string>>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps extends PropsWithChildren {
  onAccentChange?: (color: string) => void;
}

export function ThemeProvider({ children, onAccentChange }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [accentColor, setAccentColor] = useState<string>(() => getInitialAccentColor());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(ThemeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    applyAccentTokens(accentColor);
    window.localStorage.setItem(AccentStorageKey, accentColor);
    onAccentChange?.(accentColor);
  }, [accentColor, onAccentChange]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => {
        setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
      },
      accentColor,
      setAccentColor,
    }),
    [theme, accentColor],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (context === null) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}
