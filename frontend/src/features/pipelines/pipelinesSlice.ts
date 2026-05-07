import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import {
  getPipelines,
  createPipeline as createPipelineRequest,
} from "../../services/pipelineService";
import type { PipelineSummary } from "../../types/models";

interface PipelinesState {
  items: PipelineSummary[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  createStatus: "idle" | "loading" | "succeeded" | "failed";
  createError: string | null;
}

const initialState: PipelinesState = {
  items: [],
  status: "idle",
  error: null,
  createStatus: "idle",
  createError: null,
};

export const fetchPipelines = createAsyncThunk<PipelineSummary[], void, { rejectValue: string }>(
  "pipelines/fetchPipelines",
  async (_, { rejectWithValue }) => {
    try {
      return await getPipelines();
    } catch {
      return rejectWithValue("Failed to load pipelines.");
    }
  },
);

export const createPipeline = createAsyncThunk<
  PipelineSummary,
  { name: string; sourceDataSourceId: string; outputDataTypeName: string },
  { rejectValue: string }
>("pipelines/createPipeline", async (payload, { rejectWithValue }) => {
  try {
    return await createPipelineRequest(payload);
  } catch {
    return rejectWithValue("Failed to create pipeline.");
  }
});

const pipelinesSlice = createSlice({
  name: "pipelines",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchPipelines.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchPipelines.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(fetchPipelines.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load pipelines.";
      })
      .addCase(createPipeline.pending, (state) => {
        state.createStatus = "loading";
        state.createError = null;
      })
      .addCase(createPipeline.fulfilled, (state) => {
        state.createStatus = "succeeded";
        state.createError = null;
      })
      .addCase(createPipeline.rejected, (state, action) => {
        state.createStatus = "failed";
        state.createError = action.payload ?? "Failed to create pipeline.";
      });
  },
});

export const pipelinesReducer = pipelinesSlice.reducer;
