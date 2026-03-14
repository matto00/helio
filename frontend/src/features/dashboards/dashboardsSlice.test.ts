import { dashboardsReducer, fetchDashboards } from "./dashboardsSlice";

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

describe("dashboardsSlice", () => {
  it("stores backend dashboards and selects the most recently updated dashboard by default", () => {
    const initialState = dashboardsReducer(undefined, { type: "@@INIT" });
    const nextState = dashboardsReducer(
      initialState,
      fetchDashboards.fulfilled(
        [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: {
              ...defaultMeta,
              lastUpdated: "2026-03-14T12:00:00Z",
            },
          },
          {
            id: "dashboard-2",
            name: "Executive",
            meta: {
              ...defaultMeta,
              lastUpdated: "2026-03-14T13:00:00Z",
            },
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
          },
          {
            id: "dashboard-2",
            name: "Executive",
            meta: {
              ...defaultMeta,
              lastUpdated: "2026-03-14T13:00:00Z",
            },
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
          },
          {
            id: "dashboard-2",
            name: "Executive",
            meta: {
              ...defaultMeta,
              lastUpdated: "2026-03-14T14:00:00Z",
            },
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
});
