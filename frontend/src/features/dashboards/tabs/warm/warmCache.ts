// HEL-1575 D4/D5: the in-memory half of the warm cache -- the panel lists of tabs that were left, the
// user's own-write instants, the tab-level Output retentions -- plus the one browser-store handle.
// Module-level (not Redux) for the same reason `outputFreshness` is: services, listeners and thunks
// reach it without an import cycle, and `clearWarmState` can empty it in one place.

import type { Dispatch, UnknownAction } from "@reduxjs/toolkit";
import { dashboardSeenStore } from "../../../commandPalette/model/dashboardSeenStore";
import { invalidateOutput, release, retain } from "../../../panels/state/outputFreshness";
import type { Panel } from "../../../panels/types/panel";
import { tabOwnWrite } from "../dashboardTabsSlice";
import { resetServerClock, serverNowMs } from "../serverClock";
import { BoundedWarmStore } from "./boundedWarmStore";
import { registerClearWarmHook } from "./clearWarmHook";
import { OWN_WRITE_SLACK_MS } from "./warmConfig";
import { createDefaultWarmStore, type WarmStore } from "./warmStore";
import { panelOutputIds } from "./warmValidity";

interface ListEntry {
  panels: Panel[];
  /** Server-time epoch ms at the START of the request that produced the list. */
  contentCapturedAt: number;
}

const lists = new Map<string, ListEntry>();
const ownWrites = new Map<string, number>();
const fetchStarts = new Map<string, number>();
const retentions = new Map<string, string[]>();

let store = new BoundedWarmStore(createDefaultWarmStore());

export function getWarmStore(): BoundedWarmStore {
  return store;
}

/** Test seam: swaps the browser-store adapter. */
export function setWarmStoreForTests(raw: WarmStore): void {
  store = new BoundedWarmStore(raw);
}

// ---- panel lists ------------------------------------------------------------------------------------

export function getListEntry(dashboardId: string): ListEntry | undefined {
  return lists.get(dashboardId);
}

export function setListEntry(dashboardId: string, entry: ListEntry): void {
  lists.set(dashboardId, entry);
}

export function dropListEntry(dashboardId: string): void {
  lists.delete(dashboardId);
}

export function recordFetchStart(requestId: string): void {
  fetchStarts.set(requestId, serverNowMs());
}

/** A `fetchPanels` result becomes the dashboard's list entry, dated at the request's START. */
export function recordFetchResult(dashboardId: string, requestId: string, panels: Panel[]): void {
  const started = fetchStarts.get(requestId);
  fetchStarts.delete(requestId);
  if (started !== undefined) lists.set(dashboardId, { panels, contentCapturedAt: started });
}

export function discardFetchStart(requestId: string): void {
  fetchStarts.delete(requestId);
}

// ---- own writes ---------------------------------------------------------------------------------------

export function getOwnWriteAt(dashboardId: string): number | null {
  return ownWrites.get(dashboardId) ?? null;
}

export function setOwnWriteAt(dashboardId: string, at: number): void {
  const current = ownWrites.get(dashboardId);
  if (current === undefined || at > current) ownWrites.set(dashboardId, at);
}

/** D4: records that THIS client's own content write for `dashboardId` just succeeded. `ownWriteAt` is the
 *  server-time instant the success response was received plus 2 s of slack for offset error (the receipt
 *  follows the server commit, so it is at or after the write's `last_updated`). It is persisted with the
 *  tab (server pref) and patched into the stored browser copy when that tab was already left. */
export function noteOwnDashboardWrite(
  dispatch: Dispatch<UnknownAction>,
  userId: string | null,
  dashboardId: string,
  listLoaded: boolean,
): void {
  const at = serverNowMs() + OWN_WRITE_SLACK_MS;
  setOwnWriteAt(dashboardId, at);
  // HEL-1578 D5: the Home page's per-dashboard stamp rides this one call, so an own write is recorded for every
  // content-write path, tab or no tab (never a second enumeration of write paths).
  dashboardSeenStore.recordOwnWrite(dashboardId, at);
  dispatch(tabOwnWrite({ id: dashboardId, at: new Date(at).toISOString() }));
  if (userId === null) return;
  if (listLoaded) {
    // The stored copy was captured BEFORE this write (the loaded list is re-snapshotted shortly after it),
    // so the write must not be claimed as covering it: that would validate the old list against the newer
    // change signal and restore it on a reload with no request. Drop the copy (and any queued or in-flight
    // write of an older list); the next snapshot stores the list that includes the write.
    void store.remove(userId, dashboardId);
    return;
  }
  void store.patchOwnWrite(userId, dashboardId, at);
}

