import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";

import { fetchDashboards as fetchDashboardsRequest } from "../../services/dashboardService";
import type { RootState } from "../../store/store";
import type { Dashboard } from "../../types/models";

interface DashboardsState {
  items: Dashboard[];
  selectedDashboardId: string | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
}

const initialState: DashboardsState = {
  items: [],
  selectedDashboardId: null,
  status: "idle",
  error: null,
};

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
    condition: (_, { getState }) => getState().dashboards.status === "idle",
  },
);

const dashboardsSlice = createSlice({
  name: "dashboards",
  initialState,
  reducers: {
    setSelectedDashboardId(state, action: PayloadAction<string | null>) {
      state.selectedDashboardId = action.payload;
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
          : action.payload[0].id;
      })
      .addCase(fetchDashboards.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load dashboards.";
      });
  },
});

export const { setSelectedDashboardId } = dashboardsSlice.actions;
export const dashboardsReducer = dashboardsSlice.reducer;
