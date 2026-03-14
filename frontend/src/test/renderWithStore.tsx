import { configureStore } from "@reduxjs/toolkit";
import { render, type RenderResult } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { Provider } from "react-redux";

import { dashboardsReducer } from "../features/dashboards/dashboardsSlice";
import { panelsReducer } from "../features/panels/panelsSlice";

interface TestState {
  dashboards?: {
    items: Array<{ id: string; name: string }>;
    selectedDashboardId?: string | null;
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
  };
  panels?: {
    items: Array<{ id: string; dashboardId: string; title: string }>;
    loadedDashboardId?: string | null;
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
  };
}

export function renderWithStore(ui: ReactElement, preloadedState?: TestState): RenderResult {
  const reducer = {
    dashboards: dashboardsReducer,
    panels: panelsReducer,
  };

  const normalizedState = preloadedState
    ? {
        dashboards: {
          items: preloadedState.dashboards?.items ?? [],
          selectedDashboardId: preloadedState.dashboards?.selectedDashboardId ?? null,
          status: preloadedState.dashboards?.status ?? "idle",
          error: preloadedState.dashboards?.error ?? null,
        },
        panels: {
          items: preloadedState.panels?.items ?? [],
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

  return render(ui, { wrapper: Wrapper });
}
