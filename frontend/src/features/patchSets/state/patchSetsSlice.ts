import {
  createAsyncThunk,
  createSlice,
  type ThunkDispatch,
  type UnknownAction,
} from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import { dashboardRemoved, dashboardUpserted } from "../../dashboards/state/dashboardsSlice";
import type { Dashboard } from "../../dashboards/types/dashboard";
import { fetchPanels, markDashboardPanelsStale } from "../../panels/state/panelsSlice";
import type { RootState } from "../../../store/store";
import {
  applyPatchSet as applyPatchSetRequest,
  previewPatchSet as previewPatchSetRequest,
  undoPatchSet as undoPatchSetRequest,
} from "../services/patchSetService";
import type {
  PatchSet,
  PatchSetApplyResponse,
  PatchSetPreviewResponse,
  PatchSetUndoResponse,
} from "../types/patchSet";

interface PatchSetsState {
  preview: PatchSetPreviewResponse | null;
  previewStatus: "idle" | "loading" | "succeeded" | "failed";
  previewError: string | null;
  applyStatus: "idle" | "loading" | "succeeded" | "failed";
  applyError: string | null;
  undoStatus: "idle" | "loading" | "succeeded" | "failed";
  undoError: string | null;
}

const initialState: PatchSetsState = {
  preview: null,
  previewStatus: "idle",
  previewError: null,
  applyStatus: "idle",
  applyError: null,
  undoStatus: "idle",
  undoError: null,
};

/** Compute a patch set's diff/impact preview (HEL-408) without writing
 *  anything. Mirrors `dashboardsSlice.applyProposal`'s exact
 *  `createAsyncThunk`/`rejectWithValue`/Axios-error-unwrap shape. */
export const previewPatchSet = createAsyncThunk<
  PatchSetPreviewResponse,
  PatchSet,
  { rejectValue: string }
>("patchSets/previewPatchSet", async (patchSet, { rejectWithValue }) => {
  try {
    return await previewPatchSetRequest(patchSet);
  } catch (err) {
    const serverMessage =
      isAxiosError(err) && typeof err.response?.data?.message === "string"
        ? err.response.data.message
        : null;
    return rejectWithValue(serverMessage ?? "Failed to preview the patch set.");
  }
});

// ── Post-apply/undo cache invalidation (skeptic evaluation-1.md CR1, HEL-413 evaluation-1.md CR2) ─
//
// Unlike `dashboardsSlice.applyProposal` (which only ever CREATES a brand-new
// dashboard and selects it, so the id was never cached and a later fetch
// always triggers a real request), patch-set apply/undo both MUTATE existing,
// potentially-already-cached resources — so the app's in-memory Redux
// `panelsSlice`/`dashboardsSlice` caches must be explicitly told what
// changed, or the currently-viewed dashboard silently keeps showing stale
// data after a successful Accept OR a successful Undo (reproduced live in
// evaluation-1.md for apply, and again in HEL-413 evaluation-1.md CR2 for
// undo — same bug class, independently reintroduced by the new, separate
// `undoPatchSet` thunk not carrying the fix forward). Scope: `panel`/
// `dashboard` edits only (the two kinds this ticket's own demo/fixture entry
// point can produce today, HEL-408 design.md D6); `dataType`/`dataSource`/
// `pipeline` edits have their own slices with the identical staleness
// exposure once a real patch-set producer can target them (no such caller
// exists yet — this ticket's own Non-Goal), and are left as a follow-on of
// the same shape.

/** The subset of `EditOutcome` (apply) / `EditUndoOutcome` (undo) this
 *  invalidation logic actually reads — `EditUndoOutcome` carries no
 *  `priorState` (undo only ever restores TO a known state, never captures a
 *  new one), so it's optional here; both wire types satisfy this
 *  structurally, with no cast needed at either call site. */
interface OutcomeLike {
  index: number;
  newId?: string | null;
  resultingState?: Record<string, unknown> | null;
  priorState?: Record<string, unknown> | null;
}

