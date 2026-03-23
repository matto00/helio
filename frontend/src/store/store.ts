import { configureStore } from "@reduxjs/toolkit";

import { dataTypesReducer } from "../features/dataTypes/dataTypesSlice";
import { dashboardsReducer } from "../features/dashboards/dashboardsSlice";
import { panelsReducer } from "../features/panels/panelsSlice";

export const store = configureStore({
  reducer: {
    dashboards: dashboardsReducer,
    panels: panelsReducer,
    dataTypes: dataTypesReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
