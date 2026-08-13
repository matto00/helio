/**
 * Combined Proposal Apply tool (HEL-387): applies a pipeline proposal and a
 * dashboard proposal atomically in one call, letting a dashboard panel bind
 * to the pipeline's not-yet-created output DataType via the reserved
 * "$pipelineOutput" sentinel — closing the "build me a dashboard from this
 * CSV" loop that neither `apply_pipeline_proposal` nor `apply_proposal`
 * closes alone.
 *
 * - `apply_combined_proposal` posts to POST /api/proposals/apply — the
 *   atomic source(if inline)/pipeline/steps/run + dashboard/panels write
 *   path this ticket built. No propose/analyze/dry-run counterpart: this is
 *   the deterministic apply path only (ticket's own Out of Scope — NL
 *   authoring is HEL-341).
 *
 * This file is a thin shell (mirrors `pipelineProposal.ts`'s design.md D4b
 * split): a zod `inputSchema` declaration + a single
 * `guarded(() => applyCombinedProposalHandler(api, ...))` call, with no
 * business logic of its own — the sentinel-position validation happens
 * server-side only (design.md D7), so there is no client-side pre-validation
 * to extract into a separate handlers module the way
 * `pipelineProposalHandlers.ts` does for `propose_pipeline`'s warnings.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import type { CombinedProposal, PipelineProposalSource, ProposalPanel } from "../types.js";
import { applyCombinedProposalHandler } from "./combinedProposalHandlers.js";
import { pipelineProposalInputSchema } from "./pipelineProposal.js";
import { panelSchema } from "./proposal.js";

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

export function registerCombinedProposalTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "apply_combined_proposal",
    {
      title: "Apply a combined pipeline+dashboard proposal",
      description:
        "Apply a source(if inline)+pipeline+run+dashboard+panels proposal atomically via " +
        "POST /api/proposals/apply (HEL-387) — the server applies `pipeline` via the same atomic " +
        "path apply_pipeline_proposal uses, then applies `dashboard` via the same atomic path " +
        "apply_proposal uses, rolling back the pipeline (and its inline source, if any) if the " +
        "dashboard phase fails; nothing is created if any guardrail fails.\n" +
        "Bind a dashboard panel to `pipeline`'s not-yet-created output DataType by setting the " +
        'literal string "$pipelineOutput" as its `dataTypeId` (metric/chart/table/collection/' +
        "timeline panels) OR its `config.dataTypeId` (a non-data panel, e.g. text/markdown, and ONLY " +
        "when the panel's flat `dataTypeId` is left unset — never both) — the exact same slot a real " +
        "DataType id would occupy. A panel may instead bind to any pre-existing pipeline-output " +
        "DataType id exactly as apply_proposal already accepts, and a dashboard may mix both kinds " +
        "of panel in the same call. The sentinel must appear in AT MOST that one binding position " +
        "per panel — anywhere else (the wrong slot for the panel's kind, a slot already shadowed by " +
        "a real dataTypeId on the same panel, or a duplicate elsewhere such as fieldMapping) 400s " +
        "the WHOLE call, creating nothing, before the pipeline is even applied.\n" +
        "`pipeline.source` is EITHER an existing caller-owned `sourceId` OR an inline new-source " +
        "spec (`type`/`name`/`config`), matching apply_pipeline_proposal exactly (including its " +
        "inline-`csv`-rejected-at-apply-time guardrail); `pipeline.steps` may be empty to bind the " +
        "raw source schema unchanged. This is the deterministic apply path only — there is no " +
        "propose/analyze/dry-run counterpart; review `pipeline` (with propose_pipeline/" +
        "analyze_pipeline_proposal) and `dashboard` (with propose_dashboard) separately first if " +
        "needed — neither call writes anything. Returns { pipeline, dashboard }: `pipeline` matches " +
        "apply_pipeline_proposal's own response (created source (if inline)/pipeline summary/output " +
        "DataType id/run result); `dashboard` matches apply_proposal's own response (created " +
        "dashboard + panels).",
      inputSchema: {
        pipeline: z.object(pipelineProposalInputSchema),
        dashboard: z.object({
          dashboardName: z.string().min(1),
          panels: z.array(panelSchema),
        }),
      },
    },
    ({ pipeline, dashboard }) =>
      guarded(() =>
        applyCombinedProposalHandler(api, {
          pipeline: {
            pipelineName: pipeline.pipelineName,
            source: pipeline.source as PipelineProposalSource,
            outputDataTypeName: pipeline.outputDataTypeName,
            steps: pipeline.steps,
          },
          dashboard: {
            dashboardName: dashboard.dashboardName,
            panels: dashboard.panels as ProposalPanel[],
          },
        } as CombinedProposal),
      ),
  );
}
