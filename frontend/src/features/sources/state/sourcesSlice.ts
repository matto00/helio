import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  fetchSources as fetchSourcesRequest,
  deleteSource as deleteSourceRequest,
  createStaticSource as createStaticSourceRequest,
  inferSqlSource as inferSqlSourceRequest,
  createSqlSource as createSqlSourceRequest,
  updateSource as updateSourceRequest,
} from "../services/dataSourceService";
import {
  classifyRequestError,
  type RequestErrorKind,
} from "../../../services/classifyRequestError";
import type { DataSource, InferredField, SqlSourceConfig, StaticColumn } from "../types/dataSource";

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
  errorKind: RequestErrorKind | null;
  /** Explicit user selection in the sidebar. Null means "fall back to first
   * item" — the page derives the effective selection so it's never blank. */
  selectedSourceId: string | null;
  /** Open/closed state for the AddSourceModal, dispatched from the sidebar so
   * the + button there can open the modal without prop-drilling. */
  addModalOpen: boolean;
}

const initialState: SourcesState = {
  items: [],
  status: "idle",
  error: null,
  errorKind: null,
  selectedSourceId: null,
  addModalOpen: false,
};

export const fetchSources = createAsyncThunk<
  DataSource[],
  void,
  { rejectValue: { message: string; kind: RequestErrorKind } }
>("sources/fetchSources", async (_, { rejectWithValue }) => {
  try {
    return await fetchSourcesRequest();
  } catch (err: unknown) {
    return rejectWithValue(classifyRequestError(err, "Failed to load sources."));
  }
});

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

/** HEL-989 / HEL-1252: `DELETE /api/data-sources/:id` answers 409 when ANY persisted config still references the
 *  source (pipeline root, join/lookup/union input, upsert target, form-panel binding). Kept as a structured
 *  rejection (not the generic string) so the UI can name the referencing resources and link to them;
 *  `pipelines`/`panels` list only those the caller may see (possibly empty); references the caller cannot see
 *  arrive only as the counts `hiddenPipelineCount`/`hiddenPanelCount`. Older servers omit `panels`/`references`
 *  (parse as empty) and the counts (parse as `undefined`). The notice falls back to `message` only when the body
 *  has no named references AND no structured counts; with absent counts plus a named reference the hidden mention
 *  is dropped (a deploy-skew limitation). */
export interface SourceDeleteConflict {
  kind: "conflict";
  message: string;
  pipelines: { id: string; name: string; references: string[] }[];
  panels: { id: string; title: string; dashboardId: string; dashboardName: string }[];
  /** Referencing resources the caller cannot see -- COUNTS only, never an identity. `undefined` = an older server
   *  that sends no structured counts (the notice falls back to `message` only if nothing is named either). */
  hiddenPipelineCount?: number;
  hiddenPanelCount?: number;
}

export function isSourceDeleteConflict(value: unknown): value is SourceDeleteConflict {
  return (
    typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "conflict"
  );
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseDeleteConflict(err: unknown): SourceDeleteConflict | null {
  if (!isAxiosError(err) || err.response?.status !== 409) return null;
  const data = err.response.data as
    | {
        message?: unknown;
        pipelines?: unknown;
        panels?: unknown;
        hiddenPipelineCount?: unknown;
        hiddenPanelCount?: unknown;
      }
    | undefined;
  const pipelines = Array.isArray(data?.pipelines)
    ? (data.pipelines as unknown[]).flatMap((p) => {
        const entry = p as { id?: unknown; name?: unknown; references?: unknown };
        if (typeof entry?.id !== "string" || typeof entry?.name !== "string") return [];
        const references = Array.isArray(entry.references)
          ? entry.references.filter((r): r is string => typeof r === "string")
          : [];
        return [{ id: entry.id, name: entry.name, references }];
      })
    : [];
  const panels = Array.isArray(data?.panels)
    ? (data.panels as unknown[]).flatMap((p) => {
        const entry = p as {
          id?: unknown;
          title?: unknown;
          dashboardId?: unknown;
          dashboardName?: unknown;
        };
        return typeof entry?.id === "string" &&
          typeof entry?.title === "string" &&
          typeof entry?.dashboardId === "string" &&
          typeof entry?.dashboardName === "string"
          ? [
              {
                id: entry.id,
                title: entry.title,
                dashboardId: entry.dashboardId,
                dashboardName: entry.dashboardName,
              },
            ]
          : [];
      })
    : [];
  return {
    kind: "conflict",
    message:
      typeof data?.message === "string" && data.message
        ? data.message
        : "This source is still referenced by a pipeline or panel.",
    pipelines,
    panels,
    hiddenPipelineCount: count(data?.hiddenPipelineCount),
    hiddenPanelCount: count(data?.hiddenPanelCount),
  };
}

export const deleteSource = createAsyncThunk<
  string,
  string,
  { rejectValue: string | SourceDeleteConflict }
>("sources/deleteSource", async (sourceId, { rejectWithValue }) => {
  try {
    await deleteSourceRequest(sourceId);
    return sourceId;
  } catch (err) {
    return rejectWithValue(parseDeleteConflict(err) ?? "Failed to delete source.");
  }
});

export const updateSource = createAsyncThunk<
  DataSource,
  { id: string; name: string },
  { rejectValue: string }
>("sources/updateSource", async ({ id, name }, { rejectWithValue }) => {
  try {
    return await updateSourceRequest(id, name);
  } catch {
    return rejectWithValue("Failed to update source.");
  }
});

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
  reducers: {
    setSelectedSourceId(state, action: { payload: string | null }) {
      state.selectedSourceId = action.payload;
    },
    setAddSourceModalOpen(state, action: { payload: boolean }) {
      state.addModalOpen = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSources.pending, (state) => {
        state.status = "loading";
        state.error = null;
        state.errorKind = null;
      })
      .addCase(fetchSources.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
        state.errorKind = null;
      })
      .addCase(fetchSources.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload?.message ?? "Failed to load sources.";
        state.errorKind = action.payload?.kind ?? "error";
      })
      .addCase(deleteSource.fulfilled, (state, action) => {
        state.items = state.items.filter((s) => s.id !== action.payload);
      })
      .addCase(createStaticSource.fulfilled, (state, action) => {
        state.items = [...state.items, action.payload];
      })
      .addCase(createSqlSource.fulfilled, (state, action) => {
        state.items = [...state.items, action.payload];
      })
      .addCase(updateSource.fulfilled, (state, action) => {
        const idx = state.items.findIndex((s) => s.id === action.payload.id);
        if (idx !== -1) state.items[idx] = action.payload;
      });
  },
});

export const { setSelectedSourceId, setAddSourceModalOpen } = sourcesSlice.actions;
export const sourcesReducer = sourcesSlice.reducer;
