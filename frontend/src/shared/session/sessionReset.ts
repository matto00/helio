/**
 * HEL-1634 D3 -- the one registry of what a sign-out discards from module-level state.
 *
 * A module that holds per-user state registers a hook here, once, at module load:
 * `registerSessionReset(name, { covers, reset })`. `covers` lists the module-level identifiers
 * (`path/relative/to/src.ts#identifier`) the hook resets, which is what `sessionResetGuard.test.ts`
 * accounts against. A single `clearAuth` listener in `store.ts` calls `runSessionResets()`.
 *
 * A hook clears the DATA (values, in-flight promises, timers) and notifies current subscribers so
 * they re-read an empty state. It never clears the subscriber sets themselves: a mounted component
 * must keep receiving the next user's loads. A hook is NOT the module's test-only reset function.
 *
 * State that another mechanism already clears (the warm cache's clear, a `clearAuth` listener) is
 * declared with `declareSessionResetCoverage(file, identifiers, via)` so the guard has an owner
 * for every identifier; `via` is a registered hook name or one of `COVERAGE_MECHANISMS`.
 */
export interface SessionResetOptions {
  /** `file#identifier` of every module-level identifier this hook resets. */
  covers: string[];
  reset: () => void;
}

interface DeclaredCoverage {
  file: string;
  identifiers: readonly string[];
  via: string;
}

/** Mechanisms (not hooks) that legitimately own coverage or cleared keys. */
export const COVERAGE_MECHANISMS: readonly string[] = [
  "clearWarm",
  "clearAuthListener",
  "signedInHintListener",
];

const hooks = new Map<string, SessionResetOptions>();
const declared = new Map<string, DeclaredCoverage>();

/** Idempotent by name: a second registration of the same name replaces the first (HMR, re-import). */
export function registerSessionReset(name: string, options: SessionResetOptions): void {
  hooks.set(name, options);
}

/** Runs every hook; one hook throwing never stops the others. */
export function runSessionResets(): void {
  for (const [name, hook] of hooks) {
    try {
      hook.reset();
    } catch (error) {
      console.error(`session reset hook "${name}" failed`, error);
    }
  }
}

export function listSessionResets(): readonly { name: string; covers: readonly string[] }[] {
  return [...hooks].map(([name, hook]) => ({ name, covers: hook.covers }));
}

export function declareSessionResetCoverage(
  file: string,
  identifiers: string[],
  via: string,
): void {
  declared.set(`${file}\u0000${via}`, { file, identifiers, via });
}

export function listDeclaredCoverage(): readonly DeclaredCoverage[] {
  return [...declared.values()];
}
