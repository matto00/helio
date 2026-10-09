/**
 * HEL-1349 seam test — a real MCP SDK `Client` (DEFAULT request timeout) talking to the
 * real server/tool shells over `InMemoryTransport`, with the real `HelioHttpClient`
 * against a stub backend that always answers 429 `Retry-After: 59`.
 *
 * Before the fix the HTTP client slept 59s and re-sent, so the caller's 60s clock
 * expired first and `callTool` rejected with `McpError` -32001 (request timeout).
 * After the fix the tool resolves at once with an `isError` result naming the rate
 * limit and the 59s. Fake timers drive the SDK's own default timeout (no explicit
 * `{ timeout }` substitution), so this test covers the default-timeout link directly.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import { HelioApi } from "./helioApi.js";
import { HelioHttpClient, HelioRateLimitError } from "./httpClient.js";
import type { HelioConfig } from "./config.js";
import type { HelioRequestInit } from "./httpClient.js";

const config: HelioConfig = { baseUrl: "https://helio.test", pat: "pat-abc" } as HelioConfig;

function throttled(): Response {
  return {
    status: 429,
    statusText: "429",
    ok: false,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "59" : null) },
    json: async () => ({ message: "Rate limit exceeded" }),
  } as unknown as Response;
}

describe("rate-limited tool call through a real MCP client (HEL-1349)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("resolves isError naming the rate limit and 59s, not a -32001 request timeout", async () => {
    const http = new HelioHttpClient(config, {
      fetchImpl: () => Promise.resolve(throttled()),
      // Real-timer semantics (driven by the fake clock), so a long sleep really consumes the caller's 60s.
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      warn: () => {},
    });
    const server = createServer(new HelioApi(http));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const outcome = client
        .callTool({ name: "list_dashboards", arguments: {} })
        .then((value) => ({ value }))
        .catch((error: unknown) => ({ error }));
      // Past the SDK default 60s timeout; a correct implementation settles long before this.
      await jest.advanceTimersByTimeAsync(65_000);
      const settled = await outcome;

      expect(settled).not.toHaveProperty("error");
      const result = (settled as { value: { isError?: boolean; content: unknown } }).value;
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toMatch(/rate limit/i);
      expect(text).toContain("59s");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

/** A `Response`-shaped stub with an arbitrary status/body/Retry-After. */
function reply(status: number, body: unknown, retryAfter?: string): Response {
  return {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "retry-after" && retryAfter !== undefined ? retryAfter : null,
    },
    json: async () => body,
  } as unknown as Response;
}

describe("multi-request tool call through a real MCP client (HEL-1381)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("run_pipeline with two 25s Retry-Afters resolves isError naming the rate limit, not -32001", async () => {
    // POST run: 429(25) then 200 (with step counts so a third GET /steps follows);
    // GET summary: 429(25) then 200; GET steps: 200. Every request takes 5s of caller-visible
    // time. Per-request budgets: 5+25+5 + 5+25+5 + 5 = 75s > the SDK's 60s default timeout.
    const seen: Record<string, number> = {};
    const fetchImpl = async (url: string, init: HelioRequestInit): Promise<Response> => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const key = `${init.method} ${new URL(url).pathname}`;
      const n = (seen[key] = (seen[key] ?? 0) + 1);
      if (key === "POST /api/pipelines/p1/run") {
        return n === 1
          ? reply(429, { message: "Rate limit exceeded" }, "25")
          : reply(200, {
              rows: [],
              rowCount: 1,
              runId: "r1",
              sourceRowCount: 1,
              stepRowCounts: { s1: 1 },
            });
      }
      if (key === "GET /api/pipelines/p1") {
        return n === 1
          ? reply(429, { message: "Rate limit exceeded" }, "25")
          : reply(200, { id: "p1", name: "p", roots: [], lastRunStatus: "succeeded" });
      }
      return reply(200, []);
    };
    const http = new HelioHttpClient(config, {
      fetchImpl,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      warn: () => {},
    });
    const server = createServer(new HelioApi(http));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const outcome = client
        .callTool({ name: "run_pipeline", arguments: { pipelineId: "p1" } })
        .then((value) => ({ value }))
        .catch((error: unknown) => ({ error }));
      // Well past the SDK default 60s timeout; a correct implementation settles at ~40s.
      await jest.advanceTimersByTimeAsync(90_000);
      const settled = await outcome;

      expect(settled).not.toHaveProperty("error");
      const result = (settled as { value: { isError?: boolean; content: unknown } }).value;
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toMatch(/rate limit/i);
      expect(text).toContain("25s");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("caller cancellation reaches the 429 wait through the real SDK (HEL-1381)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("aborting callTool mid-wait ends the wait with exactly one fetch", async () => {
    let fetches = 0;
    const http = new HelioHttpClient(config, {
      fetchImpl: () => {
        fetches++;
        return Promise.resolve(reply(429, { message: "Rate limit exceeded" }, "25"));
      },
      // Real-timer semantics on the fake clock; deliberately ignores the abort signal so only
      // dispatch's own race can end the wait.
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      warn: () => {},
    });
    let waitOutcome: unknown;
    const originalGet = http.get.bind(http);
    http.get = ((...args: Parameters<typeof originalGet>) =>
      originalGet(...args).catch((error: unknown) => {
        waitOutcome = error;
        throw error;
      })) as typeof http.get;
    const server = createServer(new HelioApi(http));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const controller = new AbortController();
      const call = client
        .callTool({ name: "list_dashboards", arguments: {} }, undefined, {
          signal: controller.signal,
        })
        .catch(() => undefined);
      // Into the 25s wait (well short of it), then the caller cancels.
      await jest.advanceTimersByTimeAsync(1_000);
      expect(fetches).toBe(1);
      expect(waitOutcome).toBeUndefined();
      controller.abort();
      await jest.advanceTimersByTimeAsync(10);
      await call;

      expect(waitOutcome).toBeInstanceOf(HelioRateLimitError);
      expect((waitOutcome as HelioRateLimitError).message).toMatch(/cancelled/);
      expect(fetches).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
