/**
 * HEL-1578 design D5 — the per-dashboard "last seen" store beside the palette's recent-visit list.
 *
 * The palette list (`recentHistoryStore`) cannot answer "when did the user last look at dashboard X": it records
 * on every selection change (including the boot auto-select), rebuilds an entry from scratch on each visit and shares
 * its ten-entry cap with sources and pipelines. This keyed store is separate and the palette never rewrites it:
 * `{[dashboardId]: {viewedAt?, ownWriteAt?}}` in epoch ms of SERVER time, pruned to dashboards that still exist and
 * capped at `DASHBOARD_SEEN_MAX_ENTRIES` (the least recently touched dropped).
 *
 * `viewedAt` is stamped only for a dashboard the dashboard view actually displays; `ownWriteAt` is reserved for
 * HEL-1575's own-write path (Phase B) and is carried through every update unchanged here.
 */
export const DASHBOARD_SEEN_STORAGE_KEY = "helio.dashboardSeen";
export const DASHBOARD_SEEN_MAX_ENTRIES = 500;

export interface DashboardSeen {
  viewedAt?: number;
  ownWriteAt?: number;
}

export type DashboardSeenMap = Record<string, DashboardSeen>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSeen(value: unknown): value is DashboardSeen {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.viewedAt === undefined || isFiniteNumber(candidate.viewedAt)) &&
    (candidate.ownWriteAt === undefined || isFiniteNumber(candidate.ownWriteAt))
  );
}

/** A malformed blob is discarded whole (the recent-history store's rule): an empty map is a normal state. */
export function loadDashboardSeen(
  storageKey: string = DASHBOARD_SEEN_STORAGE_KEY,
): DashboardSeenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.values(parsed).every(isSeen) ? (parsed as DashboardSeenMap) : {};
  } catch {
    return {};
  }
}

export interface DashboardSeenStore {
  get(dashboardId: string): DashboardSeen | undefined;
  getAll(): DashboardSeenMap;
  /** Stamps `viewedAt` (server-time epoch ms), keeping any `ownWriteAt`; moves the entry to most-recent. */
  recordViewed(dashboardId: string, at: number): void;
  /** Phase B hook: stamps `ownWriteAt`, keeping any `viewedAt`. */
  recordOwnWrite(dashboardId: string, at: number): void;
  /** Drops entries for dashboards that no longer exist. Call only once the dashboards list has resolved. */
  pruneMissing(existingIds: ReadonlySet<string>): void;
  subscribe(listener: () => void): () => void;
}

export function createDashboardSeenStore(
  storageKey: string = DASHBOARD_SEEN_STORAGE_KEY,
): DashboardSeenStore {
  // Insertion order is recency order: a touched entry is deleted and re-added, so the first key is the oldest.
  let entries: DashboardSeenMap = loadDashboardSeen(storageKey);
  const listeners = new Set<() => void>();

  function commit(next: DashboardSeenMap) {
    entries = next;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(entries));
    } catch {
      // Storage unavailable or full: the in-memory map still holds the stamp; only persistence is lost.
    }
    for (const listener of listeners) listener();
  }

  function touch(dashboardId: string, patch: DashboardSeen) {
    const { [dashboardId]: previous, ...others } = entries;
    const next: DashboardSeenMap = { ...others, [dashboardId]: { ...previous, ...patch } };
    const keys = Object.keys(next);
    for (const stale of keys.slice(0, Math.max(0, keys.length - DASHBOARD_SEEN_MAX_ENTRIES))) {
      delete next[stale];
    }
    commit(next);
  }

  return {
    get: (dashboardId) => entries[dashboardId],
    getAll: () => entries,
    recordViewed: (dashboardId, at) => touch(dashboardId, { viewedAt: at }),
    recordOwnWrite: (dashboardId, at) => touch(dashboardId, { ownWriteAt: at }),
    pruneMissing(existingIds) {
      const kept = Object.entries(entries).filter(([id]) => existingIds.has(id));
      if (kept.length === Object.keys(entries).length) return;
      commit(Object.fromEntries(kept));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const dashboardSeenStore = createDashboardSeenStore();
