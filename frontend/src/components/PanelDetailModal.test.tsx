import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelAppearance as updatePanelAppearanceRequest } from "../services/panelService";
import { updatePanelBinding as updatePanelBindingRequest } from "../services/panelService";
import { updatePanelContent as updatePanelContentRequest } from "../services/panelService";
import { updatePanelImage as updatePanelImageRequest } from "../services/panelService";
import { updatePanelDivider as updatePanelDividerRequest } from "../services/panelService";
import { fetchDataTypes as fetchDataTypesRequest } from "../services/dataTypeService";
import { renderWithStore } from "../test/renderWithStore";
import { PanelDetailModal } from "./PanelDetailModal";

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelBinding: jest.fn(),
  updatePanelContent: jest.fn(),
  updatePanelImage: jest.fn(),
  updatePanelDivider: jest.fn(),
}));

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
}));

const updateAppearanceMock = jest.mocked(updatePanelAppearanceRequest);
const updateBindingMock = jest.mocked(updatePanelBindingRequest);
const updateContentMock = jest.mocked(updatePanelContentRequest);
const updateImageMock = jest.mocked(updatePanelImageRequest);
const updateDividerMock = jest.mocked(updatePanelDividerRequest);
const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);

const testPanel = {
  id: "p1",
  dashboardId: "d1",
  title: "Revenue",
  type: "metric" as const,
  appearance: {
    background: "transparent",
    color: "inherit",
    transparency: 0,
  },
  meta: {
    createdBy: "system",
    createdAt: "2026-03-14T00:00:00Z",
    lastUpdated: "2026-03-14T00:00:00Z",
  },
  typeId: null,
  fieldMapping: null,
  refreshInterval: null,
  content: null,
  imageUrl: null,
  imageFit: null,
  dividerOrientation: null,
  dividerWeight: null,
  dividerColor: null,
};

const chartTestPanel = {
  ...testPanel,
  type: "chart" as const,
};
const dividerTestPanel = {
  ...testPanel,
  type: "divider" as const,
  dividerOrientation: "horizontal" as const,
  dividerWeight: 1,
  dividerColor: "#cccccc",
};

// Divider panel whose color is null (DB default — uses CSS design token at render time)
const dividerTestPanelNullColor = {
  ...testPanel,
  type: "divider" as const,
  dividerOrientation: "horizontal" as const,
  dividerWeight: 1,
  dividerColor: null,
};

const markdownTestPanel = {
  ...testPanel,
  type: "markdown" as const,
  content: "# Hello",
};

const imageTestPanel = {
  ...testPanel,
  type: "image" as const,
  imageUrl: "https://example.com/img.png",
  imageFit: "contain" as const,
};

const testDataType = {
  id: "dt-1",
  name: "Sales Metrics",
  sourceId: null,
  version: 1,
  fields: [
    { name: "revenue", displayName: "Revenue", dataType: "float", nullable: false },
    { name: "label", displayName: "Label", dataType: "string", nullable: true },
  ],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });
}

function renderModal(onClose = jest.fn()) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={testPanel} onClose={onClose} />);
}

function renderModalWithDataType(onClose = jest.fn()) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={testPanel} onClose={onClose} />, {
    dataTypes: { items: [testDataType], status: "succeeded" },
  });
}

function renderChartModal(onClose = jest.fn()) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={chartTestPanel} onClose={onClose} />);
}

function renderDividerModal(onClose = jest.fn()) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={dividerTestPanel} onClose={onClose} />);
}

function renderDividerModalNullColor(onClose = jest.fn()) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={dividerTestPanelNullColor} onClose={onClose} />);
}

function renderMarkdownModal(onClose = jest.fn()) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={markdownTestPanel} onClose={onClose} />);
}

function renderImageModal(onClose = jest.fn()) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={imageTestPanel} onClose={onClose} />);
}

