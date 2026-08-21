/** Hyphen family, per `theme.ts:3-4` (`helio-theme`, `helio-accent`) —
 *  keyed by user id so one user's dismissal on a shared browser never
 *  suppresses the checklist for another (design.md D7). */
const DISMISSED_KEY_PREFIX = "helio-onboarding-dismissed-";

function dismissedStorageKey(userId: string): string {
  return `${DISMISSED_KEY_PREFIX}${userId}`;
}

/** Try/catch on both the read AND the write, per `App.tsx`'s
 *  `helio.sidebarCollapsed` pattern (`:39-45`/`:67-73`) — NOT
 *  `ThemeProvider`'s unguarded writes (design.md D7). A user whose storage
 *  is unavailable (private browsing, quota) still gets a working, if
 *  unpersisted, checklist rather than a broken page. */
export function readStoredDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(dismissedStorageKey(userId)) === "true";
  } catch {
    return false;
  }
}

export function writeStoredDismissed(userId: string, dismissed: boolean): void {
  try {
    window.localStorage.setItem(dismissedStorageKey(userId), String(dismissed));
  } catch {
    // Storage unavailable — the workspace still renders regardless (spec:
    // "A failure to read or write the stored dismissal SHALL NOT prevent the
    // workspace from rendering").
  }
}
