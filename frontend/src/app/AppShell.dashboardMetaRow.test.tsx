import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { assistantConversationsReducer } from "../features/assistant/state/assistantConversationsSlice";
import { authReducer } from "../features/auth/state/authSlice";
import { connectorsReducer } from "../features/connectors/state/connectorsSlice";
import { dashboardFoldersReducer } from "../features/dashboards/state/dashboardFoldersSlice";
import { dashboardsReducer } from "../features/dashboards/state/dashboardsSlice";
import {
  dashboardTabsReducer,
  initialDashboardTabsState,
} from "../features/dashboards/tabs/dashboardTabsSlice";
import { layoutHistoryReducer } from "../features/layout/state/layoutHistorySlice";
import { onboardingReducer } from "../features/onboarding/state/onboardingSlice";
import { panelsReducer } from "../features/panels/state/panelsSlice";
import { outputsReducer } from "../features/pipelines/state/outputsSlice";
import { pipelinesReducer } from "../features/pipelines/state/pipelinesSlice";
import { scheduledItemsReducer } from "../features/pipelines/state/scheduledItemsSlice";
import { sourcesReducer } from "../features/sources/state/sourcesSlice";
import { toastsReducer } from "../features/toasts/state/toastsSlice";
import type { UserPreferences } from "../features/auth/types/user";
import { patchShellPreferencesRequest } from "../features/auth/services/authService";
import { OverlayProvider } from "../shared/chrome/OverlayProvider";
import { ThemeProvider } from "../theme/ThemeProvider";
import { App } from "./App";

jest.mock("../features/dashboards/services/dashboardFolderService", () => ({
  fetchDashboardFolders: jest.fn().mockResolvedValue({ folders: [], assignments: [] }),
}));
jest.mock("../features/pipelines/services/pipelineScheduleListService", () => ({
  fetchPipelineScheduleList: jest.fn().mockResolvedValue({ items: [], sources: [] }),
}));
jest.mock("../features/dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn().mockResolvedValue([]),
}));
jest.mock("../features/panels/services/panelService", () => ({
  fetchPanels: jest.fn().mockResolvedValue([]),
}));
jest.mock("../features/sources/services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
  fetchSourceReferences: jest.fn().mockResolvedValue([]),
}));
jest.mock("../features/pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn().mockResolvedValue([]),
}));
jest.mock("../features/assistant/services/assistantConversationsService", () => ({
  listConversations: jest.fn().mockResolvedValue([]),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
}));
jest.mock("../features/auth/services/authService", () => ({
  getMeRequest: jest.fn().mockResolvedValue({
    id: "u1",
    email: "u@example.com",
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    tier: "owner",
  }),
  logoutRequest: jest.fn().mockResolvedValue(undefined),
  oauthCallbackRequest: jest.fn(),
  patchShellPreferencesRequest: jest.fn().mockResolvedValue({}),
}));

const patchMock = jest.mocked(patchShellPreferencesRequest);

function renderShell(
  path: string,
  options: { tier?: "free" | "beta" | "owner"; preferences?: Partial<UserPreferences> } = {},
) {
  const store = configureStore({
    reducer: {
      assistantConversations: assistantConversationsReducer,
      auth: authReducer,
      connectors: connectorsReducer,
      dashboardFolders: dashboardFoldersReducer,
      dashboards: dashboardsReducer,
      dashboardTabs: dashboardTabsReducer,
      layoutHistory: layoutHistoryReducer,
      onboarding: onboardingReducer,
      panels: panelsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      outputs: outputsReducer,
      scheduledItems: scheduledItemsReducer,
      toasts: toastsReducer,
    },
    preloadedState: {
      // HEL-1575: no tab listeners run in this store, so the tab set starts hydrated (inert).
      dashboardTabs: { ...initialDashboardTabsState, hydrated: true },
      auth: {
        currentUser: {
          id: "u1",
          email: "u@example.com",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier: options.tier ?? "owner",
          preferences: { accentColor: null, zoomLevels: {}, ...options.preferences },
        },
        status: "authenticated" as const,
        submitStatus: "idle" as const,
        mfaChallenge: null,
      },
    },
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <Provider store={store}>
          <OverlayProvider>
            <App />
          </OverlayProvider>
        </Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  return store;
}

function mockPhoneWidth(isPhone: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query === "(max-width: 768px)" ? isPhone : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

// HEL-1576 (design D1, owner answer `meta-row-replaces-command-bar`): on the rail shell's dashboard view the
// dashboard meta row takes the command bar's slot; every other page and the phone shell keep the command bar.
describe("authenticated shell: dashboard meta row replaces the command bar (HEL-1576)", () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.localStorage.clear();
    patchMock.mockClear();
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders the meta row, not the command bar, on the rail-shell dashboard view", async () => {
    mockPhoneWidth(false);
    renderShell("/dashboards");
    expect(await screen.findByRole("button", { name: "Open assistant" })).toBeInTheDocument();
    expect(document.querySelector(".app-command-bar--dashboard-meta")).not.toBeNull();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    // Exactly one command-bar-slot header: the swap never mounts both.
    expect(document.querySelectorAll("header.app-command-bar")).toHaveLength(1);
  });

  it.each(["/sources", "/pipelines"])("keeps the command bar on %s", async (path) => {
    mockPhoneWidth(false);
    renderShell(path);
    expect(await screen.findByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(document.querySelector(".app-command-bar--dashboard-meta")).toBeNull();
    expect(document.querySelectorAll("header.app-command-bar")).toHaveLength(1);
  });

  it("keeps the command bar on the phone shell's dashboard view", async () => {
    mockPhoneWidth(true);
    renderShell("/dashboards");
    expect(await screen.findByRole("button", { name: /^Switch dashboards/ })).toBeInTheDocument();
    expect(document.querySelector(".app-command-bar--dashboard-meta")).toBeNull();
  });
});
