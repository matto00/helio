import {
  applyProposal,
  createDashboard,
  dashboardRemoved,
  dashboardsReducer,
  dashboardUpserted,
  fetchDashboards,
  importDashboard,
  setDashboardLayoutLocally,
  updateDashboardAppearance,
  updateDashboardLayout,
} from "./dashboardsSlice";
import { fetchDashboards as fetchDashboardsRequest } from "../services/dashboardService";
import type { RootState } from "../../../store/store";

jest.mock("../services/dashboardService", () => ({
  ...jest.requireActual("../services/dashboardService"),
  fetchDashboards: jest.fn(),
}));

const fetchDashboardsRequestMock = jest.mocked(fetchDashboardsRequest);

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

  it("adds the imported dashboard and selects it on importDashboard.fulfilled", () => {
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
      importDashboard.fulfilled(
        {
          dashboard: {
            id: "dashboard-imported",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
          panels: [],
        },
        "req-import",
        {
          version: 1,
          dashboard: {
            name: "Operations",
            appearance: {},
            layout: defaultLayout,
          },
          panels: [],
        },
      ),
    );

    expect(nextState.items).toHaveLength(2);
    expect(nextState.items[1].id).toBe("dashboard-imported");
    expect(nextState.selectedDashboardId).toBe("dashboard-imported");
  });

  // HEL-290 — applying a proposal must update the dashboards list in the same
  // dispatch cycle (the sidebar was stale because the old flow relied on a
  // condition-blocked fetchDashboards refetch).
  it("appends the applied dashboard and selects it on applyProposal.fulfilled", () => {
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
      applyProposal.fulfilled(
        {
          dashboard: {
            id: "dashboard-applied",
            name: "Applied overview",
            meta: defaultMeta,
            appearance: defaultAppearance,
            layout: defaultLayout,
          },
          panels: [],
        },
        "req-apply",
        { dashboardName: "Applied overview", panels: [] },
      ),
    );

    expect(nextState.items).toHaveLength(2);
    expect(nextState.items[1].id).toBe("dashboard-applied");
    expect(nextState.selectedDashboardId).toBe("dashboard-applied");
  });

  it("leaves items and selection unchanged and carries the server message on applyProposal.rejected", () => {
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

    const action = applyProposal.rejected(
      new Error("Rejected"),
      "req-apply-fail",
      { dashboardName: "Applied overview", panels: [] },
      "Panel references an unknown DataType.",
    );
    const nextState = dashboardsReducer(initialState, action);

    expect(nextState.items).toEqual(initialState.items);
    expect(nextState.selectedDashboardId).toBe(initialState.selectedDashboardId);
    expect(action.payload).toBe("Panel references an unknown DataType.");
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

  it("updates dashboard layout in state after updateDashboardLayout.fulfilled", () => {
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

    const updatedLayout = {
      lg: [{ panelId: "panel-1", x: 0, y: 0, w: 6, h: 5 }],
      md: [],
      sm: [],
      xs: [],
    };

    const nextState = dashboardsReducer(
      initialState,
      updateDashboardLayout.fulfilled(
        {
          id: "dashboard-1",
          name: "Operations",
          meta: { ...defaultMeta, lastUpdated: "2026-04-30T10:00:00Z" },
          appearance: defaultAppearance,
          layout: updatedLayout,
        },
        "request-layout",
        { dashboardId: "dashboard-1", layout: updatedLayout },
      ),
    );

    expect(nextState.items[0].layout.lg).toHaveLength(1);
    expect(nextState.items[0].layout.lg[0]).toMatchObject({
      panelId: "panel-1",
      x: 0,
      y: 0,
      w: 6,
      h: 5,
    });
    expect(nextState.items[0].meta.lastUpdated).toBe("2026-04-30T10:00:00Z");
  });

  // ── HEL-1119: createDashboard/fetchDashboards race ──────────────────────
  // A concurrent `fetchDashboards` list refetch can resolve to the client
  // AFTER the create request commits server-side but BEFORE the create
  // response itself reaches the client (e.g. the POST response is slower on
  // the wire than a GET fired moments later). In that ordering,
  // `fetchDashboards.fulfilled` replaces `items` with a list that ALREADY
  // contains the new dashboard row, and the subsequent `createDashboard.
  // fulfilled` then blindly pushes the same dashboard again.
  describe("createDashboard / fetchDashboards race (HEL-1119)", () => {
    const newDashboard = {
      id: "dashboard-2",
      name: "Executive",
      meta: { ...defaultMeta, lastUpdated: "2026-03-14T05:00:00Z" },
      appearance: defaultAppearance,
      layout: defaultLayout,
    };

    it("does not duplicate the dashboard when a list refetch (already containing it) resolves before the create response", () => {
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

      // The concurrent refetch resolves first; its payload already includes
      // the new dashboard because the create had already committed
      // server-side by the time this GET was served.
      const afterRefetch = dashboardsReducer(
        initialState,
        fetchDashboards.fulfilled(
          [
            {
              id: "dashboard-1",
              name: "Operations",
              meta: defaultMeta,
              appearance: defaultAppearance,
              layout: defaultLayout,
            },
            newDashboard,
          ],
          "request-id-2",
          undefined,
        ),
      );

      // The create thunk's own response then finally resolves for the same
      // dashboard.
      const afterCreate = dashboardsReducer(
        afterRefetch,
        createDashboard.fulfilled(newDashboard, "request-id-3", { name: "Executive" }),
      );

      const matches = afterCreate.items.filter((d) => d.id === newDashboard.id);
      expect(matches).toHaveLength(1);
      expect(afterCreate.items).toHaveLength(2);
    });
  });

  // ── dashboardUpserted / dashboardRemoved (HEL-408, patch-set apply's
  // post-Accept cache invalidation — no dedicated thunk of its own to hang
  // an `extraReducers` case off, unlike every other mutation above) ────────

  describe("dashboardUpserted", () => {
    it("replaces an existing dashboard by id, field-for-field", () => {
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

      const renamed = {
        id: "dashboard-1",
        name: "Renamed via patch set",
        meta: { ...defaultMeta, lastUpdated: "2026-05-01T00:00:00Z" },
        appearance: defaultAppearance,
        layout: defaultLayout,
      };
      const nextState = dashboardsReducer(initialState, dashboardUpserted(renamed));

      expect(nextState.items).toHaveLength(1);
      expect(nextState.items[0]).toEqual(renamed);
    });

    it("appends a new dashboard when its id is not already cached", () => {
      const initialState = dashboardsReducer(undefined, { type: "@@INIT" });
      const created = {
        id: "dashboard-new",
        name: "New via patch set",
        meta: defaultMeta,
        appearance: defaultAppearance,
        layout: defaultLayout,
      };
      const nextState = dashboardsReducer(initialState, dashboardUpserted(created));

      expect(nextState.items).toEqual([created]);
    });
  });

  describe("dashboardRemoved", () => {
    it("removes the dashboard by id and reselects the next most-recent one", () => {
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
              meta: defaultMeta,
              appearance: defaultAppearance,
              layout: defaultLayout,
            },
          ],
          "request-id",
          undefined,
        ),
      );
      expect(initialState.selectedDashboardId).toBe("dashboard-1");

      const nextState = dashboardsReducer(initialState, dashboardRemoved("dashboard-1"));

      expect(nextState.items.map((d) => d.id)).toEqual(["dashboard-2"]);
      expect(nextState.selectedDashboardId).toBe("dashboard-2");
    });

    it("leaves selection unchanged when the removed dashboard was not selected", () => {
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
              meta: defaultMeta,
              appearance: defaultAppearance,
              layout: defaultLayout,
            },
          ],
          "request-id",
          undefined,
        ),
      );

      const nextState = dashboardsReducer(initialState, dashboardRemoved("dashboard-2"));

      expect(nextState.items.map((d) => d.id)).toEqual(["dashboard-1"]);
      expect(nextState.selectedDashboardId).toBe("dashboard-1");
    });
  });
});

