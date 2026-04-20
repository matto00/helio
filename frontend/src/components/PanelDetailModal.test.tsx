import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelAppearance as updatePanelAppearanceRequest } from "../services/panelService";
import { updatePanelBinding as updatePanelBindingRequest } from "../services/panelService";
import { fetchDataTypes as fetchDataTypesRequest } from "../services/dataTypeService";
import { renderWithStore } from "../test/renderWithStore";
import { PanelDetailModal } from "./PanelDetailModal";

jest.mock("./ChartPanel", () => ({
  ChartPanel: () => <div data-testid="chart-panel-preview" />,
}));

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelBinding: jest.fn(),
}));

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
}));

const updateAppearanceMock = jest.mocked(updatePanelAppearanceRequest);
const updateBindingMock = jest.mocked(updatePanelBindingRequest);
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

const chartPanel = {
  id: "p2",
  dashboardId: "d1",
  title: "Sales Chart",
  type: "chart" as const,
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
};

function renderModalForChart(onClose = jest.fn()) {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });

  return renderWithStore(<PanelDetailModal panel={chartPanel} onClose={onClose} />);
}
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

describe("PanelDetailModal", () => {
  beforeEach(() => {
    updateAppearanceMock.mockReset();
    updateBindingMock.mockReset();
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

  it("renders the Appearance tab by default with color and transparency controls", () => {
    renderModal();
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("Revenue background color")).toBeInTheDocument();
    expect(screen.getByLabelText("Revenue text color")).toBeInTheDocument();
    expect(screen.getByLabelText("Revenue transparency")).toBeInTheDocument();
  });

  it("switches to the Data tab and shows the type search input", () => {
    fetchDataTypesMock.mockResolvedValue([]);
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("tab", { name: "Data" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Search data types")).toBeInTheDocument();
  });

  it("shows a Save button on the Data tab", () => {
    fetchDataTypesMock.mockResolvedValue([]);
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("button", { name: "Save data binding" })).toBeInTheDocument();
  });

  it("dispatches fetchDataTypes when Data tab is activated", async () => {
    fetchDataTypesMock.mockResolvedValue([testDataType]);
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    await waitFor(() => expect(fetchDataTypesMock).toHaveBeenCalled());
  });

  it("shows the DataType list when data types are loaded", () => {
    fetchDataTypesMock.mockResolvedValue([]);
    renderModalWithDataType();
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("listbox", { name: "Data types" })).toBeInTheDocument();
    expect(screen.getByText("Sales Metrics")).toBeInTheDocument();
  });

  it("shows field mapping slots after selecting a DataType", () => {
    fetchDataTypesMock.mockResolvedValue([]);
    renderModalWithDataType();
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
    });
    const onClose = jest.fn();
    renderModalWithDataType(onClose);

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

    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.click(screen.getByText("Sales Metrics"));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();
  });

  it("calls updatePanelAppearance and closes on Appearance Save", async () => {
    updateAppearanceMock.mockResolvedValue({
      ...testPanel,
      appearance: { background: "#000000", color: "inherit", transparency: 0 },
    });

    const onClose = jest.fn();
    renderModal(onClose);

    fireEvent.change(screen.getByLabelText("Revenue background color"), {
      target: { value: "#000000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save panel style" }));

    await waitFor(() => {
      expect(updateAppearanceMock).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ background: "#000000" }),
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an inline error when Appearance Save fails", async () => {
    updateAppearanceMock.mockRejectedValue(new Error("Network error"));

    renderModal();

    fireEvent.change(screen.getByLabelText("Revenue background color"), {
      target: { value: "#ff0000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save panel style" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save panel appearance.")).toBeInTheDocument();
    });
  });

  it("closes without saving when Cancel is clicked and form is clean", () => {
    const onClose = jest.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(updateAppearanceMock).not.toHaveBeenCalled();
  });

  it("shows discard warning when Cancel is clicked with unsaved appearance changes", () => {
    renderModal();

    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();
  });

  it("discards changes and closes when Discard is confirmed", () => {
    const onClose = jest.fn();
    renderModal(onClose);

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

    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /Keep editing/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("You have unsaved changes. Discard them?")).not.toBeInTheDocument();
  });

  describe("Chart type selector", () => {
    it("shows the chart type selector for chart panels", () => {
      renderModalForChart();
      expect(screen.getByRole("group", { name: "Chart type" })).toBeInTheDocument();
    });

    it("does not show the chart type selector for non-chart panels", () => {
      renderModal();
      expect(screen.queryByRole("group", { name: "Chart type" })).not.toBeInTheDocument();
    });

    it("shows all four chart type options", () => {
      renderModalForChart();
      expect(screen.getByDisplayValue("line")).toBeInTheDocument();
      expect(screen.getByDisplayValue("bar")).toBeInTheDocument();
      expect(screen.getByDisplayValue("pie")).toBeInTheDocument();
      expect(screen.getByDisplayValue("scatter")).toBeInTheDocument();
    });

    it("shows a chart preview for chart panels", () => {
      renderModalForChart();
      expect(screen.getByTestId("chart-panel-preview")).toBeInTheDocument();
    });

    it("marks form dirty when chart type selection changes", () => {
      renderModalForChart();
      // default is "line"; change to "bar"
      fireEvent.click(screen.getByDisplayValue("bar"));
      fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
      expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();
    });

    it("does not mark form dirty when chart type remains unchanged", () => {
      renderModalForChart();
      // click "line" which is already selected
      fireEvent.click(screen.getByDisplayValue("line"));
      fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
      // No discard warning — form is not dirty
      expect(screen.queryByText("You have unsaved changes. Discard them?")).not.toBeInTheDocument();
    });

    it("includes chartType in the Save payload for chart panels", async () => {
      updateAppearanceMock.mockResolvedValue({
        ...chartPanel,
        appearance: {
          background: "transparent",
          color: "inherit",
          transparency: 0,
          chartType: "bar",
        },
      });

      renderModalForChart();

      fireEvent.click(screen.getByDisplayValue("bar"));
      fireEvent.click(screen.getByRole("button", { name: "Save panel style" }));

      await waitFor(() => {
        expect(updateAppearanceMock).toHaveBeenCalledWith(
          "p2",
          expect.objectContaining({ chartType: "bar" }),
        );
      });
    });

    it("does not include chartType in the Save payload for non-chart panels", async () => {
      updateAppearanceMock.mockResolvedValue({
        ...testPanel,
        appearance: { background: "#000000", color: "inherit", transparency: 0 },
      });

      renderModal();

      fireEvent.change(screen.getByLabelText("Revenue background color"), {
        target: { value: "#000000" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save panel style" }));

      await waitFor(() => {
        expect(updateAppearanceMock).toHaveBeenCalledWith(
          "p1",
          expect.not.objectContaining({ chartType: expect.anything() }),
        );
      });
    });
  });
});
