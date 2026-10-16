// HEL-1575 D5: `logout` awaits `clearWarmState` (bounded), but `authSlice` cannot import the warm cache
// (the cache imports the tab slice, which imports `authSlice`). This dependency-free registry is the seam:
// the warm cache registers its clear function here when it loads.

import { LOGOUT_CLEAR_TIMEOUT_MS } from "./warmConfig";

let hook: (() => Promise<void>) | null = null;

export function registerClearWarmHook(fn: () => Promise<void>): void {
  hook = fn;
}

/** Runs the registered clear, waiting at most `LOGOUT_CLEAR_TIMEOUT_MS`. Never rejects. */
export async function awaitWarmClear(): Promise<void> {
  if (hook === null) return;
  const clearing = hook().catch(() => undefined);
  await Promise.race([
    clearing,
    new Promise<void>((resolve) => setTimeout(resolve, LOGOUT_CLEAR_TIMEOUT_MS)),
  ]);
}
