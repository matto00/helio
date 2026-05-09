import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";

import {
  createPanel as createPanelRequest,
  deletePanel as deletePanelRequest,
  duplicatePanel as duplicatePanelRequest,
  fetchPanelExecutePage,
  fetchPanels as fetchPanelsRequest,
  updatePanelAppearance as updatePanelAppearanceRequest,
  updatePanelBinding as updatePanelBindingRequest,
  updatePanelContent as updatePanelContentRequest,
  updatePanelDivider as updatePanelDividerRequest,
  updatePanelImage as updatePanelImageRequest,
  updatePanelsBatch as updatePanelsBatchRequest,
  updatePanelTitle as updatePanelTitleRequest,
} from "../../services/panelService";
import { duplicateDashboard, importDashboard } from "../dashboards/dashboardsSlice";
import type { RootState } from "../../store/store";
import type {
  DividerOrientation,
  ImageFit,
  Panel,
  PanelAppearance,
  PanelBatchItem,
  PanelPaginationState,
  PanelType,
  PanelUpdateFields,
  TypeConfig,
  UpdatePanelsBatchRequest,
  UpdatePanelsBatchResponse,
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

export const fetchPanels = createAsyncThunk<
  Panel[],
  string,
  { state: RootState; rejectValue: string }
>(
  "panels/fetchPanels",
  async (dashboardId, { rejectWithValue }) => {
    try {
      return await fetchPanelsRequest(dashboardId);
    } catch {
      return rejectWithValue("Failed to load panels.");
    }
  },
  {
    condition: (dashboardId, { getState }) => {
      const { panels } = getState();
      if (panels.status === "loading" && panels.loadedDashboardId === dashboardId) {
        return false;
      }

      if (panels.status === "succeeded" && panels.loadedDashboardId === dashboardId) {
        return false;
      }

      return true;
    },
  },
);

export const createPanel = createAsyncThunk<
  Panel,
  {
    dashboardId: string;
    title: string;
    type?: PanelType;
    typeConfig?: TypeConfig;
    dataTypeId?: string;
  },
  { state: RootState; rejectValue: string }
>(
  "panels/createPanel",
  async ({ dashboardId, title, type, typeConfig, dataTypeId }, { dispatch, rejectWithValue }) => {
    try {
      const createdPanel = await createPanelRequest(
        dashboardId,
        title,
        type,
        typeConfig,
        dataTypeId,
      );
      dispatch(markDashboardPanelsStale(dashboardId));
      await dispatch(fetchPanels(dashboardId));
      return createdPanel;
    } catch {
      return rejectWithValue("Failed to create panel.");
    }
  },
);

export const updatePanelTitle = createAsyncThunk<
  Panel,
  { panelId: string; title: string },
  { rejectValue: string }
>("panels/updatePanelTitle", async ({ panelId, title }, { rejectWithValue }) => {
  try {
    return await updatePanelTitleRequest(panelId, title);
  } catch {
    return rejectWithValue("Failed to update panel title.");
  }
});

export const deletePanel = createAsyncThunk<
  string,
  { panelId: string; dashboardId: string },
  { rejectValue: string }
>("panels/deletePanel", async ({ panelId, dashboardId }, { dispatch, rejectWithValue }) => {
  try {
    await deletePanelRequest(panelId);
    dispatch(markDashboardPanelsStale(dashboardId));
    return panelId;
  } catch {
    return rejectWithValue("Failed to delete panel.");
  }
});

export const duplicatePanel = createAsyncThunk<
  Panel,
  { panelId: string; dashboardId: string },
  { state: RootState; rejectValue: string }
>("panels/duplicatePanel", async ({ panelId, dashboardId }, { dispatch, rejectWithValue }) => {
  try {
    const created = await duplicatePanelRequest(panelId);
    dispatch(markDashboardPanelsStale(dashboardId));
    await dispatch(fetchPanels(dashboardId));
    return created;
  } catch {
    return rejectWithValue("Failed to duplicate panel.");
  }
});

export const updatePanelAppearance = createAsyncThunk<
  Panel,
  { panelId: string; appearance: PanelAppearance },
  { rejectValue: string }
>("panels/updatePanelAppearance", async ({ panelId, appearance }, { rejectWithValue }) => {
  try {
    return await updatePanelAppearanceRequest(panelId, appearance);
  } catch {
    return rejectWithValue("Failed to update panel appearance.");
  }
});

export const updatePanelBinding = createAsyncThunk<
  Panel,
  {
    panelId: string;
    typeId: string | null;
    fieldMapping: Record<string, string> | null;
    refreshInterval: number | null;
  },
  { rejectValue: string }
>(
  "panels/updatePanelBinding",
  async ({ panelId, typeId, fieldMapping, refreshInterval }, { rejectWithValue }) => {
    try {
      return await updatePanelBindingRequest(panelId, typeId, fieldMapping, refreshInterval);
    } catch {
      return rejectWithValue("Failed to update panel binding.");
    }
  },
);

export const updatePanelContent = createAsyncThunk<
  Panel,
  { panelId: string; content: string },
  { rejectValue: string }
>("panels/updatePanelContent", async ({ panelId, content }, { rejectWithValue }) => {
  try {
    return await updatePanelContentRequest(panelId, content);
  } catch {
    return rejectWithValue("Failed to update panel content.");
  }
});

export const updatePanelImage = createAsyncThunk<
  Panel,
  { panelId: string; imageUrl: string; imageFit: ImageFit },
  { rejectValue: string }
>("panels/updatePanelImage", async ({ panelId, imageUrl, imageFit }, { rejectWithValue }) => {
  try {
    return await updatePanelImageRequest(panelId, imageUrl, imageFit);
  } catch {
    return rejectWithValue("Failed to update panel image.");
  }
});

export const updatePanelDivider = createAsyncThunk<
  Panel,
  {
    panelId: string;
    dividerOrientation: DividerOrientation;
    dividerWeight: number;
    dividerColor: string | null;
  },
  { rejectValue: string }
>(
  "panels/updatePanelDivider",
  async ({ panelId, dividerOrientation, dividerWeight, dividerColor }, { rejectWithValue }) => {
    try {
      return await updatePanelDividerRequest(
        panelId,
        dividerOrientation,
        dividerWeight,
        dividerColor,
      );
    } catch {
      return rejectWithValue("Failed to update divider settings.");
    }
  },
);

export const updatePanelsBatch = createAsyncThunk<
  UpdatePanelsBatchResponse,
  UpdatePanelsBatchRequest,
  { rejectValue: string }
>("panels/updatePanelsBatch", async (request, { rejectWithValue }) => {
  try {
    return await updatePanelsBatchRequest(request);
  } catch {
    return rejectWithValue("Failed to update panels.");
  }
});

// Task 3.4 — fetchPanelPage async thunk
export const fetchPanelPage = createAsyncThunk<
  { panelId: string; page: number; rows: Record<string, unknown>[]; hasMore: boolean },
  { panelId: string; page: number; pageSize: number },
  { rejectValue: string }
>("panels/fetchPanelPage", async ({ panelId, page, pageSize }, { rejectWithValue }) => {
  try {
    const result = await fetchPanelExecutePage(panelId, page, pageSize);
    return { panelId, page: result.page, rows: result.rows, hasMore: result.hasMore };
  } catch {
    return rejectWithValue("Failed to load panel data.");
  }
});

const panelsSlice = createSlice({
  name: "panels",
  initialState,
  reducers: {
    markDashboardPanelsStale(state, action) {
      if (state.loadedDashboardId !== action.payload) {
        return;
      }

      state.loadedDashboardId = null;
      state.status = "idle";
    },
    accumulatePanelUpdate(
      state,
      action: PayloadAction<{ panelId: string; fields: PanelUpdateFields }>,
    ) {
      const { panelId, fields } = action.payload;
      state.pendingPanelUpdates[panelId] = {
        ...state.pendingPanelUpdates[panelId],
        ...fields,
      };
      state.items = state.items.map((panel) =>
        panel.id === panelId ? { ...panel, ...fields } : panel,
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
      // Task 3.4 — fetchPanelPage reducers
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
  markDashboardPanelsStale,
  accumulatePanelUpdate,
  clearPendingPanelUpdates,
  resetPanelSaveState,
  resetPanelPagination,
} = panelsSlice.actions;
export const panelsReducer = panelsSlice.reducer;

export function buildBatchRequest(
  pending: Record<string, PanelUpdateFields>,
): UpdatePanelsBatchRequest {
  const allFields = new Set<string>();
  const panels: PanelBatchItem[] = [];

  for (const [id, fields] of Object.entries(pending)) {
    Object.keys(fields).forEach((key) => allFields.add(key));
    panels.push({ id, ...fields });
  }

  return {
    fields: Array.from(allFields),
    panels,
  };
}
