import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import { fetchDataTypes as fetchDataTypesRequest } from "../../services/dataTypeService";
import type { DataType } from "../../types/models";

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
      });
  },
});

export const dataTypesReducer = dataTypesSlice.reducer;
