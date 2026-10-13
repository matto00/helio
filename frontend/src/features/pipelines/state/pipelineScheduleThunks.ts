import { createAsyncThunk } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  getPipelineSchedule,
  putPipelineSchedule,
  deletePipelineSchedule as deletePipelineScheduleRequest,
} from "../services/pipelineService";
import type { PipelineSchedule, PutPipelineScheduleRequest } from "../types/pipelineSchedule";

/** Matches `dashboardsSlice.ts` / `sourcesSlice.ts`'s existing error-extraction
 *  pattern (design D4): the backend's `ErrorResponse(message)` always uses the
 *  `message` field name. */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  return fallback;
}

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
