import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelBinding as updatePanelBindingRequest } from "../services/panelService";
import { fetchDataTypes as fetchDataTypesRequest } from "../../dataTypes/services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { makeMetricPanel } from "../../../test/panelFixtures";
import type { DataType } from "../../dataTypes/types/dataType";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-243 — literal label/unit are editable post-creation through the
// Label/Unit BoundOrLiteralField controls (previously HEL-293 only wired
// these at panel-creation time). See the
// `panel-config-field-or-literal-pattern` capability spec.
//
// `getAllByRole(..., { name: "Fixed text" })` / `"Bind to field"` returns
// two matches (Label row, then Unit row, in that DOM order) — index [0] is
// always the Label control's toggle button, [1] the Unit control's.

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
  title: "Revenue",
  appearance: { background: "transparent", color: "inherit", transparency: 0 },
  meta: {
    createdBy: "system",
    createdAt: "2026-03-14T00:00:00Z",
    lastUpdated: "2026-03-14T00:00:00Z",
  },
};

const testDataType: DataType = {
  id: "dt-1",
  name: "Sales",
  sourceId: null,
  version: 1,
  fields: [
    { name: "amount", displayName: "Amount", dataType: "float", nullable: false },
    { name: "currency", displayName: "Currency", dataType: "string", nullable: false },
  ],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

const panelNoLiteral = makeMetricPanel({
  ...panelBaseFields,
  config: { dataTypeId: "dt-1", fieldMapping: {} },
});

const panelWithLiteralLabel = makeMetricPanel({
  ...panelBaseFields,
  config: { dataTypeId: "dt-1", fieldMapping: {}, label: "Revenue" },
});

const panelWithLiteralUnit = makeMetricPanel({
  ...panelBaseFields,
  config: { dataTypeId: "dt-1", fieldMapping: {}, unit: "$" },
});

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });
}

function renderMetricModal(panel = panelNoLiteral) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
    dataTypes: { items: [testDataType], status: "succeeded" },
  });
}

describe("BindingEditor Label/Unit bind-or-literal controls", () => {
  beforeEach(() => {
    updateBindingMock.mockReset();
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("defaults the Label control to Bind to field when no literal label is set", () => {
    renderMetricModal(panelNoLiteral);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getAllByRole("button", { name: "Bind to field" })[0]).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Label field")).toBeInTheDocument();
  });

  it("defaults the Label control to Fixed text with the current value when a literal label is set", () => {
    renderMetricModal(panelWithLiteralLabel);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getAllByRole("button", { name: "Fixed text" })[0]).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Label text")).toHaveValue("Revenue");
  });

  it("setting a literal label after creation sends config.label set to the typed value", async () => {
    updateBindingMock.mockResolvedValue(panelWithLiteralLabel);
    renderMetricModal(panelNoLiteral);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Fixed text" })[0]);
    fireEvent.change(screen.getByLabelText("Label text"), { target: { value: "Revenue" } });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateBindingMock).toHaveBeenCalled());
    const call = updateBindingMock.mock.calls[0];
    expect(call[5]).toBe("Revenue"); // label
    expect(call[6]).toBeUndefined(); // unit untouched
  });

  it("clearing a previously-configured literal label sends config.label explicitly cleared (null)", async () => {
    updateBindingMock.mockResolvedValue(panelNoLiteral);
    renderMetricModal(panelWithLiteralLabel);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Bind to field" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateBindingMock).toHaveBeenCalled());
    const call = updateBindingMock.mock.calls[0];
    expect(call[5]).toBeNull(); // label explicitly cleared
  });

  it("setting a literal unit after creation sends config.unit set to the typed value", async () => {
    updateBindingMock.mockResolvedValue(panelWithLiteralUnit);
    renderMetricModal(panelNoLiteral);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Fixed text" })[1]);
    fireEvent.change(screen.getByLabelText("Unit text"), { target: { value: "$" } });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateBindingMock).toHaveBeenCalled());
    const call = updateBindingMock.mock.calls[0];
    expect(call[5]).toBeUndefined(); // label untouched
    expect(call[6]).toBe("$"); // unit
  });

  it("clearing a previously-configured literal unit sends config.unit explicitly cleared (null)", async () => {
    updateBindingMock.mockResolvedValue(panelNoLiteral);
    renderMetricModal(panelWithLiteralUnit);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Bind to field" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateBindingMock).toHaveBeenCalled());
    const call = updateBindingMock.mock.calls[0];
    expect(call[6]).toBeNull(); // unit explicitly cleared
  });
});
