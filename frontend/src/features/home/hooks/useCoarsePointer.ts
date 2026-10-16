import { useSyncExternalStore } from "react";

/** The input-device query DESIGN.md §3 gates tap-target rules on (never a viewport width). */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

function list(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(COARSE_POINTER_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const mql = list();
  if (mql === null) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** True when the primary pointer is coarse (a finger), at any width. False when `matchMedia` is unavailable. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => list()?.matches ?? false,
    () => false,
  );
}
