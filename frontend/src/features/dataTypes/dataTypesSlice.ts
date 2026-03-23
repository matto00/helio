import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import {
  fetchDataTypes as fetchDataTypesRequest,
  updateDataType as updateDataTypeRequest,
} from "../../services/dataTypeService";
import type { DataType, DataTypeField } from "../../types/models";

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
  { id: string; fields: DataTypeField[] },
  { rejectValue: string }
>("dataTypes/updateDataType", async ({ id, fields }, { rejectWithValue }) => {
  try {
    return await updateDataTypeRequest(id, fields);
  } catch {
    return rejectWithValue("Failed to update data type.");
  }
});

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
      });
  },
});

export const dataTypesReducer = dataTypesSlice.reducer;
