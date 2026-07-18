import {
  analyzePipeline,
  createPipeline,
  fetchPipelineById,
  fetchPipelines,
  fetchPipelineRunHistory,
  fetchPipelineSteps,
  pipelinesReducer,
  selectPipelineNameByOutputTypeId,
  submitPipelineRun,
  updatePipeline,
} from "./pipelinesSlice";
import * as pipelineService from "../services/pipelineService";
import type { PipelineAnalyzeResponse, PipelineStep, PipelineSummary } from "../types/pipelineStep";
import type { RootState } from "../../../store/store";

jest.mock("../services/pipelineService", () => ({
  getPipelines: jest.fn(),
  createPipeline: jest.fn(),
  runPipeline: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  updatePipeline: jest.fn(),
  analyzePipeline: jest.fn(),
}));

const getPipelinesMock = jest.mocked(pipelineService.getPipelines);
const createPipelineMock = jest.mocked(pipelineService.createPipeline);
const runPipelineMock = jest.mocked(pipelineService.runPipeline);
const fetchRunHistoryMock = jest.mocked(pipelineService.fetchRunHistory);
const getPipelineByIdMock = jest.mocked(pipelineService.getPipelineById);
const getPipelineStepsMock = jest.mocked(pipelineService.getPipelineSteps);
const updatePipelineMock = jest.mocked(pipelineService.updatePipeline);
const analyzePipelineMock = jest.mocked(pipelineService.analyzePipeline);

const testPipeline = {
  id: "p-1",
  name: "Sales Pipeline",
  sourceDataSourceId: "ds-sales",
  sourceDataSourceName: "Sales API",
  outputDataTypeName: "SalesMetrics",
  outputDataTypeId: "dt-sales",
  lastRunStatus: "succeeded" as const,
  lastRunAt: "2026-05-01T10:00:00Z",
  lastRunRowCount: null as null,
};

const newPipeline = {
  id: "p-new",
  name: "New Pipeline",
  sourceDataSourceId: "ds-csv",
  sourceDataSourceName: "CSV Source",
  outputDataTypeName: "RawData",
  outputDataTypeId: "dt-raw",
  lastRunStatus: null as null,
  lastRunAt: null,
  lastRunRowCount: null as null,
};

describe("pipelinesSlice", () => {
  it("sets loading status when fetchPipelines is pending", () => {
    const nextState = pipelinesReducer(undefined, fetchPipelines.pending("req-1"));
    expect(nextState.status).toBe("loading");
    expect(nextState.error).toBeNull();
  });

  it("populates items when fetchPipelines fulfills", () => {
    const nextState = pipelinesReducer(
      undefined,
      fetchPipelines.fulfilled([testPipeline], "req-1"),
    );
    expect(nextState.status).toBe("succeeded");
    expect(nextState.items).toHaveLength(1);
    expect(nextState.items[0].name).toBe("Sales Pipeline");
    expect(nextState.error).toBeNull();
  });

  it("sets error status when fetchPipelines rejects", () => {
    const nextState = pipelinesReducer(
      undefined,
      fetchPipelines.rejected(null, "req-1", undefined, "Failed to load pipelines."),
    );
    expect(nextState.status).toBe("failed");
    expect(nextState.error).toBe("Failed to load pipelines.");
  });

  it("clears previous error on pending", () => {
    const stateWithError = {
      items: [],
      status: "failed" as const,
      error: "Previous error",
      createStatus: "idle" as const,
      createError: null,
      runId: null,
      runStatus: null,
      runError: null,
      runIsDry: null,
      runHistory: {},
      currentPipeline: null,
      currentPipelineStatus: "idle" as const,
      currentPipelineError: null,
      steps: {},
      stepsStatus: {},
      stepsError: {},
      updateStatus: "idle" as const,
      updateError: null,
      runResult: null,
      runStepRowCounts: {},
      runSourceRowCount: null,
      analyzeResult: {},
      analyzeStatus: {},
      analyzeError: {},
      createModalOpen: false,
    };
    const nextState = pipelinesReducer(stateWithError, fetchPipelines.pending("req-2"));
    expect(nextState.error).toBeNull();
    expect(nextState.status).toBe("loading");
  });

  it("sets createStatus to loading when createPipeline is pending", () => {
    const nextState = pipelinesReducer(
      undefined,
      createPipeline.pending("req-1", {
        name: "x",
        sourceDataSourceId: "s",
        outputDataTypeName: "o",
      }),
    );
    expect(nextState.createStatus).toBe("loading");
    expect(nextState.createError).toBeNull();
  });

  it("sets createStatus to succeeded when createPipeline fulfills", () => {
    const nextState = pipelinesReducer(
      undefined,
      createPipeline.fulfilled(newPipeline, "req-1", {
        name: "x",
        sourceDataSourceId: "s",
        outputDataTypeName: "o",
      }),
    );
    expect(nextState.createStatus).toBe("succeeded");
    expect(nextState.createError).toBeNull();
  });

  it("sets createError when createPipeline rejects", () => {
    const nextState = pipelinesReducer(
      undefined,
      createPipeline.rejected(
        null,
        "req-1",
        { name: "x", sourceDataSourceId: "s", outputDataTypeName: "o" },
        "Failed to create pipeline.",
      ),
    );
    expect(nextState.createStatus).toBe("failed");
    expect(nextState.createError).toBe("Failed to create pipeline.");
  });
});

