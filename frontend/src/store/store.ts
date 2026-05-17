import { configureStore } from "@reduxjs/toolkit";

import { authReducer } from "../features/auth/state/authSlice";
import { dataTypesReducer } from "../features/dataTypes/dataTypesSlice";
import { dashboardsReducer } from "../features/dashboards/dashboardsSlice";
import { layoutHistoryReducer } from "../features/layout/layoutHistorySlice";
import { panelsReducer } from "../features/panels/panelsSlice";
import { pipelinesReducer } from "../features/pipelines/pipelinesSlice";
import { sourcesReducer } from "../features/sources/sourcesSlice";
import { toastsReducer } from "../features/toasts/toastsSlice";
import { listenerMiddleware, startAppListening } from "./listenerMiddleware";
import { addToastListeners } from "../features/toasts/toastListeners";

// Register all toast listeners before the store is finalised.
addToastListeners(startAppListening);

export const store = configureStore({
  reducer: {
    auth: authReducer,
    dashboards: dashboardsReducer,
    layoutHistory: layoutHistoryReducer,
    panels: panelsReducer,
    dataTypes: dataTypesReducer,
    pipelines: pipelinesReducer,
    sources: sourcesReducer,
    toasts: toastsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().prepend(listenerMiddleware.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
