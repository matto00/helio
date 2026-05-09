import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import {
  getPipelines,
  createPipeline as createPipelineRequest,
  runPipeline,
  fetchRunHistory,
  getPipelineById,
  getPipelineSteps,
  updatePipeline as updatePipelineRequest,
} from "../../services/pipelineService";
import type {
  PipelineRunRecord,
  PipelineStep,
  PipelineSummary,
  RunStatus,
} from "../../types/models";

interface PipelinesState {
  items: PipelineSummary[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  createStatus: "idle" | "loading" | "succeeded" | "failed";
  createError: string | null;
  runId: string | null;
  runStatus: RunStatus | null;
  runError: string | null;
  runHistory: Record<string, PipelineRunRecord[]>;
  // Single-pipeline detail
  currentPipeline: PipelineSummary | null;
  currentPipelineStatus: "idle" | "loading" | "succeeded" | "failed";
  currentPipelineError: string | null;
  // Steps per pipeline
  steps: Record<string, PipelineStep[]>;
  stepsStatus: Record<string, "idle" | "loading" | "succeeded" | "failed">;
  stepsError: Record<string, string | null>;
  // Update operation
  updateStatus: "idle" | "loading" | "succeeded" | "failed";
  updateError: string | null;
  // Last successful run output rows (used to derive available field names for select ops)
  runResult: Record<string, unknown>[] | null;
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
  runHistory: {},
  currentPipeline: null,
  currentPipelineStatus: "idle",
  currentPipelineError: null,
  steps: {},
  stepsStatus: {},
  stepsError: {},
  updateStatus: "idle",
  updateError: null,
  runResult: null,
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

export const fetchPipelineById = createAsyncThunk<PipelineSummary, string, { rejectValue: string }>(
  "pipelines/fetchPipelineById",
  async (pipelineId, { rejectWithValue }) => {
    try {
      return await getPipelineById(pipelineId);
    } catch {
      return rejectWithValue("Failed to load pipeline.");
    }
  },
);

export const fetchPipelineSteps = createAsyncThunk<
  { pipelineId: string; steps: PipelineStep[] },
  string,
  { rejectValue: string }
>("pipelines/fetchPipelineSteps", async (pipelineId, { rejectWithValue }) => {
  try {
    const steps = await getPipelineSteps(pipelineId);
    return { pipelineId, steps };
  } catch {
    return rejectWithValue("Failed to load pipeline steps.");
  }
});

export const updatePipeline = createAsyncThunk<
  PipelineSummary,
  { id: string; name: string },
  { rejectValue: string }
>("pipelines/updatePipeline", async ({ id, name }, { rejectWithValue }) => {
  try {
    return await updatePipelineRequest(id, name);
  } catch {
    return rejectWithValue("Failed to update pipeline.");
  }
});

export const submitPipelineRun = createAsyncThunk<
  { rowCount: number; rows: Record<string, unknown>[] },
  string,
  { rejectValue: string }
>("pipelines/submitPipelineRun", async (pipelineId, { rejectWithValue }) => {
  try {
    return await runPipeline(pipelineId);
  } catch {
    return rejectWithValue("Failed to start pipeline run.");
  }
});

export const fetchPipelineRunHistory = createAsyncThunk<
  { pipelineId: string; records: PipelineRunRecord[] },
  string,
  { rejectValue: string }
>("pipelines/fetchPipelineRunHistory", async (pipelineId, { rejectWithValue }) => {
  try {
    const records = await fetchRunHistory(pipelineId);
    return { pipelineId, records };
  } catch {
    return rejectWithValue("Failed to load run history.");
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
      state.runResult = null;
    },
    setRunStatus(
      state,
      action: { payload: { status: RunStatus; error?: string; rows?: Record<string, unknown>[] } },
    ) {
      state.runStatus = action.payload.status;
      if (action.payload.error !== undefined) {
        state.runError = action.payload.error;
      }
      if (action.payload.rows !== undefined) {
        state.runResult = action.payload.rows;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchPipelines
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
      // fetchPipelineById
      .addCase(fetchPipelineById.pending, (state) => {
        state.currentPipelineStatus = "loading";
        // Preserve currentPipelineError so the UI can keep showing it during a re-fetch
        // It is cleared on success or by a new error.
      })
      .addCase(fetchPipelineById.fulfilled, (state, action) => {
        state.currentPipeline = action.payload;
        state.currentPipelineStatus = "succeeded";
        state.currentPipelineError = null;
      })
      .addCase(fetchPipelineById.rejected, (state, action) => {
        state.currentPipeline = null;
        state.currentPipelineStatus = "failed";
        state.currentPipelineError = action.payload ?? "Failed to load pipeline.";
      })
      // fetchPipelineSteps
      .addCase(fetchPipelineSteps.pending, (state, action) => {
        const pid = action.meta.arg;
        state.stepsStatus[pid] = "loading";
        state.stepsError[pid] = null;
      })
      .addCase(fetchPipelineSteps.fulfilled, (state, action) => {
        const { pipelineId, steps } = action.payload;
        state.steps[pipelineId] = steps;
        state.stepsStatus[pipelineId] = "succeeded";
        state.stepsError[pipelineId] = null;
      })
      .addCase(fetchPipelineSteps.rejected, (state, action) => {
        const pid = action.meta.arg;
        state.stepsStatus[pid] = "failed";
        state.stepsError[pid] = action.payload ?? "Failed to load pipeline steps.";
      })
      // updatePipeline
      .addCase(updatePipeline.pending, (state) => {
        state.updateStatus = "loading";
        state.updateError = null;
      })
      .addCase(updatePipeline.fulfilled, (state, action) => {
        state.currentPipeline = action.payload;
        state.updateStatus = "succeeded";
        state.updateError = null;
      })
      .addCase(updatePipeline.rejected, (state, action) => {
        state.updateStatus = "failed";
        state.updateError = action.payload ?? "Failed to update pipeline.";
      })
      // createPipeline
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
      // submitPipelineRun
      .addCase(submitPipelineRun.pending, (state) => {
        state.runId = null;
        state.runStatus = "queued";
        state.runError = null;
      })
      .addCase(submitPipelineRun.fulfilled, (state, action) => {
        state.runId = null;
        state.runStatus = "succeeded";
        state.runResult = action.payload.rows;
      })
      .addCase(submitPipelineRun.rejected, (state, action) => {
        state.runId = null;
        state.runStatus = null;
        state.runError = action.payload ?? "Failed to start pipeline run.";
      })
      // fetchPipelineRunHistory
      .addCase(fetchPipelineRunHistory.fulfilled, (state, action) => {
        state.runHistory[action.payload.pipelineId] = action.payload.records;
      });
  },
});

export const { clearRunState, setRunStatus } = pipelinesSlice.actions;
export type { PipelinesState };
export const pipelinesReducer = pipelinesSlice.reducer;
