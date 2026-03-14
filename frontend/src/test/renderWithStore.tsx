import { configureStore } from "@reduxjs/toolkit";
import { render, type RenderResult } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { Provider } from "react-redux";

import { dashboardsReducer } from "../features/dashboards/dashboardsSlice";
import { panelsReducer } from "../features/panels/panelsSlice";

interface TestState {
  dashboards?: {
    items: Array<{ id: string; name: string }>;
  };
  panels?: {
    items: Array<{ id: string; dashboardId: string; title: string }>;
  };
}

export function renderWithStore(ui: ReactElement, preloadedState?: TestState): RenderResult {
  const reducer = {
    dashboards: dashboardsReducer,
    panels: panelsReducer,
  };

  const store = configureStore({
    reducer: reducer as never,
    preloadedState: preloadedState as never,
  });

  function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  }

  return render(ui, { wrapper: Wrapper });
}