describe("fetchPipelines thunk", () => {
  beforeEach(() => {
    getPipelinesMock.mockReset();
  });

  it("dispatches fulfilled with pipeline list on success", async () => {
    getPipelinesMock.mockResolvedValueOnce([testPipeline]);

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = fetchPipelines();

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "pipelines/fetchPipelines/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual([testPipeline]);
  });

  it("dispatches rejected on service error", async () => {
    getPipelinesMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = fetchPipelines();

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    const rejectedCall = calls.find(
      ([action]) => action.type === "pipelines/fetchPipelines/rejected",
    );
    expect(rejectedCall).toBeDefined();
  });
});

describe("submitPipelineRun reducer", () => {
  it("sets runStatus to queued when submitPipelineRun is pending", () => {
    const nextState = pipelinesReducer(
      undefined,
      submitPipelineRun.pending("req-1", { pipelineId: "p-1" }),
    );
    expect(nextState.runStatus).toBe("queued");
    expect(nextState.runId).toBeNull();
    expect(nextState.runError).toBeNull();
  });

  it("sets runResult and runStatus when submitPipelineRun fulfills", () => {
    const rows = [{ col_a: 1, col_b: "x" }];
    const nextState = pipelinesReducer(
      undefined,
      submitPipelineRun.fulfilled(
        { rowCount: 1, rows, stepRowCounts: {}, sourceRowCount: 0 },
        "req-1",
        { pipelineId: "p-1" },
      ),
    );
    expect(nextState.runId).toBeNull();
    expect(nextState.runStatus).toBe("succeeded");
    expect(nextState.runResult).toEqual(rows);
  });

  it("clears runId and sets runError when submitPipelineRun rejects", () => {
    const nextState = pipelinesReducer(
      undefined,
      submitPipelineRun.rejected(
        null,
        "req-1",
        { pipelineId: "p-1" },
        "Failed to start pipeline run.",
      ),
    );
    expect(nextState.runId).toBeNull();
    expect(nextState.runStatus).toBeNull();
    expect(nextState.runError).toBe("Failed to start pipeline run.");
  });
});

