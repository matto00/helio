import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  fetchSources as fetchSourcesRequest,
  deleteSource as deleteSourceRequest,
  createStaticSource as createStaticSourceRequest,
  inferSqlSource as inferSqlSourceRequest,
  createSqlSource as createSqlSourceRequest,
  type SqlSourceConfig,
} from "../../services/dataSourceService";
import type { DataSource, InferredField, StaticColumn } from "../../types/models";

function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (typeof data?.error === "string" && data.error) return data.error;
    if (typeof data?.message === "string" && data.message) return data.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

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

export const inferSqlSource = createAsyncThunk<
  InferredField[],
  SqlSourceConfig,
  { rejectValue: string }
>("sources/inferSqlSource", async (config, { rejectWithValue }) => {
  try {
    return await inferSqlSourceRequest(config);
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to connect to database."));
  }
});

export const createSqlSource = createAsyncThunk<
  DataSource,
  { name: string; config: SqlSourceConfig },
  { rejectValue: string }
>("sources/createSqlSource", async ({ name, config }, { rejectWithValue }) => {
  try {
    const result = await createSqlSourceRequest(name, config);
    return result.source;
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to create SQL source."));
  }
});

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

interface CreateStaticSourceArgs {
  name: string;
  columns: StaticColumn[];
  rows: unknown[][];
}

export const createStaticSource = createAsyncThunk<
  DataSource,
  CreateStaticSourceArgs,
  { rejectValue: string }
>("sources/createStaticSource", async ({ name, columns, rows }, { rejectWithValue }) => {
  try {
    return await createStaticSourceRequest(name, columns, rows);
  } catch {
    return rejectWithValue("Failed to create static source.");
  }
});

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
      })
      .addCase(createStaticSource.fulfilled, (state, action) => {
        state.items = [...state.items, action.payload];
      })
      .addCase(createSqlSource.fulfilled, (state, action) => {
        state.items = [...state.items, action.payload];
      });
  },
});

export const sourcesReducer = sourcesSlice.reducer;
