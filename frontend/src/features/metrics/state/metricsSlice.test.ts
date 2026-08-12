// Per-thunk reducer + thunk sub-suites — matches `pipelinesSlice.test.ts`'s
// structure.

import {
  clearCurrentMetric,
  createMetric,
  deleteMetric,
  fetchMetricById,
  fetchMetrics,
  metricsReducer,
  setCreateMetricModalOpen,
  updateMetric,
} from "./metricsSlice";
import * as metricService from "../services/metricService";
import type { Metric } from "../types/metric";

jest.mock("../services/metricService", () => ({
  fetchMetrics: jest.fn(),
  fetchMetricById: jest.fn(),
  createMetric: jest.fn(),
  updateMetric: jest.fn(),
  deleteMetric: jest.fn(),
}));

const fetchMetricsMock = jest.mocked(metricService.fetchMetrics);
const fetchMetricByIdMock = jest.mocked(metricService.fetchMetricById);
const createMetricMock = jest.mocked(metricService.createMetric);
const updateMetricMock = jest.mocked(metricService.updateMetric);
const deleteMetricMock = jest.mocked(metricService.deleteMetric);

const testMetric: Metric = {
  id: "m-1",
  ownerId: "u-1",
  dataTypeId: "dt-1",
  name: "Total Revenue",
  description: null,
  measureField: "amount",
  aggregation: "sum",
  allowedDimensions: ["region"],
  format: { unit: "$", decimals: 2, prefix: null, suffix: null },
  deprecated: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("metricsSlice reducers", () => {
  it("sets loading status when fetchMetrics is pending", () => {
    const nextState = metricsReducer(undefined, fetchMetrics.pending("req-1"));
    expect(nextState.status).toBe("loading");
    expect(nextState.error).toBeNull();
  });

  it("populates items when fetchMetrics fulfills", () => {
    const nextState = metricsReducer(undefined, fetchMetrics.fulfilled([testMetric], "req-1"));
    expect(nextState.status).toBe("succeeded");
    expect(nextState.items).toHaveLength(1);
    expect(nextState.items[0].name).toBe("Total Revenue");
  });

  it("sets error status when fetchMetrics rejects", () => {
    const nextState = metricsReducer(
      undefined,
      fetchMetrics.rejected(null, "req-1", undefined, "Failed to load metrics."),
    );
    expect(nextState.status).toBe("failed");
    expect(nextState.error).toBe("Failed to load metrics.");
  });

  it("populates currentMetric when fetchMetricById fulfills", () => {
    const nextState = metricsReducer(
      undefined,
      fetchMetricById.fulfilled(testMetric, "req-1", "m-1"),
    );
    expect(nextState.currentMetric).toEqual(testMetric);
    expect(nextState.currentMetricStatus).toBe("succeeded");
  });

  it("clears currentMetric when fetchMetricById rejects", () => {
    const nextState = metricsReducer(
      undefined,
      fetchMetricById.rejected(null, "req-1", "m-1", "Failed to load metric."),
    );
    expect(nextState.currentMetric).toBeNull();
    expect(nextState.currentMetricStatus).toBe("failed");
    expect(nextState.currentMetricError).toBe("Failed to load metric.");
  });

  it("appends the new metric to items when createMetric fulfills", () => {
    const nextState = metricsReducer(
      undefined,
      createMetric.fulfilled(testMetric, "req-1", {
        dataTypeId: "dt-1",
        name: "Total Revenue",
        measureField: "amount",
        aggregation: "sum",
        allowedDimensions: [],
      }),
    );
    expect(nextState.items).toEqual([testMetric]);
    expect(nextState.createStatus).toBe("succeeded");
  });

  it("sets createError when createMetric rejects", () => {
    const nextState = metricsReducer(
      undefined,
      createMetric.rejected(
        null,
        "req-1",
        {
          dataTypeId: "dt-1",
          name: "",
          measureField: "amount",
          aggregation: "sum",
          allowedDimensions: [],
        },
        "Metric name is required.",
      ),
    );
    expect(nextState.createStatus).toBe("failed");
    expect(nextState.createError).toBe("Metric name is required.");
  });

  it("replaces the matching item and sets currentMetric when updateMetric fulfills", () => {
    const preloaded = metricsReducer(undefined, fetchMetrics.fulfilled([testMetric], "req-0"));
    const updated: Metric = { ...testMetric, name: "Renamed Revenue" };
    const nextState = metricsReducer(
      preloaded,
      updateMetric.fulfilled(updated, "req-1", { id: "m-1", request: { name: "Renamed Revenue" } }),
    );
    expect(nextState.items[0].name).toBe("Renamed Revenue");
    expect(nextState.currentMetric?.name).toBe("Renamed Revenue");
    expect(nextState.updateStatus).toBe("succeeded");
  });

  it("sets updateError when updateMetric rejects", () => {
    const nextState = metricsReducer(
      undefined,
      updateMetric.rejected(null, "req-1", { id: "m-1", request: {} }, "Failed to update metric."),
    );
    expect(nextState.updateStatus).toBe("failed");
    expect(nextState.updateError).toBe("Failed to update metric.");
  });

  it("removes the deleted metric from items when deleteMetric fulfills", () => {
    const preloaded = metricsReducer(undefined, fetchMetrics.fulfilled([testMetric], "req-0"));
    const nextState = metricsReducer(preloaded, deleteMetric.fulfilled("m-1", "req-1", "m-1"));
    expect(nextState.items).toEqual([]);
    expect(nextState.deleteStatus).toBe("succeeded");
  });

  it("sets deleteError when deleteMetric rejects", () => {
    const nextState = metricsReducer(
      undefined,
      deleteMetric.rejected(null, "req-1", "m-1", "Failed to delete metric."),
    );
    expect(nextState.deleteStatus).toBe("failed");
    expect(nextState.deleteError).toBe("Failed to delete metric.");
  });

  it("setCreateMetricModalOpen toggles createModalOpen", () => {
    const nextState = metricsReducer(undefined, setCreateMetricModalOpen(true));
    expect(nextState.createModalOpen).toBe(true);
  });

  it("clearCurrentMetric resets the single-metric detail slice", () => {
    const preloaded = metricsReducer(
      undefined,
      fetchMetricById.fulfilled(testMetric, "req-1", "m-1"),
    );
    const nextState = metricsReducer(preloaded, clearCurrentMetric());
    expect(nextState.currentMetric).toBeNull();
    expect(nextState.currentMetricStatus).toBe("idle");
  });
});

describe("fetchMetrics thunk", () => {
  it("dispatches fulfilled with the metric list on success", async () => {
    fetchMetricsMock.mockResolvedValueOnce([testMetric]);

    const dispatch = jest.fn();
    const thunk = fetchMetrics();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "metrics/fetchMetrics/fulfilled",
    );
    expect(fulfilledCall?.[0].payload).toEqual([testMetric]);
  });

  it("dispatches rejected on service error", async () => {
    fetchMetricsMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const thunk = fetchMetrics();
    await thunk(dispatch, jest.fn(), undefined);

    const calls = dispatch.mock.calls as Array<[{ type: string }]>;
    expect(calls.some(([action]) => action.type === "metrics/fetchMetrics/rejected")).toBe(true);
  });
});

