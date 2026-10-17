import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  createDashboard as createDashboardRequest,
  deleteDashboard as deleteDashboardRequest,
  duplicateDashboard as duplicateDashboardRequest,
  exportDashboard as exportDashboardRequest,
  fetchDashboards as fetchDashboardsRequest,
  importDashboard as importDashboardRequest,
  renameDashboard as renameDashboardRequest,
  updateDashboardAppearance as updateDashboardAppearanceRequest,
  repairDashboardLayout as repairDashboardLayoutRequest,
  updateDashboardLayout as updateDashboardLayoutRequest,
} from "../services/dashboardService";
import { applyDashboardProposal as applyDashboardProposalRequest } from "../services/proposalService";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { areDashboardLayoutsEqual } from "./dashboardLayout";
import {
  dashboardFromConflict,
  isLayoutConflict,
  LAYOUT_CONFLICT_MESSAGE,
  rebaseLayoutPatch,
} from "./layoutConflict";
import type { RootState } from "../../../store/store";
import type {
  Dashboard,
  DashboardAppearance,
  DashboardLayout,
  DashboardSnapshot,
  DuplicateDashboardResponse,
} from "../types/dashboard";
import type { AppliedProposal, DashboardProposal } from "../types/proposal";

interface DashboardsState {
  items: Dashboard[];
  selectedDashboardId: string | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  hasPendingLayout: boolean;
  /** HEL-1584 D11a -- incremented by every successful `updateDashboardLayout`; the save-state check watches it (with
   *  `panelsSlice.panelSaveSeq`) so it appears for a real save and not for an undo back to the saved layout. Optional so a
   *  state literal built before it still type-checks; readers default to 0. */
  layoutSaveSeq?: number;
}

const initialState: DashboardsState = {
  items: [],
  selectedDashboardId: null,
  status: "idle",
  error: null,
  hasPendingLayout: false,
  layoutSaveSeq: 0,
};

// The backend guarantees dashboards are returned sorted by lastUpdated desc,
// so the first item is always the most recently updated.
function getMostRecentDashboardId(dashboards: Dashboard[]): string | null {
  return dashboards[0]?.id ?? null;
}

// HEL-1457: a response that is NOT adopted over a newer local layout keeps the local layout BY REFERENCE and
// the OLD `layoutVersion` with it, so the store's (layout, layoutVersion) pair stays "this layout, derived from
// that server version" and a later re-baseline can never pair a local layout with a version that already
// includes another writer's items.
function keepLocalLayout(response: Dashboard, local: Dashboard): Dashboard {
  return { ...response, layout: local.layout, layoutVersion: local.layoutVersion };
}

// HEL-1119: push-or-replace-by-id, shared by every reducer that adds a
// single dashboard to `items` outside of a full `fetchDashboards` replace
// (create/duplicate/import/applyProposal, plus the `dashboardUpserted`
// action). A bare `.push(...)` here can duplicate the entry when a
// concurrent `fetchDashboards` refetch resolves first with a payload that
// already contains this same dashboard (the create had already committed
// server-side before the list fetch ran) — the refetch's wholesale replace
// puts it in `items` once, and the create/duplicate/import thunk's own
// `.fulfilled` then pushed it again.
function upsertDashboardById(items: Dashboard[], dashboard: Dashboard): void {
  const index = items.findIndex((d) => d.id === dashboard.id);
  if (index === -1) {
    items.push(dashboard);
  } else {
    items[index] = dashboard;
  }
}

export const fetchDashboards = createAsyncThunk<
  Dashboard[],
  void,
  { state: RootState; rejectValue: string }
>(
  "dashboards/fetchDashboards",
  async (_, { rejectWithValue }) => {
    try {
      return await fetchDashboardsRequest();
    } catch {
      return rejectWithValue("Failed to load dashboards.");
    }
  },
  {
    // HEL-503 — widened from a bare `status === "idle"` check (which permanently blocked retry
    // after one failure) to mirror `pipelinesSlice.ts`'s `fetchPipelines` guard: skip only while
    // a fetch is already in flight or has already succeeded, so a caller retrying from `failed`
    // (e.g. `useResourceIndexing.ts`'s palette-open retry, design.md D2) is not silently no-op'd
    // by THIS thunk's own condition after its own status-based guard already decided to retry.
    // Found via `useResourceIndexing.test.tsx`'s dispatch-count assertion going one call short
    // on a real re-open after a real rejected dashboards fetch — not merely a hypothetical.
    condition: (_, { getState }) => {
      const { status } = getState().dashboards;
      return status !== "loading" && status !== "succeeded";
    },
  },
);

