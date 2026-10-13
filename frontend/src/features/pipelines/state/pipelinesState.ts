import type { RequestErrorKind } from "../../../services/classifyRequestError";
import type {
  PipelineAnalyzeResponse,
  PipelineRunRecord,
  PipelineStep,
  PipelineSummary,
  RunStatus,
} from "../types/pipelineStep";
import type { PipelineSchedule } from "../types/pipelineSchedule";

export interface PipelinesState {
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
  // HEL-1354: per-pipeline bookkeeping for the run-history fetch (see `fetchPipelineRunHistory`).
  // `RequestId`/`OpenId` describe the LATEST request issued for the pipeline (latest-wins);
  // `LoadedOpenId` is the page-open token of the latest request that fulfilled — a record is
  // "fresh" for a page open only when it equals that open's token.
  runHistoryStatus: Record<string, "idle" | "loading" | "succeeded" | "failed">;
  runHistoryRequestId: Record<string, string>;
  runHistoryOpenId: Record<string, number>;
  runHistoryLoadedOpenId: Record<string, number>;
  currentPipeline: PipelineSummary | null;
  currentPipelineStatus: "idle" | "loading" | "succeeded" | "failed";
  // HEL-1483: the pipeline id the singleton `currentPipeline*` status/error describe — the id of
  // the LATEST `fetchPipelineById` request. A status or error belongs to the page only when this
  // equals the page's id, and a response for any other id is ignored (a late A can't land on B).
  currentPipelineRequestedId: string | null;
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
  // HEL-1483: the pipeline the current run state belongs to (set by `submitPipelineRun.pending`,
  // cleared by `clearRunState`). A run fulfilment/rejection for any other pipeline is ignored.
  runPipelineId: string | null;
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

export const initialState: PipelinesState = {
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
  runHistoryStatus: {},
  runHistoryRequestId: {},
  runHistoryOpenId: {},
  runHistoryLoadedOpenId: {},
  currentPipeline: null,
  currentPipelineStatus: "idle",
  currentPipelineRequestedId: null,
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
  runPipelineId: null,
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