describe("PanelDetailModal", () => {
  beforeEach(() => {
    updateAppearanceMock.mockReset();
    updateBindingMock.mockReset();
    updateContentMock.mockReset();
    updateImageMock.mockReset();
    updateDividerMock.mockReset();
    // Default to resolving with empty array so data-type fetch does not crash tests
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("shows the panel title in the header", () => {
    renderModal();
    expect(screen.getByText(/Revenue/)).toBeInTheDocument();
  });

  it("opens the dialog via showModal on mount", () => {
    renderModal();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("opens in view mode by default — Edit button visible, no tab bar", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Appearance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("modal opens in view mode — tab bar not visible, Edit button visible", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  // 2.1 — Edit mode shows unified form with no tab bar
  it("clicking Edit transitions to edit mode with a unified form — no tab bar present", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    // Appearance section heading and controls are visible
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByLabelText("Revenue background color")).toBeInTheDocument();
  });

  // 2.1 — Data-capable panels show Appearance and Data sections
  it("metric panel edit mode shows Appearance and Data sections without a tab bar", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  // 2.1 — Divider panels show Appearance and Divider sections
  it("divider panel edit mode shows Appearance and Divider sections without a tab bar", () => {
    renderDividerModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Divider" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Data" })).not.toBeInTheDocument();
  });

  it("close from view mode is immediate — no discard warning shown", () => {
    const onClose = jest.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Close panel settings" }));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText("You have unsaved changes. Discard them?")).not.toBeInTheDocument();
  });

  it("close from edit mode with unsaved changes still shows discard warning", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close panel settings" }));
    expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();
  });

  it("pressing E in view mode transitions to edit mode", () => {
    renderModal();
    const dialog = screen.getByRole("dialog", { name: "Revenue settings" });
    fireEvent.keyDown(dialog, { key: "e" });
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit panel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("pressing E when focus is on an input element inside the modal does not change mode", () => {
    renderModal();
    const dialog = screen.getByRole("dialog", { name: "Revenue settings" });

    // Append a text input as a child of the dialog to simulate a focused form field
    const input = document.createElement("input");
    input.type = "text";
    dialog.appendChild(input);

    // Fire keydown on the input — it bubbles to the dialog with e.target = input
    fireEvent.keyDown(input, { key: "e" });

    // Should still be in view mode
    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  // ✕ button — close behavior from edit mode
  it("✕ button in edit mode with no changes closes the modal immediately", () => {
    const onClose = jest.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    // No changes made — click ✕ directly
    fireEvent.click(screen.getByRole("button", { name: "Close panel settings" }));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText("You have unsaved changes. Discard them?")).not.toBeInTheDocument();
  });

  it("✕ button in edit mode with unsaved changes shows discard warning; confirming closes the modal", () => {
    const onClose = jest.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close panel settings" }));
    expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();
    // Confirm discard — modal must close, not return to view mode
    fireEvent.click(screen.getByRole("button", { name: /Discard/i }));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Edit panel" })).not.toBeInTheDocument();
  });

  it("data section shows the type search input for data-capable panels in edit mode", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.getByLabelText("Search data types")).toBeInTheDocument();
  });

  it("dispatches fetchDataTypes when edit mode is entered for data-capable panels", async () => {
    fetchDataTypesMock.mockResolvedValue([testDataType]);
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    await waitFor(() => expect(fetchDataTypesMock).toHaveBeenCalled());
  });

  it("shows the DataType list when data types are loaded", () => {
    renderModalWithDataType();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.getByRole("listbox", { name: "Data types" })).toBeInTheDocument();
    expect(screen.getByText("Sales Metrics")).toBeInTheDocument();
  });

  it("shows field mapping slots after selecting a DataType", () => {
    renderModalWithDataType();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByText("Sales Metrics"));
    // metric panel: value, label, unit slots
    expect(screen.getByLabelText("Value field")).toBeInTheDocument();
    expect(screen.getByLabelText("Label field")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit field")).toBeInTheDocument();
  });

  it("filters the DataType list by search query", () => {
    renderModalWithDataType();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Search data types"), {
      target: { value: "xyz" },
    });
    expect(screen.queryByText("Sales Metrics")).not.toBeInTheDocument();
  });

  // Save transitions to view mode (not close)
  it("saves binding and transitions to view mode on Save", async () => {
    updateBindingMock.mockResolvedValue({
      ...testPanel,
      typeId: "dt-1",
      fieldMapping: null,
      refreshInterval: null,
      content: null,
    });
    const onClose = jest.fn();
    renderModalWithDataType(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByText("Sales Metrics"));
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateBindingMock).toHaveBeenCalledWith("p1", "dt-1", null, null));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows an inline error when data Save fails", async () => {
    updateBindingMock.mockRejectedValue(new Error("Network error"));
    renderModalWithDataType();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByText("Sales Metrics"));
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save data binding.")).toBeInTheDocument();
    });
  });

  it("shows discard warning when Cancel is clicked with unsaved data changes", () => {
    renderModalWithDataType();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByText("Sales Metrics"));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();
  });

  // 2.2 — Title field pre-filled
  it("title field is pre-filled with the current panel title", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    const titleInput = screen.getByLabelText("Panel title") as HTMLInputElement;
    expect(titleInput.value).toBe("Revenue");
  });

  // 2.2 — Title update dispatched on save
  it("saving with a changed title dispatches the updated title via accumulatePanelUpdate", async () => {
    const onClose = jest.fn();
    const { store } = renderModal(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "New Title" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    // Save transitions to view mode, not close
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(store.getState().panels.pendingPanelUpdates["p1"]).toBeDefined();
    expect(store.getState().panels.pendingPanelUpdates["p1"].title).toBe("New Title");
  });

  // Task 5.5 — saving appearance dispatches accumulatePanelUpdate, transitions to view mode
  it("dispatches accumulatePanelUpdate and transitions to view mode on Save without calling the service", async () => {
    const onClose = jest.fn();
    const { store } = renderModal(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue background color"), {
      target: { value: "#000000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    // Save transitions to view mode, not close
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // The appearance change should be in pendingPanelUpdates, not sent to the server
    expect(updateAppearanceMock).not.toHaveBeenCalled();
    expect(store.getState().panels.pendingPanelUpdates["p1"]).toBeDefined();
    expect(store.getState().panels.pendingPanelUpdates["p1"].appearance?.background).toBe(
      "#000000",
    );
  });

  // 2.3 — Unified save dispatches appearance + data binding in sequence
  it("unified save dispatches appearance and data binding in sequence when both are dirty", async () => {
    updateBindingMock.mockResolvedValue({
      ...testPanel,
      typeId: "dt-1",
      fieldMapping: null,
      refreshInterval: null,
      content: null,
    });
    const onClose = jest.fn();
    const { store } = renderModalWithDataType(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    // Make appearance dirty
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });
    // Make data dirty
    fireEvent.click(screen.getByText("Sales Metrics"));
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    // Appearance accumulated into pending updates
    expect(store.getState().panels.pendingPanelUpdates["p1"]).toBeDefined();
    // Data binding sent to the server
    await waitFor(() => expect(updateBindingMock).toHaveBeenCalledWith("p1", "dt-1", null, null));
    // Transitions to view mode, not closes
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  // 2.4 — Section-level inline error on data save failure; modal stays open
  it("section-level inline error appears when data save fails and modal stays open", async () => {
    updateBindingMock.mockRejectedValue(new Error("Network error"));
    renderModalWithDataType();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByText("Sales Metrics"));
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save data binding.")).toBeInTheDocument();
    });
    // Modal must remain open
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
  });

  // Task 2.3 — Cancel with no changes transitions to view mode (not close)
  it("Cancel with no changes transitions to view mode (not close)", () => {
    const onClose = jest.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(updateAppearanceMock).not.toHaveBeenCalled();
  });

  it("shows discard warning when Cancel is clicked with unsaved appearance changes", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();
  });

  // Task 2.4 — Confirming discard returns to view mode (not close)
  it("confirming discard returns to view mode (not close)", () => {
    const onClose = jest.fn();
    renderModal(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /Discard/i }));

    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the modal open when 'Keep editing' is clicked", () => {
    const onClose = jest.fn();
    renderModal(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /Keep editing/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("You have unsaved changes. Discard them?")).not.toBeInTheDocument();
  });

  // Task 2.5 — Escape key in edit mode with no changes returns to view mode
  it("Escape key in edit mode with no changes returns to view mode", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
  });

  // Task 2.6 — Escape key in edit mode with unsaved changes shows discard warning; confirming returns to view mode
  it("Escape key in edit mode with unsaved changes shows discard warning; confirming returns to view mode", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Discard/i }));

    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
  });

  // Task 2.7 — "Unsaved changes" indicator appears in header after modifying a field
  it("Unsaved changes indicator appears in header after modifying a field in edit mode", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    // No indicator yet
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

    // Make a change
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    // Indicator should now appear
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  // Task 2.8 — "Unsaved changes" indicator not shown when no fields are changed
  it("Unsaved changes indicator not shown when no fields are changed in edit mode", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  // Task 2.9 — Changing a field does not dispatch any API call until Save is clicked
  it("changing a field in edit mode does not dispatch any API call until Save is clicked", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    // Change the background color
    fireEvent.change(screen.getByLabelText("Revenue background color"), {
      target: { value: "#ff0000" },
    });

    // No API calls should have been made
    expect(updateAppearanceMock).not.toHaveBeenCalled();
    expect(updateBindingMock).not.toHaveBeenCalled();
    expect(updateContentMock).not.toHaveBeenCalled();
    expect(updateImageMock).not.toHaveBeenCalled();
    expect(updateDividerMock).not.toHaveBeenCalled();
  });

  describe("Chart section", () => {
    it("renders Chart section on Appearance tab for chart panels", () => {
      renderChartModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.getByLabelText("Show legend")).toBeInTheDocument();
      expect(screen.getByLabelText("Enable tooltip")).toBeInTheDocument();
      expect(screen.getByLabelText("Show X-axis label")).toBeInTheDocument();
      expect(screen.getByLabelText("Show Y-axis label")).toBeInTheDocument();
    });

    it("does not render Chart section for non-chart panels", () => {
      renderModal();
      expect(screen.queryByLabelText("Show legend")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Enable tooltip")).not.toBeInTheDocument();
    });

    it("renders 8 series color swatches for chart panels", () => {
      renderChartModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      const swatches = screen.getAllByLabelText(/Series color/);
      expect(swatches).toHaveLength(8);
    });

    it("shows legend position selector when legend is visible", () => {
      renderChartModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.getByLabelText("Legend position")).toBeInTheDocument();
    });

    it("hides legend position selector when legend is toggled off", () => {
      renderChartModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      fireEvent.click(screen.getByLabelText("Show legend"));
      expect(screen.queryByLabelText("Legend position")).not.toBeInTheDocument();
    });

    it("shows X-axis label text input when X-axis label is enabled", () => {
      renderChartModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.getByLabelText("X-axis label text")).toBeInTheDocument();
    });

    it("shows Y-axis label text input when Y-axis label is enabled", () => {
      renderChartModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.getByLabelText("Y-axis label text")).toBeInTheDocument();
    });

    it("hides X-axis label text input when toggled off", () => {
      renderChartModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      fireEvent.click(screen.getByLabelText("Show X-axis label"));
      expect(screen.queryByLabelText("X-axis label text")).not.toBeInTheDocument();
    });
  });

  describe("Chart type selector", () => {
    it("renders chart type radio buttons for chart panels", () => {
      renderChartModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.getByLabelText("Chart type bar")).toBeInTheDocument();
      expect(screen.getByLabelText("Chart type line")).toBeInTheDocument();
      expect(screen.getByLabelText("Chart type pie")).toBeInTheDocument();
      expect(screen.getByLabelText("Chart type scatter")).toBeInTheDocument();
    });

    it("does not render chart type radio buttons for non-chart panels", () => {
      renderModal();
      expect(screen.queryByLabelText("Chart type bar")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Chart type line")).not.toBeInTheDocument();
    });

    it("defaults to line chart type", () => {
      renderChartModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      const lineRadio = screen.getByLabelText("Chart type line") as HTMLInputElement;
      expect(lineRadio.checked).toBe(true);
    });

    it("updates the preview when a chart type is selected", () => {
      renderChartModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      const pieRadio = screen.getByLabelText("Chart type pie");
      fireEvent.click(pieRadio);
      expect((pieRadio as HTMLInputElement).checked).toBe(true);
      const barRadio = screen.getByLabelText("Chart type bar") as HTMLInputElement;
      expect(barRadio.checked).toBe(false);
    });
  });

  describe("Divider section", () => {
    it("shows Divider section heading for divider panels in edit mode", () => {
      renderDividerModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.getByRole("heading", { name: "Divider" })).toBeInTheDocument();
    });

    it("does not show Divider section for non-divider panels", () => {
      renderModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.queryByRole("heading", { name: "Divider" })).not.toBeInTheDocument();
    });

    it("shows divider orientation, weight, and color controls in edit mode", () => {
      renderDividerModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.getByLabelText("Divider orientation")).toBeInTheDocument();
      expect(screen.getByLabelText("Divider weight")).toBeInTheDocument();
      expect(screen.getByLabelText("Divider color")).toBeInTheDocument();
    });

    it("does not show divider controls when the panel is a metric", () => {
      renderModal();
      expect(screen.queryByLabelText("Divider orientation")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Divider weight")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Divider color")).not.toBeInTheDocument();
    });

    it("shows a unified Save button in edit mode", () => {
      renderDividerModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.getByRole("button", { name: "Save panel settings" })).toBeInTheDocument();
    });
  });
});

