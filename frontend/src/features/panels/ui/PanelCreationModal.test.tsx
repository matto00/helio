import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { createPanel as createPanelRequest } from "../services/panelService";
import { renderWithStore } from "../../../test/renderWithStore";
import { makeMarkdownPanel, makeMetricPanel } from "../../../test/panelFixtures";
import type { Panel } from "../types/panel";
import { PanelCreationModal } from "./PanelCreationModal";
import type { PanelContentProps } from "./PanelContent";

// Mock PanelContent to avoid ECharts canvas requirements in jsdom and to
// allow asserting which panel type the preview receives.
jest.mock("./PanelContent", () => ({
  PanelContent: ({ panel }: PanelContentProps) => (
    <div data-testid="panel-content" data-panel-type={panel.type} />
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
  // Pre-loaded as succeeded to prevent fetch dispatches on mount
  dataTypes: {
    items: [],
    status: "succeeded" as const,
  },
};

/** Store with a pipeline-output DataType (`sourceId: null`) for testing the
 * datatype-select step — the picker filters to these via
 * `selectPipelineOutputDataTypes`. */
const storeWithDataTypes = {
  ...baseStore,
  dataTypes: {
    items: [
      {
        id: "dt-1",
        name: "Revenue",
        sourceId: null,
        version: 1,
        fields: [],
        computedFields: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
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

  it("opens at the type-select step showing all 6 panel types", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chart" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Table" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Markdown" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Image" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Divider" })).not.toBeInTheDocument();
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
  });

  it("does not show the title input on the type-select step", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    expect(screen.queryByLabelText("Panel title")).not.toBeInTheDocument();
  });

  it("selecting a type advances to the template-select step", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Chart" }));

    expect(screen.getByRole("group", { name: "Panel template" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Panel title")).not.toBeInTheDocument();
  });

  it("back button on name-entry step returns to the template-select step (non-data-bound type)", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    // Image is non-data-bound; it skips the datatype step
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    expect(screen.getByLabelText("Panel title")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.queryByLabelText("Panel title")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Panel template" })).toBeInTheDocument();
  });

  it("closes modal after successful create", async () => {
    createPanelMock.mockResolvedValue(
      makeMarkdownPanel({
        id: "panel-new",
        dashboardId: "dashboard-1",
        title: "My Panel",
        meta: defaultMeta,
        appearance: defaultPanelAppearance,
      }),
    );

    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    // Image is non-data-bound; it skips the datatype step (markdown is now
    // data-bound per HEL-245, so this generic create-flow test uses Image).
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "My Panel" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows inline error when create fails", async () => {
    createPanelMock.mockRejectedValue(new Error("Network error"));

    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    // Image is non-data-bound; it skips the datatype step (see note above).
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    expect(screen.getByRole("button", { name: "Create panel" })).toBeDisabled();
  });

  it("selecting a template pre-fills the title input on the name-entry step", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    // Image is non-data-bound; selecting a template goes directly to name-entry
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Image Display" }));

    const titleInput = screen.getByLabelText("Panel title") as HTMLInputElement;
    expect(titleInput.value).toBe("Image Display");
  });

  it('"Start blank" card leaves the title input empty', () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    // Image is non-data-bound; Start blank goes directly to name-entry
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    const titleInput = screen.getByLabelText("Panel title") as HTMLInputElement;
    expect(titleInput.value).toBe("");
  });

  it("Back on template-select step returns to the type-select step", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    expect(screen.getByRole("group", { name: "Panel template" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.queryByRole("group", { name: "Panel template" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chart" })).toBeInTheDocument();
  });

  it("modal resets template selection on close and reopen", () => {
    const onClose = jest.fn();
    const { unmount } = renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    expect(screen.getByRole("group", { name: "Panel template" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    unmount();

    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    expect(screen.getByRole("button", { name: "Metric" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Panel template" })).not.toBeInTheDocument();
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

    // Image is non-data-bound; goes directly to name-entry
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    const previewContent = screen.getByTestId("panel-content");
    expect(previewContent).toHaveAttribute("data-panel-type", "image");
  });

  it("2.2 preview title reflects the current title input value", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    // Image is non-data-bound; goes directly to name-entry
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "Revenue Pulse" },
    });

    const preview = screen.getByTestId("panel-creation-preview");
    expect(within(preview).getByText("Revenue Pulse")).toBeInTheDocument();
  });

  it("2.3 preview shows 'Untitled' placeholder when title input is empty", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    // Image is non-data-bound; goes directly to name-entry (markdown is now
    // data-bound per HEL-245).
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    const preview = screen.getByTestId("panel-creation-preview");
    expect(within(preview).getByText("Untitled")).toBeInTheDocument();
  });

  it("2.4 preview is not rendered on the type-select step", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    expect(screen.queryByTestId("panel-creation-preview")).not.toBeInTheDocument();
  });
});

// ── Default panel mock returned by successful createPanel calls ───────────────
// Note: `overrides.type` is ignored by this helper; tests only need a metric
// stand-in to satisfy the createPanelMock return shape.
const mockPanel = (overrides?: Partial<Panel>): Panel =>
  makeMetricPanel({
    id: overrides?.id ?? "panel-new",
    dashboardId: overrides?.dashboardId ?? "dashboard-1",
    title: overrides?.title ?? "My Panel",
    meta: defaultMeta,
    appearance: overrides?.appearance ?? defaultPanelAppearance,
  });

describe("PanelCreationModal — type-specific config fields", () => {
  beforeEach(() => {
    createPanelMock.mockReset();
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // 4.1 — Metric config fields appear in step 3
  it("4.1 metric config fields (value label + unit) appear in step 3 for metric type", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    // Metric is data-bound → lands on datatype-select; select a data type then advance
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByLabelText("Value label")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit")).toBeInTheDocument();
  });

  // 4.2 — Chart type selector appears in step 3
  it("4.2 chart type selector appears in step 3 for chart type", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    // Chart is data-bound → lands on datatype-select; select a data type then advance
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const selector = screen.getByRole("combobox", { name: "Chart type" });
    expect(selector).toBeInTheDocument();
    // Open the custom Select to reveal options in the portal listbox
    fireEvent.click(selector);
    expect(screen.getByRole("option", { name: "Line" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bar" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Pie" })).toBeInTheDocument();
  });

  // 4.3 — Image URL field appears in step 3
  it("4.3 image URL field appears in step 3 for image type", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    expect(screen.getByLabelText("Image URL")).toBeInTheDocument();
  });

  // 4.5 — Non-data-bound types show no additional config fields in step 3
  it("4.5 Markdown shows no additional config fields in step 3", () => {
    // Markdown is non-data-bound and has no type-specific config fields
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    expect(screen.queryByLabelText("Value label")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Unit")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Chart type" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Image URL")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Orientation" })).not.toBeInTheDocument();
  });

  // 4.6 — typeConfig values are included in the creation payload on submit
  it("4.6 typeConfig values and dataTypeId are included in the creation payload on submit", async () => {
    createPanelMock.mockResolvedValue(mockPanel({ type: "metric", title: "Revenue" }));
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    // Metric is data-bound → navigate through datatype-select
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Revenue" } });
    fireEvent.change(screen.getByLabelText("Value label"), {
      target: { value: "Total Revenue" },
    });
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "$" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith(
        "dashboard-1",
        "Revenue",
        "metric",
        { type: "metric", valueLabel: "Total Revenue", unit: "$" },
        "dt-1",
      ),
    );
  });

  // 4.7 — Entering a config value sets dirty state (inline discard banner shown)
  it("4.7 entering a config value marks the modal dirty (inline discard banner shown on dismiss)", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    fireEvent.change(screen.getByLabelText("Image URL"), {
      target: { value: "https://example.com/image.jpg" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));

    // Banner appears; "Keep editing" leaves the modal open.
    expect(screen.getByRole("alertdialog", { name: "Discard changes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  // 4.8 — typeConfig state resets after modal close
  it("4.8 typeConfig state resets after modal close and reopen", () => {
    const onClose = jest.fn();
    const { unmount } = renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    const imageInput = screen.getByLabelText("Image URL") as HTMLInputElement;
    fireEvent.change(imageInput, { target: { value: "https://example.com/image.jpg" } });
    expect(imageInput.value).toBe("https://example.com/image.jpg");

    // Close the modal (confirm the discard via inline banner)
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    unmount();

    // Reopen the modal and navigate back to the image step
    renderWithStore(<PanelCreationModal onClose={jest.fn()} />, baseStore);
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    const freshInput = screen.getByLabelText("Image URL") as HTMLInputElement;
    expect(freshInput.value).toBe("");
  });
});

describe("PanelCreationModal — DataType picker step", () => {
  beforeEach(() => {
    createPanelMock.mockReset();
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // 4.2 — DataType step renders after template selection for metric type
  it("4.2 DataType step renders after template selection for metric type", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    // Should be on the datatype-select step
    expect(screen.getByText("Choose a data type")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Data type" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Panel title")).not.toBeInTheDocument();
  });

  // 4.3a — DataType step renders after template selection for markdown type
  // (HEL-245: markdown joined the data-bound set, mirroring the metric flow).
  it("4.3a DataType step renders after template selection for markdown type", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    // Should be on the datatype-select step, not name-entry.
    expect(screen.getByText("Choose a data type")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Data type" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Panel title")).not.toBeInTheDocument();
  });

  // 4.3b — DataType step is skipped for a non-data-bound type (image goes
  // directly to name-entry).
  it("4.3b DataType step is skipped for image type (goes directly to name-entry)", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    // Should land directly on name-entry step
    expect(screen.getByLabelText("Panel title")).toBeInTheDocument();
    expect(screen.queryByText("Choose a data type")).not.toBeInTheDocument();
  });

  // 4.3c — Create panel call for a Markdown panel includes the DataType
  // selected in the DataType step (mirrors the HEL-244 Text assertion).
  it("4.3c Create panel call for a Markdown panel includes dataTypeId selected in the DataType step", async () => {
    createPanelMock.mockResolvedValue(mockPanel({ type: "markdown", title: "My Markdown Panel" }));
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "My Markdown Panel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith(
        "dashboard-1",
        "My Markdown Panel",
        "markdown",
        undefined,
        "dt-1",
      ),
    );
  });

  // 4.4 — Next button disabled when no DataType selected; enabled after selection
  it("4.4 Next button is disabled when no DataType is selected and enabled after selection", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    // Next button should be disabled before any DataType is selected
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    // Select a DataType
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));

    // Next button should now be enabled
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
  });

  // 4.5 — Create panel call includes dataTypeId from the DataType step
  it("4.5 Create panel call includes dataTypeId selected in the DataType step", async () => {
    createPanelMock.mockResolvedValue(mockPanel({ type: "metric", title: "My Metric" }));
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    // Select the DataType and advance
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "My Metric" } });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith(
        "dashboard-1",
        "My Metric",
        "metric",
        undefined,
        "dt-1",
      ),
    );
  });

  // HEL-244 (task 4.8) — creating a Text panel with a selected DataType now
  // seeds config.dataTypeId (previously discarded by seedCreateConfig's
  // "text" case; the createPanel call itself already passed dataTypeId
  // through — see `buildCreatePanelBody`'s dedicated unit tests in
  // `panelPayloads.test.ts` for the config-shape assertion).
  it("HEL-244 Create panel call for a Text panel includes dataTypeId selected in the DataType step", async () => {
    createPanelMock.mockResolvedValue(mockPanel({ type: "text", title: "My Text Panel" }));
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));
    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "My Text Panel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create panel" }));

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith(
        "dashboard-1",
        "My Text Panel",
        "text",
        undefined,
        "dt-1",
      ),
    );
  });

  // 4.6 — Empty state shown when no pipeline-output DataTypes are available
  it("4.6 empty state is shown when there are no pipeline-output DataTypes", () => {
    const onClose = jest.fn();
    // baseStore has no dataTypes at all
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    expect(screen.getByTestId("datatype-empty-state")).toBeInTheDocument();
    expect(screen.getByText("No data types are registered yet.")).toBeInTheDocument();
  });

  // 4.7 — Empty state contains a link to /pipelines
  it("4.7 empty state contains a link with data-testid pointing to /pipelines", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    const link = screen.getByTestId("datatype-empty-pipeline-link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/pipelines");
  });

  // 4.8 — Empty state is NOT shown while dataTypes.status is loading
  it("4.8 empty state is NOT shown while dataTypes.status === loading", () => {
    const onClose = jest.fn();
    const storeWithLoadingDataTypes = {
      ...baseStore,
      dataTypes: {
        items: [],
        status: "loading" as const,
      },
    };
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithLoadingDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    expect(screen.queryByTestId("datatype-empty-state")).not.toBeInTheDocument();
    expect(screen.getByText("Loading data types...")).toBeInTheDocument();
  });

  // 4.9 — DataType list is shown when at least one pipeline-output DataType exists
  it("4.9 DataType list is shown and empty state is absent when a pipeline-output DataType exists", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithDataTypes);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    expect(screen.getByRole("group", { name: "Data type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revenue" })).toBeInTheDocument();
    expect(screen.queryByTestId("datatype-empty-state")).not.toBeInTheDocument();
  });

  // 4.10 — Companion DataTypes (sourceId set) are never offered as binding targets
  it("4.10 companion DataTypes are excluded from the picker", () => {
    const onClose = jest.fn();
    const storeWithCompanionType = {
      ...baseStore,
      dataTypes: {
        items: [
          ...storeWithDataTypes.dataTypes.items,
          {
            id: "dt-companion",
            name: "Source Companion",
            sourceId: "src-1",
            version: 1,
            fields: [],
            computedFields: [],
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
        status: "succeeded" as const,
      },
    };
    renderWithStore(<PanelCreationModal onClose={onClose} />, storeWithCompanionType);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Start blank" }));

    expect(screen.getByRole("button", { name: "Revenue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Source Companion" })).not.toBeInTheDocument();
  });
});