export const createDashboard = createAsyncThunk<
  Dashboard,
  { name: string },
  { rejectValue: string }
>("dashboards/createDashboard", async ({ name }, { rejectWithValue }) => {
  try {
    return await createDashboardRequest(name);
  } catch (err) {
    // HEL-548 D6 — was a fixed `catch { ... }` string, so every downstream
    // "specific message" claim (PanelList's error empty state, DashboardList's
    // banner) was a no-op: `unwrap()` throws this payload as a plain string,
    // and `extractErrorMessage` only reads an `AxiosError`, so extracting at
    // the component always fell back to the same generic sentence. Fixing it
    // at the source — where `err` genuinely IS the Axios error — means both
    // consumers now render what the server actually said.
    return rejectWithValue(extractErrorMessage(err, "Failed to create dashboard."));
  }
});

export const updateDashboardAppearance = createAsyncThunk<
  Dashboard,
  { dashboardId: string; appearance: DashboardAppearance },
  { rejectValue: string }
>(
  "dashboards/updateDashboardAppearance",
  async ({ dashboardId, appearance }, { rejectWithValue }) => {
    try {
      return await updateDashboardAppearanceRequest(dashboardId, appearance);
    } catch {
      return rejectWithValue("Failed to update dashboard appearance.");
    }
  },
);

export const deleteDashboard = createAsyncThunk<string, string, { rejectValue: string }>(
  "dashboards/deleteDashboard",
  async (dashboardId, { rejectWithValue }) => {
    try {
      await deleteDashboardRequest(dashboardId);
      return dashboardId;
    } catch {
      return rejectWithValue("Failed to delete dashboard.");
    }
  },
);

export const renameDashboard = createAsyncThunk<
  Dashboard,
  { dashboardId: string; name: string },
  { rejectValue: string }
>("dashboards/renameDashboard", async ({ dashboardId, name }, { rejectWithValue }) => {
  try {
    return await renameDashboardRequest(dashboardId, name);
  } catch {
    return rejectWithValue("Failed to rename dashboard.");
  }
});

// The slices the layout-save rejection copy reads (a narrow state so a store of just these two can dispatch it).
type LayoutSaveState = Pick<RootState, "dashboards" | "panels">;

const LAYOUT_SAVE_FAILED_MESSAGE = "Failed to save dashboard layout.";

function isBadRequest(err: unknown): boolean {
  return isAxiosError(err) && err.response?.status === 400;
}

// HEL-1527: true when the re-synced server layout holds a panel id this tab has not loaded. Only meaningful
// when the panel list is loaded for THIS dashboard and did not fail: `fetchPanels.pending` keeps
// `loadedDashboardId` through the refetch gap, `markDashboardPanelsStale` nulls it, and `fetchPanels.rejected`
// empties `items` but keeps `loadedDashboardId` (hence the `status` check).
function layoutNamesUnloadedPanel(state: LayoutSaveState, dashboardId: string): boolean {
  const { panels } = state;
  if (panels.loadedDashboardId !== dashboardId || panels.status === "failed") return false;
  const layout = state.dashboards.items.find((d) => d.id === dashboardId)?.layout;
  if (!layout) return false;
  const known = new Set(panels.items.map((p) => p.id));
  return [...layout.lg, ...layout.md, ...layout.sm, ...layout.xs].some(
    (item) => !known.has(item.panelId),
  );
}

/**
 * `layout` is the PATCH body (changed breakpoints only). `sentLayout` (HEL-1230) is the full authored
 * layout that PATCH represents; it never goes on the wire. The fulfilled reducer compares it with the
 * layout in the store at response time to tell whether the user edited while the request was in flight.
 *
 * HEL-1457: `baseLayout` / `baseVersion` are the server layout this save was derived from and its
 * `layoutVersion`; the version goes on the wire as `expectedLayoutVersion`. On a 409 the save is rebased onto
 * the dashboard the 409 carries (`rebaseLayoutPatch`) and retried once; the fulfilled action's
 * `meta.rebased` says that happened. An invalid rebase or a second 409 shows the fresh server layout and
 * rejects with a message that says the change was not saved.
 */
