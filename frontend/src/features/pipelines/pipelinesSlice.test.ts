import { fetchPipelines, pipelinesReducer } from "./pipelinesSlice";
import * as pipelineService from "../../services/pipelineService";

jest.mock("../../services/pipelineService", () => ({
  getPipelines: jest.fn(),
}));

const getPipelinesMock = jest.mocked(pipelineService.getPipelines);

const testPipeline = {
  id: "p-1",
  name: "Sales Pipeline",
  sourceDataSourceName: "Sales API",
  outputDataTypeName: "SalesMetrics",
  lastRunStatus: "succeeded" as const,
  lastRunAt: "2026-05-01T10:00:00Z",
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
    };
    const nextState = pipelinesReducer(stateWithError, fetchPipelines.pending("req-2"));
    expect(nextState.error).toBeNull();
    expect(nextState.status).toBe("loading");
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
