import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  createPanel as createPanelRequest,
  fetchPanels as fetchPanelsRequest,
} from "../services/panelService";
import { renderWithStore } from "../test/renderWithStore";
import { PanelGrid } from "./PanelGrid";
import { PanelList } from "./PanelList";

// PanelCreationModal uses <dialog> showModal/close which jsdom doesn't implement.
// Stub showModal to set the `open` attribute so dialog contents are accessible.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

jest.mock("./PanelGrid", () => {
  const React = require("react") as typeof import("react");
  return {
    PanelGrid: jest.fn(
      ({ panels }: { panels: { id: string; title: string }[]; zoomLevel?: number }) =>
        React.createElement(
          "div",
          null,
          ...panels.map((p) =>
            React.createElement(
              "div",
              { key: p.id },
              React.createElement("h3", null, p.title),
              React.createElement("button", {
                type: "button",
                "aria-label": `Move ${p.title} panel`,
              }),
              React.createElement("button", {
                type: "button",
                "aria-label": `${p.title} panel actions`,
              }),
            ),
          ),
        ),
    ),
  };
});

const MockPanelGrid = jest.mocked(PanelGrid);

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
    MockPanelGrid.mockClear();
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

  it("clicking 'Add panel' in the empty state opens the creation modal", () => {
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

    // Modal type-select step is shown
    expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chart" })).toBeInTheDocument();
  });

  it("clicking 'Add panel' header button opens the creation modal at type-select step", () => {
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

    // Modal is open at type-select step — no radio buttons, type cards instead
    expect(screen.queryByRole("radio", { name: "Metric" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chart" })).toBeInTheDocument();
  });

  it("selecting metric and submitting calls createPanel with type metric", async () => {
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
      content: null,
      imageUrl: null,
      imageFit: null,
      dividerOrientation: null,
      dividerWeight: null,
      dividerColor: null,
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

    // Open modal, select metric type, enter title, submit
    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
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
      content: null,
      imageUrl: null,
      imageFit: null,
      dividerOrientation: null,
      dividerWeight: null,
      dividerColor: null,
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

    // Open modal, select chart type, enter title, submit
    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "Revenue Chart" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith("dashboard-1", "Revenue Chart", "chart"),
    );
  });

  it("modal resets to type-select step after successful create", async () => {
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
      content: null,
      imageUrl: null,
      imageFit: null,
      dividerOrientation: null,
      dividerWeight: null,
      dividerColor: null,
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

    // Open modal, select table, create
    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Table Panel" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() => expect(createPanelMock).toHaveBeenCalled());

    // Reopen modal — should start at type-select step with no pre-selection
    fireEvent.click(screen.getAllByRole("button", { name: "Add panel" })[0]);
    expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Panel title")).not.toBeInTheDocument();
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

  it("creates a panel via modal and refreshes selected dashboard panels", async () => {
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
      content: null,
      imageUrl: null,
      imageFit: null,
      dividerOrientation: null,
      dividerWeight: null,
      dividerColor: null,
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
        content: null,
        imageUrl: null,
        imageFit: null,
        dividerOrientation: null,
        dividerWeight: null,
        dividerColor: null,
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
        content: null,
        imageUrl: null,
        imageFit: null,
        dividerOrientation: null,
        dividerWeight: null,
        dividerColor: null,
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

    // Open modal, select type, enter title, submit
    fireEvent.click(screen.getByRole("button", { name: "Add panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
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

  it("zoom container receives scale transform and compensated dimensions when zoom is non-default", () => {
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
      auth: {
        status: "authenticated",
        currentUser: {
          id: "user-1",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          preferences: {
            accentColor: null,
            zoomLevels: { "dashboard-1": 1.5 },
          },
        },
        token: "test-token",
      },
    });

    const zoomContainer = document.querySelector(".panel-list__zoom-container") as HTMLElement;
    expect(zoomContainer).not.toBeNull();
    expect(zoomContainer.style.transform).toBe("scale(1.5)");
    expect(zoomContainer.style.transformOrigin).toBe("top left");
    expect(zoomContainer.style.width).toBe(`${100 / 1.5}%`);
    expect(zoomContainer.style.height).toBe(`${100 / 1.5}%`);
  });

  it("zoom level is restored from user preferences when a dashboard is selected", () => {
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
          preferences: {
            accentColor: null,
            zoomLevels: { "dashboard-1": 1.7 },
          },
        },
        token: "test-token",
      },
    });

    expect(screen.getByText("170%")).toBeInTheDocument();
  });

  describe("zoom gesture (Ctrl+scroll and pinch)", () => {
    const gestureStore = {
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
        status: "succeeded" as const,
      },
    };

    it("Ctrl+scroll down (deltaY=100) decreases zoom by 0.1", () => {
      const { container } = renderWithStore(<PanelList />, gestureStore);
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      expect(screen.getByText("100%")).toBeInTheDocument();
      fireEvent.wheel(zoomContainer, { deltaY: 100, ctrlKey: true, deltaMode: 0 });
      expect(screen.getByText("90%")).toBeInTheDocument();
    });

    it("Ctrl+scroll up (deltaY=-100) increases zoom by 0.1", () => {
      const { container } = renderWithStore(<PanelList />, gestureStore);
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      fireEvent.wheel(zoomContainer, { deltaY: -100, ctrlKey: true, deltaMode: 0 });
      expect(screen.getByText("110%")).toBeInTheDocument();
    });

    it("plain scroll (no modifier key) does not change zoom level", () => {
      const { container } = renderWithStore(<PanelList />, gestureStore);
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      fireEvent.wheel(zoomContainer, { deltaY: 100, ctrlKey: false, deltaMode: 0 });
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("zoom is clamped at 0.5 minimum (Ctrl+scroll down at min)", () => {
      const { container } = renderWithStore(<PanelList />, {
        ...gestureStore,
        auth: {
          status: "authenticated" as const,
          currentUser: {
            id: "user-1",
            email: "test@example.com",
            displayName: "Test User",
            avatarUrl: null,
            createdAt: "2026-01-01T00:00:00Z",
            preferences: { accentColor: null, zoomLevels: { "dashboard-1": 0.5 } },
          },
          token: "test-token",
        },
      });
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      expect(screen.getByText("50%")).toBeInTheDocument();
      fireEvent.wheel(zoomContainer, { deltaY: 100, ctrlKey: true, deltaMode: 0 });
      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("zoom is clamped at 2.0 maximum (Ctrl+scroll up at max)", () => {
      const { container } = renderWithStore(<PanelList />, {
        ...gestureStore,
        auth: {
          status: "authenticated" as const,
          currentUser: {
            id: "user-1",
            email: "test@example.com",
            displayName: "Test User",
            avatarUrl: null,
            createdAt: "2026-01-01T00:00:00Z",
            preferences: { accentColor: null, zoomLevels: { "dashboard-1": 2.0 } },
          },
          token: "test-token",
        },
      });
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      expect(screen.getByText("200%")).toBeInTheDocument();
      fireEvent.wheel(zoomContainer, { deltaY: -100, ctrlKey: true, deltaMode: 0 });
      expect(screen.getByText("200%")).toBeInTheDocument();
    });

    it("deltaMode=1 (line) wheel event is normalized correctly (deltaY=1 line to 24px effective)", () => {
      const { container } = renderWithStore(<PanelList />, gestureStore);
      const zoomContainer = container.querySelector(".panel-list__zoom-container")!;
      fireEvent.wheel(zoomContainer, { deltaY: 5, ctrlKey: true, deltaMode: 1 });
      expect(screen.getByText("90%")).toBeInTheDocument();
    });
  });

  it("passes updated zoomLevel to PanelGrid when zoom controls are used", () => {
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

    const initialCall = MockPanelGrid.mock.calls[MockPanelGrid.mock.calls.length - 1][0];
    expect(initialCall.zoomLevel).toBe(1.0);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    const afterZoomIn = MockPanelGrid.mock.calls[MockPanelGrid.mock.calls.length - 1][0];
    expect(afterZoomIn.zoomLevel).toBeCloseTo(1.1);

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

    const afterZoomOut = MockPanelGrid.mock.calls[MockPanelGrid.mock.calls.length - 1][0];
    expect(afterZoomOut.zoomLevel).toBeCloseTo(0.9);
  });

  it("image option appears in the modal type picker", () => {
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

    expect(screen.getByRole("button", { name: "Image" })).toBeInTheDocument();
  });
});
