import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { PipelineStep, RunStatus } from "../types/pipelineStep";
import {
  analyzePipeline,
  createPipeline,
  deletePipeline,
  fetchPipelineById,
  fetchPipelineRunHistory,
  fetchPipelineSteps,
  fetchPipelines,
  submitPipelineRun,
  updatePipeline,
} from "./pipelinesThunks";
import {
  deletePipelineSchedule,
  fetchPipelineSchedule,
  savePipelineSchedule,
} from "./pipelineScheduleThunks";
import { initialState, type PipelinesState } from "./pipelinesState";

// The thunks and state type moved out of this file (HEL-1501); re-exported so the module's public
// import surface is unchanged and no importer edits.
export {
  analyzePipeline,
  applyPipelineProposal,
  createPipeline,
  deletePipeline,
  fetchPipelineById,
  fetchPipelineRunHistory,
  fetchPipelineSteps,
  fetchPipelines,
  submitPipelineRun,
  updatePipeline,
  type FetchRunHistoryArg,
} from "./pipelinesThunks";
export {
  deletePipelineSchedule,
  fetchPipelineSchedule,
  savePipelineSchedule,
} from "./pipelineScheduleThunks";

/** HEL-1483: true when `pipelineId` is not the latest `fetchPipelineById` request (a null latest
 *  — nothing requested yet — never marks a response stale). */
