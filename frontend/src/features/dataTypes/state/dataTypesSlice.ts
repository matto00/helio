import { createAsyncThunk, createSelector, createSlice } from "@reduxjs/toolkit";

import {
  fetchDataTypes as fetchDataTypesRequest,
  updateDataType as updateDataTypeRequest,
  deleteDataType as deleteDataTypeRequest,
  fetchAssertionStatus as fetchAssertionStatusRequest,
} from "../services/dataTypeService";
import {
  classifyRequestError,
  type RequestErrorKind,
} from "../../../services/classifyRequestError";
import type { ComputedField, DataType, DataTypeField } from "../types/dataType";
import type { RootState } from "../../../store/store";

interface DataTypesState {
  items: DataType[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  errorKind: RequestErrorKind | null;
  /** Explicit user selection in the sidebar. Null means "fall back to first
   * item" — the page derives the effective selection so it's never blank. */
  selectedTypeId: string | null;
  /** HEL-576: per-DataType assertion-status cache (design.md Decision 8) —
   * `undefined` means "not yet fetched"; `fetchAssertionStatus`'s `condition`
   * uses `assertionStatusPendingIds` (below) to dedupe in-flight fetches. */
  assertionStatusByDataTypeId: Record<
    string,
    { invalid: boolean; failedRuleCount: number } | undefined
  >;
  assertionStatusPendingIds: Record<string, boolean>;
}

const initialState: DataTypesState = {
  items: [],
  status: "idle",
  error: null,
  errorKind: null,
  selectedTypeId: null,
  assertionStatusByDataTypeId: {},
  assertionStatusPendingIds: {},
};

export const updateDataType = createAsyncThunk<
  DataType,
  { id: string; name?: string; fields: DataTypeField[]; computedFields?: ComputedField[] },
  { rejectValue: string }
>("dataTypes/updateDataType", async ({ id, name, fields, computedFields }, { rejectWithValue }) => {
  try {
    return await updateDataTypeRequest(id, fields, computedFields, name);
  } catch {
    return rejectWithValue("Failed to update data type.");
  }
});

export const deleteDataType = createAsyncThunk<string, string, { rejectValue: string }>(
  "dataTypes/deleteDataType",
  async (id, { rejectWithValue }) => {
    try {
      await deleteDataTypeRequest(id);
      return id;
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "response" in err) {
        const axiosErr = err as { response?: { status?: number; data?: { message?: string } } };
        if (axiosErr.response?.status === 409) {
          const msg =
            axiosErr.response.data?.message ??
            "One or more panels are bound to this type. Unbind them before deleting.";
          return rejectWithValue(msg);
        }
      }
      return rejectWithValue("Failed to delete data type.");
    }
  },
);

export const fetchDataTypes = createAsyncThunk<
  DataType[],
  void,
  { rejectValue: { message: string; kind: RequestErrorKind } }
>("dataTypes/fetchDataTypes", async (_, { rejectWithValue }) => {
  try {
    return await fetchDataTypesRequest();
  } catch (err: unknown) {
    return rejectWithValue(classifyRequestError(err, "Failed to load data types."));
  }
});

/** HEL-576 (design.md Decision 8): fetches once per distinct `dataTypeId` —
 * a no-op via `condition` when the status is already cached or a fetch is
 * already in flight, so N panels bound to the same DataType share one
 * request. */
export const fetchAssertionStatus = createAsyncThunk<
  { dataTypeId: string; invalid: boolean; failedRuleCount: number },
  string,
  { state: RootState; rejectValue: string }
>(
  "dataTypes/fetchAssertionStatus",
  async (dataTypeId, { rejectWithValue }) => {
    try {
      return await fetchAssertionStatusRequest(dataTypeId);
    } catch {
      return rejectWithValue("Failed to load assertion status.");
    }
  },
  {
    condition: (dataTypeId, { getState }) => {
      const { dataTypes } = getState();
      if (dataTypes.assertionStatusPendingIds[dataTypeId]) return false;
      if (dataTypes.assertionStatusByDataTypeId[dataTypeId] !== undefined) return false;
      return true;
    },
  },
);

const dataTypesSlice = createSlice({
  name: "dataTypes",
  initialState,
  reducers: {
    setSelectedTypeId(state, action: { payload: string | null }) {
      state.selectedTypeId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDataTypes.pending, (state) => {
        state.status = "loading";
        state.error = null;
        state.errorKind = null;
      })
      .addCase(fetchDataTypes.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
        state.errorKind = null;
      })
      .addCase(fetchDataTypes.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload?.message ?? "Failed to load data types.";
        state.errorKind = action.payload?.kind ?? "error";
      })
      .addCase(updateDataType.fulfilled, (state, action) => {
        const idx = state.items.findIndex((dt) => dt.id === action.payload.id);
        if (idx !== -1) state.items[idx] = action.payload;
      })
      .addCase(deleteDataType.fulfilled, (state, action) => {
        state.items = state.items.filter((dt) => dt.id !== action.payload);
      })
      .addCase(fetchAssertionStatus.pending, (state, action) => {
        state.assertionStatusPendingIds[action.meta.arg] = true;
      })
      .addCase(fetchAssertionStatus.fulfilled, (state, action) => {
        state.assertionStatusPendingIds[action.meta.arg] = false;
        state.assertionStatusByDataTypeId[action.payload.dataTypeId] = {
          invalid: action.payload.invalid,
          failedRuleCount: action.payload.failedRuleCount,
        };
      })
      .addCase(fetchAssertionStatus.rejected, (state, action) => {
        state.assertionStatusPendingIds[action.meta.arg] = false;
      });
  },
});

export const { setSelectedTypeId } = dataTypesSlice.actions;
export const dataTypesReducer = dataTypesSlice.reducer;

// --- Selectors ---

/** DataTypes produced by a pipeline (`sourceId === null`) — the only DataTypes
 * a panel may bind to, and the only ones surfaced in user-facing type lists
 * (BindingEditor, panel-creation DataType step, Type Registry). Companion
 * DataTypes (`sourceId != null`, auto-created at source registration) are
 * internal source-schema records and are filtered out here. Memoized on
 * `state.dataTypes.items` so the filtered array keeps a stable reference while
 * the input is unchanged — this lets React-Redux render bailout succeed and
 * suppresses the "selector returned a different result" warning across the
 * bound editors and other consumers (HEL-312). */
export const selectPipelineOutputDataTypes: (state: RootState) => DataType[] = createSelector(
  (state: RootState) => state.dataTypes.items,
  (items) => items.filter((dt) => dt.sourceId === null),
);

/** HEL-576: `true` when `dataTypeId`'s cached assertion status reports
 * `invalid: true`; `false` when unbound, valid, or not yet fetched — the
 * badge simply doesn't render until the fetch resolves (design.md
 * Decision 8's "degrades safely" precedent). */
export function selectAssertionInvalid(state: RootState, dataTypeId: string | null): boolean {
  if (dataTypeId === null) return false;
  return state.dataTypes.assertionStatusByDataTypeId[dataTypeId]?.invalid ?? false;
}
