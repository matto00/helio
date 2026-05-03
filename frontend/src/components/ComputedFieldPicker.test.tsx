import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../test/renderWithStore";
import { PanelDetailModal } from "./PanelDetailModal";
import type { ComputedField, DataType } from "../types/models";

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn().mockResolvedValue({}),
  updatePanelBinding: jest.fn().mockResolvedValue({}),
}));

jest.mock("../services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
  validateExpression: jest.fn().mockResolvedValue({ valid: true }),
}));

const computedField: ComputedField = {
  name: "total",
  displayName: "Total",
  expression: "price * quantity",
  dataType: "float",
};

const testDataType: DataType = {
  id: "dt-1",
  name: "Sales",
  sourceId: null,
  version: 1,
  fields: [{ name: "price", displayName: "Price", dataType: "float", nullable: false }],
  computedFields: [computedField],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

const testPanel = {
  id: "p1",
  dashboardId: "d1",
  title: "Revenue Panel",
  type: "metric" as const,
  appearance: { background: "transparent", color: "inherit", transparency: 0 },
  meta: {
    createdBy: "system",
    createdAt: "2026-03-14T00:00:00Z",
    lastUpdated: "2026-03-14T00:00:00Z",
  },
  typeId: "dt-1",
  fieldMapping: null,
  refreshInterval: null,
  content: null,
  imageUrl: null,
  imageFit: null,
  dividerOrientation: null,
  dividerWeight: null,
  dividerColor: null,
};

function renderModal() {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });

  return renderWithStore(<PanelDetailModal panel={testPanel} onClose={jest.fn()} />, {
    dataTypes: { items: [testDataType], status: "succeeded" },
  });
}

describe("Field picker — computed fields", () => {
  it("shows computed field with (computed) label in the field picker select", () => {
    renderModal();

    // Enter edit mode first (modal opens in view mode by default)
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    // Switch to Data tab
    fireEvent.click(screen.getByRole("tab", { name: /data/i }));

    // The field mapping select for "Value" slot should include the computed field
    const selects = screen.getAllByRole("combobox");
    const valueSelect = selects.find((s) =>
      s.getAttribute("aria-label")?.toLowerCase().includes("value"),
    );
    expect(valueSelect).toBeDefined();

    // Should contain an option for the computed field
    const computedOption = Array.from(valueSelect!.querySelectorAll("option")).find(
      (opt) => opt.value === "total",
    );
    expect(computedOption).toBeDefined();
    expect(computedOption!.textContent).toMatch(/computed/i);
  });
});