export const updateDashboardLayout = createAsyncThunk<
  Dashboard,
  {
    dashboardId: string;
    layout: Partial<DashboardLayout>;
    sentLayout: DashboardLayout;
    baseLayout?: DashboardLayout;
    baseVersion?: number;
  },
  { state: LayoutSaveState; rejectValue: string; fulfilledMeta: { rebased: boolean } }
>(
  "dashboards/updateDashboardLayout",
  async (
    { dashboardId, layout, baseLayout, baseVersion },
    { dispatch, getState, rejectWithValue, fulfillWithValue },
  ) => {
    const showServerLayout = async (known: Dashboard | null): Promise<boolean> => {
      // The dashboard is re-read so the store's authored layout converges on what the server holds. Upserted
      // by id, so a concurrent list fetch that already placed this dashboard is replaced, not duplicated.
      try {
        const fresh = known ?? (await fetchDashboardsRequest()).find((d) => d.id === dashboardId);
        if (!fresh) return false;
        dispatch(dashboardsSlice.actions.dashboardUpserted(fresh));
        return true;
      } catch {
        // The failed save is still reported by the caller; the next successful fetch re-syncs.
        return false;
      }
    };
    // HEL-1527: the toast never shows the server's developer-facing text (it quotes raw panel ids). A 400 whose
    // re-synced layout names a panel this tab has not loaded gets the "changed elsewhere" copy; anything else
    // gets the generic copy.
    const rejectionCopy = (err: unknown, resynced: boolean): string =>
      isBadRequest(err) && resynced && layoutNamesUnloadedPanel(getState(), dashboardId)
        ? LAYOUT_CONFLICT_MESSAGE
        : LAYOUT_SAVE_FAILED_MESSAGE;
    try {
      return fulfillWithValue(
        await updateDashboardLayoutRequest(dashboardId, layout, baseVersion),
        {
          rebased: false,
        },
      );
    } catch (err) {
      if (!isLayoutConflict(err)) {
        // HEL-1071: a rejected layout save is not silent: it re-syncs and toasts (copy per `rejectionCopy`).
        const resynced = await showServerLayout(null);
        return rejectWithValue(rejectionCopy(err, resynced));
      }
      let current = dashboardFromConflict(err);
      if (!current) {
        try {
          current = (await fetchDashboardsRequest()).find((d) => d.id === dashboardId) ?? null;
        } catch {
          current = null;
        }
      }
      const rebased =
        current && baseLayout ? rebaseLayoutPatch(layout, baseLayout, current.layout) : null;
      if (!current || !rebased) {
        await showServerLayout(current);
        return rejectWithValue(LAYOUT_CONFLICT_MESSAGE);
      }
      try {
        return fulfillWithValue(
          await updateDashboardLayoutRequest(dashboardId, rebased, current.layoutVersion),
          { rebased: true },
        );
      } catch (retryErr) {
        const conflict = isLayoutConflict(retryErr);
        const resynced = await showServerLayout(
          conflict ? (dashboardFromConflict(retryErr) ?? current) : null,
        );
        return rejectWithValue(
          conflict ? LAYOUT_CONFLICT_MESSAGE : rejectionCopy(retryErr, resynced),
        );
      }
    }
  },
);

/**
 * HEL-1233: the owner's one-time repair of stored-bad breakpoints. `layout` is the POST body (those
 * breakpoints only); `expectedLayout` is the authored layout it was computed from and never goes on
 * the wire. Store class 4 (server truth, see `useLayoutSave.ts`): never touches the undo history or
 * `hasPendingLayout`, and a failure is deliberately silent (no `state.error`, no toast) because the
 * display already shows the render-time repair. Callers log it.
 */
export const repairDashboardLayout = createAsyncThunk<
  Dashboard,
  { dashboardId: string; layout: Partial<DashboardLayout>; expectedLayout: DashboardLayout },
  { rejectValue: string }
>("dashboards/repairDashboardLayout", async ({ dashboardId, layout }, { rejectWithValue }) => {
  try {
    return await repairDashboardLayoutRequest(dashboardId, layout);
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to repair dashboard layout."));
  }
});

export const duplicateDashboard = createAsyncThunk<
  DuplicateDashboardResponse,
  string,
  { rejectValue: string }
