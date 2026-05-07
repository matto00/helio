import { createPipeline, fetchPipelines, pipelinesReducer } from "./pipelinesSlice";
import * as pipelineService from "../../services/pipelineService";

jest.mock("../../services/pipelineService", () => ({
  getPipelines: jest.fn(),
  createPipeline: jest.fn(),
}));

const getPipelinesMock = jest.mocked(pipelineService.getPipelines);
const createPipelineMock = jest.mocked(pipelineService.createPipeline);

const testPipeline = {
  id: "p-1",
  name: "Sales Pipeline",
  sourceDataSourceName: "Sales API",
  outputDataTypeName: "SalesMetrics",
  lastRunStatus: "succeeded" as const,
  lastRunAt: "2026-05-01T10:00:00Z",
};

const newPipeline = {
  id: "p-new",
  name: "New Pipeline",
  sourceDataSourceName: "CSV Source",
  outputDataTypeName: "RawData",
  lastRunStatus: null as null,
  lastRunAt: null,
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
