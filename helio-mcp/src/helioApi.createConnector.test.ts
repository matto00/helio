/**
 * HEL-886 tasks.md 4.3 — `HelioApi.createConnector`'s transport dispatch: asserts the posted
 * body carries `authType: "none"` and a hardcoded `credential: ""` and no other
 * credential-shaped key (design.md Decision 1), and that the mapped result carries no
 * credential field. Mirrors `helioApi.test.ts`'s injected-`fetch` harness so this asserts the
 * REQUEST SHAPE without a real network call.
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
      reply(201, {
        id: "conn-1",
        name: "Sleeper",
        kind: "rest_api",
        baseUrl: "https://api.sleeper.app",
      }),
    );
  };
  const client = new HelioHttpClient(config, { fetchImpl });
  return { api: new HelioApi(client), calls };
}

describe("HelioApi.createConnector", () => {
  it("POSTs to /api/connectors with authType: none and a literal empty credential", async () => {
    const { api, calls } = harness();
    await api.createConnector({
      name: "Sleeper",
      kind: "rest_api",
      baseUrl: "https://api.sleeper.app",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://helio.test/api/connectors");
    expect(calls[0]?.init.method).toBe("POST");
    const parsedBody = JSON.parse(calls[0]?.init.body as string);
    expect(parsedBody).toEqual({
      name: "Sleeper",
      kind: "rest_api",
      baseUrl: "https://api.sleeper.app",
      config: { authType: "none" },
      credential: "",
    });
  });

  it("posts a body containing no credential-shaped key other than the literal empty credential", async () => {
    const { api, calls } = harness();
    await api.createConnector({
      name: "Sleeper",
      kind: "rest_api",
      baseUrl: "https://api.sleeper.app",
    });

    const parsedBody = JSON.parse(calls[0]?.init.body as string);
    for (const forbidden of ["auth", "apiKey", "token", "password"]) {
      expect(Object.keys(parsedBody)).not.toContain(forbidden);
    }
    expect(parsedBody.credential).toBe("");
  });

  it("maps the response into a CreateConnectorResult with no credential field", async () => {
    const { api } = harness();
    const result = await api.createConnector({
      name: "Sleeper",
      kind: "rest_api",
      baseUrl: "https://api.sleeper.app",
    });

    expect(result).toEqual({
      id: "conn-1",
      name: "Sleeper",
      kind: "rest_api",
      host: "https://api.sleeper.app",
    });
    expect(Object.keys(result)).not.toContain("credential");
    expect(Object.keys(result)).not.toContain("config");
  });
});
