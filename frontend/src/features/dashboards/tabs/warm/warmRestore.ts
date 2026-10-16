// HEL-1575 D5: restoring a stored browser copy. The order below is load-bearing (design "Restore on
// reload"): validate against the change signals, seed the panel list, then output metadata (which
// registers output -> pipeline), then the run baseline, then the row windows (restamped with the
// generation read AFTER the metadata was seeded), then the tab retention.

import type { Dispatch, UnknownAction } from "@reduxjs/toolkit";
import { seedObservedRun } from "../../../panels/services/pipelineRunFanout";
import { currentGeneration } from "../../../panels/state/outputFreshness";
import { seedOutputMeta } from "../../../panels/state/outputMetaCache";
import { paginationHydrated } from "../../../panels/state/panelsSlice";
import type { PanelPaginationState } from "../../../panels/types/panel";
import type { DashboardChange } from "../tabTypes";
import { getOwnWriteAt, getWarmStore, retainTab, setListEntry, setOwnWriteAt } from "./warmCache";
import type { WarmEntry } from "./warmStore";
import { isContentValid, isWindowFresh } from "./warmValidity";

/** Reads a stored entry, waiting at most `timeoutMs` (a slow or unavailable store means cold). */
export async function readStoredEntry(
  userId: string,
  dashboardId: string,
  timeoutMs: number,
): Promise<WarmEntry | undefined> {
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), timeoutMs),
  );
  return Promise.race([getWarmStore().read(userId, dashboardId), timeout]);
}

/** Seeds the in-memory warm cache and the freshness machinery from a stored entry. Returns false (and
 *  seeds nothing) when the copy is invalid -- its content changed since it was captured -- in which case
 *  the caller deletes it and loads cold. `tabOwnWriteAt` is the server pref's `ownWriteAt`: the LATER of
 *  it and the entry's wins, because the debounced browser patch for an inactive tab may not have landed
 *  before `pagehide` while the keepalive pref flush has (design review note 4). */
export function applyWarmEntry(args: {
  dispatch: Dispatch<UnknownAction>;
  entry: WarmEntry;
  signal: DashboardChange | undefined;
  tabOwnWriteAt: number | null;
}): boolean {
  const { dispatch, entry, signal, tabOwnWriteAt } = args;
  const ownWriteAt = Math.max(entry.ownWriteAt ?? -Infinity, tabOwnWriteAt ?? -Infinity);
  const own = Number.isFinite(ownWriteAt) ? ownWriteAt : null;
  if (!isContentValid(entry.contentCapturedAt, own, signal)) return false;

  // 1. the panel list
  setListEntry(entry.dashboardId, {
    panels: entry.panels,
    contentCapturedAt: entry.contentCapturedAt,
  });
  if (own !== null && own > (getOwnWriteAt(entry.dashboardId) ?? -Infinity)) {
    setOwnWriteAt(entry.dashboardId, own);
  }
  // 2. output metadata (registers output -> pipeline and stamps the current generation)
  for (const [outputId, meta] of Object.entries(entry.outputMeta)) seedOutputMeta(outputId, meta);
  // 3. the run baseline, so the first reconcile after the reload is a real comparison
  for (const [pipelineId, runId] of Object.entries(entry.runBaseline)) {
    seedObservedRun(pipelineId, runId);
  }
  // 4. row windows whose Output has no newer data, restamped with the generation read now (the
  //    counters restart at zero on a page load), hydrated without clobbering an existing window
  const windows: Record<string, PanelPaginationState> = {};
  for (const [panelId, window] of Object.entries(entry.rows)) {
    const outputId = window.lastQuery?.outputId;
    if (outputId === undefined || !isWindowFresh(window.capturedAt, outputId, signal)) continue;
    windows[panelId] = {
      currentPage: window.currentPage,
      hasMore: window.hasMore,
      isLoadingMore: false,
      rows: window.rows,
      materialized: window.materialized,
      total: window.total,
      metric: window.metric as PanelPaginationState["metric"],
      lastQuery: window.lastQuery,
      lastFetchOk: true,
      generation: currentGeneration(outputId),
      lastError: null,
      capturedAt: window.capturedAt,
    };
  }
  if (Object.keys(windows).length > 0) dispatch(paginationHydrated(windows));
  // 5. retention
  retainTab(entry.dashboardId, entry.panels);
  return true;
}
