// HEL-1575 C1 (final-gate r1): the ACTIVE tab's browser copy and last-view stamp must not depend on the page
// being hidden or unloaded -- an IndexedDB write started in `pagehide` does not finish before the document
// goes, so a reload of the dashboard you are looking at would always be cold. Instead the active tab is
// snapshotted while it is open: on a debounce once its panel list and row windows settle (and again after
// each later row refresh), and on a slow heartbeat for a tab that sits unchanged (local copy only).

import type { RootState } from "../../../store/store";
import type { AppDispatch } from "../../../store/store";
import { serverNowMs } from "./serverClock";
import { captureTab } from "./warm/warmCapture";

/** The panel list / row windows must be quiet for this long before the active tab is snapshotted. */
export const ACTIVE_SNAPSHOT_DEBOUNCE_MS = 1500;

/** How often a visible, unchanged active tab is re-stamped and re-snapshotted. */
export const ACTIVE_HEARTBEAT_INTERVAL_MS = 60_000;

interface StoreLike {
  dispatch: AppDispatch;
  getState: () => RootState;
}

/** True when the active tab's dashboard is the one whose panel list is loaded and settled. */
export function activeTabIsLoaded(state: RootState): boolean {
  const { hydrated, activeId } = state.dashboardTabs;
  return (
    hydrated &&
    activeId !== null &&
    state.panels.loadedDashboardId === activeId &&
    state.panels.status === "succeeded"
  );
}

/** Queues the debounced write of the active tab's browser copy, stamped as seen now. This touches ONLY the
 *  local IndexedDB copy (final-gate r2): it dispatches nothing, so it can never lead to a preferences PATCH --
 *  an idle, visible session must not keep re-writing its possibly stale tab set over another device's. The
 *  server-side stamp is written only by user actions (leave, first arrival) and the hide/pagehide flush. */
export function snapshotActiveTab(store: StoreLike): void {
  const state = store.getState();
  if (!activeTabIsLoaded(state)) return;
  const { activeId } = state.dashboardTabs;
  if (activeId === null) return;
  captureTab(store.getState, activeId, { retain: false, viewedAt: serverNowMs() });
}
