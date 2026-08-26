import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import { fetchAuditEvents as fetchAuditEventsRequest } from "../services/auditEventService";
import type { AuditEvent } from "../types/auditEvent";

/** Matches `metricsSlice.ts`/`pipelinesSlice.ts`'s existing error-extraction
 *  pattern: the backend's `ErrorResponse(message)` always uses the `message`
 *  field name. Duplicated per-slice rather than extracted to a shared
 *  helper, matching existing house style (design.md D2). */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  return fallback;
}

interface AuditEventsState {
  items: AuditEvent[];
  total: number;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
}

const initialState: AuditEventsState = {
  items: [],
  total: 0,
  status: "idle",
  error: null,
};

/** v1 scope: first-page-only, no filters, no "load more" (design.md
 *  Decision 6b) — this thunk always fetches `Page.Default` (offset 0, no
 *  filters). `total` (from the response envelope) drives the "showing
 *  latest N of TOTAL" caption so truncation past the first page is visible
 *  rather than silent. */
export const fetchAuditEvents = createAsyncThunk<
  { items: AuditEvent[]; total: number },
  void,
  { rejectValue: string }
>("auditEvents/fetchAuditEvents", async (_, { rejectWithValue }) => {
  try {
    const result = await fetchAuditEventsRequest();
    return { items: result.items, total: result.total };
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to load audit history."));
  }
});

const auditEventsSlice = createSlice({
  name: "auditEvents",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAuditEvents.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchAuditEvents.fulfilled, (state, action) => {
        state.items = action.payload.items;
        state.total = action.payload.total;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(fetchAuditEvents.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load audit history.";
      });
  },
});

export type { AuditEventsState };
export const auditEventsReducer = auditEventsSlice.reducer;
