import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelMarkdownBinding as updatePanelMarkdownBindingRequest } from "../services/panelService";
import { fetchDataTypes as fetchDataTypesRequest } from "../../dataTypes/services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { makeMarkdownPanel } from "../../../test/panelFixtures";
import type { DataType } from "../../dataTypes/types/dataType";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-245 — Markdown panel's Content editor (Source/Static modes), rebuilt on
// the field-or-literal pattern and wired through `PanelDetailModal`. Mirrors
// `PanelDetailModal.textContent.test.tsx` (HEL-244).

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelBinding: jest.fn(),
  updatePanelMarkdownBinding: jest.fn(),
  updatePanelImage: jest.fn(),
  updatePanelDivider: jest.fn(),
}));

jest.mock("../../dataTypes/services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
}));

const updateMarkdownBindingMock = jest.mocked(updatePanelMarkdownBindingRequest);
const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);

const panelBaseFields = {
  id: "p1",
  dashboardId: "d1",
  title: "Report",
  appearance: { background: "transparent", color: "inherit", transparency: 0 },
  meta: {
    createdBy: "system",
    createdAt: "2026-03-14T00:00:00Z",
    lastUpdated: "2026-03-14T00:00:00Z",
  },
};

const testDataType: DataType = {
  id: "dt-1",
  name: "Summaries",
  sourceId: null,
  version: 1,
  fields: [
    { name: "body", displayName: "Body", dataType: "string", nullable: false },
    { name: "author", displayName: "Author", dataType: "string", nullable: false },
  ],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

const unboundPanelWithLiteral = makeMarkdownPanel({
  ...panelBaseFields,
  config: { content: "# Prior markdown", dataTypeId: "", fieldMapping: {} },
});

const boundPanel = makeMarkdownPanel({
  ...panelBaseFields,
  config: { content: "# Fallback", dataTypeId: "dt-1", fieldMapping: { content: "body" } },
});

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });
}

function renderMarkdownModal(panel = unboundPanelWithLiteral) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
    dataTypes: { items: [testDataType], status: "succeeded" },
  });
}

describe("MarkdownEditor (via PanelDetailModal)", () => {
  beforeEach(() => {
    updateMarkdownBindingMock.mockReset();
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("defaults to Static (Fixed text) mode for an unbound panel and hides the DataType picker", () => {
    renderMarkdownModal(unboundPanelWithLiteral);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getByRole("button", { name: "Fixed text" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Content text")).toHaveValue("# Prior markdown");
    expect(screen.queryByLabelText("Search data types")).not.toBeInTheDocument();
  });

  it("defaults to Source (Bind to field) mode for a bound panel and shows the DataType picker", () => {
    renderMarkdownModal(boundPanel);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getByRole("button", { name: "Bind to field" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Summaries")).toBeInTheDocument();
  });

  it("saving in Source mode sends dataTypeId/fieldValue and does NOT touch content", async () => {
    updateMarkdownBindingMock.mockResolvedValue(boundPanel);
    renderMarkdownModal(unboundPanelWithLiteral);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Bind to field" }));
    fireEvent.click(screen.getByText("Summaries"));
    fireEvent.click(screen.getByLabelText("Content field"));
    fireEvent.click(screen.getByRole("option", { name: "body" }));
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateMarkdownBindingMock).toHaveBeenCalled());
    const [panelId, args] = updateMarkdownBindingMock.mock.calls[0];
    expect(panelId).toBe("p1");
    expect(args.mode).toBe("field");
    expect(args.typeId).toBe("dt-1");
    expect(args.fieldValue).toBe("body");
    expect(args.literalValue).toBe("# Prior markdown");
  });

  it("saving in Static mode sends the edited literal content and clears the binding", async () => {
    updateMarkdownBindingMock.mockResolvedValue(unboundPanelWithLiteral);
    renderMarkdownModal(boundPanel);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Fixed text" }));
    fireEvent.change(screen.getByLabelText("Content text"), {
      target: { value: "## New markdown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateMarkdownBindingMock).toHaveBeenCalled());
    const [panelId, args] = updateMarkdownBindingMock.mock.calls[0];
    expect(panelId).toBe("p1");
    expect(args.mode).toBe("literal");
    expect(args.literalValue).toBe("## New markdown");
  });

  it("does not call save when nothing was changed (no-op save)", async () => {
    renderMarkdownModal(unboundPanelWithLiteral);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "Renamed panel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    expect(updateMarkdownBindingMock).not.toHaveBeenCalled();
  });
});
