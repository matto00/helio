/**
 * HEL-1274 — `HelioApi.getOutputHistory` issues one GET and adds `limit`/`since` query params only
 * when defined. Same injected-`fetch` harness as `hel865ConciseModes.test.ts`.
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

describe("HelioApi.getOutputHistory (HEL-1274)", () => {
  it("sends neither limit nor since when omitted", async () => {
    const { api, calls } = harness({ points: [] });

    await api.getOutputHistory("out-1");

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/outputs/out-1/history");
    expect(url.searchParams.has("limit")).toBe(false);
    expect(url.searchParams.has("since")).toBe(false);
  });

  it("forwards limit and since when supplied", async () => {
    const { api, calls } = harness({ points: [] });

    await api.getOutputHistory("out-1", { limit: 30, since: "2026-10-05T00:00:00Z" });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("limit")).toBe("30");
    expect(url.searchParams.get("since")).toBe("2026-10-05T00:00:00Z");
  });
});
