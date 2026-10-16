// HEL-1575 D4/D5: capturing a tab's loaded state when it is left (and, for the active tab, on
// hidden/pagehide) into the in-memory warm cache and, debounced, the browser store.

import type { RootState } from "../../../../store/store";
import { getObservedRunId } from "../../../panels/services/pipelineRunFanout";
import { peekOutputMeta } from "../../../panels/state/outputMetaCache";
import type { Panel } from "../../../panels/types/panel";
import type { Output } from "../../../pipelines/types/output";
import { parseInstant } from "../tabTypes";
import { getListEntry, getOwnWriteAt, getWarmStore, retainTab, setListEntry } from "./warmCache";
import type { StoredWindow, WarmEntry } from "./warmStore";
import { panelOutputIds } from "./warmValidity";

/** True when `panels` holds the loaded, settled panel list of exactly this dashboard. */
function loadedListOf(state: RootState, dashboardId: string): Panel[] | null {
  const { panels } = state;
  if (panels.loadedDashboardId !== dashboardId || panels.status !== "succeeded") return null;
  if (!panels.items.every((p) => p.dashboardId === dashboardId)) return null;
  return panels.items;
}

function laterOf(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : Math.max(a, b);
}

/** The own writes `dashboardId`'s list already includes: read when the list is captured and frozen with it
 *  (never re-read when a debounced write fires, by which time a newer own write may not be in `items`). */
function ownWriteCoveredBy(state: RootState, dashboardId: string): number | null {
  const tab = state.dashboardTabs.tabs.find((t) => t.id === dashboardId);
  return laterOf(getOwnWriteAt(dashboardId), parseInstant(tab?.ownWriteAt));
}

/** Builds the browser-store entry for a dashboard from the current store state. `ownWriteAt` is the own
 *  write the `items` were captured with (see `ownWriteCoveredBy`). */
export function buildWarmEntry(
  state: RootState,
  userId: string,
  dashboardId: string,
  items: Panel[],
  contentCapturedAt: number,
  viewedAt: number | null = null,
  ownWriteAt: number | null = null,
): WarmEntry {
  const rows: Record<string, StoredWindow> = {};
  const outputMeta: Record<string, Output> = {};
  const runBaseline: Record<string, string> = {};
  for (const outputId of panelOutputIds(items)) {
    const meta = peekOutputMeta(outputId);
    if (!meta) continue;
    outputMeta[outputId] = meta;
    const runId = getObservedRunId(meta.pipelineId);
    if (runId !== undefined) runBaseline[meta.pipelineId] = runId;
  }
  for (const panel of items) {
    const window = state.panels.paginationState[panel.id];
    // Only settled, successful windows with a known capture instant are worth keeping.
    if (
      !window ||
      window.isLoadingMore ||
      window.lastFetchOk !== true ||
      window.capturedAt === undefined ||
      window.lastQuery === undefined
    ) {
      continue;
    }
    rows[panel.id] = {
      currentPage: window.currentPage,
      hasMore: window.hasMore,
      rows: window.rows,
      materialized: window.materialized,
      total: window.total,
      metric: window.metric,
      lastQuery: window.lastQuery,
      generation: window.generation,
      capturedAt: window.capturedAt,
    };
  }
  const tab = state.dashboardTabs.tabs.find((t) => t.id === dashboardId);
  return {
    v: 1,
    userId,
    dashboardId,
    contentCapturedAt,
    ownWriteAt,
    lastViewedAt: laterOf(parseInstant(tab?.lastViewedAt), viewedAt),
    panels: items,
    rows,
    outputMeta,
    runBaseline,
  };
}

/** Stores the dashboard's loaded state in the warm cache. `retain` is true for a tab being LEFT (its
 *  Outputs stay retained for the TTL); false for the active tab's hidden/pagehide snapshot. `viewedAt`
 *  (final-gate r2) is a LOCAL "seen now" instant for the browser copy only: it is never dispatched, so it
 *  never reaches the server. */
export function captureTab(
  getState: () => RootState,
  dashboardId: string,
  options: { retain: boolean; immediate?: boolean; viewedAt?: number },
): void {
  const state = getState();
  const userId = state.auth.currentUser?.id;
  const items = loadedListOf(state, dashboardId);
  const prior = getListEntry(dashboardId);
  if (!userId || items === null || prior === undefined) return;
  // The user's own edits replace the panels; the capture instant only moves forward with own writes.
  const contentCapturedAt = Math.max(prior.contentCapturedAt, getOwnWriteAt(dashboardId) ?? 0);
  const ownWriteAt = ownWriteCoveredBy(state, dashboardId);
  setListEntry(dashboardId, { panels: items, contentCapturedAt });
  if (options.retain) retainTab(dashboardId, items);
  const build = () => {
    const latest = getState();
    // Signed out or switched user while the write waited: nothing to write.
    if (latest.auth.currentUser?.id !== userId) return null;
    return buildWarmEntry(
      latest,
      userId,
      dashboardId,
      items,
      contentCapturedAt,
      options.viewedAt ?? null,
      ownWriteAt,
    );
  };
  if (options.immediate) {
    // hidden / pagehide: a debounce timer may never fire, so write now.
    const entry = build();
    if (entry !== null) void getWarmStore().write(entry);
    return;
  }
  getWarmStore().scheduleWrite(userId, dashboardId, build);
}
