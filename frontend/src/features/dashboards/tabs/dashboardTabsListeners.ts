// HEL-1575 D1/D2/D4/D7: the listener-middleware wiring of the tab set. Registered once, before the store
// is finalised (see `store.ts`). Everything selection-driven is inert until `dashboardTabs.hydrated`.

import type { AppStartListening } from "../../../store/listenerMiddleware";
import type { RootState } from "../../../store/store";
import { clearAuth } from "../../auth/state/authSlice";
import { setSelectedDashboardId } from "../state/dashboardsSlice";
import {
  activateTab,
  clearActiveTab,
  closeTab,
  openTabActivate,
  replaceActiveTab,
  tabsHydrated,
  tabsPruned,
  tabViewed,
} from "./dashboardTabsSlice";
import {
  ACTIVE_SNAPSHOT_DEBOUNCE_MS,
  activeTabIsLoaded,
  snapshotActiveTab,
} from "./activeTabSnapshot";
import { hydrateTabs } from "./hydrateTabs";
import { refreshChangeSignals } from "./refreshChangeSignals";
import { serverNowIso } from "./serverClock";
import { cancelTabsWrite, scheduleTabsWrite, toTabsWire } from "./tabsPersistence";
import { captureTab } from "./warm/warmCapture";
import { sweepWarmForState } from "./warm/warmSweep";
import { addWarmListeners } from "./warm/warmListeners";

/** The user id hydration was started for (a second hydration for the same sign-in is never started). */
let hydratingFor: string | null = null;

function tabsOf(state: RootState) {
  return state.dashboardTabs;
}

