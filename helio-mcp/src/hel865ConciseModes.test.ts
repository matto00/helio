/**
 * HEL-865 task 6.8 — `HelioApi.analyzePipeline` forwards `concise` as a query param when
 * requested, and omits it entirely when not (mirroring `runPipeline`'s `dry ? { dry: "true" } :
 * undefined` precedent, `helioApi.ts:622-626`). Uses the same injected-`fetch` harness as
 * `helioApi.test.ts` so this asserts the REQUEST SHAPE without a real network call.
 */

import { HelioApi } from "./helioApi.js";
import { HelioHttpClient, type HelioRequestInit } from "./httpClient.js";
import type { HelioConfig } from "./config.js";

const config: HelioConfig = { baseUrl: "https://helio.test", pat: "pat-abc" } as HelioConfig;

function reply(status: number, body: unknown) {
  return {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function harness(body: unknown) {
  const calls: { url: string; init: HelioRequestInit }[] = [];
  const fetchImpl = (url: string, init: HelioRequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(reply(200, body));
  };
  const client = new HelioHttpClient(config, { fetchImpl });
  return { api: new HelioApi(client), calls };
}

describe("HelioApi.analyzePipeline — concise passthrough (HEL-865 design.md D5)", () => {
  it("forwards concise=true as a query param when requested", async () => {
    const { api, calls } = harness({ nodes: [] });

    await api.analyzePipeline("pipe-1", true);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/pipelines/pipe-1/analyze");
    expect(url.searchParams.get("concise")).toBe("true");
  });

  it("omits the concise query param entirely when not requested", async () => {
    const { api, calls } = harness({ id: "pipe-1", name: "P", sourceSchemas: [], steps: [] });

    await api.analyzePipeline("pipe-1");

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has("concise")).toBe(false);
  });
});
