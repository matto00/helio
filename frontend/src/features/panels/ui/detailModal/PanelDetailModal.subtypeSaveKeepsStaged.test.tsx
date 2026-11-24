// HEL-1828: a modal save that stages a title AND saves output controls must keep showing the new title when the
// controls response (a server copy that does not yet carry the staged title) lands, and after the batch flush.
// The modal gets the panel from the LIVE store (as DesktopPanelGrid does), so a revert is visible to it (C15).

import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import {
  buildBatchRequest,
  clearSentPendingPanelUpdates,
  fetchPanels,
  updatePanelsBatch,
} from "../../state/panelsSlice";
import { getFilterCapabilities, getOutputById } from "../../../pipelines/services/outputService";
import {
  updatePanelOutputControls as updatePanelOutputControlsRequest,
  updatePanelsBatch as updatePanelsBatchRequest,
} from "../../services/panelService";
import { PanelDetailModal } from "./PanelDetailModal";
import { OWNED_DASHBOARD_ID, seedOwnedDashboard } from "../../../../test/seedOwnedDashboard";
import type { Output } from "../../../pipelines/types/output";

jest.mock("../../../pipelines/services/outputService", () => ({
  getOutputById: jest.fn(),
  getFilterCapabilities: jest.fn(),
  listOutputPanels: jest.fn().mockResolvedValue([]),
  listOutputs: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../services/panelService", () => ({
  ...jest.requireActual("../../services/panelService"),
  updatePanelOutputControls: jest.fn(),
  updatePanelsBatch: jest.fn(),
}));

const controlsRequest = jest.mocked(updatePanelOutputControlsRequest);
const batchRequest = jest.mocked(updatePanelsBatchRequest);

const panel = makeOutputPanel({
  id: "p1",
  dashboardId: OWNED_DASHBOARD_ID,
  title: "Old title",
  config: { outputId: "output-1", controls: [] },
});

const output: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "Sales",
  kind: "table",
  config: {},
  schema: [{ name: "region", type: "string" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function LiveModal() {
  const live = useAppSelector((s) => s.panels.items.find((p) => p.id === "p1"));
  return live ? <PanelDetailModal panel={live} onClose={jest.fn()} /> : null;
}

function Flush() {
  const dispatch = useAppDispatch();
  const pending = useAppSelector((s) => s.panels.pendingPanelUpdates);
  return (
    <button
      type="button"
      onClick={() => {
        void dispatch(updatePanelsBatch(buildBatchRequest(pending)))
          .unwrap()
          .then(() => dispatch(clearSentPendingPanelUpdates(pending)));
      }}
    >
      flush
    </button>
  );
}

describe("PanelDetailModal subtype save keeps staged edits (HEL-1828)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    jest.mocked(getOutputById).mockResolvedValue(output);
    jest
      .mocked(getFilterCapabilities)
      .mockResolvedValue({ columns: [{ column: "region", operators: ["contains", "eq", "in"] }] });
    // the server copy after the controls save: new controls, but the OLD title (the title is still only staged)
    controlsRequest.mockImplementation(async () => ({
      ...panel,
      config: {
        ...panel.config,
        controls: [{ id: "c1", kind: "text", column: "region", label: "Text" }],
      },
    }));
    batchRequest.mockImplementation(async (req) => ({
      panels: req.panels.map((p) => ({ ...panel, title: p.title ?? panel.title })),
    }));
  });

  it("shows the new title after the controls save resolves and after the batch flush; sends it exactly once", async () => {
    const { store } = renderWithStore(
      <>
        <LiveModal />
        <Flush />
      </>,
    );
    seedOwnedDashboard(store);
    act(() => {
      store.dispatch(fetchPanels.fulfilled([panel], "req", OWNED_DASHBOARD_ID));
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Add control" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "New title" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Add control" }));
    fireEvent.click(screen.getByRole("option", { name: "Text" }));
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    await waitFor(() => expect(controlsRequest).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(store.getState().panels.items[0].config).toMatchObject({
        controls: [{ id: "c1" }],
      }),
    );
    // after the controls save resolved: the server copy landed, the staged title must still be shown
    expect(store.getState().panels.items[0].title).toBe("New title");
    expect(await screen.findByRole("dialog", { name: "New title settings" })).toBeInTheDocument();
    expect(store.getState().panels.pendingPanelUpdates["p1"]).toEqual({ title: "New title" });

    fireEvent.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(batchRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.getState().panels.pendingPanelUpdates).toEqual({}));

    expect(store.getState().panels.items[0].title).toBe("New title");
    expect(await screen.findByRole("dialog", { name: "New title settings" })).toBeInTheDocument();
    expect(batchRequest.mock.calls[0][0].panels).toEqual([{ id: "p1", title: "New title" }]);
    // the controls request carries neither title nor appearance
    expect(controlsRequest).toHaveBeenCalledWith("p1", [
      expect.objectContaining({ kind: "text", column: "region" }),
    ]);
    expect(controlsRequest.mock.calls[0]).toHaveLength(2);
  });
});
