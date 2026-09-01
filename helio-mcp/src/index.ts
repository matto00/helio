#!/usr/bin/env node
/**
 * helio-mcp — Model Context Protocol server exposing Helio's REST API as agent
 * tools. Phase 2: read tools + the workspace-context resource. Authenticates
 * with a Personal Access Token (HEL-148 Phase 1) over the existing API; adds no
 * backend logic of its own.
 *
 * Transport: stdio (the standard MCP launch shape — an MCP client spawns this
 * process and speaks JSON-RPC over stdin/stdout). All human-facing logging goes
 * to stderr so it never corrupts the protocol stream on stdout.
 *
 * Tool/resource registration itself lives in `server.ts`'s `createServer` —
 * split out (HEL-907 task 3.9/5.3) so a unit test can import it without
 * tripping this file's top-level `import.meta.url` direct-invocation guard.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HelioHttpClient } from "./httpClient.js";
import { HelioApi } from "./helioApi.js";
import { createServer } from "./server.js";

export { createServer } from "./server.js";

async function main(): Promise<void> {
  let api: HelioApi;
  try {
    const config = loadConfig();
    api = new HelioApi(new HelioHttpClient(config));
    process.stderr.write(`helio-mcp: targeting ${config.baseUrl}\n`);
  } catch (err) {
    process.stderr.write(`helio-mcp: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const server = createServer(api);
  await server.connect(new StdioServerTransport());
  process.stderr.write("helio-mcp: ready (stdio)\n");
}

// Only run when invoked directly (not when imported by the verify harness).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`helio-mcp: fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
