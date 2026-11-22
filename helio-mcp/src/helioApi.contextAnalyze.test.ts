/** HEL-1625: `HelioApi.getPipelineContextAnalyze` reads `GET /api/pipelines/context-analyze`. */

import { HelioApi } from "./helioApi.js";
import { HelioHttpClient, type HelioRequestInit } from "./httpClient.js";
import type { HelioConfig } from "./config.js";

describe("HelioApi.getPipelineContextAnalyze", () => {
  it("GETs /api/pipelines/context-analyze and returns the body", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        ok: true,
        headers: { get: () => null },
        json: async () => ({ items: [{ pipelineId: "p", steps: [], warnings: [] }] }),
      } as unknown as Response);
    };
    const api = new HelioApi(
      new HelioHttpClient({ baseUrl: "https://helio.test", pat: "x" } as HelioConfig, {
        fetchImpl,
      }),
    );
    const body = await api.getPipelineContextAnalyze();
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe("/api/pipelines/context-analyze");
    expect(calls[0]!.init.method ?? "GET").toBe("GET");
    expect(body.items).toHaveLength(1);
  });
});
