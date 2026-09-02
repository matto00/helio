import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelTextContent as updatePanelTextContentRequest } from "../../services/panelService";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeTextPanel } from "../../../../test/panelFixtures";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-909: Text panel's Content editor is literal-only — the Source/Static
// bind-or-literal toggle was stripped per design.md's explicit resolution
// (a Text panel is dashboard-native and carries no Output).

jest.mock("../../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelTextContent: jest.fn(),
  updatePanelMarkdownContent: jest.fn(),
  updatePanelImage: jest.fn(),
  updatePanelDivider: jest.fn(),
}));

const updateTextContentMock = jest.mocked(updatePanelTextContentRequest);

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

const textPanel = makeTextPanel({
  ...panelBaseFields,
  config: { content: "Prior literal text" },
});

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });
}

function renderTextModal(panel = textPanel) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />);
}

describe("TextContentEditor (via PanelDetailModal) — literal-only content", () => {
  beforeEach(() => {
    updateTextContentMock.mockReset();
  });

  it("shows the current literal content and no bind-to-field control", () => {
    renderTextModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getByLabelText("Content")).toHaveValue("Prior literal text");
    expect(screen.queryByRole("button", { name: "Bind to field" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search data types")).not.toBeInTheDocument();
  });

  it("saving edited content sends the new literal content", async () => {
    updateTextContentMock.mockResolvedValue(
      makeTextPanel({ ...panelBaseFields, config: { content: "New static text" } }),
    );
    renderTextModal();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Content"), {
      target: { value: "New static text" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateTextContentMock).toHaveBeenCalled());
    expect(updateTextContentMock).toHaveBeenCalledWith("p1", "New static text");
  });

  it("discarding edits resets content back to the panel's saved value", () => {
    renderTextModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    fireEvent.change(screen.getByLabelText("Content"), {
      target: { value: "Unsaved draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    expect(screen.getByLabelText("Content")).toHaveValue("Prior literal text");
  });

  it("does not call save when nothing was changed (no-op save)", async () => {
    renderTextModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    // Change only the title (appearance-level change), leaving Content untouched.
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "Renamed panel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    expect(updateTextContentMock).not.toHaveBeenCalled();
  });
});