describe("submitPipelineRun thunk", () => {
  beforeEach(() => {
    runPipelineMock.mockReset();
  });

  it("dispatches fulfilled with rows on success", async () => {
    const rows = [{ col_a: 1, col_b: "x" }];
    runPipelineMock.mockResolvedValueOnce({
      rowCount: 1,
      rows,
      stepRowCounts: {},
      sourceRowCount: 0,
    });

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = submitPipelineRun({ pipelineId: "p-1" });

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "pipelines/submitPipelineRun/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual({
      rowCount: 1,
      rows,
      stepRowCounts: {},
      sourceRowCount: 0,
    });
    expect(runPipelineMock).toHaveBeenCalledWith("p-1", undefined);
  });

  it("dispatches rejected on service error", async () => {
    runPipelineMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = submitPipelineRun({ pipelineId: "p-1" });

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    const rejectedCall = calls.find(
      ([action]) => action.type === "pipelines/submitPipelineRun/rejected",
    );
    expect(rejectedCall).toBeDefined();
  });

  it("dispatches POST with ?dry=true when dryRun: true is passed", async () => {
    const rows = [{ col_a: 1 }];
    runPipelineMock.mockResolvedValueOnce({
      rowCount: 1,
      rows,
      stepRowCounts: {},
      sourceRowCount: 0,
    });

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = submitPipelineRun({ pipelineId: "p-1", dryRun: true });

    await thunk(dispatch, getState, undefined);

    expect(runPipelineMock).toHaveBeenCalledWith("p-1", true);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "pipelines/submitPipelineRun/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual({
      rowCount: 1,
      rows,
      stepRowCounts: {},
      sourceRowCount: 0,
    });
  });
});

describe("fetchPipelineRunHistory", () => {
  const sampleRun = {
    id: "run-1",
    pipelineId: "p-1",
    status: "succeeded" as const,
    startedAt: "2026-05-01T10:00:00Z",
    completedAt: "2026-05-01T10:01:00Z",
    rowCount: 42,
    errorLog: null,
  };

  beforeEach(() => {
    fetchRunHistoryMock.mockReset();
  });

  it("stores run history keyed by pipelineId on fulfilled", () => {
    const nextState = pipelinesReducer(
      undefined,
      fetchPipelineRunHistory.fulfilled(
        { pipelineId: "p-1", records: [sampleRun] },
        "req-1",
        "p-1",
      ),
    );
    expect(nextState.runHistory["p-1"]).toHaveLength(1);
    expect(nextState.runHistory["p-1"][0].id).toBe("run-1");
    expect(nextState.runHistory["p-1"][0].rowCount).toBe(42);
  });

  it("replaces existing history for the same pipeline on re-fetch", () => {
    const initialState = pipelinesReducer(
      undefined,
      fetchPipelineRunHistory.fulfilled(
        { pipelineId: "p-1", records: [sampleRun] },
        "req-1",
        "p-1",
      ),
    );
    const updatedRun = { ...sampleRun, id: "run-2", rowCount: 99 };
    const nextState = pipelinesReducer(
      initialState,
      fetchPipelineRunHistory.fulfilled(
        { pipelineId: "p-1", records: [updatedRun] },
        "req-2",
        "p-1",
      ),
    );
    expect(nextState.runHistory["p-1"]).toHaveLength(1);
    expect(nextState.runHistory["p-1"][0].id).toBe("run-2");
  });

  it("does not affect runHistory on rejected", () => {
    const nextState = pipelinesReducer(
      undefined,
      fetchPipelineRunHistory.rejected(null, "req-1", "p-1", "Failed to load run history."),
    );
    expect(nextState.runHistory).toEqual({});
  });

  it("dispatches fulfilled with records on success", async () => {
    fetchRunHistoryMock.mockResolvedValueOnce([sampleRun]);

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = fetchPipelineRunHistory("p-1");

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "pipelines/fetchPipelineRunHistory/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual({ pipelineId: "p-1", records: [sampleRun] });
  });

  it("dispatches rejected on service error", async () => {
    fetchRunHistoryMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = fetchPipelineRunHistory("p-1");

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    const rejectedCall = calls.find(
      ([action]) => action.type === "pipelines/fetchPipelineRunHistory/rejected",
    );
    expect(rejectedCall).toBeDefined();
  });
});

