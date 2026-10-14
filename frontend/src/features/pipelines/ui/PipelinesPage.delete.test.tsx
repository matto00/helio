import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { deletePipeline, getPipelines } from "../services/pipelineService";
import { renderWithStore } from "../../../test/renderWithStore";
import { PipelinesPage } from "./PipelinesPage";
import { PipelineDetailHeader } from "./PipelineDetailHeader";

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
      <PipelineDetailHeader
        roots={[]}
        sourceByRootId={{}}
        onEditSource={jest.fn()}
        onAddRoot={jest.fn()}
        onRemoveRoot={jest.fn()}
        outputsCount={0}
        lastRunStatus={null}
        schedule={null}
        onEditSchedule={jest.fn()}
        onToggleScheduleEnabled={jest.fn()}
        onOpenHistory={jest.fn()}
        isOwner
        onOpenShare={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).not.toBeInTheDocument();
  });
});