describe("PanelDetailModal -- divider panel", () => {
  beforeEach(() => {
    updateAppearanceMock.mockReset();
    updateBindingMock.mockReset();
    updateDividerMock.mockReset();
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("shows Divider section controls in edit mode for divider panels", () => {
    renderDividerModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.getByLabelText("Divider orientation")).toBeInTheDocument();
    expect(screen.getByLabelText("Divider weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Divider color")).toBeInTheDocument();
  });

  it("does not show Divider section for non-divider panels", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.queryByRole("heading", { name: "Divider" })).not.toBeInTheDocument();
  });

  it("does not show divider controls in view mode", () => {
    renderDividerModal();
    expect(screen.queryByLabelText("Divider orientation")).not.toBeInTheDocument();
  });

  it("does not show divider controls for non-divider panels", () => {
    renderModal();
    expect(screen.queryByLabelText("Divider orientation")).not.toBeInTheDocument();
  });

  it("preserves null color when other divider settings change: sends null instead of #cccccc", async () => {
    // When dividerColor is null in the DB, the picker shows #cccccc as a UI fallback.
    // If the user changes another field (e.g. weight) but leaves color at the fallback,
    // null must be passed — not "#cccccc" — so the CSS design-token default stays active.
    updateDividerMock.mockResolvedValue({
      ...dividerTestPanelNullColor,
      dividerWeight: 2,
      dividerColor: null,
    });
    renderDividerModalNullColor();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    // Change weight to make the divider section dirty (leave color at the #cccccc fallback)
    fireEvent.change(screen.getByLabelText("Divider weight"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() =>
      expect(updateDividerMock).toHaveBeenCalledWith(
        testPanel.id,
        "horizontal",
        2,
        null, // null preserved — not "#cccccc"
      ),
    );
    // Modal should be in view mode after save
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
  });

  it("passes an explicit color through when the user picks a non-fallback value", async () => {
    updateDividerMock.mockResolvedValue({ ...dividerTestPanel, dividerColor: "#ff0000" });
    renderDividerModal();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Divider color"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() =>
      expect(updateDividerMock).toHaveBeenCalledWith(testPanel.id, "horizontal", 1, "#ff0000"),
    );
    // Modal should be in view mode after save
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
  });
});
