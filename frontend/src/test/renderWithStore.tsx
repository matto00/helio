import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { defaultDashboardLayout } from "../features/dashboards/dashboardLayout";
import { dataTypesReducer } from "../features/dataTypes/dataTypesSlice";
import { dashboardsReducer } from "../features/dashboards/dashboardsSlice";
import { panelsReducer } from "../features/panels/panelsSlice";
import { sourcesReducer } from "../features/sources/sourcesSlice";
import { OverlayProvider } from "../components/OverlayProvider";
import { ThemeProvider } from "../theme/ThemeProvider";
import { defaultDashboardAppearance, defaultPanelAppearance } from "../theme/appearance";
import type {
  DataSource,
  DataType,
  DashboardAppearance,
  DashboardLayout,
  PanelAppearance,
  PanelType,
  ResourceMeta,
} from "../types/models";

const defaultMeta: ResourceMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

interface TestState {
  dashboards?: {
    items: Array<{
      id: string;
      name: string;
      meta?: ResourceMeta;
      appearance?: DashboardAppearance;
      layout?: DashboardLayout;
    }>;
    selectedDashboardId?: string | null;
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
  };
  panels?: {
    items: Array<{
      id: string;
      dashboardId: string;
      title: string;
      type?: PanelType;
      meta?: ResourceMeta;
      appearance?: PanelAppearance;
    }>;
    loadedDashboardId?: string | null;
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
  };
  dataTypes?: {
    items?: DataType[];
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
  };
  sources?: {
    items?: DataSource[];
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
  };
}

export function renderWithStore(ui: ReactElement, preloadedState?: TestState) {
  const reducer = {
    dashboards: dashboardsReducer,
    panels: panelsReducer,
    dataTypes: dataTypesReducer,
    sources: sourcesReducer,
  };

  const normalizedState = preloadedState
    ? {
        dashboards: {
          items:
            preloadedState.dashboards?.items.map((dashboard) => ({
              ...dashboard,
              meta: dashboard.meta ?? defaultMeta,
              appearance: dashboard.appearance ?? defaultDashboardAppearance,
              layout: dashboard.layout ?? defaultDashboardLayout,
            })) ?? [],
          selectedDashboardId: preloadedState.dashboards?.selectedDashboardId ?? null,
          status: preloadedState.dashboards?.status ?? "idle",
          error: preloadedState.dashboards?.error ?? null,
        },
        panels: {
          items:
            preloadedState.panels?.items.map((panel) => ({
              typeId: null,
              fieldMapping: null,
              refreshInterval: null,
              ...panel,
              type: panel.type ?? "metric",
              meta: panel.meta ?? defaultMeta,
              appearance: panel.appearance ?? defaultPanelAppearance,
            })) ?? [],
          loadedDashboardId: preloadedState.panels?.loadedDashboardId ?? null,
          status: preloadedState.panels?.status ?? "idle",
          error: preloadedState.panels?.error ?? null,
        },
        dataTypes: {
          items: preloadedState.dataTypes?.items ?? [],
          status: preloadedState.dataTypes?.status ?? "idle",
          error: preloadedState.dataTypes?.error ?? null,
        },
        sources: {
          items: preloadedState.sources?.items ?? [],
          status: preloadedState.sources?.status ?? "idle",
          error: preloadedState.sources?.error ?? null,
        },
      }
    : undefined;

  const store = configureStore({
    reducer: reducer as never,
    preloadedState: normalizedState as never,
  });

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <MemoryRouter>
        <ThemeProvider>
          <Provider store={store}>
            <OverlayProvider>{children}</OverlayProvider>
          </Provider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }

  return {
    store,
    ...render(ui, { wrapper: Wrapper }),
  };
}
