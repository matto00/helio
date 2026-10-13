import { createAsyncThunk } from "@reduxjs/toolkit";
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
} from "../types/pipelineStep";
import type { PipelineProposal, PipelineProposalApplyResponse } from "../types/pipelineProposal";

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

/** `openId` identifies one page open (see `useRunHistory`); `force` bypasses the in-flight dedupe. */
export interface FetchRunHistoryArg {
  pipelineId: string;
  openId: number;
  force?: boolean;
}

/**
 * HEL-1354: dedupes on (pipelineId, openId). A request for the SAME pipeline and the SAME page open
 * that is already in flight is skipped, which collapses React StrictMode's dev-only effect
 * double-invoke into one GET; a different pipeline or a different page open is never deduped
 * against it. `force` (post-run refreshes) always goes out. `fulfilled`/`rejected` apply only when
 * their request is the latest one issued for the pipeline, so an older response can never overwrite
 * a newer one.
 */
export const fetchPipelineRunHistory = createAsyncThunk<
  { pipelineId: string; records: PipelineRunRecord[] },
  FetchRunHistoryArg,
  { state: RootState; rejectValue: string }
>(
  "pipelines/fetchPipelineRunHistory",
  async ({ pipelineId }, { rejectWithValue }) => {
    try {
      const records = await fetchRunHistory(pipelineId);
      return { pipelineId, records };
    } catch {
      return rejectWithValue("Failed to load run history.");
    }
  },
  {
    condition: ({ pipelineId, openId, force }, { getState }) => {
      if (force === true) return true;
      const { runHistoryStatus, runHistoryOpenId } = getState().pipelines;
      return !(
        runHistoryStatus[pipelineId] === "loading" && runHistoryOpenId[pipelineId] === openId
      );
    },
  },
);

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
