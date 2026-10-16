// HEL-1572: type style / density / motion preferences. This module owns the enums, the defaults, the localStorage
// cache read by the pre-paint script in `app.html`, the root attributes, and the effective-motion rule. Keep the
// key and the value sets in sync with that inline script (pinned by `appearancePrefs.test.ts`).

export const TYPE_STYLES = ["sans", "mono", "serif"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const MOTION_LEVELS = ["full", "subtle", "off"] as const;

export type TypeStyle = (typeof TYPE_STYLES)[number];
export type Density = (typeof DENSITIES)[number];
export type Motion = (typeof MOTION_LEVELS)[number];

export const DEFAULT_TYPE_STYLE: TypeStyle = "sans";
export const DEFAULT_DENSITY: Density = "comfortable";

/** localStorage key of the pre-paint cache: JSON `{typeStyle, density, motion}`. */
export const AppearanceStorageKey = "helio-appearance";

/** `motion: null` = no saved choice (follow the OS; the root then carries no `data-motion`). */
export interface AppearancePrefs {
  typeStyle: TypeStyle;
  density: Density;
  motion: Motion | null;
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  typeStyle: DEFAULT_TYPE_STYLE,
  density: DEFAULT_DENSITY,
  motion: null,
};

export function isTypeStyle(value: unknown): value is TypeStyle {
  return typeof value === "string" && (TYPE_STYLES as readonly string[]).includes(value);
}

export function isDensity(value: unknown): value is Density {
  return typeof value === "string" && (DENSITIES as readonly string[]).includes(value);
}

export function isMotion(value: unknown): value is Motion {
  return typeof value === "string" && (MOTION_LEVELS as readonly string[]).includes(value);
}

/** Server preferences (any field may be absent or, defensively, invalid) to concrete appearance values. */
export function resolveAppearance(source: {
  typeStyle?: unknown;
  density?: unknown;
  motion?: unknown;
}): AppearancePrefs {
  return {
    typeStyle: isTypeStyle(source.typeStyle) ? source.typeStyle : DEFAULT_TYPE_STYLE,
    density: isDensity(source.density) ? source.density : DEFAULT_DENSITY,
    motion: isMotion(source.motion) ? source.motion : null,
  };
}

/** Writes the three root attributes. `data-motion` exists only when a choice is saved (DESIGN.md §10). */
export function applyAppearanceAttributes(
  prefs: AppearancePrefs,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.typeStyle = prefs.typeStyle;
  root.dataset.density = prefs.density;
  if (prefs.motion === null) {
    delete root.dataset.motion;
  } else {
    root.dataset.motion = prefs.motion;
  }
}

/** The cached appearance, or the defaults when absent/corrupt. */
export function readAppearanceCache(): AppearancePrefs {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(AppearanceStorageKey);
    return raw === null ? DEFAULT_APPEARANCE : resolveAppearance(JSON.parse(raw) ?? {});
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeAppearanceCache(prefs: AppearancePrefs): void {
  try {
    window.localStorage.setItem(AppearanceStorageKey, JSON.stringify(prefs));
  } catch {
    // Storage unavailable (private mode / quota): the server value still applies on every load.
  }
}

export function clearAppearanceCache(): void {
  try {
    window.localStorage.removeItem(AppearanceStorageKey);
  } catch {
    // Nothing cached that we could remove.
  }
}

/** True when the OS asks for reduced motion. `matchMedia` is guarded: jsdom does not implement it. */
export function osPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The motion level in effect: the saved choice (the root attribute), else Off when the OS asks for reduced motion,
 *  else Full. An explicit saved choice beats the OS (DESIGN.md §10). */
export function effectiveMotion(root: HTMLElement = document.documentElement): Motion {
  const saved = root.dataset.motion;
  if (isMotion(saved)) return saved;
  return osPrefersReducedMotion() ? "off" : "full";
}
