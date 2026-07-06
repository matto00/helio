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
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HelioHttpClient } from "./httpClient.js";
import { HelioApi } from "./helioApi.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { buildWorkspaceContext } from "./context.js";

const WORKSPACE_CONTEXT_URI = "helio://workspace/context";

export function createServer(api: HelioApi): McpServer {
  const server = new McpServer({ name: "helio-mcp", version: "0.1.0" });

  registerReadTools(server, api);
  registerWriteTools(server, api);

  // The same workspace snapshot as `get_workspace_context`, exposed as a
  // resource so MCP clients can attach it as ambient context.
  server.registerResource(
    "workspace-context",
    WORKSPACE_CONTEXT_URI,
    {
      title: "Helio workspace context",
      description:
        "Compact snapshot of the authenticated user's data sources, DataTypes (with columns), " +
        "pipelines (with steps), and dashboards.",
      mimeType: "application/json",
    },
    async (uri) => {
      const context = await buildWorkspaceContext(api);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(context, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

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
