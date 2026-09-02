import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import { duplicateDashboard, importDashboard } from "../../dashboards/state/dashboardsSlice";
import { markDashboardPanelsStale } from "./panelActions";
import {
  createPanel,
  deletePanel,
  duplicatePanel,
  fetchPanelPage,
  fetchPanels,
  updatePanelAppearance,
  updatePanelDivider,
  updatePanelImage,
  updatePanelMarkdownContent,
  updatePanelsBatch,
  updatePanelTextContent,
  updatePanelTitle,
} from "./panelThunks";
import type {
  Panel,
  PanelBatchItem,
  PanelPaginationState,
  PanelUpdateFields,
  UpdatePanelsBatchRequest,
} from "../types/panel";
interface PanelsState {
  items: Panel[];
  loadedDashboardId: string | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  pendingPanelUpdates: Record<string, PanelUpdateFields>;
  lastSavedAt: number | null;
  /** Pagination state for table panels, keyed by panelId */
  paginationState: Record<string, PanelPaginationState>;
  /** HEL-548 D1 — the dashboard id `markDashboardPanelsStale` most recently
   *  invalidated, or `null` once a `fetchPanels` for it has been dispatched.
   *  Purely additive: it does NOT widen the `status` union (D1 rejects that
   *  explicitly). Its only job is telling apart panel-list `PanelList`'s two
   *  `idle` states that otherwise look identical (`loadedDashboardId: null`,
   *  `items: []`, `status: "idle"`) — the pre-dispatch frame (fetch coming,
   *  render the skeleton) from the post-delete terminal state (no fetch
   *  coming, render the empty state) — see D2. */
  staleDashboardId: string | null;
  /** HEL-548 D5a — `PanelCreationModal`'s open flag, lifted out of
   *  `PanelList`'s local `useState` into Redux (mirroring
   *  `setAddSourceModalOpen`/`setCreatePipelineModalOpen`/
   *  `setCreateMetricModalOpen`) so `useCreatePanelAction()` can be a hook.
   *  Reset on `PanelList` unmount (see `PanelList.tsx`'s cleanup effect) —
   *  unlike its three siblings, a slice flag outlives the component that set
   *  it, so leaving this unreset would let a `Cmd/Ctrl+K` navigate-away
   *  re-open the modal unbidden on the next visit to `/`. */
  panelCreationModalOpen: boolean;
}

const initialState: PanelsState = {
  items: [],
  loadedDashboardId: null,
  status: "idle",
  error: null,
  pendingPanelUpdates: {},
  lastSavedAt: null,
  paginationState: {},
  staleDashboardId: null,
  panelCreationModalOpen: false,
};

