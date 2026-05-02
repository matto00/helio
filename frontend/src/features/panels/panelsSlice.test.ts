import {
  accumulatePanelUpdate,
  clearPendingPanelUpdates,
  createPanel,
  fetchPanels,
  panelsReducer,
  updatePanelAppearance,
  updatePanelBinding,
  updatePanelContent,
  updatePanelsBatch,
} from "./panelsSlice";
import { importDashboard } from "../dashboards/dashboardsSlice";

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

const basePanel = {
  id: "panel-1",
  dashboardId: "dashboard-1",
  title: "Latency",
  type: "metric" as const,
  meta: defaultMeta,
  appearance: defaultAppearance,
  typeId: null,
  fieldMapping: null,
  refreshInterval: null,
  content: null,
  imageUrl: null,
  imageFit: null,
};

describe("panelsSlice", () => {
  it("stores backend panels for the selected dashboard", () => {
    const nextState = panelsReducer(
      undefined,
      fetchPanels.fulfilled([basePanel], "request-id", "dashboard-1"),
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
      fetchPanels.fulfilled([basePanel], "request-id", "dashboard-1"),
    );

    const nextState = panelsReducer(
      initialState,
      updatePanelAppearance.fulfilled(
        {
          ...basePanel,
          meta: { ...defaultMeta, lastUpdated: "2026-03-14T02:00:00Z" },
          appearance: { background: "#111827", color: "#f8fafc", transparency: 0.45 },
        },
        "request-id-2",
        {
          panelId: "panel-1",
          appearance: { background: "#111827", color: "#f8fafc", transparency: 0.45 },
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

  it("replaces panels and sets loadedDashboardId when importDashboard fulfills", () => {
    const initialState = panelsReducer(
      undefined,
      fetchPanels.fulfilled([basePanel], "request-id", "dashboard-1"),
    );

    const importedPanel = {
      ...basePanel,
      id: "panel-imported",
      dashboardId: "dashboard-imported",
    };

    const nextState = panelsReducer(
      initialState,
      importDashboard.fulfilled(
        {
          dashboard: {
            id: "dashboard-imported",
            name: "Operations",
            meta: defaultMeta,
            appearance: { background: "transparent", gridBackground: "transparent" },
            layout: { lg: [], md: [], sm: [], xs: [] },
          },
          panels: [importedPanel],
        },
        "req-import",
        {
          version: 1,
          dashboard: {
            name: "Operations",
            appearance: {},
            layout: { lg: [], md: [], sm: [], xs: [] },
          },
          panels: [],
        },
      ),
    );

    expect(nextState.items).toHaveLength(1);
    expect(nextState.items[0].id).toBe("panel-imported");
    expect(nextState.loadedDashboardId).toBe("dashboard-imported");
    expect(nextState.status).toBe("succeeded");
  });

  it("updates the matching panel when updatePanelBinding fulfills", () => {
    const initialState = panelsReducer(
      undefined,
      fetchPanels.fulfilled([basePanel], "request-id", "dashboard-1"),
    );

    const nextState = panelsReducer(
      initialState,
      updatePanelBinding.fulfilled(
        { ...basePanel, typeId: "dt-1", fieldMapping: { value: "count" }, refreshInterval: 300 },
        "request-id-3",
        {
          panelId: "panel-1",
          typeId: "dt-1",
          fieldMapping: { value: "count" },
          refreshInterval: 300,
        },
      ),
    );

    expect(nextState.items[0].typeId).toBe("dt-1");
    expect(nextState.items[0].fieldMapping).toEqual({ value: "count" });
    expect(nextState.items[0].refreshInterval).toBe(300);
  });

  // Task 5.1 — accumulatePanelUpdate merges fields and patches items; clearPendingPanelUpdates resets
  it("accumulatePanelUpdate merges fields into pendingPanelUpdates and patches items optimistically", () => {
    const withPanel = panelsReducer(
      undefined,
      fetchPanels.fulfilled([basePanel], "req", "dashboard-1"),
    );

    const nextState = panelsReducer(
      withPanel,
      accumulatePanelUpdate({ panelId: "panel-1", fields: { title: "Updated" } }),
    );

    expect(nextState.pendingPanelUpdates["panel-1"]).toEqual({ title: "Updated" });
    expect(nextState.items[0].title).toBe("Updated");
  });

  it("clearPendingPanelUpdates resets the pending map to empty", () => {
    const withPanel = panelsReducer(
      undefined,
      fetchPanels.fulfilled([basePanel], "req", "dashboard-1"),
    );
    const withPending = panelsReducer(
      withPanel,
      accumulatePanelUpdate({ panelId: "panel-1", fields: { title: "Staged" } }),
    );

    const cleared = panelsReducer(withPending, clearPendingPanelUpdates());

    expect(cleared.pendingPanelUpdates).toEqual({});
    // optimistic patch in items is preserved after clear
    expect(cleared.items[0].title).toBe("Staged");
  });

  // Task 5.2 — two accumulations for the same panel ID merge (later write wins per field)
  it("two accumulatePanelUpdate calls for the same panel merge with last-write-wins semantics", () => {
    const withPanel = panelsReducer(
      undefined,
      fetchPanels.fulfilled([basePanel], "req", "dashboard-1"),
    );

    const after1 = panelsReducer(
      withPanel,
      accumulatePanelUpdate({
        panelId: "panel-1",
        fields: { title: "First title", type: "chart" },
      }),
    );
    const after2 = panelsReducer(
      after1,
      accumulatePanelUpdate({
        panelId: "panel-1",
        fields: { title: "Second title" },
      }),
    );

    expect(after2.pendingPanelUpdates["panel-1"]).toEqual({
      title: "Second title",
      type: "chart",
    });
    expect(after2.items[0].title).toBe("Second title");
    expect(after2.items[0].type).toBe("chart");
  });

  // Task 5.3 — failed updatePanelsBatch does NOT clear pendingPanelUpdates
  it("a rejected updatePanelsBatch does not clear pendingPanelUpdates", () => {
    const withPanel = panelsReducer(
      undefined,
      fetchPanels.fulfilled([basePanel], "req", "dashboard-1"),
    );
    const withPending = panelsReducer(
      withPanel,
      accumulatePanelUpdate({ panelId: "panel-1", fields: { title: "Unsaved" } }),
    );

    // Simulate a rejected batch (the slice has no handler for updatePanelsBatch.rejected)
    const afterReject = panelsReducer(
      withPending,
      updatePanelsBatch.rejected(null, "req-batch", {
        fields: ["title"],
        panels: [{ id: "panel-1", title: "Unsaved" }],
      }),
    );

    expect(afterReject.pendingPanelUpdates["panel-1"]).toEqual({ title: "Unsaved" });
  });

  it("replaces the updated panel when updatePanelContent fulfills", () => {
    const markdownPanel = { ...basePanel, type: "markdown" as const, content: null };
    const initialState = panelsReducer(
      undefined,
      fetchPanels.fulfilled([markdownPanel], "request-id", "dashboard-1"),
    );

    const nextState = panelsReducer(
      initialState,
      updatePanelContent.fulfilled(
        { ...markdownPanel, content: "## Updated content" },
        "request-id-4",
        { panelId: "panel-1", content: "## Updated content" },
      ),
    );

    expect(nextState.items[0].content).toBe("## Updated content");
    expect(nextState.items[0].type).toBe("markdown");
  });

  // Task 6.2 — lastSavedAt
  it("lastSavedAt starts as null in initial state", () => {
    const state = panelsReducer(undefined, { type: "@@INIT" });
    expect(state.lastSavedAt).toBeNull();
  });

  it("lastSavedAt is set to a timestamp when updatePanelsBatch fulfills", () => {
    const before = Date.now();
    const nextState = panelsReducer(
      undefined,
      updatePanelsBatch.fulfilled({ panels: [basePanel] }, "req-batch", {
        fields: ["title"],
        panels: [{ id: "panel-1", title: "Saved" }],
      }),
    );
    const after = Date.now();

    expect(nextState.lastSavedAt).not.toBeNull();
    expect(nextState.lastSavedAt).toBeGreaterThanOrEqual(before);
    expect(nextState.lastSavedAt).toBeLessThanOrEqual(after);
  });
});
