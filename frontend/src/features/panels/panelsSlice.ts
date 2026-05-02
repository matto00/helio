import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";

import {
  createPanel as createPanelRequest,
  deletePanel as deletePanelRequest,
  duplicatePanel as duplicatePanelRequest,
  fetchPanels as fetchPanelsRequest,
  updatePanelAppearance as updatePanelAppearanceRequest,
  updatePanelBinding as updatePanelBindingRequest,
  updatePanelsBatch as updatePanelsBatchRequest,
  updatePanelTitle as updatePanelTitleRequest,
} from "../../services/panelService";
import { duplicateDashboard, importDashboard } from "../dashboards/dashboardsSlice";
import type { RootState } from "../../store/store";
import type {
  Panel,
  PanelAppearance,
  PanelBatchItem,
  PanelType,
  PanelUpdateFields,
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
}

const initialState: PanelsState = {
  items: [],
  loadedDashboardId: null,
  status: "idle",
  error: null,
  pendingPanelUpdates: {},
  lastSavedAt: null,
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
  { dashboardId: string; title: string; type?: PanelType },
  { state: RootState; rejectValue: string }
>("panels/createPanel", async ({ dashboardId, title, type }, { dispatch, rejectWithValue }) => {
  try {
    const createdPanel = await createPanelRequest(dashboardId, title, type);
    dispatch(markDashboardPanelsStale(dashboardId));
    await dispatch(fetchPanels(dashboardId));
    return createdPanel;
  } catch {
    return rejectWithValue("Failed to create panel.");
  }
});

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
      });
  },
});

export const { markDashboardPanelsStale, accumulatePanelUpdate, clearPendingPanelUpdates } =
  panelsSlice.actions;
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
