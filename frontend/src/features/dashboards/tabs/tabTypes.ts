// HEL-1575: wire and state shapes of the open-dashboard-tab set.

/** The cap on saved tabs (owner ruling `scroll-cap20-lru`); a 21st closes the LRU inactive tab. */
export const MAX_TABS = 20;

/** One open tab. Times are ISO-8601 instants in SERVER time (design D4/D7), `null` when never set. */
export interface DashboardTab {
  id: string;
  lastViewedAt: string | null;
  ownWriteAt: string | null;
}

/** `users.preferences.dashboardTabs` as the server sends it: spray-json OMITS `None`, so every optional
 *  field may be absent (not `null`). Normalised by `normalizeSavedTabs` at the boundary. */
export interface DashboardTabsWire {
  tabs: Array<{ id: string; lastViewedAt?: string | null; ownWriteAt?: string | null }>;
  activeId?: string | null;
}

/** The normalised saved tab set. */
export interface SavedTabs {
  tabs: DashboardTab[];
  activeId: string | null;
}

/** `GET /api/dashboard-changes` as the client holds it. `/api/dashboard-changes` emits explicit nulls, but
 *  the client still normalises (a missing key must never be read as a time). */
export interface DashboardChange {
  dashboardId: string;
  contentUpdatedAt: string | null;
  dataUpdatedAt: string | null;
  outputs: Array<{ outputId: string; dataUpdatedAt: string | null }>;
}

export function normalizeSavedTabs(wire: DashboardTabsWire | undefined | null): SavedTabs | null {
  if (wire === undefined || wire === null || !Array.isArray(wire.tabs)) return null;
  return {
    tabs: wire.tabs.map((tab) => ({
      id: tab.id,
      lastViewedAt: tab.lastViewedAt ?? null,
      ownWriteAt: tab.ownWriteAt ?? null,
    })),
    activeId: wire.activeId ?? null,
  };
}

/** Epoch ms of an ISO instant, or `null` for null / unparseable. */
export function parseInstant(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
