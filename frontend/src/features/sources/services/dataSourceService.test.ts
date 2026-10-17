// Regression coverage for the wire-shape gap behind evaluation-1's
// HEL-613/HEL-416 "Invalid Date" bug class: spray-json's default `Option`
// formatter omits `None` fields entirely from the wire (does not serialize
// `null`) — `TestConnectionResponse.error` is `Option[String]` on the
// backend, so a successful test arrives with the `error` key **absent**, not
// `null`. `testConnection` must normalize the absent key to `null` before
// the value reaches `TestConnectionAffordance`, matching the established
// pattern in `pipelineService.test.ts` for the same class of bug. This test
// mocks `httpClient` directly (not `dataSourceService` itself) so it
// exercises the real `response.data.error ?? null` line — a component-level
// test that mocks the service module would not catch a regression here.

import { httpClient } from "../../../services/httpClient";
import { fetchFieldAggregate, testConnection } from "./dataSourceService";
import type { SqlSourceConfig } from "./dataSourceService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { post: jest.fn(), get: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

const sqlConfig: SqlSourceConfig = {
  dialect: "postgresql",
  host: "localhost",
  port: 5432,
  database: "db",
  user: "user",
  password: "pw",
  query: "SELECT 1",
};

describe("dataSourceService.testConnection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("normalizes an absent `error` key on a successful response to null", async () => {
    // No `error` key at all — exactly how a `TestConnectionResponse(ok = true,
    // error = None)` arrives on the wire (spray-json omits `None`, never `null`).
    const wireResponseMissingError = { ok: true };
    mockedHttpClient.post.mockResolvedValueOnce({ data: wireResponseMissingError });

    const result = await testConnection("sql", sqlConfig);

    expect(result).toEqual({ ok: true, error: null });
    expect("error" in wireResponseMissingError).toBe(false);
  });

  it("passes a present `error` string through unchanged on a failed response", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({
      data: { ok: false, error: "SQL connection failed" },
    });

    const result = await testConnection("sql", { ...sqlConfig, port: 1 });

    expect(result).toEqual({ ok: false, error: "SQL connection failed" });
  });

  it("builds the SQL request body nested and posts to /api/sources/test", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({ data: { ok: true } });

    await testConnection("sql", sqlConfig);

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/sources/test", {
      type: "sql",
      config: sqlConfig,
    });
  });

  it("builds the REST request body flat (no wrapper, no type field) and posts to /api/sources/test", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({ data: { ok: true } });
    const config = { url: "https://api.example.com/data", method: "GET" };

    await testConnection("rest_api", config);

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/sources/test", config);
  });
});

// HEL-1095 tasks.md 2.1: mirrors `fetchDatasetSchema`'s own thin-wrapper shape -- the only
// behavior worth a unit test here is the request URL/params and the response passthrough.
describe("dataSourceService.fetchFieldAggregate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("requests the field's sum aggregate and returns the response body verbatim", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: { field: "delta", op: "sum", value: 12 } });

    const result = await fetchFieldAggregate("source-1", "delta");

    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/data-sources/source-1/rows/aggregate", {
      params: { field: "delta", op: "sum" },
    });
    expect(result).toEqual({ field: "delta", op: "sum", value: 12 });
  });
});

describe("dataSourceService.fetchSourceSample", () => {
  it("GETs /api/data-sources/:id/sample and returns the body unchanged", async () => {
    const body = {
      rows: [{ a: { $int: 1 } }],
      capturedAt: "2026-10-16T12:00:00Z",
      sourceRowCount: null,
      truncated: true,
      live: true,
    };
    mockedHttpClient.get.mockResolvedValueOnce({ data: body });
    const { fetchSourceSample } = await import("./dataSourceService");
    await expect(fetchSourceSample("src-1")).resolves.toBe(body);
    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/data-sources/src-1/sample");
  });
});

describe("dataSourceService.fetchSourceSample scope (HEL-1648)", () => {
  const body = {
    rows: [],
    capturedAt: "2026-10-16T12:00:00Z",
    sourceRowCount: 0,
    truncated: false,
    live: false,
  };

  it("appends the encoded pipelineId when one is given", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: body });
    const { fetchSourceSample } = await import("./dataSourceService");
    await fetchSourceSample("src-1", "pipe 1&x");
    expect(mockedHttpClient.get).toHaveBeenLastCalledWith(
      "/api/data-sources/src-1/sample?pipelineId=pipe%201%26x",
    );
  });

  it("sends no query for an empty pipelineId", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: body });
    const { fetchSourceSample } = await import("./dataSourceService");
    await fetchSourceSample("src-1", "");
    expect(mockedHttpClient.get).toHaveBeenLastCalledWith("/api/data-sources/src-1/sample");
  });
});

describe("dataSourceService.fetchSourceSample guard", () => {
  it("refuses a body that is not a sample", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: "<html>proxy error</html>" });
    const { fetchSourceSample } = await import("./dataSourceService");
    await expect(fetchSourceSample("src-1")).rejects.toThrow("Unexpected sample response.");
  });
});
