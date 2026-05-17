import { configureStore } from "@reduxjs/toolkit";
import * as panelService from "../services/panelService";
import {
  accumulatePanelUpdate,
  clearPendingPanelUpdates,
  createPanel,
  fetchPanelPage,
  fetchPanels,
  panelsReducer,
  resetPanelPagination,
  updatePanelAppearance,
  updatePanelBinding,
  updatePanelContent,
  updatePanelsBatch,
} from "./panelsSlice";
import { importDashboard } from "../../dashboards/state/dashboardsSlice";
import { makeMarkdownPanel, makeMetricPanel } from "../../../test/panelFixtures";
import type { MetricPanel } from "../types/panel";
const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const basePanel: MetricPanel = makeMetricPanel({
  id: "panel-1",
  dashboardId: "dashboard-1",
  title: "Latency",
  meta: defaultMeta,
  appearance: { background: "transparent", color: "inherit", transparency: 0 },
  ownerId: "system",
});

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

    const importedPanel = makeMetricPanel({
      id: "panel-imported",
      dashboardId: "dashboard-imported",
      title: "Latency",
      meta: defaultMeta,
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
    });

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
          version: 2,
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

    const boundPanel = makeMetricPanel({
      id: "panel-1",
      dashboardId: "dashboard-1",
      title: "Latency",
      meta: defaultMeta,
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
      refreshInterval: 300,
      config: { dataTypeId: "dt-1", fieldMapping: { value: "count" } },
    });

    const nextState = panelsReducer(
      initialState,
      updatePanelBinding.fulfilled(boundPanel, "request-id-3", {
        panelId: "panel-1",
        typeId: "dt-1",
        fieldMapping: { value: "count" },
        refreshInterval: 300,
      }),
    );

    const updated = nextState.items[0] as MetricPanel;
    expect(updated.config.dataTypeId).toBe("dt-1");
    expect(updated.config.fieldMapping).toEqual({ value: "count" });
    expect(updated.refreshInterval).toBe(300);
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

  // ── pagination state tests (Task 4.2) ────────────────────────────────────────

  describe("fetchPanelPage", () => {
    it("initial load (page 0) populates rows and hasMore", () => {
      const rows = [{ n: 1 }, { n: 2 }];
      const nextState = panelsReducer(
        undefined,
        fetchPanelPage.fulfilled({ panelId: "panel-1", page: 0, rows, hasMore: true }, "req", {
          panelId: "panel-1",
          page: 0,
          pageSize: 50,
        }),
      );

      expect(nextState.paginationState["panel-1"]).toEqual({
        currentPage: 0,
        hasMore: true,
        isLoadingMore: false,
        rows,
      });
    });

    it("load-more (page > 0) appends rows to existing state", () => {
      const firstRows = [{ n: 1 }, { n: 2 }];
      const moreRows = [{ n: 3 }, { n: 4 }];

      const afterFirstPage = panelsReducer(
        undefined,
        fetchPanelPage.fulfilled(
          { panelId: "panel-1", page: 0, rows: firstRows, hasMore: true },
          "req-1",
          { panelId: "panel-1", page: 0, pageSize: 2 },
        ),
      );

      const afterSecondPage = panelsReducer(
        afterFirstPage,
        fetchPanelPage.fulfilled(
          { panelId: "panel-1", page: 1, rows: moreRows, hasMore: false },
          "req-2",
          { panelId: "panel-1", page: 1, pageSize: 2 },
        ),
      );

      expect(afterSecondPage.paginationState["panel-1"].rows).toHaveLength(4);
      expect(afterSecondPage.paginationState["panel-1"].rows).toEqual([...firstRows, ...moreRows]);
      expect(afterSecondPage.paginationState["panel-1"].hasMore).toBe(false);
      expect(afterSecondPage.paginationState["panel-1"].currentPage).toBe(1);
    });

    it("pending sets isLoadingMore: true", () => {
      const nextState = panelsReducer(
        undefined,
        fetchPanelPage.pending("req", { panelId: "panel-1", page: 0, pageSize: 50 }),
      );
      expect(nextState.paginationState["panel-1"].isLoadingMore).toBe(true);
    });
  });

  describe("resetPanelPagination", () => {
    it("clears pagination state for the given panelId", () => {
      const withPagination = panelsReducer(
        undefined,
        fetchPanelPage.fulfilled(
          { panelId: "panel-1", page: 0, rows: [{ n: 1 }], hasMore: false },
          "req",
          { panelId: "panel-1", page: 0, pageSize: 50 },
        ),
      );

      expect(withPagination.paginationState["panel-1"]).toBeDefined();

      const cleared = panelsReducer(withPagination, resetPanelPagination("panel-1"));

      expect(cleared.paginationState["panel-1"]).toBeUndefined();
    });

    it("does not affect pagination state for other panels", () => {
      let state = panelsReducer(
        undefined,
        fetchPanelPage.fulfilled(
          { panelId: "panel-1", page: 0, rows: [{ n: 1 }], hasMore: false },
          "req-1",
          { panelId: "panel-1", page: 0, pageSize: 50 },
        ),
      );
      state = panelsReducer(
        state,
        fetchPanelPage.fulfilled(
          { panelId: "panel-2", page: 0, rows: [{ n: 2 }], hasMore: false },
          "req-2",
          { panelId: "panel-2", page: 0, pageSize: 50 },
        ),
      );

      const afterReset = panelsReducer(state, resetPanelPagination("panel-1"));

      expect(afterReset.paginationState["panel-1"]).toBeUndefined();
      expect(afterReset.paginationState["panel-2"]).toBeDefined();
    });
  });

  // Task 4.1 — createPanel thunk includes dataTypeId in service request when provided
  describe("createPanel thunk", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("includes dataTypeId in the service request when provided", async () => {
      const mockCreatedPanel = makeMetricPanel({ id: "panel-1", dashboardId: "dashboard-1" });
      jest.spyOn(panelService, "createPanel").mockResolvedValue(mockCreatedPanel);
      // Also mock fetchPanels so the thunk doesn't error after create
      jest.spyOn(panelService, "fetchPanels").mockResolvedValue([mockCreatedPanel]);

      const store = configureStore({
        reducer: { panels: panelsReducer },
        preloadedState: {
          panels: {
            items: [],
            loadedDashboardId: "dashboard-1",
            status: "succeeded" as const,
            error: null,
            pendingPanelUpdates: {},
            lastSavedAt: null,
            paginationState: {},
          },
        },
      });

      const action = createPanel({
        dashboardId: "dashboard-1",
        title: "Revenue",
        type: "metric",
        dataTypeId: "dt-x",
      });
      // @ts-expect-error — test store has fewer slices than the full RootState
      await store.dispatch(action);

      expect(panelService.createPanel).toHaveBeenCalledWith(
        "dashboard-1",
        "Revenue",
        "metric",
        undefined,
        "dt-x",
      );
    });
  });

  it("replaces the updated panel when updatePanelContent fulfills", () => {
    const markdownPanel = makeMarkdownPanel({
      id: "panel-1",
      dashboardId: "dashboard-1",
      title: "Latency",
      meta: defaultMeta,
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
    });
    const initialState = panelsReducer(
      undefined,
      fetchPanels.fulfilled([markdownPanel], "request-id", "dashboard-1"),
    );

    const nextState = panelsReducer(
      initialState,
      updatePanelContent.fulfilled(
        { ...markdownPanel, config: { content: "## Updated content" } },
        "request-id-4",
        { panelId: "panel-1", content: "## Updated content" },
      ),
    );

    const updated = nextState.items[0];
    expect(updated.type).toBe("markdown");
    if (updated.type === "markdown") {
      expect(updated.config.content).toBe("## Updated content");
    }
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
