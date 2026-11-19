/**
 * HEL-1747 -- `HelioApi.getOutputInsight` / `refreshOutputInsight` / `askDashboard`: method, URL and
 * body of the one request each issues (same injected-`fetch` harness as helioApi.outputHistory.test.ts).
 */

import { HelioApi } from "./helioApi.js";
import { HelioHttpClient, type HelioRequestInit } from "./httpClient.js";
import type { HelioConfig } from "./config.js";

const config: HelioConfig = { baseUrl: "https://helio.test", pat: "pat-abc" } as HelioConfig;

function harness(body: unknown) {
  const calls: { url: string; init: HelioRequestInit }[] = [];
  const fetchImpl = (url: string, init: HelioRequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      status: 200,
      statusText: "200",
      ok: true,
      headers: { get: () => null },
      json: async () => body,
    } as unknown as Response);
  };
  return { api: new HelioApi(new HelioHttpClient(config, { fetchImpl })), calls };
}

describe("HelioApi insight methods (HEL-1747)", () => {
  it("getOutputInsight GETs /api/outputs/:id/insight", async () => {
    const { api, calls } = harness({ outputId: "o-1" });

    await api.getOutputInsight("o-1");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe("GET");
    expect(new URL(calls[0]!.url).pathname).toBe("/api/outputs/o-1/insight");
  });

  it("refreshOutputInsight POSTs /api/outputs/:id/insight/refresh with no body", async () => {
    const { api, calls } = harness({ outputId: "o-1", started: true });

    await api.refreshOutputInsight("o-1");

    expect(calls[0]!.init.method).toBe("POST");
    expect(new URL(calls[0]!.url).pathname).toBe("/api/outputs/o-1/insight/refresh");
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it("askDashboard POSTs {question} to /api/dashboards/:id/ask", async () => {
    const { api, calls } = harness({ answer: "a" });

    await api.askDashboard("d-1", "Why?");

    expect(calls[0]!.init.method).toBe("POST");
    expect(new URL(calls[0]!.url).pathname).toBe("/api/dashboards/d-1/ask");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ question: "Why?" });
  });
});
