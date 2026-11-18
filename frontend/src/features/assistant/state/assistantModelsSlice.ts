import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import { fetchAssistantModels as fetchAssistantModelsRequest } from "../services/assistantConversationsService";
import type { AssistantModelsResponse } from "../types";

/** HEL-1755 D10: the picker's source of truth for WHICH models exist (and the server default and the caller's
 *  resolved default for a new conversation). It holds no rule: which model a conversation uses is the server's
 *  `effectiveModel`, never derived here. */
interface AssistantModelsState {
  status: "idle" | "loading" | "succeeded" | "failed";
  data: AssistantModelsResponse | null;
}

const initialState: AssistantModelsState = { status: "idle", data: null };

export const fetchAssistantModels = createAsyncThunk<AssistantModelsResponse, void>(
  "assistantModels/fetch",
  async () => fetchAssistantModelsRequest(),
);

const assistantModelsSlice = createSlice({
  name: "assistantModels",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAssistantModels.pending, (state) => {
        // Keep the previous list while a refetch (after a Settings save) is in flight.
        state.status = "loading";
      })
      .addCase(fetchAssistantModels.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.data = action.payload;
      })
      .addCase(fetchAssistantModels.rejected, (state) => {
        state.status = "failed";
      });
  },
});

export const assistantModelsReducer = assistantModelsSlice.reducer;
