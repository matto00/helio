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
import { registerPipelineTools } from "./tools/pipelines.js";
import { registerPlacementTools } from "./tools/placements.js";
import { buildWorkspaceContext } from "./context.js";

export const WORKSPACE_CONTEXT_URI = "helio://workspace/context";

export function createServer(api: HelioApi): McpServer {
  const server = new McpServerImpl({ name: "helio-mcp", version: "0.1.0" });

  registerReadTools(server, api);
  registerWriteTools(server, api);
  registerProposalTools(server, api);
  registerPipelineProposalTools(server, api);
  registerCombinedProposalTools(server, api);
  registerRefinementTools(server, api);
  registerOutputTools(server, api);
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
