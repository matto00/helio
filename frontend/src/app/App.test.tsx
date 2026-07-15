import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { authReducer } from "../features/auth/state/authSlice";
import { getMeRequest } from "../features/auth/services/authService";
import { dataTypesReducer } from "../features/dataTypes/state/dataTypesSlice";
import { dashboardsReducer } from "../features/dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../features/layout/state/layoutHistorySlice";
import { panelsReducer } from "../features/panels/state/panelsSlice";
import { pipelinesReducer } from "../features/pipelines/state/pipelinesSlice";
import { getPipelines as getPipelinesRequest } from "../features/pipelines/services/pipelineService";
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
import { makeMetricPanel } from "../test/panelFixtures";
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

jest.mock("../features/dataTypes/services/dataTypeService", () => ({
  fetchDataTypes: jest.fn().mockResolvedValue([]),
}));

jest.mock("../features/pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn().mockResolvedValue([]),
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
const updateDashboardAppearanceMock = jest.mocked(updateDashboardAppearanceRequest);
const updateDashboardLayoutMock = jest.mocked(updateDashboardLayoutRequest);
const updatePanelAppearanceMock = jest.mocked(updatePanelAppearanceRequest);

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
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      panels: panelsReducer,
      dataTypes: dataTypesReducer,
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
            },
            status: "authenticated" as const,
          }
        : {
            currentUser: null,
            status: "unauthenticated" as const,
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
              type: "metric" as const,
              meta: {
                createdBy: "system",
                createdAt: "2026-03-14T12:00:00Z",
                lastUpdated: "2026-03-14T12:30:00Z",
              },
              appearance: defaultPanelAppearance,
              config: { dataTypeId: "", fieldMapping: {} },
            },
          ]
        : [
            {
              id: "panel-2",
              dashboardId,
              title: "Revenue Pulse",
              type: "metric" as const,
              meta: {
                createdBy: "system",
                createdAt: "2026-03-14T13:00:00Z",
                lastUpdated: "2026-03-14T13:30:00Z",
              },
              appearance: defaultPanelAppearance,
              config: { dataTypeId: "", fieldMapping: {} },
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

  it("toggles theme from the user menu", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));

    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Switch to light theme" }));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(window.localStorage.getItem("helio-theme")).toBe("light");
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

    const collapseButton = await screen.findByRole("button", { name: "Collapse dashboard list" });
    fireEvent.click(collapseButton);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Expand dashboard list" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: "Dashboards" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand dashboard list" }));
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

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "New pipeline" })).toBeInTheDocument(),
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

  it("renders a Type Registry nav link in the sidebar", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(fetchDashboardsMock).toHaveBeenCalledTimes(1));
    const sidebarNav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(sidebarNav).getByRole("link", { name: "Type Registry" })).toBeInTheDocument();
  });

  it("navigates to /registry and renders the Type Registry page", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(fetchDashboardsMock).toHaveBeenCalledTimes(1));

    const sidebarNav = screen.getByRole("navigation", { name: "Main navigation" });
    fireEvent.click(within(sidebarNav).getByRole("link", { name: "Type Registry" }));

    // The in-page heading was dropped (top breadcrumb shows the section).
    // Verify the page rendered by looking for its container.
    await waitFor(() => expect(document.querySelector(".type-registry-page")).toBeInTheDocument());
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

  // Task 5.1 — the phone section-item sheet reuses MobileNavSheet for
  // /sources, /pipelines, /registry, not just dashboards. These two tests
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
        sourceDataSourceId: "src-1",
        sourceDataSourceName: "Profit",
        outputDataTypeName: "RevenueRow",
        outputDataTypeId: "type-1",
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

  it("phone section sheet on /pipelines shows the empty-state message when there are no pipelines", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);
    getPipelinesMock.mockResolvedValue([]);

    renderApp({ initialPath: "/pipelines" });

    const titleButton = await screen.findByRole("button", { name: /Switch data pipelines/i });
    fireEvent.click(titleButton);

    expect(await screen.findByText("No pipelines yet.")).toBeInTheDocument();
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
    const panelBase = makeMetricPanel({
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

    // Modal opens in view mode by default, click Edit to enter edit mode
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

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
});
