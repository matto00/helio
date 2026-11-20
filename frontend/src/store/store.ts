import { combineReducers, configureStore, type UnknownAction } from "@reduxjs/toolkit";

import { assistantConversationsReducer } from "../features/assistant/state/assistantConversationsSlice";
import { assistantModelsReducer } from "../features/assistant/state/assistantModelsSlice";
import { auditEventsReducer } from "../features/audit/state/auditEventsSlice";
import { authReducer, clearAuth } from "../features/auth/state/authSlice";
import { connectorsReducer } from "../features/connectors/state/connectorsSlice";
import { dashboardFoldersReducer } from "../features/dashboards/state/dashboardFoldersSlice";
import { dashboardsReducer } from "../features/dashboards/state/dashboardsSlice";
import { homeSummaryReducer } from "../features/home/state/homeSummarySlice";
import { dashboardTabsReducer } from "../features/dashboards/tabs/dashboardTabsSlice";
import { addDashboardTabsListeners } from "../features/dashboards/tabs/dashboardTabsListeners";
import { layoutHistoryReducer } from "../features/layout/state/layoutHistorySlice";
import { onboardingReducer } from "../features/onboarding/state/onboardingSlice";
import { panelsReducer } from "../features/panels/state/panelsSlice";
import { patchSetsReducer } from "../features/patchSets/state/patchSetsSlice";
import { scheduledItemsReducer } from "../features/pipelines/state/scheduledItemsSlice";
import { outputsReducer } from "../features/pipelines/state/outputsSlice";
import { pipelinesReducer } from "../features/pipelines/state/pipelinesSlice";
import { combinedProposalsReducer } from "../features/proposals/state/combinedProposalsSlice";
import { settingsReducer } from "../features/settings/state/settingsSlice";
import { shareTokensReducer } from "../features/dashboards/state/shareTokensSlice";
import { sourcesReducer } from "../features/sources/state/sourcesSlice";
import { datasetRowsReducer } from "../features/sources/state/datasetRowsSlice";
import { sourceSamplesReducer } from "../features/sources/state/sourceSamplesSlice";
import { toastsReducer } from "../features/toasts/state/toastsSlice";
import { createSessionEpochMiddleware } from "../shared/session/sessionEpochMiddleware";
import { runSessionResets } from "../shared/session/sessionReset";
import { listenerMiddleware, startAppListening } from "./listenerMiddleware";
import { addToastListeners } from "../features/toasts/state/toastListeners";
import { registerSignedInHintListener } from "../features/auth/state/signedInHint";
// Modules that register a sign-out hook but may not be loaded when a session ends are imported for the registration.
import "../features/pipelines/state/keptDraft";
import "../features/dashboards/state/refinementConversationIds";
import { addRecentVisitsListeners } from "../features/commandPalette/state/recentVisitsListeners";

// Register all toast listeners before the store is finalised.
addToastListeners(startAppListening);
// HEL-519 design.md D2 — dashboards' recording mechanism (a state-transition listener) plus
// the prune listeners for all three kinds. See `recentVisitsListeners.ts`.
addRecentVisitsListeners(startAppListening);
// HEL-1562: keeps the landing page's "signed in" hint in step with `auth.status`.
registerSignedInHintListener(startAppListening);
// HEL-1575: open-dashboard tabs (selection sync, persistence, hydration) and the warm cache's listeners.
addDashboardTabsListeners(startAppListening);

// HEL-1634 D3: ONE listener runs every registered module-cache reset on every `clearAuth` (logout,
// the 401 interceptor, a failed rehydrate). The session epoch is bumped earlier, by the epoch middleware.
startAppListening({
  actionCreator: clearAuth,
  effect: () => {
    runSessionResets();
  },
});

/**
 * HEL-1634 D1. Slices that handle `clearAuth` THEMSELVES: every other slice is reset by the root
 * reducer below, so a new slice is covered by default.
 */
export const SELF_RESETTING_SLICES: Readonly<Record<string, string>> = {
  auth: "clears its own user, status and MFA challenge in its own clearAuth case",
  sourceSamples:
    "increments its epoch on clearAuth to discard in-flight loads; resetting it to undefined would restart that epoch at 0",
};

const sliceReducers = {
  assistantConversations: assistantConversationsReducer,
  assistantModels: assistantModelsReducer,
  auditEvents: auditEventsReducer,
  auth: authReducer,
  connectors: connectorsReducer,
  dashboardFolders: dashboardFoldersReducer,
  dashboards: dashboardsReducer,
  homeSummary: homeSummaryReducer,
  dashboardTabs: dashboardTabsReducer,
  layoutHistory: layoutHistoryReducer,
  onboarding: onboardingReducer,
  panels: panelsReducer,
  patchSets: patchSetsReducer,
  pipelines: pipelinesReducer,
  outputs: outputsReducer,
  scheduledItems: scheduledItemsReducer,
  combinedProposals: combinedProposalsReducer,
  settings: settingsReducer,
  shareTokens: shareTokensReducer,
  sources: sourcesReducer,
  datasetRows: datasetRowsReducer,
  sourceSamples: sourceSamplesReducer,
  toasts: toastsReducer,
};

const combinedReducer = combineReducers(sliceReducers);

/** `clearAuth` returns every slice that does not reset itself to its initial state. */
const rootReducer = (
  state: ReturnType<typeof combinedReducer> | undefined,
  action: UnknownAction,
): ReturnType<typeof combinedReducer> => {
  if (state !== undefined && clearAuth.match(action)) {
    const kept: Partial<ReturnType<typeof combinedReducer>> = {};
    for (const key of Object.keys(SELF_RESETTING_SLICES) as (keyof typeof state)[]) {
      (kept as Record<string, unknown>)[key] = state[key];
    }
    return combinedReducer(kept as ReturnType<typeof combinedReducer>, action);
  }
  return combinedReducer(state, action);
};

export const store = configureStore({
  reducer: rootReducer,
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
    }).prepend(createSessionEpochMiddleware(), listenerMiddleware.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
