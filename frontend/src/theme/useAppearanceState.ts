import { useCallback, useLayoutEffect, useMemo, useState } from "react";

import type { AppearancePreferencesPatch } from "../features/auth/types/user";
import {
  applyAppearanceAttributes,
  clearAppearanceCache,
  DEFAULT_APPEARANCE,
  readAppearanceCache,
  writeAppearanceCache,
  type AppearancePrefs,
  type Density,
  type Motion,
  type TypeStyle,
} from "./appearancePrefs";

/** What the signed-in user's saved preferences say: `undefined` = not known yet (boot / rehydrate in flight, keep
 *  what the pre-paint cache applied), `null` = signed out (reset to defaults and drop the cache), an object = the
 *  server's values (absent fields resolved to their defaults). */
export type PreferredAppearance = AppearancePrefs | null | undefined;

function differs(a: PreferredAppearance, b: PreferredAppearance): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  return a.typeStyle !== b.typeStyle || a.density !== b.density || a.motion !== b.motion;
}

export interface AppearanceState extends AppearancePrefs {
  setTypeStyle: (value: TypeStyle) => void;
  setDensity: (value: Density) => void;
  /** `null` clears the saved choice, so the OS reduce-motion setting decides again. */
  setMotion: (value: Motion | null) => void;
}

/** The appearance preferences (HEL-1572): state, root attributes and the pre-paint cache. `ThemeProvider` is the sole
 *  writer of the root attributes; the server value lands in a layout effect so it is in the DOM before paint of the
 *  commit that renders the shell. Setters apply locally first and report the patch for persistence. */
export function useAppearanceState(
  preferred: PreferredAppearance,
  onChange?: (patch: AppearancePreferencesPatch) => void,
): AppearanceState {
  const [appearance, setAppearance] = useState<AppearancePrefs>(() =>
    preferred ? preferred : readAppearanceCache(),
  );

  // Adopt a server value (or a sign-out) that arrives after mount; adjusted during render, not in an effect.
  const [lastPreferred, setLastPreferred] = useState<PreferredAppearance>(preferred);
  const changed = differs(preferred, lastPreferred);
  if (changed) {
    setLastPreferred(preferred);
    if (preferred === null) setAppearance(DEFAULT_APPEARANCE);
    else if (preferred !== undefined) setAppearance(preferred);
  }

  const signedOut = preferred === null;
  useLayoutEffect(() => {
    applyAppearanceAttributes(appearance);
    if (signedOut) clearAppearanceCache();
    else writeAppearanceCache(appearance);
  }, [appearance, signedOut]);

  const update = useCallback(
    (patch: AppearancePreferencesPatch) => {
      setAppearance((prev) => ({
        typeStyle: patch.typeStyle ?? prev.typeStyle,
        density: patch.density ?? prev.density,
        motion: patch.motion === undefined ? prev.motion : patch.motion,
      }));
      onChange?.(patch);
    },
    [onChange],
  );

  return useMemo(
    () => ({
      ...appearance,
      setTypeStyle: (typeStyle: TypeStyle) => update({ typeStyle }),
      setDensity: (density: Density) => update({ density }),
      setMotion: (motion: Motion | null) => update({ motion }),
    }),
    [appearance, update],
  );
}
