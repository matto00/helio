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

    expect(screen.getByRole("heading", { name: "Panels" })).toBeInTheDocument();
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

    expect(screen.getByRole("heading", { name: "Panels" })).toBeInTheDocument();
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
    });
    fetchPanelsMock.mockResolvedValue([
      {
        id: "panel-1",
        dashboardId: "dashboard-1",
        title: "Revenue Pulse",
        type: "metric" as const,
        meta: defaultMeta,
        appearance: defaultPanelAppearance,
      },
      {
        id: "panel-2",
        dashboardId: "dashboard-1",
        title: "Forecast",
        type: "metric" as const,
        meta: defaultMeta,
        appearance: defaultPanelAppearance,
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
      expect(createPanelMock).toHaveBeenCalledWith("dashboard-1", "Forecast", undefined),
    );
    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("dashboard-1"));
    expect(screen.getByRole("heading", { name: "Forecast" })).toBeInTheDocument();
  });
});
