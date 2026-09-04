import { createAsyncThunk, createSelector, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import type { RootState } from "../../../store/store";
import {
  getPipelines,
  createPipeline as createPipelineRequest,
  deletePipeline as deletePipelineRequest,
  runPipeline,
  fetchRunHistory,
  getPipelineById,
  getPipelineSteps,
  updatePipeline as updatePipelineRequest,
  analyzePipeline as analyzePipelineRequest,
  getPipelineSchedule,
  putPipelineSchedule,
  deletePipelineSchedule as deletePipelineScheduleRequest,
} from "../services/pipelineService";
import { applyPipelineProposal as applyPipelineProposalRequest } from "../services/pipelineProposalService";
import {
  classifyRequestError,
  type RequestErrorKind,
} from "../../../services/classifyRequestError";
import type {
  PipelineAnalyzeResponse,
  PipelineRunRecord,
  PipelineStep,
  PipelineSummary,
  RunStatus,
} from "../types/pipelineStep";
import type { PipelineSchedule, PutPipelineScheduleRequest } from "../types/pipelineSchedule";
import type { PipelineProposal, PipelineProposalApplyResponse } from "../types/pipelineProposal";

/** Matches `dashboardsSlice.ts` / `sourcesSlice.ts`'s existing error-extraction
 *  pattern (design D4): the backend's `ErrorResponse(message)` always uses the
 *  `message` field name. */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  return fallback;
}

/** Wire shape of a `PipelineSummary`: spray-json omits an `Option[T] = None`
 *  field entirely rather than serializing it as `null` (a recurring gotcha
 *  in this codebase — see the equivalent normalization pattern in
 *  `outputService.ts`), so a
 *  never-run pipeline arrives with `lastRunAt`/`lastRunStatus`/
 *  `lastRunRowCount` *absent*, not `null`. `PipelineListTable.tsx` and this
 *  page's own meta-bar only guard against `null` (`!== null`/`!= null`), so
 *  an absent field reads as "has a value" and renders `formatRelativeTime
 *  (undefined)` → "NaN years ago" (HEL sweep F-042). Normalize once here,
 *  at the state boundary, so every reducer/selector/component downstream
 *  can keep trusting the declared `T | null` contract. */
type PipelineSummaryWire = Omit<
  PipelineSummary,
  "lastRunAt" | "lastRunStatus" | "lastRunRowCount"
> & {
  lastRunAt?: PipelineSummary["lastRunAt"];
  lastRunStatus?: PipelineSummary["lastRunStatus"];
  lastRunRowCount?: PipelineSummary["lastRunRowCount"];
};

function normalizePipelineSummary(wire: PipelineSummaryWire): PipelineSummary {
  return {
    ...wire,
    lastRunAt: wire.lastRunAt ?? null,
    lastRunStatus: wire.lastRunStatus ?? null,
    lastRunRowCount: wire.lastRunRowCount ?? null,
  };
}

