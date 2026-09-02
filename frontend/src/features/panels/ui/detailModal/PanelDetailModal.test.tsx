import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelAppearance as updatePanelAppearanceRequest } from "../../services/panelService";
import { updatePanelDivider as updatePanelDividerRequest } from "../../services/panelService";
import { uploadPanelImage as uploadPanelImageRequest } from "../../services/panelService";
import { getOutputById as getOutputByIdRequest } from "../../../pipelines/services/outputService";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeDividerPanel, makeImagePanel, makeOutputPanel } from "../../../../test/panelFixtures";
import type { Output } from "../../../pipelines/types/output";
import { PanelDetailModal } from "./PanelDetailModal";

jest.mock("../../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelImage: jest.fn(),
  uploadPanelImage: jest.fn(),
  updatePanelDivider: jest.fn(),
  updatePanelTextContent: jest.fn(),
  updatePanelMarkdownContent: jest.fn(),
}));

jest.mock("../../../pipelines/services/outputService", () => ({
  getOutputById: jest.fn(),
  getOutputRows: jest.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 200 }),
  listOutputPanels: jest.fn().mockResolvedValue([]),
}));

const updateAppearanceMock = jest.mocked(updatePanelAppearanceRequest);
const updateDividerMock = jest.mocked(updatePanelDividerRequest);
const uploadImageMock = jest.mocked(uploadPanelImageRequest);
const getOutputByIdMock = jest.mocked(getOutputByIdRequest);

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

const testPanel = makeOutputPanel({ ...panelBaseFields, config: { outputId: "output-1" } });
const dividerTestPanel = makeDividerPanel({
  ...panelBaseFields,
  config: { orientation: "horizontal", weight: 1, color: "#cccccc" },
});
// Divider panel whose color is null (DB default — uses CSS design token at render time)
const dividerTestPanelNullColor = makeDividerPanel({
  ...panelBaseFields,
  config: { orientation: "horizontal", weight: 1 },
});
const imageTestPanel = makeImagePanel({
  ...panelBaseFields,
  config: { imageUrl: "https://example.com/img.png", imageFit: "contain" },
});

const testOutput: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "Revenue Table",
  kind: "table",
  config: {},
  schema: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
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

function renderDividerModal(onClose = jest.fn()) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={dividerTestPanel} onClose={onClose} />);
}

function renderDividerModalNullColor(onClose = jest.fn()) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={dividerTestPanelNullColor} onClose={onClose} />);
}

function renderImageModal(onClose = jest.fn()) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={imageTestPanel} onClose={onClose} />);
}

