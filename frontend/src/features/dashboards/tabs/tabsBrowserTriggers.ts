// HEL-1575 D2/D5/D7: the browser-event half of the tab set -- everything that is driven by the page
// lifecycle rather than by a Redux action. Started once from `main.tsx` (not at import, so tests that
// import the store do not grow timers).

import type { AppDispatch, RootState } from "../../../store/store";
import { ACTIVE_HEARTBEAT_INTERVAL_MS, snapshotActiveTab } from "./activeTabSnapshot";
import { tabViewed } from "./dashboardTabsSlice";
import { refreshChangeSignals } from "./refreshChangeSignals";
import { serverNowIso } from "./serverClock";
import { flushTabsWrite } from "./tabsPersistence";
import { captureTab } from "./warm/warmCapture";
import { sweepWarmForState } from "./warm/warmSweep";
import { WARM_SWEEP_INTERVAL_MS } from "./warm/warmConfig";

/** D7: signals refresh this often while the page is visible. */
export const SIGNALS_REFRESH_INTERVAL_MS = 2 * 60_000;

interface StoreLike {
  dispatch: AppDispatch;
  getState: () => RootState;
}

/** The page is going away or hidden (a best-effort extra: the active tab is already snapshotted while open): stamp the active tab's last view (so the TTL runs from now, not from
 *  activation), snapshot its loaded state into the browser store, and flush the tab PATCH with `keepalive`
 *  so the last change survives a reload. */
export function handlePageHidden(store: StoreLike): void {
  const state = store.getState();
  if (!state.dashboardTabs.hydrated) return;
  const { activeId } = state.dashboardTabs;
  if (activeId !== null) {
    store.dispatch(tabViewed({ id: activeId, at: serverNowIso() }));
    captureTab(store.getState, activeId, { retain: false, immediate: true });
  }
  void flushTabsWrite({ keepalive: true });
}

export function startTabsBrowserTriggers(store: StoreLike): () => void {
  const refresh = () => {
    if (store.getState().dashboardTabs.hydrated) {
      void store.dispatch(refreshChangeSignals(undefined));
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") handlePageHidden(store);
    else refresh();
  };
  const onPageHide = () => handlePageHidden(store);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);

  const signalsTimer = setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, SIGNALS_REFRESH_INTERVAL_MS);

  // C1: a visible active tab that sits unchanged is still re-snapshotted LOCALLY (no server write), so a reload long after
  // it settled is warm and the TTL runs from when the user last SAW it.
  const heartbeatTimer = setInterval(() => {
    if (document.visibilityState === "visible") snapshotActiveTab(store);
  }, ACTIVE_HEARTBEAT_INTERVAL_MS);

  // Minute sweep: release the retentions of tabs that are no longer warm (expired, beyond the 8, closed,
  // or the active tab, whose cards retain their own Outputs).
  const sweepTimer = setInterval(() => {
    if (store.getState().dashboardTabs.tabs.length === 0) return;
    sweepWarmForState(store.getState());
  }, WARM_SWEEP_INTERVAL_MS);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    clearInterval(signalsTimer);
    clearInterval(heartbeatTimer);
    clearInterval(sweepTimer);
  };
}
