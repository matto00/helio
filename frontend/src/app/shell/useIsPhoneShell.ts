import { useSyncExternalStore } from "react";

/** The phone-shell media query. Identical to the `(max-width: 768px)` query every shell and page stylesheet uses
 *  (DESIGN.md §4 allows no other breakpoint values), so exactly 768px is a phone layout in JS and CSS alike.
 *  Deliberately not `useIsNarrowerThan(768)`, which is `max-width: 767px`. */
export const PHONE_SHELL_QUERY = "(max-width: 768px)";

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(PHONE_SHELL_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const mql = getMediaQueryList();
  if (mql === null) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return getMediaQueryList()?.matches ?? false;
}

/** True at the phone shell width (768px and below). Conditional rendering off this hook, not CSS-only hiding, keeps
 *  exactly one copy of rail-or-phone chrome (for example the avatar menu) in the accessibility tree at any width.
 *  Returns false when `matchMedia` is unavailable (jsdom, SSR), which renders the desktop shell. */
export function useIsPhoneShell(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
