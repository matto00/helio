import { fireEvent, screen, waitFor } from "@testing-library/react";

import * as pipelineService from "../services/pipelineService";
import { renderWithStore } from "../test/renderWithStore";
import { CreatePipelineModal } from "./CreatePipelineModal";

jest.mock("../services/pipelineService", () => ({
  getPipelines: jest.fn(),
  createPipeline: jest.fn(),
}));

const createPipelineMock = jest.mocked(pipelineService.createPipeline);

const testDataSources = [
  {
    id: "ds-1",
    name: "Sales API",
    sourceType: "rest_api",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "ds-2",
    name: "ERP DB",
    sourceType: "sql",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const newPipeline = {
  id: "p-new",
  name: "My Pipeline",
  sourceDataSourceName: "Sales API",
  outputDataTypeName: "SalesData",
  lastRunStatus: null as null,
  lastRunAt: null,
};

function renderModal(onClose = jest.fn()) {
  return renderWithStore(<CreatePipelineModal onClose={onClose} />, {
    sources: { items: testDataSources, status: "succeeded" },
  });
}

describe("CreatePipelineModal", () => {
  beforeEach(() => {
    createPipelineMock.mockReset();
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

  it("renders the data source select", () => {
    renderModal();
    expect(screen.getByLabelText("Data source")).toBeInTheDocument();
  });

  it("renders the output type name input", () => {
    renderModal();
    expect(screen.getByLabelText("Output type name")).toBeInTheDocument();
  });

  it("populates the data source select with available sources", () => {
    renderModal();
    expect(screen.getByRole("option", { name: "Sales API" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ERP DB" })).toBeInTheDocument();
  });

  it("shows inline error when name is empty on submit", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    await waitFor(() => expect(screen.getByText("Pipeline name is required.")).toBeInTheDocument());
  });

  it("shows inline error when data source is not selected on submit", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "My Pipeline" } });
    fireEvent.change(screen.getByLabelText("Output type name"), {
      target: { value: "SalesData" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    await waitFor(() => expect(screen.getByText("Data source is required.")).toBeInTheDocument());
  });

  it("shows inline error when output type name is empty on submit", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "My Pipeline" } });
    fireEvent.change(screen.getByLabelText("Data source"), { target: { value: "ds-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));
    await waitFor(() =>
      expect(screen.getByText("Output type name is required.")).toBeInTheDocument(),
    );
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
    fireEvent.change(screen.getByLabelText("Data source"), { target: { value: "ds-1" } });
    fireEvent.change(screen.getByLabelText("Output type name"), {
      target: { value: "SalesData" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() =>
      expect(createPipelineMock).toHaveBeenCalledWith({
        name: "My Pipeline",
        sourceDataSourceId: "ds-1",
        outputDataTypeName: "SalesData",
      }),
    );
  });

  it("calls onClose after successful submission", async () => {
    createPipelineMock.mockResolvedValueOnce(newPipeline);
    const onClose = jest.fn();
    renderModal(onClose);

    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "My Pipeline" } });
    fireEvent.change(screen.getByLabelText("Data source"), { target: { value: "ds-1" } });
    fireEvent.change(screen.getByLabelText("Output type name"), {
      target: { value: "SalesData" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an error message when createPipeline rejects", async () => {
    createPipelineMock.mockRejectedValueOnce("Failed to create pipeline.");
    renderModal();

    fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "My Pipeline" } });
    fireEvent.change(screen.getByLabelText("Data source"), { target: { value: "ds-1" } });
    fireEvent.change(screen.getByLabelText("Output type name"), {
      target: { value: "SalesData" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
