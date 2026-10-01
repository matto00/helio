const FLAG_PREFIX = "helio.telemetry.firstDashboardRendered.";

/** Users whose event was queued this page-load but not yet confirmed delivered; stops a re-render
 *  from queuing duplicates within one session. Not persisted: after a reload an unconfirmed event
 *  is simply re-emitted, which is safe because the server keeps the first row per user. */
const pending = new Set<string>();

export function isFirstDashboardDelivered(userId: string): boolean {
  try {
    return window.localStorage.getItem(FLAG_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

/** Set only once the server has accepted the event. */
export function markFirstDashboardDelivered(userId: string): void {
  pending.delete(userId);
  try {
    window.localStorage.setItem(FLAG_PREFIX + userId, "1");
  } catch {
    // The server's unique index is the real once-per-user guard; this flag only saves requests.
  }
}

/** Returns true exactly once per page-load per user until delivery is confirmed. */
export function claimFirstDashboardEmission(userId: string): boolean {
  if (isFirstDashboardDelivered(userId) || pending.has(userId)) return false;
  pending.add(userId);
  return true;
}

export function resetFirstDashboardStateForTests(): void {
  pending.clear();
}
