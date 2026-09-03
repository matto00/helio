import { configureStore } from "@reduxjs/toolkit";
import * as panelService from "../services/panelService";
import {
  accumulatePanelUpdate,
  clearPendingPanelUpdates,
  createPanel,
  fetchPanelPage,
  fetchPanels,
  markDashboardPanelsStale,
  panelsReducer,
  resetPanelPagination,
  updatePanelAppearance,
  updatePanelMarkdownContent,
  updatePanelsBatch,
} from "./panelsSlice";
import { dashboardsReducer, importDashboard } from "../../dashboards/state/dashboardsSlice";
import { makeMarkdownPanel, makeOutputPanel } from "../../../test/panelFixtures";
import type { OutputPanel } from "../types/panel";
const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const basePanel: OutputPanel = makeOutputPanel({
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
      createPanel.rejected(null, "request-id-2", { dashboardId: "dashboard-1", type: "output" }),
    );

    expect(nextState.error).toBe("Failed to create panel.");
  });

  it("replaces panels and sets loadedDashboardId when importDashboard fulfills", () => {
    const initialState = panelsReducer(
      undefined,
      fetchPanels.fulfilled([basePanel], "request-id", "dashboard-1"),
    );

    const importedPanel = makeOutputPanel({
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
        fields: { title: "First title", type: "output" },
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
      type: "output",
    });
    expect(after2.items[0].title).toBe("Second title");
    expect(after2.items[0].type).toBe("output");
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

  describe("fetchPanelPage", () => {
    it("initial load (page 0) populates rows and hasMore", () => {
      const rows = [{ n: 1 }, { n: 2 }];
      const nextState = panelsReducer(
        undefined,
        fetchPanelPage.fulfilled(
          { panelId: "panel-1", page: 0, rows, hasMore: true, materialized: true },
          "req",
          {
            panelId: "panel-1",
            outputId: "output-1",
            page: 0,
            pageSize: 50,
          },
        ),
      );

      expect(nextState.paginationState["panel-1"]).toEqual({
        currentPage: 0,
        hasMore: true,
        isLoadingMore: false,
        rows,
        materialized: true,
      });
    });

    it("load-more (page > 0) appends rows to existing state", () => {
      const firstRows = [{ n: 1 }, { n: 2 }];
      const moreRows = [{ n: 3 }, { n: 4 }];

      const afterFirstPage = panelsReducer(
        undefined,
        fetchPanelPage.fulfilled(
          { panelId: "panel-1", page: 0, rows: firstRows, hasMore: true, materialized: true },
          "req-1",
          { panelId: "panel-1", outputId: "output-1", page: 0, pageSize: 2 },
        ),
      );

      const afterSecondPage = panelsReducer(
        afterFirstPage,
        fetchPanelPage.fulfilled(
          { panelId: "panel-1", page: 1, rows: moreRows, hasMore: false, materialized: true },
          "req-2",
          { panelId: "panel-1", outputId: "output-1", page: 1, pageSize: 2 },
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
        fetchPanelPage.pending("req", {
          panelId: "panel-1",
          outputId: "output-1",
          page: 0,
          pageSize: 50,
        }),
      );
      expect(nextState.paginationState["panel-1"].isLoadingMore).toBe(true);
    });
  });

  describe("resetPanelPagination", () => {
    it("clears pagination state for the given panelId", () => {
      const withPagination = panelsReducer(
        undefined,
        fetchPanelPage.fulfilled(
          { panelId: "panel-1", page: 0, rows: [{ n: 1 }], hasMore: false, materialized: true },
          "req",
          { panelId: "panel-1", outputId: "output-1", page: 0, pageSize: 50 },
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
          { panelId: "panel-1", page: 0, rows: [{ n: 1 }], hasMore: false, materialized: true },
          "req-1",
          { panelId: "panel-1", outputId: "output-1", page: 0, pageSize: 50 },
        ),
      );
      state = panelsReducer(
        state,
        fetchPanelPage.fulfilled(
          { panelId: "panel-2", page: 0, rows: [{ n: 2 }], hasMore: false, materialized: true },
          "req-2",
          { panelId: "panel-2", outputId: "output-2", page: 0, pageSize: 50 },
        ),
      );

      const afterReset = panelsReducer(state, resetPanelPagination("panel-1"));

      expect(afterReset.paginationState["panel-1"]).toBeUndefined();
      expect(afterReset.paginationState["panel-2"]).toBeDefined();
    });
  });

  // Task 4.1 — createPanel thunk passes outputId through to the service request
  describe("createPanel thunk", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("includes outputId in the service request when provided", async () => {
      const mockCreatedPanel = makeOutputPanel({ id: "panel-1", dashboardId: "dashboard-1" });
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
            // HEL-548 D1/D5a — PanelsState grew these two fields; this
            // literal is checked against the real (uncast) reducer type.
            staleDashboardId: null,
            panelCreationModalOpen: false,
          },
        },
      });

      const action = createPanel({
        dashboardId: "dashboard-1",
        type: "output",
        title: "Revenue",
        outputId: "out-x",
      });
      // @ts-expect-error — test store has fewer slices than the full RootState
      await store.dispatch(action);

      expect(panelService.createPanel).toHaveBeenCalledWith(
        "dashboard-1",
        "output",
        "Revenue",
        "out-x",
      );
    });

    // HEL-909 CR1 cycle-2 fix (evaluation-2.md finding 1): the client-side
    // mirror of the backend's `placeDefaultLayout` bug -- `createPanel` used
    // to overwrite md/sm/xs with a bare copy of the lg array (verbatim
    // `w`/`x`, not scaled to each breakpoint's own column count), destroying
    // any pre-existing, independently-customized per-breakpoint layout.
    it("appends the new panel to each breakpoint's own existing layout, scaled to its column count", async () => {
      const mockCreatedPanel = {
        ...makeOutputPanel({ id: "panel-new", dashboardId: "dashboard-1" }),
        layout: { x: 0, y: 5, w: 6, h: 4 },
      };
      jest.spyOn(panelService, "createPanel").mockResolvedValue(mockCreatedPanel);
      jest.spyOn(panelService, "fetchPanels").mockResolvedValue([mockCreatedPanel]);

      const existingPanelId = "panel-existing";
      const store = configureStore({
        reducer: { panels: panelsReducer, dashboards: dashboardsReducer },
        preloadedState: {
          panels: {
            items: [],
            loadedDashboardId: "dashboard-1",
            status: "succeeded" as const,
            error: null,
            pendingPanelUpdates: {},
            lastSavedAt: null,
            paginationState: {},
            staleDashboardId: null,
            panelCreationModalOpen: false,
          },
          dashboards: {
            items: [
              {
                id: "dashboard-1",
                name: "Ops",
                meta: defaultMeta,
                appearance: { background: "transparent", gridBackground: "transparent" },
                layout: {
                  lg: [{ panelId: existingPanelId, x: 8, y: 0, w: 4, h: 5 }],
                  md: [{ panelId: existingPanelId, x: 3, y: 1, w: 7, h: 9 }],
                  sm: [{ panelId: existingPanelId, x: 1, y: 2, w: 5, h: 3 }],
                  xs: [{ panelId: existingPanelId, x: 0, y: 0, w: 2, h: 7 }],
                },
              },
            ],
            selectedDashboardId: "dashboard-1",
            status: "succeeded" as const,
            error: null,
            hasPendingLayout: false,
          },
        },
      });

      const action = createPanel({
        dashboardId: "dashboard-1",
        type: "output",
        outputId: "out-x",
      });
      // @ts-expect-error — test store has fewer slices than the full RootState
      await store.dispatch(action);

      const dashboard = store.getState().dashboards.items[0];

      // Pre-existing md/sm/xs items survive unchanged (not overwritten by lg's array).
      expect(dashboard.layout.md[0]).toEqual({ panelId: existingPanelId, x: 3, y: 1, w: 7, h: 9 });
      expect(dashboard.layout.sm[0]).toEqual({ panelId: existingPanelId, x: 1, y: 2, w: 5, h: 3 });
      expect(dashboard.layout.xs[0]).toEqual({ panelId: existingPanelId, x: 0, y: 0, w: 2, h: 7 });

      // The new item is appended (not replacing), one per breakpoint.
      expect(dashboard.layout.lg).toHaveLength(2);
      expect(dashboard.layout.md).toHaveLength(2);
      expect(dashboard.layout.sm).toHaveLength(2);
      expect(dashboard.layout.xs).toHaveLength(2);

      // And scaled per breakpoint's column count (lg 12 / md 10 / sm 6 / xs 2),
      // not the raw lg w/x copied verbatim.
      expect(dashboard.layout.lg[1]).toMatchObject({ w: 6, x: 0 });
      expect(dashboard.layout.md[1]).toMatchObject({ w: 5, x: 0 }); // round(6 * 10/12)
      expect(dashboard.layout.sm[1]).toMatchObject({ w: 3, x: 0 }); // round(6 * 6/12)
      expect(dashboard.layout.xs[1].w).toBeLessThanOrEqual(2);
      expect(dashboard.layout.xs[1].w).not.toBe(dashboard.layout.lg[1].w);
    });
  });

  it("replaces the updated panel when updatePanelMarkdownContent fulfills", () => {
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
      updatePanelMarkdownContent.fulfilled(
        {
          ...markdownPanel,
          config: { content: "## Updated content" },
        },
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

  // Task 1.5 — HEL-548 D1's staleDashboardId discriminator.
  describe("staleDashboardId (HEL-548 D1)", () => {
    function loadedState() {
      const pending = panelsReducer(undefined, fetchPanels.pending("req-1", "dashboard-1"));
      return panelsReducer(pending, fetchPanels.fulfilled([basePanel], "req-1", "dashboard-1"));
    }

    it("markDashboardPanelsStale for the loaded dashboard records it, returns to idle, and clears loadedDashboardId", () => {
      const stale = panelsReducer(loadedState(), markDashboardPanelsStale("dashboard-1"));
      expect(stale.staleDashboardId).toBe("dashboard-1");
      expect(stale.status).toBe("idle");
      expect(stale.loadedDashboardId).toBeNull();
    });

    it("a subsequent fetchPanels.pending clears staleDashboardId", () => {
      const stale = panelsReducer(loadedState(), markDashboardPanelsStale("dashboard-1"));
      const refetching = panelsReducer(stale, fetchPanels.pending("req-2", "dashboard-1"));
      expect(refetching.staleDashboardId).toBeNull();
    });

    it("markDashboardPanelsStale for a DIFFERENT dashboard id leaves staleDashboardId/status/loadedDashboardId untouched", () => {
      const loaded = loadedState();
      const untouched = panelsReducer(loaded, markDashboardPanelsStale("dashboard-2"));
      expect(untouched.staleDashboardId).toBeNull();
      expect(untouched.status).toBe("succeeded");
      expect(untouched.loadedDashboardId).toBe("dashboard-1");
    });
  });

  // Task 1.6 — locks design.md D2's unstated premise: closing the panel
  // area's pre-dispatch frame (D2) depends on `fetchPanels`'s `condition`
  // (panelThunks.ts) never skipping a dispatch from the invalidated state
  // (status: "idle", loadedDashboardId: null). If a future edit to
  // `condition` silently starts skipping that dispatch, this test fails
  // loudly instead of quietly parking a permanent skeleton — the exact
  // failure HEL-528 wrote D11 to prevent.
  describe("fetchPanels condition (HEL-548 D2's unstated premise, locked)", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("a fetchPanels dispatch from the invalidated state (idle, loadedDashboardId null) is not skipped", async () => {
      jest.spyOn(panelService, "fetchPanels").mockResolvedValue([]);
      const store = configureStore({
        reducer: { panels: panelsReducer },
        preloadedState: {
          panels: {
            items: [],
            loadedDashboardId: null,
            status: "idle" as const,
            error: null,
            pendingPanelUpdates: {},
            lastSavedAt: null,
            paginationState: {},
            staleDashboardId: "dashboard-1",
            panelCreationModalOpen: false,
          },
        },
      });

      // @ts-expect-error — test store has fewer slices than the full RootState
      const dispatched = store.dispatch(fetchPanels("dashboard-1"));
      // RTK's `condition` check (and the resulting `pending` dispatch, when
      // not skipped) runs synchronously before the payload creator's first
      // `await` — so if the dispatch were skipped, status would still read
      // "idle" here. Reading it BEFORE awaiting the thunk is what makes this
      // probe actually distinguish "skipped" from "dispatched".
      expect(store.getState().panels.status).toBe("loading");
      await dispatched;
    });
  });
});
