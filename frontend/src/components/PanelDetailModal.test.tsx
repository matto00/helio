import { fireEvent, screen, waitFor } from "@testing-library/react";

import { updatePanelAppearance as updatePanelAppearanceRequest } from "../services/panelService";
import { renderWithStore } from "../test/renderWithStore";
import { PanelDetailModal } from "./PanelDetailModal";

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelAppearance: jest.fn(),
}));

const updateAppearanceMock = jest.mocked(updatePanelAppearanceRequest);

const testPanel = {
  id: "p1",
  dashboardId: "d1",
  title: "Revenue",
  type: "metric" as const,
  appearance: {
    background: "transparent",
    color: "inherit",
    transparency: 0,
  },
  meta: {
    createdBy: "system",
    createdAt: "2026-03-14T00:00:00Z",
    lastUpdated: "2026-03-14T00:00:00Z",
  },
};

function renderModal(onClose = jest.fn()) {
  // JSDOM does not implement showModal/close on <dialog>; mock them and simulate
  // the open attribute so the dialog is accessible in the rendered tree.
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });

  return renderWithStore(<PanelDetailModal panel={testPanel} onClose={onClose} />);
}

describe("PanelDetailModal", () => {
  beforeEach(() => {
    updateAppearanceMock.mockReset();
  });

  it("shows the panel title in the header", () => {
    renderModal();
    expect(screen.getByText(/Revenue/)).toBeInTheDocument();
  });

  it("opens the dialog via showModal on mount", () => {
    renderModal();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("renders the Appearance tab by default with color and transparency controls", () => {
    renderModal();
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("Revenue background color")).toBeInTheDocument();
    expect(screen.getByLabelText("Revenue text color")).toBeInTheDocument();
    expect(screen.getByLabelText("Revenue transparency")).toBeInTheDocument();
  });

  it("switches to the Data tab and shows the placeholder", () => {
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("tab", { name: "Data" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Connect a data source to display real content")).toBeInTheDocument();
  });

  it("hides the Save button on the Data tab", () => {
    renderModal();
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.queryByRole("button", { name: /Save/i })).not.toBeInTheDocument();
  });

  it("calls updatePanelAppearance and closes on Save", async () => {
    updateAppearanceMock.mockResolvedValue({
      ...testPanel,
      appearance: { background: "#000000", color: "inherit", transparency: 0 },
    });

    const onClose = jest.fn();
    renderModal(onClose);

    // Change the background color
    fireEvent.change(screen.getByLabelText("Revenue background color"), {
      target: { value: "#000000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save panel style" }));

    await waitFor(() => {
      expect(updateAppearanceMock).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ background: "#000000" }),
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an inline error when Save fails", async () => {
    updateAppearanceMock.mockRejectedValue(new Error("Network error"));

    renderModal();

    fireEvent.change(screen.getByLabelText("Revenue background color"), {
      target: { value: "#ff0000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save panel style" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save panel appearance.")).toBeInTheDocument();
    });
  });

  it("closes without saving when Cancel is clicked and form is clean", () => {
    const onClose = jest.fn();
    renderModal(onClose);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(updateAppearanceMock).not.toHaveBeenCalled();
  });

  it("shows discard warning when Cancel is clicked with unsaved changes", () => {
    renderModal();

    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.getByText("You have unsaved changes. Discard them?")).toBeInTheDocument();
  });

  it("discards changes and closes when Discard is confirmed", () => {
    const onClose = jest.fn();
    renderModal(onClose);

    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /Discard/i }));

    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the modal open when 'Keep editing' is clicked", () => {
    const onClose = jest.fn();
    renderModal(onClose);

    fireEvent.change(screen.getByLabelText("Revenue transparency"), {
      target: { value: "50" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /Keep editing/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("You have unsaved changes. Discard them?")).not.toBeInTheDocument();
  });
});
