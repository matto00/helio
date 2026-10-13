// HEL-1457 — the 409 handling of `updateDashboardLayout` and the (layout, layoutVersion) pairing the store keeps.
import { configureStore } from "@reduxjs/toolkit";

import {
  fetchDashboards as fetchDashboardsRequest,
  updateDashboardLayout as updateDashboardLayoutRequest,
} from "../services/dashboardService";
import {
  dashboardsReducer,
  repairDashboardLayout,
  setDashboardLayoutLocally,
  updateDashboardLayout,
} from "./dashboardsSlice";
import { LAYOUT_CONFLICT_MESSAGE } from "./layoutConflict";
import type { Dashboard, DashboardLayout, DashboardLayoutItem } from "../types/dashboard";
import { panelsReducer } from "../../panels/state/panelsSlice";

jest.mock("../services/dashboardService", () => ({
  ...jest.requireActual("../services/dashboardService"),
  fetchDashboards: jest.fn(),
  updateDashboardLayout: jest.fn(),
  repairDashboardLayout: jest.fn(),
}));

const fetchMock = jest.mocked(fetchDashboardsRequest);
const updateMock = jest.mocked(updateDashboardLayoutRequest);
const repairMock = jest.mocked(
  jest.requireMock("../services/dashboardService").repairDashboardLayout as jest.Mock,
);

const meta = {
  createdBy: "u",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};
const appearance = { background: "transparent", gridBackground: "transparent" };
const item = (panelId: string, x: number, y = 0): DashboardLayoutItem => ({
  panelId,
  x,
  y,
  w: 4,
  h: 2,
});
const layoutOf = (lg: DashboardLayoutItem[]): DashboardLayout => ({ lg, md: [], sm: [], xs: [] });
const dashboard = (lg: DashboardLayoutItem[], layoutVersion: number): Dashboard => ({
  id: "d1",
  name: "D",
  meta,
  appearance,
  layout: layoutOf(lg),
  layoutVersion,
});
const conflict = (current: Dashboard) => ({
  isAxiosError: true,
  response: { status: 409, data: { message: "stale", dashboard: current } },
});

function makeStore(local: Dashboard) {
  return configureStore({
    reducer: { dashboards: dashboardsReducer, panels: panelsReducer },
    preloadedState: {
      dashboards: {
        items: [local],
        selectedDashboardId: "d1",
        status: "succeeded" as const,
        error: null,
        hasPendingLayout: true,
      },
    },
  });
}

describe("updateDashboardLayout 409 (HEL-1457)", () => {
  const base = layoutOf([item("a", 0)]);
  const sent = layoutOf([item("a", 4)]);
  const args = {
    dashboardId: "d1",
    layout: { lg: sent.lg },
    sentLayout: sent,
    baseLayout: base,
    baseVersion: 1,
  };

  beforeEach(() => {
    fetchMock.mockReset();
    updateMock.mockReset();
    repairMock.mockReset();
  });

  it("sends the base version, and a matching save is not rebased", async () => {
    updateMock.mockResolvedValue(dashboard([item("a", 4)], 2));
    const store = makeStore(dashboard([item("a", 4)], 1));
    const result = await store.dispatch(updateDashboardLayout(args));
    expect(updateMock).toHaveBeenCalledWith("d1", args.layout, 1);
    expect(updateDashboardLayout.fulfilled.match(result) && result.meta.rebased).toBe(false);
  });

  it("rebases onto the dashboard the 409 carries, retries once with its version, and adopts the result", async () => {
    const fresh = dashboard([item("a", 0), item("b", 0, 2)], 2);
    updateMock
      .mockRejectedValueOnce(conflict(fresh))
      .mockResolvedValueOnce(dashboard([item("a", 4), item("b", 0, 2)], 3));
    const store = makeStore(dashboard([item("a", 4)], 1));

    const result = await store.dispatch(updateDashboardLayout(args));

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenLastCalledWith("d1", { lg: [item("a", 4), item("b", 0, 2)] }, 2);
    expect(updateDashboardLayout.fulfilled.match(result) && result.meta.rebased).toBe(true);
    const stored = store.getState().dashboards.items[0];
    expect(stored.layout.lg).toEqual([item("a", 4), item("b", 0, 2)]);
    expect(stored.layoutVersion).toBe(3);
    expect(store.getState().dashboards.hasPendingLayout).toBe(false);
  });

  it("shows the fresh layout and rejects with the conflict message when the rebase is invalid", async () => {
    const fresh = dashboard([item("a", 0), item("b", 4, 0)], 2);
    updateMock.mockRejectedValueOnce(conflict(fresh));
    const store = makeStore(dashboard([item("a", 4)], 1));
    const overlapping = { ...args, layout: { lg: [item("a", 4)] } };

    const result = await store.dispatch(updateDashboardLayout(overlapping));

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateDashboardLayout.rejected.match(result) && result.payload).toBe(
      LAYOUT_CONFLICT_MESSAGE,
    );
    expect(store.getState().dashboards.items[0]).toEqual(fresh);
  });

  it("shows the newest server layout and rejects when the retry conflicts again", async () => {
    const first = dashboard([item("a", 0), item("b", 0, 2)], 2);
    const second = dashboard([item("a", 0), item("b", 0, 2), item("c", 0, 4)], 3);
    updateMock.mockRejectedValueOnce(conflict(first)).mockRejectedValueOnce(conflict(second));
    const store = makeStore(dashboard([item("a", 4)], 1));

    const result = await store.dispatch(updateDashboardLayout(args));

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateDashboardLayout.rejected.match(result) && result.payload).toBe(
      LAYOUT_CONFLICT_MESSAGE,
    );
    expect(store.getState().dashboards.items[0]).toEqual(second);
  });

  it("falls back to the dashboard list when the 409 body carries no dashboard", async () => {
    const fresh = dashboard([item("a", 0), item("b", 0, 2)], 2);
    updateMock
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 409, data: { message: "stale" } },
      })
      .mockResolvedValueOnce(dashboard([item("a", 4), item("b", 0, 2)], 3));
    fetchMock.mockResolvedValue([fresh]);
    const store = makeStore(dashboard([item("a", 4)], 1));

    await store.dispatch(updateDashboardLayout(args));

    expect(updateMock).toHaveBeenLastCalledWith("d1", { lg: [item("a", 4), item("b", 0, 2)] }, 2);
  });

  it("does not treat a 400 as a conflict", async () => {
    updateMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { message: "bad" } },
    });
    fetchMock.mockResolvedValue([dashboard([item("a", 0)], 1)]);
    const store = makeStore(dashboard([item("a", 4)], 1));
    const result = await store.dispatch(updateDashboardLayout(args));
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateDashboardLayout.rejected.match(result) && result.payload).toBe(
      "Failed to save dashboard layout.",
    );
  });
});

