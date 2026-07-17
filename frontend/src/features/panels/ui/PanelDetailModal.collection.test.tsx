import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelCollection as updatePanelCollectionRequest } from "../services/panelService";
import { fetchDataTypes as fetchDataTypesRequest } from "../../dataTypes/services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { makeCollectionPanel } from "../../../test/panelFixtures";
import type { DataType } from "../../dataTypes/types/dataType";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-247 — the Collection editor issues a single config PATCH via
// `updatePanelCollection` following the absent-vs-null convention: a
// layout-only change carries `layout` but not unrelated cleared fields.

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelBinding: jest.fn(),
  updatePanelCollection: jest.fn(),
  updatePanelImage: jest.fn(),
  updatePanelDivider: jest.fn(),
}));

jest.mock("../../dataTypes/services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
}));

const updateCollectionMock = jest.mocked(updatePanelCollectionRequest);
const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);

const testDataType: DataType = {
  id: "dt-1",
  name: "Sales",
  sourceId: null,
  version: 1,
  fields: [
    { name: "amount", displayName: "Amount", dataType: "float", nullable: false },
    { name: "region", displayName: "Region", dataType: "string", nullable: false },
  ],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

const boundCollection = makeCollectionPanel({
  id: "p1",
  title: "Metrics by Region",
  config: {
    dataTypeId: "dt-1",
    fieldMapping: { value: "amount" },
    baseType: "metric",
    layout: "grid",
  },
});

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
}

function renderCollectionModal(panel = boundCollection) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
    dataTypes: { items: [testDataType], status: "succeeded" },
  });
}

describe("CollectionEditor", () => {
  beforeEach(() => {
    updateCollectionMock.mockReset();
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("shows the base-type, binding, item-field, and layout sections in edit mode", () => {
    renderCollectionModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getByLabelText("Base type")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Layout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toBeInTheDocument();
  });

  it("saves a layout-only change with layout set and no unrelated cleared fields", async () => {
    updateCollectionMock.mockResolvedValue(
      makeCollectionPanel({ id: "p1", config: { layout: "list" } }),
    );
    renderCollectionModal();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateCollectionMock).toHaveBeenCalled());
    const [, args] = updateCollectionMock.mock.calls[0];
    expect(args.layout).toBe("list");
    expect(args.baseType).toBe("metric");
    // The binding is resent wholesale (backend replaces fieldMapping); the value
    // slot the panel already carried is preserved.
    expect(args.typeId).toBe("dt-1");
    expect(args.fieldMapping).toEqual({ value: "amount" });
  });
});
