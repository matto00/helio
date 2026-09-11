import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  appendSourceRows,
  deleteSourceRow,
  fetchDatasetSchema,
  fetchSourceRows,
  patchSourceRow,
} from "../services/dataSourceService";
import type { DatasetSchemaResponse, RowListResponse, RowResponseRow } from "../types/dataSource";

// HEL-1080 design.md Decision 0a: a fixed page size for the row grid -- a UX/perf choice (a page
// stays single-viewport-scale), NOT a virtualization dodge (DatasetRowGrid's `variant="preview"`
// already structurally avoids virtualization regardless of page size, see task 5.8). Always
// passed explicitly on every `fetchDatasetRowsPage` call -- never the API's own default.
export const DATASET_GRID_PAGE_SIZE = 100;

/** One conflict record: the row id the user tried to edit/delete, and its current server-side
 *  value re-fetched on the 409 (design.md Decision 3). `deleted: true` means the row was absent
 *  from the re-fetched page (concurrently deleted by someone else) -- discard-only. */
export interface DatasetRowConflict {
  rowId: string;
  current: RowResponseRow | null;
  deleted: boolean;
  /** Which mutation produced this conflict -- drives the "delete anyway" vs. "retry" UI. */
  action: "edit" | "delete";
  /** skeptic-final-1.md CR4: which field the user's ORIGINAL edit touched, and what they typed --
   *  captured at the moment the 409 fired so Retry can reapply exactly that edit on top of the
   *  freshly re-fetched `current` row (design.md Decision 3: "re-applies only the user's edited
   *  cell(s)... never the user's full stale row"), rather than losing the user's intent entirely.
   *  Only ever set for `action: "edit"` conflicts -- a delete conflict has no edited value. */
  editedFieldIndex?: number;
  editedValue?: unknown;
}

interface DatasetRowsSourceState {
  schema: DatasetSchemaResponse | null;
  schemaStatus: "idle" | "loading" | "succeeded" | "failed";
  rows: RowResponseRow[];
  total: number;
  /** The CURRENT page's own `nextCursor`, as returned by the last `fetchDatasetRowsPage` --
   *  `undefined` at the end of the row set. Lets "Next" push+fetch directly without a wasteful
   *  refetch of the page already on screen just to learn its `nextCursor` again. */
  nextCursor: number | undefined;
  /** Stack of seen cursors (design.md Decision 0a) -- index 0 is the first page's absent cursor
   *  (`undefined`), "Next" pushes `nextCursor`, "Prev" pops. `cursorStack.length` is the 1-based
   *  current page number. */
  cursorStack: (number | undefined)[];
  rowsStatus: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  /** Keyed by rowId -- true while a patch/delete/append is in flight for that row (or "new" for
   *  an in-flight append not yet assigned a row id). */
  pending: Record<string, boolean>;
  conflicts: Record<string, DatasetRowConflict>;
}

interface DatasetRowsState {
  bySource: Record<string, DatasetRowsSourceState>;
}

const initialState: DatasetRowsState = { bySource: {} };

function emptySourceState(): DatasetRowsSourceState {
  return {
    schema: null,
    schemaStatus: "idle",
    rows: [],
    total: 0,
    nextCursor: undefined,
    cursorStack: [undefined],
    rowsStatus: "idle",
    error: null,
    pending: {},
    conflicts: {},
  };
}

/** Lazily creates a source's state slice on first access -- every reducer branch below (not just
 *  `.pending`) uses this, since a `.fulfilled`/`.rejected` can legitimately be the first action
 *  a given `sourceId` sees under a test dispatching actions directly (real usage always sees
 *  `.pending` first, but this keeps the reducer robust either way). */
