/**
 * HEL-1160 / HEL-1161 -- the request URL never leaves the configured API origin or the base URL's path
 * prefix, and a refusal is a rejected promise, never a synchronous throw.
 *
 * Labels: RED-FIRST = fails on the pre-HEL-1161 code for the stated reason; GUARD = passes there and is
 * proven by a named mutation (tasks.md 3.1).
 */
import { HelioHttpClient, HelioRequestUrlError, type HelioRequestInit } from "./httpClient.js";
import type { HelioConfig } from "./config.js";

function setup(baseUrl = "https://helio.test") {
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
  const config = { baseUrl, pat: "pat-abc" } as HelioConfig;
  return { client: new HelioHttpClient(config, { fetchImpl }), calls };
}

type Client = HelioHttpClient;
const METHODS: Array<[string, (c: Client, p: string) => Promise<unknown>]> = [
  ["get", (c, p) => c.get(p)],
  ["post", (c, p) => c.post(p, {})],
  ["patch", (c, p) => c.patch(p, {})],
  ["put", (c, p) => c.put(p, {})],
  ["delete", (c, p) => c.delete(p)],
  ["postMultipart", (c, p) => c.postMultipart(p, new FormData())],
];

/** Calls `fn`, failing if it throws synchronously, and returns the promise it produced. */
function callWithoutThrowing(fn: () => Promise<unknown>): Promise<unknown> {
  let promise: Promise<unknown> | undefined;
  expect(() => {
    promise = fn();
  }).not.toThrow();
  return promise as Promise<unknown>;
}

describe("HelioHttpClient path prefix", () => {
  // RED-FIRST: main resolves root-relative and sends https://h/api/x.
  it.each(["https://h/helio", "https://h/helio/", "https://h/helio//"])(
    "RED-FIRST base %s + /api/x requests https://h/helio/api/x",
    async (base) => {
      const { client, calls } = setup(base);
      await client.get("/api/x");
      expect(calls).toEqual(["https://h/helio/api/x"]);
    },
  );

  // RED-FIRST: a root base with and without a trailing slash is already identical, but a prefixed
  // base with a query keeps both prefix and query.
  it("RED-FIRST keeps the prefix together with a query", async () => {
    const { client, calls } = setup("https://h/helio");
    await client.get("/api/x", { a: 1, b: undefined });
    expect(calls).toEqual(["https://h/helio/api/x?a=1"]);
  });

  it("GUARD a root base is unchanged by a trailing slash", async () => {
    const a = setup("https://h");
    const b = setup("https://h/");
    await a.client.get("/api/x");
    await b.client.get("/api/x");
    expect(a.calls).toEqual(["https://h/api/x"]);
    expect(b.calls).toEqual(a.calls);
  });
});

describe("HelioHttpClient refusals are rejected promises", () => {
  // RED-FIRST: `//...` and `/\evil` throw synchronously on main; `/https://evil.example/x` is sent.
  describe.each(METHODS)("%s", (_name, call) => {
    it.each(["//evil.example/x", "/\\evil.example/x", "/https://evil.example/x"])(
      "RED-FIRST %j returns a rejected promise and sends nothing",
      async (path) => {
        const { client, calls } = setup();
        const promise = callWithoutThrowing(() => call(client, path));
        await expect(promise).rejects.toBeInstanceOf(HelioRequestUrlError);
        expect(calls).toHaveLength(0);
      },
    );

    it("RED-FIRST a base that is not an absolute URL (localhost:8080) rejects, not throws", async () => {
      const { client, calls } = setup("localhost:8080");
      const promise = callWithoutThrowing(() => call(client, "/api/x"));
      await expect(promise).rejects.toBeInstanceOf(HelioRequestUrlError);
      expect(calls).toHaveLength(0);
    });
  });
});

describe("HelioHttpClient pre-resolution character check", () => {
  // GUARD (mutation 3.1 "remove the pre-resolution character check"): on main these already refuse,
  // synchronously under any base; asserted here through a promise so both shapes can be observed.
  it.each(["https://helio.test", "https://h/helio"])(
    "GUARD /\\evil.example/x and /\\t/evil.example/x are refused under base %s",
    async (base) => {
      for (const path of ["/\\evil.example/x", "/\t/evil.example/x"]) {
        const { client, calls } = setup(base);
        await expect(Promise.resolve().then(() => client.get(path))).rejects.toBeInstanceOf(
          HelioRequestUrlError,
        );
        expect(calls).toHaveLength(0);
      }
    },
  );

  // RED-FIRST: main resolves a space or a control character same-origin and sends it (percent-encoded).
  it.each(["/api/x y", "/api/x\u0000", "/api/x\n"])(
    "RED-FIRST %j is refused under a root base",
    async (path) => {
      const { client, calls } = setup();
      await expect(callWithoutThrowing(() => client.get(path))).rejects.toBeInstanceOf(
        HelioRequestUrlError,
      );
      expect(calls).toHaveLength(0);
    },
  );
});

describe("HelioHttpClient prefix containment under base https://h/helio", () => {
  // RED-FIRST: main sends these to https://h/tokens, https://h/x, ...
  it.each([
    "/api/../../tokens",
    "/../x",
    "/%2e%2e/x",
    "/.%2e/x",
    "/../helio2/x",
    "/api/%2e%2e/%2e%2e/x",
  ])("RED-FIRST %j is refused and sends nothing", async (path) => {
    const { client, calls } = setup("https://h/helio");
    await expect(callWithoutThrowing(() => client.get(path))).rejects.toBeInstanceOf(
      HelioRequestUrlError,
    );
    expect(calls).toHaveLength(0);
  });

  it("RED-FIRST a path that stays inside the prefix after dot-segments is allowed", async () => {
    const { client, calls } = setup("https://h/helio");
    await client.get("/api/a/../b");
    expect(calls).toEqual(["https://h/helio/api/b"]);
  });

  // RED-FIRST on main for `//`: it is refused synchronously, not as a rejection.
  it("RED-FIRST origin escapes are still refused under a prefixed base", async () => {
    for (const path of ["//evil.example/x", "/https://evil.example/x"]) {
      const { client, calls } = setup("https://h/helio");
      await expect(callWithoutThrowing(() => client.get(path))).rejects.toBeInstanceOf(
        HelioRequestUrlError,
      );
      expect(calls).toHaveLength(0);
    }
  });
});

describe("HelioHttpClient normal use", () => {
  it("GUARD leaves a normal path unchanged", async () => {
    const { client, calls } = setup();
    await client.get("/api/x", { a: 1 });
    expect(calls).toEqual(["https://helio.test/api/x?a=1"]);
  });
});
