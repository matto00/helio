import { configureStore } from "@reduxjs/toolkit";

import type { AppDispatch } from "../../../store/store";
import { dashboardsReducer, fetchDashboards } from "../../dashboards/state/dashboardsSlice";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import { layoutHistoryReducer, pushLayoutSnapshot } from "./layoutHistorySlice";
import { fetchPanels } from "../../panels/state/panelThunks";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { makeTextPanel } from "../../../test/panelFixtures";
import {
  applyLayoutRedo,
  applyLayoutTidy,
  applyLayoutUndo,
  selectCanTidyLayout,
} from "./layoutHistoryThunks";

const layout = (id: string, x: number): DashboardLayout => ({
  lg: [{ panelId: id, x, y: 0, w: 2, h: 2 }],
  md: [],
  sm: [],
  xs: [],
});
const layoutA = layout("a", 0);
const layoutB = layout("b", 2);
const dashboardId = "dash-1";

function makeStore() {
  const store = configureStore({
    reducer: { dashboards: dashboardsReducer, layoutHistory: layoutHistoryReducer },
  });
  store.dispatch(
    fetchDashboards.fulfilled(
      [
        {
          id: dashboardId,
          name: "D",
          meta: {
            createdBy: "s",
            createdAt: "2026-03-14T00:00:00Z",
            lastUpdated: "2026-03-14T00:00:00Z",
          },
          appearance: { background: "transparent", gridBackground: "transparent" },
          layout: layoutB,
        },
      ],
      "req",
      undefined,
    ),
  );
  return store;
}

function dispatchOf(store: ReturnType<typeof makeStore>): AppDispatch {
  return store.dispatch as unknown as AppDispatch;
}

const currentLayout = (store: ReturnType<typeof makeStore>) =>
  store.getState().dashboards.items[0].layout;

describe("layoutHistoryThunks (HEL-1230)", () => {
  it("undo restores the target, moves the stacks, returns true; redo reverses it", () => {
    const store = makeStore();
    store.dispatch(pushLayoutSnapshot({ dashboardId, layout: layoutA }));

    expect(dispatchOf(store)(applyLayoutUndo(dashboardId))).toBe(true);
    expect(currentLayout(store)).toEqual(layoutA);
    expect(store.getState().layoutHistory.byDashboard[dashboardId]).toMatchObject({
      past: [],
      future: [layoutB],
      applied: layoutA,
    });

    expect(dispatchOf(store)(applyLayoutRedo(dashboardId))).toBe(true);
    expect(currentLayout(store)).toEqual(layoutB);
    expect(store.getState().layoutHistory.byDashboard[dashboardId]).toMatchObject({
      past: [layoutA],
      future: [],
      applied: layoutB,
    });
  });

  it("returns false and leaves all state untouched when there is nothing to traverse", () => {
    const store = makeStore();
    const before = store.getState();
    expect(dispatchOf(store)(applyLayoutUndo(dashboardId))).toBe(false);
    expect(dispatchOf(store)(applyLayoutRedo(dashboardId))).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it("returns false for a dashboard that is not in the store", () => {
    const store = makeStore();
    store.dispatch(pushLayoutSnapshot({ dashboardId: "missing", layout: layoutA }));
    const before = store.getState();
    expect(dispatchOf(store)(applyLayoutUndo("missing"))).toBe(false);
    expect(store.getState()).toBe(before);
  });
});

describe("applyLayoutTidy (HEL-1576)", () => {
  const gappy: DashboardLayout = {
    lg: [
      { panelId: "a", x: 0, y: 0, w: 6, h: 4 },
      { panelId: "b", x: 0, y: 10, w: 6, h: 4 },
    ],
    md: [],
    sm: [
      { panelId: "a", x: 0, y: 0, w: 3, h: 4 },
      { panelId: "b", x: 0, y: 8, w: 3, h: 4 },
    ],
    xs: [],
  };

  function tidyStore(loadedDashboardId: string | null = dashboardId) {
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        layoutHistory: layoutHistoryReducer,
        panels: panelsReducer,
      },
    });
    store.dispatch(
      fetchDashboards.fulfilled(
        [
          {
            id: dashboardId,
            name: "D",
            meta: { createdBy: "s", createdAt: "", lastUpdated: "" },
            appearance: { background: "transparent", gridBackground: "transparent" },
            layout: gappy,
          },
        ],
        "req",
        undefined,
      ),
    );
    if (loadedDashboardId !== null) {
      const loaded = ["a", "b"].map((id) => makeTextPanel({ id, dashboardId }));
      store.dispatch(fetchPanels.pending("req-p", loadedDashboardId));
      store.dispatch(fetchPanels.fulfilled(loaded, "req-p", loadedDashboardId));
    }
    return store;
  }

  it("compacts every authored breakpoint as ONE history entry that a single undo reverses exactly", () => {
    const store = tidyStore();
    expect(selectCanTidyLayout(dashboardId)(store.getState() as never)).toBe(true);
    expect(dispatchOf(store as never)(applyLayoutTidy(dashboardId))).toBe(true);
    const tidied = store.getState().dashboards.items[0].layout;
    expect(tidied.lg.map((i) => i.y)).toEqual([0, 4]);
    expect(tidied.sm.map((i) => i.y)).toEqual([0, 4]);
    expect(tidied.md).toEqual([]);
    expect(store.getState().layoutHistory.byDashboard[dashboardId].past).toEqual([gappy]);

    expect(dispatchOf(store as never)(applyLayoutUndo(dashboardId))).toBe(true);
    expect(store.getState().dashboards.items[0].layout).toEqual(gappy);
    expect(selectCanTidyLayout(dashboardId)(store.getState() as never)).toBe(true);
  });

  it("has nothing to tidy afterwards and dispatches nothing the second time", () => {
    const store = tidyStore();
    dispatchOf(store as never)(applyLayoutTidy(dashboardId));
    expect(selectCanTidyLayout(dashboardId)(store.getState() as never)).toBe(false);
    const before = store.getState();
    expect(dispatchOf(store as never)(applyLayoutTidy(dashboardId))).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it("does nothing while the dashboard's panels are not loaded", () => {
    const store = tidyStore(null);
    expect(selectCanTidyLayout(dashboardId)(store.getState() as never)).toBe(false);
    const before = store.getState();
    expect(dispatchOf(store as never)(applyLayoutTidy(dashboardId))).toBe(false);
    expect(store.getState()).toBe(before);
  });
});
