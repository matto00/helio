// HEL-1786 D2/D3: the dashboard panel-status store. A dashboard-only grantee cannot read the Output or pipeline routes the
// owner's freshness line, run-finish refresh and data-invalid badge are built from, so those three read this one source:
// `GET /api/dashboards/:id/panel-status`, polled while a consumer is mounted and the page is visible.
//
// Module-scoped and ref-counted per dashboard id: the first subscriber starts polling, the last unsubscribe stops it, and
// there is one request in flight per dashboard however many consumers (the meta row, the phone caption, every card) listen.

import { fetchDashboardPanelStatus } from "../services/panelStatusService";
import { onFreshnessReset } from "./outputFreshness";

/** How often a visible page re-reads the status. Run-finish latency for a grantee is up to one interval plus the rows read. */
export const PANEL_STATUS_POLL_MS = 15000;

export interface PanelStatusItem {
  panelId: string;
  /** ISO time the bound pipeline last ran, `null` when it never has. */
  lastRunAt: string | null;
  runStatus: "succeeded" | "failed" | null;
  /** ISO time the panel's latest stored data was captured: committed together with the rows, so it is the refresh trigger. */
  dataUpdatedAt: string | null;
  invalid: boolean;
}

export interface PanelStatusSnapshot {
  items: PanelStatusItem[];
  sources: string[];
}

interface Entry {
  snapshot: PanelStatusSnapshot | null;
  /** Mounted consumers: status listeners and data-advance listeners both count. */
  refs: number;
  listeners: Set<() => void>;
  advanceListeners: Map<string, Set<() => void>>;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
}

const entries = new Map<string, Entry>();

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function newEntry(): Entry {
  return {
    snapshot: null,
    refs: 0,
    listeners: new Set(),
    advanceListeners: new Map(),
    timer: null,
    inFlight: false,
  };
}

/** The refresh trigger (D3): a panel's data advanced iff its `dataUpdatedAt` is strictly later than the previous snapshot's,
 *  or went from `null` to a value. `lastRunAt` and `runStatus` never count: on a successful run `lastRunAt` is written
 *  alongside (not after) the rows, and a failed run writes no data. A panel absent from the previous snapshot is its own
 *  baseline, and so is the very first snapshot. */
function advancedPanels(previous: PanelStatusSnapshot | null, next: PanelStatusSnapshot): string[] {
  if (previous === null) return [];
  const before = new Map(previous.items.map((i) => [i.panelId, i.dataUpdatedAt]));
  const advanced: string[] = [];
  for (const item of next.items) {
    if (!before.has(item.panelId) || item.dataUpdatedAt === null) continue;
    const prior = before.get(item.panelId) ?? null;
    if (prior === null || Date.parse(item.dataUpdatedAt) > Date.parse(prior))
      advanced.push(item.panelId);
  }
  return advanced;
}

function read(dashboardId: string): void {
  const entry = entries.get(dashboardId);
  if (entry === undefined || entry.inFlight) return;
  entry.inFlight = true;
  fetchDashboardPanelStatus(dashboardId).then(
    (next) => {
      entry.inFlight = false;
      // A late response for a dashboard nobody listens to any more (or after a reset) is dropped.
      if (entries.get(dashboardId) !== entry) return;
      const advanced = advancedPanels(entry.snapshot, next);
      entry.snapshot = next;
      for (const listener of [...entry.listeners]) listener();
      for (const panelId of advanced) {
        for (const listener of [...(entry.advanceListeners.get(panelId) ?? [])]) listener();
      }
    },
    () => {
      // A failed read keeps the last good snapshot; the next tick retries.
      entry.inFlight = false;
    },
  );
}

function onVisibilityChange(): void {
  if (!isVisible()) return;
  for (const [id, entry] of entries) if (entry.refs > 0) read(id);
}

let visibilityHooked = false;

function acquire(dashboardId: string): Entry {
  let entry = entries.get(dashboardId);
  if (entry === undefined) {
    entry = newEntry();
    entries.set(dashboardId, entry);
  }
  entry.refs += 1;
  if (entry.refs === 1) {
    if (!visibilityHooked && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
      visibilityHooked = true;
    }
    if (isVisible()) read(dashboardId);
    entry.timer = setInterval(() => {
      if (isVisible()) read(dashboardId);
    }, PANEL_STATUS_POLL_MS);
  }
  return entry;
}

function release(dashboardId: string, entry: Entry): void {
  entry.refs -= 1;
  if (entry.refs > 0) return;
  if (entry.timer !== null) clearInterval(entry.timer);
  entry.timer = null;
  // The snapshot is dropped with the last consumer: a later subscriber must baseline on a FRESH read, not diff against
  // a snapshot from before it was away.
  if (entries.get(dashboardId) === entry) entries.delete(dashboardId);
}

/** Listen to the dashboard's status. Starts polling with the first subscriber; the returned function unsubscribes. */
export function subscribePanelStatus(dashboardId: string, listener: () => void): () => void {
  const entry = acquire(dashboardId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    release(dashboardId, entry);
  };
}

/** Call `onAdvance` whenever that panel's stored data advances (D3). Counts as a subscriber of the dashboard's polling. */
export function subscribePanelDataAdvance(
  dashboardId: string,
  panelId: string,
  onAdvance: () => void,
): () => void {
  const entry = acquire(dashboardId);
  const set = entry.advanceListeners.get(panelId) ?? new Set<() => void>();
  set.add(onAdvance);
  entry.advanceListeners.set(panelId, set);
  return () => {
    set.delete(onAdvance);
    if (set.size === 0) entry.advanceListeners.delete(panelId);
    release(dashboardId, entry);
  };
}

/** The latest snapshot of a dashboard that has a subscriber, or `null` before its first read lands. */
export function getPanelStatusSnapshot(dashboardId: string): PanelStatusSnapshot | null {
  return entries.get(dashboardId)?.snapshot ?? null;
}

/** Read now (the "Refresh dashboard" control and the pull): a no-op while a read is in flight or nobody listens. */
export function refreshPanelStatusNow(dashboardId: string): void {
  if (isVisible()) read(dashboardId);
}

function clearAll(): void {
  for (const entry of entries.values()) {
    if (entry.timer !== null) clearInterval(entry.timer);
  }
  entries.clear();
  if (visibilityHooked && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    visibilityHooked = false;
  }
}

// Logout / account switch: forget every snapshot with the rest of the freshness state.
onFreshnessReset(clearAll);

/** Test helper: forget every dashboard, stop every timer. */
export function resetPanelStatusStoreForTests(): void {
  clearAll();
}
