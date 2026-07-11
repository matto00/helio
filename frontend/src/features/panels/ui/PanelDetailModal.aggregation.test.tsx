import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelBinding as updatePanelBindingRequest } from "../services/panelService";
import { fetchDataTypes as fetchDataTypesRequest } from "../../dataTypes/services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { makeChartPanel, makeMetricPanel } from "../../../test/panelFixtures";
import type { DataType } from "../../dataTypes/types/dataType";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-292 — BindingEditor's aggregation controls, exercised through
// PanelDetailModal (the established pattern for testing BindingEditor in
// this codebase — see PanelDetailModal.test.tsx / .computedFields.test.tsx).

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

const panelBaseFields = {
  id: "p1",
  dashboardId: "d1",
  title: "Ratings",
  appearance: { background: "transparent", color: "inherit", transparency: 0 },
  meta: {
    createdBy: "system",
    createdAt: "2026-03-14T00:00:00Z",
    lastUpdated: "2026-03-14T00:00:00Z",
  },
};

const testDataType: DataType = {
  id: "dt-1",
  name: "Netflix Titles",
  sourceId: null,
  version: 1,
  fields: [
    { name: "rating", displayName: "Rating", dataType: "float", nullable: false },
    { name: "year", displayName: "Year", dataType: "string", nullable: false },
    { name: "title", displayName: "Title", dataType: "string", nullable: false },
  ],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

const metricBoundPanel = makeMetricPanel({
  ...panelBaseFields,
  config: { dataTypeId: "dt-1", fieldMapping: {} },
});

const chartBoundPanel = makeChartPanel({
  ...panelBaseFields,
  config: { dataTypeId: "dt-1", fieldMapping: {} },
});

const metricWithAggregationPanel = makeMetricPanel({
  ...panelBaseFields,
  config: { dataTypeId: "dt-1", fieldMapping: {}, aggregation: { value: "rating", agg: "avg" } },
});

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });
}

function renderMetricModal(panel = metricBoundPanel) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
    dataTypes: { items: [testDataType], status: "succeeded" },
  });
}

function renderChartModal(panel = chartBoundPanel) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
    dataTypes: { items: [testDataType], status: "succeeded" },
  });
}

/** Open the portal-rendered listbox for the Select whose aria-label matches
 *  `labelSubstring` and click the option whose visible text is `optionText`. */
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

describe("BindingEditor aggregation controls", () => {
  beforeEach(() => {
    updateBindingMock.mockReset();
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("metric panel Data section shows an Aggregation sub-section with field + agg-function selectors", () => {
    renderMetricModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getByText("Aggregation")).toBeInTheDocument();
    expect(screen.getByLabelText("Aggregation field")).toBeInTheDocument();
    expect(screen.getByLabelText("Aggregation function")).toBeInTheDocument();
  });

  it("chart panel Data section shows an Aggregation sub-section with group-by, agg-function, and value-field selectors", () => {
    renderChartModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getByText("Aggregation")).toBeInTheDocument();
    expect(screen.getByLabelText("Group by field")).toBeInTheDocument();
    expect(screen.getByLabelText("Aggregation function")).toBeInTheDocument();
    expect(screen.getByLabelText("Aggregation value field")).toBeInTheDocument();
  });

  it("does not show aggregation controls before a DataType is selected", () => {
    renderMetricModal(makeMetricPanel({ ...panelBaseFields, config: { dataTypeId: "" } }));
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.queryByText("Aggregation")).not.toBeInTheDocument();
  });

  it("leaving aggregation controls unset and saving a field-mapping-only change omits config.aggregation entirely", async () => {
    updateBindingMock.mockResolvedValue(metricBoundPanel);
    renderMetricModal();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    selectOption("value field", "rating");
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateBindingMock).toHaveBeenCalled());
    const call = updateBindingMock.mock.calls[0];
    // The 5th (`aggregation`) arg is `undefined` when the section wasn't
    // touched — `buildBindingPatch` checks `args.aggregation !== undefined`,
    // so an explicit `undefined` and an omitted 5th arg are wire-equivalent:
    // either way `config.aggregation` is left out of the PATCH entirely
    // (unchanged absent spec).
    expect(call[0]).toBe("p1");
    expect(call[1]).toBe("dt-1");
    expect(call[4]).toBeUndefined();
  });

  it("configuring a metric aggregation and saving sends config.aggregation set to the configured spec", async () => {
    updateBindingMock.mockResolvedValue(metricBoundPanel);
    renderMetricModal();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    selectOption("aggregation field", "rating");
    selectOption("aggregation function", "Average");
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() =>
      expect(updateBindingMock).toHaveBeenCalledWith("p1", "dt-1", null, null, {
        value: "rating",
        agg: "avg",
      }),
    );
  });

  it("clearing a previously-configured aggregation and saving sends config.aggregation explicitly cleared (null)", async () => {
    updateBindingMock.mockResolvedValue(metricWithAggregationPanel);
    renderMetricModal(metricWithAggregationPanel);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    selectOption("aggregation field", "— None —");
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() =>
      expect(updateBindingMock).toHaveBeenCalledWith("p1", "dt-1", null, null, null),
    );
  });

  // HEL-292 (cycle-3 regression, evaluation-2.md CR #1) — Postgres JSONB does
  // not preserve object key insertion order: `{"value":"profit","agg":"avg"}`
  // round-trips as `{"agg":"avg","value":"profit"}`. These fixtures seed
  // `config.aggregation` with that exact reordered ("agg" before "value"/
  // "groupBy") shape — the opposite of BindingEditor's own construction
  // order (`{ value, agg }` for metric, `{ groupBy, agg, yField }` for
  // chart) — to prove the dirty check no longer depends on key order.
  it("does not show the Unsaved changes badge on mount for a metric panel whose saved aggregation round-tripped through Postgres with reordered keys", () => {
    const reorderedMetricPanel = makeMetricPanel({
      ...panelBaseFields,
      config: {
        dataTypeId: "dt-1",
        fieldMapping: {},
        aggregation: { agg: "avg", value: "rating" },
      },
    });
    renderMetricModal(reorderedMetricPanel);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("does not show the Unsaved changes badge on mount for a chart panel whose saved aggregation round-tripped through Postgres with reordered keys", () => {
    const reorderedChartPanel = makeChartPanel({
      ...panelBaseFields,
      config: {
        dataTypeId: "dt-1",
        fieldMapping: {},
        aggregation: { agg: "avg", yField: "rating", groupBy: "year" },
      },
    });
    renderChartModal(reorderedChartPanel);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
});
