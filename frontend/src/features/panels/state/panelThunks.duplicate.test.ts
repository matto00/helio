import { configureStore } from "@reduxjs/toolkit";

import * as panelService from "../services/panelService";
import { duplicatePanel, panelsReducer } from "./panelsSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { makeTextPanel } from "../../../test/panelFixtures";

const meta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

describe("duplicatePanel thunk", () => {
  afterEach(() => jest.restoreAllMocks());

  it("adopts the server's per-breakpoint placement, appended to each breakpoint's own layout", async () => {
    const copy = {
      ...makeTextPanel({ id: "copy", dashboardId: "d1" }),
      layouts: {
        lg: { x: 0, y: 4, w: 6, h: 4 },
        md: { x: 0, y: 4, w: 5, h: 4 },
        sm: { x: 0, y: 4, w: 3, h: 4 },
        xs: { x: 0, y: 4, w: 2, h: 4 },
      },
    };
    jest.spyOn(panelService, "duplicatePanel").mockResolvedValue(copy);
    jest.spyOn(panelService, "fetchPanels").mockResolvedValue([copy]);
    const source = { panelId: "src", x: 0, y: 0, w: 6, h: 4 };
    const store = configureStore({
      reducer: { panels: panelsReducer, dashboards: dashboardsReducer },
      preloadedState: {
        dashboards: {
          items: [
            {
              id: "d1",
              name: "D",
              meta,
              appearance: { background: "transparent", gridBackground: "transparent" },
              layout: { lg: [source], md: [source], sm: [source], xs: [source] },
            },
          ],
          selectedDashboardId: "d1",
          status: "succeeded" as const,
          error: null,
          hasPendingLayout: false,
        },
      },
    });

    // @ts-expect-error — test store has fewer slices than the full RootState
    await store.dispatch(duplicatePanel({ panelId: "src", dashboardId: "d1" }));

    const layout = store.getState().dashboards.items[0].layout;
    expect(layout.lg).toEqual([source, { panelId: "copy", x: 0, y: 4, w: 6, h: 4 }]);
    expect(layout.xs[1]).toEqual({ panelId: "copy", x: 0, y: 4, w: 2, h: 4 });
    expect(store.getState().dashboards.hasPendingLayout).toBe(false);
  });
});
