import { createSlice, nanoid, type PayloadAction } from "@reduxjs/toolkit";

export interface Dashboard {
  id: string;
  name: string;
}

interface DashboardsState {
  items: Dashboard[];
}

const initialState: DashboardsState = {
  items: [{ id: nanoid(), name: "My First Dashboard" }],
};

const dashboardsSlice = createSlice({
  name: "dashboards",
  initialState,
  reducers: {
    addDashboard: {
      reducer(state, action: PayloadAction<Dashboard>) {
        state.items.push(action.payload);
      },
      prepare(name: string) {
        return { payload: { id: nanoid(), name } };
      },
    },
  },
});

export const { addDashboard } = dashboardsSlice.actions;
export const dashboardsReducer = dashboardsSlice.reducer;