describe("PanelCreationModal — accessibility (dismiss + focus trap)", () => {
  const FOCUSABLE =
    'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // 2.1 — Escape on clean modal closes without confirmation
  it("2.1 Escape on clean modal closes without confirmation", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(screen.queryByRole("alertdialog", { name: "Discard changes" })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 2.2 — Escape on dirty modal (type selected) shows inline confirm and closes on accept
  it("2.2 Escape on dirty modal (type selected) shows inline confirm and closes on accept", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));

    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(screen.getByRole("alertdialog", { name: "Discard changes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 2.3 — Escape on dirty modal (type selected) shows inline confirm and stays open on cancel
  it("2.3 Escape on dirty modal (type selected) shows inline confirm and stays open on cancel", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Metric" }));

    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(screen.getByRole("alertdialog", { name: "Discard changes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute("open");
  });

  // 2.4 — Click outside on clean modal closes without confirmation
  it("2.4 click outside on clean modal closes without confirmation", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    const dialog = document.querySelector("dialog")!;
    fireEvent.click(dialog);

    expect(screen.queryByRole("alertdialog", { name: "Discard changes" })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 2.5 — Click outside on dirty modal shows inline confirm and closes on accept
  it("2.5 click outside on dirty modal shows inline confirm and closes on accept", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Chart" }));

    const dialog = document.querySelector("dialog")!;
    fireEvent.click(dialog);

    expect(screen.getByRole("alertdialog", { name: "Discard changes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 2.6 — Close button on dirty modal shows inline confirm and closes on accept
  it("2.6 close button on dirty modal shows inline confirm and closes on accept", () => {
    const onClose = jest.fn();
    renderWithStore(<PanelCreationModal onClose={onClose} />, baseStore);

    fireEvent.click(screen.getByRole("button", { name: "Table" }));

    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));

    expect(screen.getByRole("alertdialog", { name: "Discard changes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 2.7 — Tab from last focusable element wraps to first
  it("2.7 Tab from last focusable element wraps focus to first", () => {
    renderWithStore(<PanelCreationModal onClose={jest.fn()} />, baseStore);

    const dialog = document.querySelector("dialog")!;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    expect(focusable.length).toBeGreaterThan(1);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: false });

    expect(document.activeElement).toBe(first);
  });

  // 2.8 — Shift+Tab from first focusable element wraps to last
  it("2.8 Shift+Tab from first focusable element wraps focus to last", () => {
    renderWithStore(<PanelCreationModal onClose={jest.fn()} />, baseStore);

    const dialog = document.querySelector("dialog")!;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    expect(focusable.length).toBeGreaterThan(1);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(last);
  });
});
