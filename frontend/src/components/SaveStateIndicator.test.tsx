import { configureStore } from "@reduxjs/toolkit";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { panelsReducer } from "../features/panels/panelsSlice";
import { authReducer } from "../features/auth/authSlice";
import { dataTypesReducer } from "../features/dataTypes/dataTypesSlice";
import { dashboardsReducer } from "../features/dashboards/dashboardsSlice";
import { layoutHistoryReducer } from "../features/layout/layoutHistorySlice";
import { sourcesReducer } from "../features/sources/sourcesSlice";
import { ThemeProvider } from "../theme/ThemeProvider";
import { SaveStateIndicator } from "./SaveStateIndicator";

function makeStore(overrides: {
  pendingPanelUpdates?: Record<string, object>;
  lastSavedAt?: number | null;
}) {
  return configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      panels: panelsReducer,
      dataTypes: dataTypesReducer,
      sources: sourcesReducer,
    } as never,
    preloadedState: {
      panels: {
        items: [],
        loadedDashboardId: null,
        status: "idle" as const,
        error: null,
        pendingPanelUpdates: overrides.pendingPanelUpdates ?? {},
        lastSavedAt: overrides.lastSavedAt ?? null,
      },
    } as never,
  });
}

function renderWithState(
  pendingPanelUpdates: Record<string, object>,
  lastSavedAt: number | null,
  onSaveNow = jest.fn(),
) {
  const store = makeStore({ pendingPanelUpdates, lastSavedAt });
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Provider store={store}>
          <SaveStateIndicator onSaveNow={onSaveNow} />
        </Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("SaveStateIndicator", () => {
  it("shows 'Unsaved changes' when pendingPanelUpdates is non-empty", () => {
    renderWithState({ "panel-1": { title: "New title" } }, null);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("shows relative time when clean and lastSavedAt is set", () => {
    const ts = Date.now() - 5_000; // 5 seconds ago → "just now"
    renderWithState({}, ts);
    expect(screen.getByText(/Last saved just now/)).toBeInTheDocument();
  });

  it("shows nothing (no label) when clean and no prior save", () => {
    const { container } = renderWithState({}, null);
    const label = container.querySelector(".save-state-indicator__label");
    expect(label?.textContent).toBeFalsy();
  });

  it("calls onSaveNow when 'Save now' is clicked while dirty", () => {
    const onSaveNow = jest.fn();
    renderWithState({ "panel-1": { title: "New title" } }, null, onSaveNow);
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(onSaveNow).toHaveBeenCalledTimes(1);
  });

  it("does not call onSaveNow when clicked with no pending changes", () => {
    const onSaveNow = jest.fn();
    renderWithState({}, Date.now(), onSaveNow);
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(onSaveNow).not.toHaveBeenCalled();
  });
});
