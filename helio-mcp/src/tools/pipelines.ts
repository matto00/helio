/**
 * `create_pipeline` (HEL-907 task 3.2, retargeted onto the Outputs model,
 * P1.3/HEL-906's single-call transactional shape). This file is a thin
 * shell (mirrors `pipelineProposal.ts`'s design.md D4b split): a zod
 * `inputSchema` declaration + a single `guarded(() =>
 * createPipelineHandler(api, ...))` call, with no business logic of its
 * own — `pipelinesHandlers.ts` holds that (inline-source resolution +
 * orphan-reporting on a subsequent failure, the follow-up Outputs read).
 * `add_pipeline_step` stays registered in `write.ts` (its own handler
 * already lived in `assertSchemas.ts` before this ticket, extended there
 * for task 3.3's `parentStepId`, not duplicated here).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import { addOutputsFromShapeHandler, createPipelineHandler } from "./pipelinesHandlers.js";
import { pipelineProposalOutputSchema, pipelineProposalStepSchema } from "./pipelineProposal.js";

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

// Mirrors `pipelineProposalSourceSchema` (`pipelineProposal.ts`) minus the `csv` enum member --
// create_pipeline's inline branch does not support csv (no bytes channel; see
// pipelinesHandlers.ts's own docstring for the exact rationale, identical to the proposal flow's).
const createPipelineSourceSchema = z.object({
  sourceId: z.string().min(1).optional(),
  type: z.enum(["rest_api", "sql", "static"]).optional(),
  name: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export function registerPipelineTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "create_pipeline",
    {
      title: "Create a pipeline (source + steps + Outputs, one call)",
      description:
        "Create a pipeline from a source, optionally with its transform steps and Outputs, all " +
        "in ONE call (POST /api/pipelines' single-call transactional shape, HEL-906). `source` is " +
        "EITHER an existing caller-owned `sourceId` OR an inline new-source spec (`type`/`name`/" +
        "`config`, same per-type config shape create_rest_data_source/create_sql_data_source/" +
        "create_data_source accept) — never both, never neither. `type` does NOT accept `csv` here " +
        "(no bytes channel in this call for an uploaded file) — create the csv source first " +
        "(create_csv_data_source) and pass its id via source.sourceId. For an inline source, this " +
        "tool issues the source-create call FIRST, then the pipeline-create call; if the SECOND " +
        "call fails, the already-created source is reported as orphaned in the error message so " +
        "you can clean it up with delete_data_source or teardown_resources (if tagged) — it is " +
        "never silently discarded. `steps` (optional, may be empty) is an ordered list of " +
        "`{clientId, type, config, parentStepId?}` — `clientId` is request-scoped only, lets a " +
        "LATER step's `parentStepId` branch off an EARLIER one in this same call; absent " +
        "`parentStepId` extends the trunk. `outputs` (optional, may be empty) is a list of " +
        "`{kind, name, nodeStepClientId?, config?}` — `nodeStepClientId` resolves against " +
        "`steps[].clientId`; absent means the pipeline's raw source. An Output's " +
        "`config.fieldMapping`, when the kind requires one, is grounded against the ACTUAL " +
        "projected schema at its own node (not the trunk's) — call get_output_capabilities first " +
        "if unsure which columns exist at a given step. Optional `tag` (HEL-366, free-form " +
        "grouping key, max 200 chars) lets a whole workflow run's resources be torn down together " +
        "later with teardown_resources. Returns the created pipeline summary, plus `outputs` " +
        "(the created Outputs, if any were requested — a follow-up read, since the create " +
        "response itself doesn't report them).",
      inputSchema: {
        name: z.string().min(1),
        source: createPipelineSourceSchema,
        steps: z.array(pipelineProposalStepSchema).default([]),
        outputs: z.array(pipelineProposalOutputSchema).default([]),
        tag: z.string().min(1).max(200).optional(),
      },
    },
    ({ name, source, steps, outputs, tag }) =>
      guarded(() => createPipelineHandler(api, { name, source, steps, outputs, tag })),
  );

  server.registerTool(
    "add_outputs_from_shape",
    {
      title: "Expand a smart shape onto an existing pipeline node, and add its Output",
      description:
        "Instantiate a smart pipeline shape's steps onto an EXISTING pipeline (replaces the " +
        "retired create_pipeline_from_shape, which always created a brand-new pipeline) — " +
        "instead of hand-assembling steps with add_pipeline_step + add_output. Validates `params` " +
        "against the shape's own expand FIRST (POST /api/pipeline-shapes/:shapeId/expand) — if " +
        "that fails (unknown shapeId, or params rejected), NOTHING is added and the tool returns " +
        "an error whose message is the backend's 404/422 message verbatim (an unknown shapeId's " +
        "message lists every registered id). Only once expand succeeds does it chain each " +
        "expanded step onto the pipeline in order (the first branching off `stepId` — absent " +
        "means the pipeline's raw source — each subsequent one off the previous), then create " +
        "ONE Output on the shape's terminal step named `outputName`, `outputKind` defaulting to " +
        "`table` when omitted. Does NOT run the pipeline — call run_pipeline/preview_outputs " +
        "afterward. Call list_pipeline_shapes first to see every registered shapeId + its params " +
        "shape. Registered shape ids + params: " +
        "`passthrough` {fields: string[]}; " +
        '`single-row` {mode:"aggregate"|"filter", measures?:{fn,field,alias}[], ' +
        "conditions?:{field,operator,value}[], combinator?}; " +
        '`top-n` {measure, direction:"asc"|"desc", n, ties?}; ' +
        '`time-series` {timeField, granularity:"day"|"week"|"month"|"quarter"|"year", ' +
        "measures:{fn,field,alias}[]}; " +
        '`pivot-matrix` {index:string[], column, values, agg:"sum"|"count"|"avg"|"min"|' +
        '"max"|"first"}. Returns { steps, output }: the ordered list of created steps, and the ' +
        "created Output.",
      inputSchema: {
        pipelineId: z.string().min(1),
        stepId: z.string().min(1).optional(),
        shapeId: z.string().min(1),
        params: z.record(z.string(), z.unknown()).default({}),
        outputName: z.string().min(1),
        outputKind: z
          .enum(["table", "metric", "chart", "collection", "timeline", "markdown"])
          .optional(),
      },
    },
    ({ pipelineId, stepId, shapeId, params, outputName, outputKind }) =>
      guarded(() =>
        addOutputsFromShapeHandler(api, {
          pipelineId,
          stepId,
          shapeId,
          params,
          outputName,
          outputKind,
        }),
      ),
  );
}