interface PipelinesState {
  items: PipelineSummary[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  errorKind: RequestErrorKind | null;
  createStatus: "idle" | "loading" | "succeeded" | "failed";
  createError: string | null;
  runId: string | null;
  runStatus: RunStatus | null;
  runError: string | null;
  runIsDry: boolean | null;
  runHistory: Record<string, PipelineRunRecord[]>;
  currentPipeline: PipelineSummary | null;
  currentPipelineStatus: "idle" | "loading" | "succeeded" | "failed";
  currentPipelineError: string | null;
  currentPipelineErrorKind: RequestErrorKind | null;
  steps: Record<string, PipelineStep[]>;
  stepsStatus: Record<string, "idle" | "loading" | "succeeded" | "failed">;
  stepsError: Record<string, string | null>;
  updateStatus: "idle" | "loading" | "succeeded" | "failed";
  updateError: string | null;
  // Last successful run output rows (used to derive available field names for select ops)
  runResult: Record<string, unknown>[] | null;
  // Per-step output row counts from the last run, keyed by step id.
  // sourceRowCount is the input row count to the first step.
  runStepRowCounts: Record<string, number>;
  runSourceRowCount: number | null;
  // HEL-861: truncation reporting from the last run — see RunResult's doc comments.
  runSourceTruncated: boolean;
  runSourceAvailableRowCount: number | null;
  runTruncationNotice: string | null;
  // Per-pipeline schema inference results from GET /api/pipelines/:id/analyze
  analyzeResult: Record<string, PipelineAnalyzeResponse>;
  analyzeStatus: Record<string, "idle" | "loading" | "succeeded" | "failed">;
  analyzeError: Record<string, string | null>;
  /** Open/closed state for CreatePipelineModal — controlled from the sidebar's
   * + button so the page itself doesn't need to own modal state. */
  createModalOpen: boolean;
  // Per-pipeline schedule (HEL-416). `null` means "no schedule set" — a
  // domain state, not an error (design D5, mirrors the retired type-registry slice's
  // 409-branching precedent for expected non-2xx responses).
  schedule: Record<string, PipelineSchedule | null>;
  scheduleStatus: Record<string, "idle" | "loading" | "succeeded" | "failed">;
  scheduleError: Record<string, string | null>;
  // Save/delete get their own status/error so a failed save doesn't clobber
  // the last-loaded schedule shown in the bar (design D5).
  scheduleSaveStatus: "idle" | "loading" | "succeeded" | "failed";
  scheduleSaveError: string | null;
}

const initialState: PipelinesState = {
  items: [],
  status: "idle",
  error: null,
  errorKind: null,
  createStatus: "idle",
  createError: null,
  runId: null,
  runStatus: null,
  runError: null,
  runIsDry: null,
  runHistory: {},
  currentPipeline: null,
  currentPipelineStatus: "idle",
  currentPipelineError: null,
  currentPipelineErrorKind: null,
  steps: {},
  stepsStatus: {},
  stepsError: {},
  updateStatus: "idle",
  updateError: null,
  runResult: null,
  runStepRowCounts: {},
  runSourceRowCount: null,
  runSourceTruncated: false,
  runSourceAvailableRowCount: null,
  runTruncationNotice: null,
  analyzeResult: {},
  analyzeStatus: {},
  analyzeError: {},
  createModalOpen: false,
  schedule: {},
  scheduleStatus: {},
  scheduleError: {},
  scheduleSaveStatus: "idle",
  scheduleSaveError: null,
};

export const fetchPipelines = createAsyncThunk<
  PipelineSummary[],
  void,
  { state: RootState; rejectValue: { message: string; kind: RequestErrorKind } }
>(
  "pipelines/fetchPipelines",
  async (_, { rejectWithValue }) => {
    try {
      const summaries = await getPipelines();
      return summaries.map(normalizePipelineSummary);
    } catch (err: unknown) {
      return rejectWithValue(classifyRequestError(err, "Failed to load pipelines."));
    }
  },
  {
    // F-104 — every remount of a `fetchPipelines()` caller (e.g. revisiting
    // `PipelinesPage`) re-issued the request even though `items` was already
    // loaded and unchanged. Mirrors `panelThunks.ts`'s `fetchPanels` guard:
    // skip while a fetch is already in flight or has already succeeded, but
    // still allow a retry from `failed` (unlike a bare `status === "idle"`
    // check, which would permanently block retries after one failure).
    condition: (_, { getState }) => {
      const { status } = getState().pipelines;
      return status !== "loading" && status !== "succeeded";
    },
  },
);

export const fetchPipelineById = createAsyncThunk<
  PipelineSummary,
  string,
  { rejectValue: { message: string; kind: RequestErrorKind } }
>("pipelines/fetchPipelineById", async (pipelineId, { rejectWithValue }) => {
  try {
    return normalizePipelineSummary(await getPipelineById(pipelineId));
  } catch (err: unknown) {
    return rejectWithValue(classifyRequestError(err, "Failed to load pipeline."));
  }
});

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
    return normalizePipelineSummary(await updatePipelineRequest(id, name));
  } catch {
    return rejectWithValue("Failed to update pipeline.");
  }
});

export const deletePipeline = createAsyncThunk<string, string, { rejectValue: string }>(
  "pipelines/deletePipeline",
  async (id, { rejectWithValue }) => {
    try {
      await deletePipelineRequest(id);
      return id;
    } catch {
      return rejectWithValue("Failed to delete pipeline.");
    }
  },
);

export const submitPipelineRun = createAsyncThunk<
  {
    rowCount: number;
    rows: Record<string, unknown>[];
    stepRowCounts: Record<string, number>;
    sourceRowCount: number;
    sourceTruncated?: boolean;
    sourceAvailableRowCount?: number;
    truncationNotice?: string;
  },
  { pipelineId: string; dryRun?: boolean },
  { rejectValue: string }
