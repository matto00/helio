import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  createPanel as createPanelRequest,
  fetchPanels as fetchPanelsRequest,
} from "../services/panelService";
import { renderWithStore } from "../test/renderWithStore";
import { PanelList } from "./PanelList";

jest.mock("../services/panelService", () => ({
  createPanel: jest.fn(),
  fetchPanels: jest.fn(),
  updatePanelAppearance: jest.fn(),
}));

jest.mock("../services/authService", () => ({
  updateUserPreferencesRequest: jest.fn().mockResolvedValue({ accentColor: null, zoomLevels: {} }),
}));

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

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

const createPanelMock = jest.mocked(createPanelRequest);
const fetchPanelsMock = jest.mocked(fetchPanelsRequest);

describe("PanelList", () => {
  beforeEach(() => {
    createPanelMock.mockReset();
    fetchPanelsMock.mockReset();
  });

  it("renders a prompt when no dashboard has been selected yet", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [],
        selectedDashboardId: null,
      },
      panels: {
        items: [],
        status: "idle",
      },
    });

    expect(screen.getByText("Select a dashboard to view panels.")).toBeInTheDocument();
  });

  it("renders an error fallback when panel loading fails", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "failed",
        error: "Failed to load panels.",
      },
    });

    expect(screen.getByText("Failed to load panels.")).toBeInTheDocument();
  });

  it("renders the empty-state message when a selected dashboard has no panels", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
    });

    const emptyState = screen.getByRole("heading", { name: "No panels yet" }).closest("div")!;
    expect(emptyState).toBeInTheDocument();
    expect(
      within(emptyState).getByText("Add a panel to start building your dashboard"),
    ).toBeInTheDocument();
    expect(within(emptyState).getByRole("button", { name: "Add panel" })).toBeInTheDocument();
  });

  it("clicking 'Add panel' in the empty state opens the create form", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
    });

    const emptyState = screen.getByRole("heading", { name: "No panels yet" }).closest("div")!;
    fireEvent.click(within(emptyState).getByRole("button", { name: "Add panel" }));

    expect(screen.getByLabelText("Panel title")).toBeInTheDocument();
  });

  it("renders the type selector with metric pre-selected when create form opens", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: { items: [], loadedDashboardId: "dashboard-1", status: "succeeded" },
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);

    expect(screen.getByRole("radio", { name: "Metric" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Chart" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Text" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Table" })).not.toBeChecked();
  });

  it("submitting without changing type calls createPanel with type metric", async () => {
    createPanelMock.mockResolvedValue({
      id: "panel-2",
      dashboardId: "dashboard-1",
      title: "New Panel",
      type: "metric" as const,
      meta: defaultMeta,
      appearance: defaultPanelAppearance,
      typeId: null,
      fieldMapping: null,
      refreshInterval: null,
    });
    fetchPanelsMock.mockResolvedValue([]);

    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: { items: [], loadedDashboardId: "dashboard-1", status: "succeeded" },
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "New Panel" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith("dashboard-1", "New Panel", "metric"),
    );
  });

  it("selecting chart and submitting calls createPanel with type chart", async () => {
    createPanelMock.mockResolvedValue({
      id: "panel-2",
      dashboardId: "dashboard-1",
      title: "Revenue Chart",
      type: "chart" as const,
      meta: defaultMeta,
      appearance: defaultPanelAppearance,
      typeId: null,
      fieldMapping: null,
      refreshInterval: null,
    });
    fetchPanelsMock.mockResolvedValue([]);

    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: { items: [], loadedDashboardId: "dashboard-1", status: "succeeded" },
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "Revenue Chart" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Chart" }));
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith("dashboard-1", "Revenue Chart", "chart"),
    );
  });

  it("type selector resets to metric after successful create", async () => {
    createPanelMock.mockResolvedValue({
      id: "panel-2",
      dashboardId: "dashboard-1",
      title: "Table Panel",
      type: "table" as const,
      meta: defaultMeta,
      appearance: defaultPanelAppearance,
      typeId: null,
      fieldMapping: null,
      refreshInterval: null,
    });
    fetchPanelsMock.mockResolvedValue([]);

    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: { items: [], loadedDashboardId: "dashboard-1", status: "succeeded" },
    });

    // Open form, select table, create
    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    fireEvent.click(screen.getByRole("radio", { name: "Table" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Table Panel" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() => expect(createPanelMock).toHaveBeenCalled());

    // Reopen form — selector should be back to metric
    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    expect(screen.getByRole("radio", { name: "Metric" })).toBeChecked();
  });

  it("renders panel content inside the dashboard grid foundation", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [
          {
            id: "panel-1",
            dashboardId: "dashboard-1",
            title: "Revenue Pulse",
            type: "metric" as const,
            meta: defaultMeta,
            appearance: defaultPanelAppearance,
          },
        ],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
    });

    expect(screen.getByRole("heading", { name: "Revenue Pulse" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Revenue Pulse panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revenue Pulse panel actions" })).toBeInTheDocument();
  });

  it("creates a panel inline and refreshes selected dashboard panels", async () => {
    createPanelMock.mockResolvedValue({
      id: "panel-2",
      dashboardId: "dashboard-1",
      title: "Forecast",
      type: "metric" as const,
      meta: defaultMeta,
      appearance: defaultPanelAppearance,
      typeId: null,
      fieldMapping: null,
      refreshInterval: null,
    });
    fetchPanelsMock.mockResolvedValue([
      {
        id: "panel-1",
        dashboardId: "dashboard-1",
        title: "Revenue Pulse",
        type: "metric" as const,
        meta: defaultMeta,
        appearance: defaultPanelAppearance,
        typeId: null,
        fieldMapping: null,
        refreshInterval: null,
      },
      {
        id: "panel-2",
        dashboardId: "dashboard-1",
        title: "Forecast",
        type: "metric" as const,
        meta: defaultMeta,
        appearance: defaultPanelAppearance,
        typeId: null,
        fieldMapping: null,
        refreshInterval: null,
      },
    ]);

    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [
          {
            id: "panel-1",
            dashboardId: "dashboard-1",
            title: "Revenue Pulse",
            type: "metric" as const,
            meta: defaultMeta,
            appearance: defaultPanelAppearance,
          },
        ],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add panel" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Forecast" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith("dashboard-1", "Forecast", "metric"),
    );
    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("dashboard-1"));
    expect(screen.getByRole("heading", { name: "Forecast" })).toBeInTheDocument();
  });

  it("zoom controls appear when a dashboard is selected", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        token: "test-token",
      },
    });

    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("clicking zoom in increases the zoom level", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        token: "test-token",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeInTheDocument();
  });

  it("clicking zoom out decreases the zoom level", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [
          {
            id: "dashboard-1",
            name: "Operations",
            meta: defaultMeta,
            appearance: defaultDashboardAppearance,
            layout: defaultDashboardLayout,
          },
        ],
        selectedDashboardId: "dashboard-1",
      },
      panels: {
        items: [],
        loadedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        token: "test-token",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("90%")).toBeInTheDocument();
  });
});
