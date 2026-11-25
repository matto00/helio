/** HEL-1160 -- buildUrl never produces a URL off the configured origin. */
import { HelioHttpClient, HelioRequestUrlError, type HelioRequestInit } from "./httpClient.js";
import type { HelioConfig } from "./config.js";

const config = { baseUrl: "https://helio.test", pat: "pat-abc" } as HelioConfig;

function setup() {
  const calls: string[] = [];
  const fetchImpl = (url: string, _init: HelioRequestInit) => {
    calls.push(url);
    return Promise.resolve({
      status: 200,
      statusText: "200",
      ok: true,
      headers: { get: () => null },
      json: async () => ({}),
    } as unknown as Response);
  };
  return { client: new HelioHttpClient(config, { fetchImpl }), calls };
}

describe("HelioHttpClient origin guard", () => {
  it.each(["//evil.example/x", "//helio.test/x", "/\\evil.example/x", "/\t/evil.example/x"])(
    "get(%j) throws HelioRequestUrlError synchronously and sends nothing",
    (path) => {
      const { client, calls } = setup();
      expect(() => client.get(path)).toThrow(HelioRequestUrlError);
      expect(calls).toHaveLength(0);
    },
  );

  it("post and postMultipart refuse a cross-origin path too", () => {
    const { client, calls } = setup();
    expect(() => client.post("//evil.example/x", {})).toThrow(HelioRequestUrlError);
    expect(() => client.postMultipart("//evil.example/x", new FormData())).toThrow(
      HelioRequestUrlError,
    );
    expect(calls).toHaveLength(0);
  });

  it("leaves a normal path unchanged", async () => {
    const { client, calls } = setup();
    await client.get("/api/x", { a: 1 });
    expect(calls).toEqual(["https://helio.test/api/x?a=1"]);
  });
});
