import {
  createDashboard,
  dashboardsReducer,
  fetchDashboards,
  setDashboardLayoutLocally,
  updateDashboardAppearance,
  updateDashboardLayout,
} from "./dashboardsSlice";

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const defaultAppearance = {
  background: "transparent",
  gridBackground: "transparent",
};

const defaultLayout = {
  lg: [],
  md: [],
  sm: [],
  xs: [],
};

describe("dashboardsSlice", () => {
  it("selects the first dashboard in the response (backend guarantees lastUpdated desc order)", () => {
    const initialState = dashboardsReducer(undefined, { type: "@@INIT" });
    // Backend returns dashboards sorted by lastUpdated desc — most recently updated is first.
    const nextState = dashboardsReducer(
      initialState,
      fetchDashboards.fulfilled(
        [
          {
            id: "dashboard-2",
            name: "Executive",
            meta: {
              ...defaultMeta,
              lastUpdated: "2026-03-14T13:00:00Z",
            },
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
          {
            id: "dashboard-1",
            name: "Operations",
            meta: {
              ...defaultMeta,
              lastUpdated: "2026-03-14T12:00:00Z",
            },
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
        ],
        "request-id",
        undefined,
      ),
    );

    expect(nextState.items).toHaveLength(2);
    expect(nextState.selectedDashboardId).toBe("dashboard-2");
    expect(nextState.status).toBe("succeeded");
  });

  it("preserves the selected dashboard when it still exists in refreshed data", () => {
    const initialState = dashboardsReducer(
      undefined,
      fetchDashboards.fulfilled(
        [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
          {
            id: "dashboard-2",
            name: "Executive",
            meta: {
              ...defaultMeta,
              lastUpdated: "2026-03-14T13:00:00Z",
            },
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
        ],
        "request-id",
        undefined,
      ),
    );
    const nextState = dashboardsReducer(
      {
        ...initialState,
        selectedDashboardId: "dashboard-1",
      },
      fetchDashboards.fulfilled(
        [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
          {
            id: "dashboard-2",
            name: "Executive",
            meta: {
              ...defaultMeta,
              lastUpdated: "2026-03-14T14:00:00Z",
            },
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
        ],
        "request-id-2",
        undefined,
      ),
    );

    expect(nextState.selectedDashboardId).toBe("dashboard-1");
  });

  it("stores an error when dashboard loading fails", () => {
    const initialState = dashboardsReducer(undefined, { type: "@@INIT" });
    const nextState = dashboardsReducer(
      initialState,
      fetchDashboards.rejected(null, "request-id", undefined, "Failed to load dashboards."),
    );

    expect(nextState.status).toBe("failed");
    expect(nextState.error).toBe("Failed to load dashboards.");
  });

  it("replaces the updated dashboard appearance after a save", () => {
    const initialState = dashboardsReducer(
      undefined,
      fetchDashboards.fulfilled(
        [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
        ],
        "request-id",
        undefined,
      ),
    );

    const nextState = dashboardsReducer(
      initialState,
      updateDashboardAppearance.fulfilled(
        {
          id: "dashboard-1",
          name: "Operations",
          meta: {
            ...defaultMeta,
            lastUpdated: "2026-03-14T02:00:00Z",
          },
          appearance: {
            background: "#123456",
            gridBackground: "#234567",
          },
          layout: defaultLayout,
        },
        "request-id-2",
        {
          dashboardId: "dashboard-1",
          appearance: {
            background: "#123456",
            gridBackground: "#234567",
          },
        },
      ),
    );

    expect(nextState.items[0].appearance.background).toBe("#123456");
    expect(nextState.items[0].appearance.gridBackground).toBe("#234567");
    expect(nextState.items[0].meta.lastUpdated).toBe("2026-03-14T02:00:00Z");
  });

  it("replaces the updated dashboard layout after a save", () => {
    const initialState = dashboardsReducer(
      undefined,
      fetchDashboards.fulfilled(
        [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
        ],
        "request-id",
        undefined,
      ),
    );

    const nextState = dashboardsReducer(
      initialState,
      updateDashboardLayout.fulfilled(
        {
          id: "dashboard-1",
          name: "Operations",
          meta: {
            ...defaultMeta,
            lastUpdated: "2026-03-14T03:00:00Z",
          },
          appearance: defaultAppearance,
          layout: {
            lg: [{ panelId: "panel-1", x: 2, y: 1, w: 4, h: 6 }],
            md: [{ panelId: "panel-1", x: 1, y: 0, w: 5, h: 5 }],
            sm: [{ panelId: "panel-1", x: 0, y: 0, w: 3, h: 5 }],
            xs: [{ panelId: "panel-1", x: 0, y: 0, w: 2, h: 5 }],
          },
        },
        "request-id-3",
        {
          dashboardId: "dashboard-1",
          layout: {
            lg: [{ panelId: "panel-1", x: 2, y: 1, w: 4, h: 6 }],
            md: [{ panelId: "panel-1", x: 1, y: 0, w: 5, h: 5 }],
            sm: [{ panelId: "panel-1", x: 0, y: 0, w: 3, h: 5 }],
            xs: [{ panelId: "panel-1", x: 0, y: 0, w: 2, h: 5 }],
          },
        },
      ),
    );

    expect(nextState.items[0].layout.lg[0]).toMatchObject({
      panelId: "panel-1",
      x: 2,
      y: 1,
      w: 4,
      h: 6,
    });
    expect(nextState.items[0].meta.lastUpdated).toBe("2026-03-14T03:00:00Z");
  });

  it("adds a created dashboard and selects it", () => {
    const initialState = dashboardsReducer(
      undefined,
      fetchDashboards.fulfilled(
        [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
        ],
        "request-id",
        undefined,
      ),
    );

    const nextState = dashboardsReducer(
      initialState,
      createDashboard.fulfilled(
        {
          id: "dashboard-2",
          name: "Executive",
          meta: {
            ...defaultMeta,
            lastUpdated: "2026-03-14T05:00:00Z",
          },
          appearance: defaultAppearance,
          layout: defaultLayout,
        },
        "request-id-4",
        { name: "Executive" },
      ),
    );

    expect(nextState.items).toHaveLength(2);
    expect(nextState.items[1].name).toBe("Executive");
    expect(nextState.selectedDashboardId).toBe("dashboard-2");
  });

  describe("setDashboardLayoutLocally", () => {
    const twoItemState = dashboardsReducer(
      undefined,
      fetchDashboards.fulfilled(
        [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
          {
            id: "dashboard-2",
            name: "Executive",
            meta: defaultMeta,
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
        ],
        "req",
        undefined,
      ),
    );

    const newLayout = { lg: [{ panelId: "p1", x: 1, y: 1, w: 3, h: 3 }], md: [], sm: [], xs: [] };

    it("updates the layout for the specified dashboard", () => {
      const nextState = dashboardsReducer(
        twoItemState,
        setDashboardLayoutLocally({ dashboardId: "dashboard-1", layout: newLayout }),
      );
      const updated = nextState.items.find((d) => d.id === "dashboard-1");
      expect(updated?.layout).toEqual(newLayout);
    });

    it("does not affect other dashboards", () => {
      const nextState = dashboardsReducer(
        twoItemState,
        setDashboardLayoutLocally({ dashboardId: "dashboard-1", layout: newLayout }),
      );
      const other = nextState.items.find((d) => d.id === "dashboard-2");
      expect(other?.layout).toEqual(defaultLayout);
    });

    it("does nothing when dashboardId is not found", () => {
      const nextState = dashboardsReducer(
        twoItemState,
        setDashboardLayoutLocally({ dashboardId: "nonexistent", layout: newLayout }),
      );
      expect(nextState.items).toEqual(twoItemState.items);
    });
  });
});
