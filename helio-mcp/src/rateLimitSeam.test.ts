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
import { HelioHttpClient } from "./httpClient.js";
import type { HelioConfig } from "./config.js";

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
