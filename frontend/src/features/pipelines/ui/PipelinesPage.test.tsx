import { fireEvent, screen, waitFor } from "@testing-library/react";

import { getPipelines } from "../services/pipelineService";
import { renderWithStore } from "../../../test/renderWithStore";
import { PipelinesPage } from "./PipelinesPage";

jest.mock("../services/pipelineService", () => ({
  getPipelines: jest.fn(),
  createPipeline: jest.fn(),
}));

jest.mock("../../sources/state/sourcesSlice", () => ({
  ...jest.requireActual("../../sources/state/sourcesSlice"),
  fetchSources: jest.fn(() => ({
    type: "sources/fetchSources/pending",
    unwrap: () => Promise.resolve([]),
  })),
}));

const getPipelinesMock = jest.mocked(getPipelines);

const testPipelines = [
  {
    id: "p-1",
    name: "Sales Pipeline",
    sourceDataSourceId: "ds-1",
    sourceDataSourceName: "Sales API",
    outputDataTypeName: "SalesMetrics",
    outputDataTypeId: "dt-sales",
    lastRunStatus: "succeeded" as const,
    lastRunAt: "2026-05-01T10:00:00Z",
    lastRunRowCount: 1234,
  },
  {
    id: "p-2",
    name: "Inventory Sync",
    sourceDataSourceId: "ds-2",
    sourceDataSourceName: "ERP DB",
    outputDataTypeName: "InventoryData",
    outputDataTypeId: "dt-inventory",
    lastRunStatus: "failed" as const,
    lastRunAt: "2026-04-30T08:00:00Z",
    lastRunRowCount: null,
  },
];

describe("PipelinesPage", () => {
  beforeEach(() => {
    getPipelinesMock.mockReset();
    // jsdom does not implement showModal/close natively; stub to set the open attribute.
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
  });

  it("renders the page shell (heading lives in the top breadcrumb, not in-page)", () => {
    getPipelinesMock.mockResolvedValueOnce([]);
    renderWithStore(<PipelinesPage />);
    expect(document.querySelector(".pipelines-page")).toBeInTheDocument();
  });

  it("shows empty state with New pipeline button when no pipelines exist", async () => {
    getPipelinesMock.mockResolvedValueOnce([]);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("Build your first pipeline")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New pipeline" })).toBeInTheDocument();
  });

  it("HEL-528: renders a skeleton, not the empty state, while pipelines are loading", () => {
    getPipelinesMock.mockReturnValueOnce(new Promise(() => {})); // never resolves
    const { container } = renderWithStore(<PipelinesPage />);

    expect(container.querySelector(".ui-empty-state--main .ui-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Build your first pipeline")).not.toBeInTheDocument();
  });

  it("HEL-528: keeps rendering an already-loaded pipeline list instead of the skeleton if `status` re-enters loading", () => {
    // `fetchPipelines`'s own `condition` guard (F-104) skips a re-dispatch
    // while `status === "loading"`, so this state is reached without the
    // mock ever needing to resolve.
    const { container } = renderWithStore(<PipelinesPage />, {
      pipelines: { items: testPipelines, status: "loading" },
    });

    expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    expect(container.querySelector(".ui-skeleton")).not.toBeInTheDocument();
  });

  it("opens the modal when the empty state New pipeline button is clicked", async () => {
    getPipelinesMock.mockResolvedValueOnce([]);
    renderWithStore(<PipelinesPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "New pipeline" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "New pipeline" }));

    expect(screen.getByRole("dialog", { name: "Create pipeline" })).toBeInTheDocument();
  });

  it("renders a row for each pipeline when pipelines exist", async () => {
    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("Sales Pipeline")).toBeInTheDocument());

    expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Sales API")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();

    expect(screen.getByText("Inventory Sync")).toBeInTheDocument();
    expect(screen.getByText("ERP DB")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows row count in Rows Written column when lastRunRowCount is non-null", async () => {
    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("Sales Pipeline")).toBeInTheDocument());

    // testPipelines[0] has lastRunRowCount: 1234
    expect(screen.getByText("1,234 rows")).toBeInTheDocument();
  });

  it("shows — in Rows Written column when lastRunRowCount is null", async () => {
    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("Sales Pipeline")).toBeInTheDocument());

    // testPipelines[1] has lastRunRowCount: null — column shows a dash
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  // HEL sweep F-133: a populated list previously had no in-page way to
  // create a pipeline — only the sidebar "+" (SidebarItemList's onAdd)
  // worked, an inconsistency with MetricsPage's toolbar. Restored to mirror
  // MetricsPage.tsx exactly.
  it("renders an in-page toolbar New pipeline button when pipelines exist", async () => {
    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    renderWithStore(<PipelinesPage />);
    await waitFor(() => expect(screen.getByText("Sales Pipeline")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New pipeline" })).toBeInTheDocument();
  });

  it("opens the create pipeline modal from the toolbar button when pipelines exist", async () => {
    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    renderWithStore(<PipelinesPage />);
    await waitFor(() => expect(screen.getByText("Sales Pipeline")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New pipeline" }));

    expect(screen.getByRole("dialog", { name: "Create pipeline" })).toBeInTheDocument();
  });

  it("does not render the empty state when pipelines exist", async () => {
    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("Sales Pipeline")).toBeInTheDocument());

    expect(screen.queryByText("Build your first pipeline")).not.toBeInTheDocument();
  });

  it("shows error message when fetch fails", async () => {
    getPipelinesMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load pipelines.");
  });

  // HEL-539 — Retry re-dispatches fetchPipelines and recovers on success
  it("Retry re-dispatches fetchPipelines and clears the error on success", async () => {
    getPipelinesMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<PipelinesPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load pipelines");
    const retryBtn = screen.getByRole("button", { name: "Retry" });

    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    fireEvent.click(retryBtn);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText("Sales Pipeline")).toBeInTheDocument();
    expect(getPipelinesMock).toHaveBeenCalledTimes(2);
  });

  it("shows 'never run' badge for pipelines with null lastRunStatus", async () => {
    const neverRunPipeline = {
      id: "p-3",
      name: "New Pipeline",
      sourceDataSourceId: "ds-3",
      sourceDataSourceName: "CSV Source",
      outputDataTypeName: "RawData",
      outputDataTypeId: "dt-raw",
      lastRunStatus: null as null,
      lastRunAt: null,
      lastRunRowCount: null,
    };
    getPipelinesMock.mockResolvedValueOnce([neverRunPipeline]);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("New Pipeline")).toBeInTheDocument());
    expect(screen.getByText("Never run")).toBeInTheDocument();
  });
});