const panelsSlice = createSlice({
  name: "panels",
  initialState,
  reducers: {
    accumulatePanelUpdate(
      state,
      action: PayloadAction<{ panelId: string; fields: PanelUpdateFields }>,
    ) {
      const { panelId, fields } = action.payload;
      state.pendingPanelUpdates[panelId] = {
        ...state.pendingPanelUpdates[panelId],
        ...fields,
      };
      // Title / appearance / type are common to every subtype; the spread
      // narrows correctly at runtime even though TS sees the union shape.
      state.items = state.items.map((panel) =>
        panel.id === panelId ? ({ ...panel, ...fields } as Panel) : panel,
      );
    },
    clearPendingPanelUpdates(state) {
      state.pendingPanelUpdates = {};
    },
    resetPanelSaveState(state) {
      state.pendingPanelUpdates = {};
      state.lastSavedAt = null;
    },
    // Task 3.5 — resetPanelPagination clears per-panel pagination state
    resetPanelPagination(state, action: PayloadAction<string>) {
      delete state.paginationState[action.payload];
    },
    // HEL-548 D5a — mirrors setAddSourceModalOpen/setCreatePipelineModalOpen/
    // setCreateMetricModalOpen. Set from PanelList's two triggers (header
    // "Add panel" and the "No panels yet" empty-state CTA, via
    // useCreatePanelAction) and reset from PanelList's unmount cleanup.
    setPanelCreationModalOpen(state, action: PayloadAction<boolean>) {
      state.panelCreationModalOpen = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(markDashboardPanelsStale, (state, action) => {
        if (state.loadedDashboardId !== action.payload) return;
        state.loadedDashboardId = null;
        state.status = "idle";
        // HEL-548 D1 — record which dashboard this invalidation left
        // "idle", so PanelList can tell this terminal state apart from the
        // pre-dispatch frame (both share loadedDashboardId: null / items: []
        // / status: "idle" otherwise). Cleared by fetchPanels.pending below.
        state.staleDashboardId = action.payload;
      })
      .addCase(fetchPanels.pending, (state, action) => {
        state.status = "loading";
        state.error = null;
        state.loadedDashboardId = action.meta.arg;
        // HEL-548 D1 — a fetch has now been dispatched, so the invalidation
        // record (if any) is stale itself; clearing it here is what lets D2's
        // pre-dispatch-frame condition distinguish "not dispatched yet" from
        // "dispatched, in flight".
        state.staleDashboardId = null;
      })
      .addCase(fetchPanels.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(fetchPanels.rejected, (state, action) => {
        state.items = [];
        state.status = "failed";
        state.error = action.payload ?? "Failed to load panels.";
      })
      .addCase(updatePanelAppearance.fulfilled, (state, action) => {
        state.items = state.items.map((panel) =>
          panel.id === action.payload.id ? action.payload : panel,
        );
      })
      .addCase(updatePanelTitle.fulfilled, (state, action) => {
        state.items = state.items.map((panel) =>
          panel.id === action.payload.id ? action.payload : panel,
        );
      })
      .addCase(createPanel.rejected, (state, action) => {
        state.error = action.payload ?? "Failed to create panel.";
      })
      .addCase(deletePanel.fulfilled, (state, action) => {
        state.items = state.items.filter((p) => p.id !== action.payload);
      })
      .addCase(duplicatePanel.rejected, (state, action) => {
        state.error = action.payload ?? "Failed to duplicate panel.";
      })
      .addCase(updatePanelTextContent.fulfilled, (state, action) => {
        state.items = state.items.map((panel) =>
          panel.id === action.payload.id ? action.payload : panel,
        );
      })
      .addCase(updatePanelMarkdownContent.fulfilled, (state, action) => {
        state.items = state.items.map((panel) =>
          panel.id === action.payload.id ? action.payload : panel,
        );
      })
      .addCase(updatePanelImage.fulfilled, (state, action) => {
        state.items = state.items.map((panel) =>
          panel.id === action.payload.id ? action.payload : panel,
        );
      })
      .addCase(updatePanelDivider.fulfilled, (state, action) => {
        state.items = state.items.map((panel) =>
          panel.id === action.payload.id ? action.payload : panel,
        );
      })
      .addCase(updatePanelsBatch.fulfilled, (state, action) => {
        const updatedById = new Map(action.payload.panels.map((p) => [p.id, p]));
        state.items = state.items.map((panel) => updatedById.get(panel.id) ?? panel);
        state.lastSavedAt = Date.now();
      })
      .addCase(duplicateDashboard.fulfilled, (state, action) => {
        state.items = action.payload.panels;
        state.loadedDashboardId = action.payload.dashboard.id;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(importDashboard.fulfilled, (state, action) => {
        state.items = action.payload.panels;
        state.loadedDashboardId = action.payload.dashboard.id;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(fetchPanelPage.pending, (state, action) => {
        const { panelId } = action.meta.arg;
        const existing = state.paginationState[panelId];
        state.paginationState[panelId] = {
          currentPage: existing?.currentPage ?? 0,
          hasMore: existing?.hasMore ?? true,
          isLoadingMore: true,
          rows: existing?.rows ?? [],
        };
      })
      .addCase(fetchPanelPage.fulfilled, (state, action) => {
        const { panelId, page, rows, hasMore } = action.payload;
        const existing = state.paginationState[panelId];
        // Append rows on page > 0 (load more), replace on page 0 (initial/reset)
        const updatedRows = page > 0 && existing ? [...existing.rows, ...rows] : rows;
        state.paginationState[panelId] = {
          currentPage: page,
          hasMore,
          isLoadingMore: false,
          rows: updatedRows,
        };
      })
      .addCase(fetchPanelPage.rejected, (state, action) => {
        const { panelId } = action.meta.arg;
        const existing = state.paginationState[panelId];
        if (existing) {
          state.paginationState[panelId] = {
            ...existing,
            isLoadingMore: false,
          };
        }
      });
  },
});

export const {
  accumulatePanelUpdate,
  clearPendingPanelUpdates,
  resetPanelSaveState,
  resetPanelPagination,
  setPanelCreationModalOpen,
} = panelsSlice.actions;
export const panelsReducer = panelsSlice.reducer;

// Re-export the thunks and the cache-invalidation action so existing
// consumers can keep importing from `panelsSlice` (the public surface stays
// stable; the implementation now lives across `panelThunks.ts` and
// `panelActions.ts`).
export {
  createPanel,
  deletePanel,
  duplicatePanel,
  fetchPanelPage,
  fetchPanels,
  updatePanelAppearance,
  updatePanelDivider,
  updatePanelImage,
  updatePanelMarkdownContent,
  updatePanelsBatch,
  updatePanelTextContent,
  updatePanelTitle,
} from "./panelThunks";
export { markDashboardPanelsStale } from "./panelActions";

export function buildBatchRequest(
  pending: Record<string, PanelUpdateFields>,
): UpdatePanelsBatchRequest {
  const allFields = new Set<string>();
  const panels: PanelBatchItem[] = [];

  for (const [id, fields] of Object.entries(pending)) {
    Object.keys(fields).forEach((key) => allFields.add(key));
    // The accumulator only collects title / appearance / type; config-affecting
    // edits flow through their own typed thunks.
    const item: PanelBatchItem = { id };
    if (fields.title !== undefined) item.title = fields.title;
    if (fields.appearance !== undefined) item.appearance = fields.appearance;
    if (fields.type !== undefined) item.type = fields.type;
    panels.push(item);
  }

  return {
    fields: Array.from(allFields),
    panels,
  };
}
