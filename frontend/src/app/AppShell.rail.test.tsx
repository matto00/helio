import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { dash, tab } from "../test/tabsTestStore";
import { fetchDashboards as fetchDashboardsRequest } from "../features/dashboards/services/dashboardService";
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
  options: {
    tier?: "free" | "beta" | "owner";
    preferences?: Partial<UserPreferences>;
    /** HEL-1575: open dashboards (all tabs), the first active. */
    openTabs?: Array<{ id: string; name: string }>;
  } = {},
) {
  const openTabs = options.openTabs ?? [];
  const dashboardItems = openTabs.map((d) => dash(d.id, d.name));
  jest.mocked(fetchDashboardsRequest).mockResolvedValue(dashboardItems);
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
      dashboardTabs: {
        ...initialDashboardTabsState,
        hydrated: true,
        tabs: openTabs.map((d) => tab(d.id)),
        activeId: openTabs[0]?.id ?? null,
      },
      dashboards: {
        ...dashboardsReducer(undefined, { type: "@@test/init" }),
        items: dashboardItems,
        status: "succeeded" as const,
        selectedDashboardId: openTabs[0]?.id ?? null,
      },
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

describe("authenticated shell: icon rail and context list (HEL-1574)", () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.localStorage.clear();
    patchMock.mockClear();
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  describe("above the phone breakpoint", () => {
    it("renders the rail with every section reachable, and exactly one avatar menu and one logo link", async () => {
      renderShell("/");
      const rail = await screen.findByRole("navigation", { name: "Main navigation" });
      for (const name of [
        "Home",
        "Dashboards",
        "Data Sources",
        "Data Pipelines",
        "Connectors",
        "Assistant",
      ]) {
        expect(within(rail).getByRole("link", { name })).toBeInTheDocument();
      }
      expect(screen.getAllByRole("button", { name: "User menu" })).toHaveLength(1);
      expect(screen.getAllByRole("link", { name: "Helio home" })).toHaveLength(1);
    });

    it("shows the dashboards context list with an accessible resize separator", async () => {
      renderShell("/");
      expect(
        await screen.findByRole("complementary", { name: "Dashboards list" }),
      ).toBeInTheDocument();
      const separator = screen.getByRole("separator", { name: "Resize dashboard list" });
      expect(separator).toHaveAttribute("aria-valuenow", "248");
    });

    it("paints the saved width on the first render, with no default flash and no request", async () => {
      renderShell("/", { preferences: { contextListWidth: 320 } });
      const shell = document.querySelector<HTMLElement>(".app-shell");
      expect(shell?.style.getPropertyValue("--context-list-width")).toBe("320px");
      expect(
        await screen.findByRole("separator", { name: "Resize dashboard list" }),
      ).toHaveAttribute("aria-valuenow", "320");
      expect(patchMock).not.toHaveBeenCalled();
    });

    it("renders collapsed on first paint when saved collapsed, keeping every rail item", async () => {
      renderShell("/", { preferences: { contextListCollapsed: true } });
      expect(await screen.findByRole("button", { name: "Expand list" })).toBeInTheDocument();
      expect(
        screen.queryByRole("complementary", { name: "Dashboards list" }),
      ).not.toBeInTheDocument();
      expect(
        within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", {
          name: "Data Sources",
        }),
      ).toBeInTheDocument();
    });

    it("collapses through the list button with one write, and re-expands from the rail", async () => {
      renderShell("/");
      fireEvent.click(await screen.findByRole("button", { name: "Collapse list" }));
      await waitFor(() => expect(patchMock).toHaveBeenCalledWith({ contextListCollapsed: true }));
      expect(patchMock).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Expand list" }));
      await waitFor(() =>
        expect(patchMock).toHaveBeenLastCalledWith({ contextListCollapsed: false }),
      );
    });

    it("moves focus to the rail's Expand button when the list collapses, and back to Collapse on expand", async () => {
      renderShell("/home");
      fireEvent.click(await screen.findByRole("button", { name: "Collapse list" }));
      const expand = await screen.findByRole("button", { name: "Expand list" });
      await waitFor(() => expect(expand).toHaveFocus());
      fireEvent.click(expand);
      const collapse = await screen.findByRole("button", { name: "Collapse list" });
      await waitFor(() => expect(collapse).toHaveFocus());
    });

    it("moves focus to the Expand button when the separator collapses with Enter", async () => {
      renderShell("/home");
      fireEvent.keyDown(await screen.findByRole("separator", { name: "Resize dashboard list" }), {
        key: "Enter",
      });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Expand list" })).toHaveFocus(),
      );
    });

    it("does not steal focus on first render", async () => {
      renderShell("/home");
      await screen.findByRole("button", { name: "Collapse list" });
      expect(document.body).toHaveFocus();
    });

    it("resizes from the keyboard and writes once for a burst", async () => {
      jest.useFakeTimers();
      try {
        renderShell("/");
        const separator = await screen.findByRole("separator", { name: "Resize dashboard list" });
        fireEvent.keyDown(separator, { key: "ArrowRight" });
        fireEvent.keyDown(separator, { key: "ArrowRight" });
        expect(separator).toHaveAttribute("aria-valuenow", "280");
        expect(patchMock).not.toHaveBeenCalled();
        jest.advanceTimersByTime(400);
        expect(patchMock).toHaveBeenCalledTimes(1);
        expect(patchMock).toHaveBeenCalledWith({ contextListWidth: 280 });
      } finally {
        jest.useRealTimers();
      }
    });

    it("shows no context list on Connectors, without changing the saved collapsed state", async () => {
      renderShell("/connectors");
      await screen.findByRole("navigation", { name: "Main navigation" });
      expect(document.querySelector(".context-list")).toBeNull();
      expect(screen.queryByRole("button", { name: "Expand list" })).not.toBeInTheDocument();
      expect(patchMock).not.toHaveBeenCalled();
    });

    it("shows the compact Recent / Scheduled lists on Pipelines, not a copy of the table", async () => {
      renderShell("/pipelines");
      const list = await screen.findByRole("complementary", { name: "Data Pipelines list" });
      expect(within(list).getByRole("region", { name: "Recent" })).toBeInTheDocument();
      expect(within(list).getByRole("region", { name: "Scheduled" })).toBeInTheDocument();
      expect(within(list).getByRole("link", { name: "View all pipelines" })).toBeInTheDocument();
    });

    it("keeps the Assistant's conversation list", async () => {
      renderShell("/chat");
      const list = await screen.findByRole("complementary", { name: "Assistant list" });
      expect(within(list).getAllByRole("button", { name: "New chat" }).length).toBeGreaterThan(0);
    });

    it("moves Usage into the avatar menu for an owner, not the rail", async () => {
      renderShell("/", { tier: "owner" });
      const rail = await screen.findByRole("navigation", { name: "Main navigation" });
      expect(within(rail).queryByRole("link", { name: "Usage" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "User menu" }));
      expect(screen.getByRole("menuitem", { name: "Usage" })).toBeInTheDocument();
    });

    it("gives a free-tier user no Usage item", async () => {
      renderShell("/", { tier: "free" });
      fireEvent.click(await screen.findByRole("button", { name: "User menu" }));
      expect(screen.queryByRole("menuitem", { name: "Usage" })).not.toBeInTheDocument();
    });
  });

  describe("at the phone breakpoint (768px and below)", () => {
    it("renders no rail and no context list, only the command bar's avatar and logo, and the bottom nav", async () => {
      mockPhoneWidth(true);
      renderShell("/");
      await screen.findByRole("navigation", { name: "Primary" });
      expect(screen.queryByRole("navigation", { name: "Main navigation" })).not.toBeInTheDocument();
      expect(document.querySelector(".app-rail")).toBeNull();
      expect(document.querySelector(".context-list")).toBeNull();
      expect(screen.getAllByRole("button", { name: "User menu" })).toHaveLength(1);
      expect(screen.getAllByRole("link", { name: "Helio home" })).toHaveLength(1);
      const primary = screen.getByRole("navigation", { name: "Primary" });
      expect(within(primary).getAllByRole("link")[0]).toHaveAttribute("aria-label", "Home");
    });
  });

  describe("the dashboard tab bar (HEL-1575 D8)", () => {
    const openTabs = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ];

    it("mounts above the phone breakpoint on the dashboard view, with the tabpanel and no breadcrumb name", async () => {
      renderShell("/home", { openTabs });
      const list = await screen.findByRole("tablist", { name: "Open dashboards" });
      expect(within(list).getAllByRole("tab")).toHaveLength(2);
      const panel = screen.getByRole("tabpanel");
      expect(panel).toHaveAttribute(
        "aria-labelledby",
        within(list).getByRole("tab", { name: "Alpha" }).id,
      );
      // The command bar's breadcrumb keeps the section but drops the dashboard name; the sr-only h1 stays.
      const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(within(breadcrumb).queryByText("Alpha")).toBeNull();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alpha");
      expect(screen.getByRole("button", { name: "Search, jump, or ask" })).toBeInTheDocument();
      expect(document.querySelector(".app-shell")).toHaveClass("app-shell--tabs");
    });

    it("is absent off the dashboard view", async () => {
      renderShell("/pipelines", { openTabs });
      await screen.findByRole("navigation", { name: "Main navigation" });
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("tabpanel")).toBeNull();
    });

    it("is absent at the phone breakpoint, which keeps its own switcher", async () => {
      mockPhoneWidth(true);
      renderShell("/home", { openTabs });
      await screen.findByRole("navigation", { name: "Primary" });
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(document.querySelector(".app-shell")).not.toHaveClass("app-shell--tabs");
    });
  });
});