describe("createPipeline thunk", () => {
  beforeEach(() => {
    createPipelineMock.mockReset();
  });

  it("dispatches fulfilled with the new pipeline summary on success", async () => {
    createPipelineMock.mockResolvedValueOnce(newPipeline);

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = createPipeline({
      name: "New Pipeline",
      sourceDataSourceId: "src-1",
      outputDataTypeName: "RawData",
    });

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "pipelines/createPipeline/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual(newPipeline);
  });

  it("dispatches rejected on service error", async () => {
    createPipelineMock.mockRejectedValueOnce(new Error("server error"));

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = createPipeline({
      name: "New Pipeline",
      sourceDataSourceId: "src-1",
      outputDataTypeName: "RawData",
    });

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    const rejectedCall = calls.find(
      ([action]) => action.type === "pipelines/createPipeline/rejected",
    );
    expect(rejectedCall).toBeDefined();
  });
});

// ── Task 4.1 — fetchPipelineById thunk ───────────────────────────────────────

const samplePipelineSummary: PipelineSummary = {
  id: "p-1",
  name: "Sales Pipeline",
  sourceDataSourceId: "ds-sales",
  sourceDataSourceName: "Sales API",
  outputDataTypeName: "SalesMetrics",
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

describe("fetchPipelineById reducer", () => {
  it("sets currentPipelineStatus to loading on pending", () => {
    const nextState = pipelinesReducer(undefined, fetchPipelineById.pending("req-1", "p-1"));
    expect(nextState.currentPipelineStatus).toBe("loading");
    expect(nextState.currentPipelineError).toBeNull();
  });

  it("sets currentPipeline on fulfilled", () => {
    const nextState = pipelinesReducer(
      undefined,
      fetchPipelineById.fulfilled(samplePipelineSummary, "req-1", "p-1"),
    );
    expect(nextState.currentPipelineStatus).toBe("succeeded");
    expect(nextState.currentPipeline).toEqual(samplePipelineSummary);
    expect(nextState.currentPipelineError).toBeNull();
  });

  it("sets currentPipelineStatus to failed on rejected", () => {
    const nextState = pipelinesReducer(
      undefined,
      fetchPipelineById.rejected(null, "req-1", "p-1", "Failed to load pipeline."),
    );
    expect(nextState.currentPipelineStatus).toBe("failed");
    expect(nextState.currentPipelineError).toBe("Failed to load pipeline.");
  });
});

describe("fetchPipelineById thunk", () => {
  beforeEach(() => {
    getPipelineByIdMock.mockReset();
  });

  it("dispatches fulfilled with pipeline summary on success", async () => {
    getPipelineByIdMock.mockResolvedValueOnce(samplePipelineSummary);

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = fetchPipelineById("p-1");

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "pipelines/fetchPipelineById/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual(samplePipelineSummary);
  });

  it("dispatches rejected on service error", async () => {
    getPipelineByIdMock.mockRejectedValueOnce(new Error("not found"));

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = fetchPipelineById("p-1");

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    const rejectedCall = calls.find(
      ([action]) => action.type === "pipelines/fetchPipelineById/rejected",
    );
    expect(rejectedCall).toBeDefined();
  });
});

// ── Task 4.2 — fetchPipelineSteps thunk ─────────────────────────────────────

const sampleStep: PipelineStep = {
  id: "step-1",
  pipelineId: "p-1",
  position: 0,
  type: "filter",
  config: { combinator: "AND", conditions: [] },
  createdAt: "2026-05-01T10:00:00Z",
  updatedAt: "2026-05-01T10:00:00Z",
};

describe("fetchPipelineSteps reducer", () => {
  it("sets stepsStatus to loading on pending", () => {
    const nextState = pipelinesReducer(undefined, fetchPipelineSteps.pending("req-1", "p-1"));
    expect(nextState.stepsStatus["p-1"]).toBe("loading");
    expect(nextState.stepsError["p-1"]).toBeNull();
  });

  it("stores steps keyed by pipelineId on fulfilled", () => {
    const nextState = pipelinesReducer(
      undefined,
      fetchPipelineSteps.fulfilled({ pipelineId: "p-1", steps: [sampleStep] }, "req-1", "p-1"),
    );
    expect(nextState.stepsStatus["p-1"]).toBe("succeeded");
    expect(nextState.steps["p-1"]).toHaveLength(1);
    expect(nextState.steps["p-1"][0].id).toBe("step-1");
  });

  it("stores empty steps array on fulfilled with empty response", () => {
    const nextState = pipelinesReducer(
      undefined,
      fetchPipelineSteps.fulfilled({ pipelineId: "p-1", steps: [] }, "req-1", "p-1"),
    );
    expect(nextState.steps["p-1"]).toEqual([]);
    expect(nextState.stepsError["p-1"]).toBeNull();
  });

  it("sets stepsStatus to failed on rejected", () => {
    const nextState = pipelinesReducer(
      undefined,
      fetchPipelineSteps.rejected(null, "req-1", "p-1", "Failed to load pipeline steps."),
    );
    expect(nextState.stepsStatus["p-1"]).toBe("failed");
    expect(nextState.stepsError["p-1"]).toBe("Failed to load pipeline steps.");
  });
});

describe("fetchPipelineSteps thunk", () => {
  beforeEach(() => {
    getPipelineStepsMock.mockReset();
  });

  it("dispatches fulfilled with steps on success", async () => {
    getPipelineStepsMock.mockResolvedValueOnce([sampleStep]);

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = fetchPipelineSteps("p-1");

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "pipelines/fetchPipelineSteps/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual({ pipelineId: "p-1", steps: [sampleStep] });
  });

  it("dispatches fulfilled with empty array when no steps", async () => {
    getPipelineStepsMock.mockResolvedValueOnce([]);

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = fetchPipelineSteps("p-1");

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "pipelines/fetchPipelineSteps/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual({ pipelineId: "p-1", steps: [] });
  });
});

// ── Task 4.3 — updatePipeline thunk ─────────────────────────────────────────

const updatedPipeline: PipelineSummary = { ...samplePipelineSummary, name: "Renamed Pipeline" };

describe("updatePipeline reducer", () => {
  it("sets updateStatus to loading on pending", () => {
    const nextState = pipelinesReducer(
      undefined,
      updatePipeline.pending("req-1", { id: "p-1", name: "Renamed Pipeline" }),
    );
    expect(nextState.updateStatus).toBe("loading");
    expect(nextState.updateError).toBeNull();
  });

  it("updates currentPipeline and sets updateStatus to succeeded on fulfilled", () => {
    const nextState = pipelinesReducer(
      undefined,
      updatePipeline.fulfilled(updatedPipeline, "req-1", { id: "p-1", name: "Renamed Pipeline" }),
    );
    expect(nextState.updateStatus).toBe("succeeded");
    expect(nextState.currentPipeline).toEqual(updatedPipeline);
    expect(nextState.updateError).toBeNull();
  });

  it("sets updateStatus to failed and updateError on rejected", () => {
    const nextState = pipelinesReducer(
      undefined,
      updatePipeline.rejected(
        null,
        "req-1",
        { id: "p-1", name: "Renamed Pipeline" },
        "Failed to update pipeline.",
      ),
    );
    expect(nextState.updateStatus).toBe("failed");
    expect(nextState.updateError).toBe("Failed to update pipeline.");
  });
});

describe("updatePipeline thunk", () => {
  beforeEach(() => {
    updatePipelineMock.mockReset();
  });

  it("dispatches fulfilled with updated pipeline on success", async () => {
    updatePipelineMock.mockResolvedValueOnce(updatedPipeline);

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = updatePipeline({ id: "p-1", name: "Renamed Pipeline" });

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "pipelines/updatePipeline/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual(updatedPipeline);
  });

  it("dispatches rejected on service error", async () => {
    updatePipelineMock.mockRejectedValueOnce(new Error("server error"));

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = updatePipeline({ id: "p-1", name: "Renamed Pipeline" });

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    const rejectedCall = calls.find(
      ([action]) => action.type === "pipelines/updatePipeline/rejected",
    );
    expect(rejectedCall).toBeDefined();
  });
});

// ── Task 4.1 — analyzePipeline thunk ─────────────────────────────────────────

const sampleAnalyzeResponse: PipelineAnalyzeResponse = {
  id: "p-1",
  name: "Sales Pipeline",
  sourceDataSourceName: "Sales API",
  outputDataTypeName: "SalesMetrics",
  outputDataTypeId: "dt-sales",
  sourceSchema: [
    { name: "order_id", type: "string" },
    { name: "amount", type: "number" },
  ],
  steps: [
    {
      id: "step-1",
      position: 0,
      type: "select",
      config: { fields: ["order_id"] },
      inputSchema: [
        { name: "order_id", type: "string" },
        { name: "amount", type: "number" },
      ],
      outputSchema: [{ name: "order_id", type: "string" }],
    },
  ],
};

describe("analyzePipeline reducer", () => {
  it("sets analyzeStatus to loading on pending", () => {
    const nextState = pipelinesReducer(undefined, analyzePipeline.pending("req-1", "p-1"));
    expect(nextState.analyzeStatus["p-1"]).toBe("loading");
    expect(nextState.analyzeError["p-1"]).toBeNull();
  });

  it("stores analyzeResult keyed by pipelineId on fulfilled", () => {
    const nextState = pipelinesReducer(
      undefined,
      analyzePipeline.fulfilled(
        { pipelineId: "p-1", result: sampleAnalyzeResponse },
        "req-1",
        "p-1",
      ),
    );
    expect(nextState.analyzeStatus["p-1"]).toBe("succeeded");
    expect(nextState.analyzeResult["p-1"]).toEqual(sampleAnalyzeResponse);
    expect(nextState.analyzeError["p-1"]).toBeNull();
  });

  it("sets analyzeStatus to failed on rejected", () => {
    const nextState = pipelinesReducer(
      undefined,
      analyzePipeline.rejected(null, "req-1", "p-1", "Failed to analyze pipeline."),
    );
    expect(nextState.analyzeStatus["p-1"]).toBe("failed");
    expect(nextState.analyzeError["p-1"]).toBe("Failed to analyze pipeline.");
  });
});

describe("analyzePipeline thunk", () => {
  beforeEach(() => {
    analyzePipelineMock.mockReset();
  });

  it("dispatches fulfilled with result on success", async () => {
    analyzePipelineMock.mockResolvedValueOnce(sampleAnalyzeResponse);

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = analyzePipeline("p-1");

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "pipelines/analyzePipeline/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual({
      pipelineId: "p-1",
      result: sampleAnalyzeResponse,
    });
  });

  it("dispatches rejected on service error", async () => {
    analyzePipelineMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = analyzePipeline("p-1");

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    const rejectedCall = calls.find(
      ([action]) => action.type === "pipelines/analyzePipeline/rejected",
    );
    expect(rejectedCall).toBeDefined();
  });
});