>("pipelines/submitPipelineRun", async ({ pipelineId, dryRun }, { rejectWithValue }) => {
  try {
    return await runPipeline(pipelineId, dryRun);
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
  { name: string; roots: { sourceId: string }[]; outputDataTypeName?: string },
  { rejectValue: string }
>("pipelines/createPipeline", async (payload, { rejectWithValue }) => {
  try {
    return normalizePipelineSummary(await createPipelineRequest(payload));
  } catch {
    return rejectWithValue("Failed to create pipeline.");
  }
});

export const analyzePipeline = createAsyncThunk<
  { pipelineId: string; result: PipelineAnalyzeResponse },
  string,
  { rejectValue: string }
>("pipelines/analyzePipeline", async (pipelineId, { rejectWithValue }) => {
  try {
    const result = await analyzePipelineRequest(pipelineId);
    return { pipelineId, result };
  } catch {
    return rejectWithValue("Failed to analyze pipeline.");
  }
});

/** Apply an accepted pipeline proposal (HEL-383's existing endpoint — HEL-739
 *  design.md D7). Mirrors `dashboardsSlice.applyProposal`'s exact
 *  `createAsyncThunk`/`rejectWithValue`/Axios-error-unwrap shape. Unlike
 *  `applyProposal`, no new state/reducer case is added here: the created
 *  pipeline is not cached client-side today (`PipelinesPage`/
 *  `PipelineDetailPage` both refetch on mount), so there's nothing for a
 *  reducer to update. */
export const applyPipelineProposal = createAsyncThunk<
  PipelineProposalApplyResponse,
  PipelineProposal,
  { rejectValue: string }
>("pipelines/applyPipelineProposal", async (proposal, { rejectWithValue }) => {
  try {
    return await applyPipelineProposalRequest(proposal);
  } catch (err) {
    const serverMessage =
      isAxiosError(err) && typeof err.response?.data?.message === "string"
        ? err.response.data.message
        : null;
    return rejectWithValue(serverMessage ?? "Failed to apply the pipeline proposal.");
  }
});

/** GET the pipeline's schedule. A 404 ("no schedule set") is an expected
 *  domain state, not a failure — it resolves `fulfilled` with `schedule: null`
 *  (design D5, mirrors the retired type-registry slice's 409-branching precedent). Any
 *  other error rejects normally. */
export const fetchPipelineSchedule = createAsyncThunk<
  { pipelineId: string; schedule: PipelineSchedule | null },
  string,
  { rejectValue: string }
>("pipelines/fetchPipelineSchedule", async (pipelineId, { rejectWithValue }) => {
  try {
    const schedule = await getPipelineSchedule(pipelineId);
    return { pipelineId, schedule };
  } catch (err: unknown) {
    if (isAxiosError(err) && err.response?.status === 404) {
      return { pipelineId, schedule: null };
    }
    return rejectWithValue(extractErrorMessage(err, "Failed to load pipeline schedule."));
  }
});

/** PUT the pipeline's schedule (upsert). */
export const savePipelineSchedule = createAsyncThunk<
  { pipelineId: string; schedule: PipelineSchedule },
  { pipelineId: string; request: PutPipelineScheduleRequest },
  { rejectValue: string }
>("pipelines/savePipelineSchedule", async ({ pipelineId, request }, { rejectWithValue }) => {
  try {
    const schedule = await putPipelineSchedule(pipelineId, request);
    return { pipelineId, schedule };
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to save pipeline schedule."));
  }
});

/** DELETE the pipeline's schedule ("Clear schedule"). */
export const deletePipelineSchedule = createAsyncThunk<
  { pipelineId: string },
  string,
  { rejectValue: string }
>("pipelines/deletePipelineSchedule", async (pipelineId, { rejectWithValue }) => {
  try {
    await deletePipelineScheduleRequest(pipelineId);
    return { pipelineId };
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to clear pipeline schedule."));
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
      state.runIsDry = null;
      state.runResult = null;
      // HEL-861 (skeptic-final-1): these three were added alongside the other run-scoped
      // fields above but were missed here — without this, navigating from a truncated
      // pipeline's run to a different pipeline left the truncation banner showing the
      // PREVIOUS pipeline's source/notice/counts (submitPipelineRun.pending already guards
      // the same hazard for a fresh run; this is the pipeline-navigation cleanup path).
      state.runSourceTruncated = false;
      state.runSourceAvailableRowCount = null;
      state.runTruncationNotice = null;
    },
    setCreatePipelineModalOpen(state, action: { payload: boolean }) {
      state.createModalOpen = action.payload;
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
      .addCase(fetchPipelines.pending, (state) => {
        state.status = "loading";
        state.error = null;
        state.errorKind = null;
      })
      .addCase(fetchPipelines.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
        state.errorKind = null;
      })
      .addCase(fetchPipelines.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload?.message ?? "Failed to load pipelines.";
        state.errorKind = action.payload?.kind ?? "error";
      })
      .addCase(fetchPipelineById.pending, (state) => {
        state.currentPipelineStatus = "loading";
        // Preserve currentPipelineError/currentPipelineErrorKind so the UI can
        // keep showing it during a re-fetch (D1a) — cleared on success or
        // replaced by a new error.
      })
      .addCase(fetchPipelineById.fulfilled, (state, action) => {
        state.currentPipeline = action.payload;
        state.currentPipelineStatus = "succeeded";
        state.currentPipelineError = null;
        state.currentPipelineErrorKind = null;
      })
      .addCase(fetchPipelineById.rejected, (state, action) => {
        state.currentPipeline = null;
        state.currentPipelineStatus = "failed";
        state.currentPipelineError = action.payload?.message ?? "Failed to load pipeline.";
        state.currentPipelineErrorKind = action.payload?.kind ?? "error";
      })
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
      .addCase(deletePipeline.fulfilled, (state, action) => {
        state.items = state.items.filter((p) => p.id !== action.payload);
        if (state.currentPipeline?.id === action.payload) {
          state.currentPipeline = null;
        }
      })
      .addCase(createPipeline.pending, (state) => {
        state.createStatus = "loading";
        state.createError = null;
      })
      .addCase(createPipeline.fulfilled, (state, action) => {
        state.createStatus = "succeeded";
        state.createError = null;
        // F-104 regression fix: `fetchPipelines`'s `condition` guard (above)
        // now skips re-fetching once `state.items` has already loaded
        // successfully — which broke the one caller (CreatePipelineModal)
        // that relied on a post-create `dispatch(fetchPipelines())` to add
        // the new pipeline to the list. The thunk already returns the full
        // created `PipelineSummary` (`normalizePipelineSummary(...)` above),
        // so add it directly here instead — matches
        // `dashboardsSlice.ts`'s `createDashboard.fulfilled` convention and
        // is strictly fewer requests than the old refetch-the-whole-list
        // approach it replaces.
        state.items.push(action.payload);
      })
      .addCase(createPipeline.rejected, (state, action) => {
        state.createStatus = "failed";
        state.createError = action.payload ?? "Failed to create pipeline.";
      })
      .addCase(submitPipelineRun.pending, (state, action) => {
        state.runId = null;
        state.runStatus = "queued";
        state.runError = null;
        state.runIsDry = action.meta.arg.dryRun ?? false;
        // HEL-861: reset truncation state alongside the rest of the run state so a stale
        // notice from a previous run never lingers on screen during a new run.
        state.runSourceTruncated = false;
        state.runSourceAvailableRowCount = null;
        state.runTruncationNotice = null;
      })
      .addCase(submitPipelineRun.fulfilled, (state, action) => {
        state.runId = null;
        state.runStatus = "succeeded";
        state.runResult = action.payload.rows;
        state.runStepRowCounts = action.payload.stepRowCounts ?? {};
        state.runSourceRowCount = action.payload.sourceRowCount ?? null;
        state.runSourceTruncated = action.payload.sourceTruncated ?? false;
        state.runSourceAvailableRowCount = action.payload.sourceAvailableRowCount ?? null;
        state.runTruncationNotice = action.payload.truncationNotice ?? null;
      })
      .addCase(submitPipelineRun.rejected, (state, action) => {
        state.runId = null;
        state.runStatus = null;
        state.runIsDry = null;
        state.runError = action.payload ?? "Failed to start pipeline run.";
      })
      .addCase(fetchPipelineRunHistory.fulfilled, (state, action) => {
        state.runHistory[action.payload.pipelineId] = action.payload.records;
      })
      .addCase(analyzePipeline.pending, (state, action) => {
        const pid = action.meta.arg;
        state.analyzeStatus[pid] = "loading";
        state.analyzeError[pid] = null;
      })
      .addCase(analyzePipeline.fulfilled, (state, action) => {
        const { pipelineId, result } = action.payload;
        state.analyzeResult[pipelineId] = result;
        state.analyzeStatus[pipelineId] = "succeeded";
        state.analyzeError[pipelineId] = null;
      })
      .addCase(analyzePipeline.rejected, (state, action) => {
        const pid = action.meta.arg;
        state.analyzeStatus[pid] = "failed";
        state.analyzeError[pid] = action.payload ?? "Failed to analyze pipeline.";
      })
      .addCase(fetchPipelineSchedule.pending, (state, action) => {
        const pid = action.meta.arg;
        state.scheduleStatus[pid] = "loading";
        state.scheduleError[pid] = null;
      })
      .addCase(fetchPipelineSchedule.fulfilled, (state, action) => {
        const { pipelineId, schedule } = action.payload;
        state.schedule[pipelineId] = schedule;
        state.scheduleStatus[pipelineId] = "succeeded";
        state.scheduleError[pipelineId] = null;
      })
      .addCase(fetchPipelineSchedule.rejected, (state, action) => {
        const pid = action.meta.arg;
        state.scheduleStatus[pid] = "failed";
        state.scheduleError[pid] = action.payload ?? "Failed to load pipeline schedule.";
      })
      .addCase(savePipelineSchedule.pending, (state) => {
        state.scheduleSaveStatus = "loading";
        state.scheduleSaveError = null;
      })
      .addCase(savePipelineSchedule.fulfilled, (state, action) => {
        const { pipelineId, schedule } = action.payload;
        state.schedule[pipelineId] = schedule;
        state.scheduleStatus[pipelineId] = "succeeded";
        state.scheduleError[pipelineId] = null;
        state.scheduleSaveStatus = "succeeded";
        state.scheduleSaveError = null;
      })
      .addCase(savePipelineSchedule.rejected, (state, action) => {
        state.scheduleSaveStatus = "failed";
        state.scheduleSaveError = action.payload ?? "Failed to save pipeline schedule.";
      })
      .addCase(deletePipelineSchedule.pending, (state) => {
        state.scheduleSaveStatus = "loading";
        state.scheduleSaveError = null;
      })
      .addCase(deletePipelineSchedule.fulfilled, (state, action) => {
        const { pipelineId } = action.payload;
        state.schedule[pipelineId] = null;
        state.scheduleStatus[pipelineId] = "succeeded";
        state.scheduleError[pipelineId] = null;
        state.scheduleSaveStatus = "succeeded";
        state.scheduleSaveError = null;
      })
      .addCase(deletePipelineSchedule.rejected, (state, action) => {
        state.scheduleSaveStatus = "failed";
        state.scheduleSaveError = action.payload ?? "Failed to clear pipeline schedule.";
      });
  },
});

/** Pipeline names grouped by the DataSource they READ FROM, for the `/sources`
 *  overview's "Used by" column. Many-to-one rather than one-to-one: several
 *  pipelines can read the same source, so this maps to an array where that
 *  one maps to a single name. Memoized on `items` like its sibling, so the
 *  table doesn't rebuild the map on unrelated store activity.
 *
 *  HEL-969: a pipeline can have multiple `roots[]`; index every root's
 *  `dataSourceId`, not just the first, and dedupe per pipeline so a
 *  pipeline with two roots on the same source is listed once, not twice. */
export const selectPipelineNamesBySourceId = createSelector(
  (state: RootState) => state.pipelines.items,
  (items): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const pipeline of items) {
      const sourceIds = new Set(pipeline.roots.map((r) => r.dataSourceId));
      for (const sourceId of sourceIds) {
        const existing = map.get(sourceId);
        if (existing === undefined) {
          map.set(sourceId, [pipeline.name]);
        } else {
          existing.push(pipeline.name);
        }
      }
    }
    return map;
  },
);

export const { clearRunState, setRunStatus, setCreatePipelineModalOpen } = pipelinesSlice.actions;
export type { PipelinesState };
export const pipelinesReducer = pipelinesSlice.reducer;
