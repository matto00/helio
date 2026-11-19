import { configureStore as rtkConfigureStore, type ConfigureStoreOptions } from "@reduxjs/toolkit";

import { dashboardsReducer } from "../features/dashboards/state/dashboardsSlice";
import { ownedDashboardsState } from "./seedOwnedDashboard";

// HEL-1780 D1 planned fixture migration. `panelReadScopeFor` is fail-closed, so a unit test of the OWNER path (the Output
// routes) must hold the panels' dashboards as owned. A test file that builds its own store calls
// `configureStoreOwning("<dashboard id>", ...)` with the ids ITS panels belong to and uses the result like Redux Toolkit's
// `configureStore`: identical, except the store also carries the `dashboards` slice with those dashboards owned by the caller
// (unless the file supplied its own `dashboards` reducer or state). A test of the non-owner path does not use this, so the
// fail-closed behaviour stays observable. There is deliberately no default id list: each file names its own.
export function configureStoreOwning(...ids: string[]): typeof rtkConfigureStore {
  return ((options: ConfigureStoreOptions) => {
    const reducer = options.reducer as unknown;
    if (typeof reducer !== "object" || reducer === null || "dashboards" in reducer) {
      return rtkConfigureStore(options);
    }
    const preloaded = (options.preloadedState ?? {}) as Record<string, unknown>;
    return rtkConfigureStore({
      ...options,
      reducer: { ...reducer, dashboards: dashboardsReducer } as never,
      preloadedState: {
        ...preloaded,
        dashboards: preloaded.dashboards ?? ownedDashboardsState(...ids),
      } as never,
    });
  }) as typeof rtkConfigureStore;
}
