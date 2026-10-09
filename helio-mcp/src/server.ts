/**
 * `createServer` — registers every helio-mcp tool + the workspace-context
 * resource onto a fresh `McpServer`. Split out of `index.ts` (HEL-907 task
 * 3.9/5.3) so a unit test can import it directly: `index.ts` itself has a
 * top-level `import.meta.url` direct-invocation guard that ts-jest's CJS-ish
 * compile target cannot parse (`TS1343`), so nothing that needs to be
 * imported from a test may live in that file — `index.ts` now just wires
 * config/transport and calls this.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpServer as McpServerImpl } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HelioApi } from "./helioApi.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerProposalTools } from "./tools/proposal.js";
import { registerPipelineProposalTools } from "./tools/pipelineProposal.js";
import { registerCombinedProposalTools } from "./tools/combinedProposal.js";
import { registerRefinementTools } from "./tools/refinement.js";
import { registerOutputTools } from "./tools/outputs.js";
import { registerOutputControlTools } from "./tools/outputControls.js";
import { registerPipelineTools } from "./tools/pipelines.js";
import { registerPlacementTools } from "./tools/placements.js";
import { buildWorkspaceContext } from "./context.js";
import { runWithRateLimitScope } from "./httpClient.js";

export const WORKSPACE_CONTEXT_URI = "helio://workspace/context";

/** Where the SDK puts the per-request `extra` in each registration's callback: the tool
 *  callback is `(args, extra)` (or `(extra)` for a no-input tool), a resource callback is
 *  `(uri, extra)` or `(uri, variables, extra)`. Rather than guess a position, scan the
 *  arguments for the object carrying the `AbortSignal`. */
function findSignal(args: unknown[]): AbortSignal | undefined {
  for (const arg of args) {
    const signal = (arg as { signal?: unknown } | null)?.signal;
    if (signal instanceof AbortSignal) return signal;
  }
  return undefined;
}

/**
 * HEL-1381: make every tool/resource handler registered on `server` run inside one shared
 * 429 wait budget (`runWithRateLimitScope`), bound to the request's abort signal. This is the
 * single choke point -- tool files stay unaware, and a future tool registered through
 * `createServer` is scoped automatically. Must run before any `register*` call.
 */
function scopeHandlers(server: McpServer): void {
  const scoped = (original: (...a: never[]) => unknown) =>
    function (this: unknown, ...args: unknown[]) {
      const cb = args[args.length - 1];
      if (typeof cb !== "function") return Reflect.apply(original, this, args);
      const wrapped = (...cbArgs: unknown[]) =>
        runWithRateLimitScope(findSignal(cbArgs), () => Reflect.apply(cb, undefined, cbArgs));
      return Reflect.apply(original, this, [...args.slice(0, -1), wrapped]);
    };
  const target = server as unknown as Record<string, (...a: never[]) => unknown>;
  target.registerTool = scoped(server.registerTool.bind(server) as never);
  target.registerResource = scoped(server.registerResource.bind(server) as never);
}

export function createServer(api: HelioApi): McpServer {
  const server = new McpServerImpl({ name: "helio-mcp", version: "0.1.0" });
  scopeHandlers(server);

  registerReadTools(server, api);
  registerWriteTools(server, api);
  registerProposalTools(server, api);
  registerPipelineProposalTools(server, api);
  registerCombinedProposalTools(server, api);
  registerRefinementTools(server, api);
  registerOutputTools(server, api);
  registerOutputControlTools(server, api);
  registerPipelineTools(server, api);
  registerPlacementTools(server, api);

  // The same workspace snapshot as `get_workspace_context`, exposed as a
  // resource so MCP clients can attach it as ambient context.
  server.registerResource(
    "workspace-context",
    WORKSPACE_CONTEXT_URI,
    {
      title: "Helio workspace context",
      description:
        "Compact snapshot of the authenticated user's data sources (with inferredSchema), " +
        "pipelines (with steps and their Outputs -- kind/schema/placements), dashboards, and " +
        "agentContext (the user's stored agent-authoring preferences plus up to 20 of their " +
        "most-recently-useful memory entries, most-recently-useful first -- fetching it never " +
        "updates any entry's lastUsedAt). Same payload as get_workspace_context.",
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