describe("the store keeps a local layout together with the version it derives from (D7a)", () => {
  beforeEach(() => {
    updateMock.mockReset();
    repairMock.mockReset();
  });

  it("keeps the old version when a save response is not adopted over a newer local layout", async () => {
    const sent = layoutOf([item("a", 4)]);
    updateMock.mockResolvedValue(dashboard([item("a", 4), item("other", 0, 2)], 5));
    const store = makeStore(dashboard([item("a", 8)], 1));

    await store.dispatch(
      updateDashboardLayout({
        dashboardId: "d1",
        layout: { lg: sent.lg },
        sentLayout: sent,
        baseVersion: 1,
      }),
    );

    const stored = store.getState().dashboards.items[0];
    expect(stored.layout.lg).toEqual([item("a", 8)]);
    expect(stored.layoutVersion).toBe(1);
  });

  it("keeps the old version when a repair response is not adopted over a newer local layout", async () => {
    const expectedLayout = layoutOf([item("a", 0)]);
    repairMock.mockResolvedValue(dashboard([item("a", 0), item("orphan", 0, 2)], 6));
    const store = makeStore(dashboard([item("a", 8)], 1));

    await store.dispatch(
      repairDashboardLayout({ dashboardId: "d1", layout: { lg: [] }, expectedLayout }),
    );

    expect(store.getState().dashboards.items[0].layoutVersion).toBe(1);
  });

  it("adopts the response's layout and version when the store still equals what was sent", async () => {
    const sent = layoutOf([item("a", 4)]);
    updateMock.mockResolvedValue(dashboard([item("a", 4), item("other", 0, 2)], 5));
    const store = makeStore(dashboard([item("a", 4)], 1));

    await store.dispatch(
      updateDashboardLayout({
        dashboardId: "d1",
        layout: { lg: sent.lg },
        sentLayout: sent,
        baseVersion: 1,
      }),
    );

    expect(store.getState().dashboards.items[0].layoutVersion).toBe(5);
  });
});

describe("setDashboardLayoutLocally placedLayoutVersion (HEL-1525)", () => {
  const every = (...items: DashboardLayoutItem[]): DashboardLayout => ({
    lg: items,
    md: items,
    sm: items,
    xs: items,
  });
  const before = every(item("a", 0));
  const after = every(item("a", 0), item("b", 0, 2));
  const run = (placedLayoutVersion: number | undefined, next: DashboardLayout = after) => {
    const store = makeStore({ ...dashboard([], 3), layout: before });
    store.dispatch(
      setDashboardLayoutLocally({ dashboardId: "d1", layout: next, placedLayoutVersion }),
    );
    return store.getState().dashboards.items[0];
  };

  it("adopts the version when it is exactly the store's + 1", () => {
    const d = run(4);
    expect(d.layoutVersion).toBe(4);
    expect(d.layout).toEqual(after);
  });

  it("keeps the version when a concurrent writer made it +2, and still sets the layout", () => {
    const d = run(5);
    expect(d.layoutVersion).toBe(3);
    expect(d.layout).toEqual(after);
  });

  it("keeps the version when the response carries none", () => {
    expect(run(undefined).layoutVersion).toBe(3);
  });

  it("keeps the version when the layout did not grow in every breakpoint", () => {
    const partial: DashboardLayout = { ...after, xs: before.xs };
    expect(run(4, partial).layoutVersion).toBe(3);
  });
});