function isStaleCurrentPipelineResponse(
  state: Pick<PipelinesState, "currentPipelineRequestedId">,
  pipelineId: string,
): boolean {
  return (
    state.currentPipelineRequestedId !== null && state.currentPipelineRequestedId !== pipelineId
  );
}

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
      // HEL-1483: the two row-count fields were also missed here, and a cleared run state owns no
      // pipeline, so an in-flight run for the pipeline just left is ignored when it resolves.
      state.runStepRowCounts = {};
      state.runSourceRowCount = null;
      state.runPipelineId = null;
      // HEL-861 (skeptic-final-1): these three were added alongside the other run-scoped
      // fields above but were missed here — without this, navigating from a truncated
      // pipeline's run to a different pipeline left the truncation banner showing the
      // PREVIOUS pipeline's source/notice/counts (submitPipelineRun.pending already guards
      // the same hazard for a fresh run; this is the pipeline-navigation cleanup path).
      state.runSourceTruncated = false;
      state.runSourceAvailableRowCount = null;
      state.runTruncationNotice = null;
    },
    /** HEL-1631 (design.md D9): Save & run's run is synchronous inside `POST .../draft/save`, so the run state `submitPipelineRun.pending`
     *  would set is set here, before the request goes out: the header's run chip shows the run while the save is open. */
    draftSaveRunPending(state, action: PayloadAction<{ pipelineId: string }>) {
      state.runId = null;
      state.runStatus = "queued";
      state.runError = null;
      state.runIsDry = false;
      state.runPipelineId = action.payload.pipelineId;
      state.runSourceTruncated = false;
      state.runSourceAvailableRowCount = null;
      state.runTruncationNotice = null;
    },
    /** The save's run settled. `succeeded` and `blocked` clear the in-session counts and rows (the save response carries
     *  none), so the spine falls back to the persisted counts the follow-up pipeline read brings. `refused` (the HEL-505 guard
     *  turned the run away after the save committed) and `failed` (the save itself did not commit) put the run state back, and
     *  leave `runError` null: the page explains a refused run itself, and a failed save is shown as a draft notice. */
    draftSaveRunSettled(
      state,
      action: PayloadAction<{
        pipelineId: string;
        outcome: "succeeded" | "blocked" | "refused" | "failed";
      }>,
    ) {
      // HEL-1483: a settle for a pipeline that no longer owns the run state is ignored.
      if (state.runPipelineId !== action.payload.pipelineId) return;
      const { outcome } = action.payload;
      state.runId = null;
      if (outcome === "succeeded" || outcome === "blocked") {
        state.runStatus = outcome === "succeeded" ? "succeeded" : "failed";
        state.runError = outcome === "blocked" ? "Run blocked by an assertion" : null;
        state.runResult = null;
        state.runStepRowCounts = {};
        state.runSourceRowCount = null;
      } else {
        state.runStatus = null;
        state.runIsDry = null;
        state.runError = null;
      }
    },
    /** HEL-1631: the saved definition a draft save returned becomes the stored steps. */
    pipelineStepsReplaced(
      state,
      action: PayloadAction<{ pipelineId: string; steps: PipelineStep[] }>,
    ) {
      state.steps[action.payload.pipelineId] = action.payload.steps;
      state.stepsStatus[action.payload.pipelineId] = "succeeded";
      state.stepsError[action.payload.pipelineId] = null;
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
      .addCase(fetchPipelineById.pending, (state, action) => {
        // HEL-1483: a request for a DIFFERENT pipeline than the one the error describes drops
        // that error (it must never show on the new pipeline's page); the same pipeline's
        // re-fetch still preserves it.
        if (state.currentPipelineRequestedId !== action.meta.arg) {
          state.currentPipelineError = null;
          state.currentPipelineErrorKind = null;
        }
        state.currentPipelineRequestedId = action.meta.arg;
        state.currentPipelineStatus = "loading";
        // Same-pipeline re-fetch: preserve currentPipelineError/currentPipelineErrorKind so the UI
        // can keep showing it during a re-fetch (D1a) — cleared on success or
        // replaced by a new error.
      })
      .addCase(fetchPipelineById.fulfilled, (state, action) => {
        // HEL-1483: only the latest-requested pipeline's response lands; the status is left
        // "loading" for the request that IS latest, which settles it itself.
        if (isStaleCurrentPipelineResponse(state, action.meta.arg)) return;
        state.currentPipeline = action.payload;
        state.currentPipelineStatus = "succeeded";
        state.currentPipelineError = null;
        state.currentPipelineErrorKind = null;
      })
      .addCase(fetchPipelineById.rejected, (state, action) => {
        if (isStaleCurrentPipelineResponse(state, action.meta.arg)) return;
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
        // HEL-1483: a rename resolving after a switch must not replace the page's other pipeline.
        if (state.currentPipeline === null || state.currentPipeline.id === action.payload.id) {
          state.currentPipeline = action.payload;
        }
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
        // HEL-1119: push-or-replace-by-id (not a bare push) — a concurrent
        // `fetchPipelines` refetch can resolve first with a payload that
        // already contains this pipeline (created server-side before the
        // list fetch ran), and `fetchPipelines.fulfilled`'s wholesale
        // replace would then be followed by this reducer pushing the same
        // pipeline again. Same defect and same fix shape as
        // `dashboardsSlice.ts`'s `createDashboard.fulfilled`.
        {
          const index = state.items.findIndex((p) => p.id === action.payload.id);
          if (index === -1) {
            state.items.push(action.payload);
          } else {
            state.items[index] = action.payload;
          }
        }
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
        state.runPipelineId = action.meta.arg.pipelineId;
        // HEL-861: reset truncation state alongside the rest of the run state so a stale
        // notice from a previous run never lingers on screen during a new run.
        state.runSourceTruncated = false;
        state.runSourceAvailableRowCount = null;
        state.runTruncationNotice = null;
      })
      .addCase(submitPipelineRun.fulfilled, (state, action) => {
        // HEL-1483: ignore a run that no longer owns the run state (cleared on leaving it).
        if (state.runPipelineId !== action.meta.arg.pipelineId) return;
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
        if (state.runPipelineId !== action.meta.arg.pipelineId) return;
        state.runId = null;
        state.runStatus = null;
        state.runIsDry = null;
        state.runError = action.payload ?? "Failed to start pipeline run.";
      })
      .addCase(fetchPipelineRunHistory.pending, (state, action) => {
        const { pipelineId, openId } = action.meta.arg;
        state.runHistoryStatus[pipelineId] = "loading";
        state.runHistoryRequestId[pipelineId] = action.meta.requestId;
        state.runHistoryOpenId[pipelineId] = openId;
      })
      .addCase(fetchPipelineRunHistory.fulfilled, (state, action) => {
        const { pipelineId, openId } = action.meta.arg;
        if (state.runHistoryRequestId[pipelineId] !== action.meta.requestId) return;
        state.runHistory[pipelineId] = action.payload.records;
        state.runHistoryStatus[pipelineId] = "succeeded";
        state.runHistoryLoadedOpenId[pipelineId] = openId;
      })
      .addCase(fetchPipelineRunHistory.rejected, (state, action) => {
        const { pipelineId } = action.meta.arg;
        if (state.runHistoryRequestId[pipelineId] !== action.meta.requestId) return;
        state.runHistoryStatus[pipelineId] = "failed";
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

export const {
  clearRunState,
  setRunStatus,
  setCreatePipelineModalOpen,
  draftSaveRunPending,
  draftSaveRunSettled,
  pipelineStepsReplaced,
} = pipelinesSlice.actions;
export type { PipelinesState };
export const pipelinesReducer = pipelinesSlice.reducer;
