import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { dataTypesReducer } from "../features/dataTypes/dataTypesSlice";
import { dashboardsReducer } from "../features/dashboards/dashboardsSlice";
import { layoutHistoryReducer } from "../features/layout/layoutHistorySlice";
import { panelsReducer } from "../features/panels/panelsSlice";
import {
  fetchDashboards as fetchDashboardsRequest,
  updateDashboardAppearance as updateDashboardAppearanceRequest,
  updateDashboardLayout as updateDashboardLayoutRequest,
} from "../services/dashboardService";
import {
  fetchPanels as fetchPanelsRequest,
  updatePanelAppearance as updatePanelAppearanceRequest,
} from "../services/panelService";
import { OverlayProvider } from "../components/OverlayProvider";
import { ThemeProvider } from "../theme/ThemeProvider";
import { App } from "./App";

jest.mock("../services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelBinding: jest.fn(),
}));

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypes: jest.fn().mockResolvedValue([]),
}));

const fetchDashboardsMock = jest.mocked(fetchDashboardsRequest);
const fetchPanelsMock = jest.mocked(fetchPanelsRequest);
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

function renderApp() {
  const store = configureStore({
    reducer: {
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      panels: panelsReducer,
      dataTypes: dataTypesReducer,
    },
  });

  return {
    store,
    ...render(
      <MemoryRouter>
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
    expect(screen.getByText("Active dashboard")).toBeInTheDocument();
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
              typeId: null,
              fieldMapping: null,
              refreshInterval: null,
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
              typeId: null,
              fieldMapping: null,
              refreshInterval: null,
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

  it("toggles theme from the app header", async () => {
    fetchDashboardsMock.mockResolvedValue([]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));

    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));

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

  it("saves panel appearance changes", async () => {
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
    fetchPanelsMock.mockResolvedValue([
      {
        id: "panel-1",
        dashboardId: "dashboard-1",
        title: "Revenue Pulse",
        type: "metric" as const,
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T13:00:00Z",
          lastUpdated: "2026-03-14T13:30:00Z",
        },
        appearance: defaultPanelAppearance,
        typeId: null,
        fieldMapping: null,
        refreshInterval: null,
      },
    ]);
    updatePanelAppearanceMock.mockResolvedValue({
      id: "panel-1",
      dashboardId: "dashboard-1",
      title: "Revenue Pulse",
      type: "metric" as const,
      meta: {
        createdBy: "system",
        createdAt: "2026-03-14T13:00:00Z",
        lastUpdated: "2026-03-14T14:00:00Z",
      },
      appearance: {
        background: "#101828",
        color: "#f8fafc",
        transparency: 0.35,
      },
      typeId: null,
      fieldMapping: null,
      refreshInterval: null,
    });

    renderApp();

    const panelActionsButton = await screen.findByRole("button", {
      name: "Revenue Pulse panel actions",
    });
    fireEvent.click(panelActionsButton);

    const customizePanelButton = await screen.findByRole("menuitem", { name: "Customize" });
    fireEvent.click(customizePanelButton);

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
    fireEvent.click(screen.getByRole("button", { name: "Save panel style" }));

    await waitFor(() =>
      expect(updatePanelAppearanceMock).toHaveBeenCalledWith("panel-1", {
        background: "#101828",
        color: "#f8fafc",
        transparency: 0.35,
      }),
    );
  });
});
