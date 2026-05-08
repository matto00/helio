import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import {
  getPipelines,
  createPipeline as createPipelineRequest,
  runPipeline,
} from "../../services/pipelineService";
import type { PipelineSummary, RunStatus } from "../../types/models";

interface PipelinesState {
  items: PipelineSummary[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  createStatus: "idle" | "loading" | "succeeded" | "failed";
  createError: string | null;
  runId: string | null;
  runStatus: RunStatus | null;
  runError: string | null;
}

const initialState: PipelinesState = {
  items: [],
  status: "idle",
  error: null,
  createStatus: "idle",
  createError: null,
  runId: null,
  runStatus: null,
  runError: null,
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

export const submitPipelineRun = createAsyncThunk<
  { runId: string },
  string,
  { rejectValue: string }
>("pipelines/submitPipelineRun", async (pipelineId, { rejectWithValue }) => {
  try {
    return await runPipeline(pipelineId);
  } catch {
    return rejectWithValue("Failed to start pipeline run.");
  }
});

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
  reducers: {
    clearRunState(state) {
      state.runId = null;
      state.runStatus = null;
      state.runError = null;
    },
    setRunStatus(state, action: { payload: { status: RunStatus; error?: string } }) {
      state.runStatus = action.payload.status;
      if (action.payload.error !== undefined) {
        state.runError = action.payload.error;
      }
    },
  },
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
      })
      .addCase(submitPipelineRun.pending, (state) => {
        state.runId = null;
        state.runStatus = "queued";
        state.runError = null;
      })
      .addCase(submitPipelineRun.fulfilled, (state, action) => {
        state.runId = action.payload.runId;
        state.runStatus = "queued";
      })
      .addCase(submitPipelineRun.rejected, (state, action) => {
        state.runId = null;
        state.runStatus = null;
        state.runError = action.payload ?? "Failed to start pipeline run.";
      });
  },
});

export const { clearRunState, setRunStatus } = pipelinesSlice.actions;
export const pipelinesReducer = pipelinesSlice.reducer;
