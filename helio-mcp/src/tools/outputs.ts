/**
 * Output tools (HEL-907 task 3.5/3.7): `add_output`, `update_output`,
 * `delete_output`, `list_outputs`, `get_output`, `get_output_rows`,
 * `get_output_panels`, `get_output_assertion_status`, `preview_outputs`,
 * `get_output_capabilities`.
 *
 * This file is a thin shell (mirrors `pipelineProposal.ts`'s design.md D4b
 * split): zod `inputSchema` declarations + `guarded(() => xHandler(api,
 * ...))` one-liners only. All actual logic lives in `outputsHandlers.ts`,
 * which this file imports and does not duplicate — kept separate so a test
 * can exercise that logic without pulling this file's zod/`registerTool`
 * surface into the compile graph.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import {
  addOutputHandler,
  deleteOutputHandler,
  getOutputAssertionStatusHandler,
  getOutputCapabilitiesHandler,
  getOutputHandler,
  getOutputPanelsHandler,
  getOutputRowsHandler,
  listOutputsHandler,
  previewOutputsHandler,
  updateOutputHandler,
} from "./outputsHandlers.js";

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function guarded(produce: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await produce());
  } catch (err) {
    const message =
      err instanceof HelioApiError
        ? `${err.name} (status ${err.status}) for ${err.url}: ${err.message}`
        : `${(err as Error)?.name ?? "Error"}: ${(err as Error)?.message ?? String(err)}`;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

// Mirrors CreatePipelineTransactionalOutputRequest's kind enum
// (schemas/pipelines/create-pipeline-transactional-output-request.schema.json).
const outputKindSchema = z.enum(["table", "metric", "chart", "collection", "timeline", "markdown"]);

export function registerOutputTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "add_output",
    {
      title: "Add an Output to a pipeline node",
      description:
        "Create an Output on a pipeline (POST /api/pipelines/:id/outputs) — a panel-bindable " +
        "projection of one pipeline node. `nodeStepId` absent means a root-bound Output; " +
        "present, it must be a real step id on this pipeline. `kind` selects " +
        "which of the bindable shapes this Output represents (table/metric/chart/collection/" +
        "timeline/markdown); `config.fieldMapping`, when the kind requires one, MUST use slot " +
        "names get_output_capabilities marks bindable for this node, and each mapped value MUST " +
        "be a column that actually exists at THIS node (not the trunk's schema, not a sibling " +
        "tail's) — check get_output_capabilities first. `rootId` (HEL-913, multi-root only) " +
        "names WHICH root a root-bound Output attaches to — mutually exclusive with " +
        "`nodeStepId`; omit it on a single-root pipeline (the backend auto-resolves the one " +
        "root). Requires editor or owner access on the pipeline. Returns the created Output.",
      inputSchema: {
        pipelineId: z.string().min(1),
        nodeStepId: z.string().min(1).optional(),
        kind: outputKindSchema,
        name: z.string().min(1),
        config: z.record(z.string(), z.unknown()).optional(),
        rootId: z.string().min(1).optional(),
      },
    },
    ({ pipelineId, nodeStepId, kind, name, config, rootId }) =>
      guarded(() => addOutputHandler(api, { pipelineId, nodeStepId, kind, name, config, rootId })),
  );

  server.registerTool(
    "update_output",
    {
      title: "Update an Output",
      description:
        "Rename an Output and/or patch its config (PATCH /api/outputs/:id) — owner-only. " +
        "`config`, when present, merges one level deep for legend/tooltip/seriesColors/" +
        "axisLabels (HEL-877) rather than replacing the whole object; every other config key is " +
        "replaced outright. Absent fields are left unchanged. Returns the updated Output.",
      inputSchema: {
        outputId: z.string().min(1),
        name: z.string().min(1).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      },
    },
    ({ outputId, name, config }) =>
      guarded(() => updateOutputHandler(api, { outputId, name, config })),
  );

  server.registerTool(
    "delete_output",
    {
      title: "Delete an Output",
      description:
        "Delete an Output (DELETE /api/outputs/:id) — owner-only. Also deletes every placement " +
        "Panel bound to this Output; call get_output_panels first if you want to warn about what " +
        "will disappear. Returns { removedPanelIds }.",
      inputSchema: { outputId: z.string().min(1) },
    },
    ({ outputId }) => guarded(() => deleteOutputHandler(api, outputId)),
  );

  server.registerTool(
    "list_outputs",
    {
      title: "List Outputs",
      description:
        "List Outputs. Pass pipelineId to list every Output on that pipeline (optionally " +
        "further scoped to one node via nodeStepId — GET /api/pipelines/:id/outputs); omit " +
        "pipelineId to list every Output the caller OWNS across the whole workspace, paginated " +
        "(GET /api/outputs, limit/offset).",
      inputSchema: {
        pipelineId: z.string().min(1).optional(),
        nodeStepId: z.string().min(1).optional(),
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    ({ pipelineId, nodeStepId, limit, offset }) =>
      guarded(() => listOutputsHandler(api, { pipelineId, nodeStepId, limit, offset })),
  );

  server.registerTool(
    "get_output",
    {
      title: "Get an Output",
      description:
        "Get one Output by id (GET /api/outputs/:id) — sharing-aware (owner/editor/viewer of the parent pipeline).",
      inputSchema: { outputId: z.string().min(1) },
    },
    ({ outputId }) => guarded(() => getOutputHandler(api, outputId)),
  );

  server.registerTool(
    "get_output_rows",
    {
      title: "Get an Output's rows",
      description:
        "Fetch the latest pipeline-run row snapshot for an Output (GET /api/outputs/:id/rows, " +
        "paginated) — replaces the retired get_data_type_rows. Rows exist only after the " +
        "Output's pipeline has run successfully at least once past this node.",
      inputSchema: {
        outputId: z.string().min(1),
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    ({ outputId, limit, offset }) =>
      guarded(() => getOutputRowsHandler(api, { outputId, limit, offset })),
  );

  server.registerTool(
    "get_output_panels",
    {
      title: "List an Output's placements",
      description:
        "List every dashboard Panel currently bound (placed) to this Output " +
        "(GET /api/outputs/:id/panels) — the placements report to check before a destructive " +
        "delete_output call.",
      inputSchema: { outputId: z.string().min(1) },
    },
    ({ outputId }) => guarded(() => getOutputPanelsHandler(api, outputId)),
  );

  server.registerTool(
    "get_output_assertion_status",
    {
      title: "Get an Output's assertion status",
      description:
        "Whether this Output's own node has at least one persisted error-severity failed " +
        "assertion on the pipeline's latest non-dry run (GET /api/outputs/:id/assertion-status).",
      inputSchema: { outputId: z.string().min(1) },
    },
    ({ outputId }) => guarded(() => getOutputAssertionStatusHandler(api, outputId)),
  );

  server.registerTool(
    "preview_outputs",
    {
      title: "Dry-run preview one or every Output on a pipeline",
      description:
        "Dry-run a pipeline and return the projected rows for its Output(s) WITHOUT persisting a " +
        "run or writing any Output's row snapshot (POST /api/pipelines/:id/preview?outputId=). " +
        "Pass outputId to preview just that one Output; omit it to preview every Output on the " +
        "pipeline in one call. Both arms return the identical { outputs: [{ outputId, preview " +
        "}] } envelope.",
      inputSchema: {
        pipelineId: z.string().min(1),
        outputId: z.string().min(1).optional(),
      },
    },
    ({ pipelineId, outputId }) =>
      guarded(() => previewOutputsHandler(api, { pipelineId, outputId })),
  );

  server.registerTool(
    "get_output_capabilities",
    {
      title: "Get the binding menu at a pipeline node",
      description:
        "Given a pipeline id and an optional stepId, return the same binding menu add_output's " +
        "fieldMapping grounding enforces (GET /api/pipelines/:id/capabilities?stepId=) — replaces " +
        "the retired get_panel_capabilities, which called a route that no longer exists. stepId " +
        "absent means the pipeline's raw source. Returns which Output kinds are structurally " +
        "bindable AT THIS NODE (not the trunk's schema if this is a tail), each kind's " +
        "required/optional fieldMapping slots, and which of the node's own projected columns are " +
        "eligible for each slot (advisory, not a bind-time-enforced guarantee) — plus shape " +
        "signals (columns with their types). Use this before add_output/update_output to build an " +
        "offers menu instead of re-deriving Helio's binding rules, and to know which columns are " +
        "actually available at a specific tail vs. the trunk.",
      inputSchema: {
        pipelineId: z.string().min(1),
        stepId: z.string().min(1).optional(),
      },
    },
    ({ pipelineId, stepId }) =>
      guarded(() => getOutputCapabilitiesHandler(api, { pipelineId, stepId })),
  );
}
