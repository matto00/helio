/**
 * Pipeline Proposal → Review → Apply tools (HEL-385), mirroring `proposal.ts`'s
 * `propose_dashboard` → `apply_proposal` pattern for pipelines:
 *
 * - `propose_pipeline` assembles a `PipelineProposal` and returns it as JSON,
 *   writing NOTHING. It read-only-checks a given `sourceId` exists and flags
 *   an inline source missing required fields, attaching warnings so an agent
 *   — or a human reviewer — can fix a proposal before applying it.
 * - `analyze_pipeline_proposal` dry-analyzes a proposal via
 *   POST /api/pipelines/analyze-proposal — no writes.
 * - `apply_pipeline_proposal` posts an accepted proposal to
 *   POST /api/pipelines/apply-proposal — the same reviewed-artifact atomic
 *   write path HEL-383 built.
 *
 * This file is a thin shell (design.md D4b): zod `inputSchema` declarations +
 * `guarded(() => xHandler(api, ...))` one-liners only. All actual logic
 * (assembly, warnings, the `api.*` calls) lives in
 * `pipelineProposalHandlers.ts`, which this file imports and does not
 * duplicate — kept separate so a test can exercise that logic without
 * pulling this file's zod/`registerTool` surface into the compile graph (see
 * that module's docstring for the TS2589 reasoning).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import type { PipelineProposalSource } from "../types.js";
import {
  analyzePipelineProposalHandler,
  applyPipelineProposalHandler,
  proposePipelineHandler,
} from "./pipelineProposalHandlers.js";

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

// Wire shape mirrors PipelineProposalSource exactly (design.md D1: one
// `config` key, selected by `type` — not the Scala-internal four-`Option`
// shape). `type` keeps `csv` in the enum despite HEL-383 rejecting it at
// apply time (design.md D2) — narrowing it here would make this schema a
// worse mirror of the actual backend contract; both tool descriptions below
// document the apply-time rejection explicitly instead.
const pipelineProposalSourceSchema = z.object({
  sourceId: z.string().min(1).optional(),
  type: z.enum(["csv", "rest_api", "sql", "static"]).optional(),
  name: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// HEL-907 task 1.1/3.10: mirrors the backend's CreatePipelineTransactionalStepRequest/
// CreatePipelineTransactionalOutputRequest (P1.3/HEL-906's single-call transactional
// shapes) verbatim -- NOT `write.ts`'s `boundPipelineStepSchema` ({type, config} only,
// still the OLD per-step-write shape until `create_pipeline`'s own rewrite, task 3.2).
// `clientId`/`parentStepId`/`nodeStepClientId` let a proposal describe branching tree
// shape and per-node Output placement before anything has a real persisted id.
export const pipelineProposalStepSchema = z.object({
  clientId: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
  parentStepId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export const pipelineProposalOutputSchema = z.object({
  nodeStepClientId: z.string().min(1).optional(),
  kind: z.enum(["table", "metric", "chart", "collection", "timeline", "markdown"]),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

// Shared by all three tools below — the proposal `propose_pipeline` returns
// under `.proposal` is argument-compatible with both
// `analyze_pipeline_proposal` and `apply_pipeline_proposal` (same shape in),
// mirroring `propose_dashboard`'s `proposal` → `apply_proposal` precedent.
// Exported so `combinedProposal.ts`'s `apply_combined_proposal` (HEL-387) can
// reuse it verbatim for its `pipeline` field instead of a second,
// drift-prone copy. `outputs` is OPTIONAL (HEL-907 design.md decision 2) —
// a proposal may create a pipeline with zero Outputs, added later via
// `add_output`.
export const pipelineProposalInputSchema = {
  pipelineName: z.string().min(1),
  source: pipelineProposalSourceSchema,
  steps: z.array(pipelineProposalStepSchema).default([]),
  outputs: z.array(pipelineProposalOutputSchema).default([]),
};

export function registerPipelineProposalTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "propose_pipeline",
    {
      title: "Propose a pipeline (no writes)",
      description:
        "Assemble a pipeline proposal (source + a tree of transform steps + zero-or-more Outputs) " +
        "and return it as JSON WITHOUT writing anything — mirrors propose_dashboard for the " +
        "canonical Source → Pipeline → DataType → Panel path. `source` is EITHER an existing " +
        "caller-owned `sourceId` OR an inline new-source spec (`type`/`name`/`config`, same shape " +
        "create_csv_data_source/create_rest_data_source/create_sql_data_source/create_data_source " +
        "accept) — never both, never neither; setting both or neither is flagged as a warning. " +
        "`type` accepts `csv` here, but apply_pipeline_proposal REJECTS an inline csv source at " +
        "apply time (HEL-383) — a csv-sourced proposal is still useful to inspect before manually " +
        "creating that source (create_csv_data_source) and re-proposing with `sourceId`. `steps` is " +
        "an ordered list of `{clientId, type, config, parentStepId?}` steps (parentStepId, when " +
        "present, must be an EARLIER step's clientId in this same proposal — branches off that step; " +
        "absent extends the trunk) — may be empty to bind the raw source schema unchanged. " +
        "`outputs` (optional, empty by default) is a list of `{kind, name, nodeStepClientId?}` " +
        "Outputs; nodeStepClientId resolves against steps[].clientId, absent means the pipeline's " +
        "raw source. Read-only-checks a given `sourceId` resolves among your data sources and " +
        "that an inline source supplies a non-blank `name` and its matching `config`, returning " +
        "{ proposal, warnings, applyReady }. Every SQL step/source in the pipeline must remain " +
        "read-only (non-SELECT is rejected at apply time, never re-validated here). Review the " +
        "proposal (by inspection, or with analyze_pipeline_proposal), then apply it with " +
        "apply_pipeline_proposal.",
      inputSchema: pipelineProposalInputSchema,
    },
    ({ pipelineName, source, steps, outputs }) =>
      guarded(() =>
        proposePipelineHandler(api, {
          pipelineName,
          source: source as PipelineProposalSource,
          steps,
          outputs,
        }),
      ),
  );

  server.registerTool(
    "analyze_pipeline_proposal",
    {
      title: "Dry-analyze a pipeline proposal (no writes)",
      description:
        "Project the output schema of a pipeline proposal WITHOUT creating anything " +
        "(POST /api/pipelines/analyze-proposal, HEL-381) — pass the same arguments " +
        "propose_pipeline returns under `.proposal` (or hand-assemble them directly; " +
        "propose_pipeline is not required first). Returns { sourceName, sourceSchema, steps } — " +
        "`steps` is the same per-step " +
        "{id, position, type, config, inputSchema, outputSchema, validationError} shape " +
        "analyze_pipeline returns for an existing pipeline, projected here for a not-yet-created " +
        "one (no ids exist yet, since nothing is persisted).",
      inputSchema: pipelineProposalInputSchema,
    },
    ({ pipelineName, source, steps, outputs }) =>
      guarded(() =>
        analyzePipelineProposalHandler(api, {
          pipelineName,
          source: source as PipelineProposalSource,
          steps,
          outputs,
        }),
      ),
  );

  server.registerTool(
    "apply_pipeline_proposal",
    {
      title: "Apply a pipeline proposal",
      description:
        "Apply an accepted pipeline proposal via POST /api/pipelines/apply-proposal (HEL-383) — " +
        "the server validates and creates the source (if inline)/pipeline/steps atomically through " +
        "the existing services, then runs the pipeline synchronously; nothing is created if any " +
        "guardrail fails. Guardrail rejections (a non-SELECT SQL source/step, an inline source " +
        "missing name/config, both/neither of sourceId+type set, a source-fetch failure) are " +
        "surfaced verbatim as an error — never retried or silently interpreted. An inline `csv` " +
        "source is REJECTED at this apply step (HEL-383 design.md D3) even though propose_pipeline " +
        "accepts it — create the csv source first (create_csv_data_source) and pass its `sourceId` " +
        "instead. propose_pipeline's warnings are advisory only; this tool may be called directly " +
        "without ever calling propose_pipeline first. Returns the created source (if inline)/" +
        "pipeline summary/the created Outputs (zero, one, or many)/run result.",
      inputSchema: pipelineProposalInputSchema,
    },
    ({ pipelineName, source, steps, outputs }) =>
      guarded(() =>
        applyPipelineProposalHandler(api, {
          pipelineName,
          source: source as PipelineProposalSource,
          steps,
          outputs,
        }),
      ),
  );
}
