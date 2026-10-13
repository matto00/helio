// HEL-1071 — a rejected layout save is not silent: the dashboard is re-read so the store's authored layout
// converges on the server's. HEL-1527 — the rejection payload (what the toast shows) is existing client copy,
// never the server's developer-facing text, which quotes raw panel ids.
import { configureStore } from "@reduxjs/toolkit";

import {
  fetchDashboards as fetchDashboardsRequest,
  updateDashboardLayout as updateDashboardLayoutRequest,
} from "../services/dashboardService";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { dashboardsReducer, updateDashboardLayout } from "./dashboardsSlice";
import { LAYOUT_CONFLICT_MESSAGE } from "./layoutConflict";
import type { Dashboard } from "../types/dashboard";
import type { Panel } from "../../panels/types/panel";

jest.mock("../services/dashboardService", () => ({
  ...jest.requireActual("../services/dashboardService"),
  fetchDashboards: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

const fetchMock = jest.mocked(fetchDashboardsRequest);
const updateMock = jest.mocked(updateDashboardLayoutRequest);

const meta = {
  createdBy: "u",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};
const appearance = { background: "transparent", gridBackground: "transparent" };
const dashboard = (layout: Dashboard["layout"]): Dashboard => ({
  id: "d1",
  name: "D",
  meta,
  appearance,
  layout,
});
const item = (panelId: string, x: number) => ({ panelId, x, y: 0, w: 1, h: 2 });

const message = "Layout rejected: breakpoint 'xs': panels 'a' and 'b' overlap";
const rejection400 = { isAxiosError: true, response: { status: 400, data: { message } } };

type PanelsOverride = {
  items: Panel[];
  loadedDashboardId: string | null;
  status: "idle" | "loading" | "succeeded" | "failed";
};

const noPanels = panelsReducer(undefined, { type: "init" });
const panelOf = (id: string) => ({ id }) as Panel;
// Panels a, b loaded for d1 (the default); the re-synced server layout may name others.
const loadedAB: PanelsOverride = {
  items: [panelOf("a"), panelOf("b")],
  loadedDashboardId: "d1",
  status: "succeeded",
};

function makeStore(layout: Dashboard["layout"], panels: PanelsOverride = loadedAB) {
  return configureStore({
    reducer: { dashboards: dashboardsReducer, panels: panelsReducer },
    preloadedState: {
      dashboards: {
        items: [dashboard(layout)],
        selectedDashboardId: "d1",
        status: "succeeded" as const,
        error: null,
        hasPendingLayout: true,
      },
      panels: { ...noPanels, ...panels },
    },
  });
}

const empty = { lg: [], md: [], sm: [], xs: [] };
const authored = { ...empty, xs: [item("a", 0), item("b", 0)] };
const withUnloaded = { ...empty, xs: [item("a", 0), item("b", 1), item("u-9f3c", 2)] };
const generic = "Failed to save dashboard layout.";

async function save(store: ReturnType<typeof makeStore>) {
  return store.dispatch(
    updateDashboardLayout({ dashboardId: "d1", layout: { xs: authored.xs }, sentLayout: authored }),
  );
}

describe("updateDashboardLayout rejection copy (HEL-1527)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateMock.mockReset();
  });

  it("400 with an unloaded panel in the re-synced layout: conflict copy, no ids, layout re-synced", async () => {
    updateMock.mockRejectedValue(rejection400);
    fetchMock.mockResolvedValue([dashboard(withUnloaded)]);
    const store = makeStore(authored);

    const result = await save(store);

    expect(updateDashboardLayout.rejected.match(result)).toBe(true);
    expect(result.payload).toBe(LAYOUT_CONFLICT_MESSAGE);
    expect(result.payload).not.toContain("'a'");
    expect(store.getState().dashboards.items).toHaveLength(1);
    expect(store.getState().dashboards.items[0].layout).toEqual(withUnloaded);
  });

  it("400 with every re-synced panel loaded: generic copy, not the server message", async () => {
    updateMock.mockRejectedValue(rejection400);
    fetchMock.mockResolvedValue([dashboard({ ...empty, xs: [item("a", 0), item("b", 1)] })]);
    const result = await save(makeStore(authored));
    expect(result.payload).toBe(generic);
  });

  it.each([
    ["panel list marked stale", { items: [], loadedDashboardId: null, status: "idle" as const }],
    [
      "panel list failed to load",
      { items: [], loadedDashboardId: "d1", status: "failed" as const },
    ],
    ["another dashboard's panels loaded", { ...loadedAB, loadedDashboardId: "other" }],
  ])("400 with an unloaded id but %s: generic copy", async (_name, panels) => {
    updateMock.mockRejectedValue(rejection400);
    fetchMock.mockResolvedValue([dashboard(withUnloaded)]);
    const result = await save(makeStore(authored, panels));
    expect(result.payload).toBe(generic);
  });

  it("400 while the panel refetch is in flight (loadedDashboardId kept, status loading): conflict copy", async () => {
    updateMock.mockRejectedValue(rejection400);
    fetchMock.mockResolvedValue([dashboard(withUnloaded)]);
    const result = await save(makeStore(authored, { ...loadedAB, status: "loading" }));
    expect(result.payload).toBe(LAYOUT_CONFLICT_MESSAGE);
  });

  it("400 with a failed re-sync: generic copy", async () => {
    updateMock.mockRejectedValue(rejection400);
    fetchMock.mockRejectedValue(new Error("Network Error"));
    const result = await save(makeStore(withUnloaded));
    expect(result.payload).toBe(generic);
  });

  it("500 with a ghost in the re-synced layout: generic copy, never conflict copy", async () => {
    updateMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 500, data: { message: "boom 'a' 'b'" } },
    });
    fetchMock.mockResolvedValue([dashboard(withUnloaded)]);
    const result = await save(makeStore(authored));
    expect(result.payload).toBe(generic);
  });

  it("a failure that carries no response, with a failed re-sync, is generic and survives", async () => {
    updateMock.mockRejectedValue(new Error("Network Error"));
    fetchMock.mockRejectedValue(new Error("Network Error"));
    const store = makeStore(empty);
    const result = await save(store);
    expect(result.payload).toBe(generic);
    expect(store.getState().dashboards.items).toHaveLength(1);
  });

  it("a non-conflict failure of the retry after a rebase: no server text in the payload", async () => {
    const base = { ...empty, xs: [item("a", 0)] };
    const current = {
      ...dashboard({ ...empty, xs: [item("a", 0), item("u-9f3c", 2)] }),
      layoutVersion: 5,
    };
    updateMock
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 409, data: { message: "stale", dashboard: current } },
      })
      .mockRejectedValueOnce(rejection400);
    fetchMock.mockResolvedValue([current]);
    const store = makeStore(base);

    const result = await store.dispatch(
      updateDashboardLayout({
        dashboardId: "d1",
        layout: { lg: [item("a", 1)] },
        sentLayout: { ...base, lg: [item("a", 1)] },
        baseLayout: base,
        baseVersion: 4,
      }),
    );

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateDashboardLayout.rejected.match(result)).toBe(true);
    expect(result.payload).not.toBe(message);
    expect(result.payload).toBe(LAYOUT_CONFLICT_MESSAGE);
  });
});
