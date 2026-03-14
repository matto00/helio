import { fetchPanels, panelsReducer } from "./panelsSlice";

describe("panelsSlice", () => {
  it("stores backend panels for the selected dashboard", () => {
    const nextState = panelsReducer(
      undefined,
      fetchPanels.fulfilled(
        [{ id: "panel-1", dashboardId: "dashboard-1", title: "Latency" }],
        "request-id",
        "dashboard-1",
      ),
    );

    expect(nextState.items).toHaveLength(1);
    expect(nextState.items[0]).toMatchObject({
      dashboardId: "dashboard-1",
      title: "Latency",
    });
    expect(nextState.status).toBe("succeeded");
  });

  it("stores an error when panel loading fails", () => {
    const nextState = panelsReducer(
      undefined,
      fetchPanels.rejected(null, "request-id", "dashboard-1", "Failed to load panels."),
    );

    expect(nextState.status).toBe("failed");
    expect(nextState.error).toBe("Failed to load panels.");
  });
});