// HEL-503 evaluator S2' (cycle 3) — pins `fetchDashboards`'s `condition` intent LOCALLY, next to
// the slice it belongs to, rather than only from a distant command-palette test
// (`useResourceIndexing.test.tsx`). That distant test is what actually found this behavior was
// wrong (it only ever allowed a dispatch from `"idle"`, never retried a `"failed"` fetch) — this
// suite is what should have caught it, and now does. Mirrors `pipelinesSlice.test.ts`'s own
// `fetchPipelines` condition tests (same invoke-the-thunk-directly-with-a-fake-dispatch/getState
// pattern).
describe("fetchDashboards condition (HEL-503)", () => {
  beforeEach(() => {
    fetchDashboardsRequestMock.mockReset();
  });

  function stateWithStatus(status: "idle" | "loading" | "succeeded" | "failed"): RootState {
    return { dashboards: { status } } as unknown as RootState;
  }

  // WHAT THIS PROVES: `fetchDashboards` dispatches (calls the service) when the slice's last
  // known status is `"failed"` — the fix for the defect found in cycle 3 (the condition used to
  // read `status === "idle"` only, which silently blocked every retry after one failure).
  // WHAT IT CANNOT PROVE: that anything downstream (a component effect) ever actually dispatches
  // this thunk on a real retry — that's `useResourceIndexing.test.tsx`'s job.
  it("dispatches when the previous fetch failed", async () => {
    fetchDashboardsRequestMock.mockResolvedValueOnce([]);
    const dispatch = jest.fn();
    const getState = jest.fn(() => stateWithStatus("failed"));
    const thunk = fetchDashboards();

    await thunk(dispatch, getState, undefined);

    expect(fetchDashboardsRequestMock).toHaveBeenCalledTimes(1);
  });

  it("dispatches when idle (the original, still-supported case)", async () => {
    fetchDashboardsRequestMock.mockResolvedValueOnce([]);
    const dispatch = jest.fn();
    const getState = jest.fn(() => stateWithStatus("idle"));
    const thunk = fetchDashboards();

    await thunk(dispatch, getState, undefined);

    expect(fetchDashboardsRequestMock).toHaveBeenCalledTimes(1);
  });

  // WHAT THIS PROVES: the condition still blocks a redundant dispatch while a fetch is already
  // in flight — the widening for `"failed"` did not accidentally drop this pre-existing guard.
  it("is blocked while a fetch is already in flight", async () => {
    const dispatch = jest.fn();
    const getState = jest.fn(() => stateWithStatus("loading"));
    const thunk = fetchDashboards();

    await thunk(dispatch, getState, undefined);

    expect(fetchDashboardsRequestMock).not.toHaveBeenCalled();
  });

  // WHAT THIS PROVES: the condition still blocks a redundant dispatch once the list has already
  // loaded successfully — this is the specific case the palette-open dedupe (task 2.2a) relies
  // on: re-opening the palette with everything `succeeded` must dispatch nothing.
  it("is blocked once the fetch has already succeeded", async () => {
    const dispatch = jest.fn();
    const getState = jest.fn(() => stateWithStatus("succeeded"));
    const thunk = fetchDashboards();

    await thunk(dispatch, getState, undefined);

    expect(fetchDashboardsRequestMock).not.toHaveBeenCalled();
  });
});
