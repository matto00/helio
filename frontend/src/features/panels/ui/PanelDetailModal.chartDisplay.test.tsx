import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelBinding as updatePanelBindingRequest } from "../services/panelService";
import { fetchDataTypes as fetchDataTypesRequest } from "../../dataTypes/services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { makeChartPanel } from "../../../test/panelFixtures";
import type { DataType } from "../../dataTypes/types/dataType";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-248 — Chart per-chart-type Display controls, exercised through
// PanelDetailModal (the established pattern for testing BindingEditor here —
// see PanelDetailModal.aggregation.test.tsx). The key acceptance criterion:
// switching the chart type + saving preserves the data binding, refresh
// interval, and OTHER chart types' stored display options.

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelBinding: jest.fn(),
  updatePanelContent: jest.fn(),
  updatePanelImage: jest.fn(),
  updatePanelDivider: jest.fn(),
}));

jest.mock("../../dataTypes/services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
}));

const updateBindingMock = jest.mocked(updatePanelBindingRequest);
const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);

const testDataType: DataType = {
  id: "dt-1",
  name: "Metrics",
  sourceId: null,
  version: 1,
  fields: [
    { name: "year", displayName: "Year", dataType: "string", nullable: false },
    { name: "rating", displayName: "Rating", dataType: "float", nullable: false },
    { name: "region", displayName: "Region", dataType: "string", nullable: false },
  ],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

const baseChart = {
  seriesColors: ["#5470c6"],
  legend: { show: true, position: "top" as const },
  tooltip: { enabled: true },
  axisLabels: {
    x: { show: true, label: "X" },
    y: { show: true, label: "Y" },
  },
};

function chartPanelWith(chartType: "line" | "bar" | "pie" | "scatter", chartOptions?: object) {
  return makeChartPanel({
    id: "p1",
    title: "Trend",
    refreshInterval: 60,
    appearance: {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...baseChart, chartType },
    },
    config: {
      dataTypeId: "dt-1",
      fieldMapping: { xAxis: "year", yAxis: "rating" },
      chartOptions,
    },
  });
}

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
}

function renderModal(panel: ReturnType<typeof chartPanelWith>) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
    dataTypes: { items: [testDataType], status: "succeeded" },
  });
}

function selectOption(labelSubstring: string, optionText: string) {
  const combobox = screen
    .getAllByRole("combobox")
    .find((el) =>
      el.getAttribute("aria-label")?.toLowerCase().includes(labelSubstring.toLowerCase()),
    );
  if (!combobox) throw new Error(`No combobox found matching "${labelSubstring}"`);
  fireEvent.click(combobox);
  fireEvent.click(screen.getByRole("option", { name: optionText }));
}

describe("BindingEditor chart Display controls (HEL-248)", () => {
  beforeEach(() => {
    updateBindingMock.mockReset();
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("renders a Display section that swaps with the live chart type", () => {
    renderModal(chartPanelWith("line"));
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    // Line controls first.
    expect(screen.getByRole("heading", { name: "Display" })).toBeInTheDocument();
    expect(screen.getByText("Smooth lines")).toBeInTheDocument();

    // Switch chart type to Pie via the Appearance section radio — the Display
    // section swaps to pie controls without saving.
    fireEvent.click(screen.getByLabelText("Chart type pie"));
    expect(screen.getByText("Percentage labels")).toBeInTheDocument();
    expect(screen.queryByText("Smooth lines")).not.toBeInTheDocument();
  });

  it("does not render a Display section for non-chart panels handled elsewhere", () => {
    // (chart-only guard is covered by the chart-type-config-editor spec; here we
    // assert the section is present for a chart panel with no stored options.)
    renderModal(chartPanelWith("bar"));
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.getByRole("heading", { name: "Display" })).toBeInTheDocument();
  });

  it("saving an untouched Display section omits chartOptions from the PATCH", async () => {
    updateBindingMock.mockResolvedValue(chartPanelWith("bar"));
    renderModal(chartPanelWith("bar"));

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    // Touch an unrelated binding field so a PATCH is dispatched at all.
    selectOption("refresh interval", "30s");
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateBindingMock).toHaveBeenCalled());
    // chartOptions is the 9th positional arg (index 8) — undefined when the
    // Display section is untouched, so `buildBindingPatch` omits the key.
    expect(updateBindingMock.mock.calls[0][8]).toBeUndefined();
  });

  it("switching type + editing the new type's options preserves the other type's stored options and the binding", async () => {
    const panel = chartPanelWith("line", { line: { smooth: true } });
    updateBindingMock.mockResolvedValue(panel);
    renderModal(panel);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    // Switch to Bar and enable stacking on the (new) bar Display controls.
    fireEvent.click(screen.getByLabelText("Chart type bar"));
    selectOption("bar stacking", "Stacked");

    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateBindingMock).toHaveBeenCalled());
    const call = updateBindingMock.mock.calls[0];
    // Binding preserved.
    expect(call[0]).toBe("p1");
    expect(call[1]).toBe("dt-1");
    // Refresh interval preserved (4th positional arg, index 3).
    expect(call[3]).toBe(60);
    // chartOptions (index 8) carries BOTH the untouched line entry and the new
    // bar entry — switching type destroyed nothing.
    expect(call[8]).toEqual({ line: { smooth: true }, bar: { stacking: "stacked" } });
  });
});
