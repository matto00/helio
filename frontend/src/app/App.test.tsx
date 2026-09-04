import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { assistantConversationsReducer } from "../features/assistant/state/assistantConversationsSlice";
import {
  getConversation as getConversationRequest,
  listConversations as listConversationsRequest,
} from "../features/assistant/services/assistantConversationsService";
import { authReducer } from "../features/auth/state/authSlice";
import { getMeRequest } from "../features/auth/services/authService";
import { dashboardsReducer } from "../features/dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../features/layout/state/layoutHistorySlice";
import { onboardingReducer } from "../features/onboarding/state/onboardingSlice";
import { panelsReducer } from "../features/panels/state/panelsSlice";
import { pipelinesReducer } from "../features/pipelines/state/pipelinesSlice";
import { getPipelines as getPipelinesRequest } from "../features/pipelines/services/pipelineService";
import { fetchSources as fetchSourcesRequest } from "../features/sources/services/dataSourceService";
import { sourcesReducer } from "../features/sources/state/sourcesSlice";
import { toastsReducer } from "../features/toasts/state/toastsSlice";
import {
  fetchDashboards as fetchDashboardsRequest,
  updateDashboardAppearance as updateDashboardAppearanceRequest,
  updateDashboardLayout as updateDashboardLayoutRequest,
} from "../features/dashboards/services/dashboardService";
import {
  fetchPanels as fetchPanelsRequest,
  updatePanelAppearance as updatePanelAppearanceRequest,
} from "../features/panels/services/panelService";
import { OverlayProvider } from "../shared/chrome/OverlayProvider";
import { ThemeProvider } from "../theme/ThemeProvider";
import { makeOutputPanel } from "../test/panelFixtures";
import { App } from "./App";

