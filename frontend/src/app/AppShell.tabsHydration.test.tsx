import { act, waitFor } from "@testing-library/react";

import { fetchDashboards as fetchDashboardsRequest } from "../features/dashboards/services/dashboardService";
import { fetchPanels as fetchPanelsRequest } from "../features/panels/services/panelService";
import { fetchDashboardChanges } from "../features/dashboards/tabs/dashboardChangesService";
import { resetTabsListenerState } from "../features/dashboards/tabs/dashboardTabsListeners";
import { renderWithStore } from "../test/renderWithStore";
import { dash, testUser } from "../test/tabsTestStore";
import { AppShell } from "./App";

// HEL-1575 task 3.3: hydration happens BEFORE the first panel request, and a deep link beats the saved
// active tab. These run the REAL tab listeners and the real `AppShell` panel effect.

jest.mock("../features/dashboards/services/dashboardFolderService", () => ({
  fetchDashboardFolders: jest.fn().mockResolvedValue({ folders: [], assignments: [] }),
}));
jest.mock("../features/pipelines/services/pipelineScheduleListService", () => ({
  fetchPipelineScheduleList: jest.fn().mockResolvedValue({ items: [], sources: [] }),
}));
jest.mock("../features/dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
}));
jest.mock("../features/panels/services/panelService", () => ({
  fetchPanels: jest.fn(),
  updatePanelsBatch: jest.fn().mockResolvedValue({ panels: [] }),
}));
jest.mock("../features/sources/services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
}));
jest.mock("../features/pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn().mockResolvedValue([]),
}));
jest.mock("../features/assistant/services/assistantConversationsService", () => ({
  listConversations: jest.fn().mockResolvedValue([]),
}));
jest.mock("../features/dashboards/tabs/dashboardChangesService", () => ({
  fetchDashboardChanges: jest.fn(),
}));
jest.mock("../features/auth/services/authService", () => ({
  patchShellPreferencesRequest: jest.fn().mockResolvedValue({}),
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
  logoutRequest: jest.fn(),
}));

const fetchDashboardsMock = jest.mocked(fetchDashboardsRequest);
const fetchPanelsMock = jest.mocked(fetchPanelsRequest);
const changesMock = jest.mocked(fetchDashboardChanges);

// The backend returns dashboards most recently updated first: "a" is what the reducer auto-selects.
const LIST = [dash("a", "Alpha"), dash("b", "Bravo"), dash("c", "Charlie")];

function renderShell(savedTabs: Parameters<typeof testUser>[0], deepLinkPath = "/") {
  window.history.pushState({}, "", deepLinkPath);
  return renderWithStore(
    <AppShell />,
    { auth: { status: "authenticated", currentUser: testUser(savedTabs) } },
    deepLinkPath,
    { withTabListeners: true },
  );
}

describe("AppShell panel loading waits for tab hydration (HEL-1575 D1)", () => {
  beforeEach(() => {
    resetTabsListenerState();
    fetchDashboardsMock.mockReset();
    fetchDashboardsMock.mockResolvedValue(LIST);
    fetchPanelsMock.mockReset();
    fetchPanelsMock.mockResolvedValue([]);
    changesMock.mockReset();
    changesMock.mockResolvedValue({ serverNow: new Date().toISOString(), items: [] });
  });
  afterEach(() => window.history.pushState({}, "", "/"));

  it("issues no fetchPanels for the auto-selected dashboard before the saved active tab is chosen", async () => {
    // Changes are slow: hydration is still waiting on them while the dashboards list has long arrived.
    let releaseChanges: () => void = () => undefined;
    changesMock.mockReturnValue(
      new Promise((resolve) => {
        releaseChanges = () => resolve({ serverNow: new Date().toISOString(), items: [] });
      }),
    );
    const { store } = renderShell({
      tabs: [{ id: "b", lastViewedAt: "2026-01-01T00:00:00.000Z" }, { id: "c" }],
      activeId: "b",
    });

    await waitFor(() => expect(store.getState().dashboards.status).toBe("succeeded"));
    // The reducer auto-selected "a" (most recent), yet nothing is fetched while hydration is pending.
    expect(store.getState().dashboards.selectedDashboardId).toBe("a");
    expect(store.getState().dashboardTabs.hydrated).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchPanelsMock).not.toHaveBeenCalled();

    await act(async () => releaseChanges());
    await waitFor(() => expect(store.getState().dashboardTabs.hydrated).toBe(true));
    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("b"));
    expect(fetchPanelsMock).not.toHaveBeenCalledWith("a");
    expect(store.getState().dashboards.selectedDashboardId).toBe("b");
    expect(store.getState().dashboardTabs.tabs.map((t: { id: string }) => t.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("a /dashboards/:id deep link beats the saved active tab and never overwrites the saved set", async () => {
    const { store } = renderShell(
      { tabs: [{ id: "b", lastViewedAt: "2026-01-01T00:00:00.000Z" }, { id: "c" }], activeId: "b" },
      "/dashboards/c",
    );
    await waitFor(() => expect(store.getState().dashboardTabs.hydrated).toBe(true));
    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("c"));
    expect(fetchPanelsMock).not.toHaveBeenCalledWith("a");
    expect(fetchPanelsMock).not.toHaveBeenCalledWith("b");
    // "c" was already open, so it is only activated; "b" is still there.
    expect(store.getState().dashboardTabs.tabs.map((t: { id: string }) => t.id)).toEqual([
      "b",
      "c",
    ]);
    expect(store.getState().dashboardTabs.activeId).toBe("c");
  });

  it("a user with no saved dashboardTabs key hydrates at once: the auto-selected dashboard is the only tab", async () => {
    const { store } = renderShell(undefined);
    await waitFor(() => expect(store.getState().dashboardTabs.hydrated).toBe(true));
    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("a"));
    expect(store.getState().dashboardTabs.tabs.map((t: { id: string }) => t.id)).toEqual(["a"]);
  });

  it("a stored EMPTY tab set stays empty on reload: no dashboard is selected and nothing is fetched", async () => {
    const { store } = renderShell({ tabs: [], activeId: null });
    await waitFor(() => expect(store.getState().dashboardTabs.hydrated).toBe(true));
    expect(store.getState().dashboards.selectedDashboardId).toBeNull();
    expect(store.getState().dashboardTabs.tabs).toEqual([]);
    expect(fetchPanelsMock).not.toHaveBeenCalled();
  });
});
