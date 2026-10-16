/**
 * HEL-1617 seam test: a real MCP `Client` calling `get_workspace_context` through the real server
 * and the real `HelioHttpClient`, against a stub backend that answers 429 with a Retry-After past
 * the wait budget for BOTH the data-sources list (fail-fast group) and the outputs list.
 *
 * The rate-limit error surfaces on the first 429 (no waiting), so no fake timers are needed. Jest
 * reports an orphaned rejection as a failure of the test run rather than delivering it to a
 * `process.on("unhandledRejection")` listener, so the assertion here is that the call settles as
 * an `isError` result and the test itself stays green; the crash on unfixed code is proven in a
 * real process by `rateLimitedContextProcess.test.ts`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import { HelioApi } from "./helioApi.js";
import { HelioHttpClient } from "./httpClient.js";
import type { HelioConfig } from "./config.js";

const config: HelioConfig = { baseUrl: "https://helio.test", pat: "pat-abc" } as HelioConfig;

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

describe("get_workspace_context under 429s past the retry budget (HEL-1617)", () => {
  it("returns an isError rate-limit result when data sources and outputs are both throttled", async () => {
    const http = new HelioHttpClient(config, {
      fetchImpl: async (url: string) => {
        const path = new URL(url).pathname;
        if (path === "/api/data-sources" || path === "/api/outputs") {
          return reply(429, { message: "Rate limit exceeded" }, "3600");
        }
        if (path === "/api/dashboards") return reply(200, { items: [], total: 0 });
        return reply(200, []);
      },
      sleep: () => Promise.resolve(),
      warn: () => {},
    });
    const server = createServer(new HelioApi(http));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const result = (await client.callTool({ name: "get_workspace_context", arguments: {} })) as {
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      };
      // Let any orphaned rejection from the build be flagged before the test ends.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/rate limit/i);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
