import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import type { PropsWithChildren, ReactElement } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { defaultDashboardLayout } from "../features/dashboards/state/dashboardLayout";
import { assistantConversationsReducer } from "../features/assistant/state/assistantConversationsSlice";
import { auditEventsReducer } from "../features/audit/state/auditEventsSlice";
import { authReducer } from "../features/auth/state/authSlice";
import { connectorsReducer } from "../features/connectors/state/connectorsSlice";
import { dataTypesReducer } from "../features/dataTypes/state/dataTypesSlice";
import { dashboardsReducer } from "../features/dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../features/layout/state/layoutHistorySlice";
import { metricsReducer } from "../features/metrics/state/metricsSlice";
import { onboardingReducer } from "../features/onboarding/state/onboardingSlice";
import { panelsReducer } from "../features/panels/state/panelsSlice";
import { pipelinesReducer } from "../features/pipelines/state/pipelinesSlice";
import { settingsReducer } from "../features/settings/state/settingsSlice";
import { sourcesReducer } from "../features/sources/state/sourcesSlice";
import { addToastListeners } from "../features/toasts/state/toastListeners";
import { toastsReducer } from "../features/toasts/state/toastsSlice";
import { listenerMiddleware, startAppListening } from "../store/listenerMiddleware";
import { OverlayProvider } from "../shared/chrome/OverlayProvider";
import { ThemeProvider } from "../theme/ThemeProvider";
import { defaultDashboardAppearance, defaultPanelAppearance } from "../theme/appearance";
import type { User } from "../features/auth/types/user";
import type {
  AssistantConversationDetail,
  AssistantConversationSummary,
} from "../features/assistant/types";
import type { DashboardAppearance, DashboardLayout } from "../features/dashboards/types/dashboard";
import type { DataType } from "../features/dataTypes/types/dataType";
import type { Metric, MetricSummary } from "../features/metrics/types/metric";
import type { PipelineSummary } from "../features/pipelines/types/pipelineStep";
import type { PanelAppearance, PanelType } from "../features/panels/types/panel";
import type { DataSource } from "../features/sources/types/dataSource";
import type { ResourceMeta } from "../types/models";
const defaultMeta: ResourceMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

interface TestState {
  auth?: {
    status?: "idle" | "loading" | "authenticated" | "unauthenticated";
    currentUser?: User | null;
  };
  dashboards?: {
    items: Array<{
      id: string;
      name: string;
      meta?: ResourceMeta;
      appearance?: DashboardAppearance;
      layout?: DashboardLayout;
    }>;
    selectedDashboardId?: string | null;
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
  };
  panels?: {
    items: Array<{
      id: string;
      dashboardId: string;
      title: string;
      type?: PanelType;
      meta?: ResourceMeta;
      appearance?: PanelAppearance;
    }>;
    loadedDashboardId?: string | null;
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
    /** HEL-548 D1 — see `panelsSlice.ts`'s `PanelsState.staleDashboardId`. */
    staleDashboardId?: string | null;
    /** HEL-548 D5a — see `panelsSlice.ts`'s `PanelsState.panelCreationModalOpen`. */
    panelCreationModalOpen?: boolean;
  };
  dataTypes?: {
    items?: DataType[];
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
    /** HEL-576: pre-seed a DataType's cached assertion status. */
    assertionStatusByDataTypeId?: Record<
      string,
      { invalid: boolean; failedRuleCount: number } | undefined
    >;
  };
  sources?: {
    items?: DataSource[];
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
    /** HEL-554: preloads `AddSourceModal`'s open flag — needed to prove the
     *  unmount-cleanup guard (`SourcesPage.tsx`) red against the
     *  pre-cleanup build: a freshly-mounted `SourcesPage` with this `true`
     *  must NOT show the modal once the cleanup exists. */
    addModalOpen?: boolean;
  };
  pipelines?: {
    items?: PipelineSummary[];
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
  };
  metrics?: {
    items?: MetricSummary[];
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
    /** HEL-560: single-metric detail state consumed by `MetricDetailPage.tsx`. */
    currentMetric?: Metric | null;
    currentMetricStatus?: "idle" | "loading" | "succeeded" | "failed";
    currentMetricError?: string | null;
  };
  /** HEL-554: onboarding checklist state consumed by `useOnboardingHost`/
   * `OnboardingChecklist`. `dismissed` defaults to `null` (not yet
   * hydrated) — a test that needs `autoActivate` to evaluate must opt in
   * with `dismissed: false` explicitly (mirrors the real pre-hydration
   * guard, design.md D2/D7). */
  onboarding?: {
    active?: boolean;
    dismissed?: boolean | null;
  };
  /** HEL-664: conversation list + selection state consumed by `ChatPage.tsx`/
   * `ActiveConversationPanel.tsx`. */
  assistantConversations?: {
    items?: AssistantConversationSummary[];
    status?: "idle" | "loading" | "succeeded" | "failed";
    error?: string | null;
    selectedConversationId?: string | null;
    startingNewConversation?: boolean;
    activeConversation?: {
      data?: AssistantConversationDetail | null;
      status?: "idle" | "loading" | "succeeded" | "failed";
      error?: string | null;
    };
    /** HEL-667 design.md D1/D5. */
    lastTurnOutcome?: {
      hopBudgetExhausted: boolean;
      searchedWithNoResults: boolean;
    } | null;
  };
}