>("dashboards/duplicateDashboard", async (dashboardId, { rejectWithValue }) => {
  try {
    return await duplicateDashboardRequest(dashboardId);
  } catch {
    return rejectWithValue("Failed to duplicate dashboard.");
  }
});

export const exportDashboard = createAsyncThunk<
  void,
  { dashboardId: string; dashboardName: string },
  { rejectValue: string }
>("dashboards/exportDashboard", async ({ dashboardId, dashboardName }, { rejectWithValue }) => {
  try {
    await exportDashboardRequest(dashboardId, dashboardName);
  } catch {
    return rejectWithValue("Failed to export dashboard.");
  }
});

export const importDashboard = createAsyncThunk<
  DuplicateDashboardResponse,
  DashboardSnapshot,
  { rejectValue: string }
>("dashboards/importDashboard", async (snapshot, { rejectWithValue }) => {
  try {
    return await importDashboardRequest(snapshot);
  } catch (err) {
    const serverMessage =
      isAxiosError(err) && typeof err.response?.data?.message === "string"
        ? err.response.data.message
        : null;
    return rejectWithValue(
      serverMessage
        ? `Failed to import dashboard: ${serverMessage}`
        : "Failed to import dashboard.",
    );
  }
});

export const applyProposal = createAsyncThunk<
  AppliedProposal,
  DashboardProposal,
  { rejectValue: string }
>("dashboards/applyProposal", async (proposal, { rejectWithValue }) => {
  try {
    return await applyDashboardProposalRequest(proposal);
  } catch (err) {
    const serverMessage =
      isAxiosError(err) && typeof err.response?.data?.message === "string"
        ? err.response.data.message
        : null;
    return rejectWithValue(serverMessage ?? "Failed to apply the proposal.");
  }
});

