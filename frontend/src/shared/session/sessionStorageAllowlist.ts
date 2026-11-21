/**
 * HEL-1634 D5 -- what the sign-out reset deliberately does and does not touch, with a reason per
 * entry. `sessionResetGuard.test.ts` fails when browser storage or module-level state exists that
 * is in none of these lists nor registered with `sessionReset.ts`.
 */
export interface StorageKeyEntry {
  /** The literal, or the prefix when it ends in `.` or `-` (the real key appends an id). */
  key: string;
  store: "local" | "session" | "indexeddb";
  reason: string;
  /** For cleared keys: the registered session-reset hook that removes it. */
  clearedBy?: string;
}

/** Keys that legitimately survive a sign-out. */
export const STORAGE_KEYS_KEPT: readonly StorageKeyEntry[] = [
  {
    key: "helio-theme",
    store: "local",
    reason: "Device preference (light or dark); not user data, and the login page needs it.",
  },
  {
    key: "helio-accent",
    store: "local",
    reason:
      "Device preference; the next user's server accent overwrites it on login (ThemeProvider adopts it).",
  },
  {
    key: "helio-appearance",
    store: "local",
    reason:
      "Device pre-paint cache of the appearance prefs; useAppearanceState clears it while signed out, so the reset must not.",
  },
  {
    key: "helio.sidebarCollapsed",
    store: "local",
    reason:
      "Retired legacy flag, read once and removed by useContextListLayout; nothing writes it.",
  },
  {
    key: "helio.auth.returnTo",
    store: "session",
    reason:
      "Session mechanics: the pre-login path that must survive the OAuth redirect; consumed on read.",
  },
  {
    key: "helio.telemetry.queue.v1",
    store: "local",
    reason:
      "User-keyed by design: each event carries its userId and flush drops other users' events; clearing would lose undelivered events.",
  },
  {
    key: "helio.telemetry.firstDashboardRendered.",
    store: "local",
    reason:
      "User-keyed by design (suffix is the user id); holds a delivered-once flag, no user content.",
  },
  {
    key: "helio-onboarding-dismissed-",
    store: "local",
    reason:
      "User-keyed by design (suffix is the user id); holds a dismissed flag, no user content.",
  },
];

/** Keys a registered hook removes on sign-out. */
export const STORAGE_KEYS_CLEARED_BY_HOOK: readonly StorageKeyEntry[] = [
  {
    key: "helio.signedIn",
    store: "local",
    reason: "Session mechanics: the landing-page hint, removed by its own auth.status listener.",
    clearedBy: "signedInHintListener",
  },
  {
    key: "helio.recentVisits",
    store: "local",
    reason:
      "Recent dashboards, sources and pipelines with their titles belong to the signed-out user.",
    clearedBy: "recentHistory",
  },
  {
    key: "helio.dashboardSeen",
    store: "local",
    reason:
      "Per-dashboard view stamps feed the Home dot and the Home summary request's viewed ids.",
    clearedBy: "dashboardSeen",
  },
  {
    key: "helio.refinement.conversationId.",
    store: "session",
    reason: "A refinement conversation id of the signed-out user, keyed by dashboard id.",
    clearedBy: "refinementConversationIds",
  },
  {
    key: "helio.pipelineDraft.",
    store: "session",
    reason: "A kept unsaved pipeline draft of the signed-out user, keyed by pipeline id.",
    clearedBy: "keptDrafts",
  },
  {
    key: "helio-warm",
    store: "indexeddb",
    reason:
      "Warm copies of the signed-out user's dashboards (HEL-1575); deleted with the warm cache.",
    clearedBy: "clearWarm",
  },
];
