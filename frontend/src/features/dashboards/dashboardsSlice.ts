import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";

import {
  createDashboard as createDashboardRequest,
  deleteDashboard as deleteDashboardRequest,
  duplicateDashboard as duplicateDashboardRequest,
  fetchDashboards as fetchDashboardsRequest,
  renameDashboard as renameDashboardRequest,
  updateDashboardAppearance as updateDashboardAppearanceRequest,
  updateDashboardLayout as updateDashboardLayoutRequest,
} from "../../services/dashboardService";
import type { RootState } from "../../store/store";
import type {
  Dashboard,
  DashboardAppearance,
  DashboardLayout,
  DuplicateDashboardResponse,
} from "../../types/models";

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

// The backend guarantees dashboards are returned sorted by lastUpdated desc,
// so the first item is always the most recently updated.
function getMostRecentDashboardId(dashboards: Dashboard[]): string | null {
  return dashboards[0]?.id ?? null;
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
    condition: (_, { getState }) => getState().dashboards.status === "idle",
  },
);

export const createDashboard = createAsyncThunk<
  Dashboard,
  { name: string },
  { rejectValue: string }
>("dashboards/createDashboard", async ({ name }, { rejectWithValue }) => {
  try {
    return await createDashboardRequest(name);
  } catch {
    return rejectWithValue("Failed to create dashboard.");
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

export const updateDashboardLayout = createAsyncThunk<
  Dashboard,
  { dashboardId: string; layout: DashboardLayout },
  { rejectValue: string }
>("dashboards/updateDashboardLayout", async ({ dashboardId, layout }, { rejectWithValue }) => {
  try {
    return await updateDashboardLayoutRequest(dashboardId, layout);
  } catch {
    return rejectWithValue("Failed to save dashboard layout.");
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
        state.items = state.items.map((dashboard) =>
          dashboard.id === action.payload.id ? action.payload : dashboard,
        );
      })
      .addCase(createDashboard.fulfilled, (state, action) => {
        state.items.push(action.payload);
        state.selectedDashboardId = action.payload.id;
      })
      .addCase(renameDashboard.fulfilled, (state, action) => {
        state.items = state.items.map((dashboard) =>
          dashboard.id === action.payload.id ? action.payload : dashboard,
        );
      })
      .addCase(deleteDashboard.fulfilled, (state, action) => {
        state.items = state.items.filter((d) => d.id !== action.payload);
        if (state.selectedDashboardId === action.payload) {
          state.selectedDashboardId = getMostRecentDashboardId(state.items);
        }
      })
      .addCase(duplicateDashboard.fulfilled, (state, action) => {
        state.items.push(action.payload.dashboard);
        state.selectedDashboardId = action.payload.dashboard.id;
      });
  },
});

export const { setSelectedDashboardId } = dashboardsSlice.actions;
export const dashboardsReducer = dashboardsSlice.reducer;
