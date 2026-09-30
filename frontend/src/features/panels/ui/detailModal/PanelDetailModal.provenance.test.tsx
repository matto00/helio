import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { makeMarkdownPanel, makeOutputPanel } from "../../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../../pipelines/services/outputService";
import { resetProvenanceCache } from "../../provenance/provenanceCache";
import { fetchOutputProvenance } from "../../provenance/provenanceService";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-1207 A1/A2 — detail modal: trigger in the view-mode header AND next to the edit-mode Output
// link; popover inside the dialog; Escape closes only the popover.

jest.mock("../../../pipelines/services/outputService", () => ({
  getOutputById: jest.fn(),
  getOutputRows: jest.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 200 }),
  listOutputPanels: jest.fn().mockResolvedValue([]),
  getFilterCapabilities: jest.fn().mockResolvedValue({ columns: [] }),
}));
jest.mock("../../services/panelService", () => ({}));
jest.mock("../../provenance/provenanceService", () => ({
  fetchOutputProvenance: jest.fn(),
  fetchPublicProvenance: jest.fn(),
}));

beforeEach(() => {
  resetProvenanceCache();
  jest.mocked(getOutputByIdRequest).mockReset().mockResolvedValue({
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Revenue Table",
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
  });
  jest
    .mocked(fetchOutputProvenance)
    .mockReset()
    .mockResolvedValue({
      outputId: "output-1",
      pipeline: { id: "pipe-1", name: "Weekly sales" },
      sources: [{ id: "s", name: "Orders", kind: "csv" }],
      nodePath: [],
      lastRun: null,
      assertions: { defined: false, passed: 0, failed: 0, warned: 0, rootBound: true },
    });
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

describe("PanelDetailModal provenance (HEL-1207)", () => {
  it("view mode: trigger in the header; Escape closes only the popover, modal stays", async () => {
    const onClose = jest.fn();
    const panel = makeOutputPanel({ id: "p1", title: "Revenue", config: { outputId: "output-1" } });
    renderWithStore(<PanelDetailModal panel={panel} onClose={onClose} />);
    const dialogEl = document.querySelector("dialog") as HTMLDialogElement;
    const dialogKeydown = jest.fn();
    dialogEl.addEventListener("keydown", dialogKeydown);

    fireEvent.click(screen.getByRole("button", { name: "Data provenance" }));
    const popover = await screen.findByRole("dialog", { name: "Data provenance for Revenue" });
    expect(dialogEl.contains(popover)).toBe(true);
    expect(await screen.findByText("Weekly sales")).toBeInTheDocument();

    fireEvent.keyDown(popover, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Data provenance for Revenue" })).toBeNull(),
    );
    expect(dialogKeydown).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("edit mode: trigger sits beside the existing Output link, which is unchanged", async () => {
    const panel = makeOutputPanel({ id: "p1", title: "Revenue", config: { outputId: "output-1" } });
    renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} initialMode="edit" />);
    const link = await screen.findByRole("link", { name: "Revenue Table" });
    expect(link).toHaveAttribute("href", "/pipelines/pipe-1?outputId=output-1");
    expect(screen.getAllByRole("button", { name: "Data provenance" })).toHaveLength(1);
  });

  it("renders no trigger for a panel with no bound output", () => {
    const panel = makeMarkdownPanel({ id: "m1", title: "Notes" });
    renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Data provenance" })).toBeNull();
  });
});