describe("createMetric thunk", () => {
  it("calls metricService.createMetric with the request payload", async () => {
    createMetricMock.mockResolvedValueOnce(testMetric);

    const dispatch = jest.fn();
    const request = {
      dataTypeId: "dt-1",
      name: "Total Revenue",
      measureField: "amount",
      aggregation: "sum",
      allowedDimensions: ["region"],
    };
    const thunk = createMetric(request);
    await thunk(dispatch, jest.fn(), undefined);

    expect(createMetricMock).toHaveBeenCalledWith(request);
  });
});

describe("updateMetric thunk", () => {
  it("calls metricService.updateMetric with id + only-changed-fields request", async () => {
    updateMetricMock.mockResolvedValueOnce({ ...testMetric, deprecated: true });

    const dispatch = jest.fn();
    const thunk = updateMetric({ id: "m-1", request: { deprecated: true } });
    await thunk(dispatch, jest.fn(), undefined);

    expect(updateMetricMock).toHaveBeenCalledWith("m-1", { deprecated: true });
  });
});

describe("deleteMetric thunk", () => {
  it("calls metricService.deleteMetric and resolves with the deleted id", async () => {
    deleteMetricMock.mockResolvedValueOnce(undefined);

    const dispatch = jest.fn();
    const thunk = deleteMetric("m-1");
    await thunk(dispatch, jest.fn(), undefined);

    expect(deleteMetricMock).toHaveBeenCalledWith("m-1");
    const calls = dispatch.mock.calls as Array<[{ type: string; payload?: unknown }]>;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "metrics/deleteMetric/fulfilled",
    );
    expect(fulfilledCall?.[0].payload).toBe("m-1");
  });
});

describe("fetchMetricById thunk", () => {
  it("calls metricService.fetchMetricById with the given id", async () => {
    fetchMetricByIdMock.mockResolvedValueOnce(testMetric);

    const dispatch = jest.fn();
    const thunk = fetchMetricById("m-1");
    await thunk(dispatch, jest.fn(), undefined);

    expect(fetchMetricByIdMock).toHaveBeenCalledWith("m-1");
  });
});
