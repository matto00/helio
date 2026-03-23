import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import {
  fetchSources as fetchSourcesRequest,
  deleteSource as deleteSourceRequest,
} from "../../services/dataSourceService";
import type { DataSource } from "../../types/models";

interface SourcesState {
  items: DataSource[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
}

const initialState: SourcesState = {
  items: [],
  status: "idle",
  error: null,
};

export const fetchSources = createAsyncThunk<DataSource[], void, { rejectValue: string }>(
  "sources/fetchSources",
  async (_, { rejectWithValue }) => {
    try {
      return await fetchSourcesRequest();
    } catch {
      return rejectWithValue("Failed to load sources.");
    }
  },
);

export const deleteSource = createAsyncThunk<string, string, { rejectValue: string }>(
  "sources/deleteSource",
  async (sourceId, { rejectWithValue }) => {
    try {
      await deleteSourceRequest(sourceId);
      return sourceId;
    } catch {
      return rejectWithValue("Failed to delete source.");
    }
  },
);

const sourcesSlice = createSlice({
  name: "sources",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSources.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchSources.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(fetchSources.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load sources.";
      })
      .addCase(deleteSource.fulfilled, (state, action) => {
        state.items = state.items.filter((s) => s.id !== action.payload);
      });
  },
});

export const sourcesReducer = sourcesSlice.reducer;