describe("PanelDetailModal", () => {
  beforeEach(() => {
    updateAppearanceMock.mockReset();
    updateDividerMock.mockReset();
    uploadImageMock.mockReset();
    getOutputByIdMock.mockReset();
    getOutputByIdMock.mockResolvedValue(testOutput);
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

  // F-123 — "Customize" in the panel actions menu passes initialMode="edit"
  // so it opens straight into the settings form, instead of landing on the
  // same read-only view a plain card click opens.
  it("opens directly in edit mode when initialMode is 'edit'", () => {
    renderWithStore(<PanelDetailModal panel={testPanel} onClose={jest.fn()} initialMode="edit" />);
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit panel" })).not.toBeInTheDocument();
  });

  // 2.1 — Edit mode shows unified form with no tab bar
  it("clicking Edit transitions to edit mode with a unified form — no tab bar present", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByLabelText("Revenue background color")).toBeInTheDocument();
  });

  // Output-kind sheet contract (specs/panel-detail-modal ADDED requirement) —
  // no field-mapping/aggregation control anywhere, and an Output link/Swap
  // output/placements note instead of a "Data" tab.
  it("output panel edit mode shows Output link/Swap output/placements note and no field-mapping control", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(await screen.findByRole("link", { name: "Revenue Table" })).toHaveAttribute(
      "href",
      "/pipelines/pipe-1?outputId=output-1",
    );
    expect(screen.getByRole("button", { name: "Swap output" })).toBeInTheDocument();
    expect(screen.getByText(/Used on/)).toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "Data" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Value field")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search data types")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/aggregation/i)).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText("You have unsaved changes. Discard them?")).not.toBeInTheDocument();
  });

  it("close from edit mode with unsaved changes still shows discard warning", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
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

    const input = document.createElement("input");
    input.type = "text";
    dialog.appendChild(input);

    fireEvent.keyDown(input, { key: "e" });

    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  // ✕ button — close behavior from edit mode. HEL-716: the ✕ button now
  // routes through the same unified `onClose` as backdrop-click/Escape/the
  // footer Cancel button (see openspec design.md Decision 5) — leaving edit
  // mode via any of those vectors always reverts to view mode rather than
  // closing the whole modal (only a dismiss from view mode actually closes).
  it("✕ button in edit mode with no changes returns to view mode (does not close)", () => {
    const onClose = jest.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
    expect(screen.queryByText("You have unsaved changes. Discard them?")).not.toBeInTheDocument();
  });

  it("✕ button in edit mode with unsaved changes shows discard warning; confirming returns to view mode", () => {
    const onClose = jest.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Discard/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
  });

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

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
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

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();

    expect(updateAppearanceMock).not.toHaveBeenCalled();
    expect(store.getState().panels.pendingPanelUpdates["p1"]).toBeDefined();
    expect(store.getState().panels.pendingPanelUpdates["p1"].appearance?.background).toBe(
      "#000000",
    );
  });

  // Task 2.3 — Cancel with no changes transitions to view mode (not close)
  it("Cancel with no changes transitions to view mode (not close)", () => {
    const onClose = jest.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
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
  });

  // Task 2.7 — "Unsaved changes" indicator appears in header after modifying a field
  it("Unsaved changes indicator appears in header after modifying a field in edit mode", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

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

    fireEvent.change(screen.getByLabelText("Revenue background color"), {
      target: { value: "#ff0000" },
    });

    expect(updateAppearanceMock).not.toHaveBeenCalled();
    expect(updateDividerMock).not.toHaveBeenCalled();
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

    it("does not show divider controls when the panel is output-kind", () => {
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
    updateDividerMock.mockReset();
    getOutputByIdMock.mockReset();
    getOutputByIdMock.mockResolvedValue(testOutput);
  });

  it("shows Divider section controls in edit mode for divider panels", () => {
    renderDividerModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.getByLabelText("Divider orientation")).toBeInTheDocument();
    expect(screen.getByLabelText("Divider weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Divider color")).toBeInTheDocument();
  });

  it("does not show divider controls in view mode", () => {
    renderDividerModal();
    expect(screen.queryByLabelText("Divider orientation")).not.toBeInTheDocument();
  });

  it("preserves null color when other divider settings change: sends null instead of #cccccc", async () => {
    // When dividerColor is null in the DB, the picker shows #cccccc as a UI fallback.
    // If the user changes another field (e.g. weight) but leaves color at the fallback,
    // null must be passed — not "#cccccc" — so the CSS design-token default stays active.
    updateDividerMock.mockResolvedValue(
      makeDividerPanel({
        ...panelBaseFields,
        config: { orientation: "horizontal", weight: 2 },
      }),
    );
    renderDividerModalNullColor();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Divider weight"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() =>
      expect(updateDividerMock).toHaveBeenCalledWith(
        dividerTestPanelNullColor.id,
        "horizontal",
        2,
        null, // null preserved — not "#cccccc"
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
  });

  it("passes an explicit color through when the user picks a non-fallback value", async () => {
    updateDividerMock.mockResolvedValue(
      makeDividerPanel({
        ...panelBaseFields,
        config: { orientation: "horizontal", weight: 1, color: "#ff0000" },
      }),
    );
    renderDividerModal();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Divider color"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() =>
      expect(updateDividerMock).toHaveBeenCalledWith(
        dividerTestPanel.id,
        "horizontal",
        1,
        "#ff0000",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
  });
});

describe("Image editor upload (HEL-246)", () => {
  beforeEach(() => {
    uploadImageMock.mockReset();
  });

  it("uploads a selected file and sets the URL field to the returned url", async () => {
    uploadImageMock.mockResolvedValue({ id: "abc123", url: "/api/uploads/image/abc123" });
    renderImageModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload image file"), { target: { files: [file] } });

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(screen.getByLabelText("Image URL")).toHaveValue("/api/uploads/image/abc123"),
    );
  });

  it("shows an inline error and preserves the existing imageUrl when the upload fails", async () => {
    uploadImageMock.mockRejectedValue(new Error("boom"));
    renderImageModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload image file"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/Upload failed/)).toBeInTheDocument());
    expect(screen.getByLabelText("Image URL")).toHaveValue("https://example.com/img.png");
  });
});
