import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import {
  fetchDataTypes as fetchDataTypesRequest,
  updateDataType as updateDataTypeRequest,
  deleteDataType as deleteDataTypeRequest,
} from "../../services/dataTypeService";
import type { ComputedField, DataType, DataTypeField } from "../../types/models";

interface DataTypesState {
  items: DataType[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
}

const initialState: DataTypesState = {
  items: [],
  status: "idle",
  error: null,
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
  reducers: {},
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

export const dataTypesReducer = dataTypesSlice.reducer;
