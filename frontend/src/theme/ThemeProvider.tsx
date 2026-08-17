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
  /**
   * Server-sourced accent preference (e.g. the authenticated user's saved
   * `preferences.accentColor`). ThemeProvider is the sole owner of applying
   * accent tokens to the DOM — feed the server value in here (on rehydrate/
   * login) instead of writing `--app-accent` directly from outside React, so
   * the applied tokens and the AccentPicker's displayed selection can never
   * disagree. Ignored while falsy/absent.
   */
  preferredAccentColor?: string | null;
}

export function ThemeProvider({
  children,
  onAccentChange,
  preferredAccentColor,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  // A server preference known at first render wins immediately over
  // localStorage/the built-in default.
  const [accentColor, setAccentColorState] = useState<string>(
    () => preferredAccentColor || getInitialAccentColor(theme),
  );

  // Adopt a server preference that arrives (or changes) after mount — e.g.
  // login/rehydrate resolving asynchronously. Adjusted during render (not in
  // an effect — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // by tracking the last-seen prop value and re-deriving accentColor when it
  // changes. A server preference always wins over whatever's currently
  // applied (localStorage default, a stale value from a previous session,
  // etc.) — this is the only place accent reacts to auth state, so there's
  // exactly one writer of `--app-accent` (see F-061).
  const [lastPreferredAccentColor, setLastPreferredAccentColor] = useState(preferredAccentColor);
  if (preferredAccentColor !== lastPreferredAccentColor) {
    setLastPreferredAccentColor(preferredAccentColor);
    if (preferredAccentColor) {
      setAccentColorState(preferredAccentColor);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(ThemeStorageKey, theme);
  }, [theme]);

  // F-106 — this used to also call `onAccentChange?.(accentColor)`
  // unconditionally, which fires on *every* render this effect runs after
  // (mount included, and every `preferredAccentColor` sync from the server —
  // see above), not just a real user pick. `main.tsx`'s `onAccentChange`
  // PATCHes the server with whatever it's given, so that re-fired the exact
  // value the server had just supplied back at it on every single page load.
  // DOM/localStorage still need to stay in sync with *any* accentColor
  // change (server sync included), so only the network write-back moves —
  // to the explicit `setAccentColor` below, the one call site an actual
  // user-driven pick goes through (`AccentPicker`).
  useEffect(() => {
    applyAccentTokens(accentColor);
    window.localStorage.setItem(AccentStorageKey, accentColor);
  }, [accentColor]);

  const setAccentColor: Dispatch<SetStateAction<string>> = (next) => {
    setAccentColorState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      onAccentChange?.(resolved);
      return resolved;
    });
  };

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
    // `setAccentColor` is recreated each render (closes over the latest
    // `onAccentChange` prop, matching its pre-F-106 effect-dependency
    // behavior) but is otherwise stable in shape; omitted below to avoid
    // invalidating `value` (and every consumer reading it) on every render
    // regardless of an actual theme/accentColor change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
