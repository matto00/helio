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

import type { AppearancePreferencesPatch } from "../features/auth/types/user";
import { applyAccentTokens } from "./appearance";
import { DEFAULT_DENSITY, type Density, type Motion, type TypeStyle } from "./appearancePrefs";
import { useAppearanceState, type PreferredAppearance } from "./useAppearanceState";
import { useOsReducedMotion } from "./useOsReducedMotion";
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
  /** HEL-1572: the saved type style / density (defaults Sans + mono / Comfortable). */
  typeStyle: TypeStyle;
  setTypeStyle: (value: TypeStyle) => void;
  density: Density;
  setDensity: (value: Density) => void;
  /** The saved motion choice, or `null` when none is saved (the OS reduce-motion setting decides). */
  motion: Motion | null;
  /** `null` clears the saved choice. */
  setMotion: (value: Motion | null) => void;
  /** The motion level in effect: the saved choice, else Off under OS reduce-motion, else Full. */
  effectiveMotion: Motion;
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
  /** HEL-1572: the signed-in user's saved type style / density / motion (see `PreferredAppearance`). Like the
   *  accent, ThemeProvider is the sole writer of the matching root attributes. */
  preferredAppearance?: PreferredAppearance;
  /** Called with the patch for a user-driven appearance pick, to persist it. */
  onAppearanceChange?: (patch: AppearancePreferencesPatch) => void;
}

export function ThemeProvider({
  children,
  onAccentChange,
  preferredAccentColor,
  preferredAppearance,
  onAppearanceChange,
}: ThemeProviderProps) {
  const appearance = useAppearanceState(preferredAppearance, onAppearanceChange);
  const osReduced = useOsReducedMotion();
  const effectiveMotion: Motion = appearance.motion ?? (osReduced ? "off" : "full");
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
  // HEL-1048 D10 — also re-applies on THEME change, not just accent change:
  // `--app-accent-text` is theme-aware (design.md D1 — the empty luminance
  // window makes a single theme-independent value impossible, unlike
  // `--app-focus-ring-color`), so switching theme alone must recompute it.
  useEffect(() => {
    applyAccentTokens(accentColor, theme);
    window.localStorage.setItem(AccentStorageKey, accentColor);
  }, [accentColor, theme]);

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
      typeStyle: appearance.typeStyle,
      setTypeStyle: appearance.setTypeStyle,
      density: appearance.density,
      setDensity: appearance.setDensity,
      motion: appearance.motion,
      setMotion: appearance.setMotion,
      effectiveMotion,
    }),
    // `setAccentColor` is recreated each render (closes over the latest
    // `onAccentChange` prop, matching its pre-F-106 effect-dependency
    // behavior) but is otherwise stable in shape; omitted below to avoid
    // invalidating `value` (and every consumer reading it) on every render
    // regardless of an actual theme/accentColor change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, accentColor, appearance, effectiveMotion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active density for non-React-context-aware callers (the panel grid): falls back to Comfortable outside a
 *  `ThemeProvider` so isolated component tests need no provider. */
export function useDensity(): Density {
  return useContext(ThemeContext)?.density ?? DEFAULT_DENSITY;
}

/** Reactive "reduced motion in effect" (saved Off, or no saved choice and OS reduce), the hook twin of
 *  `utils/prefersReducedMotion.ts`. Works outside a `ThemeProvider` by following the OS setting alone. */
export function useReducedMotion(): boolean {
  const osReduced = useOsReducedMotion();
  const context = useContext(ThemeContext);
  return context ? context.effectiveMotion === "off" : osReduced;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (context === null) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}
