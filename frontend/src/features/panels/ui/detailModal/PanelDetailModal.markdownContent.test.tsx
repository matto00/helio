import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelMarkdownContent as updatePanelMarkdownContentRequest } from "../../services/panelService";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeMarkdownPanel } from "../../../../test/panelFixtures";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-909: Markdown panel's Content editor is literal-only — the Source/
// Static bind-or-literal toggle was stripped per design.md's explicit
// resolution (a Markdown panel is dashboard-native and carries no Output).

jest.mock("../../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelMarkdownContent: jest.fn(),
  updatePanelTextContent: jest.fn(),
  updatePanelImage: jest.fn(),
  updatePanelDivider: jest.fn(),
}));

const updateMarkdownContentMock = jest.mocked(updatePanelMarkdownContentRequest);

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

const markdownPanel = makeMarkdownPanel({
  ...panelBaseFields,
  config: { content: "# Prior markdown" },
});

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });
}

function renderMarkdownModal(panel = markdownPanel) {
  setupDialog();
  return renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />);
}

describe("MarkdownEditor (via PanelDetailModal) — literal-only content", () => {
  beforeEach(() => {
    updateMarkdownContentMock.mockReset();
  });

  it("shows the current literal content and no bind-to-field control", () => {
    renderMarkdownModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect(screen.getByLabelText("Content")).toHaveValue("# Prior markdown");
    expect(screen.queryByRole("button", { name: "Bind to field" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search data types")).not.toBeInTheDocument();
  });

  it("saving edited content sends the new literal content", async () => {
    updateMarkdownContentMock.mockResolvedValue(
      makeMarkdownPanel({ ...panelBaseFields, config: { content: "## New markdown" } }),
    );
    renderMarkdownModal();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Content"), {
      target: { value: "## New markdown" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(updateMarkdownContentMock).toHaveBeenCalled());
    expect(updateMarkdownContentMock).toHaveBeenCalledWith("p1", "## New markdown");
  });

  it("does not call save when nothing was changed (no-op save)", async () => {
    renderMarkdownModal();
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Panel title"), {
      target: { value: "Renamed panel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument(),
    );
    expect(updateMarkdownContentMock).not.toHaveBeenCalled();
  });
});
