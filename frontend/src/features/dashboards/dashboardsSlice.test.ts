import { dashboardsReducer, fetchDashboards } from "./dashboardsSlice";

describe("dashboardsSlice", () => {
  it("stores backend dashboards and selects the first dashboard by default", () => {
    const initialState = dashboardsReducer(undefined, { type: "@@INIT" });
    const nextState = dashboardsReducer(
      initialState,
      fetchDashboards.fulfilled(
        [{ id: "dashboard-1", name: "Operations" }],
        "request-id",
        undefined,
      ),
    );

    expect(nextState.items).toEqual([{ id: "dashboard-1", name: "Operations" }]);
    expect(nextState.selectedDashboardId).toBe("dashboard-1");
    expect(nextState.status).toBe("succeeded");
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
