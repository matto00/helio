import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PipelinePreviewModal } from "./PipelinePreviewModal";
import { fetchDataTypeRows } from "../../dataTypes/services/dataTypeService";

jest.mock("../../dataTypes/services/dataTypeService", () => ({
  fetchDataTypeRows: jest.fn(),
}));

const fetchDataTypeRowsMock = jest.mocked(fetchDataTypeRows);

// jsdom does not implement <dialog> showModal/close natively; stub them so
// the modal's contents are actually present in the accessibility tree
// (mirrors RunHistoryModal.test.tsx's setupDialog).
HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});
HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

describe("PipelinePreviewModal", () => {
  const onClose = jest.fn();
  const onRunPipeline = jest.fn();
  const onDryRun = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // HEL sweep F-135: a pipeline with a persisted last run but no
  // in-session run result used to show "No output yet" — a lie, since the
  // pipeline has real output sitting in the database. The modal must fetch
  // and render that persisted snapshot instead.
  it("fetches and renders the persisted last-run snapshot when no session run exists", async () => {
    fetchDataTypeRowsMock.mockResolvedValue({
      rows: [{ name: "Alice" }, { name: "Bob" }],
      rowCount: 2,
    });

    render(
      <PipelinePreviewModal
        rows={null}
        rowCount={null}
        isDry={null}
        onClose={onClose}
        outputDataTypeId="dt-1"
        lastRunAt="2026-08-01T00:00:00Z"
        lastRunRowCount={2}
        onRunPipeline={onRunPipeline}
        onDryRun={onDryRun}
      />,
    );

    await waitFor(() => expect(fetchDataTypeRowsMock).toHaveBeenCalledWith("dt-1"));
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Last run — 2 rows")).toBeInTheDocument();
  });

  it("does not fetch a persisted snapshot when the pipeline has never run", () => {
    render(
      <PipelinePreviewModal
        rows={null}
        rowCount={null}
        isDry={null}
        onClose={onClose}
        outputDataTypeId="dt-1"
        lastRunAt={null}
        lastRunRowCount={null}
        onRunPipeline={onRunPipeline}
        onDryRun={onDryRun}
      />,
    );

    expect(fetchDataTypeRowsMock).not.toHaveBeenCalled();
    expect(screen.getByText("No output yet.")).toBeInTheDocument();
  });

  it("prefers the in-session run result over fetching a persisted snapshot", () => {
    render(
      <PipelinePreviewModal
        rows={[{ name: "Fresh" }]}
        rowCount={1}
        isDry={false}
        onClose={onClose}
        outputDataTypeId="dt-1"
        lastRunAt="2026-08-01T00:00:00Z"
        lastRunRowCount={9}
        onRunPipeline={onRunPipeline}
        onDryRun={onDryRun}
      />,
    );

    expect(fetchDataTypeRowsMock).not.toHaveBeenCalled();
    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.getByText("Last run — 1 row")).toBeInTheDocument();
  });

  it("labels a dry run subtitle distinctly from a real run", () => {
    render(
      <PipelinePreviewModal
        rows={[{ name: "Fresh" }]}
        rowCount={1}
        isDry={true}
        onClose={onClose}
        outputDataTypeId="dt-1"
        lastRunAt={null}
        lastRunRowCount={null}
        onRunPipeline={onRunPipeline}
        onDryRun={onDryRun}
      />,
    );

    expect(screen.getByText("Dry run — 1 row")).toBeInTheDocument();
  });

  // The empty state offers a real next action instead of a dead end.
  it("empty state offers Run pipeline and Dry run actions", () => {
    render(
      <PipelinePreviewModal
        rows={null}
        rowCount={null}
        isDry={null}
        onClose={onClose}
        outputDataTypeId={undefined}
        lastRunAt={null}
        lastRunRowCount={null}
        onRunPipeline={onRunPipeline}
        onDryRun={onDryRun}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run pipeline" }));
    expect(onRunPipeline).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Dry run" }));
    expect(onDryRun).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when the persisted-snapshot fetch fails", async () => {
    fetchDataTypeRowsMock.mockRejectedValue(new Error("network down"));

    render(
      <PipelinePreviewModal
        rows={null}
        rowCount={null}
        isDry={null}
        onClose={onClose}
        outputDataTypeId="dt-1"
        lastRunAt="2026-08-01T00:00:00Z"
        lastRunRowCount={2}
        onRunPipeline={onRunPipeline}
        onDryRun={onDryRun}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
  });
});
