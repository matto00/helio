import fs from "fs";
import path from "path";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { deletePipeline, getPipelines } from "../services/pipelineService";
import { renderWithStore } from "../../../test/renderWithStore";
import { expectTapExpander, findMediaBlock } from "../../../shared/ui/tapTargetTestUtils";
import { PipelinesPage } from "./PipelinesPage";
import { PipelineSpineHeader } from "./spine/PipelineSpineHeader";

jest.mock("../services/pipelineService", () => ({
  getPipelines: jest.fn(),
  createPipeline: jest.fn(),
  deletePipeline: jest.fn(),
}));
jest.mock("../../sources/state/sourcesSlice", () => ({
  ...jest.requireActual("../../sources/state/sourcesSlice"),
  fetchSources: jest.fn(() => ({
    type: "sources/fetchSources/pending",
    unwrap: () => Promise.resolve([]),
  })),
}));

const getPipelinesMock = jest.mocked(getPipelines);
const deletePipelineMock = jest.mocked(deletePipeline);

const pipelines = [
  {
    id: "p-1",
    name: "Sales Pipeline",
    roots: [{ id: "r-1", dataSourceId: "ds-1", dataSourceName: "Sales API" }],
    lastRunStatus: null,
    lastRunAt: null,
    lastRunRowCount: null,
  },
  {
    id: "p-2",
    name: "Inventory Sync",
    roots: [{ id: "r-2", dataSourceId: "ds-2", dataSourceName: "ERP DB" }],
    lastRunStatus: null,
    lastRunAt: null,
    lastRunRowCount: null,
  },
];

describe("Data Pipelines overview: Delete row action (HEL-1574, owner ruling 2026-10-14)", () => {
  beforeEach(() => {
    getPipelinesMock.mockReset().mockResolvedValue(pipelines as never);
    deletePipelineMock.mockReset();
  });

  it("offers a Delete button per row, named with the pipeline, reachable by keyboard", async () => {
    renderWithStore(<PipelinesPage />);
    const button = await screen.findByRole("button", { name: "Delete Sales Pipeline" });
    expect(screen.getByRole("button", { name: "Delete Inventory Sync" })).toBeInTheDocument();
    button.focus();
    expect(button).toHaveFocus();
    expect(button.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it("confirms with the bound-Outputs warning, deletes, and stays on the overview", async () => {
    deletePipelineMock.mockResolvedValue(undefined);
    renderWithStore(<PipelinesPage />, undefined, "/pipelines");
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sales Pipeline" }));
    const confirm = screen.getByRole("group", { name: "Confirm delete Sales Pipeline" });
    expect(confirm).toHaveFocus();
    expect(
      within(confirm).getByText(/Any panels bound to this pipeline's Outputs will stop working\./),
    ).toBeInTheDocument();
    expect(deletePipelineMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Sales Pipeline" }));
    await waitFor(() => expect(deletePipelineMock).toHaveBeenCalledWith("p-1"));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Delete Sales Pipeline" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Delete Inventory Sync" })).toBeInTheDocument();
  });

  it("Cancel deletes nothing and returns focus to the row's button", async () => {
    renderWithStore(<PipelinesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sales Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deletePipelineMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete Sales Pipeline" })).toHaveFocus(),
    );
  });

  it("says so and keeps the row when the delete is refused", async () => {
    deletePipelineMock.mockRejectedValue(new Error("nope"));
    renderWithStore(<PipelinesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sales Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Sales Pipeline" }));
    expect(await screen.findByText("Failed to delete Sales Pipeline.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Sales Pipeline" })).toBeInTheDocument();
  });

  it("is absent from the pipeline detail header's actions", () => {
    renderWithStore(
      <PipelineSpineHeader
        pipelineName="Sales Pipeline"
        outputName="Sales Pipeline"
        setOutputName={jest.fn()}
        editingName={false}
        setEditingName={jest.fn()}
        isDirty={false}
        updateError={null}
        updateStatus="idle"
        isConfirmingCancel={false}
        onSave={jest.fn()}
        onCancel={jest.fn()}
        onConfirmDiscard={jest.fn()}
        onDismissConfirm={jest.fn()}
        run={{
          sseStatus: null,
          sseRowCount: null,
          sseErrorLog: null,
          runStatus: null,
          runError: null,
          runIsDry: null,
          runResult: null,
        }}
        lastRunAt={null}
        lastRunRowCount={null}
        lastRunStatus={null}
        lastRunTruncated={null}
        schedule={null}
        onEditSchedule={jest.fn()}
        onToggleScheduleEnabled={jest.fn()}
        onOpenHistory={jest.fn()}
        isOwner
        onOpenShare={jest.fn()}
        onEditOnlySource={null}
        onDryRun={jest.fn()}
        onRun={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("gives the row Delete a 44px hit expander on touch and narrow viewports (DESIGN.md §3)", () => {
    const css = fs.readFileSync(path.join(__dirname, "PipelineListTable.css"), "utf-8");
    expectTapExpander(
      findMediaBlock(css, "max-width: 768px), (pointer: coarse"),
      ".pipeline-list-table__delete-btn",
    );
  });

  it("after a successful delete, focus moves to the next row's Delete button", async () => {
    deletePipelineMock.mockResolvedValue(undefined);
    renderWithStore(<PipelinesPage />);
    const buttons = await screen.findAllByRole("button", { name: /^Delete / });
    const first = buttons[0]!.getAttribute("aria-label")!;
    const second = buttons[1]!.getAttribute("aria-label")!;
    fireEvent.click(buttons[0]!);
    fireEvent.click(screen.getByRole("button", { name: `Confirm delete ${first.slice(7)}` }));
    await waitFor(() => expect(screen.getByRole("button", { name: second })).toHaveFocus());
  });

  it("after deleting the only/last row, focus moves to the previous row, and to the heading when none is left", async () => {
    deletePipelineMock.mockResolvedValue(undefined);
    getPipelinesMock.mockResolvedValue([pipelines[0]] as never);
    renderWithStore(<PipelinesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sales Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Sales Pipeline" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Delete Sales Pipeline" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("after a refused delete, focus returns to the row's Delete button", async () => {
    deletePipelineMock.mockRejectedValue(new Error("nope"));
    renderWithStore(<PipelinesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sales Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Sales Pipeline" }));
    await screen.findByText("Failed to delete Sales Pipeline.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete Sales Pipeline" })).toHaveFocus(),
    );
  });

  it("opens the confirm as a row directly below the clicked row, and a double-click keeps it on that row", async () => {
    renderWithStore(<PipelinesPage />);
    const salesButton = await screen.findByRole("button", { name: "Delete Sales Pipeline" });
    const row = salesButton.closest("tr")!;
    fireEvent.click(salesButton);
    fireEvent.click(screen.getByRole("button", { name: "Delete Sales Pipeline" }));
    const group = screen.getByRole("group", { name: "Confirm delete Sales Pipeline" });
    expect(screen.getAllByRole("group", { name: /Confirm delete/ })).toHaveLength(1);
    // The confirm is the very next table row; the clicked row is still there with its own Delete, in place.
    expect(group.closest("tr")).toBe(row.nextElementSibling);
    expect(screen.getByRole("button", { name: "Delete Sales Pipeline" }).closest("tr")).toBe(row);
    // The other row is untouched and still comes after the inserted confirm row.
    expect(row.nextElementSibling?.nextElementSibling).toBe(
      screen.getByRole("button", { name: "Delete Inventory Sync" }).closest("tr"),
    );
    // Nothing was deleted by the second click.
    expect(deletePipelineMock).not.toHaveBeenCalled();
  });
});
