import { createAsyncThunk, createSelector, createSlice } from "@reduxjs/toolkit";

import {
  fetchDataTypes as fetchDataTypesRequest,
  updateDataType as updateDataTypeRequest,
  deleteDataType as deleteDataTypeRequest,
} from "../services/dataTypeService";
import type { ComputedField, DataType, DataTypeField } from "../types/dataType";
import type { RootState } from "../../../store/store";

interface DataTypesState {
  items: DataType[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  /** Explicit user selection in the sidebar. Null means "fall back to first
   * item" — the page derives the effective selection so it's never blank. */
  selectedTypeId: string | null;
}

const initialState: DataTypesState = {
  items: [],
  status: "idle",
  error: null,
  selectedTypeId: null,
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

export const fetchDataTypes = createAsyncThunk<DataType[], void, { rejectValue: string }>(
  "dataTypes/fetchDataTypes",
  async (_, { rejectWithValue }) => {
    try {
      return await fetchDataTypesRequest();
    } catch {
      return rejectWithValue("Failed to load data types.");
    }
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
      })
      .addCase(fetchDataTypes.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(fetchDataTypes.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load data types.";
      })
      .addCase(updateDataType.fulfilled, (state, action) => {
        const idx = state.items.findIndex((dt) => dt.id === action.payload.id);
        if (idx !== -1) state.items[idx] = action.payload;
      })
      .addCase(deleteDataType.fulfilled, (state, action) => {
        state.items = state.items.filter((dt) => dt.id !== action.payload);
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
