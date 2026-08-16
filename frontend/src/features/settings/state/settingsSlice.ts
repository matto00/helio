import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  clearAgentMemory as clearAgentMemoryRequest,
  deleteAgentMemoryEntry as deleteAgentMemoryEntryRequest,
  getPreferences,
  listAgentMemory,
  putPreferences,
} from "../services/settingsService";
import type { AgentMemoryEntry } from "../types/agentMemory";
import type { AgentPreferences, PutAgentPreferencesRequest } from "../types/preferences";

/** Matches `pipelinesSlice.ts`/`metricsSlice.ts`'s existing error-extraction
 *  pattern: the backend's `ErrorResponse(message)` always uses the `message`
 *  field name. Duplicated per-slice rather than extracted to a shared
 *  helper, matching existing house style. */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  return fallback;
}

type AsyncStatus = "idle" | "loading" | "succeeded" | "failed";

interface PreferencesState {
  data: AgentPreferences | null;
  status: AsyncStatus;
  error: string | null;
  saveStatus: AsyncStatus;
  saveError: string | null;
}

interface AgentMemoryState {
  items: AgentMemoryEntry[];
  status: AsyncStatus;
  error: string | null;
  /** Keyed by entry id — mirrors `pipelinesSlice.ts`'s per-id `stepsStatus`/
   *  `stepsError` shape so one entry's failed delete never clobbers
   *  another's in-flight state. */
  deleteStatus: Record<string, AsyncStatus>;
  deleteError: Record<string, string | null>;
  clearStatus: AsyncStatus;
  clearError: string | null;
}

/** design.md Decision 1: one `settingsSlice` holding preferences and agent
 *  memory as two sibling sub-trees, not two separate slices. */
interface SettingsState {
  preferences: PreferencesState;
  agentMemory: AgentMemoryState;
}

const initialState: SettingsState = {
  preferences: {
    data: null,
    status: "idle",
    error: null,
    saveStatus: "idle",
    saveError: null,
  },
  agentMemory: {
    items: [],
    status: "idle",
    error: null,
    deleteStatus: {},
    deleteError: {},
    clearStatus: "idle",
    clearError: null,
  },
};

export const fetchPreferences = createAsyncThunk<AgentPreferences, void, { rejectValue: string }>(
  "settings/fetchPreferences",
  async (_, { rejectWithValue }) => {
    try {
      return await getPreferences();
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to load preferences."));
    }
  },
);

/** Callers are responsible for sending the complete, merged object for every
 *  field they want preserved (design.md Decision 4) — this thunk is a thin
 *  passthrough to `putPreferences`. */
export const savePreferences = createAsyncThunk<
  AgentPreferences,
  PutAgentPreferencesRequest,
  { rejectValue: string }
>("settings/savePreferences", async (request, { rejectWithValue }) => {
  try {
    return await putPreferences(request);
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to save preferences."));
  }
});

export const fetchAgentMemory = createAsyncThunk<AgentMemoryEntry[], void, { rejectValue: string }>(
  "settings/fetchAgentMemory",
  async (_, { rejectWithValue }) => {
    try {
      return await listAgentMemory();
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to load agent memory."));
    }
  },
);

export const deleteAgentMemoryEntryThunk = createAsyncThunk<
  string,
  string,
  { rejectValue: string }
>("settings/deleteAgentMemoryEntry", async (id, { rejectWithValue }) => {
  try {
    await deleteAgentMemoryEntryRequest(id);
    return id;
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to delete memory entry."));
  }
});

export const clearAgentMemoryThunk = createAsyncThunk<void, void, { rejectValue: string }>(
  "settings/clearAgentMemory",
  async (_, { rejectWithValue }) => {
    try {
      await clearAgentMemoryRequest();
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to clear agent memory."));
    }
  },
);

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // fetchPreferences
      .addCase(fetchPreferences.pending, (state) => {
        state.preferences.status = "loading";
        state.preferences.error = null;
      })
      .addCase(fetchPreferences.fulfilled, (state, action) => {
        state.preferences.data = action.payload;
        state.preferences.status = "succeeded";
        state.preferences.error = null;
      })
      .addCase(fetchPreferences.rejected, (state, action) => {
        state.preferences.status = "failed";
        state.preferences.error = action.payload ?? "Failed to load preferences.";
      })
      // savePreferences
      .addCase(savePreferences.pending, (state) => {
        state.preferences.saveStatus = "loading";
        state.preferences.saveError = null;
      })
      .addCase(savePreferences.fulfilled, (state, action) => {
        state.preferences.data = action.payload;
        state.preferences.saveStatus = "succeeded";
        state.preferences.saveError = null;
      })
      .addCase(savePreferences.rejected, (state, action) => {
        state.preferences.saveStatus = "failed";
        state.preferences.saveError = action.payload ?? "Failed to save preferences.";
      })
      // fetchAgentMemory
      .addCase(fetchAgentMemory.pending, (state) => {
        state.agentMemory.status = "loading";
        state.agentMemory.error = null;
      })
      .addCase(fetchAgentMemory.fulfilled, (state, action) => {
        state.agentMemory.items = action.payload;
        state.agentMemory.status = "succeeded";
        state.agentMemory.error = null;
      })
      .addCase(fetchAgentMemory.rejected, (state, action) => {
        state.agentMemory.status = "failed";
        state.agentMemory.error = action.payload ?? "Failed to load agent memory.";
      })
      // deleteAgentMemoryEntryThunk
      .addCase(deleteAgentMemoryEntryThunk.pending, (state, action) => {
        const id = action.meta.arg;
        state.agentMemory.deleteStatus[id] = "loading";
        state.agentMemory.deleteError[id] = null;
      })
      .addCase(deleteAgentMemoryEntryThunk.fulfilled, (state, action) => {
        const id = action.payload;
        state.agentMemory.items = state.agentMemory.items.filter((entry) => entry.id !== id);
        state.agentMemory.deleteStatus[id] = "succeeded";
        state.agentMemory.deleteError[id] = null;
      })
      .addCase(deleteAgentMemoryEntryThunk.rejected, (state, action) => {
        const id = action.meta.arg;
        state.agentMemory.deleteStatus[id] = "failed";
        state.agentMemory.deleteError[id] = action.payload ?? "Failed to delete memory entry.";
      })
      // clearAgentMemoryThunk
      .addCase(clearAgentMemoryThunk.pending, (state) => {
        state.agentMemory.clearStatus = "loading";
        state.agentMemory.clearError = null;
      })
      .addCase(clearAgentMemoryThunk.fulfilled, (state) => {
        state.agentMemory.items = [];
        state.agentMemory.clearStatus = "succeeded";
        state.agentMemory.clearError = null;
      })
      .addCase(clearAgentMemoryThunk.rejected, (state, action) => {
        state.agentMemory.clearStatus = "failed";
        state.agentMemory.clearError = action.payload ?? "Failed to clear agent memory.";
      });
  },
});

export type { SettingsState };
export const settingsReducer = settingsSlice.reducer;
