import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { resetProvenanceCache } from "../provenance/provenanceCache";
import { fetchOutputProvenance } from "../provenance/provenanceService";
import { PanelFullscreenOverlay } from "./PanelFullscreenOverlay";

// HEL-1207 A1/A2 — fullscreen overlay: trigger in the Modal header slot, popover portalled INTO the
// dialog, and Escape closes only the popover (the Modal's own close is never requested).

jest.mock("../../pipelines/services/outputService", () => ({
  getOutputById: jest.fn().mockResolvedValue(null),
}));
jest.mock("../provenance/provenanceService", () => ({
  fetchOutputProvenance: jest.fn(),
  fetchPublicProvenance: jest.fn(),
}));

beforeEach(() => {
  resetProvenanceCache();
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

const dataProps = {
  data: null,
  rawRows: null,
  headers: null,
  isLoading: false,
  error: null,
  errorKind: null,
  noData: true,
  neverMaterialized: false,
  rowsTruncated: false,
  refresh: jest.fn(),
  chartInspectConfig: null,
  crossFilterMode: "none" as const,
};

describe("PanelFullscreenOverlay provenance (HEL-1207)", () => {
  it("portals the popover into the dialog and Escape closes only the popover", async () => {
    const onClose = jest.fn();
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelFullscreenOverlay panel={panel} open onClose={onClose} {...dataProps} />);
    const dialogEl = document.querySelector("dialog") as HTMLDialogElement;
    const dialogKeydown = jest.fn();
    dialogEl.addEventListener("keydown", dialogKeydown);

    fireEvent.click(screen.getByRole("button", { name: "Data provenance" }));
    const popover = await screen.findByRole("dialog", { name: "Data provenance for Revenue" });
    expect(dialogEl.contains(popover)).toBe(true);

    fireEvent.keyDown(popover, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Data provenance for Revenue" })).toBeNull(),
    );
    // The Escape never reached the enclosing dialog (Modal's close path) ...
    expect(dialogKeydown).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // ... and focus is back on the trigger, the overlay itself still open.
    expect(screen.getByRole("button", { name: "Data provenance" })).toHaveFocus();
    expect(dialogEl).toHaveAttribute("open");
  });

  it("renders no trigger while closed", () => {
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(
      <PanelFullscreenOverlay panel={panel} open={false} onClose={jest.fn()} {...dataProps} />,
    );
    expect(screen.queryByRole("button", { name: "Data provenance", hidden: true })).toBeNull();
  });
});
