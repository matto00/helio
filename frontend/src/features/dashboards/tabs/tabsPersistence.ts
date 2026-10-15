// HEL-1575 D2: writing the tab set to `users.preferences.dashboardTabs` through the existing
// `PATCH /api/users/me/preferences`. Writes are coalesced (1000 ms trailing); a pending write is flushed
// with a `keepalive` fetch on hidden/pagehide so the last change survives a reload; a failure keeps the
// local state and shows nothing (the HEL-1574 precedent).

import { API_BASE_URL } from "../../../config/env";
import { patchDashboardTabsRequest } from "../../auth/services/authService";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "../../../services/csrfHeader";
import type { DashboardTab } from "./tabTypes";

export const TABS_WRITE_DEBOUNCE_MS = 1000;

export interface TabsWire {
  tabs: Array<{ id: string; lastViewedAt: string | null; ownWriteAt?: string }>;
  activeId: string | null;
}

/** The `dashboardTabs` body: `ownWriteAt` is omitted when never set (the server stores absent as None). */
export function toTabsWire(tabs: DashboardTab[], activeId: string | null): TabsWire {
  return {
    tabs: tabs.map((tab) => ({
      id: tab.id,
      lastViewedAt: tab.lastViewedAt,
      ...(tab.ownWriteAt !== null ? { ownWriteAt: tab.ownWriteAt } : {}),
    })),
    activeId,
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: TabsWire | null = null;

/** Queues `wire`; a burst of changes becomes one PATCH carrying the latest value. */
export function scheduleTabsWrite(wire: TabsWire): void {
  pending = wire;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushTabsWrite();
  }, TABS_WRITE_DEBOUNCE_MS);
}

/** Sends the pending write now. `keepalive` uses `fetch` so the request outlives the page. */
export async function flushTabsWrite(options: { keepalive?: boolean } = {}): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const wire = pending;
  pending = null;
  if (wire === null) return;
  try {
    if (options.keepalive) {
      await fetch(`${API_BASE_URL}/api/users/me/preferences`, {
        method: "PATCH",
        keepalive: true,
        credentials: "include",
        headers: { "Content-Type": "application/json", [CSRF_HEADER]: CSRF_HEADER_VALUE },
        body: JSON.stringify({ dashboardTabs: wire }),
      });
    } else {
      await patchDashboardTabsRequest(wire);
    }
  } catch {
    // Local state stays; the next change (or the next sign-in) reconciles.
  }
}

/** Drops anything queued (sign-out must never write the previous user's tabs). */
export function cancelTabsWrite(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending = null;
}
