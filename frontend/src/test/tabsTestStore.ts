// HEL-1575 test harness: a real store (auth, dashboards, tabs, panels) wired with a FRESH listener
// middleware per call, so the tab/warm listeners run against real reducers without touching the module
// singleton `store.ts` owns.

import { configureStore, createListenerMiddleware, type Middleware } from "@reduxjs/toolkit";

import { authReducer } from "../features/auth/state/authSlice";
import { dashboardsReducer } from "../features/dashboards/state/dashboardsSlice";
import { addDashboardTabsListeners } from "../features/dashboards/tabs/dashboardTabsListeners";
import {
  dashboardTabsReducer,
  initialDashboardTabsState,
  type DashboardTabsState,
} from "../features/dashboards/tabs/dashboardTabsSlice";
import type { DashboardTab, DashboardTabsWire } from "../features/dashboards/tabs/tabTypes";
import { panelsReducer } from "../features/panels/state/panelsSlice";
import type { Dashboard } from "../features/dashboards/types/dashboard";
import type { Panel } from "../features/panels/types/panel";
import type { User } from "../features/auth/types/user";
import type { AppDispatch, RootState } from "../store/store";
import { defaultDashboardLayout } from "../features/dashboards/state/dashboardLayout";
import { defaultDashboardAppearance } from "../theme/appearance";

export function dash(id: string, name = `Dashboard ${id}`): Dashboard {
  return {
    id,
    name,
    meta: {
      createdBy: "u1",
      createdAt: "2026-01-01T00:00:00Z",
      lastUpdated: "2026-01-01T00:00:00Z",
    },
    appearance: defaultDashboardAppearance,
    layout: defaultDashboardLayout,
  };
}

export function tab(
  id: string,
  lastViewedAt: string | null = null,
  ownWriteAt: string | null = null,
) {
  return { id, lastViewedAt, ownWriteAt } satisfies DashboardTab;
}

export function testUser(dashboardTabs?: DashboardTabsWire, id = "user-1"): User {
  return {
    id,
    email: `${id}@example.com`,
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    tier: "owner",
    preferences: { accentColor: null, zoomLevels: {}, dashboardTabs },
  };
}

export interface TabsStoreOptions {
  dashboards?: Dashboard[];
  dashboardsStatus?: "idle" | "succeeded";
  selected?: string | null;
  tabs?: DashboardTab[];
  activeId?: string | null;
  hydrated?: boolean;
  user?: User | null;
  panels?: {
    items: Panel[];
    loadedDashboardId: string | null;
    status?: "idle" | "succeeded" | "loading";
  };
  changeSignals?: DashboardTabsState["changeSignals"];
}

export function makeTabsStore(options: TabsStoreOptions = {}) {
  const listenerMiddleware = createListenerMiddleware();
  const startListening = listenerMiddleware.startListening.withTypes<RootState, AppDispatch>();
  addDashboardTabsListeners(startListening);

  const init = { type: "@@test/init" };
  const dashboards = {
    ...dashboardsReducer(undefined, init),
    items: options.dashboards ?? [],
    status: options.dashboardsStatus ?? "succeeded",
    selectedDashboardId: options.selected ?? null,
  };
  const panels = {
    ...panelsReducer(undefined, init),
    items: options.panels?.items ?? [],
    loadedDashboardId: options.panels?.loadedDashboardId ?? null,
    status: options.panels?.status ?? (options.panels ? "succeeded" : "idle"),
  };
  const auth = {
    ...authReducer(undefined, init),
    currentUser: options.user === undefined ? testUser() : options.user,
    status: options.user === null ? ("unauthenticated" as const) : ("authenticated" as const),
  };
  const dashboardTabs: DashboardTabsState = {
    ...initialDashboardTabsState,
    tabs: options.tabs ?? [],
    activeId: options.activeId ?? null,
    hydrated: options.hydrated ?? true,
    changeSignals: options.changeSignals ?? {},
  };

  const store = configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      dashboardTabs: dashboardTabsReducer,
      panels: panelsReducer,
    },
    preloadedState: { auth, dashboards, dashboardTabs, panels },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false }).concat(
        listenerMiddleware.middleware as unknown as Middleware,
      ),
  });
  return {
    store,
    dispatch: store.dispatch as unknown as AppDispatch,
    getState: store.getState as unknown as () => RootState,
  };
}
