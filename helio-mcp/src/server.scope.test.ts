/**
 * HEL-1381 guards for `createServer`'s scope wrapper: every registered tool and resource
 * handler runs inside the shared 429 wait budget, and no source file registers handlers in
 * a form that would bypass the wrapper.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, WORKSPACE_CONTEXT_URI } from "./server.js";
import { isInRateLimitScope } from "./httpClient.js";
import type { HelioApi } from "./helioApi.js";

async function connected(api: unknown) {
  const server = createServer(api as HelioApi);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("createServer scopes every handler to the shared 429 budget (HEL-1381)", () => {
  it("a tool handler runs inside a rate-limit scope", async () => {
    let inScope: boolean | undefined;
    const api = {
      listDashboards: async () => {
        inScope = isInRateLimitScope();
        return [];
      },
    };
    const { client, server } = await connected(api);
    try {
      expect(isInRateLimitScope()).toBe(false);
      await client.callTool({ name: "list_dashboards", arguments: {} });
      expect(inScope).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("the workspace-context resource read runs inside a rate-limit scope", async () => {
    const seen: boolean[] = [];
    const api = new Proxy(
      {},
      {
        get: () => async () => {
          seen.push(isInRateLimitScope());
          return [];
        },
      },
    );
    const { client, server } = await connected(api);
    try {
      await client.readResource({ uri: WORKSPACE_CONTEXT_URI }).catch(() => undefined);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(Boolean)).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("no non-test src file registers handlers through a form that bypasses the wrapper", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(full);
      }
    };
    walk(__dirname);
    const bypass =
      /\b(?:server|mcp)\s*\.\s*(?:tool|resource|prompt|registerPrompt|registerToolTask)\s*\(|\bregisterToolTask\b/;
    const offenders = files.filter((f) => bypass.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
