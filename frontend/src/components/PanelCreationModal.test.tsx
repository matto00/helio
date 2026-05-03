import { fireEvent, screen, waitFor } from "@testing-library/react";

import { createPanel as createPanelRequest } from "../services/panelService";
import { renderWithStore } from "../test/renderWithStore";
import { PanelCreationModal } from "./PanelCreationModal";

jest.mock("../services/panelService", () => ({
  createPanel: jest.fn(),
  fetchPanels: jest.fn(),
  updatePanelAppearance: jest.fn(),
}));

const createPanelMock = jest.mocked(createPanelRequest);

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

const baseStore = {
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
    status: "succeeded" as const,
  },
};

describe("PanelCreationModal", () => {
  beforeEach(() => {
    createPanelMock.mockReset();
    // jsdom doesn't implement showModal/close natively; stub showModal to set
    // the `open` attribute so dialog contents are accessible in tests.
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  it("opens at the type-select step showing all 7 panel types", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chart" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Table" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Markdown" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Image" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Divider" })).toBeInTheDocument();
  });

  it("does not show the title input on the type-select step", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    expect(screen.queryByLabelText("Panel title")).not.toBeInTheDocument();
  });

  it("selecting a type advances to the name-entry step", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Chart" }));

    expect(screen.getByLabelText("Panel title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create panel" })).toBeInTheDocument();
  });

  it("back button returns to the type-select step", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    expect(screen.getByLabelText("Panel title")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.queryByLabelText("Panel title")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();
  });

  it("submitting dispatches createPanel with the selected type and title", async () => {
    createPanelMock.mockResolvedValue({
      id: "panel-new",
      dashboardId: "dashboard-1",
      title: "Revenue Pulse",
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

    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "Revenue Pulse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith("dashboard-1", "Revenue Pulse", "table"),
    );
  });

  it("closes modal after successful create", async () => {
    createPanelMock.mockResolvedValue({
      id: "panel-new",
      dashboardId: "dashboard-1",
      title: "My Panel",
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

    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "My Panel" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows inline error when create fails", async () => {
    createPanelMock.mockRejectedValue(new Error("Network error"));

    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Broken Panel" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() => expect(screen.getByText("Failed to create panel.")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("close button calls onClose", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("create button is disabled when title is empty", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Image" }));

    expect(screen.getByRole("button", { name: "Create panel" })).toBeDisabled();
  });
});
