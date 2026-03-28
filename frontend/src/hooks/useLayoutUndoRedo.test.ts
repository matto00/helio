import { configureStore } from "@reduxjs/toolkit";
import { renderHook, act } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { dashboardsReducer, fetchDashboards } from "../features/dashboards/dashboardsSlice";
import { layoutHistoryReducer, pushLayoutSnapshot } from "../features/layout/layoutHistorySlice";
import type { DashboardLayout } from "../types/models";
import { useLayoutUndoRedo } from "./useLayoutUndoRedo";

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};
const defaultAppearance = { background: "transparent", gridBackground: "transparent" };
const layoutA: DashboardLayout = {
  lg: [{ panelId: "a", x: 0, y: 0, w: 2, h: 2 }],
  md: [],
  sm: [],
  xs: [],
};
const layoutB: DashboardLayout = {
  lg: [{ panelId: "b", x: 2, y: 0, w: 2, h: 2 }],
  md: [],
  sm: [],
  xs: [],
};
const dashboardId = "dash-1";

function makeStore() {
  const store = configureStore({
    reducer: {
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
    } as never,
  });

  // Seed a dashboard
  store.dispatch(
    fetchDashboards.fulfilled(
      [
        {
          id: dashboardId,
          name: "Test Dashboard",
          meta: defaultMeta,
          appearance: defaultAppearance,
          layout: layoutB,
        },
      ],
      "req",
      undefined,
    ),
  );

  return store;
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store, children });
  };
}

describe("useLayoutUndoRedo", () => {
  it("dispatches undo on Ctrl+Z", () => {
    const store = makeStore();
    // Push layoutA to history so there's something to undo
    store.dispatch(pushLayoutSnapshot({ dashboardId, layout: layoutA }));

    renderHook(() => useLayoutUndoRedo(dashboardId), { wrapper: wrapper(store) });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
      );
    });

    const state = store.getState() as ReturnType<typeof store.getState>;
    // The layout in dashboards should now be layoutA (the undo target)
    const dashboard = (
      state as never as { dashboards: { items: Array<{ id: string; layout: DashboardLayout }> } }
    ).dashboards.items.find((d: { id: string }) => d.id === dashboardId);
    expect(dashboard?.layout).toEqual(layoutA);
  });

  it("dispatches redo on Ctrl+Shift+Z", () => {
    const store = makeStore();
    store.dispatch(pushLayoutSnapshot({ dashboardId, layout: layoutA }));

    renderHook(() => useLayoutUndoRedo(dashboardId), { wrapper: wrapper(store) });

    // Undo first
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
      );
    });

    // Redo
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true }),
      );
    });

    const state = store.getState() as never as {
      dashboards: { items: Array<{ id: string; layout: DashboardLayout }> };
    };
    const dashboard = state.dashboards.items.find((d: { id: string }) => d.id === dashboardId);
    expect(dashboard?.layout).toEqual(layoutB);
  });

  it("does not dispatch when focused on an input element", () => {
    const store = makeStore();
    store.dispatch(pushLayoutSnapshot({ dashboardId, layout: layoutA }));

    renderHook(() => useLayoutUndoRedo(dashboardId), { wrapper: wrapper(store) });

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
      );
    });

    document.body.removeChild(input);

    // Layout should remain layoutB (unchanged) since keydown was suppressed
    const state = store.getState() as never as {
      dashboards: { items: Array<{ id: string; layout: DashboardLayout }> };
    };
    const dashboard = state.dashboards.items.find((d: { id: string }) => d.id === dashboardId);
    expect(dashboard?.layout).toEqual(layoutB);
  });

  it("does nothing when dashboardId is null", () => {
    const store = makeStore();
    store.dispatch(pushLayoutSnapshot({ dashboardId, layout: layoutA }));

    renderHook(() => useLayoutUndoRedo(null), { wrapper: wrapper(store) });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
      );
    });

    const state = store.getState() as never as {
      dashboards: { items: Array<{ id: string; layout: DashboardLayout }> };
    };
    const dashboard = state.dashboards.items.find((d: { id: string }) => d.id === dashboardId);
    expect(dashboard?.layout).toEqual(layoutB);
  });
});
