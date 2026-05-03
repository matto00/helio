import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelAppearance as updatePanelAppearanceRequest } from "../services/panelService";
import { updatePanelBinding as updatePanelBindingRequest } from "../services/panelService";
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

function renderModal(onClose = jest.fn()) {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });

  return renderWithStore(<PanelDetailModal panel={testPanel} onClose={onClose} />);
}

function renderModalWithDataType(onClose = jest.fn()) {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });

  return renderWithStore(<PanelDetailModal panel={testPanel} onClose={onClose} />, {
    dataTypes: { items: [testDataType], status: "succeeded" },
  });
}

function renderChartModal(onClose = jest.fn()) {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });

  return renderWithStore(<PanelDetailModal panel={chartTestPanel} onClose={onClose} />);
}

function renderDividerModal(onClose = jest.fn()) {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });

  return renderWithStore(<PanelDetailModal panel={dividerTestPanel} onClose={onClose} />);
}

function renderDividerModalNullColor(onClose = jest.fn()) {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });

  return renderWithStore(<PanelDetailModal panel={dividerTestPanelNullColor} onClose={onClose} />);
}

describe("PanelDetailModal", () => {
  beforeEach(() => {
    updateAppearanceMock.mockReset();
    updateBindingMock.mockReset();
    updateDividerMock.mockReset();
    fetchDataTypesMock.mockReset();
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

  it("clicking Edit button transitions to edit mode — Appearance tab visible and selected", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    const appearanceTab = screen.getByRole("tab", { name: "Appearance" });
    expect(appearanceTab).toBeInTheDocument();
    expect(appearanceTab).toHaveAttribute("aria-selected", "true");
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

  it("switches to the Data tab and shows the type search input", () => {
    fetchDataTypesMock.mockResolvedValue([]);
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("tab", { name: "Data" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Search data types")).toBeInTheDocument();
  });

  it("shows a Save button on the Data tab", () => {
    fetchDataTypesMock.mockResolvedValue([]);
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("button", { name: "Save data binding" })).toBeInTheDocument();
  });

  it("dispatches fetchDataTypes when Data tab is activated", async () => {
    fetchDataTypesMock.mockResolvedValue([testDataType]);
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    await waitFor(() => expect(fetchDataTypesMock).toHaveBeenCalled());
  });

  it("shows the DataType list when data types are loaded", () => {
    fetchDataTypesMock.mockResolvedValue([]);
    renderModalWithDataType();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("listbox", { name: "Data types" })).toBeInTheDocument();
    expect(screen.getByText("Sales Metrics")).toBeInTheDocument();
  });

  it("shows field mapping slots after selecting a DataType", () => {
    fetchDataTypesMock.mockResolvedValue([]);
    renderModalWithDataType();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByText("Sales Metrics"));
    // metric panel: value, label, unit slots
    expect(screen.getByLabelText("Value field")).toBeInTheDocument();
    expect(screen.getByLabelText("Label field")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit field")).toBeInTheDocument();
  });

  it("filters the DataType list by search query", () => {
    fetchDataTypesMock.mockResolvedValue([]);
    renderModalWithDataType();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.change(screen.getByLabelText("Search data types"), {
      target: { value: "xyz" },
    });
    expect(screen.queryByText("Sales Metrics")).not.toBeInTheDocument();
  });

  it("saves binding and closes on Data tab Save", async () => {
    fetchDataTypesMock.mockResolvedValue([]);
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
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByText("Sales Metrics"));
    fireEvent.click(screen.getByRole("button", { name: "Save data binding" }));

    await waitFor(() => expect(updateBindingMock).toHaveBeenCalledWith("p1", "dt-1", null, null));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an inline error when Data tab Save fails", async () => {
    fetchDataTypesMock.mockResolvedValue([]);
    updateBindingMock.mockRejectedValue(new Error("Network error"));
    renderModalWithDataType();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByText("Sales Metrics"));
    fireEvent.click(screen.getByRole("button", { name: "Save data binding" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save data binding.")).toBeInTheDocument();
    });
  });

  it("shows discard warning when Cancel is clicked with unsaved data changes", () => {
    fetchDataTypesMock.mockResolvedValue([]);
    renderModalWithDataType();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByText("Sales Metrics"));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();
  });

  // Task 5.5 — saving appearance dispatches accumulatePanelUpdate instead of updatePanelAppearance
  it("dispatches accumulatePanelUpdate and closes on Appearance Save without calling the service", () => {
    const onClose = jest.fn();
    const { store } = renderModal(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue background color"), {
      target: { value: "#000000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save panel style" }));

    // Dialog should close synchronously
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();

    // The appearance change should be in pendingPanelUpdates, not sent to the server
    expect(updateAppearanceMock).not.toHaveBeenCalled();
    expect(store.getState().panels.pendingPanelUpdates["p1"]).toBeDefined();
    expect(store.getState().panels.pendingPanelUpdates["p1"].appearance?.background).toBe(
      "#000000",
    );
  });

  it("closes without saving when Cancel is clicked and form is clean", () => {
    const onClose = jest.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
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

  it("discards changes and closes when Discard is confirmed", () => {
    const onClose = jest.fn();
    renderModal(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /Discard/i }));

    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
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
    it("shows a Divider tab for divider panels", () => {
      renderDividerModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.getByRole("tab", { name: "Divider" })).toBeInTheDocument();
    });

    it("does not show a Divider tab for non-divider panels", () => {
      renderModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      expect(screen.queryByRole("tab", { name: "Divider" })).not.toBeInTheDocument();
    });

    it("shows divider orientation, weight, and color controls on the Divider tab", () => {
      renderDividerModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      fireEvent.click(screen.getByRole("tab", { name: "Divider" }));
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

    it("shows a Save divider settings button on the Divider tab", () => {
      renderDividerModal();
      fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
      fireEvent.click(screen.getByRole("tab", { name: "Divider" }));
      expect(screen.getByRole("button", { name: "Save divider settings" })).toBeInTheDocument();
    });
  });
});

describe("PanelDetailModal -- divider panel", () => {
  beforeEach(() => {
    updateAppearanceMock.mockReset();
    updateBindingMock.mockReset();
    updateDividerMock.mockReset();
    fetchDataTypesMock.mockReset();
  });

  it("shows the Divider tab for divider panels", () => {
    renderDividerModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.getByRole("tab", { name: "Divider" })).toBeInTheDocument();
  });

  it("does not show the Divider tab for non-divider panels", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.queryByRole("tab", { name: "Divider" })).not.toBeInTheDocument();
  });

  it("shows divider controls when Divider tab is active", () => {
    renderDividerModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Divider" }));
    expect(screen.getByLabelText("Divider orientation")).toBeInTheDocument();
    expect(screen.getByLabelText("Divider weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Divider color")).toBeInTheDocument();
  });

  it("does not show divider controls on the appearance tab", () => {
    renderDividerModal();
    expect(screen.queryByLabelText("Divider orientation")).not.toBeInTheDocument();
  });

  it("does not show divider controls for non-divider panels", () => {
    renderModal();
    expect(screen.queryByLabelText("Divider orientation")).not.toBeInTheDocument();
  });

  it("preserves null color on no-op Save when stored dividerColor is null", async () => {
    // When dividerColor is null in the DB, the picker shows #cccccc as a UI fallback.
    // Saving without changing the color should send null (not #cccccc) to keep the
    // CSS design-token default active rather than hardcoding a value.
    updateDividerMock.mockResolvedValue({ ...dividerTestPanelNullColor, dividerColor: null });
    renderDividerModalNullColor();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Divider" }));
    fireEvent.click(screen.getByRole("button", { name: "Save divider settings" }));

    await waitFor(() =>
      expect(updateDividerMock).toHaveBeenCalledWith(
        testPanel.id,
        "horizontal",
        1,
        null, // null preserved — not "#cccccc"
      ),
    );
  });

  it("passes an explicit color through when the user picks a non-fallback value", async () => {
    updateDividerMock.mockResolvedValue({ ...dividerTestPanel, dividerColor: "#ff0000" });
    renderDividerModal();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Divider" }));
    fireEvent.change(screen.getByLabelText("Divider color"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save divider settings" }));

    await waitFor(() =>
      expect(updateDividerMock).toHaveBeenCalledWith(testPanel.id, "horizontal", 1, "#ff0000"),
    );
  });
});