export function addDashboardTabsListeners(startListening: AppStartListening): void {
  addWarmListeners(startListening);

  // Hydration trigger: the user is known (preferences ride the auth response) and the list has loaded.
  startListening({
    predicate: (_action, state) =>
      state.auth.currentUser !== null &&
      state.dashboards.status === "succeeded" &&
      !tabsOf(state).hydrated &&
      hydratingFor !== state.auth.currentUser.id,
    effect: (_action, listenerApi) => {
      const userId = listenerApi.getState().auth.currentUser?.id ?? null;
      if (userId === null) return;
      hydratingFor = userId;
      void listenerApi.dispatch(hydrateTabs());
    },
  });

  // D1: the STATE TRANSITION of `selectedDashboardId`, not an action -- it sees all eight writing reducers.
  startListening({
    predicate: (_action, current, previous) =>
      tabsOf(current).hydrated &&
      current.dashboards.selectedDashboardId !== previous.dashboards.selectedDashboardId,
    effect: (_action, listenerApi) => {
      const state = listenerApi.getState();
      const original = listenerApi.getOriginalState();
      const next = state.dashboards.selectedDashboardId;
      const previous = original.dashboards.selectedDashboardId;
      const { tabs, activeId } = tabsOf(state);
      if (next === activeId) return; // an explicit tab action already moved the active tab
      if (next === null) {
        listenerApi.dispatch(clearActiveTab());
        return;
      }
      // Removal: the previous selection no longer exists. The neighbour rule overrides the reducer's
      // "most recent dashboard" pick; the active-id listener below then re-selects the neighbour.
      if (
        previous !== null &&
        !state.dashboards.items.some((d) => d.id === previous) &&
        tabs.some((t) => t.id === previous)
      ) {
        listenerApi.dispatch(closeTab(previous));
        return;
      }
      const wasKnown = original.dashboards.items.some((d) => d.id === next);
      if (!wasKnown) {
        listenerApi.dispatch(openTabActivate(next)); // create / duplicate / import / apply-proposal
      } else if (tabs.some((t) => t.id === next)) {
        listenerApi.dispatch(activateTab(next));
      } else {
        listenerApi.dispatch(replaceActiveTab(next));
      }
    },
  });

  // The active tab drives the selection (an explicit tab action, or the neighbour rule on removal).
  startListening({
    predicate: (_action, current, previous) =>
      tabsOf(current).hydrated && tabsOf(current).activeId !== tabsOf(previous).activeId,
    effect: (_action, listenerApi) => {
      const state = listenerApi.getState();
      const original = listenerApi.getOriginalState();
      const activeId = tabsOf(state).activeId;
      if (state.dashboards.selectedDashboardId !== activeId) {
        listenerApi.dispatch(setSelectedDashboardId(activeId));
      }
      // Leaving the previous tab: stamp its last view (server time) and capture its loaded state, BEFORE
      // the new dashboard's panels replace `panels.items` (the React effect runs after this).
      const left = tabsOf(original).activeId;
      if (left !== null && left !== activeId && tabsOf(state).tabs.some((t) => t.id === left)) {
        listenerApi.dispatch(tabViewed({ id: left, at: serverNowIso() }));
        captureTab(listenerApi.getState, left, { retain: true });
      }
      // A tab never viewed gets its first stamp; an already-stamped tab keeps its leave-time value so the
      // warm TTL runs from when it was LEFT (not from this activation).
      const arriving = tabsOf(listenerApi.getState()).tabs.find((t) => t.id === activeId);
      if (arriving && arriving.lastViewedAt === null) {
        listenerApi.dispatch(tabViewed({ id: arriving.id, at: serverNowIso() }));
      }
    },
  });

  // Prune: tabs whose dashboard is gone, after the first successful load (the removal rule above has
  // already handled the active one when it was the selection).
  startListening({
    predicate: (_action, current, previous) =>
      tabsOf(current).hydrated &&
      current.dashboards.status === "succeeded" &&
      current.dashboards.items !== previous.dashboards.items,
    effect: (_action, listenerApi) => {
      const state = listenerApi.getState();
      const present = new Set(state.dashboards.items.map((d) => d.id));
      const missing = tabsOf(state)
        .tabs.filter((tab) => !present.has(tab.id))
        .map((tab) => tab.id);
      if (missing.length > 0) listenerApi.dispatch(tabsPruned(missing));
    },
  });

  // D2: persist every change to the tab set (coalesced), but not a pure restore of what is saved.
  startListening({
    predicate: (action, current, previous) =>
      tabsOf(current).hydrated &&
      (tabsOf(current).tabs !== tabsOf(previous).tabs ||
        tabsOf(current).activeId !== tabsOf(previous).activeId) &&
      !(tabsHydrated.match(action) && !action.payload.persist),
    effect: (_action, listenerApi) => {
      const { tabs, activeId } = tabsOf(listenerApi.getState());
      scheduleTabsWrite(toTabsWire(tabs, activeId));
    },
  });

  // D4: a tab closed, pruned or pushed out of the warm 8 lets go of its retentions and list at once.
  startListening({
    predicate: (_action, current, previous) =>
      tabsOf(current).hydrated && tabsOf(current).tabs !== tabsOf(previous).tabs,
    effect: (_action, listenerApi) => sweepWarmForState(listenerApi.getState()),
  });

  // D7: new tab ids refresh the change signals (only the new ones).
  startListening({
    predicate: (_action, current, previous) =>
      tabsOf(current).hydrated &&
      tabsOf(previous).hydrated &&
      tabsOf(current).tabs.length > 0 &&
      tabsOf(current).tabs !== tabsOf(previous).tabs,
    effect: (_action, listenerApi) => {
      const before = new Set(tabsOf(listenerApi.getOriginalState()).tabs.map((t) => t.id));
      const added = tabsOf(listenerApi.getState())
        .tabs.map((t) => t.id)
        .filter((id) => !before.has(id));
      if (added.length > 0) void listenerApi.dispatch(refreshChangeSignals(added));
    },
  });

  // C1: the active tab is snapshotted while it is open (not only on pagehide, which cannot finish an
  // IndexedDB write): once its panel list / row windows have been quiet for a moment, and after later refreshes.
  startListening({
    predicate: (_action, current, previous) =>
      activeTabIsLoaded(current) &&
      (current.panels.items !== previous.panels.items ||
        current.panels.paginationState !== previous.panels.paginationState ||
        current.panels.loadedDashboardId !== previous.panels.loadedDashboardId ||
        tabsOf(current).activeId !== tabsOf(previous).activeId ||
        !tabsOf(previous).hydrated),
    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(ACTIVE_SNAPSHOT_DEBOUNCE_MS);
      snapshotActiveTab(listenerApi);
    },
  });

  // Sign-out (logout and the 401 path): forget the hydration guard and anything queued for the old user.
  startListening({
    actionCreator: clearAuth,
    effect: () => {
      hydratingFor = null;
      cancelTabsWrite();
    },
  });
}

/** Test helper: forgets the once-per-user hydration guard. */
export function resetTabsListenerState(): void {
  hydratingFor = null;
}
