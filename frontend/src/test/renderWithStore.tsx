import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { Provider } from "react-redux";

import { dashboardsReducer } from "../features/dashboards/dashboardsSlice";
import { panelsReducer } from "../features/panels/panelsSlice";
import type { ResourceMeta } from "../types/models";

const defaultMeta: ResourceMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

interface TestState {
  dashboards?: {
    items: Array<{ id: string; name: string; meta?: ResourceMeta }>;
    selectedDashboardId?: string | null;
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
  };
  panels?: {
    items: Array<{ id: string; dashboardId: string; title: string; meta?: ResourceMeta }>;
    loadedDashboardId?: string | null;
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
  };
}

export function renderWithStore(ui: ReactElement, preloadedState?: TestState) {
  const reducer = {
    dashboards: dashboardsReducer,
    panels: panelsReducer,
  };

  const normalizedState = preloadedState
    ? {
        dashboards: {
          items:
            preloadedState.dashboards?.items.map((dashboard) => ({
              ...dashboard,
              meta: dashboard.meta ?? defaultMeta,
            })) ?? [],
          selectedDashboardId: preloadedState.dashboards?.selectedDashboardId ?? null,
          status: preloadedState.dashboards?.status ?? "idle",
          error: preloadedState.dashboards?.error ?? null,
        },
        panels: {
          items:
            preloadedState.panels?.items.map((panel) => ({
              ...panel,
              meta: panel.meta ?? defaultMeta,
            })) ?? [],
          loadedDashboardId: preloadedState.panels?.loadedDashboardId ?? null,
          status: preloadedState.panels?.status ?? "idle",
          error: preloadedState.panels?.error ?? null,
        },
      }
    : undefined;

  const store = configureStore({
    reducer: reducer as never,
    preloadedState: normalizedState as never,
  });

  function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  }

  return {
    store,
    ...render(ui, { wrapper: Wrapper }),
  };
}
