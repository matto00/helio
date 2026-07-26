// HEL-399 — ShapeInstantiateStep's full instantiate → run → bind chain.
// Covers the HEL-336 defect guard (every pre-run failure shown inline,
// verbatim, never silent) and the run-failure "Retry run" affordance
// (design.md Decision 5).

import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import {
  createPipeline,
  createPipelineStep,
  expandPipelineShape,
  runPipeline,
} from "../../../pipelines/services/pipelineService";
import type {
  PipelineShapeCatalogEntry,
  ShapeStepExpansion,
} from "../../../pipelines/types/pipelineShape";
import { ShapeInstantiateStep } from "./ShapeInstantiateStep";

jest.mock("../../../pipelines/services/pipelineService", () => ({
  expandPipelineShape: jest.fn(),
  createPipeline: jest.fn(),
  createPipelineStep: jest.fn(),
  runPipeline: jest.fn(),
}));

const expandPipelineShapeMock = jest.mocked(expandPipelineShape);
const createPipelineMock = jest.mocked(createPipeline);
const createPipelineStepMock = jest.mocked(createPipelineStep);
const runPipelineMock = jest.mocked(runPipeline);

const singleRowShape: PipelineShapeCatalogEntry = {
  id: "single-row",
  label: "Single row",
  description: "Reduces a source to exactly one row.",
  paramsSchema: [
    { name: "mode", label: "Mode", dataType: "string", required: true, description: "" },
  ],
  outputContract: { rowCount: { kind: "exactly-one" }, description: "" },
};

const expansions: ShapeStepExpansion[] = [
  { kind: "aggregate", config: { groupBy: [], aggregations: [] } },
];

const storeWithSources = {
  dashboards: { items: [], selectedDashboardId: null },
  sources: {
    items: [
      {
        id: "ds-1",
        name: "Sales API",
        type: "rest_api" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        config: { url: "https://example.com/api" },
      },
    ],
    status: "succeeded" as const,
  },
};

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value: "Sales ETL" } });
  fireEvent.click(screen.getByRole("combobox", { name: "Data source" }));
  fireEvent.click(screen.getByRole("option", { name: "Sales API" }));
  fireEvent.change(screen.getByLabelText("Output type name"), {
    target: { value: "SalesMetrics" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Mode" }), {
    target: { value: "aggregate" },
  });
}

