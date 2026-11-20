import { createAsyncThunk } from "@reduxjs/toolkit";

import type { RootState } from "../../../../store/store";
import { invalidateOutput } from "../../../panels/state/outputFreshness";
import {
  fetchPanels,
  panelsRestored,
  restoreFinished,
  restoreStarted,
} from "../../../panels/state/panelsSlice";
import { applyPanelReadScopes } from "../../../panels/state/applyPanelReadScopes";
import { clearRestoreMarkersExcept, markRestored } from "../../../panels/state/restoreMarkers";
import { seedPanelStatusBaseline } from "../../../panels/state/panelStatusStore";
import { serverNowMs } from "../serverClock";
import { parseInstant } from "../tabTypes";
import {
  dropListEntry,
  expireTab,
  getListEntry,
  getOwnWriteAt,
  getWarmStore,
  releaseTab,
} from "./warmCache";
import { LAZY_RESTORE_TIMEOUT_MS } from "./warmConfig";
import { applyWarmEntry, readStoredEntry } from "./warmRestore";
import { knownReadScope, scopeOf } from "./warmScope";
import { isContentValid, isTabWarm, isWindowFresh, panelOutputIds } from "./warmValidity";

type Thunk = { state: RootState };

/** Restores the dashboard's panel list from the in-memory warm cache when it is still valid: the content
 *  signal does not post-date the capture (counting own writes). Row windows whose Output received newer
 *  data than the window captured are invalidated (the existing freshness bump), so only they refetch. */
function restoreFromMemory(
  state: RootState,
  dashboardId: string,
  dispatch: (action: ReturnType<typeof panelsRestored>) => void,
): boolean {
  const entry = getListEntry(dashboardId);
  if (entry === undefined) return false;
  // HEL-1783 D3: the copy is used only while the caller's current role is known and matches the scope it was read under.
  const scope = knownReadScope(state, dashboardId);
  if (scope === null || scopeOf(entry) !== scope) {
    dropListEntry(dashboardId);
    releaseTab(dashboardId);
    return false;
  }
  const tab = state.dashboardTabs.tabs.find((t) => t.id === dashboardId);
  const signal = state.dashboardTabs.changeSignals[dashboardId];
  const own = Math.max(
    getOwnWriteAt(dashboardId) ?? -Infinity,
    parseInstant(tab?.ownWriteAt) ?? -Infinity,
  );
  if (!isContentValid(entry.contentCapturedAt, Number.isFinite(own) ? own : null, signal)) {
    dropListEntry(dashboardId);
    releaseTab(dashboardId);
    return false;
  }
  for (const outputId of panelOutputIds(entry.panels)) {
    const stale = entry.panels.some((panel) => {
      const window = state.panels.paginationState[panel.id];
      return (
        window?.lastQuery?.outputId === outputId &&
        !isWindowFresh(window.capturedAt, outputId, signal)
      );
    });
    if (stale) invalidateOutput(outputId);
  }
  // The cards about to mount retain their own Outputs; the tab-level hold is no longer needed (the 30 s
  // remount grace covers the gap between this release and their mount effect).
  releaseTab(dashboardId);
  // HEL-1773/HEL-1783: a restore never reaches `fetchPanels`, which is where each bound Output gets its read scope (an owner
  // clears the per-panel scope a shared dashboard left on the same Output; a non-owner sets it): the same call, before any card mounts.
  applyPanelReadScopes(entry.panels, dashboardId, scope === "panel");
  if (scope === "panel") {
    // D3b/D4: each window this restore KEPT (not invalidated above) may be reused by its panel's first mount and baselines
    // that panel's run-finish refresh on its restored capture time.
    const kept: Record<string, number> = {};
    for (const panel of entry.panels) {
      const window = state.panels.paginationState[panel.id];
      const outputId = window?.lastQuery?.outputId;
      if (
        window === undefined ||
        outputId === undefined ||
        window.capturedAt === undefined ||
        window.lastFetchOk !== true ||
        !isWindowFresh(window.capturedAt, outputId, signal)
      ) {
        continue;
      }
      kept[panel.id] = window.capturedAt;
    }
    markRestored(dashboardId, Object.keys(kept));
    seedPanelStatusBaseline(dashboardId, kept);
  } else {
    clearRestoreMarkersExcept(dashboardId);
  }
  dispatch(panelsRestored({ dashboardId, items: entry.panels }));
  return true;
}

/** Shows `dashboardId`'s panels (design D4/D5): a valid warm copy is restored with NO request; a tab
 *  that is warm but not in memory (the first activation after a reload) is read lazily from the browser
 *  store, bounded at 500 ms with the panel area showing its skeleton; anything else is a normal
 *  `fetchPanels`. It never clobbers a list that is already loaded or loading for the dashboard. */
export const showDashboardPanels = createAsyncThunk<void, string, Thunk>(
  "panels/showDashboardPanels",
  async (dashboardId, { dispatch, getState }) => {
    const first = getState();
    // Loaded or in flight for this dashboard already: `fetchPanels`' own condition makes this a no-op.
    if (first.panels.loadedDashboardId === dashboardId) {
      await dispatch(fetchPanels(dashboardId));
      return;
    }
    const userId = first.auth.currentUser?.id ?? null;
    const warm = userId !== null && isTabWarm(first.dashboardTabs.tabs, dashboardId, serverNowMs());
    if (warm && userId !== null) {
      const hadMemoryCopy = getListEntry(dashboardId) !== undefined;
      if (restoreFromMemory(first, dashboardId, dispatch)) return;
      if (hadMemoryCopy) {
        // The in-memory copy was stale; the stored one is no newer. Drop it and load cold.
        void getWarmStore().remove(userId, dashboardId);
      } else {
        dispatch(restoreStarted(dashboardId));
        const stored = await readStoredEntry(userId, dashboardId, LAZY_RESTORE_TIMEOUT_MS);
        const now = getState();
        const stillWanted =
          now.dashboards.selectedDashboardId === dashboardId &&
          now.panels.loadedDashboardId !== dashboardId &&
          now.auth.currentUser?.id === userId;
        if (stillWanted && stored !== undefined) {
          const tab = now.dashboardTabs.tabs.find((t) => t.id === dashboardId);
          const applied = applyWarmEntry({
            dispatch,
            entry: stored,
            signal: now.dashboardTabs.changeSignals[dashboardId],
            tabOwnWriteAt: parseInstant(tab?.ownWriteAt),
            scope: knownReadScope(now, dashboardId),
          });
          if (applied && restoreFromMemory(getState(), dashboardId, dispatch)) return;
          if (!applied) void getWarmStore().remove(userId, dashboardId);
        }
        dispatch(restoreFinished());
        if (!stillWanted) return;
      }
    }
    // Not warm (expired, beyond the warm 8, or never viewed): nothing it held may be served, rows included.
    if (!warm) expireTab(dashboardId);
    await dispatch(fetchPanels(dashboardId));
  },
);
