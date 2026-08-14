import {
  applyPatchSet,
  invalidateAffectedState,
  patchSetsReducer,
  previewPatchSet,
} from "./patchSetsSlice";
import { dashboardRemoved, dashboardUpserted } from "../../dashboards/state/dashboardsSlice";
import { markDashboardPanelsStale } from "../../panels/state/panelsSlice";
import type { RootState } from "../../../store/store";
import type { PatchSet, PatchSetApplyResponse, PatchSetPreviewResponse } from "../types/patchSet";

const samplePatchSet: PatchSet = {
  edits: [{ target: { kind: "panel", id: "p-1" }, op: "update", patch: { title: "New title" } }],
};

const samplePreview: PatchSetPreviewResponse = {
  edits: [
    {
      index: 0,
      kind: "panel",
      op: "update",
      before: { id: "p-1", title: "Old title" },
      after: { id: "p-1", title: "New title" },
      impact: [],
    },
  ],
};

const sampleApplyResponse: PatchSetApplyResponse = {
  edits: [
    {
      index: 0,
      status: "applied",
      resultingState: { id: "p-1", dashboardId: "dash-1", title: "New title" },
    },
  ],
};

describe("patchSetsSlice", () => {
  it("starts idle with no preview and no error", () => {
    const state = patchSetsReducer(undefined, { type: "@@INIT" });
    expect(state.preview).toBeNull();
    expect(state.previewStatus).toBe("idle");
    expect(state.previewError).toBeNull();
    expect(state.applyStatus).toBe("idle");
    expect(state.applyError).toBeNull();
  });

  // ── previewPatchSet ───────────────────────────────────────────────────────

  it("sets previewStatus to loading and clears previewError on previewPatchSet.pending", () => {
    const withError = patchSetsReducer(
      undefined,
      previewPatchSet.rejected(new Error("boom"), "req-1", samplePatchSet, "Preview failed."),
    );

    const state = patchSetsReducer(withError, previewPatchSet.pending("req-2", samplePatchSet));
    expect(state.previewStatus).toBe("loading");
    expect(state.previewError).toBeNull();
  });

  it("stores the preview and marks succeeded on previewPatchSet.fulfilled", () => {
    const state = patchSetsReducer(
      undefined,
      previewPatchSet.fulfilled(samplePreview, "req-1", samplePatchSet),
    );
    expect(state.previewStatus).toBe("succeeded");
    expect(state.preview).toEqual(samplePreview);
  });

  it("marks failed and carries the server message on previewPatchSet.rejected", () => {
    const action = previewPatchSet.rejected(
      new Error("Rejected"),
      "req-1",
      samplePatchSet,
      "Edit target not found.",
    );
    const state = patchSetsReducer(undefined, action);
    expect(state.previewStatus).toBe("failed");
    expect(state.previewError).toBe("Edit target not found.");
    expect(state.preview).toBeNull();
  });

  // ── applyPatchSet ─────────────────────────────────────────────────────────

  it("marks applyStatus succeeded on applyPatchSet.fulfilled", () => {
    const state = patchSetsReducer(
      undefined,
      applyPatchSet.fulfilled(sampleApplyResponse, "req-1", samplePatchSet),
    );
    expect(state.applyStatus).toBe("succeeded");
    expect(state.applyError).toBeNull();
  });

  it("marks applyStatus failed and carries the server message on applyPatchSet.rejected", () => {
    const action = applyPatchSet.rejected(
      new Error("Rejected"),
      "req-1",
      samplePatchSet,
      "Cannot delete DataType: one or more panels are bound to it",
    );
    const state = patchSetsReducer(undefined, action);
    expect(state.applyStatus).toBe("failed");
    expect(state.applyError).toBe("Cannot delete DataType: one or more panels are bound to it");
  });

  // ── invalidateAffectedState (skeptic evaluation-1.md CR1 regression guard) ─
  //
  // `applyPatchSet` dispatches this after a successful apply so the SPA's
  // in-memory `panelsSlice`/`dashboardsSlice` caches reflect what was just
  // written, instead of silently showing stale data until a manual reload
  // (reproduced live in evaluation-1.md's Phase 3 UI review).

  describe("invalidateAffectedState", () => {
    // `ThunkDispatch` accepts both plain actions and thunk action creators;
    // a bare `jest.fn()` satisfies every call shape this function makes.
    function mockDispatch() {
      return jest.fn() as unknown as Parameters<typeof invalidateAffectedState>[2];
    }

    /** `panelsSlice.loadedDashboardId` is the ONLY signal this function
     *  consults to decide whether a touched dashboard is the one on screen
     *  (skeptic-final-1.md CR1) — a minimal partial-state fixture is enough,
     *  mirroring `dataTypesSlice.test.ts`'s own `as unknown as RootState`
     *  partial-state precedent. */
    function mockGetState(loadedDashboardId: string | null): () => RootState {
      return () => ({ panels: { loadedDashboardId } }) as unknown as RootState;
    }

    // `fetchPanels(dashboardId)` returns a fresh thunk closure on every call
    // (no stable identity/type to assert `toHaveBeenCalledWith` against, the
    // way a plain `createAction` result like `markDashboardPanelsStale` has)
    // — assert "a thunk was dispatched" by shape (a function argument)
    // instead of by reference.
    function thunkDispatchCount(dispatch: jest.Mock): number {
      return dispatch.mock.calls.filter(([arg]) => typeof arg === "function").length;
    }

    it("marks the touched panel's dashboard stale and re-fetches it, when it IS the currently displayed dashboard", () => {
      const dispatch = mockDispatch();
      invalidateAffectedState(
        samplePatchSet,
        sampleApplyResponse,
        dispatch,
        mockGetState("dash-1"),
      );

      expect(dispatch).toHaveBeenCalledWith(markDashboardPanelsStale("dash-1"));
      expect(thunkDispatchCount(dispatch as unknown as jest.Mock)).toBe(1);
    });

    // skeptic-final-1.md CR1 — the live-reproduced defect: an unconditional
    // `fetchPanels(dashboardId)` silently overwrote the visible panel grid
    // with a DIFFERENT, not-currently-displayed dashboard's panels, while
    // the chrome (sidebar/breadcrumb) kept showing the actually-selected
    // dashboard as active. `loadedDashboardId` set to a dashboard OTHER than
    // the one the patch set touched must leave `panelsSlice` completely
    // untouched.
    it("does NOT touch panelsSlice when the patched panel's dashboard is NOT the one currently displayed", () => {
      const dispatch = mockDispatch();
      invalidateAffectedState(
        samplePatchSet, // targets dashboardId "dash-1" (via resultingState)
        sampleApplyResponse,
        dispatch,
        mockGetState("dash-OTHER"), // user is viewing a DIFFERENT dashboard
      );

      expect(dispatch).not.toHaveBeenCalledWith(markDashboardPanelsStale("dash-1"));
      expect(thunkDispatchCount(dispatch as unknown as jest.Mock)).toBe(0);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("does NOT re-fetch when no dashboard is currently loaded at all (loadedDashboardId null)", () => {
      const dispatch = mockDispatch();
      invalidateAffectedState(samplePatchSet, sampleApplyResponse, dispatch, mockGetState(null));

      expect(dispatch).not.toHaveBeenCalled();
    });

    it("falls back to priorState.dashboardId for a panel-delete edit (no resultingState)", () => {
      const patchSet: PatchSet = {
        edits: [{ target: { kind: "panel", id: "p-1" }, op: "delete" }],
      };
      const response: PatchSetApplyResponse = {
        edits: [{ index: 0, status: "applied", priorState: { id: "p-1", dashboardId: "dash-2" } }],
      };
      const dispatch = mockDispatch();
      invalidateAffectedState(patchSet, response, dispatch, mockGetState("dash-2"));

      expect(dispatch).toHaveBeenCalledWith(markDashboardPanelsStale("dash-2"));
      expect(thunkDispatchCount(dispatch as unknown as jest.Mock)).toBe(1);
    });

    it("dispatches only ONE fetchPanels per dashboard even when multiple panel edits share it", () => {
      const patchSet: PatchSet = {
        edits: [
          { target: { kind: "panel", id: "p-1" }, op: "update", patch: { title: "A" } },
          { target: { kind: "panel", id: "p-2" }, op: "update", patch: { title: "B" } },
        ],
      };
      const response: PatchSetApplyResponse = {
        edits: [
          { index: 0, status: "applied", resultingState: { id: "p-1", dashboardId: "dash-1" } },
          { index: 1, status: "applied", resultingState: { id: "p-2", dashboardId: "dash-1" } },
        ],
      };
      const dispatch = mockDispatch();
      invalidateAffectedState(patchSet, response, dispatch, mockGetState("dash-1"));

      // A duplicate dispatch for the SAME dashboard (the bug a naive
      // per-edit loop, rather than a deduped `Set`, would reintroduce) would
      // show up as more than one dispatched thunk here.
      expect(thunkDispatchCount(dispatch as unknown as jest.Mock)).toBe(1);
      expect(dispatch).toHaveBeenCalledWith(markDashboardPanelsStale("dash-1"));
    });

    it("merges a dashboard-update edit's resultingState into dashboardsSlice via dashboardUpserted", () => {
      const patchSet: PatchSet = {
        edits: [
          {
            target: { kind: "dashboard", id: "dash-1" },
            op: "update",
            patch: { name: "Renamed" },
          },
        ],
      };
      const dashboard = {
        id: "dash-1",
        name: "Renamed",
        meta: {
          createdBy: "u1",
          createdAt: "2026-01-01T00:00:00Z",
          lastUpdated: "2026-01-01T00:00:00Z",
        },
        appearance: { background: "transparent", gridBackground: "transparent" },
        layout: { lg: [], md: [], sm: [], xs: [] },
      };
      const response: PatchSetApplyResponse = {
        edits: [{ index: 0, status: "applied", resultingState: dashboard }],
      };
      const dispatch = mockDispatch();
      // dashboardUpserted has no `loadedDashboardId` guard (it merges into
      // dashboardsSlice.items, unrelated to which dashboard's PANELS are
      // loaded) — `null` proves this path doesn't depend on it either.
      invalidateAffectedState(patchSet, response, dispatch, mockGetState(null));

      expect(dispatch).toHaveBeenCalledWith(dashboardUpserted(dashboard));
    });

    it("removes a deleted dashboard from dashboardsSlice via dashboardRemoved", () => {
      const patchSet: PatchSet = {
        edits: [{ target: { kind: "dashboard", id: "dash-1" }, op: "delete" }],
      };
      const response: PatchSetApplyResponse = {
        edits: [{ index: 0, status: "applied", priorState: { id: "dash-1", name: "Gone" } }],
      };
      const dispatch = mockDispatch();
      invalidateAffectedState(patchSet, response, dispatch, mockGetState(null));

      expect(dispatch).toHaveBeenCalledWith(dashboardRemoved("dash-1"));
    });

    it("does nothing for a kind this ticket's demo/fixture entry point never produces (e.g. dataSource)", () => {
      const patchSet: PatchSet = {
        edits: [
          {
            target: { kind: "dataSource", id: "ds-1" },
            op: "update",
            patch: { name: "Renamed" },
          },
        ],
      };
      const response: PatchSetApplyResponse = {
        edits: [{ index: 0, status: "applied", resultingState: { id: "ds-1", name: "Renamed" } }],
      };
      const dispatch = mockDispatch();
      invalidateAffectedState(patchSet, response, dispatch, mockGetState("ds-1"));

      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});
