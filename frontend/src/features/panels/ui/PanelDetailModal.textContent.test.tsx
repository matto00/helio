import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelTextBinding as updatePanelTextBindingRequest } from "../services/panelService";
import { fetchDataTypes as fetchDataTypesRequest } from "../../dataTypes/services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { makeTextPanel } from "../../../test/panelFixtures";
import type { DataType } from "../../dataTypes/types/dataType";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-244 — Text panel's Content editor (Source/Static modes), wired through
// `PanelDetailModal` (which previously had no Text editor at all). Mirrors
// the `PanelDetailModal.labelUnit.test.tsx` integration pattern established
// for HEL-243's Label/Unit controls.

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelBinding: jest.fn(),
  updatePanelContent: jest.fn(),
  updatePanelTextBinding: jest.fn(),
  updatePanelImage: jest.fn(),
  updatePanelDivider: jest.fn(),
}));

jest.mock("../../dataTypes/services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
}));

const updateTextBindingMock = jest.mocked(updatePanelTextBindingRequest);
const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);

const panelBaseFields = {
  id: "p1",
  dashboardId: "d1",
  title: "Announcement",
  appearance: { background: "transparent", color: "inherit", transparency: 0 },
  meta: {
    createdBy: "system",
    createdAt: "2026-03-14T00:00:00Z",
    lastUpdated: "2026-03-14T00:00:00Z",
  },
};

const testDataType: DataType = {
  id: "dt-1",
  name: "Headlines",
  sourceId: null,
  version: 1,
  fields: [
    { name: "headline", displayName: "Headline", dataType: "string", nullable: false },
    { name: "author", displayName: "Author", dataType: "string", nullable: false },
  ],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

const unboundPanelWithLiteral = makeTextPanel({
  ...panelBaseFields,
  config: { content: "Prior literal text", dataTypeId: "", fieldMapping: {} },
});

const boundPanel = makeTextPanel({
  ...panelBaseFields,
  config: { content: "Fallback text", dataTypeId: "dt-1", fieldMapping: { content: "headline" } },
});

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });
}

function renderTextModal(panel = unboundPanelWithLiteral) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
    dataTypes: { items: [testDataType], status: "succeeded" },
  });
}

describe("TextContentEditor (via PanelDetailModal)", () => {
  beforeEach(() => {
    updateTextBindingMock.mockReset();
    fetchDataTypesMock.mockResolvedValue([]);
  });

  it("defaults to Static (Fixed text) mode for an unbound panel and hides the DataType picker", () => {
    renderTextModal(unboundPanelWithLiteral);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getByRole("button", { name: "Fixed text" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Content text")).toHaveValue("Prior literal text");
    expect(screen.queryByLabelText("Search data types")).not.toBeInTheDocument();
  });

  it("defaults to Source (Bind to field) mode for a bound panel and shows the DataType picker", () => {
    renderTextModal(boundPanel);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getByRole("button", { name: "Bind to field" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Already-bound to "Headlines" — the picker shows the selected type, not the search box.
    expect(screen.getByText("Headlines")).toBeInTheDocument();
  });

  it("switching mode to Source reveals the DataType picker; switching back to Static hides it", () => {
    renderTextModal(unboundPanelWithLiteral);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    fireEvent.click(screen.getByRole("button", { name: "Bind to field" }));
    expect(screen.getByLabelText("Search data types")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fixed text" }));
    expect(screen.queryByLabelText("Search data types")).not.toBeInTheDocument();
  });

  it("saving in Source mode sends dataTypeId/fieldValue and does NOT touch content (bind-direction corollary)", async () => {
    updateTextBindingMock.mockResolvedValue(boundPanel);
    renderTextModal(unboundPanelWithLiteral);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Bind to field" }));
    fireEvent.click(screen.getByText("Headlines"));
    fireEvent.click(screen.getByLabelText("Content field"));
    fireEvent.click(screen.getByRole("option", { name: "headline" }));
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateTextBindingMock).toHaveBeenCalled());
    const [panelId, args] = updateTextBindingMock.mock.calls[0];
    expect(panelId).toBe("p1");
    expect(args.mode).toBe("field");
    expect(args.typeId).toBe("dt-1");
    expect(args.fieldValue).toBe("headline");
    // The regression this guards: the save call must carry the mode/typeId/
    // fieldValue needed to omit `content` from the outgoing patch (see
    // `buildContentBindingPatch`'s dedicated unit tests in panelPayloads.test.ts
    // for the exact patch-shape assertion) — literalValue is passed through
    // but `buildContentBindingPatch` never surfaces it in Source mode.
    expect(args.literalValue).toBe("Prior literal text");
  });

  it("saving in Static mode sends the edited literal content and clears the binding", async () => {
    updateTextBindingMock.mockResolvedValue(unboundPanelWithLiteral);
    renderTextModal(boundPanel);

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Fixed text" }));
    fireEvent.change(screen.getByLabelText("Content text"), {
      target: { value: "New static text" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateTextBindingMock).toHaveBeenCalled());
    const [panelId, args] = updateTextBindingMock.mock.calls[0];
    expect(panelId).toBe("p1");
    expect(args.mode).toBe("literal");
    expect(args.literalValue).toBe("New static text");
  });

  it("discarding edits resets the mode toggle and content back to the panel's saved values", () => {
    renderTextModal(unboundPanelWithLiteral);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    fireEvent.click(screen.getByRole("button", { name: "Bind to field" }));
    expect(screen.getByLabelText("Search data types")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.getByRole("button", { name: "Fixed text" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Content text")).toHaveValue("Prior literal text");
  });

  it("does not call save when nothing was changed (no-op save)", async () => {
    renderTextModal(unboundPanelWithLiteral);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    // Change only the title (appearance-level change), leaving Content untouched.
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "Renamed panel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    expect(updateTextBindingMock).not.toHaveBeenCalled();
  });
});
