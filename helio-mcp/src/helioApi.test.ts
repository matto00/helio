/**
 * HEL-862 — `HelioApi.createCsvDataSource`'s transport dispatch: `content`
 * posts `multipart/form-data` unchanged; `sourceUrl` posts a JSON `{name,
 * type: "csv", config: {url}, tag?}` body to the same endpoint. `fetch` is
 * injected (mirrors `httpClient.test.ts`'s harness) so these tests assert
 * the REQUEST SHAPE without a real network call.
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

function harness() {
  const calls: { url: string; init: HelioRequestInit }[] = [];
  const fetchImpl = (url: string, init: HelioRequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      reply(201, { id: "ds-1", name: "n", type: "csv", createdAt: "", updatedAt: "" }),
    );
  };
  const client = new HelioHttpClient(config, { fetchImpl });
  return { api: new HelioApi(client), calls };
}

describe("HelioApi.createCsvDataSource", () => {
  it("posts multipart/form-data when content is supplied, unchanged from before HEL-862", async () => {
    const { api, calls } = harness();
    await api.createCsvDataSource({ name: "Sales", content: "a,b\n1,2" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
  });

  it("posts a JSON {name, type: csv, config: {url}} body when sourceUrl is supplied, not multipart", async () => {
    const { api, calls } = harness();
    await api.createCsvDataSource({ name: "Sales", sourceUrl: "https://example.com/data.csv" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.body).not.toBeInstanceOf(FormData);
    const parsedBody = JSON.parse(calls[0]?.init.body as string);
    expect(parsedBody).toEqual({
      name: "Sales",
      type: "csv",
      config: { url: "https://example.com/data.csv" },
      tag: undefined,
    });
  });

  it("propagates tag on the JSON create path", async () => {
    const { api, calls } = harness();
    await api.createCsvDataSource({
      name: "Sales",
      sourceUrl: "https://example.com/data.csv",
      tag: "workflow-1",
    });

    const parsedBody = JSON.parse(calls[0]?.init.body as string);
    expect(parsedBody.tag).toBe("workflow-1");
  });
});