const dashboardsSlice = createSlice({
  name: "dashboards",
  initialState,
  reducers: {
    setSelectedDashboardId(state, action: PayloadAction<string | null>) {
      state.selectedDashboardId = action.payload;
    },
    setDashboardLayoutLocally(
      state,
      action: PayloadAction<{
        dashboardId: string;
        layout: DashboardLayout;
        /** HEL-1525: the version a own panel create/duplicate response reported. Adopted into the store only when
         *  it is exactly the store's version + 1 AND the layout grew in every breakpoint: then the server layout
         *  at that version is the layout this one was derived from plus exactly the placement, so the store's
         *  (layout, layoutVersion) pair stays valid (I1). Any other value changes the layout only. */
        placedLayoutVersion?: number;
      }>,
    ) {
      const { dashboardId, layout, placedLayoutVersion } = action.payload;
      const dashboard = state.items.find((d) => d.id === dashboardId);
      if (dashboard) {
        const appendedEverywhere = (["lg", "md", "sm", "xs"] as const).every(
          (bp) => layout[bp].length > dashboard.layout[bp].length,
        );
        if (
          placedLayoutVersion !== undefined &&
          dashboard.layoutVersion !== undefined &&
          placedLayoutVersion === dashboard.layoutVersion + 1 &&
          appendedEverywhere
        ) {
          dashboard.layoutVersion = placedLayoutVersion;
        }
        dashboard.layout = layout;
      }
    },
    setLayoutPending(state, action: PayloadAction<boolean>) {
      state.hasPendingLayout = action.payload;
    },
    /** Merge an externally-mutated `Dashboard` (a full response object, not a
     *  partial patch) into `items` — replaces an existing entry by id, or
     *  appends when new. Mirrors `renameDashboard.fulfilled`'s exact
     *  full-object-replace shape; used by `patchSetsSlice.applyPatchSet`
     *  (HEL-408) to keep this slice in sync with a dashboard edit applied
     *  through the patch-set path, which has no dedicated thunk of its own
     *  to hang an `extraReducers` case off of. */
    dashboardUpserted(state, action: PayloadAction<Dashboard>) {
      upsertDashboardById(state.items, action.payload);
    },
    /** Remove a dashboard deleted through a path with no dedicated thunk of
     *  its own (HEL-408's patch-set apply) — mirrors `deleteDashboard.
     *  fulfilled`'s exact filter + reselect body. */
    dashboardRemoved(state, action: PayloadAction<string>) {
      state.items = state.items.filter((d) => d.id !== action.payload);
      if (state.selectedDashboardId === action.payload) {
        state.selectedDashboardId = getMostRecentDashboardId(state.items);
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDashboards.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchDashboards.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;

        if (action.payload.length === 0) {
          state.selectedDashboardId = null;
          return;
        }

        const selectedExists = action.payload.some(
          (dashboard) => dashboard.id === state.selectedDashboardId,
        );
        state.selectedDashboardId = selectedExists
          ? state.selectedDashboardId
          : getMostRecentDashboardId(action.payload);
      })
      .addCase(fetchDashboards.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load dashboards.";
      })
      .addCase(updateDashboardAppearance.fulfilled, (state, action) => {
        state.items = state.items.map((dashboard) =>
          dashboard.id === action.payload.id ? action.payload : dashboard,
        );
      })
      .addCase(updateDashboardLayout.fulfilled, (state, action) => {
        // HEL-1230 (D5): a response never overwrites a NEWER local layout. If the store's layout still
        // equals what was sent, adopt the server's layout and clear pending (the PATCH covered it).
        // Otherwise keep the local layout object BY REFERENCE (so RGL and `useLayoutSave`'s effect do
        // not re-run on it), update every other field, and leave `hasPendingLayout` for `useLayoutSave`
        // to recompute against the server baseline: the newer edit stays pending for the next flush.
        const { sentLayout } = action.meta.arg;
        state.layoutSaveSeq = (state.layoutSaveSeq ?? 0) + 1;
        state.items = state.items.map((dashboard) => {
          if (dashboard.id !== action.payload.id) return dashboard;
          if (areDashboardLayoutsEqual(dashboard.layout, sentLayout)) {
            state.hasPendingLayout = false;
            return action.payload;
          }
          return keepLocalLayout(action.payload, dashboard);
        });
      })
      .addCase(repairDashboardLayout.fulfilled, (state, action) => {
        // Adopt the server's layout only over the layout the repair was computed from; a newer local
        // edit keeps its layout (by reference) and the server already holds the repair.
        const { expectedLayout } = action.meta.arg;
        state.items = state.items.map((dashboard) => {
          if (dashboard.id !== action.payload.id) return dashboard;
          if (areDashboardLayoutsEqual(dashboard.layout, expectedLayout)) return action.payload;
          return keepLocalLayout(action.payload, dashboard);
        });
      })
      .addCase(createDashboard.fulfilled, (state, action) => {
        upsertDashboardById(state.items, action.payload);
        state.selectedDashboardId = action.payload.id;
      })
      .addCase(renameDashboard.fulfilled, (state, action) => {
        state.items = state.items.map((dashboard) =>
          dashboard.id === action.payload.id ? action.payload : dashboard,
        );
      })
      // F-031 defense-in-depth: DashboardList.tsx now surfaces these three
      // failures inline via `.unwrap()`, but recording the rejection on
      // `state.error` too means a caller that dispatches these thunks
      // without unwrapping (present or future) still can't silently drop a
      // failure on the floor.
      .addCase(renameDashboard.rejected, (state, action) => {
        state.error = action.payload ?? "Failed to rename dashboard.";
      })
      .addCase(deleteDashboard.fulfilled, (state, action) => {
        state.items = state.items.filter((d) => d.id !== action.payload);
        if (state.selectedDashboardId === action.payload) {
          state.selectedDashboardId = getMostRecentDashboardId(state.items);
        }
      })
      .addCase(deleteDashboard.rejected, (state, action) => {
        state.error = action.payload ?? "Failed to delete dashboard.";
      })
      .addCase(duplicateDashboard.fulfilled, (state, action) => {
        upsertDashboardById(state.items, action.payload.dashboard);
        state.selectedDashboardId = action.payload.dashboard.id;
      })
      .addCase(duplicateDashboard.rejected, (state, action) => {
        state.error = action.payload ?? "Failed to duplicate dashboard.";
      })
      .addCase(importDashboard.fulfilled, (state, action) => {
        upsertDashboardById(state.items, action.payload.dashboard);
        state.selectedDashboardId = action.payload.dashboard.id;
      })
      .addCase(applyProposal.fulfilled, (state, action) => {
        upsertDashboardById(state.items, action.payload.dashboard);
        state.selectedDashboardId = action.payload.dashboard.id;
      });
  },
});

export const {
  setSelectedDashboardId,
  setDashboardLayoutLocally,
  setLayoutPending,
  dashboardUpserted,
  dashboardRemoved,
} = dashboardsSlice.actions;
export const dashboardsReducer = dashboardsSlice.reducer;
