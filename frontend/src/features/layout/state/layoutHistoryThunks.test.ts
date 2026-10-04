import { configureStore } from "@reduxjs/toolkit";

import type { AppDispatch } from "../../../store/store";
import { dashboardsReducer, fetchDashboards } from "../../dashboards/state/dashboardsSlice";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import { layoutHistoryReducer, pushLayoutSnapshot } from "./layoutHistorySlice";
import { applyLayoutRedo, applyLayoutUndo } from "./layoutHistoryThunks";

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
