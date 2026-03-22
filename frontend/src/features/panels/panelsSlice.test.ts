import { createPanel, fetchPanels, panelsReducer, updatePanelAppearance } from "./panelsSlice";

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const defaultAppearance = {
  background: "transparent",
  color: "inherit",
  transparency: 0,
};

describe("panelsSlice", () => {
  it("stores backend panels for the selected dashboard", () => {
    const nextState = panelsReducer(
      undefined,
      fetchPanels.fulfilled(
        [
          {
            id: "panel-1",
            dashboardId: "dashboard-1",
            title: "Latency",
            type: "metric" as const,
            meta: defaultMeta,
            appearance: defaultAppearance,
          },
        ],
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

  it("replaces the updated panel appearance after a save", () => {
    const initialState = panelsReducer(
      undefined,
      fetchPanels.fulfilled(
        [
          {
            id: "panel-1",
            dashboardId: "dashboard-1",
            title: "Latency",
            type: "metric" as const,
            meta: defaultMeta,
            appearance: defaultAppearance,
          },
        ],
        "request-id",
        "dashboard-1",
      ),
    );

    const nextState = panelsReducer(
      initialState,
      updatePanelAppearance.fulfilled(
        {
          id: "panel-1",
          dashboardId: "dashboard-1",
          title: "Latency",
          type: "metric" as const,
          meta: {
            ...defaultMeta,
            lastUpdated: "2026-03-14T02:00:00Z",
          },
          appearance: {
            background: "#111827",
            color: "#f8fafc",
            transparency: 0.45,
          },
        },
        "request-id-2",
        {
          panelId: "panel-1",
          appearance: {
            background: "#111827",
            color: "#f8fafc",
            transparency: 0.45,
          },
        },
      ),
    );

    expect(nextState.items[0].appearance.transparency).toBe(0.45);
    expect(nextState.items[0].appearance.background).toBe("#111827");
  });

  it("stores a create error when panel creation fails", () => {
    const initialState = panelsReducer(
      undefined,
      fetchPanels.fulfilled([], "request-id", "dashboard-1"),
    );

    const nextState = panelsReducer(
      initialState,
      createPanel.rejected(null, "request-id-2", { dashboardId: "dashboard-1", title: "Forecast" }),
    );

    expect(nextState.error).toBe("Failed to create panel.");
  });
});
