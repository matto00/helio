import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import { duplicateDashboard, importDashboard } from "../dashboards/dashboardsSlice";
import { markDashboardPanelsStale } from "./panelActions";
import {
  createPanel,
  deletePanel,
  duplicatePanel,
  fetchPanelPage,
  fetchPanels,
  updatePanelAppearance,
  updatePanelBinding,
  updatePanelContent,
  updatePanelDivider,
  updatePanelImage,
  updatePanelsBatch,
  updatePanelTitle,
} from "./panelThunks";
import type {
  Panel,
  PanelBatchItem,
  PanelPaginationState,
  PanelUpdateFields,
  UpdatePanelsBatchRequest,
} from "../../types/models";

interface PanelsState {
  items: Panel[];
  loadedDashboardId: string | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  pendingPanelUpdates: Record<string, PanelUpdateFields>;
  lastSavedAt: number | null;
  /** Pagination state for table panels, keyed by panelId */
  paginationState: Record<string, PanelPaginationState>;
}

const initialState: PanelsState = {
  items: [],
  loadedDashboardId: null,
  status: "idle",
  error: null,
  pendingPanelUpdates: {},
  lastSavedAt: null,
  paginationState: {},
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
  },
  extraReducers: (builder) => {
    builder
      .addCase(markDashboardPanelsStale, (state, action) => {
        if (state.loadedDashboardId !== action.payload) return;
        state.loadedDashboardId = null;
        state.status = "idle";
      })
      .addCase(fetchPanels.pending, (state, action) => {
        state.status = "loading";
        state.error = null;
        state.loadedDashboardId = action.meta.arg;
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
      .addCase(updatePanelBinding.fulfilled, (state, action) => {
        state.items = state.items.map((panel) =>
          panel.id === action.payload.id ? action.payload : panel,
        );
      })
      .addCase(updatePanelContent.fulfilled, (state, action) => {
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
  updatePanelBinding,
  updatePanelContent,
  updatePanelDivider,
  updatePanelImage,
  updatePanelsBatch,
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
