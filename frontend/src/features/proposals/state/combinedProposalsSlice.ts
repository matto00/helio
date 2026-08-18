import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import { dashboardUpserted, setSelectedDashboardId } from "../../dashboards/state/dashboardsSlice";
import { applyCombinedProposal as applyCombinedProposalRequest } from "../services/combinedProposalService";
import type { CombinedProposal, CombinedProposalApplyResponse } from "../types/combinedProposal";

interface CombinedProposalsState {
  applying: boolean;
  error: string | null;
}

const initialState: CombinedProposalsState = {
  applying: false,
  error: null,
};

/** Apply an accepted combined proposal (HEL-387's existing endpoint,
 *  design.md D7). Unlike `pipelinesSlice.applyPipelineProposal` (a
 *  pipeline-only apply never touches any cached dashboard state), a
 *  successful combined apply mints a brand-new dashboard that
 *  `PanelList.tsx` (the `/` route) must show immediately — so this thunk
 *  dispatches BOTH `dashboardUpserted` (inserts it into `state.items`) AND
 *  `setSelectedDashboardId` (actually selects it). `dashboardUpserted` alone
 *  does NOT select the new dashboard (skeptic round 1 CR1 fix) — mirrors
 *  `dashboardsSlice.applyProposal.fulfilled`'s own identical two-part
 *  update for the standalone dashboard-only apply path. */
export const applyCombinedProposal = createAsyncThunk<
  CombinedProposalApplyResponse,
  CombinedProposal,
  { rejectValue: string }
>("combinedProposals/applyCombinedProposal", async (proposal, { dispatch, rejectWithValue }) => {
  try {
    const response = await applyCombinedProposalRequest(proposal);
    dispatch(dashboardUpserted(response.dashboard.dashboard));
    dispatch(setSelectedDashboardId(response.dashboard.dashboard.id));
    return response;
  } catch (err) {
    const serverMessage =
      isAxiosError(err) && typeof err.response?.data?.message === "string"
        ? err.response.data.message
        : null;
    return rejectWithValue(serverMessage ?? "Failed to apply the combined proposal.");
  }
});

const combinedProposalsSlice = createSlice({
  name: "combinedProposals",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(applyCombinedProposal.pending, (state) => {
        state.applying = true;
        state.error = null;
      })
      .addCase(applyCombinedProposal.fulfilled, (state) => {
        state.applying = false;
      })
      .addCase(applyCombinedProposal.rejected, (state, action) => {
        state.applying = false;
        state.error = action.payload ?? "Failed to apply the combined proposal.";
      });
  },
});

export const combinedProposalsReducer = combinedProposalsSlice.reducer;
