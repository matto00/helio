import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import { fetchPanels as fetchPanelsRequest } from "../../services/panelService";
import type { RootState } from "../../store/store";
import type { Panel } from "../../types/models";

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

const panelsSlice = createSlice({
  name: "panels",
  initialState,
  reducers: {},
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
      });
  },
});

export const panelsReducer = panelsSlice.reducer;
