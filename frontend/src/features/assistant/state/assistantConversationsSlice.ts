import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  getConversation as getConversationRequest,
  listConversations as listConversationsRequest,
  updateConversation as updateConversationRequest,
} from "../services/assistantConversationsService";
import type { AssistantConversationDetail, AssistantConversationSummary } from "../types";

function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (typeof data?.error === "string" && data.error) return data.error;
    if (typeof data?.message === "string" && data.message) return data.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

interface AssistantConversationsState {
  items: AssistantConversationSummary[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  /** Explicit user selection (sidebar or MobileNavSheet). Null means "fall
   * back to the first item" — `ActiveConversationPanel` derives the
   * effective selection so the panel is never blank (design.md D4). */
  selectedConversationId: string | null;
  /** The selected conversation's full detail (including transcript),
   * fetched separately via `GET /:id` — distinct from `items`' summary-only
   * data (design.md D4). */
  activeConversation: {
    data: AssistantConversationDetail | null;
    status: "idle" | "loading" | "succeeded" | "failed";
    error: string | null;
  };
}

const initialState: AssistantConversationsState = {
  items: [],
  status: "idle",
  error: null,
  selectedConversationId: null,
  activeConversation: {
    data: null,
    status: "idle",
    error: null,
  },
};

export const fetchConversations = createAsyncThunk<
  AssistantConversationSummary[],
  void,
  { rejectValue: string }
>("assistantConversations/fetchConversations", async (_, { rejectWithValue }) => {
  try {
    return await listConversationsRequest();
  } catch {
    return rejectWithValue("Failed to load conversations.");
  }
});

/** Fetches a conversation's full detail (including transcript) — dispatched
 * whenever the effective selected id changes (design.md D4). */
export const selectConversation = createAsyncThunk<
  AssistantConversationDetail,
  string,
  { rejectValue: string }
>("assistantConversations/selectConversation", async (id, { rejectWithValue }) => {
  try {
    return await getConversationRequest(id);
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to load conversation."));
  }
});

export const togglePinned = createAsyncThunk<
  AssistantConversationSummary,
  { id: string; pinned: boolean },
  { rejectValue: string }
>("assistantConversations/togglePinned", async ({ id, pinned }, { rejectWithValue }) => {
  try {
    return await updateConversationRequest(id, { pinned });
  } catch {
    return rejectWithValue("Failed to update conversation.");
  }
});

const assistantConversationsSlice = createSlice({
  name: "assistantConversations",
  initialState,
  reducers: {
    setSelectedConversationId(state, action: { payload: string | null }) {
      state.selectedConversationId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchConversations.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchConversations.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(fetchConversations.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load conversations.";
      })
      .addCase(selectConversation.pending, (state) => {
        state.activeConversation.status = "loading";
        state.activeConversation.error = null;
      })
      .addCase(selectConversation.fulfilled, (state, action) => {
        state.activeConversation.data = action.payload;
        state.activeConversation.status = "succeeded";
        state.activeConversation.error = null;
      })
      .addCase(selectConversation.rejected, (state, action) => {
        state.activeConversation.status = "failed";
        state.activeConversation.error = action.payload ?? "Failed to load conversation.";
      })
      .addCase(togglePinned.fulfilled, (state, action) => {
        const idx = state.items.findIndex((c) => c.id === action.payload.id);
        if (idx !== -1) state.items[idx] = action.payload;
      });
  },
});

export const { setSelectedConversationId } = assistantConversationsSlice.actions;
export const assistantConversationsReducer = assistantConversationsSlice.reducer;
