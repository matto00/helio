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
import {
  addOutputsFromShapeHandler,
  addPipelineRootHandler,
  createPipelineHandler,
  removePipelineRootHandler,
} from "./pipelinesHandlers.js";
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

// HEL-913 task 9.1: `create_pipeline`'s `roots[]` element -- the SAME `createPipelineSourceSchema`
// used by `add_root` below, plus an OPTIONAL request-scoped `clientId` a `steps[]`/`outputs[]`
// entry names via `rootClientId` (R6: "one shape, not two", and R13 extended to this tool).
const createPipelineRootSchema = createPipelineSourceSchema.extend({
  clientId: z.string().min(1).optional(),
});

export function registerPipelineTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "create_pipeline",
    {
      title: "Create a pipeline (roots + steps + Outputs, one call)",
      description:
        "Create a pipeline from one or more roots, optionally with transform steps and Outputs, " +
        "all in ONE call (POST /api/pipelines' single-call transactional shape, HEL-906/HEL-913 " +
        "multi-root). `roots` is a NON-EMPTY array; each element is EITHER an existing " +
        "caller-owned `sourceId` OR an inline new-source spec (`type`/`name`/`config`, same " +
        "per-type config shape create_rest_data_source/create_sql_data_source/create_data_source " +
        "accept) — never both, never neither, per element. `type` does NOT accept `csv` here (no " +
        "bytes channel in this call for an uploaded file) — create the csv source first " +
        "(create_csv_data_source) and pass its id via that element's `sourceId`. For an inline " +
        "source, this tool issues the source-create call FIRST, then (once every root is " +
        "resolved) the pipeline-create call; if a LATER root's resolution or the pipeline-create " +
        "call itself fails, EVERY inline source already created by an EARLIER root in this SAME " +
        "call is reported as orphaned in the error message (plural, not just the last one) so " +
        "you can clean them up with delete_data_source or teardown_resources (if tagged) — never " +
        "silently discarded. Each root MAY carry its own `clientId` (request-scoped, never " +
        "persisted) so a `steps[]`/`outputs[]` entry can name WHICH root it belongs to via " +
        "`rootClientId` — unnecessary when `roots` has exactly one element (unambiguous by " +
        "construction); with more than one root, a parentless step or a root-bound Output naming " +
        "NEITHER `parentStepId`/`nodeStepClientId` NOR `rootClientId` is rejected rather than " +
        "silently defaulting to the first root. `steps` (optional, may be empty) is an ordered " +
        "list of `{clientId, type, config, parentStepId?, rootClientId?}` — `clientId` is " +
        "request-scoped only, lets a LATER step's `parentStepId` branch off an EARLIER one in " +
        "this same call; `parentStepId` and `rootClientId` are mutually exclusive (a step with a " +
        "parent inherits its root implicitly). `outputs` (optional, may be empty) is a list of " +
        "`{kind, name, nodeStepClientId?, rootClientId?, config?}` — `nodeStepClientId` resolves " +
        "against `steps[].clientId`; `nodeStepClientId` and `rootClientId` are mutually exclusive " +
        "the same way. An Output's `config.fieldMapping`, when the kind requires one, is grounded " +
        "against the ACTUAL projected schema at its own node (not the trunk's) — call " +
        "get_output_capabilities first if unsure which columns exist at a given step. Optional " +
        "`tag` (HEL-366, free-form grouping key, max 200 chars) lets a whole workflow run's " +
        "resources be torn down together later with teardown_resources. Returns the created " +
        "pipeline summary (its `roots` array carries each real, position-ordered root id), plus " +
        "`outputs` (the created Outputs, if any were requested — a follow-up read, since the " +
        "create response itself doesn't report them).",
      inputSchema: {
        name: z.string().min(1),
        roots: z.array(createPipelineRootSchema).min(1),
        steps: z.array(pipelineProposalStepSchema).default([]),
        outputs: z.array(pipelineProposalOutputSchema).default([]),
        tag: z.string().min(1).max(200).optional(),
      },
    },
    ({ name, roots, steps, outputs, tag }) =>
      guarded(() => createPipelineHandler(api, { name, roots, steps, outputs, tag })),
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

  server.registerTool(
    "add_root",
    {
      title: "Add a root to an existing pipeline (multi-root)",
      description:
        "Append a new root to an EXISTING pipeline (POST /api/pipelines/:id/roots, HEL-913 " +
        "design.md R6) -- the multi-root entry point create_pipeline itself does not cover " +
        "(create_pipeline stays single-root by design). `source` is the SAME shape " +
        "create_pipeline's own `source` field uses: EITHER an existing caller-owned `sourceId` " +
        "OR an inline new-source spec (`type`/`name`/`config`) -- never both, never neither. " +
        "`type` does NOT accept `csv` here (no bytes channel in this call for an uploaded file) " +
        "-- create the csv source first (create_csv_data_source) and pass its id via " +
        "source.sourceId. For an inline source, this tool issues the source-create call FIRST, " +
        "then the add-root call; if the SECOND call fails, the already-created source is " +
        "reported as orphaned in the error message. A new root starts with no steps -- it is an " +
        "empty lane until steps are attached to it via add_pipeline_step's own rootId parameter.",
      inputSchema: {
        pipelineId: z.string().min(1),
        source: createPipelineSourceSchema,
      },
    },
    ({ pipelineId, source }) => guarded(() => addPipelineRootHandler(api, { pipelineId, source })),
  );

  server.registerTool(
    "remove_root",
    {
      title: "Remove a root from a pipeline (multi-root)",
      description:
        "Remove a root from a pipeline (DELETE /api/pipelines/:id/roots/:rootId, HEL-913 " +
        "design.md R7). Refuses (named error, nothing deleted) to remove the pipeline's LAST " +
        "root -- a pipeline must always have at least one. Refuses (named error, nothing " +
        "deleted) when a SURVIVING step's lane secondary input still references a node that " +
        "would be deleted with this root -- repoint or remove that reference first. On " +
        "success, deletes every step descending from this root (its root-level step and its " +
        "full descendant subtree) together with their Outputs, compacts the remaining roots' " +
        "positions, and reports { removedStepCount, removedOutputCount } (both counted BEFORE " +
        "the delete, never undercounted).",
      inputSchema: {
        pipelineId: z.string().min(1),
        rootId: z.string().min(1),
      },
    },
    ({ pipelineId, rootId }) =>
      guarded(() => removePipelineRootHandler(api, { pipelineId, rootId })),
  );
}