function renderStep(onComplete = jest.fn(), onBack = jest.fn()) {
  renderWithStore(
    <ShapeInstantiateStep shape={singleRowShape} onBack={onBack} onComplete={onComplete} />,
    storeWithSources,
  );
  return { onComplete, onBack };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ShapeInstantiateStep — full chain", () => {
  it("full-chain success calls onComplete with the created dataTypeId and pipelineId", async () => {
    expandPipelineShapeMock.mockResolvedValueOnce(expansions);
    createPipelineMock.mockResolvedValueOnce({
      id: "p-1",
      name: "Sales ETL",
      sourceDataSourceId: "ds-1",
      sourceDataSourceName: "Sales API",
      outputDataTypeName: "SalesMetrics",
      outputDataTypeId: "dt-new",
      lastRunStatus: null,
      lastRunAt: null,
      lastRunRowCount: null,
    });
    createPipelineStepMock.mockResolvedValueOnce({
      id: "step-1",
      kind: "aggregate",
      config: { groupBy: [], aggregations: [] },
    } as never);
    runPipelineMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [],
      stepRowCounts: {},
      sourceRowCount: 10,
    });

    const { onComplete } = renderStep();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create and bind" }));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({ dataTypeId: "dt-new", pipelineId: "p-1" }),
    );
    expect(expandPipelineShapeMock).toHaveBeenCalledWith("single-row", { mode: "aggregate" });
    expect(createPipelineMock).toHaveBeenCalledWith({
      name: "Sales ETL",
      sourceDataSourceId: "ds-1",
      outputDataTypeName: "SalesMetrics",
    });
    expect(createPipelineStepMock).toHaveBeenCalledWith("p-1", "aggregate", {
      groupBy: [],
      aggregations: [],
    });
    expect(runPipelineMock).toHaveBeenCalledWith("p-1");
  });

  it("a 422 from expand shows the message inline verbatim and creates nothing", async () => {
    expandPipelineShapeMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 422,
        data: { message: "single-row shape: missing required field 'mode'" },
      },
    });

    const { onComplete } = renderStep();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create and bind" }));

    await waitFor(() => {
      expect(
        screen.getByText("single-row shape: missing required field 'mode'"),
      ).toBeInTheDocument();
    });
    expect(createPipelineMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("a createPipeline failure shows an inline error and leaves dataTypeId unset (onComplete not called)", async () => {
    expandPipelineShapeMock.mockResolvedValueOnce(expansions);
    createPipelineMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { message: "outputDataTypeName is required" } },
    });

    const { onComplete } = renderStep();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create and bind" }));

    await waitFor(() => {
      expect(screen.getByText("outputDataTypeName is required")).toBeInTheDocument();
    });
    expect(createPipelineStepMock).not.toHaveBeenCalled();
    expect(runPipelineMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("a createPipelineStep failure shows an inline error and never calls run", async () => {
    expandPipelineShapeMock.mockResolvedValueOnce(expansions);
    createPipelineMock.mockResolvedValueOnce({
      id: "p-1",
      name: "Sales ETL",
      sourceDataSourceId: "ds-1",
      sourceDataSourceName: "Sales API",
      outputDataTypeName: "SalesMetrics",
      outputDataTypeId: "dt-new",
      lastRunStatus: null,
      lastRunAt: null,
      lastRunRowCount: null,
    });
    createPipelineStepMock.mockRejectedValueOnce(new Error("Failed to add step."));

    const { onComplete } = renderStep();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create and bind" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to add step.")).toBeInTheDocument();
    });
    expect(runPipelineMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("a run failure shows an inline error with Retry run, which re-calls only runPipeline", async () => {
    expandPipelineShapeMock.mockResolvedValueOnce(expansions);
    createPipelineMock.mockResolvedValueOnce({
      id: "p-1",
      name: "Sales ETL",
      sourceDataSourceId: "ds-1",
      sourceDataSourceName: "Sales API",
      outputDataTypeName: "SalesMetrics",
      outputDataTypeId: "dt-new",
      lastRunStatus: null,
      lastRunAt: null,
      lastRunRowCount: null,
    });
    createPipelineStepMock.mockResolvedValueOnce({
      id: "step-1",
      kind: "aggregate",
      config: { groupBy: [], aggregations: [] },
    } as never);
    runPipelineMock.mockRejectedValueOnce(new Error("Source unreachable."));

    const { onComplete } = renderStep();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create and bind" }));

    await waitFor(() => expect(screen.getByText("Source unreachable.")).toBeInTheDocument());
    expect(onComplete).not.toHaveBeenCalled();

    const retryButton = await screen.findByRole("button", { name: "Retry run" });

    runPipelineMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [],
      stepRowCounts: {},
      sourceRowCount: 10,
    });
    fireEvent.click(retryButton);

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({ dataTypeId: "dt-new", pipelineId: "p-1" }),
    );
    // Retry re-calls only run — the earlier stages are not redone.
    expect(expandPipelineShapeMock).toHaveBeenCalledTimes(1);
    expect(createPipelineMock).toHaveBeenCalledTimes(1);
    expect(createPipelineStepMock).toHaveBeenCalledTimes(1);
    expect(runPipelineMock).toHaveBeenCalledTimes(2);
  });
});

describe("ShapeInstantiateStep — form gating", () => {
  it("submit is disabled until pipeline name, source, output type name, and required params are filled", () => {
    renderStep();
    expect(screen.getByRole("button", { name: "Create and bind" })).toBeDisabled();

    fillRequiredFields();

    expect(screen.getByRole("button", { name: "Create and bind" })).toBeEnabled();
  });

  it("Back calls onBack", () => {
    const { onBack } = renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});