describe("selectPipelineNameByOutputTypeId", () => {
  function stateWith(items: PipelineSummary[]): RootState {
    return { pipelines: { items } } as unknown as RootState;
  }

  it("maps outputDataTypeId → pipeline name for pipelines that carry one", () => {
    const map = selectPipelineNameByOutputTypeId(
      stateWith([
        { ...testPipeline, outputDataTypeId: "dt-sales", name: "Sales Pipeline" },
        { ...newPipeline, outputDataTypeId: "dt-raw", name: "Raw Ingest" },
      ]),
    );

    expect(map.get("dt-sales")).toBe("Sales Pipeline");
    expect(map.get("dt-raw")).toBe("Raw Ingest");
    expect(map.size).toBe(2);
  });

  it("skips pipelines with an absent outputDataTypeId", () => {
    const withoutOutput: PipelineSummary = { ...testPipeline };
    delete withoutOutput.outputDataTypeId;

    const map = selectPipelineNameByOutputTypeId(
      stateWith([withoutOutput, { ...newPipeline, outputDataTypeId: "dt-raw" }]),
    );

    expect(map.has("dt-sales")).toBe(false);
    expect(map.get("dt-raw")).toBe(newPipeline.name);
    expect(map.size).toBe(1);
  });

  it("returns an empty map when there are no pipelines", () => {
    expect(selectPipelineNameByOutputTypeId(stateWith([])).size).toBe(0);
  });
});
