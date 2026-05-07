import { fireEvent, screen, waitFor } from "@testing-library/react";

import { getPipelines } from "../services/pipelineService";
import { renderWithStore } from "../test/renderWithStore";
import { PipelinesPage } from "./PipelinesPage";

jest.mock("../services/pipelineService", () => ({
  getPipelines: jest.fn(),
  createPipeline: jest.fn(),
}));

jest.mock("../features/sources/sourcesSlice", () => ({
  ...jest.requireActual("../features/sources/sourcesSlice"),
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
    sourceDataSourceName: "Sales API",
    outputDataTypeName: "SalesMetrics",
    lastRunStatus: "succeeded" as const,
    lastRunAt: "2026-05-01T10:00:00Z",
  },
  {
    id: "p-2",
    name: "Inventory Sync",
    sourceDataSourceName: "ERP DB",
    outputDataTypeName: "InventoryData",
    lastRunStatus: "failed" as const,
    lastRunAt: "2026-04-30T08:00:00Z",
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

  it("renders the Data Pipelines section heading", () => {
    getPipelinesMock.mockResolvedValueOnce([]);
    renderWithStore(<PipelinesPage />);
    expect(screen.getByRole("heading", { name: "Data Pipelines" })).toBeInTheDocument();
  });

  it("shows empty state with Create pipeline button when no pipelines exist", async () => {
    getPipelinesMock.mockResolvedValueOnce([]);
    renderWithStore(<PipelinesPage />);

    await waitFor(() =>
      expect(
        screen.getByText("No pipelines yet. Create one to start transforming your data."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Create pipeline" })).toBeInTheDocument();
  });

  it("opens the modal when the empty state Create pipeline button is clicked", async () => {
    getPipelinesMock.mockResolvedValueOnce([]);
    renderWithStore(<PipelinesPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create pipeline" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    expect(screen.getByRole("dialog", { name: "Create pipeline" })).toBeInTheDocument();
  });

  it("renders a row for each pipeline when pipelines exist", async () => {
    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("Sales Pipeline")).toBeInTheDocument());

    expect(screen.getByText("Sales Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Sales API")).toBeInTheDocument();
    expect(screen.getByText("SalesMetrics")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();

    expect(screen.getByText("Inventory Sync")).toBeInTheDocument();
    expect(screen.getByText("ERP DB")).toBeInTheDocument();
    expect(screen.getByText("InventoryData")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("shows a Create pipeline toolbar button in non-empty state", async () => {
    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("Sales Pipeline")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Create pipeline" })).toBeInTheDocument();
  });

  it("opens the modal when the toolbar Create pipeline button is clicked", async () => {
    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("Sales Pipeline")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    expect(screen.getByRole("dialog", { name: "Create pipeline" })).toBeInTheDocument();
  });

  it("does not render the empty state when pipelines exist", async () => {
    getPipelinesMock.mockResolvedValueOnce(testPipelines);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("Sales Pipeline")).toBeInTheDocument());

    expect(
      screen.queryByText("No pipelines yet. Create one to start transforming your data."),
    ).not.toBeInTheDocument();
  });

  it("shows error message when fetch fails", async () => {
    getPipelinesMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load pipelines.");
  });

  it("shows 'never run' badge for pipelines with null lastRunStatus", async () => {
    const neverRunPipeline = {
      id: "p-3",
      name: "New Pipeline",
      sourceDataSourceName: "CSV Source",
      outputDataTypeName: "RawData",
      lastRunStatus: null as null,
      lastRunAt: null,
    };
    getPipelinesMock.mockResolvedValueOnce([neverRunPipeline]);
    renderWithStore(<PipelinesPage />);

    await waitFor(() => expect(screen.getByText("New Pipeline")).toBeInTheDocument());
    expect(screen.getByText("never run")).toBeInTheDocument();
  });
});
