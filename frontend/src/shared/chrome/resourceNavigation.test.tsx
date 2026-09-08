import { configureStore } from "@reduxjs/toolkit";
import { renderHook, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { act } from "react";

import { dashboardsReducer } from "../../features/dashboards/state/dashboardsSlice";
import { pipelinesReducer } from "../../features/pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../../features/sources/state/sourcesSlice";
import { hrefFor, useResourceNavigator } from "./resourceNavigation";

function buildStore() {
  return configureStore({
    reducer: {
      dashboards: dashboardsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
    },
  });
}

// Mirrors `ProtectedRoute.test.tsx`'s own pattern: render the current pathname into the DOM
// (via a `data-testid` node) rather than mutate an outer variable during render — mutating one
// is a lint-caught side effect (`react-hooks/immutability`), not just a style preference.
function LocationProbe() {
  return <div data-testid="observed-pathname">{useLocation().pathname}</div>;
}

function renderNavigator(initialEntry: string) {
  const store = buildStore();
  const { result } = renderHook(() => useResourceNavigator(), {
    wrapper: ({ children }) => (
      <Provider store={store}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  {children}
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </Provider>
    ),
  });
  return {
    navigate: result.current,
    store,
    getPathname: () => screen.getByTestId("observed-pathname").textContent,
  };
}

describe("hrefFor — task 1.2", () => {
  it("returns null for a dashboard (no route id — round-1 CR4)", () => {
    expect(hrefFor({ kind: "dashboard", id: "d1" })).toBeNull();
  });

  it("returns the source detail route", () => {
    expect(hrefFor({ kind: "source", id: "s1" })).toBe("/sources/s1");
  });

  it("returns the pipeline detail route", () => {
    expect(hrefFor({ kind: "pipeline", id: "p1" })).toBe("/pipelines/p1");
  });
});

describe("useResourceNavigator — task 1.1", () => {
  it("routes a source ref to /sources/:id", () => {
    const { navigate, getPathname } = renderNavigator("/");
    act(() => navigate({ kind: "source", id: "s1" }));
    expect(getPathname()).toBe("/sources/s1");
  });

  it("routes a pipeline ref to /pipelines/:id", () => {
    const { navigate, getPathname } = renderNavigator("/");
    act(() => navigate({ kind: "pipeline", id: "p1" }));
    expect(getPathname()).toBe("/pipelines/p1");
  });

  it("selects the dashboard in Redux AND navigates to / from a non-/ route", () => {
    const { navigate, store, getPathname } = renderNavigator("/sources");
    act(() => navigate({ kind: "dashboard", id: "d1" }));
    expect(store.getState().dashboards.selectedDashboardId).toBe("d1");
    expect(getPathname()).toBe("/");
  });

  it("selects the dashboard without an extra navigate call when already at /", () => {
    const { navigate, store, getPathname } = renderNavigator("/");
    act(() => navigate({ kind: "dashboard", id: "d1" }));
    expect(store.getState().dashboards.selectedDashboardId).toBe("d1");
    expect(getPathname()).toBe("/");
  });
});
