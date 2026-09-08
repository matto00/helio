import { useEffect, useState } from "react";

/** Reads `window.matchMedia` for `(max-width: {breakpointPx - 1}px)` and
 *  stays live across resizes -- returns `false` (never throws) when
 *  `matchMedia` doesn't exist (jsdom/tests) or during SSR, matching
 *  `Toast.tsx`'s `prefersReducedMotion` guard convention.
 *
 *  Genuinely reactive at runtime, not a CSS-hidden duplicate: a caller
 *  branching render logic on this (e.g. moving an action from an inline
 *  button into a menu below the breakpoint) has exactly one copy of that
 *  action mounted at any given width -- never a keyboard/screen-reader-
 *  reachable one hidden by CSS alongside a "real" one (HEL-1022). */
export function useIsNarrowerThan(breakpointPx: number): boolean {
  const query = `(max-width: ${breakpointPx - 1}px)`;

  function readMatches(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  }

  const [matches, setMatches] = useState(readMatches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches);
    }
    // Sync immediately -- `query` may have changed since the initial
    // `useState` read (a caller passing a dynamic breakpoint), and
    // `addEventListener("change", ...)` only fires on FUTURE matches.
    setMatches(mql.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `query` is derived from `breakpointPx`; re-running on `breakpointPx` alone is equivalent and avoids a lint false-positive on the template-string dependency.
  }, [breakpointPx]);

  return matches;
}
