import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import { getPipelines } from "../../services/pipelineService";
import type { PipelineSummary } from "../../types/models";

interface PipelinesState {
  items: PipelineSummary[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
}

const initialState: PipelinesState = {
  items: [],
  status: "idle",
  error: null,
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
      });
  },
});

export const pipelinesReducer = pipelinesSlice.reducer;
