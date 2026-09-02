import { fireEvent, screen, waitFor } from "@testing-library/react";
import { getPipelines } from "../services/pipelineService";

import * as pipelineService from "../services/pipelineService";
import { fetchSources as fetchSourcesRequest } from "../../sources/services/dataSourceService";
import { renderWithStore } from "../../../test/renderWithStore";
import { CreatePipelineModal } from "./CreatePipelineModal";

jest.mock("../services/pipelineService", () => ({
  getPipelines: jest.fn(),
  createPipeline: jest.fn(),
}));

// The modal always refetches sources on mount (see its own comment) — mocked here so that
// dispatch doesn't clobber a test's preloaded `sources` state with a real (jsdom-network-error)
// fetchSources.rejected before assertions run. Defaults to echoing back `testDataSources` below
// (matching most tests' own preloaded state) so its eventual async resolution is a no-op for
// them; the one test that cares about the empty-sources path overrides it explicitly.
jest.mock("../../sources/services/dataSourceService", () => ({
  fetchSources: jest.fn(),
}));

const createPipelineMock = jest.mocked(pipelineService.createPipeline);
const getPipelinesMock = jest.mocked(getPipelines);
const fetchSourcesMock = jest.mocked(fetchSourcesRequest);

import type { DataSource } from "../../sources/types/dataSource";

const testDataSources: DataSource[] = [
  {
    id: "ds-1",
    name: "Sales API",
    type: "rest_api",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    config: { url: "https://example.com/api" },
  },
  {
    id: "ds-2",
    name: "ERP DB",
    type: "sql",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    config: {
      dialect: "postgresql",
      host: "h",
      port: 5432,
      database: "d",
      user: "u",
      password: "p",
      query: "SELECT 1",
    },
  },
];

const newPipeline = {
  id: "p-new",
  name: "My Pipeline",
  sourceDataSourceId: "ds-1",
  sourceDataSourceName: "Sales API",
  outputDataTypeName: "SalesData",
  outputDataTypeId: "dt-sales",
  lastRunStatus: null as null,
  lastRunAt: null,
  lastRunRowCount: null as null,
};

function renderModal(onClose = jest.fn()) {
  return renderWithStore(<CreatePipelineModal onClose={onClose} />, {
    sources: { items: testDataSources, status: "succeeded" },
  });
}

/** Helper: open the custom Select for "Data source" and pick an option by
 *  name prefix (F-224 appends a "(kind)" suffix to each option's label, so
 *  callers match on the source name alone via a leading-anchor regex). */
function selectDataSource(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Data source" }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${label} `) }));
}

describe("CreatePipelineModal", () => {
  beforeEach(() => {
    createPipelineMock.mockReset();
    fetchSourcesMock.mockReset();
    fetchSourcesMock.mockResolvedValue(testDataSources);
    // jsdom does not implement showModal/close natively; stub to set the open attribute.
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
  });

  it("renders the pipeline name input", () => {
    renderModal();
    expect(screen.getByLabelText("Pipeline name")).toBeInTheDocument();
  });

  it("renders the data source select trigger", () => {
    renderModal();
    expect(screen.getByRole("combobox", { name: "Data source" })).toBeInTheDocument();
  });

  // F-041: creating a pipeline is impossible with zero sources — say so plainly instead of
  // leaving an empty picker as the only feedback.
  // HEL-908 task 7.1 — "no sources yet" no longer hard-blocks the form: the
  // picker is simply absent (nothing to pick from) and "Create a new source"
  // is always available, so Create pipeline stays enabled.
  it("hides the data source picker (nothing to pick) but still offers 'Create a new source' when there are none", async () => {
    fetchSourcesMock.mockResolvedValue([]);
    renderWithStore(<CreatePipelineModal onClose={jest.fn()} />, {
      sources: { items: [], status: "succeeded" },
    });

    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "Data source" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Create a new source" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create pipeline" })).not.toBeDisabled();
  });

  it("does not render an output type name input -- retired (DataType-bound)", () => {
    renderModal();
    expect(screen.queryByLabelText("Output type name")).not.toBeInTheDocument();
  });

  it("opens AddSourceModal when 'Create a new source' is activated, and pre-selects the created source on close", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create a new source" }));
    expect(screen.getByRole("dialog", { name: "Add data source" })).toBeInTheDocument();
  });

  it("populates the data source select with available sources when opened", () => {
    renderModal();
    fireEvent.click(screen.getByRole("combobox", { name: "Data source" }));
    expect(screen.getByRole("option", { name: /^Sales API / })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^ERP DB / })).toBeInTheDocument();
  });

  it("F-224: shows each data source's kind alongside its name, with no separate disabled placeholder option", () => {
    renderModal();
    fireEvent.click(screen.getByRole("combobox", { name: "Data source" }));
    expect(screen.getByRole("option", { name: "Sales API (REST API)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ERP DB (SQL)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Select a data source…" })).not.toBeInTheDocument();
  });

  it("shows inline error when name is empty on submit", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    await waitFor(() => expect(screen.getByText("Pipeline name is required.")).toBeInTheDocument());
  });

  it("shows inline error when data source is not selected on submit", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "My Pipeline" } });
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    await waitFor(() => expect(screen.getByText("Data source is required.")).toBeInTheDocument());
  });

  it("does not submit when validation fails", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    expect(createPipelineMock).not.toHaveBeenCalled();
  });

  it("calls createPipeline with the correct payload on valid submit", async () => {
    createPipelineMock.mockResolvedValueOnce(newPipeline);
    renderModal();

    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "My Pipeline" } });
    selectDataSource("Sales API");
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() =>
      expect(createPipelineMock).toHaveBeenCalledWith({
        name: "My Pipeline",
        sourceDataSourceId: "ds-1",
      }),
    );
  });

  it("calls onClose after successful submission", async () => {
    createPipelineMock.mockResolvedValueOnce(newPipeline);
    const onClose = jest.fn();
    renderModal(onClose);

    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "My Pipeline" } });
    selectDataSource("Sales API");
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // F-104 regression: `fetchPipelines`'s dedupe `condition` (pipelinesSlice.ts)
  // skips re-fetching once `pipelines.status` is already "succeeded" — the
  // overwhelmingly common case (SidebarBody fetches the list on load), which
  // used to make CreatePipelineModal's post-create `dispatch(fetchPipelines())`
  // silently no-op, leaving the just-created pipeline missing from the list
  // until a hard reload. `createPipeline.fulfilled` now pushes the created
  // pipeline into `state.items` directly instead of relying on a refetch.
  it("adds the created pipeline to the store even when the list was already loaded", async () => {
    createPipelineMock.mockResolvedValueOnce(newPipeline);
    getPipelinesMock.mockClear();
    const { store } = renderWithStore(<CreatePipelineModal onClose={jest.fn()} />, {
      sources: { items: testDataSources, status: "succeeded" },
      pipelines: { items: [], status: "succeeded" },
    });

    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "My Pipeline" } });
    selectDataSource("Sales API");
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() =>
      expect(store.getState().pipelines.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "p-new", name: "My Pipeline" })]),
      ),
    );
    // The old refetch-the-whole-list approach is gone — the created pipeline
    // reaches the store without ever calling the list endpoint again.
    expect(getPipelinesMock).not.toHaveBeenCalled();
  });

  it("shows an error message when createPipeline rejects", async () => {
    createPipelineMock.mockRejectedValueOnce("Failed to create pipeline.");
    renderModal();

    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "My Pipeline" } });
    selectDataSource("Sales API");
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
