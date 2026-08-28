import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  createMetric as createMetricRequest,
  deleteMetric as deleteMetricRequest,
  fetchMetricById as fetchMetricByIdRequest,
  fetchMetrics as fetchMetricsRequest,
  updateMetric as updateMetricRequest,
} from "../services/metricService";
import type {
  CreateMetricRequest,
  Metric,
  MetricSummary,
  UpdateMetricRequest,
} from "../types/metric";

/** Matches `pipelinesSlice.ts`/`dashboardsSlice.ts`'s existing error-extraction
 *  pattern: the backend's `ErrorResponse(message)` always uses the `message`
 *  field name. Duplicated per-slice rather than extracted to a shared helper,
 *  matching existing house style (design.md D2). */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  return fallback;
}

interface MetricsState {
  items: MetricSummary[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  createStatus: "idle" | "loading" | "succeeded" | "failed";
  createError: string | null;
  updateStatus: "idle" | "loading" | "succeeded" | "failed";
  updateError: string | null;
  deleteStatus: "idle" | "loading" | "succeeded" | "failed";
  deleteError: string | null;
  currentMetric: Metric | null;
  currentMetricStatus: "idle" | "loading" | "succeeded" | "failed";
  currentMetricError: string | null;
  /** Open/closed state for the "New metric" modal — driven from both the
   *  MetricsPage toolbar and the sidebar's + button, mirroring
   *  `pipelinesSlice`'s `createModalOpen`. */
  createModalOpen: boolean;
}

const initialState: MetricsState = {
  items: [],
  status: "idle",
  error: null,
  createStatus: "idle",
  createError: null,
  updateStatus: "idle",
  updateError: null,
  deleteStatus: "idle",
  deleteError: null,
  currentMetric: null,
  currentMetricStatus: "idle",
  currentMetricError: null,
  createModalOpen: false,
};

export const fetchMetrics = createAsyncThunk<MetricSummary[], void, { rejectValue: string }>(
  "metrics/fetchMetrics",
  async (_, { rejectWithValue }) => {
    try {
      return await fetchMetricsRequest();
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to load metrics."));
    }
  },
);

export const fetchMetricById = createAsyncThunk<Metric, string, { rejectValue: string }>(
  "metrics/fetchMetricById",
  async (id, { rejectWithValue }) => {
    try {
      return await fetchMetricByIdRequest(id);
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to load metric."));
    }
  },
);

export const createMetric = createAsyncThunk<Metric, CreateMetricRequest, { rejectValue: string }>(
  "metrics/createMetric",
  async (request, { rejectWithValue }) => {
    try {
      return await createMetricRequest(request);
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to create metric."));
    }
  },
);

export const updateMetric = createAsyncThunk<
  Metric,
  { id: string; request: UpdateMetricRequest },
  { rejectValue: string }
>("metrics/updateMetric", async ({ id, request }, { rejectWithValue }) => {
  try {
    return await updateMetricRequest(id, request);
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to update metric."));
  }
});

export const deleteMetric = createAsyncThunk<string, string, { rejectValue: string }>(
  "metrics/deleteMetric",
  async (id, { rejectWithValue }) => {
    try {
      await deleteMetricRequest(id);
      return id;
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to delete metric."));
    }
  },
);

const metricsSlice = createSlice({
  name: "metrics",
  initialState,
  reducers: {
    setCreateMetricModalOpen(state, action: { payload: boolean }) {
      state.createModalOpen = action.payload;
    },
    clearCurrentMetric(state) {
      state.currentMetric = null;
      state.currentMetricStatus = "idle";
      state.currentMetricError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMetrics.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchMetrics.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(fetchMetrics.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load metrics.";
      })
      .addCase(fetchMetricById.pending, (state) => {
        state.currentMetricStatus = "loading";
      })
      .addCase(fetchMetricById.fulfilled, (state, action) => {
        state.currentMetric = action.payload;
        state.currentMetricStatus = "succeeded";
        state.currentMetricError = null;
      })
      .addCase(fetchMetricById.rejected, (state, action) => {
        state.currentMetric = null;
        state.currentMetricStatus = "failed";
        state.currentMetricError = action.payload ?? "Failed to load metric.";
      })
      .addCase(createMetric.pending, (state) => {
        state.createStatus = "loading";
        state.createError = null;
      })
      .addCase(createMetric.fulfilled, (state, action) => {
        state.items = [...state.items, action.payload];
        state.createStatus = "succeeded";
        state.createError = null;
      })
      .addCase(createMetric.rejected, (state, action) => {
        state.createStatus = "failed";
        state.createError = action.payload ?? "Failed to create metric.";
      })
      .addCase(updateMetric.pending, (state) => {
        state.updateStatus = "loading";
        state.updateError = null;
      })
      .addCase(updateMetric.fulfilled, (state, action) => {
        state.currentMetric = action.payload;
        state.items = state.items.map((m) => (m.id === action.payload.id ? action.payload : m));
        state.updateStatus = "succeeded";
        state.updateError = null;
      })
      .addCase(updateMetric.rejected, (state, action) => {
        state.updateStatus = "failed";
        state.updateError = action.payload ?? "Failed to update metric.";
      })
      .addCase(deleteMetric.pending, (state) => {
        state.deleteStatus = "loading";
        state.deleteError = null;
      })
      .addCase(deleteMetric.fulfilled, (state, action) => {
        state.items = state.items.filter((m) => m.id !== action.payload);
        if (state.currentMetric?.id === action.payload) {
          state.currentMetric = null;
        }
        state.deleteStatus = "succeeded";
        state.deleteError = null;
      })
      .addCase(deleteMetric.rejected, (state, action) => {
        state.deleteStatus = "failed";
        state.deleteError = action.payload ?? "Failed to delete metric.";
      });
  },
});

export const { setCreateMetricModalOpen, clearCurrentMetric } = metricsSlice.actions;
export type { MetricsState };
export const metricsReducer = metricsSlice.reducer;