// ---- tab-level retention ------------------------------------------------------------------------------

/** Keeps the tab's bound Outputs retained (`outputFreshness`) while it is warm, so `isReusable` and
 *  `outputMetaCache` keep serving its rows across the 15 minutes. One retention per dashboard. */
export function retainTab(dashboardId: string, panels: Panel[]): void {
  if (retentions.has(dashboardId)) return;
  const outputIds = panelOutputIds(panels);
  for (const id of outputIds) retain(id);
  retentions.set(dashboardId, outputIds);
}

export function releaseTab(dashboardId: string): void {
  const outputIds = retentions.get(dashboardId);
  if (outputIds === undefined) return;
  retentions.delete(dashboardId);
  for (const id of outputIds) release(id);
}

/** A tab whose TTL is over (or that was evicted or closed): its bound Outputs' held rows and metadata are
 *  invalidated, so the 30 s remount grace that follows a release cannot serve rows past the TTL, then the tab
 *  lets go of its retention and its in-memory list. Without the invalidation the rows of a tab left for 15
 *  minutes would still be reused for up to the sweep interval plus the grace. */
export function expireTab(dashboardId: string): void {
  for (const id of retentions.get(dashboardId) ?? []) invalidateOutput(id);
  releaseTab(dashboardId);
  lists.delete(dashboardId);
}

export function retainedTabIds(): string[] {
  return [...retentions.keys()];
}

/** D4 sweep (every minute, and whenever the tab set changes): a dashboard that is no longer warm --
 *  expired, beyond the 8, or closed -- loses its tab-level retentions and its in-memory list. The ACTIVE
 *  tab keeps its list (the base for its next capture) but holds no tab-level retention, because its cards
 *  retain their own Outputs. */
export function sweepWarm(
  isWarmTab: (dashboardId: string) => boolean,
  activeId: string | null,
): void {
  for (const id of [...retentions.keys()]) {
    if (id === activeId) releaseTab(id);
    else if (!isWarmTab(id)) expireTab(id);
  }
  for (const id of [...lists.keys()]) {
    if (id !== activeId && !isWarmTab(id)) lists.delete(id);
  }
}

// ---- dropping and clearing ----------------------------------------------------------------------------

/** D6 known gap: when the client itself deletes an Output / pipeline / source, every warm copy that binds
 *  one of the affected Outputs is dropped (memory and browser store). `"all"` for a delete whose Outputs
 *  are not enumerable client-side. */
export async function dropWarmForOutputs(
  userId: string | null,
  outputIds: string[] | "all",
): Promise<void> {
  const affected = (panels: Panel[]) =>
    outputIds === "all" || panelOutputIds(panels).some((id) => outputIds.includes(id));
  for (const [dashboardId, entry] of [...lists.entries()]) {
    if (affected(entry.panels)) {
      lists.delete(dashboardId);
      releaseTab(dashboardId);
    }
  }
  if (userId !== null) await store.removeWhere(userId, (entry) => affected(entry.panels));
}

/** D5 `clearWarmState`, run on `clearAuth` (logout AND the 401 sign-out): (1) bump the store epoch and
 *  cancel every queued write -- a write already in flight checks the epoch before `put` and aborts;
 *  (2) clear the memory side: lists, own writes, retentions, the server clock; (3) close the IndexedDB
 *  connection and (4) delete the database. */
export async function clearWarmState(): Promise<void> {
  const cleared = store.clear();
  lists.clear();
  ownWrites.clear();
  fetchStarts.clear();
  for (const id of [...retentions.keys()]) releaseTab(id);
  resetServerClock();
  await cleared;
}

registerClearWarmHook(clearWarmState);
