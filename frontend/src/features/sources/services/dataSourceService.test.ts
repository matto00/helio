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
import { testConnection } from "./dataSourceService";
import type { SqlSourceConfig } from "./dataSourceService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { post: jest.fn() },
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
