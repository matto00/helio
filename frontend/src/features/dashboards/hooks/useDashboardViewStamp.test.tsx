import { configureStore } from "@reduxjs/toolkit";
import { act, render } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { dashboardSeenStore } from "../../commandPalette/model/dashboardSeenStore";
import { addRecentVisitsListeners } from "../../commandPalette/state/recentVisitsListeners";
import { createRecentHistoryStore } from "../../commandPalette/model/recentHistoryStore";
import { pipelinesReducer } from "../../pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { listenerMiddleware, startAppListening } from "../../../store/listenerMiddleware";
import { dashboardsReducer, setSelectedDashboardId } from "../state/dashboardsSlice";
import { useDashboardViewStamp } from "./useDashboardViewStamp";

function Probe() {
  useDashboardViewStamp();
  return null;
}

function makeStore(opts: { selected: string | null; panelsFor: string | null; ids: string[] }) {
  const dashboards = dashboardsReducer(undefined, { type: "init" });
  const panels = panelsReducer(undefined, { type: "init" });
  return configureStore({
    reducer: { dashboards: dashboardsReducer, panels: panelsReducer },
    preloadedState: {
      dashboards: {
        ...dashboards,
        status: "succeeded" as const,
        selectedDashboardId: opts.selected,
        items: opts.ids.map((id) => ({
          id,
          name: id,
          meta: { createdAt: "2026-01-01T00:00:00Z", lastUpdated: "2026-01-01T00:00:00Z" },
          appearance: { background: "transparent", gridBackground: "transparent" },
          layout: { lg: [], md: [], sm: [], xs: [] },
        })),
      },
      panels: { ...panels, status: "succeeded" as const, loadedDashboardId: opts.panelsFor },
    },
  });
}

function mount(store: ReturnType<typeof makeStore>, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Provider store={store}>
        <Routes>
          <Route path="/dashboards/:id" element={<Probe />} />
          <Route path="/dashboards" element={<Probe />} />
        </Routes>
      </Provider>
    </MemoryRouter>,
  );
}

const stamped = (id: string) => dashboardSeenStore.get(id)?.viewedAt;

describe("useDashboardViewStamp (HEL-1578 D5)", () => {
  it("stamps an already-selected dashboard once its panels have rendered on /dashboards", () => {
    const store = makeStore({ selected: "seen-a", panelsFor: "seen-a", ids: ["seen-a"] });
    mount(store, "/dashboards");
    expect(stamped("seen-a")).toBeDefined();
  });

  it("stamps nothing on /dashboards while the selected dashboard's panels have not loaded", () => {
    const store = makeStore({ selected: "seen-b", panelsFor: "other", ids: ["seen-b"] });
    mount(store, "/dashboards");
    expect(stamped("seen-b")).toBeUndefined();
  });

  it("opening X from Home while Y is selected stamps X only, once the selection matches the route", () => {
    const store = makeStore({ selected: "seen-y", panelsFor: "seen-y", ids: ["seen-x", "seen-y"] });
    mount(store, "/dashboards/seen-x");
    expect(stamped("seen-x")).toBeUndefined();
    expect(stamped("seen-y")).toBeUndefined();
    act(() => {
      store.dispatch(setSelectedDashboardId("seen-x"));
    });
    expect(stamped("seen-x")).toBeDefined();
    expect(stamped("seen-y")).toBeUndefined();
  });

  it("after a sidebar switch on /dashboards/X, the displayed dashboard is the selected one, not the route's", () => {
    const store = makeStore({
      selected: "seen-x2",
      panelsFor: "seen-x2",
      ids: ["seen-x2", "seen-z2"],
    });
    const { unmount } = mount(store, "/dashboards/seen-x2");
    const xStamp = stamped("seen-x2");
    expect(xStamp).toBeDefined();
    act(() => {
      store.dispatch(setSelectedDashboardId("seen-z2"));
    });
    expect(stamped("seen-z2")).toBeDefined();
    const xAfterSwitch = stamped("seen-x2");
    unmount();
    // Leaving stamps Z (the displayed one); X keeps the stamp it got while it was displayed.
    expect(stamped("seen-x2")).toBe(xAfterSwitch);
    expect(stamped("seen-z2")).toBeDefined();
  });

  it("stamps again on unmount and on pagehide", () => {
    jest.useFakeTimers();
    try {
      const store = makeStore({ selected: "seen-c", panelsFor: "seen-c", ids: ["seen-c"] });
      const { unmount } = mount(store, "/dashboards");
      const first = stamped("seen-c") ?? 0;
      jest.advanceTimersByTime(5_000);
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      const second = stamped("seen-c") ?? 0;
      expect(second).toBeGreaterThanOrEqual(first + 5_000);
      jest.advanceTimersByTime(5_000);
      unmount();
      expect(stamped("seen-c") ?? 0).toBeGreaterThanOrEqual(second + 5_000);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("Home load, boot auto-select and the recent-visit listener keep a stored stamp (HEL-1578 D5)", () => {
  it("a selection change driven by the recent-visit listener never touches the seen store", () => {
    dashboardSeenStore.recordViewed("seen-keep", 123);
    const store = makeStore({ selected: null, panelsFor: null, ids: ["seen-keep", "seen-other"] });
    const recents = createRecentHistoryStore("test.hel1578.recents");
    // Registered on the shared listener middleware singleton: only this test file's store sees it.
    const unsubscribe = (() => {
      addRecentVisitsListeners(startAppListening, recents, dashboardSeenStore);
      return () => listenerMiddleware.clearListeners();
    })();
    try {
      const realStore = configureStore({
        reducer: {
          dashboards: dashboardsReducer,
          panels: panelsReducer,
          sources: sourcesReducer,
          pipelines: pipelinesReducer,
        },
        middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
        preloadedState: store.getState(),
      });
      realStore.dispatch(setSelectedDashboardId("seen-keep"));
      realStore.dispatch(setSelectedDashboardId("seen-other"));
      expect(recents.getEntries().map((entry) => entry.id)).toContain("seen-other");
      expect(dashboardSeenStore.get("seen-keep")).toEqual({ viewedAt: 123 });
      expect(dashboardSeenStore.get("seen-other")).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });
});
