// HEL-1575 D2/D5/D7: the browser-event half of the tab set -- everything that is driven by the page
// lifecycle rather than by a Redux action. Started once from `main.tsx` (not at import, so tests that
// import the store do not grow timers).

import type { AppDispatch, RootState } from "../../../store/store";
import { ACTIVE_HEARTBEAT_INTERVAL_MS, snapshotActiveTab } from "./activeTabSnapshot";
import { tabViewed } from "./dashboardTabsSlice";
import { refreshChangeSignals } from "./refreshChangeSignals";
import { isDashboardViewPath } from "../../../shared/chrome/sections";
import { serverNowIso, serverNowMs } from "./serverClock";
import { flushTabsWrite } from "./tabsPersistence";
import { parseInstant } from "./tabTypes";
import { captureTab } from "./warm/warmCapture";
import { sweepWarmForState } from "./warm/warmSweep";
import { WARM_SWEEP_INTERVAL_MS } from "./warm/warmConfig";

/** D7: signals refresh this often while the page is visible. */
export const SIGNALS_REFRESH_INTERVAL_MS = 2 * 60_000;

interface StoreLike {
  dispatch: AppDispatch;
  getState: () => RootState;
}

/** A leave re-stamps the active tab (and so sends a PATCH) only when its stored stamp is older than this;
 *  the warm TTL is 15 min, so a stamp at most this stale shortens it by at most this much. */
export const LEAVE_STAMP_REFRESH_MS = 5 * 60_000;

/** `visibilitychange`->visible refreshes the signals at most this often (a quick tab-switch burst is one request). */
export const SIGNALS_VISIBLE_MIN_GAP_MS = 30_000;

function onDashboardView(): boolean {
  return isDashboardViewPath(window.location.pathname);
}

/** The page is going away or hidden (a best-effort extra: the active tab is already snapshotted while open).
 *  D7: at most ONE PATCH per leave, and only for a dashboard actually on screen. Off the dashboard view
 *  nothing is stamped; a pending (real) tab change is still flushed with `keepalive` so it survives. On the
 *  dashboard view the active tab's SERVER stamp (the PATCH) is refreshed only when older than
 *  `LEAVE_STAMP_REFRESH_MS`; the browser copy is captured every time, stamped with the current time; the stamp and any pending change
 *  ride the same single PATCH. */
export function handlePageHidden(store: StoreLike): void {
  const state = store.getState();
  if (!state.dashboardTabs.hydrated) return;
  const { activeId } = state.dashboardTabs;
  if (activeId !== null && onDashboardView()) {
    const stored = parseInstant(
      state.dashboardTabs.tabs.find((t) => t.id === activeId)?.lastViewedAt,
    );
    if (stored === null || serverNowMs() - stored >= LEAVE_STAMP_REFRESH_MS) {
      store.dispatch(tabViewed({ id: activeId, at: serverNowIso() }));
    }
    // Always stamped with the current time (local only, like the heartbeat): the whole entry is replaced, so
    // an unstamped capture would rewind a fresher heartbeat stamp to the possibly stale stored one.
    captureTab(store.getState, activeId, {
      retain: false,
      immediate: true,
      viewedAt: serverNowMs(),
    });
  }
  void flushTabsWrite({ keepalive: true });
}

export function startTabsBrowserTriggers(store: StoreLike): () => void {
  let left = false; // one leave = hidden + pagehide (+ more): handled once, re-armed when the page is shown again
  let lastRefreshAt = 0;
  const refresh = () => {
    if (store.getState().dashboardTabs.hydrated && onDashboardView()) {
      lastRefreshAt = Date.now();
      void store.dispatch(refreshChangeSignals(undefined));
    }
  };
  const leave = () => {
    if (left) return;
    left = true;
    handlePageHidden(store);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") leave();
    else {
      left = false;
      if (Date.now() - lastRefreshAt >= SIGNALS_VISIBLE_MIN_GAP_MS) refresh();
    }
  };
  const onPageShow = () => {
    left = false;
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", onPageShow);

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
    window.removeEventListener("pagehide", leave);
    window.removeEventListener("pageshow", onPageShow);
    clearInterval(signalsTimer);
    clearInterval(heartbeatTimer);
    clearInterval(sweepTimer);
  };
}