function ensureSource(state: DatasetRowsState, sourceId: string): DatasetRowsSourceState {
  return state.bySource[sourceId] ?? (state.bySource[sourceId] = emptySourceState());
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (typeof data?.message === "string" && data.message) return data.message;
    if (typeof data?.error === "string" && data.error) return data.error;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export const fetchDatasetSchemaThunk = createAsyncThunk<
  { sourceId: string; schema: DatasetSchemaResponse },
  { sourceId: string }
>("datasetRows/fetchSchema", async ({ sourceId }) => {
  const schema = await fetchDatasetSchema(sourceId);
  return { sourceId, schema };
});

export const fetchDatasetRowsPage = createAsyncThunk<
  { sourceId: string; page: RowListResponse; cursor: number | undefined },
  { sourceId: string; cursor?: number }
>("datasetRows/fetchRowsPage", async ({ sourceId, cursor }) => {
  const page = await fetchSourceRows(sourceId, { cursor, limit: DATASET_GRID_PAGE_SIZE });
  return { sourceId, page, cursor };
});

/** skeptic-final-2.md CR-A: `patchRow`/`deleteRow` (`DataSourceService.scala`) map
 *  `RowMutationFailure.RowNotFound` to `ServiceError.NotFound` -> HTTP `404` -- a DIFFERENT case
 *  from `RowMutationFailure.StalePrecondition` -> `ServiceError.Conflict` -> `409`. A row deleted
 *  by someone else after the grid loaded it is genuinely GONE (404), not merely changed (409) --
 *  these must never be conflated, since 404 has no "current value" to show and no retry target. */
export interface RowMutationRejection {
  sourceId: string;
  rowId: string;
  conflict?: true;
  notFound?: true;
  /** skeptic-final-3.md now-required: a 404 on the ROW is "row already deleted" (discard-only,
   *  the existing recovery UI); a 404 on the SOURCE itself (`RowMutationFailure.SourceNotFound`
   *  -> `ServiceError.NotFound("Data source not found")`, same HTTP status, a DIFFERENT message)
   *  means the whole source is gone -- a different, more severe condition that "this row was
   *  deleted" would misrepresent. Both are 404 at the HTTP layer; only the response MESSAGE
   *  distinguishes them, since `DataSourceService.scala`'s `patchRow`/`deleteRow` map
   *  `SourceNotFound`/`RowNotFound` to the same status with different text. */
  sourceNotFound?: true;
  message: string;
}

function classifyRowMutationError(err: unknown): {
  conflict?: true;
  notFound?: true;
  sourceNotFound?: true;
} {
  if (!isAxiosError(err)) return {};
  if (err.response?.status === 409) return { conflict: true };
  if (err.response?.status === 404) {
    const message = (err.response?.data as { message?: string } | undefined)?.message;
    if (message === "Data source not found") return { sourceNotFound: true };
    return { notFound: true };
  }
  return {};
}

export const patchDatasetRow = createAsyncThunk<
  { sourceId: string; row: RowResponseRow },
  { sourceId: string; rowId: string; updatedAt: string; data: unknown[] },
  { rejectValue: RowMutationRejection }
>("datasetRows/patchRow", async ({ sourceId, rowId, updatedAt, data }, { rejectWithValue }) => {
  try {
    const resp = await patchSourceRow(sourceId, rowId, updatedAt, data);
    return { sourceId, row: resp.row };
  } catch (err) {
    return rejectWithValue({
      sourceId,
      rowId,
      ...classifyRowMutationError(err),
      message: extractErrorMessage(err, "Failed to save the edit."),
    });
  }
});

export const deleteDatasetRow = createAsyncThunk<
  { sourceId: string; rowId: string },
  { sourceId: string; rowId: string; updatedAt: string },
  { rejectValue: RowMutationRejection }
>("datasetRows/deleteRow", async ({ sourceId, rowId, updatedAt }, { rejectWithValue }) => {
  try {
    await deleteSourceRow(sourceId, rowId, updatedAt);
    return { sourceId, rowId };
  } catch (err) {
    return rejectWithValue({
      sourceId,
      rowId,
      ...classifyRowMutationError(err),
      message: extractErrorMessage(err, "Failed to delete the row."),
    });
  }
});

export const appendDatasetRow = createAsyncThunk<
  { sourceId: string },
  { sourceId: string; data: unknown[] },
  { rejectValue: { sourceId: string; message: string } }
>("datasetRows/appendRow", async ({ sourceId, data }, { rejectWithValue, dispatch }) => {
  try {
    await appendSourceRows(sourceId, [data]);
    // design.md Decision 0a / tasks.md 3.6: page forward to the last page so the user sees the
    // row they just added, following `nextCursor` until it's absent -- skeptic-final-2.md CR-C:
    // the stack is reset first (an append can shift page boundaries for every page after the
    // first) and each followed cursor is pushed, so `cursorStack.length` (the page label) and
    // Prev/Next's enabled state stay consistent with the page actually being shown.
    dispatch(resetCursorStack({ sourceId }));
    let cursor: number | undefined;
    for (;;) {
      const result = await dispatch(fetchDatasetRowsPage({ sourceId, cursor })).unwrap();
      if (result.page.nextCursor === undefined) break;
      cursor = result.page.nextCursor;
      dispatch(pushCursorStack({ sourceId, cursor }));
    }
    return { sourceId };
  } catch (err) {
    return rejectWithValue({
      sourceId,
      message: extractErrorMessage(err, "Failed to add the row."),
    });
  }
});

/** Re-fetches the row's current page (design.md Decision 3) after a 409, locates the row by id,
 *  and records the conflict -- present with its current data (retry target), or absent (deleted
 *  concurrently, discard-only). Always re-fetches using the CURRENT top of `cursorStack`, not
 *  page 1, so the user lands back where they were. */
export const refetchConflict = createAsyncThunk<
  {
    sourceId: string;
    rowId: string;
    action: "edit" | "delete";
    current: RowResponseRow | null;
    editedFieldIndex?: number;
    editedValue?: unknown;
  },
  {
    sourceId: string;
    rowId: string;
    action: "edit" | "delete";
    editedFieldIndex?: number;
    editedValue?: unknown;
  },
  { state: { datasetRows: DatasetRowsState } }
>(
  "datasetRows/refetchConflict",
  async ({ sourceId, rowId, action, editedFieldIndex, editedValue }, { getState }) => {
    const state = getState().datasetRows.bySource[sourceId];
    const cursor = state?.cursorStack[state.cursorStack.length - 1];
    const page = await fetchSourceRows(sourceId, { cursor, limit: DATASET_GRID_PAGE_SIZE });
    const current = page.rows.find((r) => r.id === rowId) ?? null;
    return { sourceId, rowId, action, current, editedFieldIndex, editedValue };
  },
);

const datasetRowsSlice = createSlice({
  name: "datasetRows",
  initialState,
  reducers: {
    /** Refresh (design.md Decision 8) resets to the pager's own current page -- callers dispatch
     *  `fetchDatasetRowsPage`/`fetchDatasetSchemaThunk` themselves using the current cursor; this
     *  action only clears a stale error/conflict banner. */
    clearConflict(state, action: PayloadAction<{ sourceId: string; rowId: string }>) {
      const src = state.bySource[action.payload.sourceId];
      if (src) delete src.conflicts[action.payload.rowId];
    },
    clearRowsError(state, action: PayloadAction<{ sourceId: string }>) {
      const src = state.bySource[action.payload.sourceId];
      if (src) src.error = null;
    },
    /** skeptic-final-2.md CR-A: a `404` on edit/delete means the row is genuinely GONE (HEL-1078
     *  D5: `RowMutationFailure.RowNotFound` -> `ServiceError.NotFound`) -- there is no "current
     *  value" to re-fetch and nothing to retry against, unlike a `409` stale-value conflict. This
     *  records the SAME `deleted: true` conflict shape `refetchConflict.fulfilled`'s absent-row
     *  branch already uses (so the existing "already deleted / Discard" UI renders unchanged),
     *  but synchronously -- no re-fetch is needed since the 404 itself is already conclusive. */
    markRowDeleted(
      state,
      action: PayloadAction<{ sourceId: string; rowId: string; action: "edit" | "delete" }>,
    ) {
      const src = ensureSource(state, action.payload.sourceId);
      src.conflicts[action.payload.rowId] = {
        rowId: action.payload.rowId,
        current: null,
        deleted: true,
        action: action.payload.action,
      };
      src.rows = src.rows.filter((r) => r.id !== action.payload.rowId);
      src.total = Math.max(0, src.total - 1);
    },
    /** Prev/Next pager navigation. `direction: "prev"` pops the stack; `"next"` pushes
     *  `nextCursor` (design.md Decision 0a) -- the caller dispatches `fetchDatasetRowsPage` with
     *  the resulting cursor separately; this only maintains the stack itself. */
    popCursorStack(state, action: PayloadAction<{ sourceId: string }>) {
      const src = state.bySource[action.payload.sourceId];
      if (src && src.cursorStack.length > 1) src.cursorStack.pop();
    },
    pushCursorStack(state, action: PayloadAction<{ sourceId: string; cursor: number }>) {
      ensureSource(state, action.payload.sourceId).cursorStack.push(action.payload.cursor);
    },
    /** skeptic-final-2.md CR-C: `appendDatasetRow` calls this before re-paging to the last page --
     *  an append can shift what "page N" even means for every page after the first, so the OLD
     *  stack must be discarded (back to just the first page's absent cursor) before rebuilding it
     *  from the fresh set of `nextCursor`s actually followed. */
    resetCursorStack(state, action: PayloadAction<{ sourceId: string }>) {
      ensureSource(state, action.payload.sourceId).cursorStack = [undefined];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDatasetSchemaThunk.pending, (state, action) => {
        ensureSource(state, action.meta.arg.sourceId).schemaStatus = "loading";
      })
      .addCase(fetchDatasetSchemaThunk.fulfilled, (state, action) => {
        const src = ensureSource(state, action.payload.sourceId);
        src.schema = action.payload.schema;
        src.schemaStatus = "succeeded";
      })
      .addCase(fetchDatasetSchemaThunk.rejected, (state, action) => {
        ensureSource(state, action.meta.arg.sourceId).schemaStatus = "failed";
      })
      .addCase(fetchDatasetRowsPage.pending, (state, action) => {
        ensureSource(state, action.meta.arg.sourceId).rowsStatus = "loading";
      })
      .addCase(fetchDatasetRowsPage.fulfilled, (state, action) => {
        const src = ensureSource(state, action.payload.sourceId);
        src.rows = action.payload.page.rows;
        src.total = action.payload.page.total;
        src.nextCursor = action.payload.page.nextCursor;
        src.rowsStatus = "succeeded";
        src.error = null;
      })
      .addCase(fetchDatasetRowsPage.rejected, (state, action) => {
        const src = ensureSource(state, action.meta.arg.sourceId);
        src.rowsStatus = "failed";
        src.error = extractErrorMessage(action.error, "Failed to load rows.");
      })
      .addCase(patchDatasetRow.pending, (state, action) => {
        ensureSource(state, action.meta.arg.sourceId).pending[action.meta.arg.rowId] = true;
      })
      .addCase(patchDatasetRow.fulfilled, (state, action) => {
        const src = ensureSource(state, action.payload.sourceId);
        delete src.pending[action.payload.row.id];
        delete src.conflicts[action.payload.row.id];
        const idx = src.rows.findIndex((r) => r.id === action.payload.row.id);
        if (idx !== -1) src.rows[idx] = action.payload.row;
      })
      .addCase(patchDatasetRow.rejected, (state, action) => {
        const payload = action.payload;
        if (!payload) return;
        const src = ensureSource(state, payload.sourceId);
        delete src.pending[payload.rowId];
        if (!payload.conflict && !payload.notFound) src.error = payload.message;
      })
      .addCase(deleteDatasetRow.pending, (state, action) => {
        ensureSource(state, action.meta.arg.sourceId).pending[action.meta.arg.rowId] = true;
      })
      .addCase(deleteDatasetRow.fulfilled, (state, action) => {
        const src = ensureSource(state, action.payload.sourceId);
        delete src.pending[action.payload.rowId];
        delete src.conflicts[action.payload.rowId];
        src.rows = src.rows.filter((r) => r.id !== action.payload.rowId);
        src.total = Math.max(0, src.total - 1);
      })
      .addCase(deleteDatasetRow.rejected, (state, action) => {
        const payload = action.payload;
        if (!payload) return;
        const src = ensureSource(state, payload.sourceId);
        delete src.pending[payload.rowId];
        if (!payload.conflict && !payload.notFound) src.error = payload.message;
      })
      .addCase(appendDatasetRow.rejected, (state, action) => {
        const payload = action.payload;
        if (!payload) return;
        ensureSource(state, payload.sourceId).error = payload.message;
      })
      .addCase(refetchConflict.fulfilled, (state, action) => {
        const src = ensureSource(state, action.payload.sourceId);
        src.conflicts[action.payload.rowId] = {
          rowId: action.payload.rowId,
          current: action.payload.current,
          deleted: action.payload.current === null,
          action: action.payload.action,
          editedFieldIndex: action.payload.editedFieldIndex,
          editedValue: action.payload.editedValue,
        };
        // skeptic-final-1.md CR4: write the freshly re-fetched row straight into `rows` so the
        // grid displays the CURRENT server value (not the stale one that produced the 409), and
        // so a Retry's precondition (`current.updatedAt`) matches what's actually rendered --
        // without this, a retry would keep re-conflicting against the same stale `updatedAt`.
        if (action.payload.current) {
          const idx = src.rows.findIndex((r) => r.id === action.payload.rowId);
          if (idx !== -1) src.rows[idx] = action.payload.current;
        } else {
          // Concurrently deleted -- nothing left to show or retry against; remove it outright
          // rather than leaving a phantom row the user could still try to act on.
          src.rows = src.rows.filter((r) => r.id !== action.payload.rowId);
          src.total = Math.max(0, src.total - 1);
        }
      });
  },
});

export const {
  clearConflict,
  clearRowsError,
  markRowDeleted,
  popCursorStack,
  pushCursorStack,
  resetCursorStack,
} = datasetRowsSlice.actions;
export const datasetRowsReducer = datasetRowsSlice.reducer;
export type { DatasetRowsSourceState };