function readStringField(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Loose structural check that a `resultingState`/`priorState` blob is
 *  shaped like a full `DashboardResponse` (id/name/meta/appearance/layout —
 *  the exact fields `DashboardResponse.fromDomain` always writes) before
 *  trusting it as a `Dashboard` — avoids a blind, unchecked cast. */
function asDashboard(record: Record<string, unknown> | null | undefined): Dashboard | null {
  if (!record) return null;
  const { id, name, meta, appearance, layout } = record;
  if (
    typeof id === "string" &&
    typeof name === "string" &&
    meta != null &&
    appearance != null &&
    layout != null
  ) {
    return record as unknown as Dashboard;
  }
  return null;
}

/** Invalidate/merge every `panel`/`dashboard` resource a successfully-applied
 *  patch set touched (design.md's reused `before`/`after` response shapes
 *  make the touched dashboard/panel ids directly readable off the apply
 *  response — no extra fetch needed to discover them). `resultingState` is
 *  preferred (the edit's real post-apply state); `priorState` is the
 *  fallback for a plain `delete` (no `resultingState`) and for an
 *  `unrecoverable` delete-rollback (HEL-406 `EditOutcome` doc). For a
 *  `create` edit's UNDO specifically (`resultingState`/`priorState` both
 *  absent — the resource was deleted, and undo has no `priorState` at all),
 *  the fallback is kind-specific: a panel falls back to the ORIGINAL edit's
 *  own create-patch `dashboardId`; a dashboard — which has no id anywhere on
 *  its own create patch, since it didn't exist yet when that patch was
 *  built — falls back to `outcome.newId` instead, populated by
 *  `PatchSetUndoService.restoreCreateUndo` with the just-deleted resource's
 *  OWN id specifically for this purpose (skeptic-final-2.md CR1).
 *
 *  **`getState` guard (skeptic-final-1.md CR1 — round-1 REFUTE finding).**
 *  A touched panel's `dashboardId` is NOT necessarily the dashboard the user
 *  is currently viewing — `panelsSlice` models a single "currently loaded"
 *  dashboard (`items` + `loadedDashboardId`), and an unconditional
 *  `fetchPanels(dashboardId)` would silently overwrite the visible panel
 *  grid with a DIFFERENT, not-currently-displayed dashboard's panels
 *  whenever the patch set's target isn't the one on screen (reproduced live
 *  by the skeptic: chrome still said "Skeptic Isolation Test," but the grid
 *  silently switched to "Revenue by Region"'s panel). The
 *  `createPanel`/`duplicatePanel` precedent this logic otherwise mirrors
 *  doesn't carry this risk — those are only ever invoked by UI affordances
 *  already scoped to the displayed dashboard, so their `dashboardId`
 *  argument always equals `loadedDashboardId` by construction; patch-set
 *  apply has no such constraint (the demo/fixture entry point always
 *  targets `dashboards[0]`, independent of what's currently selected). Only
 *  refresh when `dashboardId` genuinely IS the one on screen; a touched-but-
 *  not-displayed dashboard's cache is left alone entirely (nothing to
 *  correct — `panelsSlice` holds no state for it).
 *
 *  `edits` is deliberately `OutcomeLike[]`, not the full `PatchSetApplyResponse` — this same
 *  function is called from BOTH `applyPatchSet` (`response.edits: EditOutcome[]`) and `undoPatchSet`
 *  (`response.edits: EditUndoOutcome[]`, HEL-413), correlated back to the SAME original `patchSet`
 *  by `outcome.index` either way (an undo's `EditUndoOutcome.index` refers to the same edit index in
 *  the patch set that was originally applied). */
export function invalidateAffectedState(
  patchSet: PatchSet,
  edits: OutcomeLike[],
  dispatch: ThunkDispatch<RootState, unknown, UnknownAction>,
  getState: () => RootState,
): void {
  const touchedPanelDashboardIds = new Set<string>();

  edits.forEach((outcome) => {
    const edit = patchSet.edits[outcome.index];
    if (!edit) return;

    if (edit.target.kind === "panel") {
      const dashboardId =
        readStringField(outcome.resultingState, "dashboardId") ??
        readStringField(outcome.priorState, "dashboardId") ??
        // skeptic-final-1.md CR1: a `create` edit's UNDO (`PatchSetUndoService.
        // restoreCreateUndo`) deletes the created resource and returns NEITHER
        // `resultingState` NOR `priorState` (nothing survives to describe — `EditUndoOutcome`
        // carries no `priorState` at all by design). Fall back to the ORIGINAL edit's own
        // create payload, which already carries `dashboardId` for a panel create
        // (`CreatePanelRequest`) — the one place that id still exists once the panel is gone.
        readStringField(edit.patch, "dashboardId");
      if (dashboardId) touchedPanelDashboardIds.add(dashboardId);
    }

    if (edit.target.kind === "dashboard") {
      const dashboard = asDashboard(outcome.resultingState);
      if (dashboard) {
        dispatch(dashboardUpserted(dashboard));
      } else if (edit.op === "delete") {
        const deletedId = readStringField(outcome.priorState, "id") ?? edit.target.id;
        if (deletedId) dispatch(dashboardRemoved(deletedId));
      } else if (edit.op === "create" && outcome.newId) {
        // skeptic-final-2.md CR1: undoing a `dashboard` `create` edit deletes the created
        // dashboard and returns NEITHER `resultingState` NOR `priorState` -- and unlike a panel
        // create, a dashboard's ORIGINAL create patch never carries an id (it didn't exist yet
        // when the patch was built), so there's no `edit.patch` fallback available either.
        // `outcome.newId` (populated by `PatchSetUndoService.restoreCreateUndo` with the
        // just-deleted dashboard's OWN id) is the ONLY surviving way to know which dashboard to
        // remove from the cache.
        dispatch(dashboardRemoved(outcome.newId));
      }
    }
  });

  touchedPanelDashboardIds.forEach((dashboardId) => {
    // Read BEFORE dispatching `markDashboardPanelsStale` — that action
    // clears `loadedDashboardId` to `null` on a match, which would make this
    // check trivially false if read afterward.
    if (getState().panels.loadedDashboardId !== dashboardId) return;
    // Mirrors `panelThunks.ts`'s `createPanel`/`duplicatePanel`: mark stale
    // THEN immediately re-fetch — marking stale alone would not otherwise
    // trigger a refetch here, since `App.tsx`'s own `fetchPanels` effect
    // only re-runs when `selectedDashboardId` itself changes, which
    // navigating from the review page back to an already-selected dashboard
    // never does.
    dispatch(markDashboardPanelsStale(dashboardId));
    dispatch(fetchPanels(dashboardId));
  });
}

/** Apply an accepted patch set (HEL-406's existing endpoint). Mirrors
 *  `dashboardsSlice.applyProposal`'s exact shape, plus the cache
 *  invalidation above (`applyProposal` never needed this — see the comment
 *  on `invalidateAffectedState`). */
export const applyPatchSet = createAsyncThunk<
  PatchSetApplyResponse,
  PatchSet,
  { state: RootState; rejectValue: string }
>("patchSets/applyPatchSet", async (patchSet, { dispatch, getState, rejectWithValue }) => {
  try {
    const response = await applyPatchSetRequest(patchSet);
    invalidateAffectedState(patchSet, response.edits, dispatch, getState);
    return response;
  } catch (err) {
    const serverMessage =
      isAxiosError(err) && typeof err.response?.data?.message === "string"
        ? err.response.data.message
        : null;
    return rejectWithValue(serverMessage ?? "Failed to apply the patch set.");
  }
});

/** Undo a previously-applied, journaled patch set (HEL-413). Mirrors
 *  `applyPatchSet`'s exact `createAsyncThunk`/`rejectWithValue`/Axios-error-
 *  unwrap shape, INCLUDING its cache invalidation (evaluation-1.md CR2 —
 *  round 1 shipped this thunk without it, live-reproduced as the identical
 *  stale-panel-grid bug `applyPatchSet` already had to fix once). `patchSet`
 *  is the SAME original patch set the application being undone was built
 *  from (the caller already has it in scope — `PatchSetReviewPage`'s
 *  `handleAccept` closure) — needed to resolve each `EditUndoOutcome.index`
 *  back to its `target.kind`, exactly like `applyPatchSet` does with its own
 *  argument. */
export const undoPatchSet = createAsyncThunk<
  PatchSetUndoResponse,
  { applicationId: string; patchSet: PatchSet },
  { state: RootState; rejectValue: string }
>(
  "patchSets/undoPatchSet",
  async ({ applicationId, patchSet }, { dispatch, getState, rejectWithValue }) => {
    try {
      const response = await undoPatchSetRequest(applicationId);
      invalidateAffectedState(patchSet, response.edits, dispatch, getState);
      return response;
    } catch (err) {
      const serverMessage =
        isAxiosError(err) && typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : null;
      return rejectWithValue(serverMessage ?? "Failed to undo the patch set.");
    }
  },
);

const patchSetsSlice = createSlice({
  name: "patchSets",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(previewPatchSet.pending, (state) => {
        state.previewStatus = "loading";
        state.previewError = null;
      })
      .addCase(previewPatchSet.fulfilled, (state, action) => {
        state.previewStatus = "succeeded";
        state.preview = action.payload;
      })
      .addCase(previewPatchSet.rejected, (state, action) => {
        state.previewStatus = "failed";
        state.previewError = action.payload ?? "Failed to preview the patch set.";
      })
      .addCase(applyPatchSet.pending, (state) => {
        state.applyStatus = "loading";
        state.applyError = null;
      })
      .addCase(applyPatchSet.fulfilled, (state) => {
        state.applyStatus = "succeeded";
      })
      .addCase(applyPatchSet.rejected, (state, action) => {
        state.applyStatus = "failed";
        state.applyError = action.payload ?? "Failed to apply the patch set.";
      })
      .addCase(undoPatchSet.pending, (state) => {
        state.undoStatus = "loading";
        state.undoError = null;
      })
      .addCase(undoPatchSet.fulfilled, (state) => {
        state.undoStatus = "succeeded";
      })
      .addCase(undoPatchSet.rejected, (state, action) => {
        state.undoStatus = "failed";
        state.undoError = action.payload ?? "Failed to undo the patch set.";
      });
  },
});

export const patchSetsReducer = patchSetsSlice.reducer;
