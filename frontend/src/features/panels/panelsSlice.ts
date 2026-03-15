import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import {
  createPanel as createPanelRequest,
  fetchPanels as fetchPanelsRequest,
  updatePanelAppearance as updatePanelAppearanceRequest,
} from "../../services/panelService";
import type { RootState } from "../../store/store";
import type { Panel, PanelAppearance } from "../../types/models";

interface PanelsState {
  items: Panel[];
  loadedDashboardId: string | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
}

const initialState: PanelsState = {
  items: [],
  loadedDashboardId: null,
  status: "idle",
  error: null,
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
  { dashboardId: string; title: string },
  { state: RootState; rejectValue: string }
>("panels/createPanel", async ({ dashboardId, title }, { dispatch, rejectWithValue }) => {
  try {
    const createdPanel = await createPanelRequest(dashboardId, title);
    dispatch(markDashboardPanelsStale(dashboardId));
    await dispatch(fetchPanels(dashboardId));
    return createdPanel;
  } catch {
    return rejectWithValue("Failed to create panel.");
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
      .addCase(createPanel.rejected, (state, action) => {
        state.error = action.payload ?? "Failed to create panel.";
      });
  },
});

export const { markDashboardPanelsStale } = panelsSlice.actions;
export const panelsReducer = panelsSlice.reducer;
