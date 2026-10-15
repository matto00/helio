import { createAsyncThunk, type Dispatch, type UnknownAction } from "@reduxjs/toolkit";

import type { RootState } from "../../../store/store";
import { setSelectedDashboardId } from "../state/dashboardsSlice";
import {
  dashboardTabsReducer,
  initialDashboardTabsState,
  openTabActivate,
  tabsHydrated,
} from "./dashboardTabsSlice";
import { refreshChangeSignals } from "./refreshChangeSignals";
import { serverNowMs } from "./serverClock";
import { normalizeSavedTabs, parseInstant, type DashboardTab } from "./tabTypes";
import { getWarmStore } from "./warm/warmCache";
import { HYDRATE_RESTORE_TIMEOUT_MS, LAZY_RESTORE_TIMEOUT_MS } from "./warm/warmConfig";
import { applyWarmEntry, readStoredEntry } from "./warm/warmRestore";
import { isTabWarm } from "./warm/warmValidity";

/** `/dashboards/:id` (the authenticated route, HEL-1209) -> `:id`; anything else -> null. The public
 *  viewer is the longer `/dashboards/:id/panels` and is deliberately not matched. */
export function deepLinkDashboardId(pathname: string): string | null {
  const match = /^\/dashboards\/([^/]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function mostRecentlyViewed(tabs: DashboardTab[]): DashboardTab {
  return tabs.reduce((best, tab) =>
    (parseInstant(tab.lastViewedAt) ?? -Infinity) > (parseInstant(best.lastViewedAt) ?? -Infinity)
      ? tab
      : best,
  );
}

/** The pure part of D1 hydration: from the saved set, the dashboards that exist, the URL and the reducer's
 *  auto-selection, decide the tabs and the target. `dirty` says the result differs from what is saved. */
export function planHydration(args: {
  saved: ReturnType<typeof normalizeSavedTabs>;
  dashboardIds: Set<string>;
  autoSelectedId: string | null;
  deepLinkId: string | null;
}): { tabs: DashboardTab[]; target: string | null; dirty: boolean } {
  const { saved, dashboardIds, autoSelectedId, deepLinkId } = args;
  // 1. prune the saved tabs against the dashboards that exist (and drop duplicate ids)
  const seen = new Set<string>();
  const tabs = (saved?.tabs ?? []).filter((tab) => {
    if (!dashboardIds.has(tab.id) || seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
  let dirty = saved === null || tabs.length !== saved.tabs.length;
  const savedActive = saved?.activeId && seen.has(saved.activeId) ? saved.activeId : null;

  // 2. the target: a deep link > the saved active tab > (a stored empty set stays empty) > auto-select
  if (deepLinkId !== null && dashboardIds.has(deepLinkId)) {
    // The deep link opens as a new active tab (or activates it if open): the saved set is never overwritten.
    const next = dashboardTabsReducer(
      { ...initialDashboardTabsState, tabs, activeId: savedActive },
      openTabActivate(deepLinkId),
    );
    return {
      tabs: next.tabs,
      target: deepLinkId,
      dirty: dirty || next.tabs.length !== tabs.length || next.activeId !== savedActive,
    };
  }
  if (savedActive !== null) return { tabs, target: savedActive, dirty };
  if (saved !== null && saved.tabs.length === 0) return { tabs, target: null, dirty };
  if (tabs.length > 0) {
    // Saved tabs survive but none was active (its dashboard is gone): the most recently viewed one.
    return { tabs, target: mostRecentlyViewed(tabs).id, dirty: true };
  }
  // No saved key at all (or every saved tab pruned away): the reducer's auto-selection becomes the only tab.
  // With nothing to select there is nothing to save: an empty set is only ever written when the user closes
  // their last tab, because a stored empty set is respected on reload (a dashboard created later, on another
  // device or through the API, must still be auto-selected for a user who never chose "no tab").
  dirty = autoSelectedId !== null;
  return autoSelectedId === null
    ? { tabs: [], target: null, dirty }
    : {
        tabs: [{ id: autoSelectedId, lastViewedAt: null, ownWriteAt: null }],
        target: autoSelectedId,
        dirty,
      };
}

async function boundedRestore(
  dispatch: Dispatch<UnknownAction>,
  getState: () => RootState,
  target: string,
): Promise<string | null> {
  const state = getState();
  const user = state.auth.currentUser;
  if (!user) return null;
  const serverWarm = isTabWarm(state.dashboardTabs.tabs, target, serverNowMs());
  const entry = await readStoredEntry(user.id, target, LAZY_RESTORE_TIMEOUT_MS * 4);
  if (!entry) return null;
  // The idle active tab no longer writes its stamp to the server (final-gate r2), only to its browser copy:
  // the copy's `lastViewedAt` is honoured for the target's TTL check when it is later than the saved one.
  const savedAt = parseInstant(state.dashboardTabs.tabs.find((t) => t.id === target)?.lastViewedAt);
  const adopt = entry.lastViewedAt !== null && entry.lastViewedAt > (savedAt ?? -Infinity);
  const effective = adopt
    ? state.dashboardTabs.tabs.map((t) =>
        t.id === target
          ? { ...t, lastViewedAt: new Date(entry.lastViewedAt as number).toISOString() }
          : t,
      )
    : state.dashboardTabs.tabs;
  if (!serverWarm && !isTabWarm(effective, target, serverNowMs())) return null;
  const now = getState();
  const tab = now.dashboardTabs.tabs.find((t) => t.id === target);
  const applied = applyWarmEntry({
    dispatch,
    entry,
    signal: now.dashboardTabs.changeSignals[target],
    tabOwnWriteAt: parseInstant(tab?.ownWriteAt),
  });
  if (!applied) {
    void getWarmStore().remove(user.id, target);
    return null;
  }
  return adopt ? new Date(entry.lastViewedAt as number).toISOString() : null;
}

/** D1 hydration, once per signed-in user. Requires the auth user (preferences ride the auth response) and
 *  a succeeded `fetchDashboards`. Steps: prune -> choose the target -> (when tabs were saved) fetch the
 *  change signals and await the target's warm restore decision, bounded at 3 s (a failure means cold) ->
 *  select the target -> set `hydrated`. */
export const hydrateTabs = createAsyncThunk<
  void,
  { deepLinkId?: string | null } | undefined,
  { state: RootState }
>(
  "dashboardTabs/hydrate",
  async (options, { dispatch, getState }) => {
    const state = getState();
    const user = state.auth.currentUser;
    if (!user) return;
    const saved = normalizeSavedTabs(user.preferences?.dashboardTabs);
    const plan = planHydration({
      saved,
      dashboardIds: new Set(state.dashboards.items.map((d) => d.id)),
      autoSelectedId: state.dashboards.selectedDashboardId,
      deepLinkId:
        options?.deepLinkId !== undefined
          ? options.deepLinkId
          : deepLinkDashboardId(window.location.pathname),
    });
    // Other users' stored copies are deleted at startup (D5).
    void getWarmStore().purgeOtherUsers(user.id);

    if (saved !== null && plan.target !== null) {
      // The tabs must be in the store for the validity checks, but `hydrated` stays false until the end.
      let timedOut = false;
      const restore = (async () => {
        const got = await dispatch(refreshChangeSignals(plan.tabs.map((t) => t.id)));
        if (timedOut || got.payload !== true) return;
        const adopted = await boundedRestoreWithTabs(
          dispatch,
          getState,
          plan.tabs,
          plan.target as string,
        );
        if (adopted !== null && !timedOut) {
          plan.tabs = plan.tabs.map((t) =>
            t.id === plan.target ? { ...t, lastViewedAt: adopted } : t,
          );
        }
      })();
      await Promise.race([
        restore.catch(() => undefined),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve();
          }, HYDRATE_RESTORE_TIMEOUT_MS),
        ),
      ]);
    }

    dispatch(setSelectedDashboardId(plan.target));
    dispatch(tabsHydrated({ tabs: plan.tabs, activeId: plan.target, persist: plan.dirty }));
    // No saved key: hydration did not wait for the signals; fetch them in the background.
    if (saved === null && plan.tabs.length > 0) void dispatch(refreshChangeSignals(undefined));
  },
  { condition: (_options, { getState }) => !getState().dashboardTabs.hydrated },
);

/** `boundedRestore` reads the tab pref from the store, which does not hold the plan's tabs yet during
 *  hydration, so the plan's tabs are passed through a scoped state view. */
async function boundedRestoreWithTabs(
  dispatch: Dispatch<UnknownAction>,
  getState: () => RootState,
  tabs: DashboardTab[],
  target: string,
): Promise<string | null> {
  const view = (): RootState => {
    const real = getState();
    return { ...real, dashboardTabs: { ...real.dashboardTabs, tabs } };
  };
  return boundedRestore(dispatch, view, target);
}