jest.mock("../features/dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

jest.mock("../features/panels/services/panelService", () => ({
  fetchPanels: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelBinding: jest.fn(),
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
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
}));

jest.mock("../features/auth/services/authService", () => ({
  getMeRequest: jest.fn().mockResolvedValue({
    id: "test-user",
    email: "test@example.com",
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
  }),
  logoutRequest: jest.fn().mockResolvedValue(undefined),
  oauthCallbackRequest: jest.fn(),
}));

// HEL-287: App always dispatches rehydrateAuth() on mount (identity is the
// httpOnly cookie now, not a sessionStorage token, so there is nothing to
// gate the call on). getMeRequest is mocked to always succeed by default,
// which keeps `authenticated: true` fixtures authenticated post-rehydrate;
// tests using `authenticated: false` override it to reject for that test
// only (see "redirects unauthenticated user from /pipelines to /login").
const getMeRequestMock = jest.mocked(getMeRequest);

const fetchDashboardsMock = jest.mocked(fetchDashboardsRequest);
const fetchPanelsMock = jest.mocked(fetchPanelsRequest);
const getPipelinesMock = jest.mocked(getPipelinesRequest);
const fetchSourcesMock = jest.mocked(fetchSourcesRequest);
const updateDashboardAppearanceMock = jest.mocked(updateDashboardAppearanceRequest);
const updateDashboardLayoutMock = jest.mocked(updateDashboardLayoutRequest);
const updatePanelAppearanceMock = jest.mocked(updatePanelAppearanceRequest);
const listConversationsMock = jest.mocked(listConversationsRequest);
const getConversationMock = jest.mocked(getConversationRequest);

const defaultDashboardAppearance = {
  background: "transparent",
  gridBackground: "transparent",
};

const defaultDashboardLayout = {
  lg: [],
  md: [],
  sm: [],
  xs: [],
};

const defaultPanelAppearance = {
  background: "transparent",
  color: "inherit",
  transparency: 0,
};

function renderApp(options: { initialPath?: string; authenticated?: boolean } = {}) {
  const { initialPath = "/", authenticated = true } = options;

  const store = configureStore({
    reducer: {
      assistantConversations: assistantConversationsReducer,
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      onboarding: onboardingReducer,
      panels: panelsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      toasts: toastsReducer,
    },
    preloadedState: {
      auth: authenticated
        ? {
            currentUser: {
              id: "test-user",
              email: "test@example.com",
              displayName: null,
              avatarUrl: null,
              createdAt: "2026-01-01T00:00:00Z",
              tier: "owner" as const,
            },
            status: "authenticated" as const,
            submitStatus: "idle" as const,
            mfaChallenge: null,
          }
        : {
            currentUser: null,
            status: "unauthenticated" as const,
            submitStatus: "idle" as const,
            mfaChallenge: null,
          },
    },
  });

  return {
    store,
    ...render(
      <MemoryRouter initialEntries={[initialPath]}>
        <ThemeProvider>
          <Provider store={store}>
            <OverlayProvider>
              <App />
            </OverlayProvider>
          </Provider>
        </ThemeProvider>
      </MemoryRouter>,
    ),
  };
}

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    fetchDashboardsMock.mockReset();
    fetchPanelsMock.mockReset();
    updateDashboardAppearanceMock.mockReset();
    updateDashboardLayoutMock.mockReset();
    updatePanelAppearanceMock.mockReset();
    listConversationsMock.mockReset();
    listConversationsMock.mockResolvedValue([]);
    getConversationMock.mockReset();
    fetchSourcesMock.mockReset();
    fetchSourcesMock.mockResolvedValue([]);
    HTMLDialogElement.prototype.showModal = jest.fn(function () {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function () {
      this.removeAttribute("open");
    });
  });

  it("auto-selects the most recently updated dashboard and loads its panels", async () => {
    // Backend returns dashboards sorted by lastUpdated desc — most recently updated is first.
    fetchDashboardsMock.mockResolvedValue([
      {
        id: "dashboard-2",
        name: "Executive",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T11:00:00Z",
          lastUpdated: "2026-03-14T12:00:00Z",
        },
        appearance: defaultDashboardAppearance,
        layout: defaultDashboardLayout,
      },
      {
        id: "dashboard-1",
        name: "Operations",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T10:00:00Z",
          lastUpdated: "2026-03-14T10:00:00Z",
        },
        appearance: defaultDashboardAppearance,
        layout: defaultDashboardLayout,
      },
    ]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(fetchDashboardsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("dashboard-2"));
    expect(screen.getByLabelText("Active dashboard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Executive" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("loads panels lazily when the user changes the selected dashboard", async () => {
    // Backend returns dashboards sorted by lastUpdated desc — most recently updated is first.
    fetchDashboardsMock.mockResolvedValue([
      {
        id: "dashboard-2",
        name: "Executive",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T11:00:00Z",
          lastUpdated: "2026-03-14T12:00:00Z",
        },
        appearance: defaultDashboardAppearance,
        layout: defaultDashboardLayout,
      },
      {
        id: "dashboard-1",
        name: "Operations",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T10:00:00Z",
          lastUpdated: "2026-03-14T10:00:00Z",
        },
        appearance: defaultDashboardAppearance,
        layout: defaultDashboardLayout,
      },
    ]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("dashboard-2"));

    fireEvent.click(screen.getByRole("button", { name: "Operations" }));

    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("dashboard-1"));
    expect(screen.getByRole("button", { name: "Operations" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps panel content visible when switching dashboards", async () => {
    // Backend returns dashboards sorted by lastUpdated desc — most recently updated is first.
    fetchDashboardsMock.mockResolvedValue([
      {
        id: "dashboard-2",
        name: "Executive",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T11:00:00Z",
          lastUpdated: "2026-03-14T12:00:00Z",
        },
        appearance: defaultDashboardAppearance,
        layout: defaultDashboardLayout,
      },
      {
        id: "dashboard-1",
        name: "Operations",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T10:00:00Z",
          lastUpdated: "2026-03-14T10:00:00Z",
        },
        appearance: defaultDashboardAppearance,
        layout: defaultDashboardLayout,
      },
    ]);
    fetchPanelsMock.mockImplementation(async (dashboardId: string) =>
      dashboardId === "dashboard-1"
        ? [
            {
              id: "panel-1",
              dashboardId,
              title: "CPU Usage",
              type: "output" as const,
              meta: {
                createdBy: "system",
                createdAt: "2026-03-14T12:00:00Z",
                lastUpdated: "2026-03-14T12:30:00Z",
              },
              appearance: defaultPanelAppearance,
              config: { outputId: "output-1" },
            },
          ]
        : [
            {
              id: "panel-2",
              dashboardId,
              title: "Revenue Pulse",
              type: "output" as const,
              meta: {
                createdBy: "system",
                createdAt: "2026-03-14T13:00:00Z",
                lastUpdated: "2026-03-14T13:30:00Z",
              },
              appearance: defaultPanelAppearance,
              config: { outputId: "output-2" },
            },
          ],
    );

    renderApp();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Revenue Pulse" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Operations" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "CPU Usage" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Move CPU Usage panel" })).toBeInTheDocument();
  });

  // HEL-745: F-082 had left the top-bar icon as the single canonical theme
  // toggle; this ticket removed it too — the toggle now lives exclusively in
  // Settings' Appearance section (see SettingsPage.test.tsx for its coverage,
  // moved from the "toggles theme from the top-bar toggle button" test that
  // used to live here). This test guards the command bar staying empty of it.
  it("renders no theme-toggle button in the command bar", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));

    expect(screen.queryByRole("button", { name: "Switch to light theme" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch to dark theme" })).not.toBeInTheDocument();
  });

  it("collapses and expands the dashboard list", async () => {
    fetchDashboardsMock.mockResolvedValue([
      {
        id: "dashboard-1",
        name: "Operations",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T10:00:00Z",
          lastUpdated: "2026-03-14T10:00:00Z",
        },
        appearance: defaultDashboardAppearance,
        layout: defaultDashboardLayout,
      },
    ]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    // F-018: the toggle is a single, properly-sized/labeled control now
    // (dynamic aria-label, not two separate fixed-text buttons) — collapsing
    // no longer removes the top-level nav (it becomes an icon rail), only
    // the dashboards list below it.
    const collapseButton = await screen.findByRole("button", { name: "Collapse sidebar" });
    // HEL-718: the toggle migrated onto the shared IconButton primitive —
    // verifies its visible tooltip survived alongside the accessible name.
    expect(collapseButton).toHaveAttribute("title", "Collapse sidebar");
    fireEvent.click(collapseButton);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: "Dashboards" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument(),
    );
  });

  it("saves dashboard appearance changes", async () => {
    fetchDashboardsMock.mockResolvedValue([
      {
        id: "dashboard-1",
        name: "Operations",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T10:00:00Z",
          lastUpdated: "2026-03-14T10:00:00Z",
        },
        appearance: defaultDashboardAppearance,
        layout: defaultDashboardLayout,
      },
    ]);
    fetchPanelsMock.mockResolvedValue([]);
    updateDashboardAppearanceMock.mockResolvedValue({
      id: "dashboard-1",
      name: "Operations",
      meta: {
        createdBy: "system",
        createdAt: "2026-03-14T10:00:00Z",
        lastUpdated: "2026-03-14T11:00:00Z",
      },
      appearance: {
        background: "#123456",
        gridBackground: "#234567",
      },
      layout: defaultDashboardLayout,
    });

    renderApp();

    const customizeDashboardButton = await screen.findByRole("button", {
      name: "Customize dashboard appearance",
    });
    fireEvent.click(customizeDashboardButton);

    await waitFor(() =>
      expect(screen.getByLabelText("Dashboard background color")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Dashboard background color"), {
      target: { value: "#123456" },
    });
    fireEvent.change(screen.getByLabelText("Dashboard grid background color"), {
      target: { value: "#234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save dashboard style" }));

    await waitFor(() =>
      expect(updateDashboardAppearanceMock).toHaveBeenCalledWith("dashboard-1", {
        background: "#123456",
        gridBackground: "#234567",
      }),
    );
  });

  it("renders the Data Pipelines nav link and navigates to /pipelines", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    // Scoped to the desktop sidebar landmark: BottomNav (hidden >=768px via
    // CSS, which jsdom doesn't evaluate) also renders a "Data Pipelines"
    // link, so an unscoped query would be ambiguous.
    const sidebarNav = await screen.findByRole("navigation", { name: "Main navigation" });
    const pipelinesLink = within(sidebarNav).getByRole("link", { name: "Data Pipelines" });
    expect(pipelinesLink).toBeInTheDocument();
    expect(pipelinesLink).toHaveAttribute("href", "/pipelines");

    fireEvent.click(pipelinesLink);

    // HEL-554: with zero dashboards, the onboarding checklist's own
    // fetch-trigger effect (visible on "/") already warms the pipelines
    // fetch before this click, so by the time `/pipelines` mounts, both the
    // sidebar's own empty-state "+"/CTA AND the main page's empty-state CTA
    // can legitimately coexist — scope to the main content landmark (the
    // same disambiguation this test already applies to the sidebar nav
    // link above) so the query isn't ambiguous across all three.
    const main = screen.getByRole("main");
    await waitFor(() =>
      expect(within(main).getByRole("button", { name: "New pipeline" })).toBeInTheDocument(),
    );
  });

  it("renders the Data Sources nav link pointing to /sources in the sidebar", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    const sidebarNav = await screen.findByRole("navigation", { name: "Main navigation" });
    const dataSourcesLink = within(sidebarNav).getByRole("link", { name: "Data Sources" });
    expect(dataSourcesLink).toBeInTheDocument();
    expect(dataSourcesLink).toHaveAttribute("href", "/sources");
  });

  it("shows 'Data Pipelines' breadcrumb when route is /pipelines", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp({ initialPath: "/pipelines" });

    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
        "Data Pipelines",
      ),
    );
  });

  // HEL-664 (tasks.md 4.1/4.2/4.2a) — the /chat nav entry, route, and
  // breadcrumb, mirroring the Metrics tests immediately above. F-009/F-085:
  // the nav label/breadcrumb are "Assistant" now (the interaction surfaces
  // this destination opens onto already said "Assistant"); the route path
  // (/chat) is unchanged.
  it("renders an Assistant nav link pointing to /chat in the sidebar", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    const sidebarNav = await screen.findByRole("navigation", { name: "Main navigation" });
    const chatLink = within(sidebarNav).getByRole("link", { name: "Assistant" });
    expect(chatLink).toBeInTheDocument();
    expect(chatLink).toHaveAttribute("href", "/chat");
  });

  it("navigates to /chat and renders ChatPage", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(fetchDashboardsMock).toHaveBeenCalledTimes(1));

    const sidebarNav = screen.getByRole("navigation", { name: "Main navigation" });
    fireEvent.click(within(sidebarNav).getByRole("link", { name: "Assistant" }));

    await waitFor(() => expect(document.querySelector(".chat-page")).toBeInTheDocument());
  });

  it("shows 'Assistant' breadcrumb when route is /chat", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp({ initialPath: "/chat" });

    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Assistant"),
    );
  });

  // skeptic-final-1.md change request 1 — `breadcrumbItemName` (App.tsx) had
  // no "chat" arm, so the breadcrumb (and the mobile pill's "current:" label)
  // never reflected the selected conversation's title, unlike every sibling
  // Redux-selection section (e.g. pipelines). Mirrors the /pipelines
  // breadcrumb-reflects-selection test above, for both the fallback-to-first
  // case and an explicit desktop-sidebar selection.
  it("shows the fallback-selected (first) conversation's title in the breadcrumb when nothing is explicitly selected", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);
    listConversationsMock.mockResolvedValue([
      {
        id: "conv-1",
        title: "Netflix dashboard build",
        pinned: false,
        updatedAt: "2026-08-01T00:00:00Z",
      },
      {
        id: "conv-2",
        title: "Revenue pipeline debug",
        pinned: false,
        updatedAt: "2026-08-02T00:00:00Z",
      },
    ]);

    renderApp({ initialPath: "/chat" });

    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
        "Netflix dashboard build",
      ),
    );
  });

  it("updates the breadcrumb to the selected conversation's title after selecting from the desktop sidebar", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);
    listConversationsMock.mockResolvedValue([
      {
        id: "conv-1",
        title: "Netflix dashboard build",
        pinned: false,
        updatedAt: "2026-08-01T00:00:00Z",
      },
      {
        id: "conv-2",
        title: "Revenue pipeline debug",
        pinned: false,
        updatedAt: "2026-08-02T00:00:00Z",
      },
    ]);

    renderApp({ initialPath: "/chat" });

    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
        "Netflix dashboard build",
      ),
    );

    // The phone sheet is closed here, so this is unambiguously the desktop
    // sidebar's own conversation row button.
    fireEvent.click(await screen.findByRole("button", { name: "Revenue pipeline debug" }));

    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
        "Revenue pipeline debug",
      ),
    );
  });

  // Task 5.1 — the phone section-item sheet reuses MobileNavSheet for
  // /sources, /pipelines, not just dashboards. These two tests
  // exercise the /pipelines wiring specifically: `toHref`-style navigation
  // (not a Redux select) and the empty-state message, per
  // notes/mobile-pwa-handoff.md §W3.3 ("every section is a picker, never a
  // dead end"). jsdom doesn't evaluate the `<768px` CSS gate, so the
  // phone title control is queryable regardless of viewport.
  it("phone section sheet on /pipelines navigates to the tapped pipeline's detail route", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);
    // `mockResolvedValue` (not `...Once`) — both `SidebarBody` (gated on
    // `status === "idle"`) and `PipelinesPage` (unconditional) independently
    // dispatch `fetchPipelines()` on mount, so `getPipelines()` is called
    // twice; whichever call resolves last wins in the reducer, so both need
    // the same data or the test is order-dependent/flaky.
    getPipelinesMock.mockResolvedValue([
      {
        id: "pipe-1",
        name: "Revenue ETL",
        roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Profit" }],
        lastRunStatus: "succeeded",
        lastRunAt: "2026-03-14T10:00:00Z",
        lastRunRowCount: 10,
      },
    ]);

    renderApp({ initialPath: "/pipelines" });

    const titleButton = await screen.findByRole("button", { name: /Switch data pipelines/i });
    fireEvent.click(titleButton);

    // Exact name (not a substring regex): the desktop sidebar's
    // `ActionsMenu` trigger for the same pipeline is aria-labelled
    // "Revenue ETL actions", which a loose `/Revenue ETL/` match would also
    // catch since jsdom doesn't hide it via the `<768px` CSS gate.
    const sheetItem = await screen.findByRole("button", { name: "Revenue ETL" });
    fireEvent.click(sheetItem);

    // Selecting navigates (not a Redux select), and dismisses the sheet.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
        "Revenue ETL",
      ),
    );
  });

  // HEL-773 task 5.7 — the bare-`<p>` `emptyMessage` string this test used to
  // assert on is retired; pipelines is a section WITH a create action, so
  // its empty branch now renders the shared `EmptyState` primitive carrying
  // that action's CTA (AC8/AC9), not message-only.
  it("phone section sheet on /pipelines shows the shared EmptyState with its create-pipeline CTA when there are no pipelines", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);
    getPipelinesMock.mockResolvedValue([]);

    renderApp({ initialPath: "/pipelines" });

    const titleButton = await screen.findByRole("button", { name: /Switch data pipelines/i });
    fireEvent.click(titleButton);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Build your first pipeline")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "New pipeline" })).toBeInTheDocument();
  });

  // HEL-724 — `usePickerSelection` is the single implementation driving both
  // the breadcrumb item name and the phone sheet's selection for this section
  // (design.md tasks 1.3/3.3 — the two used to be independent switches in
  // App.tsx that could silently drift). Sources has since moved from Redux
  // selection to NAVIGATION, like pipelines: `/sources` is a section
  // overview and `/sources/:id` the detail.
  it("names no source in the breadcrumb on the section overview, where none is selected", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);
    fetchSourcesMock.mockResolvedValue([
      {
        id: "src-1",
        name: "Profit CSV",
        type: "static",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        inferredSchema: [],
      },
      {
        id: "src-2",
        name: "Ops SQL",
        type: "static",
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        inferredSchema: [],
      },
    ]);

    renderApp({ initialPath: "/sources" });

    // The breadcrumb resolves to the section alone. It used to name
    // `items[0]` ("Profit CSV") via a `selectedSourceId ?? items[0]` fallback,
    // which claimed a source was open when none was — the same arbitrary
    // fallback that made a bare `/sources` render one source's detail.
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
        "Data Sources",
      ),
    );
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).not.toHaveTextContent(
      "Profit CSV",
    );
  });

  it("phone section sheet on /sources navigates to the chosen source's detail route", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);
    fetchSourcesMock.mockResolvedValue([
      {
        id: "src-1",
        name: "Profit CSV",
        type: "static",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        inferredSchema: [],
      },
      {
        id: "src-2",
        name: "Ops SQL",
        type: "static",
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        inferredSchema: [],
      },
    ]);

    const { store } = renderApp({ initialPath: "/sources" });

    const titleButton = await screen.findByRole("button", { name: /Switch data sources/i });
    fireEvent.click(titleButton);

    // Scoped to the sheet's dialog: the desktop sidebar renders a same-named
    // button for the identical source, mirroring the pre-existing
    // /chat/"Revenue pipeline debug" ambiguity note below.
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ops SQL" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Sources moved from Redux selection to route-driven selection when
    // `/sources` became a section overview and `/sources/:id` the detail, so
    // the observable outcome is the resolved route, not
    // `sources.selectedSourceId`. Asserted via the breadcrumb rather than
    // `window.location`: these tests run under MemoryRouter, whose history is
    // in-memory and never touches the jsdom URL.
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Ops SQL"),
    );
  });

  // HEL-664 (tasks.md 4.10/4.11, design.md D2) — chat is a Redux-selection
  // section (like sources), not navigation like pipelines: selecting
  // via the phone sheet must dispatch the identical `setSelectedConversationId`
  // action the desktop sidebar's `onSelect` would for the same conversation.
  it("phone section sheet on /chat dispatches the same selection action the desktop sidebar would", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);
    listConversationsMock.mockResolvedValue([
      {
        id: "conv-1",
        title: "Netflix dashboard build",
        pinned: false,
        updatedAt: "2026-08-01T00:00:00Z",
      },
      {
        id: "conv-2",
        title: "Revenue pipeline debug",
        pinned: false,
        updatedAt: "2026-08-02T00:00:00Z",
      },
    ]);

    const { store } = renderApp({ initialPath: "/chat" });

    const titleButton = await screen.findByRole("button", { name: /Switch assistant/i });
    fireEvent.click(titleButton);

    // Scoped to the sheet's dialog: the desktop sidebar (not hidden by jsdom,
    // which doesn't evaluate the <768px CSS gate) renders a same-named button
    // for the identical conversation, mirroring the pipelines test's own
    // "Revenue ETL" ambiguity note above.
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revenue pipeline debug" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        (store.getState() as { assistantConversations: { selectedConversationId: string | null } })
          .assistantConversations.selectedConversationId,
      ).toBe("conv-2"),
    );
    // skeptic-final-1.md change request 1: the mobile pill's "current:" label
    // (and the desktop breadcrumb) must reflect the newly-selected
    // conversation's title, not stay stuck on the section label.
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
        "Revenue pipeline debug",
      ),
    );
  });

  // HEL-789's surviving half — Assistant now has the same shared
  // create-action shape every other section does (`useCreateConversationAction`),
  // so its empty branch renders the shared `EmptyState` WITH a "New chat"
  // CTA, matching the pipelines/sources/dashboards case, closing what used
  // to be the one section with no mobile create-action parity.
  it("phone section sheet on /chat shows the shared EmptyState with a 'New chat' CTA when there are no conversations", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);
    listConversationsMock.mockResolvedValue([]);

    renderApp({ initialPath: "/chat" });

    const titleButton = await screen.findByRole("button", { name: /Switch assistant/i });
    fireEvent.click(titleButton);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("No conversations yet")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "New chat" })).toBeInTheDocument();
  });

  it("redirects unauthenticated user from /pipelines to /login", async () => {
    // App's rehydrateAuth() always fires on mount (HEL-287: identity is the
    // httpOnly cookie, not a token this test can pre-seed/omit) — reject
    // getMeRequest for this test only so rehydration doesn't re-authenticate
    // the "no cookie" scenario back to authenticated.
    getMeRequestMock.mockRejectedValueOnce(new Error("no session"));
    renderApp({ initialPath: "/pipelines", authenticated: false });

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument(),
    );
  });

  it("saves panel appearance changes via the API and returns to view mode", async () => {
    fetchDashboardsMock.mockResolvedValue([
      {
        id: "dashboard-1",
        name: "Operations",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T10:00:00Z",
          lastUpdated: "2026-03-14T10:00:00Z",
        },
        appearance: defaultDashboardAppearance,
        layout: defaultDashboardLayout,
      },
    ]);
    const panelBase = makeOutputPanel({
      id: "panel-1",
      dashboardId: "dashboard-1",
      title: "Revenue Pulse",
      meta: {
        createdBy: "system",
        createdAt: "2026-03-14T13:00:00Z",
        lastUpdated: "2026-03-14T13:30:00Z",
      },
      appearance: defaultPanelAppearance,
    });
    fetchPanelsMock.mockResolvedValue([panelBase]);
    updatePanelAppearanceMock.mockResolvedValue({
      ...panelBase,
      appearance: { background: "#101828", color: "#f8fafc", transparency: 0.35 },
    });

    renderApp();

    const panelActionsButton = await screen.findByRole("button", {
      name: "Revenue Pulse panel actions",
    });
    fireEvent.click(panelActionsButton);

    const customizePanelButton = await screen.findByRole("menuitem", { name: "Customize" });
    fireEvent.click(customizePanelButton);

    // F-123: "Customize" opens the modal directly in edit mode now (not the read-only view a
    // plain card click lands on), so there's no separate "Edit panel" click to fire first.
    await waitFor(() =>
      expect(screen.getByLabelText("Revenue Pulse background color")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Revenue Pulse background color"), {
      target: { value: "#101828" },
    });
    fireEvent.change(screen.getByLabelText("Revenue Pulse text color"), {
      target: { value: "#f8fafc" },
    });
    fireEvent.change(screen.getByLabelText("Revenue Pulse transparency"), {
      target: { value: "35" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    // Appearance is accumulated via accumulatePanelUpdate (not sent directly to the API).
    // The modal transitions to view mode — Edit button becomes visible again.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    expect(updatePanelAppearanceMock).not.toHaveBeenCalled();
  });

  // HEL-665 tasks.md 5.9-5.14 — the command-bar quick-launcher trigger + overlay (design.md D5-D7).
  describe("quick-launcher", () => {
    // A real, non-empty conversation (rather than an empty list) so every test below can wait for
    // its content to settle -- the fetch-and-select round trip resolving is what the awaited
    // assertion actually depends on, keeping every state update inside act().
    beforeEach(() => {
      listConversationsMock.mockResolvedValue([
        {
          id: "conv-1",
          title: "Netflix dashboard build",
          pinned: false,
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ]);
      getConversationMock.mockResolvedValue({
        id: "conv-1",
        title: "Netflix dashboard build",
        pinned: false,
        updatedAt: "2026-08-01T00:00:00Z",
        transcript: [{ role: "user", content: [{ blockType: "text", text: "Hello there" }] }],
      });
    });

    it("shows the quick-launcher trigger on a non-chat route", async () => {
      fetchDashboardsMock.mockResolvedValue([]);
      fetchPanelsMock.mockResolvedValue([]);

      renderApp({ initialPath: "/pipelines" });

      expect(await screen.findByRole("button", { name: "Open assistant" })).toBeInTheDocument();
    });

    it("clicking the trigger opens the overlay without changing the URL", async () => {
      fetchDashboardsMock.mockResolvedValue([]);
      fetchPanelsMock.mockResolvedValue([]);

      renderApp({ initialPath: "/pipelines" });

      const trigger = await screen.findByRole("button", { name: "Open assistant" });
      fireEvent.click(trigger);

      const dialog = screen.getByRole("dialog", { name: "Assistant conversation", hidden: true });
      expect(dialog).toHaveAttribute("open");
      expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
        "Data Pipelines",
      );
      await screen.findByText("Hello there");
    });

    // HEL-496 `palette-takes-k-launcher-moves` resolution — the command palette now owns
    // Cmd/Ctrl+K; the quick-launcher rebinds to Cmd/Ctrl+J.
    it("opens the overlay via the Cmd/Ctrl+J keyboard shortcut", async () => {
      fetchDashboardsMock.mockResolvedValue([]);
      fetchPanelsMock.mockResolvedValue([]);

      renderApp({ initialPath: "/pipelines" });
      await screen.findByRole("button", { name: "Open assistant" });

      fireEvent.keyDown(window, { key: "j", ctrlKey: true });

      const dialog = screen.getByRole("dialog", { name: "Assistant conversation", hidden: true });
      expect(dialog).toHaveAttribute("open");
      await screen.findByText("Hello there");
    });

    it("Cmd/Ctrl+K no longer opens the quick-launcher (it opens the command palette instead)", async () => {
      fetchDashboardsMock.mockResolvedValue([]);
      fetchPanelsMock.mockResolvedValue([]);

      renderApp({ initialPath: "/pipelines" });
      await screen.findByRole("button", { name: "Open assistant" });

      fireEvent.keyDown(window, { key: "k", ctrlKey: true });

      // Neither dialog exposes role="dialog" via testing-library's role query while closed (no
      // `open` attribute), so assert directly against the DOM nodes by their distinguishing class.
      const quickLauncherDialog = document.querySelector(".quick-launcher-overlay");
      expect(quickLauncherDialog).not.toHaveAttribute("open");
      const paletteDialog = document.querySelector(".command-palette");
      expect(paletteDialog).toHaveAttribute("open");
    });

    it("closes the overlay on Escape", async () => {
      fetchDashboardsMock.mockResolvedValue([]);
      fetchPanelsMock.mockResolvedValue([]);

      renderApp({ initialPath: "/pipelines" });
      fireEvent.click(await screen.findByRole("button", { name: "Open assistant" }));

      const dialog = screen.getByRole("dialog", { name: "Assistant conversation", hidden: true });
      expect(dialog).toHaveAttribute("open");
      await screen.findByText("Hello there");

      fireEvent.keyDown(window, { key: "Escape" });

      await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    });

    it("the Browse all conversations link navigates to /chat and closes the overlay", async () => {
      fetchDashboardsMock.mockResolvedValue([]);
      fetchPanelsMock.mockResolvedValue([]);

      renderApp({ initialPath: "/pipelines" });
      fireEvent.click(await screen.findByRole("button", { name: "Open assistant" }));

      const dialog = screen.getByRole("dialog", { name: "Assistant conversation", hidden: true });
      await screen.findByText("Hello there");
      fireEvent.click(screen.getByRole("link", { name: "Browse all conversations →" }));

      await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
      await waitFor(() => expect(document.querySelector(".chat-page")).toBeInTheDocument());
    });

    it("shows the same active conversation the /chat nav page shows for the same selection", async () => {
      fetchDashboardsMock.mockResolvedValue([]);
      fetchPanelsMock.mockResolvedValue([]);

      renderApp({ initialPath: "/chat" });

      // /chat itself shows the shared conversation content.
      await waitFor(() => expect(screen.getByText("Hello there")).toBeInTheDocument());

      // Navigate away, then open the quick-launcher from a different route — the SAME Redux
      // slice/component means the same content renders again, with no second independent copy.
      const sidebarNav = screen.getByRole("navigation", { name: "Main navigation" });
      fireEvent.click(within(sidebarNav).getByRole("link", { name: "Data Pipelines" }));
      await waitFor(() => expect(screen.queryByText("Hello there")).not.toBeInTheDocument());

      fireEvent.click(await screen.findByRole("button", { name: "Open assistant" }));

      await waitFor(() => expect(screen.getByText("Hello there")).toBeInTheDocument());
    });
  });
});
