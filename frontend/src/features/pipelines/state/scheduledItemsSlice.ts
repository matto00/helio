import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import { clearAuth } from "../../auth/state/authSlice";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { fetchPipelineScheduleList } from "../services/pipelineScheduleListService";
import type { PipelineScheduleList } from "../types/pipelineSchedule";

/** A revisit within this window reuses the loaded list instead of refetching. */
export const SCHEDULED_ITEMS_MAX_AGE_MS = 60_000;

export interface ScheduledItemsState extends PipelineScheduleList {
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  fetchedAt: number | null;
}

const initialState: ScheduledItemsState = {
  items: [],
  sources: [],
  status: "idle",
  error: null,
  fetchedAt: null,
};

type ScheduledRoot = { scheduledItems: ScheduledItemsState };

/** One shared fetch for both the Pipelines and the Sources context lists (`GET /api/pipeline-schedules`). */
export const fetchScheduledItems = createAsyncThunk<
  PipelineScheduleList & { fetchedAt: number },
  void,
  { state: ScheduledRoot; rejectValue: string }
>(
  "scheduledItems/fetch",
  async (_, { rejectWithValue }) => {
    try {
      return { ...(await fetchPipelineScheduleList()), fetchedAt: Date.now() };
    } catch (err) {
      return rejectWithValue(extractErrorMessage(err, "Failed to load scheduled items."));
    }
  },
  {
    condition: (_, { getState }) => {
      const { status, fetchedAt } = getState().scheduledItems;
      if (status === "loading") return false;
      if (status === "idle" || status === "failed" || fetchedAt === null) return true;
      return Date.now() - fetchedAt > SCHEDULED_ITEMS_MAX_AGE_MS;
    },
  },
);

const scheduledItemsSlice = createSlice({
  name: "scheduledItems",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(clearAuth, () => initialState)
      .addCase(fetchScheduledItems.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchScheduledItems.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.items = action.payload.items;
        state.sources = action.payload.sources;
        state.fetchedAt = action.payload.fetchedAt;
      })
      .addCase(fetchScheduledItems.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load scheduled items.";
      });
  },
});

export const scheduledItemsReducer = scheduledItemsSlice.reducer;
