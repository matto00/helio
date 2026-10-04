// HEL-1071 — a rejected layout save is not silent: the server's message (breakpoint + panel ids)
// is the rejection payload (what the toast shows) and the dashboard is re-read so the store's
// authored layout converges on the server's.
import { configureStore } from "@reduxjs/toolkit";

import {
  fetchDashboards as fetchDashboardsRequest,
  updateDashboardLayout as updateDashboardLayoutRequest,
} from "../services/dashboardService";
import { dashboardsReducer, updateDashboardLayout } from "./dashboardsSlice";
import type { Dashboard } from "../types/dashboard";

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

function makeStore(layout: Dashboard["layout"]) {
  return configureStore({
    reducer: { dashboards: dashboardsReducer },
    preloadedState: {
      dashboards: {
        items: [dashboard(layout)],
        selectedDashboardId: "d1",
        status: "succeeded" as const,
        error: null,
        hasPendingLayout: true,
      },
    },
  });
}

describe("updateDashboardLayout rejection", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateMock.mockReset();
  });

  it("rejects with the server's message and re-syncs the authored layout from the server", async () => {
    const authored = { lg: [], md: [], sm: [], xs: [item("a", 0), item("b", 0)] };
    const serverLayout = { lg: [], md: [], sm: [], xs: [item("a", 0), item("b", 1)] };
    updateMock.mockRejectedValue(rejection400);
    fetchMock.mockResolvedValue([dashboard(serverLayout)]);
    const store = makeStore(authored);

    const result = await store.dispatch(
      updateDashboardLayout({
        dashboardId: "d1",
        layout: { xs: authored.xs },
        sentLayout: authored,
      }),
    );

    expect(updateDashboardLayout.rejected.match(result)).toBe(true);
    expect(result.payload).toBe(message);
    expect(store.getState().dashboards.items).toHaveLength(1);
    expect(store.getState().dashboards.items[0].layout).toEqual(serverLayout);
  });

  it("falls back to the generic message when the failure carries none, and survives a failed re-sync", async () => {
    updateMock.mockRejectedValue(new Error("Network Error"));
    fetchMock.mockRejectedValue(new Error("Network Error"));
    const store = makeStore({ lg: [], md: [], sm: [], xs: [] });

    const result = await store.dispatch(
      updateDashboardLayout({
        dashboardId: "d1",
        layout: { xs: [] },
        sentLayout: { lg: [], md: [], sm: [], xs: [] },
      }),
    );

    expect(result.payload).toBe("Failed to save dashboard layout.");
    expect(store.getState().dashboards.items).toHaveLength(1);
  });
});
