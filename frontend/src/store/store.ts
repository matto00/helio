import { configureStore } from "@reduxjs/toolkit";

import { authReducer } from "../features/auth/state/authSlice";
import { dataTypesReducer } from "../features/dataTypes/state/dataTypesSlice";
import { dashboardsReducer } from "../features/dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../features/layout/state/layoutHistorySlice";
import { metricsReducer } from "../features/metrics/state/metricsSlice";
import { panelsReducer } from "../features/panels/state/panelsSlice";
import { patchSetsReducer } from "../features/patchSets/state/patchSetsSlice";
import { pipelinesReducer } from "../features/pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../features/sources/state/sourcesSlice";
import { toastsReducer } from "../features/toasts/state/toastsSlice";
import { listenerMiddleware, startAppListening } from "./listenerMiddleware";
import { addToastListeners } from "../features/toasts/state/toastListeners";

// Register all toast listeners before the store is finalised.
addToastListeners(startAppListening);

export const store = configureStore({
  reducer: {
    auth: authReducer,
    dashboards: dashboardsReducer,
    layoutHistory: layoutHistoryReducer,
    panels: panelsReducer,
    dataTypes: dataTypesReducer,
    metrics: metricsReducer,
    patchSets: patchSetsReducer,
    pipelines: pipelinesReducer,
    sources: sourcesReducer,
    toasts: toastsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // HEL-413: `Toast.action.onClick` (e.g. the patch-set-apply "Undo" toast,
      // PatchSetReviewPage.tsx) is the first real call site to populate
      // `ToastAction`'s `onClick` with a live closure -- an intentional,
      // RTK-documented non-serializable value
      // (https://redux-toolkit.js.org/usage/usage-guide#working-with-non-serializable-data),
      // not an accidental one. `ignoredPaths` skips the WHOLE `toasts` state
      // subtree (short-circuits at the top-level key, so it covers every
      // toast's `action.onClick` regardless of its index in `items`);
      // `ignoredActionPaths` covers the one-time check of the `pushToast`
      // action itself.
      serializableCheck: {
        ignoredPaths: ["toasts"],
        ignoredActionPaths: ["payload.action.onClick"],
      },
    }).prepend(listenerMiddleware.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
