import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import { clearAuth } from "../../auth/state/authSlice";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { setServerOffsetMs } from "../../dashboards/tabs/serverClock";
import { MAX_TABS } from "../../dashboards/tabs/tabTypes";
import { dashboardSeenStore } from "../../commandPalette/model/dashboardSeenStore";
import { fetchHomeSummary } from "../services/homeService";
import type { HomeSummary } from "../types/homeSummary";

export interface HomeSummaryState {
  /** `loading` only before the first data; a refetch keeps `succeeded` so the page never flashes skeletons. */
  status: "idle" | "loading" | "succeeded" | "failed";
  data: HomeSummary | null;
  error: string | null;
  /** True while a request is in flight: a second dispatch (StrictMode's double effect, a visibility flip during a
   *  Retry refetch) is skipped, so the page makes one request at a time. */
  inFlight: boolean;
  /** A refetch asked for while one was in flight (a Retry's, which must land after its run): `HomePage` runs one
   *  trailing request once the current one settles, so the list never stays on the pre-run state. */
  refetchQueued: boolean;
  /** `Date.now()` when `data` arrived; with `data.serverNow` it gives the client's offset from server time. */
  receivedAt: number | null;
}

const initialState: HomeSummaryState = {
  status: "idle",
  data: null,
  error: null,
  inFlight: false,
  refetchQueued: false,
  receivedAt: null,
};

export interface LoadHomeSummaryArg {
  /** When a request is already in flight, queue one trailing refetch instead of dropping this one. */
  queueIfBusy?: boolean;
}

/** The dashboards whose change times Home asks for: those the user has viewed (a view stamp exists), newest view
 *  first, at most 20 (the server's cap, shared with HEL-1575's tab cap). A dashboard never viewed has no dot. */
function viewedDashboardIds(): string[] {
  return Object.entries(dashboardSeenStore.getAll())
    .filter(([, seen]) => seen.viewedAt !== undefined)
    .sort(([, a], [, b]) => (b.viewedAt ?? 0) - (a.viewedAt ?? 0))
    .slice(0, MAX_TABS)
    .map(([id]) => id);
}

export const loadHomeSummary = createAsyncThunk<
  { data: HomeSummary; receivedAt: number },
  LoadHomeSummaryArg | void,
  { rejectValue: string; state: { homeSummary: HomeSummaryState } }
>(
  "homeSummary/load",
  async (_, { rejectWithValue }) => {
    try {
      const data = await fetchHomeSummary(viewedDashboardIds());
      const receivedAt = Date.now();
      setServerOffsetMs(Date.parse(data.serverNow) - receivedAt);
      return { data, receivedAt };
    } catch (err) {
      return rejectWithValue(extractErrorMessage(err, "Failed to load pipeline activity."));
    }
  },
  {
    condition: (_, { getState }) => !getState().homeSummary.inFlight,
    dispatchConditionRejection: true,
  },
);

const homeSummarySlice = createSlice({
  name: "homeSummary",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadHomeSummary.pending, (state) => {
        state.inFlight = true;
        state.refetchQueued = false;
        if (state.data === null) state.status = "loading";
        state.error = null;
      })
      .addCase(loadHomeSummary.fulfilled, (state, action) => {
        state.inFlight = false;
        state.status = "succeeded";
        state.data = action.payload.data;
        state.receivedAt = action.payload.receivedAt;
        state.error = null;
      })
      .addCase(loadHomeSummary.rejected, (state, action) => {
        if (action.meta.condition) {
          // Skipped because a request is in flight: remember a refetch that must not be lost.
          if (action.meta.arg?.queueIfBusy === true) state.refetchQueued = true;
          return;
        }
        state.inFlight = false;
        // A failed refetch keeps the last good data on screen; only a first load shows the error state.
        if (state.data === null) state.status = "failed";
        state.error = action.payload ?? "Failed to load pipeline activity.";
      })
      .addCase(clearAuth, () => initialState);
  },
});

export const homeSummaryReducer = homeSummarySlice.reducer;