export interface RenderWithStoreOptions {
  /** HEL-535 — off by default (unchanged behaviour for every existing
   *  caller). When true, wires `listenerMiddleware` in and registers
   *  `toastListeners.ts`'s tables, mirroring the real app store (`store.ts`)
   *  — needed only by tests that must observe a thunk-fulfilled/-rejected
   *  listener's own toast (e.g. `AddSourceModal`'s D6 one-toast-per-create
   *  guarantee, where the toast comes from the listener, not the component).
   *  Registered once per call — see the guard below. */
  withToastListeners?: boolean;
}

// HEL-535 — registers `toastListeners.ts` on the module-level
// `listenerMiddleware` singleton at most once per test FILE (Jest gives each
// test file its own fresh module registry, so this resets across files).
// Without this guard, a test file with multiple `withToastListeners: true`
// calls would re-register every entry each time, firing each effect N times.
let toastListenersRegistered = false;
function ensureToastListenersRegistered() {
  if (toastListenersRegistered) return;
  addToastListeners(startAppListening);
  toastListenersRegistered = true;
}

export function renderWithStore(
  ui: ReactElement,
  preloadedState?: TestState,
  /** HEL-560: initial `MemoryRouter` location — defaults to "/" (prior
   *  behavior, unchanged for every existing caller). Needed by pages that
   *  read a route param via `useParams` (e.g. `MetricDetailPage`'s `:id`),
   *  which require a matched `<Route>` to resolve. */
  initialPath: string = "/",
  options?: RenderWithStoreOptions,
) {
  const reducer = {
    assistantConversations: assistantConversationsReducer,
    auditEvents: auditEventsReducer,
    auth: authReducer,
    connectors: connectorsReducer,
    dashboards: dashboardsReducer,
    layoutHistory: layoutHistoryReducer,
    onboarding: onboardingReducer,
    panels: panelsReducer,
    dataTypes: dataTypesReducer,
    metrics: metricsReducer,
    pipelines: pipelinesReducer,
    settings: settingsReducer,
    sources: sourcesReducer,
    toasts: toastsReducer,
  };

  const normalizedState = preloadedState
    ? {
        ...(preloadedState.auth !== undefined && {
          auth: {
            status: preloadedState.auth.status ?? "idle",
            currentUser: preloadedState.auth.currentUser ?? null,
          },
        }),
        dashboards: {
          items:
            preloadedState.dashboards?.items.map((dashboard) => ({
              ...dashboard,
              meta: dashboard.meta ?? defaultMeta,
              appearance: dashboard.appearance ?? defaultDashboardAppearance,
              layout: dashboard.layout ?? defaultDashboardLayout,
            })) ?? [],
          selectedDashboardId: preloadedState.dashboards?.selectedDashboardId ?? null,
          status: preloadedState.dashboards?.status ?? "idle",
          error: preloadedState.dashboards?.error ?? null,
        },
        panels: {
          items:
            preloadedState.panels?.items.map((panel) => ({
              typeId: null,
              fieldMapping: null,
              refreshInterval: null,
              ...panel,
              type: panel.type ?? "metric",
              meta: panel.meta ?? defaultMeta,
              appearance: panel.appearance ?? defaultPanelAppearance,
            })) ?? [],
          loadedDashboardId: preloadedState.panels?.loadedDashboardId ?? null,
          status: preloadedState.panels?.status ?? "idle",
          error: preloadedState.panels?.error ?? null,
          pendingPanelUpdates: {},
          paginationState: {},
          lastSavedAt: null,
          staleDashboardId: preloadedState.panels?.staleDashboardId ?? null,
          panelCreationModalOpen: preloadedState.panels?.panelCreationModalOpen ?? false,
        },
        dataTypes: {
          items: preloadedState.dataTypes?.items ?? [],
          status: preloadedState.dataTypes?.status ?? "idle",
          error: preloadedState.dataTypes?.error ?? null,
          selectedTypeId: null,
          // HEL-576: PanelCard's assertion-status selector reads these two
          // fields unconditionally for any bound panel — omitting them here
          // would throw ("Cannot read properties of undefined") the moment a
          // caller passes ANY preloadedState (which replaces this whole slice).
          assertionStatusByDataTypeId: preloadedState.dataTypes?.assertionStatusByDataTypeId ?? {},
          assertionStatusPendingIds: {},
        },
        sources: {
          items: preloadedState.sources?.items ?? [],
          status: preloadedState.sources?.status ?? "idle",
          error: preloadedState.sources?.error ?? null,
          addModalOpen: preloadedState.sources?.addModalOpen ?? false,
        },
        pipelines: {
          items: preloadedState.pipelines?.items ?? [],
          status: preloadedState.pipelines?.status ?? "idle",
          error: preloadedState.pipelines?.error ?? null,
        },
        metrics: {
          items: preloadedState.metrics?.items ?? [],
          status: preloadedState.metrics?.status ?? "idle",
          error: preloadedState.metrics?.error ?? null,
          createStatus: "idle",
          createError: null,
          updateStatus: "idle",
          updateError: null,
          deleteStatus: "idle",
          deleteError: null,
          currentMetric: preloadedState.metrics?.currentMetric ?? null,
          currentMetricStatus: preloadedState.metrics?.currentMetricStatus ?? "idle",
          currentMetricError: preloadedState.metrics?.currentMetricError ?? null,
          createModalOpen: false,
        },
        onboarding: {
          active: preloadedState.onboarding?.active ?? false,
          dismissed: preloadedState.onboarding?.dismissed ?? null,
        },
        assistantConversations: {
          items: preloadedState.assistantConversations?.items ?? [],
          status: preloadedState.assistantConversations?.status ?? "idle",
          error: preloadedState.assistantConversations?.error ?? null,
          selectedConversationId:
            preloadedState.assistantConversations?.selectedConversationId ?? null,
          startingNewConversation:
            preloadedState.assistantConversations?.startingNewConversation ?? false,
          activeConversation: {
            data: preloadedState.assistantConversations?.activeConversation?.data ?? null,
            status: preloadedState.assistantConversations?.activeConversation?.status ?? "idle",
            error: preloadedState.assistantConversations?.activeConversation?.error ?? null,
          },
          lastTurnOutcome: preloadedState.assistantConversations?.lastTurnOutcome ?? null,
        },
      }
    : undefined;

  if (options?.withToastListeners) {
    ensureToastListenersRegistered();
  }

  const store = configureStore({
    reducer: reducer as never,
    preloadedState: normalizedState as never,
    middleware: (getDefaultMiddleware) =>
      options?.withToastListeners
        ? getDefaultMiddleware().prepend(listenerMiddleware.middleware)
        : getDefaultMiddleware(),
  });

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <MemoryRouter initialEntries={[initialPath]}>
        <ThemeProvider>
          <Provider store={store}>
            <OverlayProvider>{children}</OverlayProvider>
          </Provider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }

  return {
    store,
    ...render(ui, { wrapper: Wrapper }),
  };
}
