import { useEffect, useState } from "react";

import { osPrefersReducedMotion } from "./appearancePrefs";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Reactive OS reduce-motion flag (a live OS toggle re-renders consumers). `matchMedia` is guarded: jsdom has none. */
export function useOsReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => osPrefersReducedMotion());
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(QUERY);
    const onChange = () => setReduced(query.matches);
    onChange();
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}
