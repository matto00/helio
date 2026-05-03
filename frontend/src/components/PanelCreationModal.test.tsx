import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { createPanel as createPanelRequest } from "../services/panelService";
import { renderWithStore } from "../test/renderWithStore";
import { PanelCreationModal } from "./PanelCreationModal";
import type { PanelContentProps } from "./PanelContent";

// Mock PanelContent to avoid ECharts canvas requirements in jsdom and to
// allow asserting which panel type the preview receives.
jest.mock("./PanelContent", () => ({
  PanelContent: ({ type }: PanelContentProps) => (
    <div data-testid="panel-content" data-panel-type={type} />
  ),
}));

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
    // at least one description is visible
    expect(screen.getByText("Display a single KPI value or stat")).toBeInTheDocument();
  });

  it("each type card renders with a non-empty description", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    expect(screen.getByText("Display a single KPI value or stat")).toBeInTheDocument();
    expect(screen.getByText("Visualize trends with line, bar, or pie")).toBeInTheDocument();
    expect(screen.getByText("Add freeform text or headings")).toBeInTheDocument();
    expect(screen.getByText("Show structured data in rows and columns")).toBeInTheDocument();
    expect(screen.getByText("Write formatted content with Markdown")).toBeInTheDocument();
    expect(screen.getByText("Embed an image from a URL")).toBeInTheDocument();
    expect(screen.getByText("Separate sections with a visual line")).toBeInTheDocument();
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

describe("PanelCreationModal — live preview", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  it("2.1 preview renders the correct panel type on the name-entry step", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));

    const previewContent = screen.getByTestId("panel-content");
    expect(previewContent).toHaveAttribute("data-panel-type", "metric");
  });

  it("2.2 preview title reflects the current title input value", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "Revenue Pulse" },
    });

    const preview = screen.getByTestId("panel-creation-preview");
    expect(within(preview).getByText("Revenue Pulse")).toBeInTheDocument();
  });

  it("2.3 preview shows 'Untitled' placeholder when title input is empty", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Table" }));

    const preview = screen.getByTestId("panel-creation-preview");
    expect(within(preview).getByText("Untitled")).toBeInTheDocument();
  });

  it("2.4 preview is not rendered on the type-select step", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    expect(screen.queryByTestId("panel-creation-preview")).not.toBeInTheDocument();
  });
});
