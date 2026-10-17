import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import {
  panelsReducer,
  resetPanelSaveState,
  updatePanelsBatch,
} from "../../features/panels/state/panelsSlice";
import { authReducer } from "../../features/auth/state/authSlice";
import {
  dashboardsReducer,
  setLayoutPending,
  updateDashboardLayout,
} from "../../features/dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../../features/layout/state/layoutHistorySlice";
import { sourcesReducer } from "../../features/sources/state/sourcesSlice";
import { ThemeProvider } from "../../theme/ThemeProvider";
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

  // F-054/F-077: "Save now" used to always render (at opacity:0, revealed
  // only on hover) — an invisible first Tab stop that was still reachable
  // (and clickable, as a no-op) via keyboard/testing-library. It's not
  // rendered at all now when there's nothing to save.
  it("does not render 'Save now' when clean (no pending changes)", () => {
    renderWithState({}, Date.now());
    expect(screen.queryByRole("button", { name: "Save now" })).not.toBeInTheDocument();
  });
});

// HEL-1584 D11a: the check follows a successful save, not "became clean".
describe("SaveStateIndicator saved check (HEL-1584)", () => {
  function renderLive() {
    const store = makeStore({});
    render(
      <MemoryRouter>
        <ThemeProvider>
          <Provider store={store}>
            <SaveStateIndicator onSaveNow={jest.fn()} />
          </Provider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    return store;
  }
  const check = () => screen.queryByRole("img", { name: "Saved" });

  it("shows no check on mount, clean or not", () => {
    renderLive();
    expect(check()).toBeNull();
  });

  it("a successful panel save pops a check beside the state", () => {
    const store = renderLive();
    act(() => {
      store.dispatch(updatePanelsBatch.fulfilled({ panels: [] } as never, "req", {} as never));
    });
    expect(check()).toBeInTheDocument();
    expect(check()).toHaveClass("motion-pop");
  });

  it("a successful layout save pops a check", () => {
    const store = renderLive();
    act(() => {
      store.dispatch(
        updateDashboardLayout.fulfilled(
          { id: "d1", layout: { lg: [], md: [], sm: [], xs: [] } } as never,
          "req",
          { dashboardId: "d1", sentLayout: { lg: [], md: [], sm: [], xs: [] } } as never,
        ),
      );
    });
    expect(check()).toBeInTheDocument();
  });

  it("clearing the dirty state without a save (an undo back to the saved layout) shows no check", () => {
    const store = renderLive();
    act(() => {
      store.dispatch(setLayoutPending(true));
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    act(() => {
      store.dispatch(setLayoutPending(false));
    });
    expect(check()).toBeNull();
  });

  it("resetPanelSaveState shows no check", () => {
    const store = renderLive();
    act(() => {
      store.dispatch(resetPanelSaveState());
    });
    expect(check()).toBeNull();
  });

  it("the check goes away at the next unsaved change and pops again at the next save", () => {
    const store = renderLive();
    const save = () =>
      act(() => {
        store.dispatch(updatePanelsBatch.fulfilled({ panels: [] } as never, "req", {} as never));
      });
    save();
    expect(check()).toBeInTheDocument();
    act(() => {
      store.dispatch(setLayoutPending(true));
    });
    expect(check()).toBeNull();
    act(() => {
      store.dispatch(setLayoutPending(false));
    });
    expect(check()).toBeNull();
    save();
    expect(check()).toBeInTheDocument();
  });
});
