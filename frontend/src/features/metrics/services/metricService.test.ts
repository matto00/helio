// One test per exported function, axios mocked — matches
// `pipelineService.test.ts`'s structure. Also covers the `description`
// absent-vs-null normalization gotcha (`dataTypeService.test.ts` precedent).

import { httpClient } from "../../../services/httpClient";
import {
  createMetric,
  deleteMetric,
  fetchMetricById,
  fetchMetrics,
  fetchMetricUsage,
  updateMetric,
} from "./metricService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

const wireMetricMissingDescription = {
  id: "m-1",
  ownerId: "u-1",
  dataTypeId: "dt-1",
  name: "Total Revenue",
  measureField: "amount",
  aggregation: "sum",
  allowedDimensions: ["region"],
  format: { unit: "$", decimals: 2, prefix: null, suffix: null },
  deprecated: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const wireMetricWithDescription = {
  ...wireMetricMissingDescription,
  description: "Sum of all sales.",
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("metricService", () => {
  it("fetchMetrics GETs /api/metrics and unwraps the paginated items", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: { items: [wireMetricWithDescription], total: 1, offset: 0, limit: 20 },
    });

    const result = await fetchMetrics();

    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/metrics");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Total Revenue");
  });

  it("fetchMetrics normalizes an absent description to null", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: { items: [wireMetricMissingDescription], total: 1, offset: 0, limit: 20 },
    });

    const result = await fetchMetrics();

    expect(result[0].description).toBeNull();
    expect("description" in wireMetricMissingDescription).toBe(false);
  });

  it("fetchMetricById GETs /api/metrics/:id and normalizes the response", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: wireMetricMissingDescription });

    const result = await fetchMetricById("m-1");

    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/metrics/m-1");
    expect(result.description).toBeNull();
  });

  it("fetchMetricById preserves a present description", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: wireMetricWithDescription });

    const result = await fetchMetricById("m-1");

    expect(result.description).toBe("Sum of all sales.");
  });

  it("createMetric POSTs the request body and returns the normalized metric", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({ data: wireMetricWithDescription });

    const request = {
      dataTypeId: "dt-1",
      name: "Total Revenue",
      measureField: "amount",
      aggregation: "sum",
      allowedDimensions: ["region"],
    };
    const result = await createMetric(request);

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/metrics", request);
    expect(result.id).toBe("m-1");
  });

  it("updateMetric PATCHes /api/metrics/:id with only the given request fields", async () => {
    mockedHttpClient.patch.mockResolvedValueOnce({ data: wireMetricWithDescription });

    const result = await updateMetric("m-1", { name: "Renamed" });

    expect(mockedHttpClient.patch).toHaveBeenCalledWith("/api/metrics/m-1", { name: "Renamed" });
    expect(result.name).toBe("Total Revenue");
  });

  it("deleteMetric DELETEs /api/metrics/:id", async () => {
    mockedHttpClient.delete.mockResolvedValueOnce({ data: undefined });

    await deleteMetric("m-1");

    expect(mockedHttpClient.delete).toHaveBeenCalledWith("/api/metrics/m-1");
  });

  it("fetchMetricUsage GETs /api/metrics/:id/usage and returns the usage summary", async () => {
    const usage = {
      metricId: "m-1",
      count: 2,
      panels: [
        { panelId: "p-1", panelTitle: "Panel 1", dashboardId: "d-1", dashboardName: "Dash 1" },
        { panelId: "p-2", panelTitle: "Panel 2", dashboardId: "d-2", dashboardName: "Dash 2" },
      ],
    };
    mockedHttpClient.get.mockResolvedValueOnce({ data: usage });

    const result = await fetchMetricUsage("m-1");

    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/metrics/m-1/usage");
    expect(result).toEqual(usage);
  });
});
